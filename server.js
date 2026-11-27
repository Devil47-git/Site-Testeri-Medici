import './lib/env.js';
import './lib/config.js';
import http from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { isLeadership, gradeGroupFor, catalog, automaticCoreTestsForMember, accessFor } from './lib/access/shared.js';
import { readTestDefinitions, writeTestDefinitions } from './lib/test-definitions-store.js';
import { authenticatedDiscordId, setAuthCookie as setSignedAuthCookie, clearAuthCookie } from './lib/auth-session.js';
import { publicUserForDiscordId } from './lib/public-user.js';

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'LISTA DEPARTAMENT!A:T';
const oauthState = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const MAX_BODY_BYTES = 1e6;
function setSessionCookie(res, discordId) {
  setSignedAuthCookie(res, discordId);
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
    "img-src 'self' https://cdn.discordapp.com https://ghidul-departamentului-medical-eight.vercel.app data: blob:",
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
  const allowed = rateLimit(`${action}:${clientIp(req)}`, limit, windowMs);
  if (!allowed) {
    tooManyRequests(res, retrySeconds);
    return false;
  }
  return true;
}
async function readRawBody(req, limit = MAX_BODY_BYTES) {
  let size = 0;
  let body = '';
  let overflow = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { overflow = true; continue; }
    body += chunk;
  }
  if (overflow) { const error = new Error('Payload prea mare'); error.statusCode = 413; throw error; }
  return body;
}
async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const body = await readRawBody(req, limit);
  try { return body ? JSON.parse(body) : {}; }
  catch { const error = new Error('Date invalide'); error.statusCode = 400; throw error; }
}
function redirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function sheetMember(discordId) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Google Sheets is not configured');
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const row = (result.data.values || []).slice(1).find(values => String(values[19] || '').trim() === String(discordId).trim());
  if (!row) return null;
  const callsign = String(row[2] || '').trim(); const functions = row[10] || ''; const rank = row[4] || ''; const dept = row[5] || '';
  const csNum = Number(callsign.replace(/\D/g, '')) || 0;
  const access = accessFor(csNum, functions, rank, dept);
  return { discordId, callsign, callSign: callsign, csNum, name: row[3] || '', functions, rank, dept, allowedTests: access.allowedTests, eligibleSpecializations: [], ...access };
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
    try { const discord = await exchangeDiscord(code.trim()); const member = await sheetMember(discord.id); if (!member) return redirect(res, '/?access=denied'); setSessionCookie(res, member.discordId); return redirect(res, '/'); } catch (e) { return redirect(res, '/?access=error'); }
  }
}

async function handleSession(req, res) {
  const discordId = authenticatedDiscordId(req);
  if (!discordId) return json(res, 401, { authorized: false });
  try {
    const user = await publicUserForDiscordId(discordId);
    if (!user) { clearAuthCookie(res); return json(res, 401, { authorized: false }); }
    setSessionCookie(res, discordId);
    return json(res, 200, { authorized: true, user });
  } catch (error) {
    console.error('Session verification failed:', error);
    return json(res, 503, { authorized: false, error: 'Session verification unavailable' });
  }
}

async function handleIdentityOcr(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'Cerere respinsă' });
  if (!applyRateLimit(req, res, 'identity-ocr', 20, 60 * 1000)) return;
  if (!authenticatedDiscordId(req)) return json(res, 401, { error: 'Autentificare necesară' });
  const apiKey = String(process.env.OCRSPACE_API_KEY || '').trim();
  if (!apiKey) return json(res, 503, { error: 'Serviciul OCR nu este configurat.' });
  let payload;
  try { payload = await readJsonBody(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'Date invalide' }); }
  const base64 = String(payload?.image || '');
  if (!base64 || base64.length > 10e6) return json(res, 400, { error: 'Imaginea este prea mare.' });
  // OCR.space takes a multipart upload with the raw base64 in `base64Image`.
  const form = new FormData();
  form.append('base64Image', `data:image/jpeg;base64,${base64}`);
  form.append('apikey', apiKey);
  form.append('language', 'eng');          // Latin script covers Romanian names
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '2');           // engine 2 reads dense identity cards well
  form.append('scale', 'true');
  const upstream = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return json(res, upstream.status === 429 ? 429 : 502, { error: data?.ErrorMessage || 'OCR.space a refuzat cererea.' });
  }
  if (data?.IsErroredOnProcessing) {
    return json(res, 502, { error: data.ErrorMessage?.[0] || 'OCR.space nu a putut citi imaginea.' });
  }
  const text = String(data?.ParsedResults?.[0]?.ParsedText || '');
  return json(res, 200, { text });
}

