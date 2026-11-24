import assert from 'node:assert/strict';
import http from 'node:http';

process.env.APP_SESSION_SECRET = 'guide-smoke-session-secret';
process.env.GOOGLE_API_KEY = 'guide-smoke-api-key';
const { createAuthCookieValue } = await import('../lib/auth-session.js');
const { default: guideHandler } = await import('../api/guide.js');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('https://sheets.googleapis.com/')) {
    const member = Array(20).fill('');
    member[2] = '105';
    member[19] = 'guide-smoke-member';
    return new Response(JSON.stringify({ values: [['header'], member] }), { status: 200 });
  }
  return nativeFetch(url, options);
};
const authCookie = `medici_auth=${encodeURIComponent(createAuthCookieValue('guide-smoke-member'))}`;

const server = http.createServer((req, res) => {
  res.status = code => {
    res.statusCode = code;
    return {
      send: content => res.end(content),
      json: content => res.end(JSON.stringify(content))
    };
  };
  guideHandler(req, res);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const { port } = server.address();
  const guide = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: authCookie } });
  const html = await guide.text();
  assert.equal(guide.status, 200);
  assert.match(html, /href="\/assets\/guide\/assets\/site\.css"/);
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/);
  assert.match(html, /id="introducere"/);
  assert.doesNotMatch(html, /<script\b/i);
  const image = await fetch(`http://127.0.0.1:${port}/assets/guide/sigla_spital_noua.png`, { headers: { cookie: authCookie } });
  assert.equal(image.status, 200);
  const css = await fetch(`http://127.0.0.1:${port}/assets/guide/assets/site.css`, { headers: { cookie: authCookie } });
  assert.equal(css.status, 200);
  console.log('Guide endpoint and local image/style checks passed.');
} finally {
  server.close();
  globalThis.fetch = nativeFetch;
}
