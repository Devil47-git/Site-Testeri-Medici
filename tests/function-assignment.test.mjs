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
const redisCommands = [];
globalThis.fetch = async (_url, options = {}) => {
  const command = JSON.parse(options.body);
  redisCommands.push(command);
  if (command[0] === 'HGETALL') return new Response(JSON.stringify({ result: ['target-id', '["Moderator"]'] }), { status: 200 });
  return new Response(JSON.stringify({ result: 1 }), { status: 200 });
};
const { default: handler } = await import('../api/access/functions.js');
globalThis.fetch = importedFetch;

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function members() {
  const leader = Array(20).fill('');
  leader[2] = '001';
  leader[3] = 'Director';
  leader[19] = 'leader-id';
  const member = Array(20).fill('');
  member[2] = '105';
  member[3] = 'Member';
  member[10] = 'PILOT / P';
  member[19] = 'target-id';
  return [['header'], leader, member];
}

test('function directory overlays leadership assignments on Docs without writing them back', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /sheets\.googleapis\.com/);
    return new Response(JSON.stringify({ values: members() }), { status: 200 });
  };
  redisCommands.length = 0;
  try {
    const response = createResponse();
    await handler({ method: 'GET', query: { requesterId: 'leader-id' } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.assignments.find(item => item.discordId === 'target-id').functionIds, ['Moderator']);
    assert.equal(response.body.assignments.find(item => item.discordId === 'target-id').isOverride, true);
    assert.deepEqual(redisCommands, [['HGETALL', 'panel-medici:member-functions:overrides']]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('only leadership can save overrides or return a member to Docs functions', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /sheets\.googleapis\.com/);
    return new Response(JSON.stringify({ values: members() }), { status: 200 });
  };
  redisCommands.length = 0;
  try {
    const denied = createResponse();
    await handler({ method: 'POST', body: { requesterId: 'target-id', targetDiscordId: 'target-id', functionIds: ['Helper'] } }, denied);
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(redisCommands, []);

    const saved = createResponse();
    await handler({ method: 'POST', body: { requesterId: 'leader-id', targetDiscordId: 'target-id', functionIds: ['Helper'] } }, saved);
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.assignment.isOverride, true);
    assert.deepEqual(redisCommands[0], ['HSET', 'panel-medici:member-functions:overrides', 'target-id', '["Helper"]']);

    const restored = createResponse();
    await handler({ method: 'POST', body: { requesterId: 'leader-id', targetDiscordId: 'target-id', useDocs: true } }, restored);
    assert.equal(restored.statusCode, 200);
    assert.deepEqual(restored.body.assignment.functionIds, ['PILOT / P']);
    assert.equal(restored.body.assignment.isOverride, false);
    assert.deepEqual(redisCommands[1], ['HDEL', 'panel-medici:member-functions:overrides', 'target-id']);
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
