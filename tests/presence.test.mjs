import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presenceWritePlan } from '../api/access/presence.js';

test('presence updates only the lastSeen cell for an existing grant row', () => {
  const rows = [
    ['discordId', 'callsign', 'grantedTests', 'updatedAt', 'lastSeen', 'grantMode'],
    ['123', 'M-101', 'Test ALS', '2026-10-01T10:00:00.000Z', '', 'override']
  ];

  assert.deepEqual(
    presenceWritePlan(rows, '123', 'M-101', '2026-10-03T10:00:00.000Z'),
    { type: 'update', range: "'GRANTS'!E2", values: [['2026-10-03T10:00:00.000Z']] }
  );
});

test('presence appends a new member without overwriting existing grants', () => {
  const rows = [
    ['discordId', 'callsign', 'grantedTests', 'updatedAt', 'lastSeen', 'grantMode'],
    ['123', 'M-101', 'Test ALS', '', '2026-10-02T10:00:00.000Z', 'override']
  ];

  assert.deepEqual(
    presenceWritePlan(rows, '456', 'M-102', '2026-10-03T10:00:00.000Z'),
    {
      type: 'append',
      range: "'GRANTS'!A1:F",
      values: [['456', 'M-102', '', '', '2026-10-03T10:00:00.000Z', '']]
    }
  );
});

test('presence rejects a grants sheet without its expected header rather than overwriting data', () => {
  assert.throws(
    () => presenceWritePlan([['123', 'M-101', 'Test ALS']], '123', 'M-101', '2026-10-03T10:00:00.000Z'),
    /missing its header row/
  );
});
