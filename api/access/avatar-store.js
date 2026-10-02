const AVATAR_HASHES_KEY = 'discord:avatar-hashes:v1';

export async function storeDiscordAvatarHash(redis, discordId, avatarHash) {
  const id = String(discordId || '').trim();
  if (!redis?.isConfigured || !id) return false;
  await redis.command('HSET', AVATAR_HASHES_KEY, id, String(avatarHash || '').trim());
  return true;
}

export async function readDiscordAvatarHashes(redis, discordIds) {
  const ids = [...new Set(discordIds.map(id => String(id || '').trim()).filter(Boolean))];
  if (!redis?.isConfigured || !ids.length) return new Map();
  const hashes = await redis.command('HMGET', AVATAR_HASHES_KEY, ...ids);
  if (!Array.isArray(hashes)) throw new Error('Invalid Discord avatar hash response');
  return new Map(ids.map((id, index) => [id, hashes[index] == null ? null : String(hashes[index]).trim()]));
}

export function discordAvatarHashFromUrl(avatarUrl, discordId) {
  const id = String(discordId || '').trim();
  if (!id) return '';
  try {
    const url = new URL(String(avatarUrl || ''));
    const match = url.pathname.match(/^\/avatars\/(\d+)\/([A-Za-z0-9_-]+)\.png$/);
    return url.origin === 'https://cdn.discordapp.com' && !url.search && !url.hash && match?.[1] === id ? match[2] : '';
  } catch {
    return '';
  }
}

export function avatarUrlForDiscordMember(discordId, sheetAvatarHash, sharedAvatarHashes) {
  const id = String(discordId || '').trim();
  if (!id) return '';
  const sharedHash = sharedAvatarHashes?.get(id);
  const hash = sharedHash == null ? sheetAvatarHash : sharedHash;
  const normalizedHash = String(hash || '').trim();
  return normalizedHash ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(id)}/${encodeURIComponent(normalizedHash)}.png` : '';
}