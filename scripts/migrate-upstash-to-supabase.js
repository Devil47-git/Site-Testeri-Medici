import '../lib/env.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UpstashRedis } from '../lib/storage/upstash-redis.js';
import { SupabaseKV } from '../lib/storage/supabase-kv.js';

const KEY_PATTERNS = [
  'site-testeri-medici:attendance:*',
  'site-testeri-medici:attendance-review:*',
  'site-testeri-medici:attendance-docs-sync:*',
  'site-testeri-medici:bonuses:v1:*',
  'discord:avatar-hashes:v1',
  'panel-medici:guide:overrides',
  'panel-medici:member-functions:overrides'
];

async function scanPattern(redis, pattern) {
  const keys = new Set();
  let cursor = '0';
  do {
    const result = await redis.command('SCAN', cursor, 'MATCH', pattern, 'COUNT', '500');
    if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[1])) {
      throw new Error(`Invalid Upstash SCAN response for ${pattern}`);
    }
    cursor = String(result[0]);
    result[1].forEach(key => keys.add(String(key)));
  } while (cursor !== '0');
  return [...keys];
}

async function exportData(fileName) {
  const redis = new UpstashRedis();
  if (!redis.isConfigured) throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN before exporting');

  const keys = new Set();
  for (const pattern of KEY_PATTERNS) {
    (await scanPattern(redis, pattern)).forEach(key => keys.add(key));
  }

  const entries = [];
  for (const key of keys) {
    const [kind, ttl] = await Promise.all([
      redis.command('TYPE', key),
      redis.command('TTL', key)
    ]);
    let value;
    if (kind === 'string') {
      value = await redis.command('GET', key);
    } else if (kind === 'hash') {
      const fields = await redis.command('HGETALL', key);
      if (!Array.isArray(fields) || fields.length % 2 !== 0) throw new Error(`Invalid Upstash hash data for ${key}`);
      value = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, index) => [
        String(fields[index * 2]),
        String(fields[index * 2 + 1])
      ]));
    } else if (kind === 'set') {
      value = await redis.command('SMEMBERS', key);
      if (!Array.isArray(value)) throw new Error(`Invalid Upstash set data for ${key}`);
    } else {
      throw new Error(`Unsupported Upstash key type "${kind}" for ${key}`);
    }

    if (Number(ttl) === -2 || value == null) continue;
    entries.push({
      key,
      kind,
      value,
      expiresAt: Number(ttl) >= 0 ? new Date(Date.now() + Number(ttl) * 1000).toISOString() : null
    });
  }

  const backup = {
    format: 'site-testeri-medici-upstash-export-v1',
    exportedAt: new Date().toISOString(),
    keyCount: entries.length,
    entries
  };
  const output = path.resolve(fileName);
  await writeFile(output, `${JSON.stringify(backup, null, 2)}\n`, { flag: 'wx' });
  console.log(`Exported ${entries.length} keys to ${output}`);
  console.log('Keep this backup private and do not commit it.');
}

async function importData(fileName, apply) {
  if (!apply) throw new Error('Import writes to Supabase. Re-run with --apply after reviewing the export.');
  const supabase = new SupabaseKV();
  if (!supabase.isConfigured) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY before importing');

  const backup = JSON.parse(await readFile(path.resolve(fileName), 'utf8'));
  if (backup?.format !== 'site-testeri-medici-upstash-export-v1' || !Array.isArray(backup.entries)) {
    throw new Error('Unsupported or invalid Upstash export file');
  }
  if (backup.keyCount !== backup.entries.length) throw new Error('Export key count does not match its entries');
  for (const entry of backup.entries) {
    const validValue = entry.kind === 'string'
      ? typeof entry.value === 'string'
      : entry.kind === 'hash'
        ? entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value) && Object.values(entry.value).every(value => typeof value === 'string')
        : entry.kind === 'set'
          ? Array.isArray(entry.value) && entry.value.every(value => typeof value === 'string')
          : false;
    if (!entry.key || !validValue || (entry.expiresAt != null && !Number.isFinite(Date.parse(entry.expiresAt)))) {
      throw new Error('Export contains an invalid key, value, type, or expiry');
    }
  }

  const entries = backup.entries.filter(entry => !entry.expiresAt || Date.parse(entry.expiresAt) > Date.now());
  let inserted = 0;
  for (let index = 0; index < entries.length; index += 10) {
    inserted += Number(await supabase.importEntries(entries.slice(index, index + 10)));
  }
  console.log(`Imported ${inserted} of ${entries.length} unexpired keys.`);
  if (inserted !== entries.length) {
    console.warn('Some keys already existed in Supabase and were left unchanged to avoid overwriting newer data.');
  }
  let verified = 0;
  for (let index = 0; index < entries.length; index += 10) {
    const batch = entries.slice(index, index + 10);
    const commands = batch.map(entry => [
      entry.kind === 'string' ? 'GET' : entry.kind === 'hash' ? 'HGETALL' : 'SMEMBERS',
      entry.key
    ]);
    const values = await supabase.pipeline(commands);
    batch.forEach((entry, entryIndex) => {
      let actual = values[entryIndex];
      if (entry.kind === 'hash') {
        if (!Array.isArray(actual) || actual.length % 2 !== 0) throw new Error(`Imported hash verification failed for ${entry.key}`);
        actual = Object.fromEntries(Array.from({ length: actual.length / 2 }, (_, index) => [
          String(actual[index * 2]),
          String(actual[index * 2 + 1])
        ]));
        actual = Object.fromEntries(Object.entries(actual).sort(([left], [right]) => left.localeCompare(right)));
      } else if (entry.kind === 'set') {
        if (!Array.isArray(actual)) throw new Error(`Imported set verification failed for ${entry.key}`);
        actual = [...actual].sort();
      }
      let expected = entry.value;
      if (entry.kind === 'hash') expected = Object.fromEntries(Object.entries(expected).sort(([left], [right]) => left.localeCompare(right)));
      if (entry.kind === 'set') expected = [...expected].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Imported data does not match the backup for ${entry.key}`);
      verified += 1;
    });
  }
  console.log(`Verified ${verified} keys against the backup.`);
}

const [action, fileName = `upstash-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, ...flags] = process.argv.slice(2);
try {
  if (action === 'export') await exportData(fileName);
  else if (action === 'import') await importData(fileName, flags.includes('--apply'));
  else {
    throw new Error('Usage: node scripts/migrate-upstash-to-supabase.js export [backup.json] | import <backup.json> --apply');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
