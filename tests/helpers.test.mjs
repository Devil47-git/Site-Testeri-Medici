import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { accessFor, catalog as accessCatalog, coreTests, effectiveTestsForMember, functionsForMember, isLeadership, normalizeTests, testsForFunctions } from '../api/access/shared.js';
import { createAdmissionEmbeds, createAlsResultEmbed, createSpecialtyResultEmbed, createMedicalCertificateEmbeds, medicalCertificateNumberForRow } from '../api/access/test-results.js';
import { statusFromRow } from '../api/access/directory.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'script.js'), 'utf8');
const serverSource = readFileSync(join(here, '..', 'server.js'), 'utf8');
const testCatalogSource = readFileSync(join(here, '..', 'tests.js'), 'utf8');
const discordAuthSource = readFileSync(join(here, '..', 'api', 'auth', 'discord.js'), 'utf8');

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

const names = ['callsignNumber', 'normalizeCallsign', 'isLeadershipUser', 'memberIsLeadership', 'leadershipTitleForCallsign', 'allowedForUser', 'memberHasTestAccess', 'memberIsTester', 'memberCanGiveTest', 'docsAssignedTests', 'sortMembers', 'gradeGroupFor', 'admissionChecksComplete', 'motoChecksComplete', 'memberStatus', 'testerFunctionsForDisplay', 'isTestFailed', 'maxWrongForTest', 'cachedUserWithinSession', 'questionItemHtml', 'evaluationStageHtml', 'parseIdentityCardText', 'mergeIdentityCardDetails', 'displayTestName'];
const srcs = names.map(extract).join('\n');
const pattern = source.match(/^const RESIDENT_TESTER_PATTERN = .*$/m)?.[0] || 'const RESIDENT_TESTER_PATTERN = /TESTER/;';
const normalizeTextSrc = extract('normalizeText');
const escapeHtmlSrc = extract('escapeHtml');
const fullSrc = `${pattern}\nconst AUTH_SCHEMA_VERSION = 4;\nconst coreTests = ['Test admitere', 'Test transfer', 'Adeverință medicală'];\nconst admissionRequirements = ['Verificarea ținutei', 'Verificarea tatuajelor faciale', 'Verificarea cazierului', 'Minimum 50 de ore jucate', 'Controlul cu stetoscopul', 'Drug-testul'];\nconst motoRequirements = ['Grad Medic-Rezident', 'Certificat S.M.U.L.S.', 'Permis Categoria A'];\n${normalizeTextSrc}\n${escapeHtmlSrc}\n${srcs}`;
const testSummaryDefinitions = [['Test SMULS'], ['Test MOTO'], ['Test PILOT'], ['Test ALS'], ['Test parașutiști']];
const load = new Function(
  'catalog',
  'testDefinitions',
  'testSummaryDefinitions',
  `${fullSrc}\nreturn { callsignNumber, normalizeCallsign, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberHasTestAccess, memberIsTester, memberCanGiveTest, docsAssignedTests, sortMembers, gradeGroupFor, admissionChecksComplete, motoChecksComplete, memberStatus, testerFunctionsForDisplay, isTestFailed, maxWrongForTest, cachedUserWithinSession, questionItemHtml, evaluationStageHtml, parseIdentityCardText, mergeIdentityCardDetails, displayTestName };`,
)(catalog, definitions, testSummaryDefinitions);

const { callsignNumber, normalizeCallsign, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberHasTestAccess, memberIsTester, memberCanGiveTest, docsAssignedTests, sortMembers, gradeGroupFor, admissionChecksComplete, motoChecksComplete, memberStatus, testerFunctionsForDisplay, isTestFailed, maxWrongForTest, cachedUserWithinSession, questionItemHtml, evaluationStageHtml, parseIdentityCardText, mergeIdentityCardDetails, displayTestName } = load;

