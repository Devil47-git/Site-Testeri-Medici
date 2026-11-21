import { authenticatedDiscordId, setAuthCookie, clearAuthCookie } from '../../lib/auth-session.js';
import { setNoStoreHeaders } from '../../lib/http.js';
import { publicUserForDiscordId } from '../../lib/public-user.js';

export default async function handler(req, res) {
  setNoStoreHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const discordId = authenticatedDiscordId(req);
  if (!discordId) return res.status(401).json({ authorized: false });
  try {
    const user = await publicUserForDiscordId(discordId);
    if (!user) { clearAuthCookie(res); return res.status(401).json({ authorized: false }); }
    setAuthCookie(res, discordId);
    return res.status(200).json({ authorized: true, user });
  } catch (error) {
    console.error('Session verification failed:', error);
    return res.status(503).json({ authorized: false, error: 'Session verification unavailable' });
  }
}
