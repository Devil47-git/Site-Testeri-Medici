import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireRequester } from '../../lib/request-auth.js';
import { sameOrigin } from '../../lib/http.js';
import { SupabaseKV } from '../../lib/storage/supabase-kv.js';
import { callsignNumber, isLeadershipRow } from '../../lib/access/shared.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const adventRedis = new SupabaseKV();
const localFile = path.join(process.cwd(), '.data', 'advent-calendar.json');
let localCache = null;
let localReady = false;
const ADVENT_ROLE_ID = '804382163536576616';

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

function adventWindow(day) {
  const date = bucharestDate();
  const targetYear = date.year;
  const openDay = day === 1 ? 30 : day - 1;
  const openMonth = day === 1 ? 11 : 12;
  const openHour = day === 1 ? '21:01:00' : '21:01:00';
  const closeHour = '20:59:00';
  const drawHour = '21:00:00';
  return {
    openAt: `${targetYear}-${String(openMonth).padStart(2, '0')}-${String(openDay).padStart(2, '0')}T${openHour}+02:00`,
    closeAt: `${targetYear}-12-${String(day).padStart(2, '0')}T${closeHour}+02:00`,
    drawAt: `${targetYear}-12-${String(day).padStart(2, '0')}T${drawHour}+02:00`
  };
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

function hospitalChatWebhookUrl() {
  try {
    const url = new URL(String(process.env.DISCORD_HOSPITAL_CHAT_WEBHOOK || '').trim());
    return url.protocol === 'https:' && url.hostname === 'discord.com' && url.pathname.startsWith('/api/webhooks/') ? url.toString() : '';
  } catch {
    return '';
  }
}

async function sendAdventWinnerWebhook(state) {
  if (state.notified) return false;
  const webhookUrl = hospitalChatWebhookUrl();
  if (!webhookUrl) throw new Error('DISCORD_HOSPITAL_CHAT_WEBHOOK is missing or invalid');
  const winner = state.winner;
  if (!winner?.discordId) return false;
  const content = adventWinnerMessage(state.day, winner);
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Advent Calendar',
      content,
      allowed_mentions: { parse: [], users: [winner.discordId], roles: [ADVENT_ROLE_ID] }
    })
  });
  if (!response.ok) throw new Error(`Advent winner webhook failed (${response.status})`);
  state.notified = true;
  await writeState(state);
  return true;
}

