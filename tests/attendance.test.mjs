import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_API_KEY = 'test-key';
process.env.UPSTASH_REDIS_REST_URL = 'https://attendance-redis.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.CRON_SECRET = 'test-cron-secret';
process.env.DISCORD_ATTENDANCE_REVIEW_WEBHOOK = 'https://discord.com/api/webhooks/test/token';
process.env.DISCORD_HOSPITAL_CHAT_WEBHOOK = 'https://discord.com/api/webhooks/hospital/token';

const row = (callsign, name, discordId, rank = '', functions = '') => {
  const member = Array(21).fill('');
  member[2] = callsign;
  member[3] = name;
  member[4] = rank;
  member[10] = functions;
  member[9] = '01.02.2024';
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
  row('102', 'Responsabil H.R.', 'hr-id', '', 'H.R.'),
  row('021', 'Grad fără callsign de conducere', 'rank-only-id', 'Director General')
];
const attendanceSheetRows = [
  Array(21).fill(''),
  ['', 'EVIDENTA ACTIVITATE'],
  headers,
  Array(21).fill(''),
  attendanceRow('001', '50', '60', '70'),
  attendanceRow('101', '134/2CO', '138/5CVV', '—'),
  attendanceRow('021', '30', '40', '50')
];
const redisValues = new Map();
const redisExpirations = new Map();
const discordWebhookRequests = [];
const hospitalWebhookRequests = [];
let discordWebhookFailure = false;

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
    if (commands[0] === 'TTL') {
      const expiresAt = redisExpirations.get(commands[1]);
      return { ok: true, json: async () => ({ result: expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : -2 }) };
    }
    if (commands[0] === 'HMGET') return { ok: true, json: async () => ({ result: commands.slice(2).map(() => null) }) };
    if (commands[0] === 'SET' && commands.includes('NX')) {
      if (redisValues.has(commands[1])) return { ok: true, json: async () => ({ result: null }) };
      redisValues.set(commands[1], commands[2]);
      redisExpirations.set(commands[1], Date.now() + Number(commands[commands.indexOf('EX') + 1]) * 1000);
      return { ok: true, json: async () => ({ result: 'OK' }) };
    }
    if (commands[0] === 'SET') {
      redisValues.set(commands[1], commands[2]);
      return { ok: true, json: async () => ({ result: 'OK' }) };
    }
    throw new Error(`Unexpected Redis command: ${commands[0]}`);
  }
  if (String(url) === process.env.DISCORD_ATTENDANCE_REVIEW_WEBHOOK) {
    discordWebhookRequests.push(JSON.parse(options.body));
    return { ok: !discordWebhookFailure, status: discordWebhookFailure ? 500 : 204 };
  }
  if (String(url) === process.env.DISCORD_HOSPITAL_CHAT_WEBHOOK) {
    hospitalWebhookRequests.push(JSON.parse(options.body));
    return { ok: !discordWebhookFailure, status: discordWebhookFailure ? 500 : 204 };
  }
  const range = decodeURIComponent(new URL(url).pathname.split('/').pop());
  return {
    ok: true,
    json: async () => ({ values: range.includes('EVIDENTA ACTIVITATE') ? attendanceSheetRows : range.startsWith('LISTA') ? sheetRows : [Array(6).fill('')] })
  };
};

const { default: directoryHandler, attendanceWeeksFromRows, attendanceWeeksByCallsign } = await import('../api/access/directory.js');
const { default: attendanceHandler, attendanceCellUpdate, attendanceMinutesForDate, attendanceRoundedMinutesForDate, attendanceSheetDayColumn, attendanceStartAllowed, attendanceTypesForFunctionIds, closeExpiredAttendanceEntries, sendHospitalAttendanceWebhook, writeAttendanceToSheet, writeDepartmentAttendanceToSheet } = await import('../api/access/attendance.js');
const { memberFunctionsDirectory, normalizeMemberFunctionLabels } = await import('../api/access/functions.js');
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
    { label: 'TOTAL/ZI CW 41 (12.10-18.10)', value: '138/5CVV' },
    { label: 'TOTAL/ZI CW 42 (19.10-25.10)', value: '—' }
  ]);
  const zeroRow = [...attendanceSheetRows[5]];
  zeroRow[14] = 0;
  assert.equal(attendanceWeeksFromRows(headers, zeroRow)[0].value, '0');
  assert.deepEqual(attendanceWeeksFromRows([], attendanceSheetRows[5]), []);
  assert.deepEqual(attendanceWeeksByCallsign(attendanceSheetRows).get('101').weeks, attendanceWeeksFromRows(headers, attendanceSheetRows[5]));
});

