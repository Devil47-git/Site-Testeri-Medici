import { catalog, isLeadershipRow, normalizeTests, specializationFor } from './shared.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:E';
const RESULTS_RANGE = process.env.GOOGLE_TEST_RESULTS_RANGE || 'TEST_HISTORY!A1:E';
const RESULTS_HEADER = ['discordId', 'callsign', 'testName', 'result', 'createdAt'];

function json(res, status, body) { return res.status(status).json(body); }

async function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Google Sheets service account is not configured');
  }
  const { google } = await import('googleapis');
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : undefined;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

function sheetTitle() { return RESULTS_RANGE.split('!')[0].replace(/^'|'$/g, ''); }

async function ensureResultsSheet(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
  if ((spreadsheet.data.sheets || []).some(sheet => sheet.properties?.title === sheetTitle())) return;
  const request = { addSheet: { properties: { title: sheetTitle() } } };
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [request] } });
}

async function readValues(sheets, range) {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  return Array.isArray(result.data.values) ? result.data.values : [];
}

async function ensureResultsHeader(sheets) {
  await ensureResultsSheet(sheets);
  const rows = await readValues(sheets, RESULTS_RANGE);
  if (!rows.length) {
    const range = RESULTS_RANGE.split('!')[0] + '!A1:E1';
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range, valueInputOption: 'RAW', requestBody: { values: [RESULTS_HEADER] } });
    return [RESULTS_HEADER];
  }
  return rows;
}

async function findRequester(sheets, discordId) {
  const members = await readValues(sheets, MEMBER_RANGE);
  return members.slice(1).find(row => String(row[19] || '').trim() === discordId) || null;
}

async function canRecordTest(sheets, member, discordId, testName) {
  if (isLeadershipRow(member)) return true;
  if (specializationFor(member[10]).includes(testName)) return true;
  const grants = (await readValues(sheets, GRANTS_RANGE).catch(() => [])).slice(1);
  const grant = grants.find(row => String(row[0] || '').trim() === discordId);
  return normalizeTests(String(grant?.[2] || '').split('|')).includes(testName);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const requesterId = req.method === 'GET' ? req.query?.requesterId : req.body?.requesterId;
  const discordId = typeof requesterId === 'string' ? requesterId.trim() : '';
  if (!discordId) return json(res, 400, { error: 'Missing requesterId' });

  try {
    const sheets = await sheetsClient();
    const member = await findRequester(sheets, discordId);
    if (!member) return json(res, 403, { error: 'Requester is not a department member' });

    if (req.method === 'POST') {
      const testName = String(req.body?.testName || '').trim();
      if (!catalog.includes(testName)) return json(res, 400, { error: 'Unknown test' });
      if (!await canRecordTest(sheets, member, discordId, testName)) return json(res, 403, { error: 'This test is not assigned to the requester' });
      await ensureResultsHeader(sheets);
      const title = sheetTitle().replace(/'/g, "''");
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `'${title}'!A1:E`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[discordId, String(member[2] || '').trim(), testName, String(req.body?.result || '').slice(0, 32), new Date().toISOString()]] }
      });
      return json(res, 200, { success: true });
    }

    const rows = await ensureResultsHeader(sheets);
    const counts = new Map();
    for (const row of rows.slice(1)) {
      const id = String(row[0] || '').trim();
      const testName = String(row[2] || '').trim();
      if (!id || !catalog.includes(testName)) continue;
      const key = `${id}\u0000${testName}`;
      const count = counts.get(key) || { discordId: id, callsign: String(row[1] || '').trim(), testName, count: 0 };
      count.count += 1;
      counts.set(key, count);
    }
    return json(res, 200, { counts: [...counts.values()] });
  } catch (error) {
    console.error('Test history failed:', error);
    return json(res, 500, { error: 'Test history unavailable' });
  }
}