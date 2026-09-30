import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { accessFor, catalog as accessCatalog, coreTests, functionsForMember, isLeadership, normalizeTests, testsForFunctions } from '../api/access/shared.js';
import { createAdmissionEmbeds } from '../api/access/test-results.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'script.js'), 'utf8');
const serverSource = readFileSync(join(here, '..', 'server.js'), 'utf8');

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

const names = ['callsignNumber', 'normalizeCallsign', 'isLeadershipUser', 'memberIsLeadership', 'leadershipTitleForCallsign', 'allowedForUser', 'memberIsTester', 'memberCanGiveTest', 'docsAssignedTests', 'sortMembers', 'gradeGroupFor', 'admissionChecksComplete', 'isTestFailed', 'maxWrongForTest', 'questionItemHtml', 'parseIdentityCardText'];
const srcs = names.map(extract).join('\n');
const pattern = source.match(/^const RESIDENT_TESTER_PATTERN = .*$/m)?.[0] || 'const RESIDENT_TESTER_PATTERN = /TESTER/;';
const normalizeTextSrc = extract('normalizeText');
const fullSrc = `${pattern}\nconst admissionRequirements = ['Verificarea ținutei', 'Verificarea tatuajelor faciale', 'Verificarea cazierului', 'Minimum 50 de ore jucate', 'Controlul cu stetoscopul', 'Drug-testul'];\n${normalizeTextSrc}\n${srcs}`;
const testSummaryDefinitions = [['Test SMULS'], ['Test MOTO'], ['Test PILOT'], ['Test ALS'], ['Test parașutiști']];
const load = new Function(
  'catalog',
  'testDefinitions',
  'testSummaryDefinitions',
  `${fullSrc}\nreturn { callsignNumber, normalizeCallsign, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberIsTester, memberCanGiveTest, docsAssignedTests, sortMembers, gradeGroupFor, admissionChecksComplete, isTestFailed, maxWrongForTest, questionItemHtml, parseIdentityCardText };`,
)(catalog, definitions, testSummaryDefinitions);

const { callsignNumber, normalizeCallsign, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberIsTester, memberCanGiveTest, sortMembers, gradeGroupFor, admissionChecksComplete, isTestFailed, maxWrongForTest, questionItemHtml, parseIdentityCardText } = load;

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

test('Tester Docs role maps to the complete three-test bundle', () => {
  assert.deepEqual(testsForFunctions('TESTER'), coreTests);
  assert.deepEqual(testsForFunctions('TESTER | A.L.S.'), [...coreTests, 'Test ALS']);
  assert.deepEqual(normalizeTests(['Test transfer']), coreTests);
});

test('promotion to specialist or primary automatically assigns Tester function', () => {
  assert.equal(functionsForMember(101, ''), 'TESTER');
  assert.equal(functionsForMember(230, 'A.L.S.'), 'A.L.S. | TESTER');
  assert.equal(functionsForMember(205, 'TESTER | MOTO'), 'TESTER | MOTO');
  assert.equal(functionsForMember(300, ''), '');
  assert.deepEqual(accessFor(105, '', 'Medic Primar', '').grantedTests, coreTests);
  assert.deepEqual(accessFor(205, '', 'Medic Specialist', '').grantedTests, coreTests);
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

test('admission test unlocks only after all six requirements are checked', () => {
  assert.equal(admissionChecksComplete([true, true, true, true, true, false]), false);
  assert.equal(admissionChecksComplete([true, true, true, true, true, true]), true);
  assert.equal(admissionChecksComplete([true, true, true, true, true]), false);
});

test('admission test rejects the fourth mistake', () => {
  const limit = maxWrongForTest('Test admitere', 2);
  assert.equal(limit, 3);
  assert.equal(isTestFailed(3, limit), false);
  assert.equal(isTestFailed(4, limit), true);
  assert.equal(maxWrongForTest('Test transfer', 2), 2);
});

test('Discord session and browser auth cache both last 24 hours', () => {
  assert.match(source, /const AUTH_TTL=24\*60\*60\*1000/);
  assert.match(serverSource, /const SESSION_TTL = 24 \* 60 \* 60 \* 1000/);
  assert.match(serverSource, /Max-Age=\$\{SESSION_TTL \/ 1000\}/);
});

test('each question keeps prompt, answer, and wrong checkbox in one box', () => {
  const markup = questionItemHtml({ text: 'Întrebare?', answer: 'Răspunsul corect.' }, 0);
  assert.match(markup, /<fieldset><p class="question-prompt">1\. Întrebare\?<\/p>/);
  assert.match(markup, /<span>Răspunsul corect\.<\/span><label class="answer-check">/);
  assert.match(markup, /data-wrong="0"/);
  assert.doesNotMatch(markup, /Răspuns:/);
});

test('identity card OCR parser extracts only name and CNP', () => {
  const details = parseIdentityCardText('CNP 1060825927178\nNume/Nom/Last name\nCartier\nPrenume/Prenom/First name\nMohammed\nSERIA LS NR 92717');
  assert.deepEqual(details, { name: 'Cartier Mohammed', cnp: '1060825927178' });
});

test('identity card OCR parser handles inline labels and spaced or confused CNP digits', () => {
  const details = parseIdentityCardText('Nume/Nom/Last name Cartier Prenume/Prenom/First name Mohammed\nCNP: 1O60 8259 27178');
  assert.deepEqual(details, { name: 'Cartier Mohammed', cnp: '1060825927178' });
});

test('identity card OCR parser skips misread blue labels before reading the values below', () => {
  const details = parseIdentityCardText('iLast name.\nCartier\niFirst name.\nMohammed\nCNP\n1060825927178');
  assert.deepEqual(details, { name: 'Cartier Mohammed', cnp: '1060825927178' });
});

test('admission Discord embeds use vertical fields and hide callsign on rejection', () => {
  const rejected = createAdmissionEmbeds({ testerName: 'Tester', testerDiscordId: '99', candidateName: 'Candidat', candidateId: '12345', candidateCallsign: '', result: 'Respins' });
  assert.deepEqual(rejected.admission.embed.fields.map(field => field.name), ['Nume candidat', 'Rezultat']);
  assert.equal(rejected.admission.mentions, '<@99>');
  assert.deepEqual(rejected.admission.allowedMentions.roles, []);
  assert.match(rejected.admission.mentions, /<@99>/);
  assert.match(rejected.testers.mentions, /<@&825071956101169202>/);
  assert.doesNotMatch(rejected.testers.mentions, /1033692302767558717/);
  assert.deepEqual(rejected.testers.embeds[0].fields.map(field => field.name), ['Nume Tester', 'Nume Candidat', 'ID', 'Rezultat']);
  assert.deepEqual(rejected.testers.embeds[0].fields[2], { name: 'ID', value: '12345', inline: false });
  assert.deepEqual(rejected.testers.embeds.slice(1).map(embed => embed.title), ['Buletin', 'Fișă medicală', 'Drug-test']);
  assert.ok(rejected.testers.embeds.slice(1).every(embed => embed.thumbnail && !embed.image));
  const admitted = createAdmissionEmbeds({ testerName: 'Tester', testerDiscordId: '99', candidateName: 'Candidat', candidateId: '12345', candidateCallsign: 'M-302', result: 'Admis' });
  assert.equal(admitted.testers.embeds[0].fields.at(-1).name, 'Callsign');
  assert.equal(admitted.admission.mentions, '<@99>');
  assert.match(admitted.testers.mentions, /<@&1033692302767558717>/);
  assert.match(admitted.testers.mentions, /<@&825071956101169202>/);
});
