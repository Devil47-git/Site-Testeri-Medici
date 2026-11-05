import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_API_KEY = 'test-key';
process.env.UPSTASH_REDIS_REST_URL = 'https://attendance-redis.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.CRON_SECRET = 'test-cron-secret';

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
let memberFunctionRows = [['discordId', 'callsign', 'functionIds', 'updatedAt']];
const redisValues = new Map();

globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith('https://attendance-redis.example')) {
    const commands = JSON.parse(options.body || '[]');
    if (String(url).endsWith('/pipeline')) {
      return { ok: true, json: async () => commands.map(([command, key, value]) => {
        if (command === 'SET') {
          redisValues.set(key, value);
          return { result: 'OK' };
        }
        return { result: command === 'GET' ? redisValues.get(key) || null : null };
      }) };
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
    json: async () => ({ values: range.includes('EVIDENTA ACTIVITATE') ? attendanceSheetRows : range.startsWith('LISTA') ? sheetRows : range.includes('MEMBER_FUNCTIONS') ? memberFunctionRows : [Array(6).fill('')] })
  };
};

const { default: directoryHandler, attendanceWeeksFromRows, attendanceWeeksByCallsign } = await import('../api/access/directory.js');
const { default: attendanceHandler, attendanceMinutesForDate, attendanceSheetDayColumn, attendanceStartAllowed, attendanceTypesForFunctionIds, closeExpiredAttendanceEntries, writeAttendanceToSheet } = await import('../api/access/attendance.js');
const { attendanceMinimumMinutes } = await import('../lib/access/shared.js');

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
async function callAttendance(method, requesterId, body = {}, extraQuery = {}, headers = {}) {
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
    body: { requesterId, ...body },
    headers
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
  assert.deepEqual(attendanceWeeksByCallsign(attendanceSheetRows).get('101').weeks, attendanceWeeksFromRows(headers, attendanceSheetRows[5]));
});

test('daily attendance minimums follow callsign leadership and member grade', () => {
  assert.equal(attendanceMinimumMinutes('020', 'Medic Chirurg'), 60);
  assert.equal(attendanceMinimumMinutes('003', 'Director General'), null);
  assert.equal(attendanceMinimumMinutes('101', 'Brancardier'), 120);
  assert.equal(attendanceMinimumMinutes('201', 'Asistent-Medical'), 120);
  assert.equal(attendanceMinimumMinutes('301', 'Medic-Stagiar'), 120);
  assert.equal(attendanceMinimumMinutes('302', 'Medic-Rezident'), 100);
  assert.equal(attendanceMinimumMinutes('303', 'Medic-Specialist'), 80);
  assert.equal(attendanceMinimumMinutes('304', 'Medic-Primar'), 80);
});

test('attendance cutoff uses Bucharest time and blocks starts from 23:35', () => {
  assert.equal(attendanceStartAllowed(Date.parse('2026-01-01T21:34:00Z')), true);
  assert.equal(attendanceStartAllowed(Date.parse('2026-01-01T21:35:00Z')), false);
  assert.equal(attendanceStartAllowed(Date.parse('2026-07-01T20:34:00Z')), true);
  assert.equal(attendanceStartAllowed(Date.parse('2026-07-01T20:35:00Z')), false);
});

test('HR and PR attendance permissions follow assigned member functions', () => {
  assert.deepEqual(attendanceTypesForFunctionIds(['resurse-umane']), ['regular', 'hr']);
  assert.deepEqual(attendanceTypesForFunctionIds(['manager-hr']), ['regular', 'hr']);
  assert.deepEqual(attendanceTypesForFunctionIds(['relatii-publice', 'adjunct-pr']), ['regular', 'pr']);
  assert.deepEqual(attendanceTypesForFunctionIds([]), ['regular']);
});

test('stale active entries close at Bucharest midnight and no longer count as open', () => {
  const start = Date.parse('2026-01-01T21:30:00Z');
  const now = Date.parse('2026-01-02T00:15:00Z');
  assert.deepEqual(closeExpiredAttendanceEntries([{ start, end: null }], now), {
    entries: [{ start, end: Date.parse('2026-01-01T22:00:00Z'), autoClosed: true }],
    closed: 1
  });
});

test('daily attendance sums only non-canceled minutes within the Bucharest day', () => {
  const entries = [
    { start: Date.parse('2026-01-02T22:30:00Z'), end: Date.parse('2026-01-02T23:30:00Z') },
    { start: Date.parse('2026-01-03T10:00:00Z'), end: Date.parse('2026-01-03T11:30:00Z') },
    { start: Date.parse('2026-01-03T21:30:00Z'), end: Date.parse('2026-01-04T00:30:00Z') },
    { start: Date.parse('2026-01-03T12:00:00Z'), end: Date.parse('2026-01-03T13:00:00Z'), canceled: true }
  ];
  assert.equal(attendanceMinutesForDate(entries, '2026-01-03'), 180);
  assert.throws(() => attendanceMinutesForDate(entries, '2026-02-31'), /Data pontajului este invalidă/);
});

