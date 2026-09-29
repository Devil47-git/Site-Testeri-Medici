import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'script.js'), 'utf8');

/** Extracts a top-level function declaration by name from the app bundle. */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in script.js`);
  let depth = 0;
  let i = source.indexOf('{', start);
  const bodyStart = i;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

const catalog = ['Test admitere', 'Test transfer', 'Adeverință medicală', 'Test ALS', 'Test SMULS', 'Test MOTO', 'Test PILOT', 'Test parașutiști'];
const definitions = Object.fromEntries(catalog.map(n => [n, { name: n, questions: [] }]));

const names = ['callsignNumber', 'normalizeCallsign', 'isLeadershipUser', 'memberIsLeadership', 'leadershipTitleForCallsign', 'allowedForUser', 'memberIsTester', 'sortMembers'];
const srcs = names.map(extract).join('\n');
const load = new Function(
  'catalog',
  'testDefinitions',
  `${srcs}\nreturn { callsignNumber, normalizeCallsign, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberIsTester, sortMembers };`,
)(catalog, definitions);

const { callsignNumber, normalizeCallsign, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberIsTester, sortMembers } = load;

test('callsignNumber strips non-digits and returns 0 for empty', () => {
  assert.equal(callsignNumber('M-007'), 7);
  assert.equal(callsignNumber(7), 7);
  assert.equal(callsignNumber(''), 0);
  assert.equal(callsignNumber(undefined), 0);
  assert.equal(callsignNumber('abc'), 0);
});

test('normalizeCallsign pads to three digits', () => {
  assert.equal(normalizeCallsign('7'), 'M-007');
  assert.equal(normalizeCallsign('M-7'), 'M-007');
  assert.equal(normalizeCallsign('abc'), '');
  assert.equal(normalizeCallsign(undefined), '');
});

test('isLeadershipUser accepts csNum 1-15 and leadership flags', () => {
  assert.equal(isLeadershipUser({ csNum: 1 }), true);
  assert.equal(isLeadershipUser({ csNum: 15 }), true);
  assert.equal(isLeadershipUser({ csNum: 16 }), false);
  assert.equal(isLeadershipUser({ accessLevel: 'leadership', csNum: 900 }), true);
  assert.equal(isLeadershipUser(null), false);
});

test('memberIsLeadership mirrors isLeadershipUser', () => {
  assert.equal(memberIsLeadership({ csNum: 3 }), isLeadershipUser({ csNum: 3 }));
  assert.equal(memberIsLeadership({}), isLeadershipUser({}));
});

test('leadershipTitleForCallsign maps ranges', () => {
  assert.equal(leadershipTitleForCallsign('1'), 'Director General');
  assert.equal(leadershipTitleForCallsign('3'), 'Director Adjunct');
  assert.equal(leadershipTitleForCallsign('6'), 'Medic Inspector');
  assert.equal(leadershipTitleForCallsign('12'), 'Medic Chirurg');
  assert.equal(leadershipTitleForCallsign('50'), '');
});

test('allowedForUser returns full catalog for leadership', () => {
  assert.deepEqual(allowedForUser({ csNum: 2 }), catalog);
});

test('allowedForUser filters to known, defined tests only', () => {
  const allowed = allowedForUser({ grantedTests: ['Test MOTO', 'Inventat'] });
  assert.deepEqual(allowed, ['Test MOTO']);
});

test('memberIsTester handles missing csNum without NaN', () => {
  assert.equal(memberIsTester({ grantedTests: ['Test MOTO'] }), true);
  assert.equal(memberIsTester({ csNum: 250 }), true);
  assert.equal(memberIsTester({ functions: 'tester' }), true);
  assert.equal(memberIsTester({}), false);
});

test('sortMembers places leadership first, then by csNum', () => {
  const sorted = sortMembers([{ csNum: 250 }, { csNum: 20 }, { csNum: 5 }]).map(m => m.csNum);
  assert.deepEqual(sorted, [5, 20, 250]);
});
