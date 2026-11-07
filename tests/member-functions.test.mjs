import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { memberFunctionLabels, memberFunctionsDirectory, normalizeMemberFunctionLabels, saveDepartmentFunctionAssignment } from '../api/access/functions.js';

test('function directory is derived from distinct values in department column K', () => {
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
      { id: 'PILOT / P', label: 'PILOT / P', description: 'PILOT / P' }
    ],
    assignments: [
      { discordId: 'leader', callsign: '001', functionIds: ['H.R. / H.R. AV', 'P.R.'], attendanceTypes: ['regular', 'hr'] },
      { discordId: 'member', callsign: '105', functionIds: ['P.R.', 'PILOT / P'], attendanceTypes: ['regular'] },
      { discordId: 'other', callsign: '106', functionIds: [], attendanceTypes: ['regular'] },
      { discordId: '', callsign: '107', functionIds: ['PILOT / P'], attendanceTypes: ['regular'] }
    ]
  });
});

test('saving member functions writes only the target member column K cell', async () => {
  const members = [
    ['headers'],
    ['', '', '001', 'Director', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'leader'],
    ['', '', '105', 'Member', '', '', '', '', '', '', 'P.R.', '', '', '', '', '', '', '', '', 'target']
  ];
  const writes = [];
  const sheets = {
    spreadsheets: {
      values: {
        update: async request => writes.push(request)
      }
    }
  };
  const assignment = await saveDepartmentFunctionAssignment(sheets, members, 'target', ['P.R.', 'New Role'], '2026-01-02T00:00:00.000Z');
  assert.deepEqual(assignment, {
    discordId: 'target',
    callsign: '105',
    functionIds: ['P.R.', 'New Role'],
    attendanceTypes: ['regular'],
    updatedAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].range, "'LISTA DEPARTAMENT'!K3");
  assert.deepEqual(writes[0].requestBody.values, [['P.R. | New Role']]);
  assert.equal(writes[0].valueInputOption, 'RAW');
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
    assert.deepEqual(response.body.catalog.map(item => item.label), ['H.R. / H.R. AV', 'C.J.', 'New Role']);
    assert.deepEqual(response.body.assignments.find(item => item.discordId === 'target').functionIds, ['C.J.', 'New Role']);
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