test('daily attendance minimums follow callsign leadership and member grade', () => {
  assert.equal(attendanceMinimumMinutes('004', 'Director Adjunct'), 60);
  assert.equal(attendanceMinimumMinutes('020', 'Medic Chirurg'), 60);
  for (const role of ['Helper', 'Moderator', 'Administrator', 'Supervizor']) {
    assert.equal(attendanceMinimumMinutes('650', 'Medic Specialist', role), 60);
  }
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

test('only regular and H.R. attendance permissions follow assigned member functions', () => {
  assert.deepEqual(attendanceTypesForFunctionIds(['resurse-umane']), ['regular']);
  assert.deepEqual(attendanceTypesForFunctionIds(['manager-hr']), ['regular', 'hr']);
  assert.deepEqual(attendanceTypesForFunctionIds(['relatii-publice', 'adjunct-pr']), ['regular']);
  assert.deepEqual(attendanceTypesForFunctionIds(['H.R. / H.R. AV']), ['regular', 'hr']);
  assert.deepEqual(attendanceTypesForFunctionIds(['P.R.', 'Manager P.R.']), ['regular']);
  assert.deepEqual(attendanceTypesForFunctionIds([]), ['regular']);
});

test('staff assignments receive leadership weekly-minimum treatment', async () => {
  const member = row('650', 'Staff Member', 'staff-id', 'Medic Specialist', 'Moderator');
  sheetRows.push(member);
  try {
    const result = await callDirectory('leadership-id', 'members');
    const assigned = result.payload.members.find(item => item.discordId === 'staff-id');
    assert.equal(assigned.attendanceMinimumMinutes, 60);
    assert.equal(assigned.isTester, false);
  } finally {
    sheetRows.pop();
  }
});

test('department function catalog adds staff roles, renames requested roles, and hides removed roles', () => {
  const functions = [
    'Adjunct I.S.U.L.S. - P.C.L.S.',
    'PR',
    'P.R.',
    'Manager D.S.L.S.',
    'Adjunct M.M.L.S.',
    'Coordonator JAF',
    'Resurse Umane',
    'Relații cu publicul',
    'Membru al departamentului special I.S.U.L.S.',
    'Instructor Pilot',
    'Instructor Moto',
    'Instructor Smuls',
    'Instructor ALS',
    'Consilier psihologic'
  ];
  const result = memberFunctionsDirectory([headers, row('101', 'Membru', 'member-id', '', functions.join(' | '))]);
  const assignment = result.assignments[0].functionIds;
  assert.deepEqual(assignment, [
    'Adjunct I.S.U.L.S. | S.M.U.L.S.',
    'P.R.',
    'Manager D.S.L.S. - P.C.L.S.',
    'Adjunct M.M.L.S. - P.C.L.S.'
  ]);
  assert.deepEqual(normalizeMemberFunctionLabels(['PR', 'P.R.', 'Helper']), ['P.R.', 'Helper']);
  assert.deepEqual(['Helper', 'Moderator', 'Administrator', 'Supervizor'].every(label => result.catalog.some(item => item.id === label)), true);
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

test('daily attendance rounds each individual entry to the nearest five minutes before summing', () => {
  const entries = [
    { start: Date.parse('2026-01-03T15:10:00Z'), end: Date.parse('2026-01-03T16:05:01Z') },
    { start: Date.parse('2026-01-03T17:10:00Z'), end: Date.parse('2026-01-03T17:37:00Z') },
    { start: Date.parse('2026-01-03T18:10:00Z'), end: Date.parse('2026-01-03T18:34:59Z') }
  ];
  assert.equal(attendanceRoundedMinutesForDate(entries.slice(0, 1), '2026-01-03'), 55);
  assert.equal(attendanceRoundedMinutesForDate(entries.slice(1, 2), '2026-01-03'), 25);
  assert.equal(attendanceRoundedMinutesForDate(entries.slice(2), '2026-01-03'), 25);
  assert.equal(attendanceRoundedMinutesForDate(entries.slice(0, 2), '2026-01-03'), 80);
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
          return { data: { values: range.endsWith('!F1') ? [['']] : [['Ana Vasilescu']] } };
        },
        update: async request => updates.push(request)
      }
    }
  };
  await writeAttendanceToSheet(sheets, 'Ana Vasilescu', '2026-11-02', 135);
  assert.deepEqual(reads, ["'TEST PONTAJE'!D1:D400", "'EVIDENTA ACTIVITATE'!D1:D400", "'EVIDENTA ACTIVITATE'!F1"]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].range, "'EVIDENTA ACTIVITATE'!F1");
  assert.deepEqual(updates[0].requestBody.values, [[135]]);
  assert.equal(updates[0].valueInputOption, 'USER_ENTERED');
});

