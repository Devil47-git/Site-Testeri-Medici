const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:E';
function normalize(value = '') { return String(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function callsignNumber(value = '') { return Number(String(value).replace(/\D/g, '')) || 0; }
function isLeadership(row) {
  const number = callsignNumber(row[2]); const rank = normalize(row[4]); const dept = normalize(row[5]);
  return (number >= 1 && number <= 15) || /DIRECTOR GENERAL|DIRECTOR ADJUNCT|MEDIC INSPECTOR|MEDIC CHIRURG/.test(`${rank} ${dept} ${row[10] || ''}`);
}
function readTests(value = '') { return String(value).split('|').filter(Boolean); }
function relevantMember(row) {
  const number = callsignNumber(row[2]);
  const functions = normalize(row[10]);
  if (!number || number > 399 || !String(row[3] || '').trim()) return false;
  if (number <= 15) return true;
  if (number >= 100 && number < 200) return Boolean(functions);
  if (number >= 200 && number < 300) return Boolean(functions);
  return number >= 300 && /TESTER/.test(functions);
}
function leadershipTitle(row) {
  const number = callsignNumber(row[2]);
  if (number === 1) return 'Director General';
  if (number >= 2 && number <= 4) return 'Director Adjunct';
  if (number >= 5 && number <= 8) return 'Medic Inspector';
  if (number >= 9 && number <= 15) return 'Medic Chirurg';
  return 'Conducere';
}
async function readPublic(range) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(key)}`);
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.values)) throw new Error('Google Sheets read failed');
  return data.values;
}
function json(res, status, body) { return res.status(status).json(body); }
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const requesterId = typeof req.query?.requesterId === 'string' ? req.query.requesterId.trim() : '';
  if (!requesterId) return json(res, 400, { error: 'Missing requesterId' });
  try {
    const members = (await readPublic(MEMBER_RANGE)).slice(1).filter(Array.isArray);
    const requester = members.find(row => String(row[19] || '').trim() === requesterId);
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    const grants = (await readPublic(GRANTS_RANGE).catch(() => [])).slice(1).filter(Array.isArray);
    const grantsByDiscord = new Map(grants.map(row => [String(row[0] || '').trim(), { grantedTests: readTests(row[2]), updatedAt: String(row[3] || '').trim(), lastSeen: String(row[4] || '').trim() }]));
    const result = members.filter(row => relevantMember(row) || isLeadership(row)).map(row => ({
      discordId: String(row[19] || '').trim(), name: String(row[3] || '').trim(), callsign: String(row[2] || '').trim(), csNum: callsignNumber(row[2]), rank: isLeadership(row) ? leadershipTitle(row) : String(row[4] || '').trim(), dept: String(row[5] || '').trim(), functions: String(row[10] || '').trim(), gradeGroup: callsignNumber(row[2]) < 16 ? 'Conducerea departamentului' : `${Math.floor(callsignNumber(row[2]) / 100) * 100}`,
      isLeadership: isLeadership(row), leadershipTitle: isLeadership(row) ? leadershipTitle(row) : '', grantedTests: grantsByDiscord.get(String(row[19] || '').trim())?.grantedTests || [], updatedAt: grantsByDiscord.get(String(row[19] || '').trim())?.updatedAt || '', lastSeen: grantsByDiscord.get(String(row[19] || '').trim())?.lastSeen || '', isTester: (callsignNumber(row[2]) >= 200 && callsignNumber(row[2]) < 300) || /TESTER/.test(normalize(row[10])) || grantsByDiscord.has(String(row[19] || '').trim())
    }));
    return json(res, 200, { members: result, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Department directory failed:', error);
    return json(res, 500, { error: 'Department directory unavailable' });
  }
}
