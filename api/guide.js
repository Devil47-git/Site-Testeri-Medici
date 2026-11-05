import fs from 'node:fs/promises';
import path from 'node:path';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const html = await fs.readFile(path.join(process.cwd(), 'assets', 'guide', 'index.html'), 'utf8');
    const bundledGuide = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/\s+on(?:click|error|load|change|input|mouseover)=(['"])[\s\S]*?\1/gi, '')
      .replace(/<link\b[^>]*>/gi, tag => /\bhref\s*=\s*(['"])https?:/i.test(tag) ? '' : tag)
      .replace(/(href|src)=(['"])(?!https?:|data:|#|\/)([^'"]+)\2/gi, (_, attribute, quote, resource) => `${attribute}=${quote}/assets/guide/${resource.split('/').map(encodeURIComponent).join('/').replace(/%2F/gi, '/').replace(/%20/gi, '%20')}${quote}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(bundledGuide);
  } catch (error) {
    console.error('Bundled guide could not be loaded:', error);
    return res.status(500).json({ error: 'Ghidul oficial nu a putut fi încărcat.' });
  }
}
