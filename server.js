import http from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'LISTA DEPARTAMENT!A:T';
const sessions = new Map();
const oauthState = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function cookie(req, key) { return (req.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(x => x[0] === key)?.[1]; }
function redirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function normalize(value = '') { return String(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function roleAccess(functions, callsign = '', rank = '', dept = '') {
  const f = normalize(functions); const g = Number(String(callsign).replace(/\D/g, '')) || 0;
  const normalizedRank = normalize(rank); const normalizedDept = normalize(dept);
  const isLeadership = (g >= 1 && g <= 15) || ['DIRECTOR', 'INSPECTOR', 'CONDUCERE', 'MANAGER', 'COORDONATOR'].some(value => normalizedRank.includes(value)) || ['CONDUCERE', 'MEDICAL'].some(value => normalizedDept.includes(value));
  const catalog = ['Test admitere', 'Test transfer', 'Adeverință medicală', 'Test SMULS', 'Test MOTO', 'Test ALS', 'Test PILOT', 'Test parașutiști'];
  const tests = isLeadership ? catalog : ['Test admitere', 'Test transfer', 'Adeverință medicală'];
  if (g >= 200) {
    if (/SMULS|\|\s*S\s*\|/.test(f)) tests.push('Test SMULS');
    if (/MOTO|\|\s*M\s*\|/.test(f)) tests.push('Test MOTO');
    if (g < 300 && /ALS|\|\s*A\s*\|/.test(f)) tests.push('Test ALS');
    if (g < 300 && /PILOT|\|\s*P\s*\|/.test(f)) tests.push('Test PILOT');
    if (g < 300 && /PARASUTIST|PARAȘUTIST|\|\s*PT\s*\|/.test(f)) tests.push('Test parașutiști');
  }
  return { isLeadership, isConducere: isLeadership, accessLevel: isLeadership ? 'leadership' : 'tester', tests };
}
async function sheetMember(discordId) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Google Sheets is not configured');
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const row = (result.data.values || []).slice(1).find(values => String(values[19] || '').trim() === String(discordId).trim());
  if (!row) return null;
  const callsign = String(row[2] || '').trim(); const functions = row[10] || ''; const rank = row[4] || ''; const dept = row[5] || '';
  const access = roleAccess(functions, callsign, rank, dept);
  return { discordId, callsign, callSign: callsign, csNum: Number(callsign.replace(/\D/g, '')) || 0, name: row[3] || '', functions, rank, dept, allowedTests: access.tests, eligibleSpecializations: [], ...access };
}
async function exchangeDiscord(code) {
  const body = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: process.env.DISCORD_REDIRECT_URI, scope: 'identify' });
  const token = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).then(r => r.json());
  if (!token.access_token) throw new Error('Discord token exchange failed');
  return fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } }).then(r => r.json());
}
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/discord') {
    if (req.method === 'POST' && url.pathname === '/api/auth/discord') {
      let body = ''; for await (const chunk of req) body += chunk;
      let payload; try { payload = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'Invalid request body' }); }
      if (typeof payload.code !== 'string' || !payload.code.trim()) return json(res, 400, { error: 'No code provided' });
      try { const discord = await exchangeDiscord(payload.code.trim()); const member = await sheetMember(discord.id); if (!member) return json(res, 404, { error: 'not_found' }); return json(res, 200, { success: true, user: { ...member, discordUsername: discord.username, avatar: discord.avatar || null } }); } catch (error) { console.error('Discord authentication failed:', error); return json(res, 502, { error: 'Discord authentication failed' }); }
    }
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_REDIRECT_URI) return json(res, 500, { error: 'Discord OAuth is not configured' });
    const state = crypto.randomBytes(24).toString('hex'); oauthState.set(state, Date.now() + 300000);
    const target = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(process.env.DISCORD_CLIENT_ID)}&response_type=code&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&scope=identify&state=${state}`;
    return redirect(res, target);
  }
  if (url.pathname === '/api/auth/callback') {
    const state = url.searchParams.get('state'); if (!oauthState.has(state) || oauthState.get(state) < Date.now()) return json(res, 400, { error: 'Invalid OAuth state' }); oauthState.delete(state);
    try { const discord = await exchangeDiscord(url.searchParams.get('code')); const member = await sheetMember(discord.id); if (!member) return redirect(res, '/?access=denied'); const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, { ...member, discordUsername: discord.username, expires: Date.now() + 259200000 }); res.setHeader('Set-Cookie', `session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=259200`); return redirect(res, '/'); } catch (e) { return redirect(res, '/?access=error'); }
  }
  if (url.pathname === '/api/session') { const sessionId = cookie(req, 'session'); const session = sessions.get(sessionId); if (!session || session.expires < Date.now()) return json(res, 401, { authorized: false }); try { const fresh = await sheetMember(session.discordId); if (!fresh) return json(res, 403, { authorized: false }); const updated = { ...session, ...fresh, expires: Date.now() + 259200000 }; sessions.set(sessionId, updated); return json(res, 200, { authorized: true, ...updated }); } catch { return json(res, 200, { authorized: true, ...session }); } }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname); try { const data = await fs.readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data); } catch { json(res, 404, { error: 'Not found' }); }
}
http.createServer((req, res) => route(req, res).catch(e => json(res, 500, { error: e.message }))).listen(PORT, () => console.log(`Medici panel: http://localhost:${PORT}`));
