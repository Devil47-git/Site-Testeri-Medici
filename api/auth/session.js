export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(401).json({ authorized: false, message: 'Sesiunea este păstrată local timp de 3 zile după verificarea Discord.' });
}
