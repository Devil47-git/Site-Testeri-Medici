import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_API_KEY = 'test-key';
process.env.UPSTASH_REDIS_REST_URL = 'https://attendance-redis.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const row = (callsign, name, discordId, rank = '') => {
  const member = Array(21).fill('');
  member[2] = callsign;
  member[3] = name;
  member[4] = rank;
  member[19] = discordId;
  return member;
};
const attendanceRow = (callsign, week40, week41, week42) => {
  const member = Array(21).fill('');
  member[2] = callsign;
  member[14] = week40;
  member[15] = week41;
  member[16] = week42;
  return member;
};
const headers = Array(21).fill('');
headers[2] = 'NR. INSIGNA';
headers[14] = 'TOTAL/ZI CW 40 (05.10-11.10)';
headers[15] = 'TOTAL/ZI CW 41 (12.10-18.10)';
headers[16] = 'TOTAL/ZI CW 42 (19.10-25.10)';
let sheetRows = [
  ['', '', 'CALLSIGN', 'NAME', 'RANK', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'DISCORD ID'],
  row('001', 'Conducere', 'leadership-id'),
  row('101', 'Membru', 'member-id'),
  row('021', 'Grad fără callsign de conducere', 'rank-only-id', 'Director General')
];
const attendanceSheetRows = [
  Array(21).fill(''),
  ['', 'EVIDENTA ACTIVITATE'],
  headers,
  Array(21).fill(''),
  attendanceRow('001', '50', '60', '70'),
  attendanceRow('101', '134/2CO', '138/5CCV', '—'),
  attendanceRow('021', '30', '40', '50')
];
const redisValues = new Map();

globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith('https://attendance-redis.example')) {
    const commands = JSON.parse(options.body || '[]');
    if (String(url).endsWith('/pipeline')) {
      return { ok: true, json: async () => commands.map(([command, key]) => ({ result: command === 'GET' ? redisValues.get(key) || null : null })) };
    }
    if (commands[0] === 'GET') return { ok: true, json: async () => ({ result: redisValues.get(commands[1]) || null }) };
    if (commands[0] === 'HMGET') return { ok: true, json: async () => ({ result: commands.slice(2).map(() => null) }) };
    if (commands[0] === 'SET') {
      redisValues.set(commands[1], commands[2]);
      return { ok: true, json: async () => ({ result: 'OK' }) };
    }
    throw new Error(`Unexpected Redis command: ${commands[0]}`);
  }
  const range = decodeURIComponent(new URL(url).pathname.split('/').pop());
  return {
    ok: true,
    json: async () => ({ values: range.includes('EVIDENTA ACTIVITATE') ? attendanceSheetRows : range.startsWith('LISTA') ? sheetRows : [Array(6).fill('')] })
  };
};

const { default: directoryHandler, attendanceWeeksFromRows, attendanceWeeksByCallsign } = await import('../api/access/directory.js');
const { default: attendanceHandler } = await import('../api/access/attendance.js');

async function callDirectory(requesterId, view) {
  let statusCode = 200;
  let payload;
  const response = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; }
  };
  await directoryHandler({ method: 'GET', query: { requesterId, view } }, response);
  return { statusCode, payload };
}
async function callAttendance(method, requesterId, body = {}, extraQuery = {}) {
  let statusCode = 200;
  let payload;
  const response = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; }
  };
  await attendanceHandler({
    method,
    query: { requesterId, ...extraQuery },
    body: { requesterId, ...body }
  }, response);
  return { statusCode, payload };
}

