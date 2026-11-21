import '../../../lib/config.js';
import { requireRequester } from '../../../lib/request-auth.js';
import { sameOrigin } from '../../../lib/http.js';
import { SupabaseKV } from '../../../lib/storage/supabase-kv.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:U1000';
const LEAVE_KEY = 'medici-leave-records-v1';
const kv = new SupabaseKV();

function json(res, status, body) { return res.status(status).json(body); }
function callsignNumber(value) {
  const number = Number(String(value || '').replace(/\D/g, ''));
  return Number.isFinite(number) ? number : 0;
}
async function readRows() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MEMBER_RANGE)}?key=${encodeURIComponent(key)}`);
  const payload = await response.json();
  if (!response.ok || !Array.isArray(payload.values)) throw new Error('Google Sheets read failed');
  return payload.values;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed' });
  if (req.method === 'PUT' && !sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request rejected' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const requesterId = req.method === 'GET'
    ? String(req.query?.requesterId || '').trim()
    : String(body.requesterId || '').trim();
  if (!requesterId) return json(res, 400, { error: 'Missing requesterId' });
  const authenticatedId = requireRequester(req, res, requesterId);
  if (!authenticatedId) return;

  try {
    const rows = await readRows();
    const members = rows.slice(1).filter(Array.isArray);
    const requester = members.find(row => String(row[19] || '').trim() === authenticatedId);
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    if (req.method === 'GET' && callsignNumber(requester[2]) >= 1 && callsignNumber(requester[2]) <= 20) {
      let records = [];
      if (kv.isConfigured) records = await kv.getJson(LEAVE_KEY).catch(() => null);
      records = Array.isArray(records) ? records : [];
      const membersById = new Map(members.map(row => [String(row[19] || '').trim(), row]));
      const safeRecords = records.map(record => {
        const targetRow = membersById.get(String(record.memberId || record.discordId || '')) || members.find(row => String(row[2] || '').trim() === String(record.memberId || ''));
        return targetRow ? {
          memberId: String(targetRow[19] || targetRow[2] || '').trim(),
          callsign: String(targetRow[2] || '').trim(),
          name: String(targetRow[3] || '').trim(),
          date: String(record.date || ''),
          type: record.type === 'civil' ? 'civil' : 'normal'
        } : null;
      }).filter(Boolean);
      return json(res, 200, { records: safeRecords });
    }
    if (req.method === 'GET') return json(res, 403, { error: 'Only leadership callsigns 001-020 can view leave records' });

    const requesterCallsign = callsignNumber(requester[2]);
    if (requesterCallsign < 1 || requesterCallsign > 20) return json(res, 403, { error: 'Only leadership callsigns 001-020 can manage leave records' });
    const memberId = String(body.memberId || '').trim();
    const date = String(body.date || '').trim();
    const type = String(body.type || '').trim();
    if (!memberId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Invalid leave record' });
    const targetRow = members.find(row => String(row[19] || '').trim() === memberId || String(row[2] || '').trim() === memberId);
    if (!targetRow) return json(res, 404, { error: 'Member not found' });
    const targetId = String(targetRow[19] || targetRow[2] || '').trim();
    let records = kv.isConfigured ? await kv.getJson(LEAVE_KEY).catch(() => null) : [];
    records = Array.isArray(records) ? records : [];
    records = records.filter(record => !(String(record.memberId || record.discordId || '') === targetId && String(record.date || '') === date));
    if (type === 'normal' || type === 'civil') {
      records.push({ memberId: targetId, date, type, updatedBy: authenticatedId, updatedAt: new Date().toISOString() });
    }
    if (kv.isConfigured) await kv.setJson(LEAVE_KEY, records);
    const safeRecords = records.map(record => {
      const target = members.find(row => String(row[19] || '').trim() === String(record.memberId || ''));
      return target ? { memberId: String(target[19] || target[2] || '').trim(), callsign: String(target[2] || '').trim(), name: String(target[3] || '').trim(), date: String(record.date || ''), type: record.type === 'civil' ? 'civil' : 'normal' } : null;
    }).filter(Boolean);
    return json(res, 200, { records: safeRecords });
  } catch (error) {
    console.error('Leave records request failed:', error);
    return json(res, 500, { error: 'Leave records unavailable' });
  }
}
