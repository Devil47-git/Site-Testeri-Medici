const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:D';
const catalog = ['Test admitere', 'Test transfer', 'Adeverință medicală', 'Test SMULS', 'Test MOTO', 'Test ALS', 'Test PILOT', 'Test parașutiști'];

function normalize(value = '') { return String(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function callsignNumber(value = '') { return Number(String(value).replace(/\D/g, '')) || 0; }
function isLeadership(row) {
  const callsign = callsignNumber(row[2]);
  const rank = normalize(row[4]);
  const dept = normalize(row[5]);
  return (callsign >= 1 && callsign <= 15) || ['DIRECTOR', 'INSPECTOR', 'CONDUCERE', 'MANAGER', 'COORDONATOR'].some(value => rank.includes(value)) || ['CONDUCERE', 'MEDICAL'].some(value => dept.includes(value));
}
function normalizeTests(tests) { return [...new Set((Array.isArray(tests) ? tests : []).filter(test => catalog.includes(test)))]; }
function authConfig() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Google Sheets service account is not configured');
}
async function sheetsClient() {
  authConfig();
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}
async function readValues(sheets, range) {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  return Array.isArray(result.data.values) ? result.data.values : [];
}
async function findMember(sheets, discordId) {
  const rows = (await readValues(sheets, MEMBER_RANGE)).slice(1).filter(Array.isArray);
  return rows.find(row => String(row[19] || '').trim() === String(discordId).trim()) || null;
}
async function readGrants(sheets) {
  const rows = await readValues(sheets, GRANTS_RANGE);
  return rows.slice(1).filter(Array.isArray).map(row => ({ discordId: String(row[0] || '').trim(), callsign: String(row[1] || '').trim(), grantedTests: normalizeTests(String(row[2] || '').split('|')), updatedAt: String(row[3] || '').trim() }));
}
async function writeGrants(sheets, grants) {
  const values = [['discordId', 'callsign', 'grantedTests', 'updatedAt'], ...grants.map(grant => [grant.discordId, grant.callsign, normalizeTests(grant.grantedTests).join('|'), grant.updatedAt])];
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: GRANTS_RANGE });
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: GRANTS_RANGE, valueInputOption: 'RAW', requestBody: { values } });
}
function json(res, status, body) { return res.status(status).json(body); }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const requesterId = req.method === 'GET' ? req.query?.requesterId : req.body?.requesterId;
    if (typeof requesterId !== 'string' || !requesterId.trim()) return json(res, 400, { error: 'Missing requesterId' });
    const sheets = await sheetsClient();
    const requester = await findMember(sheets, requesterId);
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    if (!isLeadership(requester)) return json(res, 403, { error: 'Only leadership can manage grants' });
    const grants = await readGrants(sheets);
    if (req.method === 'GET') return json(res, 200, { grants });
    const targetId = typeof req.body?.targetDiscordId === 'string' ? req.body.targetDiscordId.trim() : '';
    const targetCallsign = typeof req.body?.callsign === 'string' ? req.body.callsign.trim() : '';
    if (!targetId && !targetCallsign) return json(res, 400, { error: 'Missing target member' });
    const target = targetId ? await findMember(sheets, targetId) : (await readValues(sheets, MEMBER_RANGE)).slice(1).filter(Array.isArray).find(row => callsignNumber(row[2]) === callsignNumber(targetCallsign));
    if (!target) return json(res, 404, { error: 'Target member not found' });
    const targetDiscordId = String(target[19] || '').trim();
    const updated = { discordId: targetDiscordId, callsign: String(target[2] || targetCallsign).trim(), grantedTests: normalizeTests(req.body.grantedTests), updatedAt: new Date().toISOString() };
    const next = [...grants.filter(grant => grant.discordId !== targetDiscordId), updated];
    await writeGrants(sheets, next);
    return json(res, 200, { success: true, grant: updated });
  } catch (error) {
    console.error('Grant storage failed:', error);
    return json(res, 500, { error: 'Grant storage failed' });
  }
}
