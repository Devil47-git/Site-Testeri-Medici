import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_IMPORT_EVENT_ID,
  LIFETIME_HISTORY_HEADER,
  lifetimeRowFromHistory,
  lifetimeRowsToAppend,
  lifetimeTestCounts
} from '../lib/access/lifetime-test-history.js';

test('legacy TEST_HISTORY rows are imported once and remain deduplicated', () => {
  const activeRows = [
    ['tester-1', '105', 'Test ALS', 'Admis', '2026-10-02T10:00:00.000Z', '', '', 'event-1'],
    ['tester-1', '105', 'Test MOTO', 'Respins', '2026-10-02T10:05:00.000Z', '', '', 'event-2']
  ];
  const firstImport = lifetimeRowsToAppend([LIFETIME_HISTORY_HEADER], activeRows);
  assert.deepEqual(firstImport.slice(0, 2), activeRows.map((row, index) => lifetimeRowFromHistory(row, index + 2)));
  assert.equal(firstImport.at(-1)[0], LEGACY_IMPORT_EVENT_ID);
  assert.deepEqual(lifetimeRowsToAppend([LIFETIME_HISTORY_HEADER, ...firstImport], activeRows), []);
});

test('lifetime counts deduplicate event IDs and exclude the import marker', () => {
  const event = ['event-1', 'tester-1', '105', 'Test ALS', 'Admis', '2026-10-02T10:00:00.000Z', '', ''];
  const rows = [LIFETIME_HISTORY_HEADER, event, event, [LEGACY_IMPORT_EVENT_ID, '', '', '', '', '', '', '']];
  assert.deepEqual(lifetimeTestCounts(rows), [{ discordId: 'tester-1', callsign: '105', testName: 'Test ALS', count: 1 }]);
});

test('only known test catalog entries are imported and counted', () => {
  const unknown = ['tester-1', '105', 'Test Inventat', 'Admis', '2026-10-02T10:00:00.000Z', '', '', 'event-unknown'];
  assert.deepEqual(lifetimeRowsToAppend([LIFETIME_HISTORY_HEADER], [unknown]), [[LEGACY_IMPORT_EVENT_ID, '', '', '', '', '', '', '']]);
  assert.deepEqual(lifetimeTestCounts([LIFETIME_HISTORY_HEADER, ['event-unknown', ...unknown.slice(0, 7)]]), []);
});