test('attendance sheet markers add or multiply the daily minutes without overwriting other values', () => {
  assert.equal(attendanceCellUpdate('', 45), 45);
  assert.equal(attendanceCellUpdate(null, 45), 45);
  assert.equal(attendanceCellUpdate('—', 0), 0);
  assert.equal(attendanceCellUpdate('120+', 45), '=120+45');
  assert.equal(attendanceCellUpdate('3*', 45), '=3*45');
  assert.equal(attendanceCellUpdate('120', 45), null);
  assert.equal(attendanceCellUpdate('text+', 45), null);
});

test('department attendance sync applies plus and multiply markers to existing cells', async () => {
  const batchUpdates = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async ({ range }) => {
          if (range === "'TEST PONTAJE'!D1:D400") return { data: { values: [['Ana Vasilescu'], ['Mara Pop']] } };
          if (range === "'EVIDENTA ACTIVITATE'!D1:D400") return { data: { values: [['Ana Vasilescu'], ['Mara Pop']] } };
          if (range === "'EVIDENTA ACTIVITATE'!B1:B400") return { data: { values: [['M-001'], ['M-002']] } };
          if (range === "'EVIDENTA ACTIVITATE'!F1:F400") return { data: { values: [['10+'], ['3*']] } };
          throw new Error(`Unexpected sheet range: ${range}`);
        },
        batchUpdate: async request => batchUpdates.push(request)
      }
    }
  };
  const updates = await writeDepartmentAttendanceToSheet(sheets, [
    { discordId: 'ana-id', name: 'Ana Vasilescu' },
    { discordId: 'mara-id', name: 'Mara Pop' }
  ], {
    'ana-id': [{ start: Date.parse('2026-11-02T10:00:00Z'), end: Date.parse('2026-11-02T10:30:00Z') }],
    'mara-id': [{ start: Date.parse('2026-11-02T11:00:00Z'), end: Date.parse('2026-11-02T11:30:00Z') }]
  }, '2026-11-02');
  assert.equal(updates.length, 2);
  assert.equal(batchUpdates[0].requestBody.valueInputOption, 'USER_ENTERED');
  assert.deepEqual(batchUpdates[0].requestBody.data, [
    { range: "'EVIDENTA ACTIVITATE'!F1", values: [['=10+30']] },
    { range: "'EVIDENTA ACTIVITATE'!F2", values: [['=3*30']] }
  ]);
});

