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
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : undefined;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}
function grantsSheetTitle() { return GRANTS_RANGE.split('!')[0].replace(/^'|'$/g, '') || 'GRANTS'; }
async function ensureGrantsSheet(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
  const exists = (spreadsheet.data.sheets || []).some(sheet => sheet.properties?.title === grantsSheetTitle());
  if (!exists) {
    const request = {};
    request.addSheet = {};
    request.addSheet.properties = {};
    request.addSheet.properties.title = grantsSheetTitle();
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [request] } });
  }
}
async function readValues(sheets, range) {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  return Array.isArray(result.data.values) ? result.data.values : [];
}
async function readPublicValues(range) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(key)}`);
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.values)) throw new Error('Google Sheets read failed');
  return data.values;
}
async function findMember(sheets, discordId) {
  const rows = (await readValues(sheets, MEMBER_RANGE)).slice(1).filter(Array.isArray);
  return rows.find(row => String(row[19] || '').trim() === String(discordId).trim()) || null;
}
async function readGrants(sheets) {
  try {
    await ensureGrantsSheet(sheets);
    const rows = await readValues(sheets, GRANTS_RANGE);
    return rows.slice(1).filter(Array.isArray).map(row => ({ discordId: String(row[0] || '').trim(), callsign: String(row[1] || '').trim(), grantedTests: normalizeTests(String(row[2] || '').split('|')), updatedAt: String(row[3] || '').trim() }));
  } catch (error) {
    if (String(error.message || '').includes('Unable to parse range')) return [];
    throw error;
  }
}
async function writeGrants(sheets, grants) {
  await ensureGrantsSheet(sheets);
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
    if (req.method === 'GET') {
      const memberRows = (await readPublicValues(MEMBER_RANGE)).slice(1).filter(Array.isArray);
      const requester = memberRows.find(row => String(row[19] || '').trim() === requesterId.trim());
      if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
      const grantRows = (await readPublicValues(GRANTS_RANGE).catch(() => [])).slice(1).filter(Array.isArray);
      const grants = grantRows.map(row => ({ discordId: String(row[0] || '').trim(), callsign: String(row[1] || '').trim(), grantedTests: normalizeTests(String(row[2] || '').split('|')), updatedAt: String(row[3] || '').trim() }));
      const visibleGrants = isLeadership(requester) ? grants : grants.filter(grant => grant.discordId === requesterId.trim());
      return json(res, 200, { grants: visibleGrants });
    }
    const sheets = await sheetsClient();
    const requester = await findMember(sheets, requesterId);
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    if (!isLeadership(requester)) return json(res, 403, { error: 'Only leadership can manage grants' });
    const grants = await readGrants(sheets);
    const targetId = typeof req.body?.targetDiscordId === 'string' ? req.body.targetDiscordId.trim() : '';
    const targetCallsign = typeof req.body?.callsign === 'string' ? req.body.callsign.trim() : '';
    if (!targetId && !targetCallsign) return json(res, 400, { error: 'Missing target member' });
    const target = targetId ? await findMember(sheets, targetId) : (await readValues(sheets, MEMBER_RANGE)).slice(1).filter(Array.isArray).find(row => callsignNumber(row[2]) === callsignNumber(targetCallsign));
    if (!target) return json(res, 404, { error: 'Target member not found' });
    if (!String(target[19] || '').trim()) return json(res, 422, { error: 'Target member has no Discord ID in column T' });
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
