import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { memberFunctionLabels, memberFunctionsDirectory, normalizeMemberFunctionLabels } from '../api/access/functions.js';

test('function directory includes assignable staff roles and distinct values from department column K', () => {
  const rows = [
    ['headers'],
    ['', '', '001', 'Director', '', '', '', '', '', '', 'H.R. / H.R. AV | P.R.', '', '', '', '', '', '', '', '', 'leader'],
    ['', '', '105', 'Member', '', '', '', '', '', '', 'P.R. | PILOT / P', '', '', '', '', '', '', '', '', 'member'],
    ['', '', '106', 'Other', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'other'],
    ['', '', '107', 'No Discord', '', '', '', '', '', '', 'PILOT / P', '', '', '', '', '', '', '', '', '']
  ];
  assert.deepEqual(memberFunctionLabels('H.R. / H.R. AV | P.R. | P.R.'), ['H.R. / H.R. AV', 'P.R.']);
  assert.deepEqual(memberFunctionLabels('Manager I.S.U.L.S. | S.M.U.L.S. | P.R.'), ['Manager I.S.U.L.S. | S.M.U.L.S.', 'P.R.']);
  assert.deepEqual(normalizeMemberFunctionLabels(['P.R.', 'p.r.', ' New Role ', 'bad|value', 'Manager I.S.U.L.S. | S.M.U.L.S.', '']), ['P.R.', 'New Role', 'Manager I.S.U.L.S. | S.M.U.L.S.']);
  assert.deepEqual(memberFunctionsDirectory(rows), {
    catalog: [
      { id: 'H.R. / H.R. AV', label: 'H.R. / H.R. AV', description: 'H.R. / H.R. AV' },
      { id: 'P.R.', label: 'P.R.', description: 'P.R.' },
      { id: 'PILOT / P', label: 'PILOT / P', description: 'PILOT / P' },
      { id: 'Helper', label: 'Helper', description: 'Helper' },
      { id: 'Moderator', label: 'Moderator', description: 'Moderator' },
      { id: 'Administrator', label: 'Administrator', description: 'Administrator' },
      { id: 'Supervizor', label: 'Supervizor', description: 'Supervizor' }
    ],
    assignments: [
      { discordId: 'leader', callsign: '001', functionIds: ['H.R. / H.R. AV', 'P.R.'], isOverride: false, attendanceTypes: ['regular', 'hr'] },
      { discordId: 'member', callsign: '105', functionIds: ['P.R.', 'PILOT / P'], isOverride: false, attendanceTypes: ['regular'] },
      { discordId: 'other', callsign: '106', functionIds: [], isOverride: false, attendanceTypes: ['regular'] },
      { discordId: '', callsign: '107', functionIds: ['PILOT / P'], isOverride: false, attendanceTypes: ['regular'] }
    ]
  });
  const overridden = memberFunctionsDirectory(rows, new Map([['member', ['Helper']]]));
  assert.deepEqual(overridden.assignments.find(item => item.discordId === 'member').functionIds, ['Helper']);
  assert.equal(overridden.assignments.find(item => item.discordId === 'member').isOverride, true);
});

test('function catalog follows leadership, HR, PR, tester, PH, then CJ ordering', () => {
  const row = Array(20).fill('');
  row[2] = '105';
  row[3] = 'Member';
  row[10] = 'C.J. | P.H. | Test MOTO | P.R. | H.R. | Adjunct I.S.U.L.S. | S.M.U.L.S. | Șefie | Other';
  row[19] = 'member';
  const catalog = memberFunctionsDirectory([['header'], row]).catalog.map(item => item.label);
  assert.deepEqual(catalog, [
    'Adjunct I.S.U.L.S. | S.M.U.L.S.',
    'Șefie',
    'H.R.',
    'P.R.',
    'Test MOTO',
    'P.H.',
    'C.J.',
    'Helper',
    'Moderator',
    'Administrator',
    'Supervizor',
    'Other'
  ]);
});

test('function directory reads live functions and requires a department member', async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = 'test-key';
  const leader = Array(20).fill('');
  leader[2] = '001';
  leader[3] = 'Director';
  leader[10] = 'H.R. / H.R. AV | C.J.';
  leader[19] = 'requester';
  const member = Array(20).fill('');
  member[2] = '105';
  member[3] = 'Member';
  member[10] = 'C.J. | New Role';
  member[19] = 'target';
  globalThis.fetch = async () => new Response(JSON.stringify({ values: [['header'], leader, member] }), { status: 200 });
  const createResponse = () => ({
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    const response = createResponse();
    await handler({ method: 'GET', query: { requesterId: 'requester' } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.catalog.map(item => item.label), ['H.R. / H.R. AV', 'C.J.', 'Helper', 'Moderator', 'Administrator', 'Supervizor', 'New Role']);
    assert.deepEqual(response.body.assignments.find(item => item.discordId === 'target').functionIds, ['C.J.', 'New Role']);
    assert.equal(response.body.assignments.find(item => item.discordId === 'target').isOverride, false);
    assert.deepEqual(response.body.assignments.find(item => item.discordId === 'requester').attendanceTypes, ['regular', 'hr']);

    const denied = createResponse();
    await handler({ method: 'GET', query: { requesterId: 'unknown' } }, denied);
    assert.equal(denied.statusCode, 403);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previousApiKey;
  }
});