test('weekly attendance columns keep document labels and text values unchanged', () => {
  assert.deepEqual(attendanceWeeksFromRows(headers, attendanceSheetRows[5]), [
    { label: 'TOTAL/ZI CW 40 (05.10-11.10)', value: '134/2CO' },
    { label: 'TOTAL/ZI CW 41 (12.10-18.10)', value: '138/5CCV' },
    { label: 'TOTAL/ZI CW 42 (19.10-25.10)', value: '—' }
  ]);
  const zeroRow = [...attendanceSheetRows[5]];
  zeroRow[14] = 0;
  assert.equal(attendanceWeeksFromRows(headers, zeroRow)[0].value, '0');
  assert.deepEqual(attendanceWeeksFromRows([], attendanceSheetRows[5]), []);
  assert.deepEqual(attendanceWeeksByCallsign(attendanceSheetRows).get('101'), attendanceWeeksFromRows(headers, attendanceSheetRows[5]));
});

test('only leadership can read weekly attendance values from Sheets', async () => {
  const memberRequest = await callDirectory('member-id', 'attendance');
  assert.equal(memberRequest.statusCode, 403);

  const first = await callDirectory('leadership-id', 'attendance');
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.members.length, 1);
  assert.equal(first.payload.members[0].discordId, 'leadership-id');
  assert.equal(first.payload.members[0].attendanceWeeks[0].value, '50');

  attendanceSheetRows[4][14] = 'updated in document';
  const refreshed = await callDirectory('leadership-id', 'attendance');
  assert.equal(refreshed.payload.members[0].attendanceWeeks[0].value, 'updated in document');
});

test('only callsigns 001-020 can read department-wide weekly attendance', async () => {
  const leadership = await callDirectory('leadership-id', 'activity');
  assert.equal(leadership.statusCode, 200);
  assert.equal(leadership.payload.members.length, 3);
  assert.deepEqual(leadership.payload.members[1].attendanceWeeks.map(week => week.value), ['134/2CO', '138/5CCV', '—']);

  const rankOnly = await callDirectory('rank-only-id', 'activity');
  assert.equal(rankOnly.statusCode, 403);
});

test('the separate live timer still supports start and stop without manual weekly edits', async () => {
  const key = 'site-testeri-medici:attendance:member-id';
  redisValues.set(key, JSON.stringify({ entries: [], manualEntries: [{ id: 'legacy', minutes: 90 }] }));
  const started = await callAttendance('POST', 'member-id', { action: 'start' });
  assert.equal(started.statusCode, 200);
  assert.equal(started.payload.entries.length, 1);
  assert.equal(started.payload.entries[0].end, null);

  const stopped = await callAttendance('POST', 'member-id', { action: 'stop' });
  assert.equal(stopped.statusCode, 200);
  assert.equal(Number.isFinite(stopped.payload.entries[0].end), true);

  const manual = await callAttendance('POST', 'member-id', { action: 'manual-add' });
  assert.equal(manual.statusCode, 400);
});

test('only leadership can read live attendance records', async () => {
  redisValues.set('site-testeri-medici:attendance:member-id', JSON.stringify([{ start: 1000, end: 2000 }]));
  const member = await callAttendance('GET', 'member-id', {}, { view: 'own' });
  assert.equal(member.statusCode, 403);

  const leadership = await callAttendance('GET', 'leadership-id', {}, { view: 'own' });
  assert.equal(leadership.statusCode, 200);
});

test('leadership can load its own attendance separately from the department records', async () => {
  const memberKey = 'site-testeri-medici:attendance:member-id';
  const leadershipKey = 'site-testeri-medici:attendance:leadership-id';
  redisValues.set(memberKey, JSON.stringify([{ start: 1000, end: 2000 }]));
  redisValues.set(leadershipKey, JSON.stringify([{ start: 3000, end: 4000 }]));

  const own = await callAttendance('GET', 'leadership-id', {}, { view: 'own' });
  assert.equal(own.statusCode, 200);
  assert.deepEqual(own.payload.entries, [{ start: 3000, end: 4000 }]);

  const department = await callAttendance('GET', 'leadership-id');
  assert.equal(department.statusCode, 200);
  assert.deepEqual(department.payload.entries['member-id'], [{ start: 1000, end: 2000 }]);
  assert.deepEqual(department.payload.entries['leadership-id'], [{ start: 3000, end: 4000 }]);
});
