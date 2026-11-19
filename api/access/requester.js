import '../../lib/config.js';
import { authenticatedDiscordId } from '../../lib/auth-session.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const discordId = authenticatedDiscordId(req);
  if (!discordId) return res.status(401).json({ error: 'Authentication required' });
  const requestedId = String(req.method === 'GET' ? req.query?.discordId || '' : req.body?.discordId || '').trim();
  if (requestedId && requestedId !== discordId) return res.status(403).json({ error: 'Requested identity does not match session' });
  return res.status(200).json({ discordId });
}