test('weekday columns map Monday through Sunday to columns F through L', () => {
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  assert.deepEqual(dates.map(attendanceSheetDayColumn), ['F', 'G', 'H', 'I', 'J', 'K', 'L']);
});

test('individual attendance sync matches TEST PONTAJE names and writes daily minutes to the weekday cell', async () => {
  const updates = [];
  const reads = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async ({ range }) => {
          reads.push(range);
          return { data: { values: [['Ana Vasilescu']] } };
        },
        update: async request => updates.push(request)
      }
    }
  };
  await writeAttendanceToSheet(sheets, 'Ana Vasilescu', '2026-11-02', 135);
  assert.deepEqual(reads, ["'TEST PONTAJE'!D1:D400", "'EVIDENTA ACTIVITATE'!D1:D400"]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].range, "'EVIDENTA ACTIVITATE'!F1");
  assert.deepEqual(updates[0].requestBody.values, [[135]]);
});

test('only leadership can read weekly attendance values from Sheets', async () => {
  const memberRequest = await callDirectory('member-id', 'attendance');
  assert.equal(memberRequest.statusCode, 403);

  const first = await callDirectory('leadership-id', 'attendance');
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.members.length, 1);
  assert.equal(first.payload.members[0].discordId, 'leadership-id');
  assert.equal(first.payload.members[0].attendanceWeeks[0].value, '50');
  assert.equal(first.payload.members[0].attendanceMinimumMinutes, null);

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

test('activity directory excludes non-member label and role rows', async () => {
  const placeholders = ['NUME RANK', 'HELPER IN TESTE', 'HELPER', 'MODERATOR', 'ADMINISTRATOR', 'SUPERVIZOR']
    .map((label, index) => row(label, label, `placeholder-${index}`));
  sheetRows.push(...placeholders);
  try {
    const result = await callDirectory('leadership-id', 'activity');
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.members.length, 3);
    assert.equal(result.payload.members.some(member => placeholders.some(placeholder => placeholder[3] === member.name)), false);
  } finally {
    sheetRows.splice(-placeholders.length);
  }
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

test('HR and PR timers require assigned functions and keep their entry types', async () => {
  const memberKey = 'site-testeri-medici:attendance:member-id';
  memberFunctionRows = [
    ['discordId', 'callsign', 'functionIds', 'updatedAt'],
    ['member-id', '101', 'resurse-umane', '']
  ];
  try {
    const ownAttendance = await callAttendance('GET', 'member-id', {}, { view: 'own' });
    assert.equal(ownAttendance.statusCode, 200);
    const deniedPr = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'pr' });
    assert.equal(deniedPr.statusCode, 403);

    const startedHr = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'hr' });
    assert.equal(startedHr.statusCode, 200);
    assert.equal(startedHr.payload.entries.at(-1).type, 'hr');
    const overlappingRegular = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'regular' });
    assert.equal(overlappingRegular.statusCode, 409);
    const stoppedHr = await callAttendance('POST', 'member-id', { action: 'stop', attendanceType: 'hr' });
    assert.equal(stoppedHr.statusCode, 200);
    assert.equal(stoppedHr.payload.entries.at(-1).type, 'hr');
    assert.equal(Number.isFinite(stoppedHr.payload.entries.at(-1).end), true);

    memberFunctionRows = [
      ['discordId', 'callsign', 'functionIds', 'updatedAt'],
      ['member-id', '101', 'relatii-publice', '']
    ];
    const deniedHr = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'hr' });
    assert.equal(deniedHr.statusCode, 403);
    const startedPr = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'pr' });
    assert.equal(startedPr.statusCode, 200);
    assert.equal(startedPr.payload.entries.at(-1).type, 'pr');
    const stoppedPr = await callAttendance('POST', 'member-id', { action: 'stop', attendanceType: 'pr' });
    assert.equal(stoppedPr.statusCode, 200);
  } finally {
    memberFunctionRows = [['discordId', 'callsign', 'functionIds', 'updatedAt']];
    redisValues.delete(memberKey);
  }
});

