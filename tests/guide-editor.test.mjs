import { test } from 'node:test';
import assert from 'node:assert/strict';

const previousEnvironment = {
  apiKey: process.env.GOOGLE_API_KEY,
  redisUrl: process.env.UPSTASH_REDIS_REST_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN
};
process.env.GOOGLE_API_KEY = 'test-key';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
const importedFetch = globalThis.fetch;
const redisWrites = [];
globalThis.fetch = async (_url, options = {}) => {
  redisWrites.push(JSON.parse(options.body));
  return new Response(JSON.stringify({ result: 1 }), { status: 200 });
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
    if (previousEnvironment.redisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousEnvironment.redisUrl;
    if (previousEnvironment.redisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousEnvironment.redisToken;
  }
});
