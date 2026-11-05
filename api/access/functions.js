import '../../lib/config.js';
import { callsignNumber, LEADERSHIP_MAX } from '../../lib/access/shared.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const FUNCTIONS_RANGE = 'MEMBER_FUNCTIONS!A1:D';
const FUNCTIONS_HEADER = ['discordId', 'callsign', 'functionIds', 'updatedAt'];

export const MEMBER_FUNCTIONS = Object.freeze([
  { id: 'coordonator-jaf', label: 'C.J.', description: 'Coordonator jaf' },
  { id: 'resurse-umane', label: 'H.R. / H.R. AV', description: 'Resurse umane' },
  { id: 'relatii-publice', label: 'P.R.', description: 'Relații cu publicul' },
  { id: 'instructor-pilot', label: 'PILOT / P', description: 'Instructor pilot' },
  { id: 'instructor-moto', label: 'MOTO / M', description: 'Instructor moto' },
  { id: 'instructor-smuls', label: 'S.M.U.L.S. / S', description: 'Instructor S.M.U.L.S.' },
  { id: 'instructor-als', label: 'A.L.S. / A', description: 'Instructor A.L.S.' },
  { id: 'consilier-psihologic', label: 'PH', description: 'Consilier psihologic' },
  { id: 'manager-hr', label: 'Manager H.R.', description: 'Manager H.R.' },
  { id: 'manager-pr', label: 'Manager P.R.', description: 'Manager P.R.' },
  { id: 'manager-ssmls-pcls', label: 'Manager S.S.M.L.S. - P.C.L.S.', description: 'Manager S.S.M.L.S. - P.C.L.S.' },
  { id: 'manager-mmls-pcls', label: 'Manager M.M.L.S. - P.C.L.S.', description: 'Manager M.M.L.S. - P.C.L.S.' },
  { id: 'manager-isuls-pcls', label: 'Manager I.S.U.L.S. - P.C.L.S.', description: 'Manager I.S.U.L.S. - P.C.L.S.' },
  { id: 'manager-dsls-pcls', label: 'Manager D.S.L.S. - P.C.L.S.', description: 'Manager D.S.L.S. - P.C.L.S.' },
  { id: 'manager-isuls-smuls', label: 'Manager I.S.U.L.S. | S.M.U.L.S.', description: 'Manager I.S.U.L.S. | S.M.U.L.S.' },
  { id: 'adjunct-pr', label: 'Adjunct P.R.', description: 'Adjunct P.R.' },
  { id: 'adjunct-ssmls-pcls', label: 'Adjunct S.S.M.L.S. - P.C.L.S.', description: 'Adjunct S.S.M.L.S. - P.C.L.S.' },
  { id: 'adjunct-mmls-pcls', label: 'Adjunct M.M.L.S. - P.C.L.S.', description: 'Adjunct M.M.L.S. - P.C.L.S.' },
  { id: 'adjunct-isuls-pcls', label: 'Adjunct I.S.U.L.S. - P.C.L.S.', description: 'Adjunct I.S.U.L.S. - P.C.L.S.' },
  { id: 'adjunct-dsls-pcls', label: 'Adjunct D.S.L.S. - P.C.L.S.', description: 'Adjunct D.S.L.S. - P.C.L.S.' },
  { id: 'adjunct-isuls-smuls', label: 'Adjunct I.S.U.L.S. | S.M.U.L.S.', description: 'Adjunct I.S.U.L.S. | S.M.U.L.S.' },
  { id: 'responsabil-testeri', label: 'Responsabil Testeri', description: 'Responsabil Testeri' },
  { id: 'responsabil-concedii', label: 'Responsabil Co (concedii)', description: 'Responsabil Co (concedii)' },
  { id: 'responsabil-sedinte', label: 'Responsabil Sedinte', description: 'Responsabil ședințe' }
]);

const FUNCTION_IDS = new Set(MEMBER_FUNCTIONS.map(item => item.id));