test('members can read only their own live attendance while leadership can read all records', async () => {
  redisValues.set('site-testeri-medici:attendance:member-id', JSON.stringify([{ start: 1000, end: 2000 }]));
  const member = await callAttendance('GET', 'member-id', {}, { view: 'own' });
  assert.equal(member.statusCode, 200);
  assert.deepEqual(member.payload.entries, [{ start: 1000, end: 2000 }]);

  const memberDepartment = await callAttendance('GET', 'member-id');
  assert.equal(memberDepartment.statusCode, 403);

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

test('department attendance includes active member details and leadership can cancel any active entry', async () => {
  const memberKey = 'site-testeri-medici:attendance:member-id';
  redisValues.set(memberKey, JSON.stringify([{ start: Date.now() - 60000, end: null }]));

  const department = await callAttendance('GET', 'leadership-id');
  assert.equal(department.statusCode, 200);
  assert.equal(department.payload.activeEntries[0].discordId, 'member-id');
  assert.equal(department.payload.activeEntries[0].name, 'Membru');

  const canceled = await callAttendance('POST', 'leadership-id', { action: 'cancel', targetDiscordId: 'member-id' });
  assert.equal(canceled.statusCode, 200);
  const canceledEntry = JSON.parse(redisValues.get(memberKey))[0];
  assert.equal(canceledEntry.canceled, true);
  assert.equal(canceledEntry.canceledBy, 'leadership-id');
  assert.equal(Number.isFinite(canceledEntry.end), true);

  redisValues.set(memberKey, JSON.stringify([{ start: Date.now(), end: null }]));
  const member = await callAttendance('POST', 'member-id', { action: 'cancel', targetDiscordId: 'member-id' });
  assert.equal(member.statusCode, 403);
});

test('active attendance view returns member names and validation state for a selected weekday', async () => {
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const review = { status: 'validated', minutes: 45 };
  redisValues.set(`site-testeri-medici:attendance-review:${dateKey}:member-id`, JSON.stringify(review));
  const result = await callAttendance('GET', 'leadership-id', {}, { view: 'active', date: dateKey });
  assert.equal(result.statusCode, 200);
  assert.ok(result.payload.members.some(member => member.discordId === 'member-id' && member.name === 'Membru'));
  assert.deepEqual(result.payload.reviewStates[dateKey]['member-id'], review);
});

test('leadership can validate, cancel, and restore an individual attendance entry', async () => {
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = Date.now() - 120000;
  const end = Date.now() - 60000;
  const key = 'site-testeri-medici:attendance:member-id';
  redisValues.set(key, JSON.stringify([{ start, end }]));

  const validated = await callAttendance('POST', 'leadership-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: start,
    dateKey,
    status: 'validated'
  });
  assert.equal(validated.statusCode, 200);
  assert.equal(validated.payload.minutes, 1);
  assert.equal(JSON.parse(redisValues.get(key))[0].validated, true);

  const canceled = await callAttendance('POST', 'leadership-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: start,
    dateKey,
    status: 'canceled'
  });
  assert.equal(canceled.statusCode, 200);
  assert.equal(canceled.payload.minutes, 0);
  assert.equal(JSON.parse(redisValues.get(key))[0].canceled, true);
  assert.equal(JSON.parse(redisValues.get(key))[0].validated, undefined);

  const restored = await callAttendance('POST', 'leadership-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: start,
    dateKey,
    status: 'validated'
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.payload.minutes, 1);
  assert.equal(JSON.parse(redisValues.get(key))[0].canceled, undefined);
  assert.equal(JSON.parse(redisValues.get(key))[0].validated, true);

  const openStart = Date.now() - 30000;
  redisValues.set(key, JSON.stringify([{ start: openStart, end: null }]));
  const canceledOpen = await callAttendance('POST', 'leadership-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: openStart,
    dateKey,
    status: 'canceled'
  });
  assert.equal(canceledOpen.statusCode, 200);
  assert.equal(Number.isFinite(JSON.parse(redisValues.get(key))[0].end), true);
  assert.equal(JSON.parse(redisValues.get(key))[0].canceled, true);
});

test('active attendance view allows selecting previous dates but rejects future dates', async () => {
  const today = new Date();
  const previousDate = new Date(today);
  previousDate.setDate(today.getDate() - 7);
  const formatDate = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const previous = await callAttendance('GET', 'leadership-id', {}, { view: 'active', date: formatDate(previousDate) });
  assert.equal(previous.statusCode, 200);

  const futureDate = new Date(today);
  futureDate.setDate(today.getDate() + 1);
  const future = await callAttendance('GET', 'leadership-id', {}, { view: 'active', date: formatDate(futureDate) });
  assert.equal(future.statusCode, 400);
});

test('only leadership can request attendance document updates', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const result = await callAttendance('POST', 'member-id', {
    action: 'sync-docs',
    targetDiscordId: 'member-id',
    dateKey: today,
    status: 'validated'
  });
  assert.equal(result.statusCode, 403);
});

test('authenticated midnight cron closes department entries', async () => {
  const memberKey = 'site-testeri-medici:attendance:member-id';
  redisValues.set(memberKey, JSON.stringify([{ start: Date.now() - 86400000, end: null }]));

  const unauthorized = await callAttendance('GET', '', {}, { task: 'close-expired' });
  assert.equal(unauthorized.statusCode, 401);

  const result = await callAttendance('GET', '', {}, { task: 'close-expired' }, { authorization: 'Bearer test-cron-secret' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.closed, 1);
  assert.equal(JSON.parse(redisValues.get(memberKey))[0].autoClosed, true);
});
