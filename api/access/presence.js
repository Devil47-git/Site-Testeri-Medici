import '../../lib/config.js';
const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:F';
const GRANTS_HEADER = ['discordId', 'callsign', 'grantedTests', 'updatedAt', 'lastSeen', 'grantMode'];
function json(res, status, body) { return res.status(status).json(body); }

function grantsSheetTitle() {
  return GRANTS_RANGE.split('!')[0].replace(/^'|'$/g, '').replace(/'/g, "''");
}

export function presenceWritePlan(rows, discordId, callsign, timestamp, range = GRANTS_RANGE) {
  const title = range.split('!')[0].replace(/^'|'$/g, '').replace(/'/g, "''");
  const hasHeader = String(rows[0]?.[0] || '').trim() === GRANTS_HEADER[0];
  if (rows.length && !hasHeader) throw new Error('The grants sheet is missing its header row');

  const existingIndex = rows.slice(1).findIndex(row => String(row?.[0] || '').trim() === discordId);
  if (existingIndex >= 0) {
    return { type: 'update', range: `'${title}'!E${existingIndex + 2}`, values: [[timestamp]] };
  }
  return {
    type: 'append',
    range: `'${title}'!A1:F`,
    values: [[discordId, callsign, '', '', timestamp, '']]
  };
}

async function client() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Google Sheets service account is not configured');
  }
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
    const memberResult = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: MEMBER_RANGE });
    const members = memberResult.data.values || [];
    const member = members.slice(1).find(row => String(row[19] || '').trim() === discordId);
    if (!member) return json(res, 403, { error: 'Member not found' });
    const grantsResult = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: GRANTS_RANGE });
    const rows = Array.isArray(grantsResult.data.values) ? grantsResult.data.values : [];
    if (rows.length && String(rows[0]?.[0] || '').trim() !== GRANTS_HEADER[0]) {
      throw new Error('The grants sheet is missing its header row');
    }
    if (!rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${grantsSheetTitle()}'!A1:F1`,
        valueInputOption: 'RAW',
        requestBody: { values: [GRANTS_HEADER] }
      });
    } else if (GRANTS_HEADER.some((header, index) => String(rows[0]?.[index] || '').trim() !== header)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${grantsSheetTitle()}'!A1:F1`,
        valueInputOption: 'RAW',
        requestBody: { values: [GRANTS_HEADER] }
      });
    }
    const now = new Date().toISOString();
    const plan = presenceWritePlan(rows, discordId, String(member[2] || '').trim(), now);
    if (plan.type === 'update') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: plan.range,
        valueInputOption: 'RAW',
        requestBody: { values: plan.values }
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: plan.range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: plan.values }
      });
    }
    return json(res, 200, { success: true, lastSeen: now });
  } catch (error) {
    console.error('Presence update failed:', error);
    return json(res, 500, { error: 'Presence update failed' });
  }
}
