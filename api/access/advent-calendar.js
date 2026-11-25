import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireRequester } from '../../lib/request-auth.js';
import { sameOrigin } from '../../lib/http.js';
import { SupabaseKV } from '../../lib/storage/supabase-kv.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const adventRedis = new SupabaseKV();
const localFile = path.join(process.cwd(), '.data', 'advent-calendar.json');
let localCache = null;
let localReady = false;

export const ADVENT_PRIZES = [
  'ISU',
  'Minute / zi',
  '50.000',
  '5 FPT',
  '1 Sapt pontaj',
  '50.000',
  'Clasa A - Oferit de Anto',
  '1 Free pass',
  'VIP Bronz - 1 luna',
  '50.000',
  'Clasa B - Oferit de Vlad Samson',
  '1 Moto - Oferit de Denis',
  'Loz 10.000',
  '50.000',
  '1 UP',
  '5 FPT',
  '1 moto Oferit de Marius',
  'VIP Silver',
  'Clasa A - Oferit de Moretii',
  '5 FPT',
  'Loz 100.000',
  '5 FPT',
  '1 masina - Oferit de Denis',
  'VIP Diamond'
];

function json(res, status, body) { res.status(status).json(body); }

function bucharestDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute)
  };
}

function bucharestTimeText(now = new Date()) {
  const date = bucharestDate(now);
  return `${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}`;
}

function stateKey(year, day) {
  return `advent-calendar:${year}:${String(day).padStart(2, '0')}`;
}

async function readMembers() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('Google Sheets API is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MEMBER_RANGE)}?key=${encodeURIComponent(key)}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.values)) throw new Error('Google Sheets read failed');
  return payload.values.slice(1).filter(row =>
    Array.isArray(row) &&
    /^\d+$/.test(String(row[19] || '').trim()) &&
    String(row[3] || '').trim()
  );
}

async function loadLocal() {
  if (localReady) return localCache;
  try {
    localCache = JSON.parse(await fs.readFile(localFile, 'utf8'));
  } catch {
    localCache = {};
  }
  if (!localCache || typeof localCache !== 'object') localCache = {};
  localReady = true;
  return localCache;
}

async function saveLocal(cache) {
  await fs.mkdir(path.dirname(localFile), { recursive: true });
  await fs.writeFile(localFile, JSON.stringify(cache, null, 2), 'utf8');
}

async function readState(year, day) {
  const key = stateKey(year, day);
  if (adventRedis.isConfigured) {
    const state = await adventRedis.getJson(key);
    return state && typeof state === 'object' ? state : { year, day, participants: [], winner: null, drawnAt: null };
  }
  const cache = await loadLocal();
  const state = cache[key];
  return state && typeof state === 'object' ? state : { year, day, participants: [], winner: null, drawnAt: null };
}

async function writeState(state) {
  const key = stateKey(state.year, state.day);
  if (adventRedis.isConfigured) {
    await adventRedis.setJson(key, state, { expirationSeconds: 60 * 60 * 24 * 400 });
  } else {
    const cache = await loadLocal();
    cache[key] = state;
    await saveLocal(cache);
  }
}

export async function sweepAdventDraws(now = new Date()) {
  const date = bucharestDate(now);
  if (date.month !== 12 || date.day < 1 || date.day > 24) return [];
  const hourReached = date.hour > 21 || (date.hour === 21 && date.minute >= 0);
  if (!hourReached) return [];
  const results = [];
  for (let day = 1; day <= date.day; day++) {
    const state = await readState(date.year, day);
    if (!state.winner && state.participants.length) {
      const winner = state.participants[randomInt(state.participants.length)];
      state.winner = { ...winner };
      state.drawnAt = now.toISOString();
      await writeState(state);
    }
    results.push(state);
  }
  return results;
}

async function memberForRequester(requesterId) {
  const rows = await readMembers();
  return rows.find(row => String(row[19] || '').trim() === requesterId) || null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Cerere respinsă' });

  const requesterId = String(req.method === 'GET' ? req.query?.requesterId : req.body?.requesterId || '').trim();
  if (!requesterId) return json(res, 400, { error: 'Lipsește identificatorul utilizatorului.' });
  if (!requireRequester(req, res, requesterId)) return;

  try {
    await sweepAdventDraws();
    const member = await memberForRequester(requesterId);
    if (!member) return json(res, 403, { error: 'Contul nu este membru al departamentului.' });

    const date = bucharestDate();
    if (req.method === 'GET') {
      const days = [];
      for (let day = 1; day <= 24; day++) {
        const state = await readState(date.year, day);
        const registered = state.participants.some(participant => participant.discordId === requesterId);
        days.push({
          day,
          registered,
          participantCount: state.participants.length,
          winner: state.winner,
          drawnAt: state.drawnAt
        });
      }
      return json(res, 200, {
        configured: adventRedis.isConfigured || localReady,
        year: date.year,
        date: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
        hour: `${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}`,
        days
      });
    }

    const day = Number(req.body?.day);
    if (!Number.isInteger(day) || day < 1 || day > 24) return json(res, 400, { error: 'Zi invalidă.' });
    if (date.month !== 12) return json(res, 400, { error: 'Înscrierile sunt disponibile în perioada 1-24 decembrie.' });
    if (day !== date.day) return json(res, 400, { error: `Poți merge la înscriere doar în ziua ${day}.` });
    if ((date.hour === 20 && date.minute >= 59) || date.hour >= 21) return json(res, 400, { error: 'Înscrierile pentru această zi s-au închis la 20:59.' });

    const state = await readState(date.year, day);
    if (state.winner) return json(res, 409, { error: 'Extragerea pentru această zi a fost deja efectuată.' });
    if (state.participants.some(participant => participant.discordId === requesterId)) {
      return json(res, 200, { success: true, registered: true, participantCount: state.participants.length, day });
    }
    state.participants.push({
      discordId: requesterId,
      name: String(member[3] || '').trim(),
      callsign: String(member[2] || '').trim()
    });
    await writeState(state);
    return json(res, 200, { success: true, registered: true, participantCount: state.participants.length, day });
  } catch (error) {
    console.error('Advent Calendar request failed:', error);
    return json(res, 500, { error: 'Advent Calendar nu este disponibil momentan.' });
  }
}
