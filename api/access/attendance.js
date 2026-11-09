import '../../lib/config.js';
import { attendanceTypesForFunctions, canManageAttendance, callsignNumber, normalize } from '../../lib/access/shared.js';
import { SupabaseKV } from '../../lib/storage/supabase-kv.js';
import { functionsForDepartmentRow, readFunctionOverrides } from '../../lib/access/function-overrides.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:U400';
const ATTENDANCE_SHEET_RANGE = process.env.GOOGLE_ATTENDANCE_RANGE || "'EVIDENTA ACTIVITATE'!A1:U400";
const TEST_PONTAJE_RANGE = process.env.GOOGLE_TEST_PONTAJE_RANGE || "'TEST PONTAJE'!D1:D400";
const ATTENDANCE_TIME_ZONE = 'Europe/Bucharest';
const HOSPITAL_CHAT_ROLE_ID = '804382163536576616';
const HR_TEAM_EMOJI = '<:HRTEAM:1467455378374787116>';
const ATTENDANCE_DOCS_SYNC_COOLDOWN_SECONDS = 60;
const attendanceRedis = new SupabaseKV();

function json(res, status, body) { return res.status(status).json(body); }
export function attendanceTypesForFunctionIds(functionIds) {
  return attendanceTypesForFunctions(Array.isArray(functionIds) ? functionIds.join('|') : '');
}
function attendanceTypeForEntry(entry) {
  return entry?.type === 'hr' || entry?.type === 'pr' ? entry.type : 'regular';
}
async function allowedAttendanceTypesForMember(discordId) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MEMBER_RANGE)}?key=${encodeURIComponent(key)}`);
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.values)) throw new Error('Google Sheets member function read failed');
  const member = data.values.slice(1).find(row => String(row?.[19] || '').trim() === discordId);
  if (!member) throw new Error('Department member not found while checking attendance functions');
  return attendanceTypesForFunctions(functionsForDepartmentRow(member, await readFunctionOverrides()));
}
function attendanceReviewKey(dateKey, discordId) { return `site-testeri-medici:attendance-review:${dateKey}:${discordId}`; }
function reviewTime(value) {
  const rounded = Math.round(Number(value) / 300000) * 300000;
  return new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' }).format(new Date(rounded));
}
function reviewWebhookUrl() {
  try {
    const url = new URL(String(process.env.DISCORD_ATTENDANCE_REVIEW_WEBHOOK || '').trim());
    return url.protocol === 'https:' && url.hostname === 'discord.com' && url.pathname.startsWith('/api/webhooks/') ? url.toString() : '';
  } catch {
    return '';
  }
}
function requiredReviewWebhookUrl() {
  const url = reviewWebhookUrl();
  if (!url) throw new Error('DISCORD_ATTENDANCE_REVIEW_WEBHOOK is missing or invalid');
  return url;
}
export async function sendAttendanceReviewWebhook({ status, reviewerId, reviewer, targetId, target, entry, dateKey, minutes }) {
  const url = status === 'canceled' ? requiredHospitalChatWebhookUrl() : requiredReviewWebhookUrl();
  const origin = String(process.env.APP_ORIGIN || 'https://site-wheat-zeta-76.vercel.app').trim().replace(/\/+$/, '');
  const validated = status === 'validated';
  const [year, month, day] = String(dateKey).split('-');
  const person = id => `<@${id}>`;
  const content = status === 'canceled'
    ? `De: ${person(reviewerId)} PONTAJ ANULAT :x: lui ${person(targetId)}, Motiv: ${String(entry.cancelReason || '').slice(0, 500)}\nPontaj: de la ora ${reviewTime(entry.start)} până la ora ${entry.end == null ? 'În desfășurare' : reviewTime(entry.end)} (${day}.${month}.${year}).`
    : undefined;
  const embed = {
    title: validated ? '✅ Pontaj validat' : '❌ Pontaj anulat',
    color: validated ? 0x39a578 : 0xe35662,
    thumbnail: { url: `${origin}/assets/hr-team.png` },
    fields: [
      { name: validated ? 'Validat de' : 'Anulat de', value: person(reviewerId), inline: true },
      { name: 'Pontajul lui', value: person(targetId), inline: true },
      { name: 'Data', value: `${day}.${month}.${year}`, inline: true },
      { name: 'Clock-IN', value: reviewTime(entry.start), inline: true },
      { name: 'Clock-OUT', value: entry.end == null ? 'În desfășurare' : reviewTime(entry.end), inline: true },
      { name: 'Durată pontaj', value: `${minutes} min`, inline: true },
      ...(status === 'canceled' ? [{ name: 'Motiv', value: String(entry.cancelReason || '').slice(0, 1000) || '—' }] : [])
    ],
    timestamp: new Date().toISOString()
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'HR TEAM',
      avatar_url: `${origin}/assets/hr-team.png`,
      allowed_mentions: status === 'canceled' ? { parse: [], users: [...new Set([reviewerId, targetId].filter(Boolean))] } : { parse: [] },
      ...(content ? { content } : { embeds: [embed] })
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
export async function sendAttendanceEditWebhook({ editorId, editor, targetId, target, before, entry, dateKey, minutes, reason }) {
  const url = requiredReviewWebhookUrl();
  const origin = String(process.env.APP_ORIGIN || 'https://site-wheat-zeta-76.vercel.app').trim().replace(/\/+$/, '');
  const [year, month, day] = String(dateKey).split('-');
  const person = id => `<@${id}>`;
  const out = value => value == null ? 'În desfășurare' : reviewTime(value);
  const embed = {
    title: '✏️ Pontaj editat',
    color: 0x2b8cff,
    thumbnail: { url: `${origin}/assets/hr-team.png` },
    fields: [
      { name: 'Editat de', value: person(editorId), inline: true },
      { name: 'Pontajul lui', value: person(targetId), inline: true },
      { name: 'Data', value: `${day}.${month}.${year}`, inline: true },
      { name: 'Clock-IN', value: `${reviewTime(before.start)} → **${reviewTime(entry.start)}**`, inline: true },
      { name: 'Clock-OUT', value: `${out(before.end)} → **${out(entry.end)}**`, inline: true },
      { name: 'Durată pontaj', value: `${minutes} min`, inline: true },
      { name: 'Motiv', value: String(reason).slice(0, 1000) }
    ],
    timestamp: new Date().toISOString()
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'HR TEAM', avatar_url: `${origin}/assets/hr-team.png`, allowed_mentions: { parse: [] }, embeds: [embed] })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
function hospitalChatWebhookUrl() {
  try {
    const url = new URL(String(process.env.DISCORD_HOSPITAL_CHAT_WEBHOOK || '').trim());
    return url.protocol === 'https:' && url.hostname === 'discord.com' && url.pathname.startsWith('/api/webhooks/') ? url.toString() : '';
  } catch {
    return '';
  }
}
function requiredHospitalChatWebhookUrl() {
  const url = hospitalChatWebhookUrl();
  if (!url) throw new Error('DISCORD_HOSPITAL_CHAT_WEBHOOK is missing or invalid');
  return url;
}
function formatAttendanceDate(dateKey) {
  const [year, month, day] = String(dateKey).split('-');
  return `${day}/${month}/${year}`;
}
export async function sendHospitalAttendanceWebhook({ requesterId, reviewer, dateKey, championId = '', championName = '', minutes = 0 }) {
  const url = hospitalChatWebhookUrl();
  if (!url) throw new Error('DISCORD_HOSPITAL_CHAT_WEBHOOK is missing or invalid');
  const date = formatAttendanceDate(dateKey);
  const users = [...new Set([requesterId, championId].filter(Boolean))];
  const champion = championId ? `<@${championId}>` : championName || '@Membru';
  const signature = `${String(reviewer?.[4] || '').trim() || 'H.R.'}, ${String(reviewer?.[3] || '').trim() || 'Echipa HR'}`;
  const content =
    `${HR_TEAM_EMOJI} De la: <@${requesterId}>\n` +
    `${HR_TEAM_EMOJI} Catre: <@&${HOSPITAL_CHAT_ROLE_ID}>\n\n` +
    `💌 Subiect: ✅ Pontajele din ${date} au fost actualizate!\n\n` +
    `🌟 Veste bună:\n` +
    `Pontajele din ${date} au fost trecute cu succes în Evidența Activității! Mulțumim tuturor pentru implicare și seriozitate. 👏🏿\n\n` +
    `🥇 Campionul zilei:\n` +
    `Cel mai mare pontaj aparține lui ${champion}, cu un total de ${minutes} minute.\n` +
    `Felicitări! 🔥 Efortul tău a ieșit în evidență!\n\n` +
    `🚀 Bravo tuturor!\n` +
    `Vă mulțumim că vă faceți timp să înregistrați pontajele. Sunteți o echipă pe cinste și dovediți asta în fiecare zi!\n\n` +
    `⏳ Nu ai apucat să faci pontaj?\n` +
    `Nu-i nimic! Poți recupera minutele oricând. Nu te descuraja, fiecare zi e o nouă șansă să adaugi activitate. 💪🏿\n\n` +
    `🔍 Ai observat vreo problemă?\n` +
    `Te rugăm să ne scrii direct în privat pentru o verificare rapidă.\n\n` +
    `📈 Verifică-ți pontajul [aici](https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=1043421534#gid=1043421534)\n` +
    `👉🏿 📊 Evidența Activitate\n\n` +
    `🖋️ Cu respect și apreciere,\n` +
    `🧑🏿‍⚕️ ${signature}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [], users, roles: [HOSPITAL_CHAT_ROLE_ID] }
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
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
      ...(typeof entry.cancelReason === 'string' ? { cancelReason: entry.cancelReason.slice(0, 500) } : {}),
      ...(entry.validated === true ? { validated: true } : {}),
      ...(entry.validatedAt != null && Number.isFinite(Date.parse(entry.validatedAt)) ? { validatedAt: entry.validatedAt } : {}),
      ...(typeof entry.validatedBy === 'string' ? { validatedBy: entry.validatedBy } : {}),
      ...(entry.autoClosed === true ? { autoClosed: true } : {}),
      ...(entry.edited === true ? { edited: true } : {}),
      ...(entry.editedAt != null && Number.isFinite(Number(entry.editedAt)) ? { editedAt: Number(entry.editedAt) } : {}),
      ...(typeof entry.editedBy === 'string' ? { editedBy: entry.editedBy } : {}),
      ...(typeof entry.editReason === 'string' ? { editReason: entry.editReason.slice(0, 500) } : {}),
      ...(entry.type === 'hr' || entry.type === 'pr' ? { type: entry.type } : {})
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
export function attendanceTimestampFor(dateKey, timeValue) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(timeValue || '').trim());
  if (!match || !validDateKey(dateKey)) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
  let timestamp = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = bucharestParts(timestamp);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), 0);
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
function isPastOrCurrentDate(dateKey, now = Date.now()) {
  return validDateKey(dateKey) && dateKey <= attendanceDateKey(now);
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
export function attendanceRoundedMinutesForDate(entries, dateKey, now = Date.now()) {
  if (!validDateKey(dateKey)) throw new Error('Data pontajului este invalidă.');
  const startOfDay = bucharestDayStart(dateKey);
  const endOfDay = bucharestDayStart(addDays(dateKey, 1));
  return cleanEntries(entries).reduce((total, entry) => {
    if (entry.canceled) return total;
    const start = Math.max(entry.start, startOfDay);
    const end = Math.min(entry.end == null ? now : entry.end, endOfDay);
    return end > start ? total + Math.round((end - start) / 300000) * 5 : total;
  }, 0);
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
function attendanceSheetColumnRange(column, startRow, endRow) { return `'${attendanceSheetTitle()}'!${column}${startRow}:${column}${endRow}`; }
function normalizedName(value) {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function attendanceCellUpdate(currentValue, minutes) {
  if (currentValue == null || ['', '-', '—'].includes(String(currentValue).trim())) return minutes;
  const current = String(currentValue).trim();
  const match = current.match(/^(\d+)([+*])$/);
  if (!match) return null;
  return `=${match[1]}${match[2]}${minutes}`;
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
  const cellRange = attendanceSheetCell(attendanceSheetDayColumn(dateKey), targetRows[0]);
  const cellResult = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: cellRange });
  const value = attendanceCellUpdate(cellResult.data.values?.[0]?.[0], minutes);
  if (value == null) return false;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: cellRange,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] }
  });
  return true;
}
export async function writeDepartmentAttendanceToSheet(sheets, members, entries, dateKey) {
  const [sourceResult, targetResult, callsignResult] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TEST_PONTAJE_RANGE }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: attendanceSheetNamesRange() }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${attendanceSheetTitle()}'!B1:B400` })
  ]);
  const sourceNames = new Set((sourceResult.data.values || []).map(row => normalizedName(row[0])).filter(Boolean));
  const targetRows = new Map();
  const callsigns = callsignResult.data.values || [];
  (targetResult.data.values || []).forEach((row, index) => {
    const name = normalizedName(row[0]);
    if (!name || !String(callsigns[index]?.[0] || '').trim()) return;
    if (targetRows.has(name)) targetRows.set(name, null);
    else targetRows.set(name, index + 1);
  });
  const dayColumn = attendanceSheetDayColumn(dateKey);
  const cellValues = (await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: attendanceSheetColumnRange(dayColumn, 1, 400)
  })).data.values || [];
  const membersByName = new Map(members.map(member => [normalizedName(member.name), member]));
  const targetNames = targetResult.data.values || [];
  const updates = [...targetRows].flatMap(([name, rowNumber]) => {
    const member = membersByName.get(name);
    if (rowNumber === null) {
      if (member && attendanceHasEntryOnDate(entries[member.discordId], dateKey)) throw new Error(`Numele ${member.name} apare de mai multe ori în EVIDENTA ACTIVITATE.`);
      return [];
    }
    const memberName = String(targetNames[rowNumber - 1]?.[0] || '').trim();
    const memberEntries = member ? entries[member.discordId] : [];
    const hasEntry = attendanceHasEntryOnDate(memberEntries, dateKey);
    if (hasEntry && !sourceNames.has(name)) throw new Error(`Persoana ${memberName} nu a fost găsită în fila TEST PONTAJE, coloana D.`);
    const minutes = hasEntry ? attendanceRoundedMinutesForDate(memberEntries, dateKey) : 0;
    const value = attendanceCellUpdate(cellValues[rowNumber - 1]?.[0], minutes);
    return value == null ? [] : [{ range: attendanceSheetCell(dayColumn, rowNumber), values: [[value]] }];
  });
  if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
  return updates;
}
async function claimAttendanceDocsSyncCooldown(requesterId) {
  const key = `site-testeri-medici:attendance-docs-sync:${requesterId}`;
  const claimed = await attendanceRedis.command('SET', key, String(Date.now()), 'NX', 'EX', String(ATTENDANCE_DOCS_SYNC_COOLDOWN_SECONDS));
  if (claimed === 'OK') return 0;
  const ttl = Number(await attendanceRedis.command('TTL', key));
  return ttl > 0 ? ttl : 1;
}
async function attendanceChampionFromSheet(sheets, members, dateKey) {
  const column = attendanceSheetDayColumn(dateKey);
  const [valuesResult, namesResult] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: attendanceSheetColumnRange(column, 11, 254)
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${attendanceSheetTitle()}'!D11:D254`
    })
  ]);
  const values = valuesResult.data.values || [];
  const names = namesResult.data.values || [];
  let maxMinutes = -1;
  let championId = '';
  let championName = '';
  values.forEach((row, index) => {
    const minutes = Number.parseFloat(row[0]);
    if (!Number.isFinite(minutes) || minutes <= maxMinutes) return;
    maxMinutes = minutes;
    const name = String(names[index]?.[0] || '').trim();
    const member = members.find(item => normalizedName(item[3]) === normalizedName(name));
    championId = String(member?.[19] || '').trim();
    championName = String(member?.[3] || name).trim();
  });
  return { championId, championName, minutes: maxMinutes };
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
    const functionOverrides = await readFunctionOverrides();
    const requesterFunctions = functionsForDepartmentRow(requester, functionOverrides);
    const requesterCallsign = callsignNumber(requester[2]);
    const canReviewAttendance = (requesterCallsign >= 1 && requesterCallsign <= 20) || canManageAttendance(requesterFunctions);
    const canViewAttendanceRooms = canReviewAttendance || (requesterCallsign >= 1 && requesterCallsign <= 650);
    const activeAttendanceView = req.method === 'GET' && req.query?.view === 'active';
    if (req.method === 'GET' && !canViewAttendanceRooms && req.query?.view !== 'own') return json(res, 403, { error: 'Only department members with callsigns 001-650 can view department attendance records' });
    const now = Date.now();
    const reviewDateKey = String(req.query?.date || attendanceDateKey(now));
    if (activeAttendanceView && !isPastOrCurrentDate(reviewDateKey, now)) return json(res, 400, { error: 'Alege o zi din trecut sau ziua curentă.' });
    if (!attendanceRedis.isConfigured) {
      if (req.method === 'GET')       return json(res, 200, { entries: canViewAttendanceRooms && req.query?.view !== 'own' ? {} : [], activeEntries: [], members: [], reviewStates: {}, configured: false });
      return json(res, 503, { error: 'Pontajele online nu sunt configurate.' });
    }
    if (req.method === 'GET' && req.query?.view === 'own') {
      const entries = closeExpiredAttendanceEntries(await readAttendanceData(requesterId), Date.now());
      if (entries.closed) await writeAttendanceData(requesterId, entries.entries);
      return json(res, 200, { entries: entries.entries, configured: true });
    }
    if (req.method === 'POST') {
      const action = req.body?.action;
      const now = Date.now();
      if (action === 'sync-docs' || action === 'sync-docs-all') {
        if (!canReviewAttendance) return json(res, 403, { error: 'Only callsigns 001-020 or H.R. can update attendance in Google Sheets' });
        const dateKey = String(req.body?.dateKey || '');
        if (!isCurrentWeekDate(dateKey, now)) return json(res, 400, { error: 'Alege o zi din săptămâna curentă.' });
        const cooldownSeconds = await claimAttendanceDocsSyncCooldown(requesterId);
        if (cooldownSeconds) return json(res, 429, {
          error: `Sincronizarea este în cooldown. Încearcă din nou peste ${cooldownSeconds} secunde.`,
          cooldownSeconds
        });
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
          const minutes = attendanceRoundedMinutesForDate(normalized.entries, dateKey, now);
          const sheets = await sheetsClient();
          const sheetUpdated = await writeAttendanceToSheet(sheets, String(target[3] || '').trim(), dateKey, minutes);
          const review = { status, minutes, updatedAt: new Date(now).toISOString(), updatedBy: requesterId };
          await attendanceRedis.setJson(attendanceReviewKey(dateKey, targetId), review, { expirationSeconds: 60 * 60 * 24 * 400 });
          let warning = '';
          if (sheetUpdated) {
            try {
              const champion = await attendanceChampionFromSheet(sheets, members, dateKey);
              await sendHospitalAttendanceWebhook({ requesterId, reviewer: members.find(row => String(row[19] || '').trim() === requesterId), dateKey, ...champion, minutes: Math.max(0, champion.minutes) });
            } catch (error) {
              console.error('Hospital attendance webhook failed:', error);
              warning = `Evidența a fost actualizată, dar mesajul nu a putut fi trimis în chatul spitalului: ${error.message}`;
            }
          }
          return json(res, 200, { success: true, review, sheetUpdated, warning, cooldownSeconds: ATTENDANCE_DOCS_SYNC_COOLDOWN_SECONDS });
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
        const updates = await writeDepartmentAttendanceToSheet(sheets, sheetMembers, departmentEntries, dateKey);
        let warning = '';
        if (updates.length) {
          try {
            const champion = await attendanceChampionFromSheet(sheets, members, dateKey);
            await sendHospitalAttendanceWebhook({ requesterId, reviewer: members.find(row => String(row[19] || '').trim() === requesterId), dateKey, ...champion, minutes: Math.max(0, champion.minutes) });
          } catch (error) {
            console.error('Hospital attendance webhook failed:', error);
            warning = `Evidența a fost actualizată, dar mesajul nu a putut fi trimis în chatul spitalului: ${error.message}`;
          }
        }
        return json(res, 200, { success: true, updated: updates.length, warning, cooldownSeconds: ATTENDANCE_DOCS_SYNC_COOLDOWN_SECONDS });
      }
      if (action === 'cancel') {
        const targetId = String(req.body?.targetDiscordId || '').trim();
        const isSelfCancellation = targetId === requesterId;
        if (!canReviewAttendance && !isSelfCancellation) return json(res, 403, { error: "Only callsigns 001-020 or H.R. can cancel another member's attendance records" });
        const reason = String(req.body?.reason || '').trim() || (isSelfCancellation ? 'Anulat de membru' : '');
        if (reason.length < 3) return json(res, 400, { error: 'Motivul anulării este obligatoriu.' });
        if (reason.length > 500) return json(res, 400, { error: 'Motivul anulării nu poate depăși 500 de caractere.' });
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
        open.cancelReason = reason;
        const saved = await writeAttendanceData(targetId, normalized.entries);
        const dateKey = attendanceDateKey(open.start);
        const savedEntry = saved.find(entry => entry.start === open.start) || open;
        const minutes = attendanceMinutesForDate([{ ...savedEntry, canceled: false }], dateKey, now);
        let warning = '';
        const reviewer = members.find(row => String(row[19] || '').trim() === requesterId);
        try {
          await sendAttendanceReviewWebhook({ status: 'canceled', reviewerId: requesterId, reviewer, targetId, target, entry: savedEntry, dateKey, minutes });
        } catch (error) {
          console.error('Attendance cancellation webhook failed:', error);
          warning = `Pontajul a fost anulat, dar notificarea Discord nu a putut fi trimisă: ${error.message}`;
        }
        return json(res, 200, { success: true, warning });
      }
      if (action === 'edit-entry') {
        if (!canReviewAttendance) return json(res, 403, { error: 'Only callsigns 001-020 or H.R. can edit attendance records' });
        const targetId = String(req.body?.targetDiscordId || '').trim();
        const entryStart = Number(req.body?.entryStart);
        const reason = String(req.body?.reason || '').trim();
        if (!Number.isFinite(entryStart)) return json(res, 400, { error: 'Pontajul selectat este invalid.' });
        if (reason.length < 3) return json(res, 400, { error: 'Motivul editării este obligatoriu.' });
        const target = members.find(row => String(row[19] || '').trim() === targetId);
        if (!targetId || !target) return json(res, 404, { error: 'Membrul pentru editarea pontajului nu a fost găsit.' });
        const normalized = closeExpiredAttendanceEntries(await readAttendanceData(targetId), now);
        const entry = normalized.entries.find(item => item.start === entryStart);
        if (!entry) return json(res, 404, { error: 'Pontajul selectat nu există.' });
        const dateKey = attendanceDateKey(entry.start);
        const newStart = attendanceTimestampFor(dateKey, req.body?.clockIn);
        const clockOut = String(req.body?.clockOut || '').trim();
        const newEnd = clockOut ? attendanceTimestampFor(dateKey, clockOut) : null;
        if (newStart == null || (clockOut && newEnd == null)) return json(res, 400, { error: 'Ora introdusă este invalidă.' });
        if (!clockOut && entry.end != null) return json(res, 400, { error: 'Clock-OUT este obligatoriu pentru un pontaj închis.' });
        if (newEnd != null && newEnd <= newStart) return json(res, 400, { error: 'Clock-OUT trebuie să fie după Clock-IN.' });
        if (newStart > now || (newEnd != null && newEnd > now)) return json(res, 400, { error: 'Ora nu poate fi în viitor.' });
        const overlaps = normalized.entries.some(item => item !== entry && !item.canceled && item.start < (newEnd ?? Infinity) && (item.end ?? Infinity) > newStart);
        if (overlaps) return json(res, 400, { error: 'Intervalul se suprapune cu alt pontaj al membrului.' });
        const before = { start: entry.start, end: entry.end };
        entry.start = newStart;
        entry.end = newEnd;
        delete entry.autoClosed;
        entry.edited = true;
        entry.editedAt = now;
        entry.editedBy = requesterId;
        entry.editReason = reason.slice(0, 500);
        const saved = await writeAttendanceData(targetId, normalized.entries);
        const savedEntry = saved.find(item => item.start === newStart);
        const minutes = attendanceMinutesForDate([{ ...(savedEntry || entry), canceled: false }], dateKey, now);
        let warning = '';
        const editor = members.find(row => String(row[19] || '').trim() === requesterId);
        try {
          await sendAttendanceEditWebhook({ editorId: requesterId, editor, targetId, target, before, entry: savedEntry || entry, dateKey, minutes, reason });
        } catch (error) {
          console.error('Attendance edit webhook failed:', error);
          warning = [warning, `Pontajul a fost salvat, dar notificarea Discord nu a putut fi trimisă: ${error.message}`].filter(Boolean).join(' ');
        }
        return json(res, 200, { success: true, entry: savedEntry, minutes, warning });
      }
      if (action === 'review-entry') {
        if (!canReviewAttendance) return json(res, 403, { error: 'Only callsigns 001-020 or H.R. can review attendance records' });
        const targetId = String(req.body?.targetDiscordId || '').trim();
        const entryStart = Number(req.body?.entryStart);
        const dateKey = String(req.body?.dateKey || '');
        const status = req.body?.status;
        const reason = String(req.body?.reason || '').trim();
        if (!Number.isFinite(entryStart)) return json(res, 400, { error: 'Pontajul selectat este invalid.' });
        if (!['validated', 'canceled', 'unreviewed'].includes(status)) return json(res, 400, { error: 'Starea pontajului este invalidă.' });
        if (status === 'canceled' && reason.length < 3) return json(res, 400, { error: 'Motivul anulării este obligatoriu.' });
        if (status === 'canceled' && reason.length > 500) return json(res, 400, { error: 'Motivul anulării nu poate depăși 500 de caractere.' });
        if (!isPastOrCurrentDate(dateKey, now)) return json(res, 400, { error: 'Alege o zi din trecut sau ziua curentă.' });
        const target = members.find(row => String(row[19] || '').trim() === targetId);
        if (!targetId || !target) return json(res, 404, { error: 'Membrul pentru actualizarea pontajului nu a fost găsit.' });
        const targetData = await readAttendanceData(targetId);
        const normalized = closeExpiredAttendanceEntries(targetData, now);
        const entry = normalized.entries.find(item => item.start === entryStart);
        if (!entry || !attendanceHasEntryOnDate([entry], dateKey)) return json(res, 404, { error: 'Pontajul selectat nu există în ziua aleasă.' });
        entry.canceled = status === 'canceled';
        entry.validated = status === 'validated';
        if (entry.canceled) {
          if (entry.end == null) entry.end = now;
          entry.canceledAt = now;
          entry.canceledBy = requesterId;
          entry.cancelReason = reason;
        } else {
          delete entry.canceledAt;
          delete entry.canceledBy;
          delete entry.cancelReason;
        }
        if (entry.validated) {
          entry.validatedAt = new Date(now).toISOString();
          entry.validatedBy = requesterId;
        } else {
          delete entry.validatedAt;
          delete entry.validatedBy;
        }
        const saved = await writeAttendanceData(targetId, normalized.entries);
        const savedEntry = saved.find(item => item.start === entryStart) || entry;
        const minutes = attendanceMinutesForDate([{ ...savedEntry, canceled: false }], dateKey, now);
        let warning = '';
        if (status !== 'unreviewed') {
          const reviewer = members.find(row => String(row[19] || '').trim() === requesterId);
          try {
            await sendAttendanceReviewWebhook({ status, reviewerId: requesterId, reviewer, targetId, target, entry: savedEntry, dateKey, minutes });
          } catch (error) {
            console.error('Attendance review webhook failed:', error);
            warning = `Pontajul a fost actualizat, dar notificarea Discord nu a putut fi trimisă: ${error.message}`;
          }
        }
        return json(res, 200, { success: true, entry: savedEntry, minutes, warning });
      }

      const data = await readAttendanceData(requesterId);
      const normalized = closeExpiredAttendanceEntries(data, now);
      if (normalized.closed) await writeAttendanceData(requesterId, normalized.entries);
      if (action === 'start') {
        const attendanceType = req.body?.attendanceType || 'regular';
        if (!['regular', 'hr'].includes(attendanceType)) return json(res, 400, { error: 'Tipul de pontaj este invalid.' });
        const allowedTypes = attendanceType === 'regular' ? ['regular'] : await allowedAttendanceTypesForMember(requesterId);
        if (!allowedTypes.includes(attendanceType)) return json(res, 403, { error: 'Nu ai funcția necesară pentru acest tip de pontaj.' });
        if (!attendanceStartAllowed(now)) return json(res, 409, { error: 'Pontajul nu mai poate fi deschis după ora 23:35.' });
        if (normalized.entries.some(entry => entry.end == null)) return json(res, 409, { error: 'Există deja un pontaj activ.' });
        normalized.entries.push({ start: now, end: null, ...(attendanceType !== 'regular' ? { type: attendanceType } : {}) });
      } else if (action === 'stop') {
        const attendanceType = req.body?.attendanceType || 'regular';
        if (!['regular', 'hr'].includes(attendanceType)) return json(res, 400, { error: 'Tipul de pontaj este invalid.' });
        const allowedTypes = attendanceType === 'regular' ? ['regular'] : await allowedAttendanceTypesForMember(requesterId);
        if (!allowedTypes.includes(attendanceType)) return json(res, 403, { error: 'Nu ai funcția necesară pentru acest tip de pontaj.' });
        const open = [...normalized.entries].reverse().find(entry => entry.end == null && attendanceTypeForEntry(entry) === attendanceType);
        if (!open) return json(res, 409, { error: 'Nu există un pontaj activ.' });
        open.end = now;
      } else return json(res, 400, { error: 'Acțiune invalidă' });
      const saved = await writeAttendanceData(requesterId, normalized.entries);
      return json(res, 200, { success: true, entries: saved });
    }

    if (!canReviewAttendance && !activeAttendanceView) {
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