export function adventWinnerMessage(day, winner, prizeOverride) {
  const prize = typeof prizeOverride === 'string' && prizeOverride.trim()
    ? prizeOverride.trim()
    : ADVENT_PRIZES[day - 1];
  return (
    `<@&${ADVENT_ROLE_ID}>\n\n` +
    `✨🎄 **ADVENT CALENDAR · ZIUA ${day}.12** 🎄✨\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎉 **Felicitări câștigătorului!** 🎉\n` +
    `🏆 <@${winner.discordId}> · **${String(winner.callsign || '').trim()} — ${String(winner.name || '').trim()}**\n\n` +
    `🎁 **Premiul zilei:** ${prize}\n` +
    `🌟 Felicitări și mulțumim tuturor pentru participare! 🍀`
  );
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
    if (state.winner && !state.notified) {
      await sendAdventWinnerWebhook(state);
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

  if (req.method === 'GET' && req.query?.cron === 'draw') {
    const cronSecret = String(process.env.CRON_SECRET || '').trim();
    if (!cronSecret) return json(res, 503, { error: 'CRON_SECRET is not configured.' });
    if (req.headers?.authorization !== `Bearer ${cronSecret}`) return json(res, 401, { error: 'Unauthorized' });
    try {
      const drawn = await sweepAdventDraws();
      return json(res, 200, { success: true, drawn: drawn.length });
    } catch (error) {
      console.error('Advent Calendar cron draw failed:', error);
      return json(res, 500, { error: 'Extragerea Advent Calendar nu a putut fi efectuată.' });
    }
  }

  const requesterId = String(req.method === 'GET' ? req.query?.requesterId : req.body?.requesterId || '').trim();
  if (!requesterId) return json(res, 400, { error: 'Lipsește identificatorul utilizatorului.' });
  if (!requireRequester(req, res, requesterId)) return;

  try {
    const member = await memberForRequester(requesterId);
    if (!member) return json(res, 403, { error: 'Contul nu este membru al departamentului.' });

    const date = bucharestDate();
    const action = req.method === 'POST' ? String(req.body?.action || '') : '';
    if (action === 'preview-winner' || action === 'send-test') {
      if (!isLeadershipRow(member)) return json(res, 403, { error: 'Doar conducerea poate testa mesajul Advent Calendar.' });
      const day = Number(req.body?.day);
      const callsign = callsignNumber(req.body?.callsign);
      const testPrize = String(req.body?.testPrize || '').trim();
      if (!Number.isInteger(day) || day < 1 || day > ADVENT_PRIZES.length) return json(res, 400, { error: 'Alege o zi validă.' });
      if (!callsign) return json(res, 400, { error: 'Introdu un callsign valid.' });
      if (!testPrize) return json(res, 400, { error: 'Introdu un premiu fictiv pentru mesajul de test.' });
      if (testPrize.length > 120) return json(res, 400, { error: 'Premiul fictiv nu poate depăși 120 de caractere.' });
      const matchingMembers = (await readMembers()).filter(row => callsignNumber(row[2]) === callsign);
      if (!matchingMembers.length) return json(res, 404, { error: `Nu am găsit membrul cu callsign M-${String(callsign).padStart(3, '0')}.` });
      if (matchingMembers.length > 1) return json(res, 409, { error: 'Callsign-ul apare de mai multe ori în lista membrilor.' });
      const [winnerRow] = matchingMembers;
      const winner = {
        discordId: String(winnerRow[19] || '').trim(),
        callsign: String(winnerRow[2] || '').trim(),
        name: String(winnerRow[3] || '').trim()
      };
      const preview = adventWinnerMessage(day, winner, testPrize);
      if (action === 'send-test') {
        if (!winner.discordId) return json(res, 400, { error: 'Membrul nu are un Discord ID asociat, deci nu poate fi menționat în mesaj.' });
        const webhookUrl = hospitalChatWebhookUrl();
        if (!webhookUrl) return json(res, 503, { error: 'Webhook-ul chatului spitalului nu este configurat.' });
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'Advent Calendar — TEST',
            content: preview,
            allowed_mentions: { parse: [], users: [winner.discordId], roles: [ADVENT_ROLE_ID] }
          })
        });
        if (!response.ok) {
          console.error('Advent Calendar test webhook failed:', response.status);
          return json(res, 502, { error: 'Mesajul test nu a putut fi trimis în chatul spitalului.' });
        }
        return json(res, 200, { success: true, sent: true, preview, winner, day, prize: testPrize });
      }
      return json(res, 200, { preview, winner, day, prize: testPrize });
    }

    if (req.method === 'GET') {
      await sweepAdventDraws();
      const days = [];
      for (let day = 1; day <= 24; day++) {
        const state = await readState(date.year, day);
        const registered = state.participants.some(participant => participant.discordId === requesterId);
        days.push({
          day,
          registered,
          participantCount: state.participants.length,
          chance: state.participants.length ? (1 / state.participants.length) : null,
          winner: state.winner,
          drawnAt: state.drawnAt,
          ...adventWindow(day)
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
    const window = adventWindow(day);
    const nowMs = Date.now();
    if (nowMs < new Date(window.openAt).getTime()) return json(res, 400, { error: `Înscrierile pentru ziua ${day} nu au început încă.` });
    if (nowMs >= new Date(window.closeAt).getTime()) return json(res, 400, { error: `Înscrierile pentru ziua ${day} s-au închis la 20:59.` });

    await sweepAdventDraws();
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
