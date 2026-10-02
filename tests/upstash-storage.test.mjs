import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpstashRedis } from '../api/storage/upstash-redis.js';
import { avatarUrlForDiscordMember, discordAvatarHashFromUrl, readDiscordAvatarHashes, storeDiscordAvatarHash } from '../api/access/avatar-store.js';
import { addBonusEntries, clearBonusEntries, importLegacyBonusEntries, listBonusEntries } from '../api/access/bonus-store.js';

function memoryRedis() {
  const sets = new Map();
  const values = new Map();
  return {
    get isConfigured() { return true; },
    async command(command, key, ...args) {
      if (command === 'HSET') {
        const hashes = values.get(key) || new Map();
        hashes.set(args[0], args[1]);
        values.set(key, hashes);
        return 1;
      }
      if (command === 'HMGET') {
        const hashes = values.get(key) || new Map();
        return args.map(id => hashes.has(id) ? hashes.get(id) : null);
      }
      throw new Error(`Unexpected Redis command: ${command}`);
    },
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

test('Discord avatar hashes are shared across members and override sheet values', async () => {
  const redis = memoryRedis();
  await storeDiscordAvatarHash(redis, '123', 'current-hash');
  await storeDiscordAvatarHash(redis, '456', 'other-hash');
  const hashes = await readDiscordAvatarHashes(redis, ['123', '456', '789']);

  assert.equal(avatarUrlForDiscordMember('123', 'stale-sheet-hash', hashes), 'https://cdn.discordapp.com/avatars/123/current-hash.png');
  assert.equal(avatarUrlForDiscordMember('456', '', hashes), 'https://cdn.discordapp.com/avatars/456/other-hash.png');
  assert.equal(avatarUrlForDiscordMember('789', 'sheet-hash', hashes), 'https://cdn.discordapp.com/avatars/789/sheet-hash.png');

  await storeDiscordAvatarHash(redis, '123', '');
  const hashesAfterRemoval = await readDiscordAvatarHashes(redis, ['123']);
  assert.equal(avatarUrlForDiscordMember('123', 'stale-sheet-hash', hashesAfterRemoval), '');
});

test('cached Discord avatar sync accepts only the matching member CDN URL', () => {
  assert.equal(discordAvatarHashFromUrl('https://cdn.discordapp.com/avatars/123/a_hash.png', '123'), 'a_hash');
  assert.equal(discordAvatarHashFromUrl('https://cdn.discordapp.com/avatars/456/hash.png', '123'), '');
  assert.equal(discordAvatarHashFromUrl('https://example.com/avatars/123/hash.png', '123'), '');
  assert.equal(discordAvatarHashFromUrl('https://cdn.discordapp.com/avatars/123/hash.png?size=64', '123'), '');
});

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
