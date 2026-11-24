import crypto from 'node:crypto';
import '../../lib/config.js';
import { requireRequester } from '../../lib/request-auth.js';
import { sameOrigin } from '../../lib/http.js';
import { SupabaseKV } from '../../lib/storage/supabase-kv.js';
import { isLeadershipRow } from '../../lib/access/shared.js';

export const config = { api: { bodyParser: false } };

const DRAFTS_KEY = 'site-testeri-medici:bugfix:drafts';
const POSTED_KEY = 'site-testeri-medici:bugfix:posted';
const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const kv = new SupabaseKV();

function json(res, status, body) { return res.status(status).json(body); }
function webhookUrl() {
  try {
    const url = new URL(String(process.env.DISCORD_HOSPITAL_CHAT_WEBHOOK || '').trim());
    return url.protocol === 'https:' && url.hostname === 'discord.com' && url.pathname.startsWith('/api/webhooks/') ? url.toString() : '';
  } catch {
    return '';
  }
}
async function readRawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return JSON.stringify(req.body);
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return '';
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
async function readMembers() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MEMBER_RANGE)}?key=${encodeURIComponent(key)}`);
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.values)) throw new Error('Google Sheets member read failed');
  return data.values.slice(1).filter(Array.isArray);
}
export function verifyGitHubSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const digest = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}
export function resolvedCommitDrafts(payload) {
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  return commits.filter(commit => /\bresolved\b/i.test(String(commit?.message || ''))).map(commit => {
    const message = String(commit.message || '').replace(/\[resolved\]/gi, '').replace(/\bresolved\b/gi, '').replace(/^\s*[-:]\s*/, '').trim();
    const [titleLine, ...detailLines] = message.split(/\r?\n/);
    return {
      id: String(commit.id || crypto.randomUUID()),
      sha: String(commit.id || '').slice(0, 12),
      title: titleLine.trim().slice(0, 120) || 'Bug rezolvat',
      details: detailLines.join('\n').trim().slice(0, 1000),
      author: String(commit.author?.name || commit.author?.username || payload?.pusher?.name || 'Necunoscut').slice(0, 100),
      pushedBy: String(payload?.pusher?.name || commit.author?.username || commit.author?.name || 'Necunoscut').slice(0, 100),
      url: String(commit.url || '').slice(0, 500),
      receivedAt: new Date().toISOString(),
      status: 'pending'
    };
  });
}
export function bugFixEmbed({ title, details = '', author = 'Necunoscut', pushedBy = 'Necunoscut', url = '' }) {
  return {
    color: 0x2D89F3,
    title: String(title || 'Bug rezolvat').slice(0, 256),
    ...(details ? { description: String(details).slice(0, 4096) } : {}),
    fields: [
      { name: 'Author', value: String(author).slice(0, 1024), inline: true },
      { name: 'Pushed by', value: String(pushedBy).slice(0, 1024), inline: true }
    ],
    ...(url ? { url: String(url).slice(0, 512) } : {})
  };
}
export function bugFixDisplayName(value = '') {
  const normalized = String(value || '').trim();
  const key = normalized.toLowerCase();
  if (/devil|mihail|d22tiny|o22tiny/.test(key)) return 'Devil';
  if (/antonio|antonioshade|antonio shade/.test(key)) return 'AntonioShade';
  return normalized || 'Unknown';
}
async function postAutomaticResolvedCommit(draft) {
  const webhook = webhookUrl();
  if (!webhook) throw new Error('DISCORD_HOSPITAL_CHAT_WEBHOOK is missing or invalid');
  const embed = bugFixEmbed({
    title: draft.title,
    details: '',
    author: bugFixDisplayName(draft.author),
    pushedBy: bugFixDisplayName(draft.pushedBy || draft.author),
    url: draft.url
  });
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'BUG FIXER', embeds: [embed] })
  });
  if (!response.ok) throw new Error(`Discord webhook failed (${response.status})`);
}
async function readPostedIds() {
  if (!kv.isConfigured) return new Set();
  const posted = await kv.getJson(POSTED_KEY);
  return new Set(Array.isArray(posted) ? posted : []);
}
async function writePostedIds(posted) {
  await kv.setJson(POSTED_KEY, [...posted].slice(-500), { expirationSeconds: 60 * 60 * 24 * 400 });
}
export async function importResolvedGitHubCommits(fetchImpl = globalThis.fetch) {
  const repository = String(process.env.GITHUB_REPOSITORY || 'Devil47-git/Site-Testeri-Medici').trim();
  const token = String(process.env.GITHUB_BUGFIX_TOKEN || '').trim();
  if (!repository.includes('/')) throw new Error('GITHUB_REPOSITORY is invalid');
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/commits?per_page=100`, { headers });
  const commits = await response.json().catch(() => []);
  if (!response.ok) throw new Error(Array.isArray(commits) ? `GitHub API failed (${response.status})` : (commits.message || `GitHub API failed (${response.status})`));
  return resolvedCommitDrafts({
    commits: (Array.isArray(commits) ? commits : []).map(commit => ({
      id: commit.sha,
      message: commit.commit?.message || '',
      url: commit.html_url || '',
      author: {
        name: commit.commit?.author?.name || commit.author?.login || 'Necunoscut'
      }
    }))
  });
}
async function readDrafts() {
  if (!kv.isConfigured) throw new Error('Supabase storage is not configured');
  const drafts = await kv.getJson(DRAFTS_KEY);
  return Array.isArray(drafts) ? drafts : [];
}
async function writeDrafts(drafts) {
  await kv.setJson(DRAFTS_KEY, drafts.slice(-100), { expirationSeconds: 60 * 60 * 24 * 400 });
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rawBody = await readRawBody(req).catch(() => '');
  let body = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }

  if (req.method === 'POST' && req.headers?.['x-github-event']) {
    const event = String(req.headers['x-github-event']);
    if (event !== 'push') return json(res, 200, { ignored: true });
    const secret = String(process.env.GITHUB_BUGFIX_WEBHOOK_SECRET || '').trim();
    const signature = req.headers['x-hub-signature-256'];
    if (!verifyGitHubSignature(rawBody, signature, secret)) return json(res, 401, { error: 'Invalid GitHub webhook signature' });
    if (!kv.isConfigured) return json(res, 503, { error: 'Supabase storage is not configured' });
    const incoming = resolvedCommitDrafts(body);
    if (!incoming.length) return json(res, 200, { draftsCreated: 0 });
    const posted = await readPostedIds();
    let postedCount = 0;
    for (const draft of incoming) {
      if (posted.has(draft.id)) continue;
      await postAutomaticResolvedCommit(draft);
      posted.add(draft.id);
      postedCount += 1;
    }
    await writePostedIds(posted);
    return json(res, 200, { posted: postedCount });
  }

  if (!sameOrigin(req) && req.method !== 'GET') return json(res, 403, { error: 'Cross-origin request rejected' });
  const requesterId = req.method === 'GET'
    ? String(req.query?.requesterId || '').trim()
    : String(body.requesterId || req.body?.requesterId || '').trim();
  if (!requesterId) return json(res, 400, { error: 'Missing requesterId' });
  const authenticatedId = requireRequester(req, res, requesterId);
  if (!authenticatedId) return;

  try {
    const members = await readMembers();
    const requester = members.find(row => String(row[19] || '').trim() === authenticatedId);
    if (!requester || !isLeadershipRow(requester)) return json(res, 403, { error: 'Only leadership can manage Bug Fixer messages' });
    if (req.method === 'GET') {
      if (req.query?.import === '1') {
        const incoming = await importResolvedGitHubCommits();
        const existing = await readDrafts();
        const knownIds = new Set(existing.map(draft => draft.id));
        const created = incoming.filter(draft => !knownIds.has(draft.id));
        await writeDrafts([...existing, ...created]);
        return json(res, 200, { drafts: await readDrafts(), imported: created.length });
      }
      return json(res, 200, { drafts: await readDrafts() });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

    const action = String(body.action || '').trim();
    if (action === 'create') {
      const title = String(body.title || '').trim().slice(0, 120);
      const details = String(body.details || '').trim().slice(0, 1000);
      const url = String(body.url || '').trim().slice(0, 500);
      if (!title) return json(res, 400, { error: 'Bug Fixer title is required' });
      const drafts = await readDrafts();
      const draft = {
        id: crypto.randomUUID(),
        sha: url.match(/[0-9a-f]{7,40}/i)?.[0]?.slice(0, 12) || 'manual',
        title,
        details,
        author: bugFixDisplayName(requester[3] || 'Unknown'),
        url,
        receivedAt: new Date().toISOString(),
        status: 'pending'
      };
      await writeDrafts([...drafts, draft]);
      return json(res, 200, { success: true, draft });
    }

    const requesterCallsign = String(requester[2] || '').replace(/\D/g, '').padStart(3, '0');
    if (!['001', '002', '004'].includes(requesterCallsign)) {
      return json(res, 403, { error: 'Only callsigns 001, 002 and 004 can approve or reject Bug Fixer messages' });
    }
    const draftId = String(body.draftId || '').trim();
    const drafts = await readDrafts();
    const draft = drafts.find(item => item.id === draftId);
    if (!draft) return json(res, 404, { error: 'Bug Fixer draft not found' });
    if (action === 'reject') {
      await writeDrafts(drafts.filter(item => item.id !== draftId));
      return json(res, 200, { success: true });
    }
    if (action !== 'approve') return json(res, 400, { error: 'Invalid Bug Fixer action' });

    const title = String(body.title || draft.title || '').trim().slice(0, 120);
    const details = String(body.details || draft.details || '').trim().slice(0, 1000);
    const url = String(body.url || draft.url || '').trim().slice(0, 500);
    if (!title) return json(res, 400, { error: 'Bug Fixer title is required' });
    const webhook = webhookUrl();
    if (!webhook) return json(res, 503, { error: 'DISCORD_HOSPITAL_CHAT_WEBHOOK is missing or invalid' });

    const pushedBy = bugFixDisplayName(requester[3] || 'Unknown');
    const embed = bugFixEmbed({ title, details, author: bugFixDisplayName(draft.author), pushedBy, url });
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'BUG FIXER', embeds: [embed] })
    });
    if (!response.ok) throw new Error(`Discord webhook failed (${response.status})`);
    await writeDrafts(drafts.filter(item => item.id !== draftId));
    return json(res, 200, { success: true });
  } catch (error) {
    console.error('Bug Fixer handler failed:', error);
    return json(res, 500, { error: error.message || 'Bug Fixer request failed' });
  }
}
