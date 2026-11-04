import '../../lib/config.js';
import { callsignNumber, normalize } from '../../lib/access/shared.js';
import { UpstashRedis } from '../../lib/storage/upstash-redis.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:U400';
const ATTENDANCE_SHEET_RANGE = process.env.GOOGLE_ATTENDANCE_RANGE || "'EVIDENTA ACTIVITATE'!A1:U400";
const TEST_PONTAJE_RANGE = process.env.GOOGLE_TEST_PONTAJE_RANGE || "'TEST PONTAJE'!D1:D400";
const ATTENDANCE_TIME_ZONE = 'Europe/Bucharest';
const attendanceRedis = new UpstashRedis();

function json(res, status, body) { return res.status(status).json(body); }
function attendanceReviewKey(dateKey, discordId) { return `site-testeri-medici:attendance-review:${dateKey}:${discordId}`; }
async function readMembers() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MEMBER_RANGE)}?key=${encodeURIComponent(key)}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.values)) throw new Error('Google Sheets read failed');
  return data.values.slice(1).filter(row => Array.isArray(row) && String(row[3] || '').trim() && String(row[19] || '').trim());
}
async function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Google Sheets service account is not configured');
  const { google } = await import('googleapis');
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : undefined;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}
function redisKey(discordId) { return `site-testeri-medici:attendance:${discordId}`; }
function cleanEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => Number.isFinite(Number(entry?.start)) && (entry.end == null || Number.isFinite(Number(entry.end))))
    .map(entry => ({
      start: Number(entry.start),
      end: entry.end == null ? null : Number(entry.end),
      ...(entry.canceled === true ? { canceled: true } : {}),
      ...(entry.canceledAt != null && Number.isFinite(Number(entry.canceledAt)) ? { canceledAt: Number(entry.canceledAt) } : {}),
      ...(typeof entry.canceledBy === 'string' ? { canceledBy: entry.canceledBy } : {}),
      ...(entry.autoClosed === true ? { autoClosed: true } : {})
    }))
    .slice(-2000);
}
async function readAttendanceData(discordId) {
  if (!attendanceRedis.isConfigured) return [];
  const stored = await attendanceRedis.getJson(redisKey(discordId)).catch(error => {
    console.error('Attendance Redis read failed:', error);
    throw error;
  });
  return cleanEntries(Array.isArray(stored) ? stored : stored?.entries);
}
async function writeAttendanceData(discordId, data) {
  const cleaned = cleanEntries(data);
  await attendanceRedis.setJson(redisKey(discordId), cleaned);
  return cleaned;
}
function bucharestParts(timestamp) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}
function attendanceDateKey(timestamp) {
  const parts = bucharestParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}