function json(res, status, body) { return res.status(status).json(body); }
export function normalizeFunctionIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string' && FUNCTION_IDS.has(id)))];
}
function serviceAccountConfigured() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Google Sheets service account is not configured');
  }
}
async function sheetsClient() {
  serviceAccountConfigured();
  const { google } = await import('googleapis');
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : undefined;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}
async function readPublicValues(range) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(key)}`);
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 400 && String(data?.error?.message || '').includes('Unable to parse range')) return [];
    throw new Error('Google Sheets read failed');
  }
  if (!Array.isArray(data.values)) throw new Error('Google Sheets response is invalid');
  return data.values;
}
async function readMemberRows(sheets) {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: MEMBER_RANGE });
  return Array.isArray(result.data.values) ? result.data.values : [];
}
function findMemberByDiscordId(rows, discordId) {
  return rows.slice(1).filter(Array.isArray).find(row => String(row[19] || '').trim() === discordId) || null;
}
async function ensureFunctionsSheet(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
  const exists = (spreadsheet.data.sheets || []).some(sheet => sheet.properties?.title === 'MEMBER_FUNCTIONS');
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'MEMBER_FUNCTIONS' } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'MEMBER_FUNCTIONS!A1:D1',
      valueInputOption: 'RAW',
      requestBody: { values: [FUNCTIONS_HEADER] }
    });
    return;
  }
  const header = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'MEMBER_FUNCTIONS!A1:D1' });
  if (String(header.data.values?.[0]?.[0] || '').trim() === FUNCTIONS_HEADER[0]) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'MEMBER_FUNCTIONS!A1:D1',
    valueInputOption: 'RAW',
    requestBody: { values: [FUNCTIONS_HEADER] }
  });
}
async function readFunctionRows(sheets) {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: FUNCTIONS_RANGE });
  return Array.isArray(result.data.values) ? result.data.values : [];
}
export async function saveFunctionAssignment(sheets, target, targetDiscordId, functionIds, updatedAt = new Date().toISOString()) {
  await ensureFunctionsSheet(sheets);
  const rows = await readFunctionRows(sheets);
  const hasHeader = String(rows[0]?.[0] || '').trim() === FUNCTIONS_HEADER[0];
  const body = hasHeader ? rows.slice(1) : rows;
  const rowIndex = body.findIndex(row => String(row?.[0] || '').trim() === targetDiscordId);
  const rowValues = [
    targetDiscordId,
    String(target[2] || '').trim(),
    normalizeFunctionIds(functionIds).join('|'),
    updatedAt
  ];
  if (rowIndex < 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: FUNCTIONS_RANGE,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowValues] }
    });
  } else {
    const sheetRowNumber = rowIndex + (hasHeader ? 2 : 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `MEMBER_FUNCTIONS!A${sheetRowNumber}:D${sheetRowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowValues] }
    });
  }
  return assignmentsFromRows([FUNCTIONS_HEADER, rowValues])[0];
}
function assignmentsFromRows(rows) {
  return rows.slice(1).filter(Array.isArray).flatMap(row => {
    const discordId = String(row[0] || '').trim();
    if (!discordId) return [];
    return [{
      discordId,
      callsign: String(row[1] || '').trim(),
      functionIds: normalizeFunctionIds(String(row[2] || '').split('|')),
      updatedAt: String(row[3] || '').trim()
    }];
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const requesterId = req.method === 'GET' ? req.query?.requesterId : req.body?.requesterId;
  if (typeof requesterId !== 'string' || !requesterId.trim()) return json(res, 400, { error: 'Missing requesterId' });

  try {
    if (req.method === 'GET') {
      const members = await readPublicValues(MEMBER_RANGE);
      const requester = findMemberByDiscordId(members, requesterId.trim());
      if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
      const rows = await readPublicValues(FUNCTIONS_RANGE);
      return json(res, 200, { catalog: MEMBER_FUNCTIONS, assignments: assignmentsFromRows(rows) });
    }

    const sheets = await sheetsClient();
    const members = await readMemberRows(sheets);
    const requester = findMemberByDiscordId(members, requesterId.trim());
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    const requesterCallsign = callsignNumber(requester[2]);
    if (requesterCallsign < 1 || requesterCallsign > LEADERSHIP_MAX) {
      return json(res, 403, { error: 'Only callsigns 001-020 can manage member functions' });
    }

    const targetDiscordId = typeof req.body?.targetDiscordId === 'string' ? req.body.targetDiscordId.trim() : '';
    if (!targetDiscordId) return json(res, 400, { error: 'Missing target member' });
    const target = findMemberByDiscordId(members, targetDiscordId);
    if (!target) return json(res, 404, { error: 'Target member not found' });
    if (!String(target[3] || '').trim()) return json(res, 422, { error: 'Target member has no name in column D' });
    if (!Array.isArray(req.body?.functionIds) || req.body.functionIds.some(id => typeof id !== 'string' || !FUNCTION_IDS.has(id))) {
      return json(res, 400, { error: 'Invalid member function selection' });
    }

    const assignment = await saveFunctionAssignment(sheets, target, targetDiscordId, req.body.functionIds);
    return json(res, 200, { success: true, assignment });
  } catch (error) {
    console.error('Member functions storage failed:', error);
    return json(res, 500, { error: `Member functions storage failed: ${String(error?.message || error).slice(0, 200)}` });
  }
}
