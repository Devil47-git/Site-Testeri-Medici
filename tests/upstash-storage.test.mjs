import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpstashRedis } from '../api/storage/upstash-redis.js';
import { addBonusEntries, clearBonusEntries, importLegacyBonusEntries, listBonusEntries } from '../api/access/bonus-store.js';

function memoryRedis() {
  const sets = new Map();
  const values = new Map();
  return {
    async pipeline(commands) {
      return commands.map(([command, key, value]) => {
        if (command === 'SADD') {
          const set = sets.get(key) || new Set();
          const size = set.size;
          set.add(value);
          sets.set(key, set);
          return set.size === size ? 0 : 1;
        }
        if (command === 'SMEMBERS') return [...(sets.get(key) || [])];
        if (command === 'EXISTS') return Number(values.has(key));
        if (command === 'SET') { values.set(key, value); return 'OK'; }
        if (command === 'DEL') return Number(sets.delete(key) || values.delete(key));
        throw new Error(`Unexpected Redis command: ${command}`);
      });
    }
  };
}

test('Upstash REST client sends authenticated commands and parses results', async () => {
  let request;
  const redis = new UpstashRedis({
    url: 'https://redis.example.com/',
    token: 'test-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ result: 'OK' }) };
    }
  });

  assert.equal(await redis.command('SET', 'test:key', 'value'), 'OK');
  assert.equal(request.url, 'https://redis.example.com');
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(request.options.body), ['SET', 'test:key', 'value']);
});

test('Upstash pipeline returns each command result and JSON helpers round-trip values', async () => {
  const requests = [];
  const redis = new UpstashRedis({
    url: 'https://redis.example.com',
    token: 'test-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const body = JSON.parse(options.body);
      if (url.endsWith('/pipeline')) return { ok: true, status: 200, json: async () => [{ result: 1 }, { result: ['one'] }] };
      if (body[0] === 'SET') return { ok: true, status: 200, json: async () => ({ result: 'OK' }) };
      return { ok: true, status: 200, json: async () => ({ result: '{"ready":true}' }) };
    }
  });

  assert.deepEqual(await redis.pipeline([['EXISTS', 'test:key'], ['SMEMBERS', 'test:set']]), [1, ['one']]);
  await redis.setJson('test:json', { ready: true }, { expirationSeconds: 60 });
  assert.deepEqual(await redis.getJson('test:json'), { ready: true });
  assert.equal(requests[0].url, 'https://redis.example.com/pipeline');
  assert.deepEqual(JSON.parse(requests[1].options.body), ['SET', 'test:json', '{"ready":true}', 'EX', '60']);
});

test('Upstash client clearly reports missing credentials', async () => {
  const redis = new UpstashRedis({ url: '', token: '' });
  assert.equal(redis.isConfigured, false);
  await assert.rejects(redis.command('GET', 'test:key'), /Upstash Redis is not configured/);
});

test('bonus store imports legacy rows once, deduplicates, and uses Bucharest dates', async () => {
  const redis = memoryRedis();
  const legacyEntry = {
    callsign: '105',
    testerName: 'Tester',
    testName: 'Test ALS',
    result: 'Admis',
    createdAt: '2026-10-02T22:30:00.000Z'
  };
  const ignoredEntry = { ...legacyEntry, testName: 'Test parașutiști' };

  await importLegacyBonusEntries(redis, [legacyEntry, ignoredEntry], '2026-10-02', '2026-10-03');
  await importLegacyBonusEntries(redis, [legacyEntry, ignoredEntry], '2026-10-02', '2026-10-03');
  await addBonusEntries(redis, [legacyEntry]);

  assert.deepEqual(await listBonusEntries(redis, '2026-10-02', '2026-10-03'), [legacyEntry]);
});

test('legacy bonus import can retry after a Redis entry write fails', async () => {
  const storage = memoryRedis();
  let failEntryWrite = true;
  const redis = {
    async pipeline(commands) {
      if (failEntryWrite && commands.some(([command]) => command === 'SADD')) {
        failEntryWrite = false;
        throw new Error('Temporary Redis failure');
      }
      return storage.pipeline(commands);
    }
  };
  const entry = {
    callsign: '105',
    testerName: 'Tester',
    testName: 'Test ALS',
    result: 'Admis',
    createdAt: '2026-10-02T10:00:00.000Z'
  };

  await assert.rejects(importLegacyBonusEntries(redis, [entry], '2026-10-02', '2026-10-02'), /Temporary Redis failure/);
  await importLegacyBonusEntries(redis, [entry], '2026-10-02', '2026-10-02');
  assert.deepEqual(await listBonusEntries(redis, '2026-10-02', '2026-10-02'), [entry]);
});

test('bonus reset clears persisted entries and import markers', async () => {
  const redis = memoryRedis();
  const entry = {
    callsign: '105',
    testerName: 'Tester',
    testName: 'Test ALS',
    result: 'Admis',
    createdAt: '2026-10-02T10:00:00.000Z'
  };
  await importLegacyBonusEntries(redis, [entry], '2026-10-02', '2026-10-02');
  await clearBonusEntries(redis);
  await importLegacyBonusEntries(redis, [entry], '2026-10-02', '2026-10-02');
  assert.deepEqual(await listBonusEntries(redis, '2026-10-02', '2026-10-02'), [entry]);
});