test('department attendance sync writes zero only to occupied rows and adds zero to plus markers', async () => {
  const batchUpdates = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async ({ range }) => {
          if (range === "'TEST PONTAJE'!D1:D400") return { data: { values: [['Ana Vasilescu'], ['Mara Pop'], ['Radu Ionescu']] } };
          if (range === "'EVIDENTA ACTIVITATE'!D1:D400") return { data: { values: [['Ana Vasilescu'], ['Mara Pop'], ['Fără callsign'], ['Radu Ionescu']] } };
          if (range === "'EVIDENTA ACTIVITATE'!B1:B400") return { data: { values: [['M-001'], ['M-002'], [''], ['M-004']] } };
          if (range === "'EVIDENTA ACTIVITATE'!F1:F400") return { data: { values: [['45+'], [''], ['90+'], ['60+']] } };
          throw new Error(`Unexpected sheet range: ${range}`);
        },
        batchUpdate: async request => batchUpdates.push(request)
      }
    }
  };
  const updates = await writeDepartmentAttendanceToSheet(sheets, [
    { discordId: 'ana-id', name: 'Ana Vasilescu' },
    { discordId: 'mara-id', name: 'Mara Pop' },
    { discordId: 'radu-id', name: 'Radu Ionescu' }
  ], {
    'ana-id': [{ start: Date.parse('2026-11-02T10:00:00Z'), end: Date.parse('2026-11-02T10:30:00Z') }]
  }, '2026-11-02');
  assert.equal(updates.length, 3);
  assert.deepEqual(batchUpdates[0].requestBody.data, [
    { range: "'EVIDENTA ACTIVITATE'!F1", values: [['=45+30']] },
    { range: "'EVIDENTA ACTIVITATE'!F2", values: [[0]] },
    { range: "'EVIDENTA ACTIVITATE'!F4", values: [['=60+0']] }
  ]);
});

test('hospital chat webhook sends the attendance update and allows only the intended mentions', async () => {
  const initialCount = hospitalWebhookRequests.length;
  await sendHospitalAttendanceWebhook({
    requesterId: 'hr-id',
    dateKey: '2026-11-02',
    championId: 'member-id',
    minutes: 135
  });
  const webhook = hospitalWebhookRequests[initialCount];
  assert.match(webhook.content, /Pontajele din 02\/11\/2026 au fost actualizate/);
  assert.match(webhook.content, /<@member-id>.*135 minute/s);
  assert.deepEqual(webhook.allowed_mentions, { parse: [], users: ['hr-id', 'member-id'], roles: ['804382163536576616'] });
});

test('every department member can read only their own weekly attendance values from Sheets', async () => {
  const memberRequest = await callDirectory('member-id', 'attendance');
  assert.equal(memberRequest.statusCode, 200);
  assert.equal(memberRequest.payload.members.length, 1);
  assert.equal(memberRequest.payload.members[0].discordId, 'member-id');
  assert.equal(memberRequest.payload.members[0].attendanceWeeks[0].value, '134/2CO');

  const first = await callDirectory('leadership-id', 'attendance');
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.members.length, 1);
  assert.equal(first.payload.members[0].discordId, 'leadership-id');
  assert.equal(first.payload.members[0].attendanceWeeks[0].value, '50');
  assert.equal(first.payload.members[0].attendanceMinimumMinutes, null);

  attendanceSheetRows[4][14] = 'updated in document';
  const refreshed = await callDirectory('leadership-id', 'attendance');
  assert.equal(refreshed.payload.members[0].attendanceWeeks[0].value, 'updated in document');

  const hr = await callDirectory('hr-id', 'attendance');
  assert.equal(hr.statusCode, 200);
  assert.equal(hr.payload.members[0].discordId, 'hr-id');
});

test('department directory reads member entry dates from column J', async () => {
  const response = await callDirectory('leadership-id', 'members');
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.members.find(member => member.discordId === 'member-id').joinedAt, '01.02.2024');
});

