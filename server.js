import './lib/config.js';
import http from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { isLeadership, gradeGroupFor, catalog } from './lib/access/shared.js';
import { readTestDefinitions, writeTestDefinitions } from './lib/test-definitions-store.js';

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL = 24 * 60 * 60 * 1000;
const ROOT = process.cwd();
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'LISTA DEPARTAMENT!A:T';
const sessions = new Map();
const oauthState = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.gif': 'image/gif', '.png': 'image/png' };

function cookie(req, key) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const x = part.trim();
    const eq = x.indexOf('=');
    if (eq < 0 || x.slice(0, eq) !== key) continue;
    const value = x.slice(eq + 1);
    try { return decodeURIComponent(value); } catch { return value; }
  }
  return undefined;
}
const MAX_BODY_BYTES = 1e6;
const SECURE_COOKIE = process.env.NODE_ENV === 'production' || process.env.HTTPS === 'true';
function setSessionCookie(res, sid) {
  res.setHeader('Set-Cookie', `session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}${SECURE_COOKIE ? '; Secure' : ''}`);
}
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; '));
}
// Simple sliding-window rate limiter, keyed per client+action.
const rateBuckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = (rateBuckets.get(key) || []).filter(ts => ts > now - windowMs);
  if (bucket.length >= limit) return false;
  bucket.push(now);
  rateBuckets.set(key, bucket);
  return true;
}
function clientIp(req) {
  return String(req.socket?.remoteAddress || 'unknown');
}
// Blocks cross-site form posts: a CSRF-safe fetch sends Sec-Fetch-Site,
// and a same-origin navigation carries a matching Host.
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.origin;
  if (origin) { try { return new URL(origin).host === req.headers.host; } catch { return false; } }
  return true;
}
function tooManyRequests(res, retrySeconds) {
  res.setHeader('Retry-After', String(retrySeconds));
  return json(res, 429, { error: 'Prea multe cereri. Încearcă din nou în curând.' });
}
function applyRateLimit(req, res, action, limit, windowMs) {
  const retrySeconds = Math.ceil(windowMs / 1000);
  return rateLimit(`${action}:${clientIp(req)}`, limit, windowMs) || tooManyRequests(res, retrySeconds);
}
async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  let size = 0;
  let body = '';
  let overflow = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { overflow = true; continue; }  // keep draining, discard
    body += chunk;
  }
  if (overflow) { const error = new Error('Payload prea mare'); error.statusCode = 413; throw error; }
  try { return body ? JSON.parse(body) : {}; }
  catch { const error = new Error('Date invalide'); error.statusCode = 400; throw error; }
}
function requireSession(req) {
  const sessionId = cookie(req, 'session');
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session || session.expires < Date.now()) return null;
  return { sessionId, session };
}
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
const DISCORD_API_BASE = process.env.DISCORD_API_BASE || 'https://discord.com/api';
async function exchangeDiscord(code) {
  const body = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: process.env.DISCORD_REDIRECT_URI, scope: 'identify' });
  const token = await fetch(`${DISCORD_API_BASE}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).then(r => r.json());
  if (!token.access_token) throw new Error('Discord token exchange failed');
  return fetch(`${DISCORD_API_BASE}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } }).then(r => r.json());
}
async function handleAuth(req, res, url) {
  if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/discord') {
    if (req.method === 'POST' && url.pathname === '/api/auth/discord') {
      if (!applyRateLimit(req, res, 'discord-auth', 10, 60 * 1000)) return;
      let payload; try { payload = await readJsonBody(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'Invalid request body' }); }
      if (typeof payload.code !== 'string' || !payload.code.trim()) return json(res, 400, { error: 'No code provided' });
      try { const discord = await exchangeDiscord(payload.code.trim()); const member = await sheetMember(discord.id); if (!member) return json(res, 404, { error: 'not_found' }); return json(res, 200, { success: true, user: { ...member, discordUsername: discord.username, avatar: discord.avatar || null } }); } catch (error) { console.error('Discord authentication failed:', error); return json(res, 502, { error: 'Discord authentication failed' }); }
    }
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_REDIRECT_URI) return json(res, 500, { error: 'Discord OAuth is not configured' });
    if (!applyRateLimit(req, res, 'discord-login', 20, 60 * 1000)) return;
    const now = Date.now(); for (const [key, expires] of oauthState) { if (expires < now) oauthState.delete(key); } while (oauthState.size >= 500) oauthState.delete(oauthState.keys().next().value);
    const state = crypto.randomBytes(24).toString('hex'); oauthState.set(state, now + 300000);
    const target = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(process.env.DISCORD_CLIENT_ID)}&response_type=code&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&scope=identify&state=${state}`;
    return redirect(res, target);
  }
  if (url.pathname === '/api/auth/callback') {
    const state = url.searchParams.get('state'); if (!oauthState.has(state) || oauthState.get(state) < Date.now()) return json(res, 400, { error: 'Invalid OAuth state' }); oauthState.delete(state);
    const code = url.searchParams.get('code'); if (!code || !code.trim()) return redirect(res, '/?access=denied');
    try { const discord = await exchangeDiscord(code.trim()); const member = await sheetMember(discord.id); if (!member) return redirect(res, '/?access=denied'); const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, { ...member, discordUsername: discord.username, expires: Date.now() + SESSION_TTL }); setSessionCookie(res, sid); return redirect(res, '/'); } catch (e) { return redirect(res, '/?access=error'); }
  }
}

async function handleSession(req, res) {
  const auth = requireSession(req);
  if (!auth) return json(res, 401, { authorized: false });
  const { sessionId, session } = auth;
  try {
    const fresh = await sheetMember(session.discordId);
    if (!fresh) return json(res, 403, { authorized: false });
    const updated = { ...session, ...fresh, expires: Date.now() + SESSION_TTL };
    sessions.set(sessionId, updated);
    setSessionCookie(res, sessionId);
    return json(res, 200, { authorized: true, ...updated });
  } catch {
    return json(res, 200, { authorized: true, ...session });
  }
}

async function handleIdentityOcr(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'Cerere respinsă' });
  if (!applyRateLimit(req, res, 'identity-ocr', 20, 60 * 1000)) return;
  const auth = requireSession(req);
  if (!auth) return json(res, 401, { error: 'Autentificare necesară' });
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return json(res, 503, { error: 'Google Vision nu este configurat.' });
  let payload;
  try { payload = await readJsonBody(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'Date invalide' }); }
  const image = String(payload?.image || '');
  // Vision accepts at most ~10 MB of base64; anything larger is rejected.
  if (!image || image.length > 14e6) return json(res, 400, { error: 'Imaginea este prea mare.' });
  const vision = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: image },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 30 }]
      }]
    })
  });
  const data = await vision.json().catch(() => null);
  if (!vision.ok) {
    const message = data?.error?.message || 'Google Vision a refuzat cererea.';
    return json(res, vision.status === 429 ? 429 : 502, { error: message });
  }
  const annotation = data?.responses?.[0];
  const text = annotation?.fullTextAnnotation?.text
    || annotation?.textAnnotations?.map(item => item.description).join('\n')
    || '';
  return json(res, 200, { text });
}

async function handleTestDefinitions(req, res) {
  {
    if (req.method === 'GET') {
      const definitions = await readTestDefinitions();
      if (!definitions) return json(res, 500, { error: 'Nu am putut citi definițiile testelor' });
      return json(res, 200, { definitions });
    }
    if (req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cerere respinsă' });
      if (!applyRateLimit(req, res, 'test-definitions-put', 30, 60 * 1000)) return;
      const auth = requireSession(req);
      if (!auth) return json(res, 401, { error: 'Autentificare necesară' });
      const { session } = auth;
      if (!session.isLeadership) return json(res, 403, { error: 'Doar conducerea poate edita testele' });
      let payload; try { payload = await readJsonBody(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'Date invalide' }); }
      if (!payload || typeof payload.definitions !== 'object' || Array.isArray(payload.definitions) || !payload.definitions) return json(res, 400, { error: 'Câmpul definitions lipsește' });
      try { await writeTestDefinitions(payload.definitions); return json(res, 200, { success: true }); }
      catch (e) { return json(res, 500, { error: e.message || 'Salvarea a eșuat' }); }
    }
    return json(res, 405, { error: 'Method not allowed' });
  }
}

async function handleAccess(req, res, url) {
  const accessRoute = url.pathname.match(/^\/api\/access\/([a-z-]+)$/);
  if (accessRoute) {
    if (!applyRateLimit(req, res, `access-${accessRoute[1]}`, 120, 60 * 1000)) return;
    if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Cerere respinsă' });
    let handler;
    try { handler = (await import(`./api/access/${accessRoute[1]}.js`)).default; } catch { return json(res, 404, { error: 'Not found' }); }
    if (typeof handler !== 'function') return json(res, 404, { error: 'Not found' });
    try { req.body = await readJsonBody(req); } catch (e) { if (e.statusCode) return json(res, e.statusCode, { error: e.message }); req.body = {}; }
    req.query = Object.fromEntries(url.searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => { if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); return res; };
    return handler(req, res);
  }
  return json(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid path' }); }
  const file = path.resolve(ROOT, pathname === '/' ? 'index.html' : '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return json(res, 404, { error: 'Not found' });
  // Never serve server-side sources, secrets or VCS data over HTTP.
  // NOTE: js/ holds browser bundles and must stay reachable.
  const parts = path.relative(ROOT, file).split(path.sep);
  const BLOCKED = /^(?:\.env.*|\.git.*|node_modules|package(-lock)?\.json|server\.js|tools|api|lib|tests)$/;
  if (parts.some(part => BLOCKED.test(part)) || /\.(?:mjs|cjs|map)$/i.test(file)) return json(res, 404, { error: 'Not found' });
  try {
    const data = await fs.readFile(file);
    const etag = `"${crypto.createHash('sha1').update(data).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', ETag: etag, 'Cache-Control': 'no-cache' });
    res.end(data);
  }
  catch { json(res, 404, { error: 'Not found' }); }
}

async function route(req, res) {
  applySecurityHeaders(res);
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return json(res, 400, { error: 'Invalid request URL' }); }
  if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/discord' || url.pathname === '/api/auth/callback') return handleAuth(req, res, url);
  if (url.pathname === '/api/session') return handleSession(req, res);
  if (url.pathname === '/api/test-definitions') return handleTestDefinitions(req, res);
  if (url.pathname === '/api/identity-ocr') return handleIdentityOcr(req, res);
  if (url.pathname.startsWith('/api/access/')) return handleAccess(req, res, url);
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  return serveStatic(req, res, url);
}
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) if (!session || session.expires < now) sessions.delete(id);
  for (const [key, expires] of oauthState) if (expires < now) oauthState.delete(key);
  for (const [key, stamps] of rateBuckets) if (!stamps.some(ts => ts > now - 24 * 60 * 60 * 1000)) rateBuckets.delete(key);
}, 10 * 60 * 1000);
sweepTimer.unref?.();

http.createServer((req, res) => route(req, res).catch(e => {
  if (res.headersSent || res.writableEnded) return;
  json(res, e.statusCode || 500, { error: e.statusCode ? e.message : 'Internal server error' });
})).listen(PORT, () => console.log(`Medici panel: http://localhost:${PORT}`));