test('Discord auth preserves the Discord display name, username, and avatar', () => {
  const mapperSource = discordAuthSource.match(/function mapSheetRowToUser\(row, discordUser\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(mapperSource, 'mapSheetRowToUser must exist');
  const mapDiscordUser = new Function('accessFor', 'avatarUrl', `${mapperSource}; return mapSheetRowToUser;`)(
    accessFor,
    (discordId, hash) => hash ? `https://cdn.discordapp.com/avatars/${discordId}/${hash}.png` : '',
  );
  const sheetRow = [];
  sheetRow[1] = 'member-id';
  sheetRow[2] = '125';
  sheetRow[3] = 'Department Name';
  sheetRow[4] = 'Medic Specialist';
  sheetRow[5] = 'DMLS';
  sheetRow[10] = 'MOTO';
  const mappedUser = mapDiscordUser(sheetRow, { id: 'discord-id', username: 'discord_user', global_name: 'Discord Display Name', avatar: 'avatar-hash' });
  assert.equal(mappedUser.name, 'Department Name');
  assert.equal(mappedUser.discordDisplayName, 'Discord Display Name');
  assert.equal(mappedUser.discordUsername, 'discord_user');
  assert.equal(mappedUser.avatar, 'https://cdn.discordapp.com/avatars/discord-id/avatar-hash.png');
});

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

test('isLeadershipUser accepts csNum 1-20 and leadership flags', () => {
  assert.equal(isLeadershipUser({ csNum: 1 }), true);
  assert.equal(isLeadershipUser({ csNum: 15 }), true);
  assert.equal(isLeadershipUser({ csNum: 16 }), true);
  assert.equal(isLeadershipUser({ csNum: 20 }), true);
  assert.equal(isLeadershipUser({ csNum: 21 }), false);
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

test('leadership access lists include matching testers but exclude leadership', () => {
  assert.equal(memberHasTestAccess({ functions: 'TESTER' }, 'Test admitere'), true);
  assert.equal(memberHasTestAccess({ functions: 'A.L.S.' }, 'Test ALS'), true);
  assert.equal(memberHasTestAccess({ grantedTests: ['Test MOTO'] }, 'Test MOTO'), true);
  assert.equal(memberHasTestAccess({ functions: 'A.L.S.' }, 'Test SMULS'), false);
  assert.equal(memberHasTestAccess({ csNum: 2, isLeadership: true, grantedTests: ['Test ALS'] }, 'Test ALS'), false);
});

test('leadership access button label remains the tester count after toggling', () => {
  assert.match(source, /Vezi cine are acces \(\$\{accessibleMembers\.length\}\)/);
  assert.doesNotMatch(source, /Ascunde cine are acces/);
});

test('member status follows the status value from column H', () => {
  assert.equal(statusFromRow(['', '', '', '', '', '', '', 'Activ']), 'Activ');
  assert.equal(statusFromRow(['', '', '', '', '', '', '', 'Inactiv']), 'Inactiv');
  assert.equal(statusFromRow(['', '', '', '', '', '', '', 'Concediu']), 'Concediu');
  assert.equal(statusFromRow(['', '', '', '', '', '', '', 'Co Civil']), 'Co Civil');
  assert.equal(memberStatus({ status: 'Activ', lastSeen: 0 }), 'Activ');
  assert.equal(memberStatus({ status: 'Inactiv', lastSeen: Date.now() }), 'Inactiv');
  assert.equal(memberStatus({ status: 'Concediu' }), 'Concediu');
  assert.equal(memberStatus({ status: 'Co Civil' }), 'Co Civil');
  assert.equal(memberStatus({ status: '' }), 'Inactiv');
});

test('member directory shows only the requested tester specializations', () => {
  assert.equal(testerFunctionsForDisplay({ functions: 'Manager M.M.L.S. | A.L.S. | S.M.U.L.S. | TESTER | MOTO | PILOT | PARASUTIST' }), 'A.L.S. | S.M.U.L.S. | Tester | Moto | Pilot');
  assert.equal(testerFunctionsForDisplay({ functions: 'Manager M.M.L.S.' }), '—');
  assert.equal(testerFunctionsForDisplay({ grantedTests: ['Test parașutiști'] }), 'Test Parasutism');
});

test('parachutism requires a manual grant while leadership keeps full access', () => {
  assert.equal(accessFor(221, 'PARASUTIST', 'Medic Specialist', '').grantedTests.includes('Test parașutiști'), false);
  assert.equal(memberHasTestAccess({ grantedTests: ['Test parașutiști'] }, 'Test parașutiști'), true);
  assert.deepEqual(accessFor(2, '', 'Director Adjunct', '').allowedTests, accessCatalog);
});

test('parachutism access label is displayed as Test Parasutism', () => {
  assert.equal(displayTestName('Test parașutiști'), 'Test Parasutism');
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
  assert.deepEqual(accessFor(16, '', 'Medic Chirurg', '').allowedTests, accessCatalog);
  assert.deepEqual(accessFor(20, '', 'Medic Chirurg', '').allowedTests, accessCatalog);
  assert.equal(isLeadership(21, 'Medic Specialist', 'Departamentul Medical'), false);
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

test('explicit test grants override Docs defaults while legacy grants remain additive', () => {
  assert.deepEqual(effectiveTestsForMember('S.M.U.L.S.', { grantMode: 'override', grantedTests: [] }), []);
  assert.deepEqual(effectiveTestsForMember('S.M.U.L.S.', { grantMode: 'override', grantedTests: ['Test ALS'] }), ['Test ALS']);
  assert.deepEqual(effectiveTestsForMember('S.M.U.L.S.', { grantedTests: ['Test ALS'] }), ['Test SMULS', 'Test ALS']);
  assert.deepEqual(effectiveTestsForMember('S.M.U.L.S.', null), ['Test SMULS']);
});

test('explicit grant overrides keep revoked Docs specializations hidden', () => {
  const revoked = { csNum: 320, functions: 'S.M.U.L.S.', grantMode: 'override', grantedTests: [] };
  assert.deepEqual(docsAssignedTests(revoked), []);
  assert.deepEqual(allowedForUser(revoked), []);
  assert.equal(memberCanGiveTest(revoked, 'Test SMULS'), false);
  const restored = { ...revoked, grantedTests: ['Test SMULS'] };
  assert.deepEqual(allowedForUser(restored), ['Test SMULS']);
  assert.equal(memberCanGiveTest(restored, 'Test SMULS'), true);
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
  assert.equal(memberCanGiveTest({ functions: 'PARASUTIST' }, 'Test parașutiști'), false);
  assert.equal(memberCanGiveTest({ functions: 'MOTO' }, 'Test ALS'), false);
  assert.equal(memberCanGiveTest({ grantedTests: ['Test parașutiști'] }, 'Test parașutiști'), true);
});

test('sortMembers places leadership first, then by csNum', () => {
  const sorted = sortMembers([{ csNum: 250 }, { csNum: 20 }, { csNum: 5 }]).map(m => m.csNum);
  assert.deepEqual(sorted, [5, 20, 250]);
});

test('gradeGroupFor splits conducere, primari and specialisti', () => {
  assert.equal(gradeGroupFor(1), 'Conducerea departamentului');
  assert.equal(gradeGroupFor(10), 'Conducerea departamentului');
  assert.equal(gradeGroupFor(15), 'Conducerea departamentului');
  assert.equal(gradeGroupFor(16), 'Conducerea departamentului');
  assert.equal(gradeGroupFor(20), 'Conducerea departamentului');
  assert.equal(gradeGroupFor(21), '');
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

test('Moto test unlocks only after all three prerequisites are checked', () => {
  assert.equal(motoChecksComplete([true, true, false]), false);
  assert.equal(motoChecksComplete([true, true, true]), true);
});

test('Moto and Pilot staged practical content is present in test definitions', () => {
  assert.match(testCatalogSource, /practicalStage:[\s\S]*?5:40 minute \(MOTO/);
  assert.match(testCatalogSource, /evaluationStages:[\s\S]*?Proba 2: Locațiile Pacific/);
  assert.match(testCatalogSource, /Proba 3: Pick-Up la Spitalul Sandy Shores/);
  assert.match(testCatalogSource, /Proba 4: Pick-Up de pe Chiliad/);
});

test('evaluation stage cards include conditions and explicit pass/fail actions', () => {
  const markup = evaluationStageHtml({ title: 'Proba 2', paragraphs: ['Detaliu'], conditions: ['Condiție'] }, [
    { result: 'Admis', text: 'Admis Proba 2' },
    { result: 'Respins', text: 'Respins Proba 2' }
  ]);
  assert.match(markup, /Proba 2/);
  assert.match(markup, /Condiție/);
  assert.match(markup, /Admis Proba 2/);
  assert.match(markup, /Respins Proba 2/);
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

test('an unexpired cached Discord user can reopen the app without a session API roundtrip', () => {
  const user = { discordId: '123', name: 'Tester' };
  assert.deepEqual(cachedUserWithinSession({ version: 4, user, expiresAt: 86400001 }, 86400000), user);
  assert.equal(cachedUserWithinSession({ version: 3, user, expiresAt: 86400001 }, 86400000), null);
  assert.equal(cachedUserWithinSession({ version: 4, user, expiresAt: 86400000 }, 86400000), null);
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
  assert.deepEqual(details, { name: 'Cartier Mohammed', lastName: 'Cartier', firstName: 'Mohammed', cnp: '1060825927178' });
});

test('identity card OCR reads an 18-digit CNP and names below multilingual labels', () => {
  const details = parseIdentityCardText('CNP 124761832451723176\nNume/Nom/Last name\nRuiz\nPrenume/Prenom/First name\nAlexandro');
  assert.deepEqual(details, { name: 'Ruiz Alexandro', lastName: 'Ruiz', firstName: 'Alexandro', cnp: '124761832451723176' });
});

test('identity card OCR skips misread labels and reads the name values below them', () => {
  const details = parseIdentityCardText('CNP 1033124177982\nNume/Nom/Last rame Prenontiat Rar\nChirculescu\nPrenontiat Rar\nAndrei');
  assert.deepEqual(details, { name: 'Chirculescu Andrei', lastName: 'Chirculescu', firstName: 'Andrei', cnp: '1033124177982' });
});

test('identity card OCR does not interpret embedded label fragments as names', () => {
  const details = parseIdentityCardText('CNP 1033124177982QECDECCOEA\nEronume Preno Eli TSS');
  assert.deepEqual(details, { name: '', lastName: '', firstName: '', cnp: '1033124177982' });
});

test('identity card OCR keeps real 13-character alphanumeric CNPs and longer numeric values', () => {
  assert.equal(parseIdentityCardText('CNP 104182531ARZ6').cnp, '104182531ARZ6');
  assert.equal(parseIdentityCardText('CNP 124761832451723176').cnp, '124761832451723176');
});

test('identity card OCR preserves letters in an alphanumeric CNP', () => {
  const details = parseIdentityCardText('CNP 104182531ARZ6\nNume/Nom/Last name\nRuiz\nPrenume/Prenom/First name\nAlexandro');
  assert.equal(details.cnp, '104182531ARZ6');
});

test('parachute test display name is simplified without changing its catalog key', () => {
  assert.equal(displayTestName('Test parașutiști'), 'Test Parasutism');
  assert.equal(displayTestName('Test ALS'), 'Test ALS');
});

test('a configured test title overrides its default display title', () => {
  definitions['Test ALS'].title = 'ALS Personalizat';
  assert.equal(displayTestName('Test ALS'), 'ALS Personalizat');
  delete definitions['Test ALS'].title;
});

test('SMULS guide includes the supplied route image as an inline preview', () => {
  const testDefinitions = readFileSync(join(here, '..', 'tests.js'), 'utf8');
  assert.match(testDefinitions, /'Test SMULS'[\s\S]*?images: \[\{ label: 'Hartă traseu S\.M\.U\.L\.S\.', url: '\/image\.png', inline: true \}\]/);
});

test('identity card OCR parser handles inline labels and preserves OCR-confused CNP letters', () => {
  const details = parseIdentityCardText('Nume/Nom/Last name Cartier Prenume/Prenom/First name Mohammed\nCNP: 1O60 8259 27178');
  assert.deepEqual(details, { name: 'Cartier Mohammed', lastName: 'Cartier', firstName: 'Mohammed', cnp: '1O60825927178' });
});

test('identity card OCR parser skips misread blue labels before reading the values below', () => {
  const details = parseIdentityCardText('iLast name.\nCartier\niFirst name.\nMohammed\nCNP\n1060825927178');
  assert.deepEqual(details, { name: 'Cartier Mohammed', lastName: 'Cartier', firstName: 'Mohammed', cnp: '1060825927178' });
});

test('identity card OCR parser never returns a blue field label as a candidate name', () => {
  const details = parseIdentityCardText('iLast name.\niFirst name.\nCNP\n1060825927178');
  assert.deepEqual(details, { name: '', lastName: '', firstName: '', cnp: '1060825927178' });
});

test('OCR retry preserves split surname and given name for medical certificates', () => {
  assert.deepEqual(
    mergeIdentityCardDetails({ name: '', lastName: '', firstName: '', cnp: '56937' }, { name: 'Cartier Mohammed', lastName: 'Cartier', firstName: 'Mohammed', cnp: '' }),
    { name: 'Cartier Mohammed', lastName: 'Cartier', firstName: 'Mohammed', cnp: '56937' }
  );
});

test('admission Discord embeds use vertical fields and hide callsign on rejection', () => {
  const rejected = createAdmissionEmbeds({ testerName: 'Tester', candidateName: 'Candidat', candidateId: '12345', candidateCallsign: '', result: 'Respins' });
  assert.deepEqual(rejected.admission.fields.map(field => field.name), ['Nume Tester', 'Nume Candidat', 'Rezultat']);
  assert.deepEqual(rejected.testers.fields.map(field => field.name), ['Nume Tester', 'Nume Candidat', 'ID', 'Rezultat']);
  const admitted = createAdmissionEmbeds({ testerName: 'Tester', candidateName: 'Candidat', candidateId: '12345', candidateCallsign: 'M-302', result: 'Admis' });
  assert.equal(admitted.testers.fields.at(-1).name, 'Callsign');
});

test('ALS result embed contains tester, candidate, callsign, and verdict', () => {
  const embed = createAlsResultEmbed({ testerName: 'Tester', candidateName: 'Candidat', candidateCallsign: 'M-302', result: 'Respins' });
  assert.equal(embed.title, 'Test ALS');
  assert.deepEqual(embed.fields.map(field => field.name), ['Nume Tester', 'Callsign', 'Nume Candidat', 'Rezultat']);
  assert.equal(embed.fields[3].value, 'Respins');
});

test('specialty result embeds contain tester, candidate, callsign, and verdict', () => {
  const embed = createSpecialtyResultEmbed({ testName: 'Test PILOT', testerName: 'Tester', candidateName: 'Candidat', candidateCallsign: 'M-302', result: 'Admis' });
  assert.equal(embed.title, 'Test PILOT');
  assert.deepEqual(embed.fields.map(field => field.name), ['Nume Tester', 'Callsign', 'Nume Candidat', 'Rezultat']);
  assert.equal(embed.fields[3].value, 'Admis');
});

test('ALS guide form includes callsign and candidate name inputs', () => {
  const formMarkup = source.match(/const candidateNameField = \[[\s\S]*?\.includes\(testName\)[\s\S]*?;/)?.[0] || '';
  assert.match(formMarkup, /Nume candidat/);
  assert.match(formMarkup, /als-candidate-name/);
  for (const testName of ['Test ALS', 'Test SMULS', 'Test MOTO', 'Test PILOT', 'Test parașutiști']) assert.ok(formMarkup.includes(testName));
});

test('medical certificates start at 7015 and stop at 30000', () => {
  assert.equal(medicalCertificateNumberForRow(1), null);
  assert.equal(medicalCertificateNumberForRow(2), 7015);
  assert.equal(medicalCertificateNumberForRow(22987), 30000);
  assert.equal(medicalCertificateNumberForRow(22988), null);
});

test('medical certificate embed includes the requested fields and medical verdict', () => {
  const embeds = createMedicalCertificateEmbeds({
    lastName: 'Cartier', firstName: 'Mohammed', phone: '735-0616', candidateId: '56937',
    hoursAccount: '2001.25', hoursCharacter: '2001.25', medicalStatus: 'Admis'
  }, 7015);
  const [certificate] = embeds;
  assert.equal(certificate.title, 'D.M.L.S. - EVIDENTA MEDICALA NR. 7015');
  assert.match(certificate.description, /NUME: Cartier\nPRENUME: Mohammed/);
  assert.match(certificate.description, /REZULTAT: ADMIS/);
  assert.match(certificate.description, /ORE\(LUNI\): 2001\.25 \(cont\) 2001\.25 \(character\)/);
  assert.equal(embeds.length, 1);
  assert.equal(certificate.thumbnail.url, 'attachment://buletin-candidat.jpg');
  assert.equal(certificate.image.url, 'attachment://fisa-medicala.jpg');
  const [rejected] = createMedicalCertificateEmbeds({
    lastName: 'Cartier', firstName: 'Mohammed', phone: '735-0616', candidateId: '56937',
    hoursAccount: '2001.25', hoursCharacter: '2001.25', medicalStatus: 'Respins'
  }, 7016);
  assert.match(rejected.description, /REZULTAT: RESPINS/);
});