test('members directory excludes header rows without a valid callsign', async () => {
  const placeholder = row('', 'NUME', '', 'RANK');
  sheetRows.push(placeholder);
  try {
    const response = await callDirectory('leadership-id', 'members');
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.members.some(member => member.name === 'NUME'), false);
  } finally {
    sheetRows.pop();
  }
});

test('department members with callsigns 001-650 can read department-wide weekly attendance', async () => {
  const leadership = await callDirectory('leadership-id', 'activity');
  assert.equal(leadership.statusCode, 200);
  assert.equal(leadership.payload.members.length, 4);
  assert.deepEqual(leadership.payload.members[1].attendanceWeeks.map(week => week.value), ['134/2CO', '138/5CVV', '—']);

  const hr = await callDirectory('hr-id', 'activity');
  assert.equal(hr.statusCode, 200);
  assert.equal(hr.payload.members.length, 4);

  const rankOnly = await callDirectory('rank-only-id', 'activity');
  assert.equal(rankOnly.statusCode, 200);
  assert.equal(rankOnly.payload.members.length, 4);
});

test('activity directory excludes non-member label and role rows', async () => {
  const placeholders = ['NUME RANK', 'HELPER IN TESTE', 'HELPER', 'MODERATOR', 'ADMINISTRATOR', 'SUPERVIZOR']
    .map((label, index) => row(label, label, `placeholder-${index}`));
  sheetRows.push(...placeholders);
  try {
    const result = await callDirectory('leadership-id', 'activity');
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.members.length, 4);
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

test('H.R. timer requires its assigned function and P.R. timers are unavailable', async () => {
  const memberKey = 'site-testeri-medici:attendance:member-id';
  sheetRows[2][10] = 'H.R. / H.R. AV';
  try {
    const ownAttendance = await callAttendance('GET', 'member-id', {}, { view: 'own' });
    assert.equal(ownAttendance.statusCode, 200);
    const deniedPr = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'pr' });
    assert.equal(deniedPr.statusCode, 400);

    const startedHr = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'hr' });
    assert.equal(startedHr.statusCode, 200);
    assert.equal(startedHr.payload.entries.at(-1).type, 'hr');
    const overlappingRegular = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'regular' });
    assert.equal(overlappingRegular.statusCode, 409);
    const stoppedHr = await callAttendance('POST', 'member-id', { action: 'stop', attendanceType: 'hr' });
    assert.equal(stoppedHr.statusCode, 200);
    assert.equal(stoppedHr.payload.entries.at(-1).type, 'hr');
    assert.equal(Number.isFinite(stoppedHr.payload.entries.at(-1).end), true);

    sheetRows[2][10] = 'P.R.';
    const deniedHr = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'hr' });
    assert.equal(deniedHr.statusCode, 403);
    const startedPr = await callAttendance('POST', 'member-id', { action: 'start', attendanceType: 'pr' });
    assert.equal(startedPr.statusCode, 400);
  } finally {
    sheetRows[2][10] = '';
    redisValues.delete(memberKey);
  }
});

