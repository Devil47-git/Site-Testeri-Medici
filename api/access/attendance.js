import '../../lib/config.js';
import { callsignNumber } from '../../lib/access/shared.js';
import { UpstashRedis } from '../../lib/storage/upstash-redis.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:U400';
const ATTENDANCE_TIME_ZONE = 'Europe/Bucharest';
const attendanceRedis = new UpstashRedis();

function json(res, status, body) { return res.status(status).json(body); }
async function readMembers() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MEMBER_RANGE)}?key=${encodeURIComponent(key)}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.values)) throw new Error('Google Sheets read failed');
  return data.values.slice(1).filter(row => Array.isArray(row) && String(row[3] || '').trim() && String(row[19] || '').trim());
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
    if (req.method === 'GET' && !isLeadership && req.query?.view !== 'own') return json(res, 403, { error: 'Only callsigns 001-020 can view department attendance records' });
    if (!attendanceRedis.isConfigured) {
      if (req.method === 'GET') return json(res, 200, { entries: isLeadership && req.query?.view !== 'own' ? {} : [], activeEntries: [], configured: false });
      return json(res, 503, { error: 'Pontajele online nu sunt configurate.' });
    }
    if (req.method === 'POST') {
      const action = req.body?.action;
      const now = Date.now();
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
    const now = Date.now();
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
    return json(res, 200, { entries, activeEntries, configured: true });
  } catch (error) {
    console.error('Attendance records failed:', error);
    return json(res, 500, { error: 'Pontajele nu au putut fi încărcate.' });
  }
}
