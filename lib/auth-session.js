import crypto from 'node:crypto';

export const AUTH_COOKIE_NAME = 'medici_auth';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function signingSecret() {
  return String(process.env.APP_SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET || '').trim();
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function cookieValue(req) {
  const cookies = String(req.headers?.cookie || '').split(';');
  for (const item of cookies) {
    const separator = item.indexOf('=');
    if (separator >= 0 && item.slice(0, separator).trim() === AUTH_COOKIE_NAME) {
      try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

export function createAuthCookieValue(discordId, expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000) {
  const secret = signingSecret();
  if (!secret) throw new Error('Application session signing secret is not configured');
  const payload = Buffer.from(JSON.stringify({ discordId: String(discordId), expiresAt })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function setAuthCookie(res, discordId) {
  const token = createAuthCookieValue(discordId);
  const secure = process.env.NODE_ENV === 'production' || process.env.HTTPS === 'true';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`);
}

export function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.HTTPS === 'true';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}

export function authenticatedDiscordId(req) {
  const token = cookieValue(req);
  const separator = token.lastIndexOf('.');
  const secret = signingSecret();
  if (separator <= 0 || !secret) return '';
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return '';
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof session.discordId === 'string' && session.discordId && Number(session.expiresAt) > Date.now()
      ? session.discordId
      : '';
  } catch {
    return '';
  }
}