test('members can read their own live attendance and callsigns 001-650 can view department attendance', async () => {
  redisValues.set('site-testeri-medici:attendance:member-id', JSON.stringify([{ start: 1000, end: 2000 }]));
  const member = await callAttendance('GET', 'member-id', {}, { view: 'own' });
  assert.equal(member.statusCode, 200);
  assert.deepEqual(member.payload.entries, [{ start: 1000, end: 2000 }]);

  const memberDepartment = await callAttendance('GET', 'member-id', {}, { view: 'active' });
  assert.equal(memberDepartment.statusCode, 200);
  assert.equal(memberDepartment.payload.entries['member-id'][0].start, 1000);
  assert.ok(Array.isArray(memberDepartment.payload.members));

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

test('department attendance includes active member details and leadership can cancel any active entry with a reason', async () => {
  const memberKey = 'site-testeri-medici:attendance:member-id';
  redisValues.set(memberKey, JSON.stringify([{ start: Date.now() - 60000, end: null }]));

  const department = await callAttendance('GET', 'leadership-id');
  assert.equal(department.statusCode, 200);
  assert.equal(department.payload.activeEntries[0].discordId, 'member-id');
  assert.equal(department.payload.activeEntries[0].name, 'Membru');

  const canceled = await callAttendance('POST', 'leadership-id', { action: 'cancel', targetDiscordId: 'member-id', reason: 'Pontaj deschis nejustificat' });
  assert.equal(canceled.statusCode, 200);
  const canceledEntry = JSON.parse(redisValues.get(memberKey))[0];
  assert.equal(canceledEntry.canceled, true);
  assert.equal(canceledEntry.canceledBy, 'leadership-id');
  assert.equal(canceledEntry.cancelReason, 'Pontaj deschis nejustificat');
  assert.equal(Number.isFinite(canceledEntry.end), true);

  redisValues.set(memberKey, JSON.stringify([{ start: Date.now(), end: null }]));
  const memberCancelOther = await callAttendance('POST', 'member-id', { action: 'cancel', targetDiscordId: 'leadership-id' });
  assert.equal(memberCancelOther.statusCode, 403);
  const member = await callAttendance('POST', 'member-id', { action: 'cancel', targetDiscordId: 'member-id' });
  assert.equal(member.statusCode, 200);
  const selfCanceledEntry = JSON.parse(redisValues.get(memberKey))[0];
  assert.equal(selfCanceledEntry.canceled, true);
  assert.equal(selfCanceledEntry.canceledBy, 'member-id');
  assert.equal(selfCanceledEntry.cancelReason, 'Anulat de membru');
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
    status: 'canceled',
    reason: 'Pontaj nejustificat'
  });
  assert.equal(canceled.statusCode, 200);
  assert.equal(canceled.payload.minutes, 1);
  assert.equal(JSON.parse(redisValues.get(key))[0].canceled, true);
  assert.equal(JSON.parse(redisValues.get(key))[0].cancelReason, 'Pontaj nejustificat');
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
  assert.equal(JSON.parse(redisValues.get(key))[0].cancelReason, undefined);
  assert.equal(JSON.parse(redisValues.get(key))[0].validated, true);

  const openStart = Date.now() - 30000;
  redisValues.set(key, JSON.stringify([{ start: openStart, end: null }]));
  const canceledOpen = await callAttendance('POST', 'leadership-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: openStart,
    dateKey,
    status: 'canceled',
    reason: 'Pontaj deschis nejustificat'
  });
  assert.equal(canceledOpen.statusCode, 200);
  assert.equal(Number.isFinite(JSON.parse(redisValues.get(key))[0].end), true);
  assert.equal(JSON.parse(redisValues.get(key))[0].canceled, true);
});

test('H.R. validation and cancellation send Discord notifications, including cancellation reason', async () => {
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = Date.now() - 120000;
  const key = 'site-testeri-medici:attendance:member-id';
  redisValues.set(key, JSON.stringify([{ start, end: start + 60000 }]));
  discordWebhookRequests.length = 0;

  const validated = await callAttendance('POST', 'hr-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: start,
    dateKey,
    status: 'validated'
  });
  assert.equal(validated.statusCode, 200);
  assert.equal(validated.payload.minutes, 1);
  assert.equal(validated.payload.warning, '');
  assert.equal(discordWebhookRequests.length, 1);
  assert.equal(discordWebhookRequests[0].embeds[0].title, '✅ Pontaj validat');
  assert.equal(discordWebhookRequests[0].content, undefined);
  assert.equal(discordWebhookRequests[0].allowed_mentions.parse.length, 0);
  assert.equal(discordWebhookRequests[0].embeds[0].fields[0].value, '<@hr-id>');
  assert.equal(discordWebhookRequests[0].embeds[0].fields.find(field => field.name === 'Durată pontaj').value, '1 min');

  const hospitalCount = hospitalWebhookRequests.length;
  const canceled = await callAttendance('POST', 'hr-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: start,
    dateKey,
    status: 'canceled',
    reason: 'Pontaj deschis greșit'
  });
  assert.equal(canceled.statusCode, 200);
  assert.equal(discordWebhookRequests.length, 1);
  assert.equal(hospitalWebhookRequests.length, hospitalCount + 1);
  assert.match(hospitalWebhookRequests.at(-1).content, /^De: <@hr-id> PONTAJ ANULAT :x: lui <@member-id>, Motiv: Pontaj deschis greșit/);
  assert.match(hospitalWebhookRequests.at(-1).content, /Pontaj: de la ora \d{2}:\d{2} până la ora \d{2}:\d{2}/);
  assert.deepEqual(hospitalWebhookRequests.at(-1).allowed_mentions, { parse: [], users: ['hr-id', 'member-id'] });
});

