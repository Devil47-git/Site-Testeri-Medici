import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { MEMBER_FUNCTIONS, normalizeFunctionIds, saveFunctionAssignment } from '../api/access/functions.js';

test('member function catalog contains each requested function once', () => {
  const ids = MEMBER_FUNCTIONS.map(item => item.id);
  assert.equal(ids.length, 24);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(MEMBER_FUNCTIONS.map(item => item.label)).size, ids.length);
  assert.equal(new Set(ids.map((_, index) => (index * 37) % 360)).size, ids.length);
  assert.ok(MEMBER_FUNCTIONS.some(item => item.label === 'C.J.' && item.description === 'Coordonator jaf'));
  assert.ok(MEMBER_FUNCTIONS.some(item => item.label === 'PILOT / P' && item.description === 'Instructor pilot'));
  assert.ok(MEMBER_FUNCTIONS.some(item => item.label === 'Responsabil Co (concedii)'));
});

test('member function assignments discard unknown values and duplicate IDs', () => {
  assert.deepEqual(normalizeFunctionIds(['instructor-als', 'instructor-als', 'unknown']), ['instructor-als']);
  assert.deepEqual(normalizeFunctionIds('instructor-als'), []);
});

test('saving member functions appends once, then updates the existing assignment', async () => {
  const rows = [['discordId', 'callsign', 'functionIds', 'updatedAt']];
  const writes = [];
  const sheets = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { title: 'MEMBER_FUNCTIONS' } }] } }),
      values: {
        update: async ({ range, requestBody }) => {
          writes.push(range);
          if (range === 'MEMBER_FUNCTIONS!A1:D1') rows[0] = requestBody.values[0];
          else rows[Number(range.match(/A(\d+):/)?.[1]) - 1] = requestBody.values[0];
        },
        get: async () => ({ data: { values: rows } }),
        append: async ({ requestBody }) => { rows.push(...requestBody.values); }
      }
    }
  };
  const member = ['', '', '105'];
  const first = await saveFunctionAssignment(sheets, member, 'discord-target', ['instructor-als'], '2026-01-01T00:00:00.000Z');
  const second = await saveFunctionAssignment(sheets, member, 'discord-target', ['instructor-moto'], '2026-01-02T00:00:00.000Z');
  assert.deepEqual(first.functionIds, ['instructor-als']);
  assert.deepEqual(second.functionIds, ['instructor-moto']);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][2], 'instructor-moto');
  assert.deepEqual(writes, ['MEMBER_FUNCTIONS!A2:D2']);
});

test('function directory requires a real department member and returns the role catalog', async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = 'test-key';
  const memberRow = Array(20).fill('');
  memberRow[2] = '001';
  memberRow[3] = 'Director';
  memberRow[19] = 'requester';
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (decodeURIComponent(url.pathname).includes('LISTA DEPARTAMENT')) {
      return new Response(JSON.stringify({ values: [['header'], memberRow] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      values: [
        ['discordId', 'callsign', 'functionIds', 'updatedAt'],
        ['target', '105', 'instructor-als|instructor-als', '2026-01-01T00:00:00.000Z']
      ]
    }), { status: 200 });
  };
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
    assert.equal(response.body.catalog.length, 24);
    assert.deepEqual(response.body.assignments[0].functionIds, ['instructor-als']);

    const denied = createResponse();
    await handler({ method: 'GET', query: { requesterId: 'unknown' } }, denied);
    assert.equal(denied.statusCode, 403);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previousApiKey;
  }
});
