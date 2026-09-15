import { accessFor } from '../access/shared.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const SHEET_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:E';

export default async function handler(req, res) {
  const allowedOrigin = process.env.APP_ORIGIN || 'https://site-wheat-zeta-76.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    const code = typeof req.query?.code === 'string' ? req.query.code.trim() : '';
    const error = typeof req.query?.error === 'string' ? req.query.error : '';
    if (error) return res.redirect(`/?error=${encodeURIComponent(error)}`);
    if (!code) return res.status(400).json({ error: 'No code provided' });
    return res.redirect(`/?code=${encodeURIComponent(code)}`);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof code !== 'string' || !code.trim()) return res.status(400).json({ error: 'No code provided' });
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, GOOGLE_API_KEY } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI || !GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Missing OAuth or Google API environment variables' });
  }

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: DISCORD_REDIRECT_URI, scope: 'identify' })
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) return res.status(502).json({ error: 'Token exchange failed' });

    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const discordUser = await userRes.json();
    if (!userRes.ok || !discordUser.id) return res.status(502).json({ error: 'Discord user lookup failed' });

    const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}?key=${GOOGLE_API_KEY}`);
    const sheetData = await sheetRes.json();
    if (!sheetRes.ok || !Array.isArray(sheetData.values)) return res.status(502).json({ error: 'User database lookup failed' });
    const row = sheetData.values.slice(1).filter(item => Array.isArray(item)).find(item => String(item[19] || '').trim() === String(discordUser.id));
    if (!row) return res.status(404).json({ error: 'not_found' });

    const user = mapSheetRowToUser(row, discordUser);
    const grantsRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(GRANTS_RANGE)}?key=${GOOGLE_API_KEY}`);
    if (grantsRes.ok) {
      const grantsData = await grantsRes.json();
      const grant = (Array.isArray(grantsData.values) ? grantsData.values : []).slice(1).filter(item => Array.isArray(item)).find(item => String(item[0] || '').trim() === String(discordUser.id));
      if (grant) {
        user.grantedTests = [...new Set([...(user.grantedTests || []), ...String(grant[2] || '').split('|').filter(Boolean)])];
        if (user.grantedTests.length) user.allowedTests = [...new Set([...(user.allowedTests || []), 'Test admitere', 'Test transfer', 'Adeverință medicală'])];
      }
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Discord authentication failed:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

function mapSheetRowToUser(row, discordUser) {
  const callSignRaw = String(row[2] || '').trim();
  const csNum = parseInt(callSignRaw.replace(/\D/g, ''), 10) || 0;
  const functions = String(row[10] || '').trim(); const rank = String(row[4] || '').trim(); const dept = String(row[5] || '').trim();
  const access = accessFor(csNum, functions, rank, dept);
  return { id: String(row[1] || '').trim(), name: String(row[3] || discordUser.username || '').trim(), callsign: callSignRaw, callSign: callSignRaw, csNum, rank, dept, functions, discordId: discordUser.id, avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null, ...access };
}
