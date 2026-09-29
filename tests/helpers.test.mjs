import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { accessFor, catalog as accessCatalog, isLeadership } from '../api/access/shared.js';

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

const names = ['callsignNumber', 'normalizeCallsign', 'isLeadershipUser', 'memberIsLeadership', 'leadershipTitleForCallsign', 'allowedForUser', 'memberIsTester', 'memberCanGiveTest', 'docsAssignedTests', 'sortMembers', 'gradeGroupFor'];
const srcs = names.map(extract).join('\n');
const pattern = source.match(/^const RESIDENT_TESTER_PATTERN = .*$/m)?.[0] || 'const RESIDENT_TESTER_PATTERN = /TESTER/;';
const normalizeTextSrc = extract('normalizeText');
const fullSrc = `${pattern}\n${normalizeTextSrc}\n${srcs}`;
const testSummaryDefinitions = [['Test SMULS'], ['Test MOTO'], ['Test PILOT'], ['Test ALS'], ['Test parașutiști']];
const load = new Function(
  'catalog',
  'testDefinitions',
  'testSummaryDefinitions',
  `${fullSrc}\nreturn { callsignNumber, normalizeCallsign, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberIsTester, memberCanGiveTest, docsAssignedTests, sortMembers, gradeGroupFor };`,
)(catalog, definitions, testSummaryDefinitions);

const { callsignNumber, normalizeCallsign, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberIsTester, memberCanGiveTest, sortMembers, gradeGroupFor } = load;

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
  assert.equal(isLeadershipUser({ csNum: 10 }), true);
  assert.equal(isLeadershipUser({ csNum: 11 }), true);
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
  assert.equal(leadershipTitleForCallsign('12'), '');
  assert.equal(leadershipTitleForCallsign('10'), 'Medic Chirurg');
  assert.equal(leadershipTitleForCallsign('50'), '');
});

test('allowedForUser returns full catalog for leadership', () => {
  assert.deepEqual(allowedForUser({ csNum: 2 }), catalog);
});

test('allowedForUser filters to known, defined tests only', () => {
  const allowed = allowedForUser({ grantedTests: ['Test MOTO', 'Inventat'] });
  assert.deepEqual(allowed, ['Test MOTO']);
});

test('non-leadership users receive only explicitly granted tests', () => {
  const assigned = ['Test MOTO'];
  assert.deepEqual(allowedForUser({ allowedTests: accessCatalog, eligibleSpecializations: ['Test ALS'], grantedTests: assigned }), assigned);
  assert.deepEqual(allowedForUser({ functions: 'S.M.U.L.S.', grantedTests: [] }), ['Test SMULS']);
  assert.deepEqual(accessFor(320, 'MOTO', 'Medic Rezident', '').allowedTests, []);
  assert.deepEqual(accessFor(320, 'S.M.U.L.S. | A.L.S.', 'Medic Rezident', '').grantedTests, ['Test SMULS', 'Test ALS']);
});

test('leadership alone receives general catalog access', () => {
  assert.deepEqual(accessFor(1, '', 'Medic Inspector', '').allowedTests, accessCatalog);
  assert.deepEqual(allowedForUser({ csNum: 1, grantedTests: [] }), catalog);
  assert.equal(isLeadership(210, 'Medic Specialist', 'Departamentul Medical'), false);
  assert.equal(isLeadership(4, 'Director Adjunct', 'Departamentul Medical'), true);
});

test('eligible specializations do not override revoked grants', () => {
  assert.deepEqual(allowedForUser({ eligibleSpecializations: ['Test MOTO'], grantedTests: [] }), []);
});

test('memberIsTester handles missing csNum without NaN', () => {
  assert.equal(memberIsTester({ grantedTests: ['Test MOTO'] }), true);
  assert.equal(memberIsTester({ csNum: 250 }), false);
  assert.equal(memberIsTester({ csNum: 205 }), true);
  assert.equal(memberIsTester({ csNum: 101 }), true);
  assert.equal(memberIsTester({ csNum: 115 }), true);
  assert.equal(memberIsTester({ csNum: 100 }), false);
  assert.equal(memberIsTester({ csNum: 50 }), false);
  assert.equal(memberIsTester({ csNum: 320, functions: 'MOTO' }), true);
  assert.equal(memberIsTester({ csNum: 320, functions: 'AMBULANTA' }), false);
  assert.equal(memberIsTester({ csNum: 340, functions: 'PILOT' }), true);
  assert.equal(memberIsTester({ csNum: 341, functions: 'PILOT' }), false);
  assert.equal(memberIsTester({ functions: 'tester' }), true);
  assert.equal(memberIsTester({}), false);
});

test('Docs-based dashboard filters match dotted SMULS and ALS functions', () => {
  assert.equal(memberCanGiveTest({ functions: 'S.M.U.L.S.' }, 'Test SMULS'), true);
  assert.equal(memberCanGiveTest({ functions: 'A.L.S.' }, 'Test ALS'), true);
  assert.equal(memberCanGiveTest({ functions: 'MOTO' }, 'Test MOTO'), true);
  assert.equal(memberCanGiveTest({ functions: 'PILOT' }, 'Test PILOT'), true);
  assert.equal(memberCanGiveTest({ functions: 'PARASUTIST' }, 'Test parașutiști'), true);
  assert.equal(memberCanGiveTest({ functions: 'MOTO' }, 'Test ALS'), false);
});

test('sortMembers places leadership first, then by csNum', () => {
  const sorted = sortMembers([{ csNum: 250 }, { csNum: 20 }, { csNum: 5 }]).map(m => m.csNum);
  assert.deepEqual(sorted, [5, 20, 250]);
});

test('gradeGroupFor splits conducere, primari and specialisti', () => {
  assert.equal(gradeGroupFor(1), 'Conducerea departamentului');
  assert.equal(gradeGroupFor(10), 'Conducerea departamentului');
  assert.equal(gradeGroupFor(15), 'Conducerea departamentului');
  assert.equal(gradeGroupFor(16), '');
  assert.equal(gradeGroupFor(101), 'Medici Primari (101-115)');
  assert.equal(gradeGroupFor(115), 'Medici Primari (101-115)');
  assert.equal(gradeGroupFor(116), '');
  assert.equal(gradeGroupFor(201), 'Medici Specialisti (201-230)');
  assert.equal(gradeGroupFor(230), 'Medici Specialisti (201-230)');
  assert.equal(gradeGroupFor(231), '');
});