test('attendance cancellation requires a reason on both cancellation endpoints', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = Date.now() - 60000;
  const key = 'site-testeri-medici:attendance:member-id';
  redisValues.set(key, JSON.stringify([{ start, end: null }]));

  const active = await callAttendance('POST', 'hr-id', { action: 'cancel', targetDiscordId: 'member-id' });
  assert.equal(active.statusCode, 400);
  assert.match(active.payload.error, /Motivul anulării este obligatoriu/);

  const review = await callAttendance('POST', 'hr-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: start,
    dateKey: today,
    status: 'canceled'
  });
  assert.equal(review.statusCode, 400);
  assert.match(review.payload.error, /Motivul anulării este obligatoriu/);

  hospitalWebhookRequests.length = 0;
  const canceled = await callAttendance('POST', 'hr-id', {
    action: 'cancel',
    targetDiscordId: 'member-id',
    reason: 'Pontaj deschis nejustificat'
  });
  assert.equal(canceled.statusCode, 200);
  assert.equal(hospitalWebhookRequests.length, 1);
  assert.match(hospitalWebhookRequests[0].content, /^De: <@hr-id> PONTAJ ANULAT :x: lui <@member-id>, Motiv: Pontaj deschis nejustificat/);
  assert.match(hospitalWebhookRequests[0].content, /Pontaj: de la ora \d{2}:\d{2} până la ora \d{2}:\d{2}/);
  assert.deepEqual(hospitalWebhookRequests[0].allowed_mentions, { parse: [], users: ['hr-id', 'member-id'] });
});

test('H.R. attendance edits post the editor, changes, and reason to Discord', async () => {
  const oldStart = Date.now() - 86400000;
  const oldEnd = oldStart + 1800000;
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(oldStart));
  const key = 'site-testeri-medici:attendance:member-id';
  const otherEntryStart = Date.parse(`${dateKey}T05:00:00Z`);
  redisValues.set(key, JSON.stringify([{ start: oldStart, end: oldEnd }, { start: otherEntryStart, end: otherEntryStart + 1800000 }]));
  discordWebhookRequests.length = 0;

  const edited = await callAttendance('POST', 'hr-id', {
    action: 'edit-entry',
    targetDiscordId: 'member-id',
    entryStart: oldStart,
    clockIn: '10:00',
    clockOut: '10:30',
    reason: 'Pontaj nedeschis'
  });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.payload.success, true);
  assert.equal(edited.payload.minutes, 30);
  assert.equal(edited.payload.warning, '');
  assert.equal(discordWebhookRequests.length, 1);
  const webhook = discordWebhookRequests[0];
  assert.equal(webhook.content, undefined);
  assert.equal(webhook.allowed_mentions.parse.length, 0);
  assert.equal(webhook.embeds[0].title, '✏️ Pontaj editat');
  assert.equal(webhook.embeds[0].fields.find(field => field.name === 'Editat de').value, '<@hr-id>');
  assert.equal(webhook.embeds[0].fields.find(field => field.name === 'Durată pontaj').value, '30 min');
  assert.equal(webhook.embeds[0].fields.find(field => field.name === 'Motiv').value, 'Pontaj nedeschis');
  assert.equal(webhook.embeds[0].fields.find(field => field.name === 'Data').value, dateKey.split('-').reverse().join('.'));
});

