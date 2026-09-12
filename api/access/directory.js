const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:D';
function normalize(value = '') { return String(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function callsignNumber(value = '') { return Number(String(value).replace(/\D/g, '')) || 0; }
function isLeadership(row) {
  const number = callsignNumber(row[2]); const rank = normalize(row[4]); const dept = normalize(row[5]);
  return (number >= 1 && number <= 15) || ['DIRECTOR', 'INSPECTOR', 'CONDUCERE', 'MANAGER', 'COORDONATOR'].some(value => rank.includes(value)) || ['CONDUCERE', 'MEDICAL'].some(value => dept.includes(value));
}
function readTests(value = '') { return String(value).split('|').filter(Boolean); }
function specialtyTests(functions = '') { const value = normalize(functions); return ['Test ALS','Test SMULS','Test MOTO','Test PILOT','Test parașutiști'].filter(test => value.includes(normalize(test.replace('Test ', ''))) || (test === 'Test parașutiști' && value.includes('PARA'))); }
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
    const grantsByDiscord = new Map(grants.map(row => [String(row[0] || '').trim(), readTests(row[2])]));
    const result = members.filter(row => String(row[3] || '').trim()).map(row => ({
      discordId: String(row[19] || '').trim(), name: String(row[3] || '').trim(), callsign: String(row[2] || '').trim(), csNum: callsignNumber(row[2]), rank: String(row[4] || '').trim(), dept: String(row[5] || '').trim(), functions: String(row[10] || '').trim(), gradeGroup: callsignNumber(row[2]) < 16 ? 'Conducerea departamentului' : `${Math.max(100, Math.floor(callsignNumber(row[2]) / 100) * 100)}`,
      isLeadership: isLeadership(row), grantedTests: [...new Set([...specialtyTests(row[10]), ...(grantsByDiscord.get(String(row[19] || '').trim()) || [])])], isTester: /TESTER/.test(normalize(row[10])) || callsignNumber(row[2]) >= 200 || grantsByDiscord.has(String(row[19] || '').trim())
    }));
    return json(res, 200, { members: result, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Department directory failed:', error);
    return json(res, 500, { error: 'Department directory unavailable' });
  }
}
