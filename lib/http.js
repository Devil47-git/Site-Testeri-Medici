export function setNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
}

export function requestPath(req) {
  try { return new URL(req.url || '/', 'http://localhost').pathname; } catch { return '/'; }
}

export function sameOrigin(req) {
  const site = req.headers?.['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers?.origin;
  if (origin) {
    try { return new URL(origin).host === req.headers?.host; } catch { return false; }
  }
  return true;
}