function bucharestDayStart(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  let timestamp = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = bucharestParts(timestamp);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    timestamp += target - represented;
  }
  return timestamp;
}
export function attendanceStartAllowed(timestamp) {
  const parts = bucharestParts(timestamp);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return hour < 23 || (hour === 23 && minute < 35);
}
export function closeExpiredAttendanceEntries(entries, now) {
  const currentDate = attendanceDateKey(now);
  let closed = 0;
  const updated = cleanEntries(entries).map(entry => {
    if (entry.end != null || attendanceDateKey(entry.start) === currentDate) return entry;
    closed += 1;
    return { ...entry, end: bucharestDayStart(addDays(attendanceDateKey(entry.start), 1)), autoClosed: true };
  });
  return { entries: updated, closed };
}
function validDateKey(dateKey) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === dateKey;
}
function isCurrentWeekDate(dateKey, now = Date.now()) {
  if (!validDateKey(dateKey)) return false;
  const today = attendanceDateKey(now);
  const currentWeekStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  return dateKey >= currentWeekStart && dateKey <= addDays(currentWeekStart, 6);
}
export function attendanceMinutesForDate(entries, dateKey, now = Date.now()) {
  if (!validDateKey(dateKey)) throw new Error('Data pontajului este invalidă.');
  const startOfDay = bucharestDayStart(dateKey);
  const endOfDay = bucharestDayStart(addDays(dateKey, 1));
  const milliseconds = cleanEntries(entries).reduce((total, entry) => {
    if (entry.canceled) return total;
    const start = Math.max(entry.start, startOfDay);
    const end = Math.min(entry.end == null ? now : entry.end, endOfDay);
    return end > start ? total + end - start : total;
  }, 0);
  return Math.floor(milliseconds / 60000);
}
function attendanceHasEntryOnDate(entries, dateKey) {
  const startOfDay = bucharestDayStart(dateKey);
  const endOfDay = bucharestDayStart(addDays(dateKey, 1));
  return cleanEntries(entries).some(entry =>
    attendanceDateKey(entry.start) === dateKey || (entry.start < endOfDay && (entry.end == null || entry.end > startOfDay))
  );
}
export function attendanceSheetDayColumn(dateKey) {
  const weekday = (new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7;
  return String.fromCharCode('F'.charCodeAt(0) + weekday);
}
function attendanceSheetTitle() {
  return ATTENDANCE_SHEET_RANGE.split('!')[0].replace(/^'|'$/g, '') || 'EVIDENTA ACTIVITATE';
}
function attendanceSheetNamesRange() { return `'${attendanceSheetTitle()}'!D1:D400`; }
function attendanceSheetCell(column, row) { return `'${attendanceSheetTitle()}'!${column}${row}`; }
function normalizedName(value) {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export async function writeAttendanceToSheet(sheets, memberName, dateKey, minutes) {
  const [sourceResult, targetResult] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TEST_PONTAJE_RANGE }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: attendanceSheetNamesRange() })
  ]);
  const wantedName = normalizedName(memberName);
  const sourceNames = (sourceResult.data.values || []).flatMap((row, index) => normalizedName(row[0]) === wantedName ? [index + 1] : []);
  if (!sourceNames.length) throw new Error(`Persoana ${memberName} nu a fost găsită în fila TEST PONTAJE, coloana D.`);
  const targetRows = (targetResult.data.values || []).flatMap((row, index) => normalizedName(row[0]) === wantedName ? [index + 1] : []);
  if (!targetRows.length) throw new Error(`Persoana ${memberName} nu a fost găsită în coloana D din EVIDENTA ACTIVITATE.`);
  if (targetRows.length > 1) throw new Error(`Numele ${memberName} apare de mai multe ori în EVIDENTA ACTIVITATE.`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: attendanceSheetCell(attendanceSheetDayColumn(dateKey), targetRows[0]),
    valueInputOption: 'RAW',
    requestBody: { values: [[minutes]] }
  });
}
async function writeDepartmentAttendanceToSheet(sheets, members, entries, dateKey) {
  const [sourceResult, targetResult] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TEST_PONTAJE_RANGE }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: attendanceSheetNamesRange() })
  ]);
  const sourceNames = new Set((sourceResult.data.values || []).map(row => normalizedName(row[0])).filter(Boolean));
  const targetRows = new Map();
  (targetResult.data.values || []).forEach((row, index) => {
    const name = normalizedName(row[0]);
    if (!name) return;
    if (targetRows.has(name)) targetRows.set(name, null);
    else targetRows.set(name, index + 1);
  });
  const dayColumn = attendanceSheetDayColumn(dateKey);
  const updates = members.flatMap(member => {
    const name = normalizedName(member.name);
    if (!attendanceHasEntryOnDate(entries[member.discordId], dateKey)) return [];
    if (!sourceNames.has(name)) throw new Error(`Persoana ${member.name} nu a fost găsită în fila TEST PONTAJE, coloana D.`);
    const rowNumber = targetRows.get(name);
    if (rowNumber === undefined) throw new Error(`Persoana ${member.name} nu a fost găsită în coloana D din EVIDENTA ACTIVITATE.`);
    if (rowNumber === null) throw new Error(`Numele ${member.name} apare de mai multe ori în EVIDENTA ACTIVITATE.`);
    return [{ range: attendanceSheetCell(dayColumn, rowNumber), values: [[attendanceMinutesForDate(entries[member.discordId], dateKey)]] }];
  });
  if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'RAW', data: updates } });
  return updates.length;
}
async function closeExpiredDepartmentEntries(members, now) {
  const ids = members.map(row => String(row[19] || '').trim());
  const values = await attendanceRedis.pipeline(ids.map(id => ['GET', redisKey(id)]));
  const writes = [];
  let closed = 0;
  values.forEach((value, index) => {
    if (!value) return;
    const data = JSON.parse(value);
    const result = closeExpiredAttendanceEntries(Array.isArray(data) ? data : data?.entries, now);
    if (!result.closed) return;
    closed += result.closed;
    writes.push(['SET', redisKey(ids[index]), JSON.stringify(result.entries)]);
  });
  if (writes.length) await attendanceRedis.pipeline(writes);
  return closed;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  if (req.method === 'GET' && req.query?.task === 'close-expired') {
    const cronSecret = String(process.env.CRON_SECRET || '').trim();
    if (!cronSecret) return json(res, 503, { error: 'CRON_SECRET is not configured.' });
    if (req.headers?.authorization !== `Bearer ${cronSecret}`) return json(res, 401, { error: 'Unauthorized' });
    if (!attendanceRedis.isConfigured) return json(res, 503, { error: 'Pontajele online nu sunt configurate.' });
    try {
      const members = await readMembers();
      const closed = await closeExpiredDepartmentEntries(members, Date.now());
      return json(res, 200, { success: true, closed });
    } catch (error) {
      console.error('Automatic attendance closure failed:', error);
      return json(res, 500, { error: 'Pontajele expirate nu au putut fi închise.' });
    }
  }

  const requesterId = String(req.method === 'GET' ? req.query?.requesterId : req.body?.requesterId || '').trim();
  if (!requesterId) return json(res, 400, { error: 'Missing requesterId' });
  try {
    const members = await readMembers();
    const requester = members.find(row => String(row[19] || '').trim() === requesterId);
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    const requesterCallsign = callsignNumber(requester[2]);
    const isLeadership = requesterCallsign >= 1 && requesterCallsign <= 20;
    const activeAttendanceView = req.method === 'GET' && req.query?.view === 'active';
    if (req.method === 'GET' && !isLeadership && req.query?.view !== 'own') return json(res, 403, { error: 'Only callsigns 001-020 can view department attendance records' });
    const now = Date.now();
    const reviewDateKey = String(req.query?.date || attendanceDateKey(now));
    if (activeAttendanceView && !isCurrentWeekDate(reviewDateKey, now)) return json(res, 400, { error: 'Alege o zi din săptămâna curentă.' });
    if (!attendanceRedis.isConfigured) {
      if (req.method === 'GET')       return json(res, 200, { entries: isLeadership && req.query?.view !== 'own' ? {} : [], activeEntries: [], members: [], reviewStates: {}, configured: false });
      return json(res, 503, { error: 'Pontajele online nu sunt configurate.' });
    }
    if (req.method === 'POST') {
      const action = req.body?.action;
      const now = Date.now();
      if (action === 'sync-docs' || action === 'sync-docs-all') {
        if (!isLeadership) return json(res, 403, { error: 'Only callsigns 001-020 can update attendance in Google Sheets' });
        const dateKey = String(req.body?.dateKey || '');
        if (!isCurrentWeekDate(dateKey, now)) return json(res, 400, { error: 'Alege o zi din săptămâna curentă.' });
        if (action === 'sync-docs') {
          const targetId = String(req.body?.targetDiscordId || '').trim();
          const status = req.body?.status;
          if (!['validated', 'unvalidated'].includes(status)) return json(res, 400, { error: 'Starea de validare este invalidă.' });
          const target = members.find(row => String(row[19] || '').trim() === targetId);
          if (!targetId || !target) return json(res, 404, { error: 'Membrul pentru sincronizarea pontajului nu a fost găsit.' });
          const targetData = await readAttendanceData(targetId);
          const normalized = closeExpiredAttendanceEntries(targetData, now);
          if (normalized.closed) await writeAttendanceData(targetId, normalized.entries);
          if (!attendanceHasEntryOnDate(normalized.entries, dateKey)) return json(res, 409, { error: 'Membrul nu are pontaje în ziua selectată.' });
          const minutes = attendanceMinutesForDate(normalized.entries, dateKey, now);
          const sheets = await sheetsClient();
          await writeAttendanceToSheet(sheets, String(target[3] || '').trim(), dateKey, minutes);
          const review = { status, minutes, updatedAt: new Date(now).toISOString(), updatedBy: requesterId };
          await attendanceRedis.setJson(attendanceReviewKey(dateKey, targetId), review, { expirationSeconds: 60 * 60 * 24 * 400 });
          return json(res, 200, { success: true, review });
        }
        const sheets = await sheetsClient();
        const ids = members.map(row => String(row[19] || '').trim());
        const values = await attendanceRedis.pipeline(ids.map(id => ['GET', redisKey(id)]));
        const departmentEntries = {};
        values.forEach((value, index) => {
          const data = value ? JSON.parse(value) : [];
          const normalized = closeExpiredAttendanceEntries(Array.isArray(data) ? data : data?.entries, now);
          departmentEntries[ids[index]] = normalized.entries;
        });
        const sheetMembers = members.map(row => ({ discordId: String(row[19] || '').trim(), name: String(row[3] || '').trim() }));
        const updated = await writeDepartmentAttendanceToSheet(sheets, sheetMembers, departmentEntries, dateKey);
        return json(res, 200, { success: true, updated });
      }
      if (action === 'cancel') {
        if (!isLeadership) return json(res, 403, { error: 'Only callsigns 001-020 can cancel attendance records' });
        const targetId = String(req.body?.targetDiscordId || '').trim();
        const target = members.find(row => String(row[19] || '').trim() === targetId);
        if (!targetId || !target) return json(res, 404, { error: 'Membrul pentru anularea pontajului nu a fost găsit.' });
        const targetData = await readAttendanceData(targetId);
        const normalized = closeExpiredAttendanceEntries(targetData, now);
        const open = [...normalized.entries].reverse().find(entry => entry.end == null);
        if (!open) return json(res, 409, { error: 'Membrul nu are un pontaj activ.' });
        open.end = now;
        open.canceled = true;
        open.canceledAt = now;
        open.canceledBy = requesterId;
        await writeAttendanceData(targetId, normalized.entries);
        return json(res, 200, { success: true });
      }

      const data = await readAttendanceData(requesterId);
      const normalized = closeExpiredAttendanceEntries(data, now);
      if (normalized.closed) await writeAttendanceData(requesterId, normalized.entries);
      if (action === 'start') {
        if (!attendanceStartAllowed(now)) return json(res, 409, { error: 'Pontajul nu mai poate fi deschis după ora 23:35.' });
        if (normalized.entries.some(entry => entry.end == null)) return json(res, 409, { error: 'Există deja un pontaj activ.' });
        normalized.entries.push({ start: now, end: null });
      } else if (action === 'stop') {
        const open = [...normalized.entries].reverse().find(entry => entry.end == null);
        if (!open) return json(res, 409, { error: 'Nu există un pontaj activ.' });
        open.end = now;
      } else return json(res, 400, { error: 'Acțiune invalidă' });
      const saved = await writeAttendanceData(requesterId, normalized.entries);
      return json(res, 200, { success: true, entries: saved });
    }

    if (!isLeadership || req.query?.view === 'own') {
      const ownData = await readAttendanceData(requesterId);
      const normalized = closeExpiredAttendanceEntries(ownData, Date.now());
      if (normalized.closed) await writeAttendanceData(requesterId, normalized.entries);
      return json(res, 200, { entries: normalized.entries, configured: true });
    }
    const ids = members.map(row => String(row[19] || '').trim());
    const values = await attendanceRedis.pipeline(ids.map(id => ['GET', redisKey(id)]));
    const entries = {};
    const writes = [];
    const activeEntries = [];
    const departmentMembers = members.map(row => ({
      discordId: String(row[19] || '').trim(),
      name: String(row[3] || '').trim(),
      callsign: String(row[2] || '').trim(),
      rank: String(row[4] || '').trim()
    }));
    values.forEach((value, index) => {
      const data = value ? JSON.parse(value) : [];
      const normalized = closeExpiredAttendanceEntries(Array.isArray(data) ? data : data?.entries, now);
      const id = ids[index];
      entries[id] = normalized.entries;
      if (normalized.closed) writes.push(['SET', redisKey(id), JSON.stringify(normalized.entries)]);
      const open = [...normalized.entries].reverse().find(entry => entry.end == null);
      if (open) activeEntries.push({
        discordId: id,
        name: String(members[index][3] || '').trim(),
        callsign: String(members[index][2] || '').trim(),
        rank: String(members[index][4] || '').trim(),
        start: open.start
      });
    });
    if (writes.length) await attendanceRedis.pipeline(writes);
    const reviewStates = {};
    if (activeAttendanceView) {
      const reviewKeys = ids.map(id => attendanceReviewKey(reviewDateKey, id));
      const reviews = await attendanceRedis.pipeline(reviewKeys.map(key => ['GET', key]));
      reviews.forEach((value, index) => {
        if (!value) return;
        reviewStates[reviewDateKey] ||= {};
        reviewStates[reviewDateKey][ids[index]] = JSON.parse(value);
      });
    }
    return json(res, 200, { entries, activeEntries, members: departmentMembers, reviewStates, configured: true });
  } catch (error) {
    console.error('Attendance records failed:', error);
    return json(res, 500, { error: 'Pontajele nu au putut fi încărcate.' });
  }
}
