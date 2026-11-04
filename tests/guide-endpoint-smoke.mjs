import assert from 'node:assert/strict';
import http from 'node:http';
import guideHandler from '../api/guide.js';

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
  const guide = await fetch(`http://127.0.0.1:${port}/`);
  const html = await guide.text();
  assert.equal(guide.status, 200);
  assert.match(html, /href="\/assets\/guide\/assets\/site\.css"/);
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/);
  assert.match(html, /id="introducere"/);
  assert.doesNotMatch(html, /<script\b/i);
  const image = await fetch(`http://127.0.0.1:${port}/assets/guide/sigla_spital_noua.png`);
  assert.equal(image.status, 200);
  const css = await fetch(`http://127.0.0.1:${port}/assets/guide/assets/site.css`);
  assert.equal(css.status, 200);
  console.log('Guide endpoint and local image/style checks passed.');
} finally {
  server.close();
}
