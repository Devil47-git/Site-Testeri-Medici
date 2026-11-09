import { test } from 'node:test';
import assert from 'node:assert/strict';

const previousEnvironment = {
  apiKey: process.env.GOOGLE_API_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SECRET_KEY
};
process.env.GOOGLE_API_KEY = 'test-key';
process.env.SUPABASE_URL = 'https://project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
const importedFetch = globalThis.fetch;
const redisWrites = [];
let redisReadFailure = false;
globalThis.fetch = async (url, options = {}) => {
  if (redisReadFailure) throw new Error('Redis unavailable');
  const payload = JSON.parse(options.body);
  redisWrites.push([payload.p_command, ...(payload.p_args || [])]);
  return new Response(JSON.stringify(1), { status: 200 });
};
const { default: handler, sanitizeGuideSection } = await import('../api/guide.js');
globalThis.fetch = importedFetch;

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }
  };
}

function departmentRows() {
  const leader = Array(20).fill('');
  leader[2] = '001';
  leader[3] = 'Director';
  leader[19] = 'leader-id';
  const member = Array(20).fill('');
  member[2] = '105';
  member[3] = 'Medic';
  member[19] = 'member-id';
  return [['header'], leader, member];
}

test('guide editor strips scripts, event handlers, unsafe URLs, and dangerous inline CSS', () => {
  const sanitized = sanitizeGuideSection('<button class="jaf-btn" data-jaf="uniforme">Tab</button><img src="/assets/guide/photo.png" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">link</a><p style="color:#fff;background:url(https://evil.test/x)">safe</p>');
  assert.match(sanitized, /data-jaf="uniforme"/);
  assert.match(sanitized, /src="\/assets\/guide\/photo\.png"/);
  assert.doesNotMatch(sanitized, /script|onerror|javascript:|url\(/i);
  assert.match(sanitized, /color:#fff/i);
});

test('guide API rewrites raid-guide image paths to the bundled static-asset route', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ result: [] }), { status: 200 });
  try {
    const response = createResponse();
    await handler({ method: 'GET', query: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /src="\/assets\/guide\/jaf%20poze\/POV%20PACIFIC%20COMPLET\.jpg"/);
    assert.doesNotMatch(response.body, /src="jaf poze\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guide API serves the bundled guide when saved overrides cannot be read', async () => {
  redisReadFailure = true;
  try {
    const response = createResponse();
    await handler({ method: 'GET', query: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['X-Guide-Overrides-Status'], 'unavailable');
    assert.match(response.body, /id="introducere"/);
  } finally {
    redisReadFailure = false;
  }
});

test('only leadership can save guide sections, and stored HTML is sanitized', async () => {
  const originalFetch = globalThis.fetch;
  redisWrites.length = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('https://sheets.googleapis.com/')) {
      return new Response(JSON.stringify({ values: departmentRows() }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const denied = createResponse();
    await handler({ method: 'POST', body: { requesterId: 'member-id', section: 'uniforme', content: '<p>text</p>' } }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(redisWrites.length, 0);

    const saved = createResponse();
    await handler({ method: 'POST', body: { requesterId: 'leader-id', section: 'uniforme', content: '<p onclick="alert(1)">Updated</p><script>alert(1)</script>' } }, saved);
    assert.equal(saved.statusCode, 200);
    assert.equal(redisWrites.length, 1);
    assert.deepEqual(redisWrites[0].slice(0, 3), ['HSET', 'panel-medici:guide:overrides', 'uniforme']);
    assert.equal(saved.body.content, '<p>Updated</p>');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnvironment.apiKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previousEnvironment.apiKey;
    if (previousEnvironment.supabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousEnvironment.supabaseUrl;
    if (previousEnvironment.supabaseKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousEnvironment.supabaseKey;
  }
});
