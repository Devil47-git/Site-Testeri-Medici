import { test } from 'node:test';
import assert from 'node:assert/strict';

const previousEnvironment = {
  apiKey: process.env.GOOGLE_API_KEY,
  sessionSecret: process.env.APP_SESSION_SECRET
};
process.env.GOOGLE_API_KEY = 'test-key';
process.env.APP_SESSION_SECRET = 'test-session-secret';

const { default: handler } = await import('../api/auth/session.js');
const { createAuthCookieValue } = await import('../lib/auth-session.js');
const importedFetch = globalThis.fetch;

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('session validates its signed identity and exposes only the public member fields', async () => {
  const member = Array(20).fill('');
  member[1] = 'internal-row-id';
  member[2] = '101';
  member[3] = 'Tester';
  member[4] = 'Medic';
  member[5] = 'Medical';
  member[6] = 'private@example.test';
  member[7] = 'password-hash';
  member[10] = 'PILOT';
  member[19] = 'discord-123';
  globalThis.fetch = async url => {
    assert.match(String(url), /sheets\.googleapis\.com/);
    return new Response(JSON.stringify({ values: [['header'], member] }), { status: 200 });
  };

  try {
    const response = createResponse();
    const cookie = `medici_auth=${encodeURIComponent(createAuthCookieValue('discord-123'))}`;
    await handler({ method: 'GET', headers: { cookie } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.user.discordId, 'discord-123');
    assert.equal(response.body.user.name, 'Tester');
    assert.equal(Object.hasOwn(response.body.user, 'email'), false);
    assert.equal(Object.hasOwn(response.body.user, 'password'), false);
    assert.equal(Object.hasOwn(response.body.user, 'passwordHash'), false);
    assert.match(response.headers['Set-Cookie'], /HttpOnly/);
  } finally {
    globalThis.fetch = importedFetch;
    if (previousEnvironment.apiKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previousEnvironment.apiKey;
    if (previousEnvironment.sessionSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previousEnvironment.sessionSecret;
  }
});
