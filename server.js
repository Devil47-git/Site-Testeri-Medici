import './lib/config.js';
import http from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { isLeadership, gradeGroupFor, catalog } from './lib/access/shared.js';

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL = 24 * 60 * 60 * 1000;
const ROOT = process.cwd();
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'LISTA DEPARTAMENT!A:T';
const sessions = new Map();
const oauthState = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.gif': 'image/gif', '.png': 'image/png' };

function cookie(req, key) { return (req.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(x => x[0] === key)?.[1]; }
function redirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function roleAccess(functions, callsign = '', rank = '', dept = '') {
  const g = Number(String(callsign).replace(/\D/g, '')) || 0;
  const leader = isLeadership(g, rank, dept);
  const group = gradeGroupFor(g);
  const tests = leader ? catalog : [];
  return { isLeadership: leader, isConducere: leader, accessLevel: leader ? 'leadership' : 'tester', gradeGroup: group, tests: [...new Set(tests)] };
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
    const now = Date.now(); for (const [key, expires] of oauthState) { if (expires < now) oauthState.delete(key); } while (oauthState.size >= 500) oauthState.delete(oauthState.keys().next().value);
    const state = crypto.randomBytes(24).toString('hex'); oauthState.set(state, now + 300000);
    const target = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(process.env.DISCORD_CLIENT_ID)}&response_type=code&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&scope=identify&state=${state}`;
    return redirect(res, target);
  }
  if (url.pathname === '/api/auth/callback') {
    const state = url.searchParams.get('state'); if (!oauthState.has(state) || oauthState.get(state) < Date.now()) return json(res, 400, { error: 'Invalid OAuth state' }); oauthState.delete(state);
    const code = url.searchParams.get('code'); if (!code || !code.trim()) return redirect(res, '/?access=denied');
    try { const discord = await exchangeDiscord(code.trim()); const member = await sheetMember(discord.id); if (!member) return redirect(res, '/?access=denied'); const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, { ...member, discordUsername: discord.username, expires: Date.now() + SESSION_TTL }); res.setHeader('Set-Cookie', `session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`); return redirect(res, '/'); } catch (e) { return redirect(res, '/?access=error'); }
  }
  if (url.pathname === '/api/session') { const sessionId = cookie(req, 'session'); const session = sessions.get(sessionId); if (!session || session.expires < Date.now()) return json(res, 401, { authorized: false }); try { const fresh = await sheetMember(session.discordId); if (!fresh) return json(res, 403, { authorized: false }); const updated = { ...session, ...fresh, expires: Date.now() + SESSION_TTL }; sessions.set(sessionId, updated); res.setHeader('Set-Cookie', `session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`); return json(res, 200, { authorized: true, ...updated }); } catch { return json(res, 200, { authorized: true, ...session }); } }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid path' }); }
  const file = path.resolve(ROOT, pathname === '/' ? 'index.html' : '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return json(res, 404, { error: 'Not found' });
  try { const data = await fs.readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { json(res, 404, { error: 'Not found' }); }
}
http.createServer((req, res) => route(req, res).catch(e => json(res, 500, { error: e.message }))).listen(PORT, () => console.log(`Medici panel: http://localhost:${PORT}`));
