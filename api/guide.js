import '../lib/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { callsignNumber, LEADERSHIP_MAX } from '../lib/access/shared.js';
import { UpstashRedis } from '../lib/storage/upstash-redis.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GUIDE_OVERRIDE_KEY = 'panel-medici:guide:overrides';
const MAX_GUIDE_SECTION_LENGTH = 1000000;
const guideRedis = new UpstashRedis();
const safeStyleValue = /^(?!.*(?:url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding)).*$/i;
const allowedStyleProperties = [
  'align-items', 'background', 'background-color', 'border', 'border-radius', 'box-shadow',
  'border-bottom', 'border-collapse', 'border-spacing', 'border-top', 'color', 'cursor',
  'display', 'flex', 'flex-direction', 'flex-wrap', 'font-family', 'font-size', 'font-style',
  'font-weight', 'gap', 'grid-template-columns', 'height', 'justify-content', 'letter-spacing',
  'line-height', 'list-style', 'margin', 'margin-left', 'margin-top', 'max-height', 'max-width',
  'min-height', 'min-width', 'object-fit', 'overflow', 'overflow-x', 'padding', 'padding-left',
  'text-align', 'text-decoration', 'text-shadow', 'text-transform', 'white-space', 'width'
];
const guideSanitizerOptions = {
  allowedTags: [...new Set([...sanitizeHtml.defaults.allowedTags, 'button', 'figure', 'figcaption', 'img', 'video', 'source'])],
  allowedAttributes: {
    '*': ['class', 'id', 'title', 'style', 'role', 'aria-label', 'aria-hidden', 'data-jaf', 'data-jaf-tab', 'data-guide-target', 'data-guide-jaf-open'],
    a: ['href', 'target', 'rel'],
    button: ['type'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    video: ['src', 'poster', 'controls', 'width', 'height'],
    source: ['src', 'type']
  },
  allowedStyles: {
    '*': Object.fromEntries(allowedStyleProperties.map(property => [property, [safeStyleValue]]))
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false
};

function json(res, status, body) { return res.status(status).json(body); }
export function sanitizeGuideSection(content) {
  return sanitizeHtml(String(content || ''), guideSanitizerOptions);
}
function guideSectionIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const attributes = match[2];
    if (!/\bclass\s*=\s*(['"])[^'"]*\bsection\b[^'"]*\1/i.test(attributes)) continue;
    const id = attributes.match(/\bid\s*=\s*(['"])([^'"]+)\1/i)?.[2];
    if (id) ids.add(id);
  }
  return ids;
}
async function readGuideSource() {
  return fs.readFile(path.join(process.cwd(), 'assets', 'guide', 'index.html'), 'utf8');
}
async function readPublicMembers() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MEMBER_RANGE)}?key=${encodeURIComponent(key)}`);
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.values)) throw new Error('Google Sheets member lookup failed');
  return data.values.slice(1).filter(Array.isArray);
}
async function readGuideOverrides() {
  if (!guideRedis.isConfigured) return {};
  const result = await guideRedis.command('HGETALL', GUIDE_OVERRIDE_KEY);
  if (!Array.isArray(result)) return {};
  const overrides = {};
  for (let index = 0; index + 1 < result.length; index += 2) {
    overrides[String(result[index])] = String(result[index + 1]);
  }
  return overrides;
}
function insertGuideOverrides(html, overrides, validSections) {
  const templates = Object.entries(overrides)
    .filter(([section, content]) => validSections.has(section) && typeof content === 'string')
    .map(([section, content]) => `<template data-guide-override="${section}">${sanitizeGuideSection(content)}</template>`)
    .join('');
  return html.replace(/<\/head\s*>/i, `${templates}</head>`);
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const html = await readGuideSource();
    const validSections = guideSectionIds(html);
    if (req.method === 'GET') {
      const overrides = await readGuideOverrides();
      const bundledGuide = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<link\b[^>]*>/gi, tag => /\bhref\s*=\s*(['"])https?:/i.test(tag) ? '' : tag)
        .replace(/(href|src)=(['"])(?!https?:|data:|#|\/)([^'"]+)\2/gi, (_, attribute, quote, resource) => `${attribute}=${quote}/assets/guide/${resource.split('/').map(encodeURIComponent).join('/').replace(/%2F/gi, '/').replace(/%20/gi, '%20')}${quote}`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(insertGuideOverrides(bundledGuide, overrides, validSections));
    }

    const requesterId = typeof req.body?.requesterId === 'string' ? req.body.requesterId.trim() : '';
    const section = typeof req.body?.section === 'string' ? req.body.section.trim() : '';
    const content = req.body?.content;
    if (!requesterId) return json(res, 400, { error: 'Missing requesterId' });
    if (!validSections.has(section)) return json(res, 400, { error: 'Invalid guide section' });
    if (typeof content !== 'string' || content.length > MAX_GUIDE_SECTION_LENGTH) {
      return json(res, 413, { error: 'Guide section content is invalid or too large' });
    }
    if (!guideRedis.isConfigured) return json(res, 503, { error: 'Guide editing storage is not configured' });

    const members = await readPublicMembers();
    const requester = members.find(row => String(row[19] || '').trim() === requesterId);
    if (!requester) return json(res, 403, { error: 'Requester is not a department member' });
    const requesterCallsign = callsignNumber(requester[2]);
    if (requesterCallsign < 1 || requesterCallsign > LEADERSHIP_MAX) {
      return json(res, 403, { error: 'Only leadership can edit the hospital guide' });
    }

    const sanitizedContent = sanitizeGuideSection(content);
    await guideRedis.command('HSET', GUIDE_OVERRIDE_KEY, section, sanitizedContent);
    return json(res, 200, { success: true, section, content: sanitizedContent, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Guide request failed:', error);
    return json(res, 500, { error: 'The hospital guide could not be loaded or saved.' });
  }
}