async function handleTestDefinitions(req, res) {
  {
    if (req.method !== 'GET' && req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed' });
    const discordId = authenticatedDiscordId(req);
    if (!discordId) return json(res, 401, { error: 'Autentificare necesară' });
    let user;
    try {
      user = await publicUserForDiscordId(discordId);
    } catch (error) {
      console.error('Test definition authorization failed:', error);
      return json(res, 503, { error: 'Verificarea accesului nu este disponibilă momentan.' });
    }
    if (!user) {
      clearAuthCookie(res);
      return json(res, 401, { error: 'Autentificare necesară' });
    }
    if (req.method === 'GET') {
      const definitions = await readTestDefinitions();
      if (!definitions) return json(res, 500, { error: 'Nu am putut citi definițiile testelor' });
      return json(res, 200, { definitions });
    }
    if (req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cerere respinsă' });
      if (!applyRateLimit(req, res, 'test-definitions-put', 30, 60 * 1000)) return;
      if (!user.isLeadership) return json(res, 403, { error: 'Doar conducerea poate edita testele' });
      let payload; try { payload = await readJsonBody(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'Date invalide' }); }
      if (!payload || typeof payload.definitions !== 'object' || Array.isArray(payload.definitions) || !payload.definitions) return json(res, 400, { error: 'Câmpul definitions lipsește' });
      try { await writeTestDefinitions(payload.definitions); return json(res, 200, { success: true }); }
      catch (e) { return json(res, 500, { error: e.message || 'Salvarea a eșuat' }); }
    }
    return json(res, 405, { error: 'Method not allowed' });
  }
}

async function handleGuide(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    return await (await import('./api/guide.js')).default(req, {
      setHeader: (name, value) => res.setHeader(name, value),
      status: code => {
        res.statusCode = code;
        return {
          send: content => res.end(content),
          json: content => {
            if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(content));
          }
        };
      }
    });
  } catch (error) {
    console.error('Bundled guide could not be loaded:', error);
    return json(res, 500, { error: 'Ghidul oficial nu a putut fi încărcat.' });
  }
}

async function handleBugFix(req, res, url) {
  try {
    req.rawBody = await readRawBody(req);
  } catch (error) {
    return json(res, error.statusCode || 400, { error: error.message });
  }
  req.query = Object.fromEntries(url.searchParams);
  try {
    req.body = req.rawBody ? JSON.parse(req.rawBody) : {};
  } catch {
    return json(res, 400, { error: 'Date invalide' });
  }
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); return res; };
  try {
    return await (await import('./api/github/bugfix.js')).default(req, res);
  } catch (error) {
    console.error('Bug Fixer could not be handled:', error);
    return json(res, 500, { error: 'Bug Fixer request failed' });
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
  if (url.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const site = req.headers['sec-fetch-site'];
    if ((site && site !== 'same-origin' && site !== 'none') || (!site && !sameOrigin(req))) return json(res, 403, { error: 'Cerere respinsă' });
    clearAuthCookie(res);
    return json(res, 200, { success: true });
  }
  if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/discord' || url.pathname === '/api/auth/callback') return handleAuth(req, res, url);
  if (url.pathname === '/api/auth/session' || url.pathname === '/api/session') return handleSession(req, res);
  if (url.pathname === '/api/access/requester') {
    req.query = Object.fromEntries(url.searchParams);
    return (await import('./api/access/requester.js')).default(req, res);
  }
  if (url.pathname === '/api/test-definitions') return handleTestDefinitions(req, res);
  if (url.pathname === '/api/guide') return handleGuide(req, res);
  if (url.pathname === '/api/github/bugfix') return handleBugFix(req, res, url);
  if (url.pathname === '/api/identity-ocr') return handleIdentityOcr(req, res);
  if (url.pathname.startsWith('/api/access/')) return handleAccess(req, res, url);
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  return serveStatic(req, res, url);
}
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, expires] of oauthState) if (expires < now) oauthState.delete(key);
  for (const [key, stamps] of rateBuckets) if (!stamps.some(ts => ts > now - 24 * 60 * 60 * 1000)) rateBuckets.delete(key);
}, 10 * 60 * 1000);
sweepTimer.unref?.();

const adventTimer = setInterval(async () => {
  try {
    const { sweepAdventDraws } = await import('./api/access/advent-calendar.js');
    await sweepAdventDraws();
  } catch (error) {
    console.error('Advent Calendar automatic draw failed:', error);
  }
}, 60 * 1000);
adventTimer.unref?.();

http.createServer((req, res) => route(req, res).catch(e => {
  if (res.headersSent || res.writableEnded) return;
  json(res, e.statusCode || 500, { error: e.statusCode ? e.message : 'Internal server error' });
})).listen(PORT, () => console.log(`Medici panel: http://localhost:${PORT}`));
