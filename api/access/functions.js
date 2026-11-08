import '../../lib/config.js';
import { attendanceTypesForFunctions, callsignNumber, LEADERSHIP_MAX, normalize, STAFF_FUNCTION_LABELS } from '../../lib/access/shared.js';
import { functionOverridesConfigured, readFunctionOverrides, removeFunctionOverride, saveFunctionOverride } from '../../lib/access/function-overrides.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const COMPOUND_FUNCTION_LABELS = [
  'Manager I.S.U.L.S. | S.M.U.L.S.',
  'Adjunct I.S.U.L.S. | S.M.U.L.S.'
];
const RENAMED_FUNCTIONS = new Map([
  ['ADJUNCTISULS', 'Adjunct I.S.U.L.S. | S.M.U.L.S.'],
  ['ADJUNCTISULSPCLS', 'Adjunct I.S.U.L.S. | S.M.U.L.S.'],
  ['MANAGERDSLS', 'Manager D.S.L.S. - P.C.L.S.'],
  ['ADJUNCTMMLS', 'Adjunct M.M.L.S. - P.C.L.S.']
]);
const HIDDEN_FUNCTIONS = new Set([
  'COORDONATORJAF',
  'RESURSEUMANE',
  'RELATIICUPUBLICUL',
  'MEMBRUALDEPARTAMENTULUISPECIALISULS',
  'INSTRUCTORPILOT',
  'INSTRUCTORMOTO',
  'INSTRUCTORSMULS',
  'INSTRUCTORALS',
  'CONSILIERPSIHOLOGIC'
]);

function json(res, status, body) { return res.status(status).json(body); }
function functionKey(value) { return normalize(value).replace(/[^A-Z0-9]/g, ''); }
function canonicalFunctionLabel(value) {
  const label = String(value || '').trim();
  return RENAMED_FUNCTIONS.get(functionKey(label)) || label;
}
function isHiddenFunction(value) {
  const label = normalize(value).replace(/\s/g, '');
  return label === 'PR' || HIDDEN_FUNCTIONS.has(functionKey(value));
}
function functionOrder(label) {
  const key = functionKey(label);
  if (/SEF|DIRECTOR|ADJUNCT|MANAGER/.test(key)) return 0;
  if (/\bHR\b/.test(normalize(label)) || key.includes('HR')) return 1;
  if (key === 'PR' || key.startsWith('PR')) return 2;
  if (/TESTER|SMULS|ISULS|MOTO|PILOT|ALS|PARASUT|BLS/.test(key)) return 3;
  if (key === 'PH' || key.startsWith('PH')) return 4;
  if (key === 'CJ' || key.startsWith('CJ')) return 5;
  return 6;
}
function sortFunctionCatalog(items) {
  return items.sort((first, second) => functionOrder(first.label) - functionOrder(second.label));
}
function validMemberFunctionLabel(value) {
  const label = String(value || '').trim();
  return Boolean(label && label.length <= 120 && !/[\r\n]/.test(label) && (!label.includes('|') || COMPOUND_FUNCTION_LABELS.some(item => normalize(item) === normalize(label))));
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
    .map(canonicalFunctionLabel)
    .filter(label => label && !isHiddenFunction(label))
    .map(label => [normalize(label), label])).values()];
}
export function memberFunctionsDirectory(rows, overrides = new Map()) {
  const catalog = new Map();
  for (const label of STAFF_FUNCTION_LABELS) catalog.set(normalize(label), { id: label, label, description: label });
  const memberRows = (Array.isArray(rows) ? rows.slice(1) : []).filter(Array.isArray);
  for (const row of memberRows) {
    const discordId = String(row[19] || '').trim();
    const labels = overrides.has(discordId) ? overrides.get(discordId) : memberFunctionLabels(row[10] || '');
    for (const label of labels) if (!catalog.has(normalize(label))) {
      catalog.set(normalize(label), { id: label, label, description: label });
    }
  }
  const assignments = [];
  for (const row of memberRows) {
    const discordId = String(row[19] || '').trim();
    const isOverride = overrides.has(discordId);
    const sourceLabels = isOverride ? overrides.get(discordId) : memberFunctionLabels(row[10] || '');
    const functionIds = sourceLabels.map(label => catalog.get(normalize(label)).id);
    if (String(row[3] || '').trim()) assignments.push({
      discordId,
      callsign: String(row[2] || '').trim(),
      functionIds,
      isOverride,
      attendanceTypes: attendanceTypesForFunctions(functionIds.join('|'))
    });
  }
  return { catalog: sortFunctionCatalog([...catalog.values()]), assignments };
}
export function normalizeMemberFunctionLabels(values) {
  if (!Array.isArray(values)) return [];
  const labels = new Map();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const label = canonicalFunctionLabel(value);
    if (!validMemberFunctionLabel(label)) continue;
    if (isHiddenFunction(label)) continue;
    if (!labels.has(normalize(label))) labels.set(normalize(label), label);
  }
  return [...labels.values()];
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
      return json(res, 200, memberFunctionsDirectory(members, await readFunctionOverrides()));
    }

    const members = await readPublicValues(MEMBER_RANGE);
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
    if (!functionOverridesConfigured()) return json(res, 503, { error: 'Member function override storage is not configured' });
    if (req.body?.useDocs === true) {
      await removeFunctionOverride(targetDiscordId);
      const functionIds = memberFunctionLabels(target[10] || '');
      return json(res, 200, {
        success: true,
        assignment: {
          discordId: targetDiscordId,
          callsign: String(target[2] || '').trim(),
          functionIds,
          isOverride: false,
          attendanceTypes: attendanceTypesForFunctions(functionIds.join('|'))
        }
      });
    }
    if (!Array.isArray(req.body?.functionIds) || req.body.functionIds.some(id => typeof id !== 'string' || !validMemberFunctionLabel(id))) {
      return json(res, 400, { error: 'Invalid member function selection' });
    }

    const functionIds = normalizeMemberFunctionLabels(req.body.functionIds);
    await saveFunctionOverride(targetDiscordId, functionIds);
    const assignment = {
      discordId: targetDiscordId,
      callsign: String(target[2] || '').trim(),
      functionIds,
      isOverride: true,
      attendanceTypes: attendanceTypesForFunctions(functionIds.join('|'))
    };
    return json(res, 200, { success: true, assignment });
  } catch (error) {
    console.error('Member functions storage failed:', error);
    return json(res, 500, { error: `Member functions storage failed: ${String(error?.message || error).slice(0, 200)}` });
  }
}
