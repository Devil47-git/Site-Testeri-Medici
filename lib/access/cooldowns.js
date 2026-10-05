const TIME_ZONE = 'Europe/Bucharest';
const FAILED_TEST_COOLDOWN_DAYS = {
  'Test ALS': 3,
  'Test SMULS': 5,
  'Test MOTO': 5,
  'Test PILOT': 5,
  'Test parașutiști': 5
};
const TEST_ALIASES = [
  { test: 'Test SMULS', pattern: /s\.?\s*m\.?\s*u\.?\s*l\.?\s*s\b|smuls\b/i },
  { test: 'Test parașutiști', pattern: /parasut(?:ist|ism)\w*/i },
  { test: 'Test MOTO', pattern: /moto\b/i },
  { test: 'Test PILOT', pattern: /pilot\b/i },
  { test: 'Test ALS', pattern: /a\.?\s*l\.?\s*s\.?\b|als\b/i },
  { test: 'Test rezidențiat', pattern: /rezidentiat\b|rezi\b/i },
  { test: 'Test BLS', pattern: /b\.?\s*l\.?\s*s\.?\b|bls\b/i },
  { test: 'Test RADIO', pattern: /radio\b|tet\b/i }
];
const TEST_PATTERN = /s\.?\s*m\.?\s*u\.?\s*l\.?\s*s\b|smuls\b|parasut(?:ist|ism)\w*|moto\b|pilot\b|a\.?\s*l\.?\s*s\.?\b|als\b|rezidentiat\b|rezi\b|b\.?\s*l\.?\s*s\.?\b|bls\b|radio\b|tet\b/gi;
const DATE_PATTERN = /\d{1,2}\s*[./-]\s*\d{1,2}(?:\s*[./-]\s*\d{2,4})?/g;
const TOKEN_PATTERN = /suspendat(?:[aăo]?|ă)?|susp\.?|confiscat(?:[aăo]?|ă)?|confisc\.?|reținut(?:[aăo]?|ă)?|retinut(?:[aăo]?|a)?|s\.?\s*m\.?\s*u\.?\s*l\.?\s*s\b|smuls\b|parasut(?:ist|ism)\w*|moto\b|pilot\b|a\.?\s*l\.?\s*s\.?\b|als\b|rezidentiat\b|rezi\b|b\.?\s*l\.?\s*s\.?\b|bls\b|radio\b|tet\b|\d{1,2}\s*[./-]\s*\d{1,2}(?:\s*[./-]\s*\d{2,4})?/gi;

function testForToken(token) {
  return TEST_ALIASES.find(alias => alias.pattern.test(token))?.test || '';
}

function startOfDayInDepartment(day, month, year) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(day, 1), daysInMonth);
  const utcNoon = Date.UTC(year, month - 1, clampedDay, 12);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(utcNoon));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const localAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return Date.UTC(year, month - 1, clampedDay) - (localAsUtc - utcNoon);
}

function dateFromToken(value, now) {
  const match = String(value).match(/(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*[./-]\s*(\d{2,4}))?/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || month < 1 || month > 12) return null;
  const currentParts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric' }).formatToParts(now);
  let year = Number(currentParts.find(part => part.type === 'year')?.value);
  if (match[3]) {
    year = Number(match[3]);
    if (year < 100) year += 2000;
  } else if (startOfDayInDepartment(day, month, year) < now.getTime() - 30 * 86400000) {
    year += 1;
  }
  return startOfDayInDepartment(day, month, year);
}

export function parseCooldownS(value, now = new Date()) {
  const cooldowns = {};
  const pendingTests = new Set();
  const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    if (DATE_PATTERN.test(token)) {
      DATE_PATTERN.lastIndex = 0;
      const date = dateFromToken(token, now);
      if (date !== null) {
        for (const test of pendingTests) cooldowns[test] = Math.max(cooldowns[test] || 0, date);
        pendingTests.clear();
      }
      continue;
    }
    TEST_PATTERN.lastIndex = 0;
    const test = testForToken(token);
    if (test) pendingTests.add(test);
  }
  return cooldowns;
}

export function cooldownIsActive(cooldowns, testName, now = Date.now()) {
  const expiry = Number(cooldowns?.[testName]) || 0;
  return expiry > Number(now);
}

export function failedTestCooldownExpiry(testName, now = new Date()) {
  const days = FAILED_TEST_COOLDOWN_DAYS[testName];
  if (!days) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const expiry = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + days));
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(expiry);
}