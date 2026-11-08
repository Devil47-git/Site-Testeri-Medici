import { UpstashRedis } from '../storage/upstash-redis.js';

export const FUNCTION_OVERRIDES_KEY = 'panel-medici:member-functions:overrides';
const functionOverridesRedis = new UpstashRedis();

export async function readFunctionOverrides(redis = functionOverridesRedis) {
  if (!redis.isConfigured) return new Map();
  const result = await redis.command('HGETALL', FUNCTION_OVERRIDES_KEY);
  if (!Array.isArray(result)) throw new Error('Member function override storage returned an invalid response');
  const overrides = new Map();
  for (let index = 0; index + 1 < result.length; index += 2) {
    const discordId = String(result[index] || '').trim();
    const values = JSON.parse(String(result[index + 1] || '[]'));
    if (!discordId || !Array.isArray(values) || values.some(value => typeof value !== 'string')) {
      throw new Error('Member function override storage contains invalid data');
    }
    overrides.set(discordId, values);
  }
  return overrides;
}

export function functionsForDepartmentRow(row, overrides = new Map()) {
  const discordId = String(row?.[19] || '').trim();
  return discordId && overrides.has(discordId)
    ? overrides.get(discordId).join(' | ')
    : String(row?.[10] || '').trim();
}

export async function saveFunctionOverride(discordId, functionIds, redis = functionOverridesRedis) {
  if (!redis.isConfigured) throw new Error('Member function override storage is not configured');
  await redis.command('HSET', FUNCTION_OVERRIDES_KEY, discordId, JSON.stringify(functionIds));
}

export async function removeFunctionOverride(discordId, redis = functionOverridesRedis) {
  if (!redis.isConfigured) throw new Error('Member function override storage is not configured');
  await redis.command('HDEL', FUNCTION_OVERRIDES_KEY, discordId);
}

export function functionOverridesConfigured(redis = functionOverridesRedis) {
  return Boolean(redis.isConfigured);
}
