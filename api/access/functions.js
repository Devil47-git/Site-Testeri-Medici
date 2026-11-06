import '../../lib/config.js';
import { attendanceTypesForFunctions, callsignNumber, LEADERSHIP_MAX, normalize } from '../../lib/access/shared.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const COMPOUND_FUNCTION_LABELS = [
  'Manager I.S.U.L.S. | S.M.U.L.S.',
  'Adjunct I.S.U.L.S. | S.M.U.L.S.'
];

function json(res, status, body) { return res.status(status).json(body); }
function validMemberFunctionLabel(value) {
  const label = String(value || '').trim();
  return Boolean(label && label.length <= 120 && !/[\r\n]/.test(label) && (!label.includes('|') || COMPOUND_FUNCTION_LABELS.some(item => normalize(item) === normalize(label))));
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
export function memberFunctionLabels(value = '') {
  let protectedValue = String(value);
  COMPOUND_FUNCTION_LABELS.forEach((label, index) => {
    protectedValue = protectedValue.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `\uE000${index}\uE001`);
  });
  return [...new Map(protectedValue.split('|')
    .map(label => label.replace(/\uE000(\d+)\uE001/g, (_, index) => COMPOUND_FUNCTION_LABELS[Number(index)]))
    .map(label => label.trim())
    .filter(Boolean)
    .map(label => [normalize(label), label])).values()];
}
export function memberFunctionsDirectory(rows) {
  const catalog = new Map();
  const memberRows = (Array.isArray(rows) ? rows.slice(1) : []).filter(Array.isArray);
  for (const row of memberRows) {
    for (const label of memberFunctionLabels(row[10] || '')) if (!catalog.has(normalize(label))) {
      catalog.set(normalize(label), { id: label, label, description: label });
    }
  }
  const assignments = [];
  for (const row of memberRows) {
    const functionIds = memberFunctionLabels(row[10] || '').map(label => catalog.get(normalize(label)).id);
    const discordId = String(row[19] || '').trim();
    if (String(row[3] || '').trim()) assignments.push({
      discordId,
      callsign: String(row[2] || '').trim(),
      functionIds,
      attendanceTypes: attendanceTypesForFunctions(functionIds.join('|'))
    });
  }
  return { catalog: [...catalog.values()], assignments };
}
export function normalizeMemberFunctionLabels(values) {
  if (!Array.isArray(values)) return [];
  const labels = new Map();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const label = value.trim();
    if (!validMemberFunctionLabel(label)) continue;
    if (!labels.has(normalize(label))) labels.set(normalize(label), label);
  }
  return [...labels.values()];
}
export async function saveDepartmentFunctionAssignment(sheets, members, targetDiscordId, functionValues, updatedAt = new Date().toISOString()) {
  const targetIndex = members.findIndex((row, index) => index > 0 && String(row?.[19] || '').trim() === targetDiscordId);
  if (targetIndex < 1) throw new Error('Target member not found');
  const functionIds = normalizeMemberFunctionLabels(functionValues);
  const sheetTitle = MEMBER_RANGE.split('!')[0].replace(/^'|'$/g, '').replace(/'/g, "''");
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${sheetTitle}'!K${targetIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[functionIds.join(' | ')]] }
  });
  return {
    discordId: targetDiscordId,
    callsign: String(members[targetIndex]?.[2] || '').trim(),
    functionIds,
    attendanceTypes: attendanceTypesForFunctions(functionIds.join('|')),
    updatedAt
  };
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
      return json(res, 200, memberFunctionsDirectory(members));
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
    if (!Array.isArray(req.body?.functionIds) || req.body.functionIds.some(id => typeof id !== 'string' || !validMemberFunctionLabel(id))) {
      return json(res, 400, { error: 'Invalid member function selection' });
    }

    const assignment = await saveDepartmentFunctionAssignment(sheets, members, targetDiscordId, req.body.functionIds);
    return json(res, 200, { success: true, assignment });
  } catch (error) {
    console.error('Member functions storage failed:', error);
    return json(res, 500, { error: `Member functions storage failed: ${String(error?.message || error).slice(0, 200)}` });
  }
}
