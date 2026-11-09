import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const KEY_PATTERNS = [
  'site-testeri-medici:attendance:*',
  'site-testeri-medici:attendance-review:*',
  'site-testeri-medici:attendance-docs-sync:*',
  'site-testeri-medici:bonuses:v1:*',
  'discord:avatar-hashes:v1',
  'panel-medici:guide:overrides',
  'panel-medici:member-functions:overrides'
];

const container = process.env.RDB_REDIS_CONTAINER || 'site-medici-rdb-local';

function redis(...args) {
  const output = execFileSync('docker', ['exec', container, 'redis-cli', '--json', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  return output ? JSON.parse(output) : null;
}

function scan(pattern) {
  const keys = new Set();
  let cursor = '0';
  do {
    const result = redis('SCAN', cursor, 'MATCH', pattern, 'COUNT', '500');
    if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[1])) {
      throw new Error(`Invalid local Redis SCAN response for ${pattern}`);
    }
    cursor = String(result[0]);
    result[1].forEach(key => keys.add(String(key)));
  } while (cursor !== '0');
  return [...keys];
}

const [, , fileName = 'upstash-export-from-rdb.json'] = process.argv;
try {
  const keys = new Set();
  for (const pattern of KEY_PATTERNS) scan(pattern).forEach(key => keys.add(key));

  const entries = [];
  for (const key of keys) {
    const kind = redis('TYPE', key);
    const ttl = Number(redis('TTL', key));
    let value;
    if (kind === 'string') {
      value = redis('GET', key);
    } else if (kind === 'hash') {
      const fields = redis('HGETALL', key);
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.values(fields).some(field => typeof field !== 'string')) {
        throw new Error(`Invalid local Redis hash for ${key}`);
      }
      value = fields;
    } else if (kind === 'set') {
      value = redis('SMEMBERS', key);
      if (!Array.isArray(value)) throw new Error(`Invalid local Redis set for ${key}`);
    } else {
      throw new Error(`Unsupported local Redis key type "${kind}" for ${key}`);
    }

    if (ttl === -2 || value == null) continue;
    entries.push({
      key,
      kind,
      value,
      expiresAt: ttl >= 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null
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
  console.log(`Exported ${entries.length} application keys to ${output}`);
  console.log('The RDB remains unchanged. Keep this backup private and do not commit it.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
