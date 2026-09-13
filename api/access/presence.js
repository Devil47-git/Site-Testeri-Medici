const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:E';
function json(res, status, body) { return res.status(status).json(body); }
function number(value = '') { return Number(String(value).replace(/\D/g, '')) || 0; }
async function client() {
  const { google } = await import('googleapis');
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : undefined;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const discordId = typeof req.body?.discordId === 'string' ? req.body.discordId.trim() : '';
    if (!discordId) return json(res, 400, { error: 'Missing Discord ID' });
    const sheets = await client();
    const members = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: MEMBER_RANGE })).data.values || [];
    const member = members.slice(1).find(row => String(row[19] || '').trim() === discordId);
    if (!member) return json(res, 403, { error: 'Member not found' });
    const values = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: GRANTS_RANGE })).data.values || [];
    const rows = values.slice(1).filter(Array.isArray).map(row => [...row]);
    const index = rows.findIndex(row => String(row[0] || '').trim() === discordId);
    const now = new Date().toISOString();
    if (index === -1) rows.push([discordId, String(member[2] || '').trim(), '', now]);
    else rows[index][4] = now;
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: GRANTS_RANGE, valueInputOption: 'RAW', requestBody: { values: [['discordId', 'callsign', 'grantedTests', 'updatedAt', 'lastSeen'], ...rows] } });
    return json(res, 200, { success: true, lastSeen: now });
  } catch (error) {
    console.error('Presence update failed:', error);
    return json(res, 500, { error: 'Presence update failed' });
  }
}
