import { catalog } from './shared.js';

export const LIFETIME_HISTORY_HEADER = ['eventId', 'discordId', 'callsign', 'testName', 'result', 'createdAt', 'candidateCallsign', 'candidateName'];
export const LEGACY_IMPORT_EVENT_ID = '__legacy_test_history_imported__';

export function historyEventId(row, rowNumber) {
  return String(row?.[7] || `legacy:${rowNumber}:${String(row?.[4] || '').trim()}`);
}

export function lifetimeRowFromHistory(row, rowNumber) {
  return [historyEventId(row, rowNumber), ...Array.from({ length: 7 }, (_, index) => String(row?.[index] || '').trim())];
}

export function lifetimeRowForNewResult({ eventId, discordId, callsign, testName, result, createdAt, candidateCallsign = '', candidateName = '' }) {
  return [eventId, discordId, callsign, testName, result, createdAt, candidateCallsign, candidateName];
}

export function lifetimeRowsToAppend(existingRows, activeRows) {
  const existingIds = new Set((existingRows || []).slice(1).map(row => String(row?.[0] || '')));
  const rowsToAppend = [];
  (activeRows || []).forEach((row, index) => {
    const lifetimeRow = lifetimeRowFromHistory(row, index + 2);
    if (!lifetimeRow[1] || !catalog.includes(lifetimeRow[3]) || existingIds.has(lifetimeRow[0])) return;
    existingIds.add(lifetimeRow[0]);
    rowsToAppend.push(lifetimeRow);
  });
  if (!existingIds.has(LEGACY_IMPORT_EVENT_ID)) rowsToAppend.push([LEGACY_IMPORT_EVENT_ID, '', '', '', '', '', '', '']);
  return rowsToAppend;
}

export function lifetimeTestCounts(rows) {
  const counts = new Map();
  const eventIds = new Set();
  for (const row of (rows || []).slice(1)) {
    const eventId = String(row?.[0] || '');
    const discordId = String(row?.[1] || '').trim();
    const callsign = String(row?.[2] || '').trim();
    const testName = String(row?.[3] || '').trim();
    if (!eventId || eventId === LEGACY_IMPORT_EVENT_ID || eventIds.has(eventId) || !discordId || !catalog.includes(testName)) continue;
    eventIds.add(eventId);
    const key = `${discordId}\u0000${testName}`;
    const entry = counts.get(key) || { discordId, callsign, testName, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()];
}
