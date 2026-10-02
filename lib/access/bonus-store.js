export const BONUS_TEST_NAMES = new Set([
  'Test PILOT',
  'Test MOTO',
  'Test admitere',
  'Test transfer',
  'Adeverință medicală',
  'Test ALS',
  'Test SMULS'
]);

const BONUS_KEY_PREFIX = 'site-testeri-medici:bonuses:v1:day:';
const IMPORTED_KEY_PREFIX = 'site-testeri-medici:bonuses:v1:imported:';
const BONUS_DAY_INDEX_KEY = 'site-testeri-medici:bonuses:v1:days';
const DAY_MS = 24 * 60 * 60 * 1000;

function departmentDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysInRange(from, to) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('Invalid bonus date range');
  const dayCount = Math.floor((end - start) / DAY_MS) + 1;
  if (dayCount > 31) throw new Error('Bonus date range is too large');
  return Array.from({ length: dayCount }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}

export async function addBonusEntries(redis, entries) {
  const commands = entries.flatMap(entry => {
    const day = departmentDateKey(entry.createdAt);
    if (!day || !BONUS_TEST_NAMES.has(entry.testName)) return [];
    return [
      ['SADD', `${BONUS_KEY_PREFIX}${day}`, JSON.stringify(entry)],
      ['SADD', BONUS_DAY_INDEX_KEY, day]
    ];
  });
  return redis.pipeline(commands);
}

export async function importLegacyBonusEntries(redis, entries, from, to) {
  const days = daysInRange(from, to);
  const imported = await redis.pipeline(days.map(day => ['EXISTS', `${IMPORTED_KEY_PREFIX}${day}`]));
  const entryCommands = [];
  const markerCommands = [];
  days.forEach((day, index) => {
    if (Number(imported[index])) return;
    const dayEntries = entries.filter(entry => departmentDateKey(entry.createdAt) === day && BONUS_TEST_NAMES.has(entry.testName));
    dayEntries.forEach(entry => entryCommands.push(['SADD', `${BONUS_KEY_PREFIX}${day}`, JSON.stringify(entry)]));
    entryCommands.push(['SADD', BONUS_DAY_INDEX_KEY, day]);
    markerCommands.push(['SET', `${IMPORTED_KEY_PREFIX}${day}`, '1']);
  });
  await redis.pipeline(entryCommands);
  return redis.pipeline(markerCommands);
}

export async function clearBonusEntries(redis) {
  const [days] = await redis.pipeline([['SMEMBERS', BONUS_DAY_INDEX_KEY]]);
  const commands = (days || []).flatMap(day => [
    ['DEL', `${BONUS_KEY_PREFIX}${day}`],
    ['DEL', `${IMPORTED_KEY_PREFIX}${day}`]
  ]);
  commands.push(['DEL', BONUS_DAY_INDEX_KEY]);
  return redis.pipeline(commands);
}

export async function listBonusEntries(redis, from, to) {
  const days = daysInRange(from, to);
  const resultSets = await redis.pipeline(days.map(day => ['SMEMBERS', `${BONUS_KEY_PREFIX}${day}`]));
  return resultSets.flatMap(values => (values || []).map(value => JSON.parse(value)));
}