test('attendance edit reports Discord delivery failures instead of silently succeeding', async () => {
  const oldStart = Date.now() - 86400000;
  const key = 'site-testeri-medici:attendance:member-id';
  redisValues.set(key, JSON.stringify([{ start: oldStart, end: oldStart + 1800000 }]));
  discordWebhookFailure = true;
  try {
    const edited = await callAttendance('POST', 'hr-id', {
      action: 'edit-entry',
      targetDiscordId: 'member-id',
      entryStart: oldStart,
      clockIn: '10:00',
      clockOut: '10:30',
      reason: 'Pontaj nedeschis'
    });
    assert.equal(edited.statusCode, 200);
    assert.match(edited.payload.warning, /notificarea Discord nu a putut fi trimisă: HTTP 500/);

    discordWebhookFailure = false;
    process.env.DISCORD_ATTENDANCE_REVIEW_WEBHOOK = '';
    redisValues.set(key, JSON.stringify([{ start: oldStart, end: oldStart + 1800000 }]));
    const missingWebhook = await callAttendance('POST', 'hr-id', {
      action: 'edit-entry',
      targetDiscordId: 'member-id',
      entryStart: oldStart,
      clockIn: '10:00',
      clockOut: '10:30',
      reason: 'Pontaj nedeschis'
    });
    assert.match(missingWebhook.payload.warning, /DISCORD_ATTENDANCE_REVIEW_WEBHOOK is missing or invalid/);
  } finally {
    discordWebhookFailure = false;
    process.env.DISCORD_ATTENDANCE_REVIEW_WEBHOOK = 'https://discord.com/api/webhooks/test/token';
  }
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

test('only leadership and H.R. can request attendance document updates', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const result = await callAttendance('POST', 'member-id', {
    action: 'sync-docs',
    targetDiscordId: 'member-id',
    dateKey: today,
    status: 'validated'
  });

  test('attendance document synchronization has a server-enforced cooldown', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const cooldownKey = 'site-testeri-medici:attendance-docs-sync:leadership-id';
    redisValues.delete(cooldownKey);
    redisExpirations.delete(cooldownKey);
    const first = await callAttendance('POST', 'leadership-id', { action: 'sync-docs-all', dateKey: today });
    assert.notEqual(first.statusCode, 429);
    assert.equal(redisValues.has(cooldownKey), true);

    const repeated = await callAttendance('POST', 'leadership-id', { action: 'sync-docs-all', dateKey: today });
    assert.equal(repeated.statusCode, 429);
    assert.ok(repeated.payload.cooldownSeconds > 0);
    redisValues.delete(cooldownKey);
    redisExpirations.delete(cooldownKey);
  });
  assert.equal(result.statusCode, 403);

  const memberActiveView = await callAttendance('GET', 'member-id', {}, { view: 'active' });
  assert.equal(memberActiveView.statusCode, 200);
  assert.ok(memberActiveView.payload.entries);
  assert.ok(Array.isArray(memberActiveView.payload.members));

  const hr = await callAttendance('GET', 'hr-id', {}, { view: 'active', date: today });
  assert.equal(hr.statusCode, 200);
  assert.ok(Array.isArray(hr.payload.members));

  const start = Date.now() - 120000;
  const memberKey = 'site-testeri-medici:attendance:member-id';
  redisValues.set(memberKey, JSON.stringify([{ start, end: start + 60000 }]));
  const hrReview = await callAttendance('POST', 'hr-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: start,
    dateKey: today,
    status: 'validated'
  });
  assert.equal(hrReview.statusCode, 200);
  assert.equal(JSON.parse(redisValues.get(memberKey))[0].validated, true);

  const nonHrReview = await callAttendance('POST', 'member-id', {
    action: 'review-entry',
    targetDiscordId: 'member-id',
    entryStart: Date.now() - 60000,
    dateKey: today,
    status: 'validated'
  });
  assert.equal(nonHrReview.statusCode, 403);
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
