import fs from 'node:fs/promises';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'tests.js');
const MARKER = 'window.MEDICAL_TESTS = ';

/**
 * Reads tests.js and extracts the MEDICAL_TESTS object.
 * Returns the parsed object, or null when the file cannot be parsed.
 */
export async function readTestDefinitions() {
  try {
    const source = await fs.readFile(FILE, 'utf8');
    const start = source.indexOf(MARKER);
    if (start === -1) return null;
    let i = start + MARKER.length;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== '{') return null;
    const begin = i;
    let depth = 0, inString = false, quote = '', escaped = false;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) inString = false;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inString = true; quote = ch; continue; }
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') {
        depth--;
        if (depth === 0) {
          const literal = source.slice(begin, i + 1);
          try { return Function(`"use strict"; return (${literal});`)(); }
          catch { return null; }
        }
      }
    }
    return null;
  } catch { return null; }
}

/**
 * Serializes the definitions object back into tests.js.
 * Preserves the `window.MEDICAL_TESTS = {...};` wrapper.
 */
export async function writeTestDefinitions(definitions) {
  const body = JSON.stringify(definitions, null, 2);
  await fs.writeFile(FILE, `${MARKER}${body};\n`, 'utf8');
  return definitions;
}
