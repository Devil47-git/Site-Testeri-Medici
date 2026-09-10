export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = process.env;
  const missing = [
    !DISCORD_CLIENT_ID && 'DISCORD_CLIENT_ID',
    !DISCORD_REDIRECT_URI && 'DISCORD_REDIRECT_URI'
  ].filter(Boolean);
  if (missing.length) {
    return res.status(500).json({
      error: 'Discord OAuth is not configured',
      missing,
      hint: 'Adaugă variabilele în Vercel pentru Production și fă Redeploy după salvare.'
    });
  }
  const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID.trim(), response_type: 'code', redirect_uri: DISCORD_REDIRECT_URI.trim(), scope: 'identify' });
  return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
}
