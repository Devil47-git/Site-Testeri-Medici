import { authenticatedDiscordId } from './auth-session.js';

export function requireRequester(req, res, requestedId) {
  const authenticatedId = authenticatedDiscordId(req);
  if (!authenticatedId) {
    res.status(401).json({ error: 'Authentication required' });
    return '';
  }
  if (String(requestedId || '').trim() !== authenticatedId) {
    res.status(403).json({ error: 'Requester does not match the authenticated user' });
    return '';
  }
  return authenticatedId;
}
