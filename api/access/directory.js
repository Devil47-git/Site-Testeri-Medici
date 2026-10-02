import '../config.js';
import { normalize, callsignNumber, candidateForCallsign, isLeadershipRow, gradeGroupFor, GRADE_GROUPS, LEADERSHIP_MAX, effectiveTestsForMember, normalizeTests, functionsForMember } from './shared.js';
import { parseCooldownS } from './cooldowns.js';
import { avatarUrlForDiscordMember, discordAvatarHashFromUrl, readDiscordAvatarHashes, storeDiscordAvatarHash } from './avatar-store.js';
import { UpstashRedis } from '../storage/upstash-redis.js';

const RESIDENT_TESTER_PATTERN = /S\.?\s*M\.?\s*U\.?\s*L\.?\s*S\.?|MOTO|A\.?\s*L\.?\s*S\.?|PILOT/;

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:U400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:F';
const avatarRedis = new UpstashRedis();
function isLeadership(row) { return isLeadershipRow(row); }
function readTests(value = '') { return String(value).split('|').filter(Boolean); }
function relevantMember(row) {
  const number = callsignNumber(row[2]);
  const functions = normalize(row[10]);
  if (!number || number > 399 || !String(row[3] || '').trim()) return false;
  if (number >= 1 && number <= LEADERSHIP_MAX) return true;
  if (number >= GRADE_GROUPS.primar.min && number <= GRADE_GROUPS.specialist.max) return true;
  if (number >= 301 && number <= 340) return RESIDENT_TESTER_PATTERN.test(normalize(row[10]));
  if (number >= 200 && number < 300) return Boolean(functions);
  return number >= 300 && /TESTER/.test(functions);
}
function leadershipTitle(row) {
  const number = callsignNumber(row[2]);
  if (number === 1) return 'Director General';
  if (number >= 2 && number <= 4) return 'Director Adjunct';
  if (number >= 5 && number <= 8) return 'Medic Inspector';
  if (number >= 9 && number <= LEADERSHIP_MAX) return 'Medic Chirurg';
  return 'Conducere';
}
function groupLabel(row) {
  const group = gradeGroupFor(callsignNumber(row[2]));
  return GRADE_GROUPS[group]?.label || '';
}
export function statusFromRow(row) {
  const status = normalize(row?.[7]);
  if (status === 'ACTIV') return 'Activ';
  if (status === 'CONCEDIU') return 'Concediu';
  if (status === 'CO CIVIL' || status === 'CO-CIVIL') return 'Co Civil';
  return 'Inactiv';
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
  const isAvatarSync = req.method === 'POST';
  if (req.method !== 'GET' && !isAvatarSync) return json(res, 405, { error: 'Method not allowed' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const requesterId = isAvatarSync
    ? typeof body.requesterId === 'string' ? body.requesterId.trim() : ''
    : typeof req.query?.requesterId === 'string' ? req.query.requesterId.trim() : '';
  const avatarHash = isAvatarSync ? discordAvatarHashFromUrl(body.avatarUrl, requesterId) : '';
  if (isAvatarSync && (!avatarHash || !avatarRedis.isConfigured)) return json(res, 400, { error: 'Invalid avatar sync request' });
  if (!requesterId) return json(res, 400, { error: 'Missing requesterId' });
  try {
    const members = (await readPublic(MEMBER_RANGE)).slice(1).filter(Array.isArray);
    const requester = members.find(row => String(row[19] || '').trim() === requesterId);
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    if (isAvatarSync) {
      await storeDiscordAvatarHash(avatarRedis, requesterId, avatarHash);
      return json(res, 200, { success: true });
    }
    if (typeof req.query?.callsign === 'string') {
      const candidate = candidateForCallsign(members, req.query.callsign);
      const row = candidate && members.find(item => callsignNumber(item[2]) === callsignNumber(req.query.callsign) && String(item[3] || '').trim());
      return json(res, 200, { candidate: candidate ? { ...candidate, cooldowns: parseCooldownS(row?.[18] || '') } : null });
    }
    const grants = (await readPublic(GRANTS_RANGE).catch(() => [])).slice(1).filter(Array.isArray);
    const grantsByDiscord = new Map(grants.map(row => [String(row[0] || '').trim(), { grantedTests: readTests(row[2]), updatedAt: String(row[3] || '').trim(), lastSeen: String(row[4] || '').trim(), grantMode: String(row[5] || '').trim() }]));
    const avatarHashes = await readDiscordAvatarHashes(avatarRedis, members.map(row => row[19])).catch(error => {
      console.error('Discord avatar Redis read failed:', error);
      return new Map();
    });
    const result = members.filter(row => String(row[3] || '').trim() && (relevantMember(row) || isLeadership(row))).map(row => {
      const discordId = String(row[19] || '').trim();
      const storedGrant = grantsByDiscord.get(discordId);
      const functions = functionsForMember(callsignNumber(row[2]), row[10]);
      const isConducere = isLeadership(row);
      const status = statusFromRow(row);
      const grantedTests = effectiveTestsForMember(functions, storedGrant);
      return {
        discordId, name: String(row[3] || '').trim(), callsign: String(row[2] || '').trim(), csNum: callsignNumber(row[2]), rank: String(row[4] || '').trim(), dept: String(row[5] || '').trim(), functions, status, gradeGroup: groupLabel(row),
        isLeadership: isConducere, leadershipTitle: isConducere ? leadershipTitle(row) : '', avatar: avatarUrlForDiscordMember(discordId, row[20], avatarHashes),
        grantedTests, grantMode: storedGrant?.grantMode || '', updatedAt: storedGrant?.updatedAt || '', lastSeen: storedGrant?.lastSeen || '',
        isTester: ['leadership', 'primar', 'specialist'].includes(gradeGroupFor(callsignNumber(row[2]))) || (callsignNumber(row[2]) >= 301 && callsignNumber(row[2]) <= 340 && RESIDENT_TESTER_PATTERN.test(normalize(functions))) || /TESTER/.test(normalize(functions)) || grantsByDiscord.has(discordId)
      };
    });
    return json(res, 200, { members: result, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Department directory failed:', error);
    return json(res, 500, { error: 'Department directory unavailable' });
  }
}
