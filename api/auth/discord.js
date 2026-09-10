const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const SHEET_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';

export default async function handler(req, res) {
  const allowedOrigin = process.env.APP_ORIGIN || 'https://site-wheat-zeta-76.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.body && typeof req.body === 'object' ? req.body : {};
  if (!code) return res.status(400).json({ error: 'No code provided' });
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
    const row = sheetData.values.slice(1).find(item => String(item[19] || '').trim() === String(discordUser.id));
    if (!row) return res.status(404).json({ error: 'not_found' });

    return res.status(200).json({ success: true, user: mapSheetRowToUser(row, discordUser) });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}

function normalize(value = '') { return String(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function hasFunction(functions, pattern) { return pattern.test(normalize(functions)); }
function accessFor(csNum, functions, rank, dept) {
  const isConducere = (csNum >= 1 && csNum <= 15) || ['DIRECTOR', 'INSPECTOR', 'CONDUCERE'].some(x => normalize(rank).includes(x)) || normalize(dept).includes('CONDUCERE');
  // Funcțiile din K stabilesc doar ce poate aproba conducerea, nu acordă acces automat.
  // Accesul efectiv la specializări trebuie păstrat într-o sursă separată de grants.
  const allowedTests = csNum >= 200 ? ['Test admitere', 'Test transfer', 'Adeverință medicală'] : [];
  const eligibleSpecializations = [];
  if (hasFunction(functions, /SMULS|\|\s*S\s*\|/)) eligibleSpecializations.push('Test SMULS');
  if (hasFunction(functions, /MOTO|\|\s*M\s*\|/)) eligibleSpecializations.push('Test MOTO');
  if (hasFunction(functions, /ALS|\|\s*A\s*\|/)) eligibleSpecializations.push('Test ALS');
  if (hasFunction(functions, /PILOT|\|\s*P\s*\|/)) eligibleSpecializations.push('Test PILOT');
  if (hasFunction(functions, /PARASUTIST|PARAȘUTIST|\|\s*PT\s*\|/)) eligibleSpecializations.push('Test parașutiști');
  return { isConducere, allowedTests, eligibleSpecializations, grantedTests: [] };
}
function mapSheetRowToUser(row, discordUser) {
  const callSignRaw = String(row[2] || '').trim();
  const csNum = parseInt(callSignRaw.replace(/\D/g, ''), 10) || 0;
  const functions = String(row[10] || '').trim(); const rank = String(row[4] || '').trim(); const dept = String(row[5] || '').trim();
  return { id: String(row[1] || '').trim(), name: String(row[3] || discordUser.username || '').trim(), callsign: callSignRaw, callSign: callSignRaw, csNum, rank, dept, functions, discordId: discordUser.id, avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null, ...accessFor(csNum, functions, rank, dept) };
}
