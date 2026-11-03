import '../../lib/config.js';
import { callsignNumber } from '../../lib/access/shared.js';
import { UpstashRedis } from '../../lib/storage/upstash-redis.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:U400';
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
    .filter(entry => Number.isFinite(Number(entry?.start)) && (!entry.end || Number.isFinite(Number(entry.end))))
    .map(entry => ({ start: Number(entry.start), end: entry.end ? Number(entry.end) : null }))
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const requesterId = String(req.method === 'GET' ? req.query?.requesterId : req.body?.requesterId || '').trim();
  if (!requesterId) return json(res, 400, { error: 'Missing requesterId' });
  try {
    const members = await readMembers();
    const requester = members.find(row => String(row[19] || '').trim() === requesterId);
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    const requesterCallsign = callsignNumber(requester[2]);
    const isLeadership = requesterCallsign >= 1 && requesterCallsign <= 20;
    if (req.method === 'GET' && !isLeadership) return json(res, 403, { error: 'Only callsigns 001-020 can view attendance records' });
    if (!attendanceRedis.isConfigured) {
      if (req.method === 'GET') return json(res, 200, { entries: isLeadership && req.query?.view !== 'own' ? {} : [], configured: false });
      return json(res, 503, { error: 'Pontajele online nu sunt configurate.' });
    }
    if (req.method === 'POST') {
      const action = req.body?.action;
      const ownData = await readAttendanceData(requesterId);
      if (action === 'start') {
        if (ownData.some(entry => !entry.end)) return json(res, 409, { error: 'Există deja un pontaj activ.' });
        ownData.push({ start: Date.now(), end: null });
      } else if (action === 'stop') {
        const open = [...ownData].reverse().find(entry => !entry.end);
        if (!open) return json(res, 409, { error: 'Nu există un pontaj activ.' });
        open.end = Date.now();
      } else return json(res, 400, { error: 'Acțiune invalidă' });
      const saved = await writeAttendanceData(requesterId, ownData);
      return json(res, 200, { success: true, entries: saved });
    }
    if (!isLeadership || req.query?.view === 'own') {
      const ownData = await readAttendanceData(requesterId);
      return json(res, 200, { entries: ownData, configured: true });
    }
    const ids = members.map(row => String(row[19] || '').trim());
    const values = await attendanceRedis.pipeline(ids.map(id => ['GET', redisKey(id)]));
    const entries = {};
    values.forEach((value, index) => {
      entries[ids[index]] = cleanEntries(value ? JSON.parse(value) : []);
    });
    return json(res, 200, { entries, configured: true });
  } catch (error) {
    console.error('Attendance records failed:', error);
    return json(res, 500, { error: 'Pontajele nu au putut fi încărcate.' });
  }
}
