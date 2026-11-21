import './config.js';
import { accessFor } from './access/shared.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const SHEET_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';

export async function publicUserForDiscordId(discordId) {
  const apiKey = String(process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) throw new Error('Google Sheets API is not configured');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.values)) throw new Error('Google Sheets lookup failed');
  const row = payload.values.slice(1).find(item => Array.isArray(item) && String(item[19] || '').trim() === discordId);
  if (!row) return null;
  const callsign = String(row[2] || '').trim();
  const csNum = Number(callsign.replace(/\D/g, '')) || 0;
  const rank = String(row[4] || '').trim();
  const dept = String(row[5] || '').trim();
  const functions = String(row[10] || '').trim();
  return {
    id: String(row[1] || '').trim(),
    name: String(row[3] || '').trim(),
    callsign,
    callSign: callsign,
    csNum,
    rank,
    dept,
    functions,
    discordId,
    avatar: '',
    ...accessFor(csNum, functions, rank, dept)
  };
}
