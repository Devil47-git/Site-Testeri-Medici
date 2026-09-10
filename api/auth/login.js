export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) return res.status(500).send('Discord OAuth is not configured');
  const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: DISCORD_REDIRECT_URI, scope: 'identify' });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
}
