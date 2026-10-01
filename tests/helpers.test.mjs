import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { accessFor, candidateForCallsign, catalog as accessCatalog, coreTests, effectiveTestsForMember, functionsForMember, isLeadership, normalizeTests, testsForFunctions } from '../api/access/shared.js';
import { canResetTestCounts, discordTesterMentionPayload, createAdmissionEmbeds, createAlsResultEmbed, createSpecialtyResultEmbed, specialtyNotificationDetails, createMedicalCertificateEmbeds, medicalCertificateNumberForRow } from '../api/access/test-results.js';
import { statusFromRow } from '../api/access/directory.js';
import { cooldownIsActive, parseCooldownS } from '../api/access/cooldowns.js';

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

const names = ['callsignNumber', 'normalizeCallsign', 'testNameFromHash', 'isLeadershipUser', 'memberIsLeadership', 'leadershipTitleForCallsign', 'allowedForUser', 'memberHasTestAccess', 'memberIsTester', 'memberCanGiveTest', 'docsAssignedTests', 'sortMembers', 'gradeGroupFor', 'mergeTestDefinitions', 'admissionChecklistHtml', 'admissionChecksComplete', 'motoChecksComplete', 'alsChecklistHtml', 'alsChecksComplete', 'alsCaseListHtml', 'smulsChecklistHtml', 'smulsChecksComplete', 'smulsCaseListHtml', 'memberStatus', 'testerFunctionsForDisplay', 'isTestFailed', 'maxWrongForTest', 'cachedUserWithinSession', 'questionItemHtml', 'evaluationStageHtml', 'parseIdentityCardText', 'mergeIdentityCardDetails', 'displayTestName', 'medicalConditionsInText', 'departmentCalendarDate', 'latestCompleteBonusPeriodIndex', 'bonusPeriodFor'];
const srcs = names.map(extract).join('\n');
const pattern = source.match(/^const RESIDENT_TESTER_PATTERN = .*$/m)?.[0] || 'const RESIDENT_TESTER_PATTERN = /TESTER/;';
const normalizeTextSrc = extract('normalizeText');
const escapeHtmlSrc = extract('escapeHtml');
const fullSrc = `${pattern}\nconst AUTH_SCHEMA_VERSION = 4;\nconst coreTests = ['Test admitere', 'Test transfer', 'Adeverință medicală'];\nconst admissionRequirements = ['Verificarea ținutei', 'Verificarea tatuajelor faciale', 'Verificarea cazierului', 'Minimum 50 de ore jucate', 'Controlul cu stetoscopul (amănunțit, în salon)', 'Drug-testul'];\nconst medicalRejectionConditions = ['Intoxicație medicamentoasă', 'Intoxicație cu substanțe psihoactive', 'Dependență de droguri', 'Comă alcoolică', 'Boli cu transmitere sexuală', 'Piodermită', 'Salmonella'];\nconst BONUS_ANCHOR_UTC = Date.UTC(2026, 8, 21);\nconst BONUS_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;\nconst motoRequirements = ['Grad Medic-Rezident', 'Certificat S.M.U.L.S.', 'Permis Categoria A'];\nconst alsRequirements = ['Verificare BLS', 'Verificare Radio', 'Au trecut minimum 3 zile de la promovarea ultimului test Radio sau BLS', 'Permis categoria B'];\n${normalizeTextSrc}\n${escapeHtmlSrc}\n${srcs}`;
const testSummaryDefinitions = [['Test SMULS'], ['Test MOTO'], ['Test PILOT'], ['Test ALS'], ['Test parașutiști']];
const load = new Function(
  'catalog',
  'testDefinitions',
  'testSummaryDefinitions',
  `${fullSrc}\nreturn { callsignNumber, normalizeCallsign, testNameFromHash, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberHasTestAccess, memberIsTester, memberCanGiveTest, docsAssignedTests, sortMembers, gradeGroupFor, mergeTestDefinitions, admissionChecklistHtml, admissionChecksComplete, motoChecksComplete, alsChecklistHtml, alsChecksComplete, alsCaseListHtml, smulsChecklistHtml, smulsChecksComplete, smulsCaseListHtml, memberStatus, testerFunctionsForDisplay, isTestFailed, maxWrongForTest, cachedUserWithinSession, questionItemHtml, evaluationStageHtml, parseIdentityCardText, mergeIdentityCardDetails, displayTestName, medicalConditionsInText, departmentCalendarDate, latestCompleteBonusPeriodIndex, bonusPeriodFor };`,
)(catalog, definitions, testSummaryDefinitions);

const { callsignNumber, normalizeCallsign, testNameFromHash, isLeadershipUser, memberIsLeadership, leadershipTitleForCallsign, allowedForUser, memberHasTestAccess, memberIsTester, memberCanGiveTest, docsAssignedTests, sortMembers, gradeGroupFor, mergeTestDefinitions, admissionChecklistHtml, admissionChecksComplete, motoChecksComplete, alsChecklistHtml, alsChecksComplete, alsCaseListHtml, smulsChecklistHtml, smulsChecksComplete, smulsCaseListHtml, memberStatus, testerFunctionsForDisplay, isTestFailed, maxWrongForTest, cachedUserWithinSession, questionItemHtml, evaluationStageHtml, parseIdentityCardText, mergeIdentityCardDetails, displayTestName, medicalConditionsInText, departmentCalendarDate, latestCompleteBonusPeriodIndex, bonusPeriodFor } = load;

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

test('Discord webhook mention targets only the connected tester ID', () => {
  assert.deepEqual(discordTesterMentionPayload('123456789012345678'), {
    content: '<@123456789012345678>',
    allowed_mentions: { parse: [], users: ['123456789012345678'] }
  });
  assert.deepEqual(discordTesterMentionPayload(''), { allowed_mentions: { parse: [] } });
});

test('only callsigns 001 through 020 can reset test counts', () => {
  assert.equal(canResetTestCounts(['', '', '001']), true);
  assert.equal(canResetTestCounts(['', '', '020']), true);
  assert.equal(canResetTestCounts(['', '', '000']), false);
  assert.equal(canResetTestCounts(['', '', '021']), false);
  assert.equal(canResetTestCounts(['', '', '100', '', 'Director']), false);
});

test('normalizeCallsign pads to three digits', () => {
  assert.equal(normalizeCallsign('7'), 'M-007');
  assert.equal(normalizeCallsign('M-7'), 'M-007');
  assert.equal(normalizeCallsign('abc'), '');
  assert.equal(normalizeCallsign(undefined), '');
});

test('testNameFromHash restores URL-encoded test routes safely', () => {
  assert.equal(testNameFromHash('#test-Test%20MOTO'), 'Test MOTO');
  assert.equal(testNameFromHash('#test-Test%20PILOT'), 'Test PILOT');
  assert.equal(testNameFromHash('#statistics'), '');
  assert.equal(testNameFromHash('#test-%E0%A4%A'), '');
});

test('candidate lookup matches callsign in column C and returns the name from column D', () => {
  const rows = [['', '', '603', 'Antonio Shades'], ['', '', '604', 'Another Candidate']];
  assert.deepEqual(candidateForCallsign(rows, 'M-603'), { callsign: '603', name: 'Antonio Shades' });
  assert.equal(candidateForCallsign(rows, 'M-999'), null);
  assert.equal(candidateForCallsign(rows, ''), null);
});

test('column S cooldown parsing supports shared and per-test dates and SMULS variants', () => {
  const now = new Date('2026-10-02T12:00:00.000Z');
  const shared = parseCooldownS('Parasutist / Moto/Pilot 20.10', now);
  assert.equal(shared['Test parașutiști'], shared['Test MOTO']);
  assert.equal(shared['Test MOTO'], shared['Test PILOT']);
  assert.equal(new Date(shared['Test MOTO']).toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' }), '20.10.2026');
  assert.equal(parseCooldownS('Parașutist 20.10', now)['Test parașutiști'], shared['Test MOTO']);

  const separate = parseCooldownS('moto 10.10 / pilot 12.10 / smuls t 12.10 / smuls p 11.10 / parasutist 10.10', now);
  assert.equal(new Date(separate['Test MOTO']).toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' }), '10.10.2026');
  assert.equal(new Date(separate['Test PILOT']).toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' }), '12.10.2026');
  assert.equal(new Date(separate['Test SMULS']).toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' }), '12.10.2026');
  assert.equal(new Date(separate['Test parașutiști']).toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' }), '10.10.2026');
  assert.equal(cooldownIsActive(separate, 'Test PILOT', Date.parse('2026-10-11T12:00:00.000Z')), true);
  assert.equal(cooldownIsActive(separate, 'Test PILOT', Date.parse('2026-10-12T18:00:00.000Z')), true);
  assert.equal(cooldownIsActive(separate, 'Test PILOT', Date.parse('2026-10-12T22:00:00.000Z')), false);
  const monthEnd = parseCooldownS('moto 31.10', now);
  assert.equal(cooldownIsActive(monthEnd, 'Test MOTO', Date.parse('2026-10-31T20:00:00.000Z')), true);
  assert.equal(cooldownIsActive(monthEnd, 'Test MOTO', Date.parse('2026-10-31T22:00:00.000Z')), false);
});

test('medical-sheet diagnosis matcher detects all disqualifying conditions', () => {
  const diagnoses = medicalConditionsInText('Intoxicație medicamentoasă; intoxicație cu substanțe psihoactive; dependență de droguri; comă alcoolică; boli cu transmitere sexuală; piodermită; Salmonella.');
  assert.deepEqual(diagnoses, ['Intoxicație medicamentoasă', 'Intoxicație cu substanțe psihoactive', 'Dependență de droguri', 'Comă alcoolică', 'Boli cu transmitere sexuală', 'Piodermită', 'Salmonella']);
  assert.deepEqual(medicalConditionsInText('Toxiinfecție alimentară'), ['Salmonella']);
  assert.doesNotMatch(source, /certificate-hours-account[^>]+value=/);
  assert.match(source, /data-stethoscope-check/);
});

test('bonus periods follow two-week cycles and include September 21 through October 4', () => {
  assert.deepEqual(bonusPeriodFor(0), { index: 0, from: '2026-09-21', to: '2026-10-04' });
  assert.equal(latestCompleteBonusPeriodIndex(new Date('2026-10-04T20:00:00.000Z')), -1);
  assert.equal(latestCompleteBonusPeriodIndex(new Date('2026-10-04T22:00:00.000Z')), 0);
  assert.equal(latestCompleteBonusPeriodIndex(new Date('2026-10-18T22:00:00.000Z')), 1);
});

test('saved test definitions inherit newly shipped practical stages and cases', () => {
  const defaults = {
    'Test MOTO': { title: 'MOTO', practicalStage: { title: 'Proba 2', imageSlots: 1, images: [{ label: 'Hartă', url: '/moto-map.png' }] }, questions: [{ text: 'Q' }] },
    'Test SMULS': { cases: [{ title: 'Descarcerare' }], images: [{ url: '/map.png' }] },
    'Test parașutiști': { practical: [
      { name: 'Ușoară', imageSlots: 3, images: [{ url: '/jump1.png' }, { url: '/jump2.png' }, { url: '/jump3.png' }] },
      { name: 'Medie', imageSlots: 2, images: [{ url: '/medium-heli.png' }, { url: '/medium-landing.png' }] },
      { name: 'Dificilă', imageSlots: 3, images: [{ url: '/hard1.png' }, { url: '/hard2.png' }, { url: '/hard3.png' }] }
    ] },
    'Test PILOT': { evaluationStages: [
      { title: 'PROBA 2' },
      { title: 'PROBA 3', imageSlots: 3, images: [{ url: '/one.png' }, { url: '/two.png' }, { url: '/three.png' }] },
      { title: 'PROBA 4', imageSlots: 2 }
    ] }
  };
  const merged = mergeTestDefinitions(defaults, {
    'Test MOTO': { title: 'MOTO personalizat' },
    'Test SMULS': { description: 'Text salvat' },
    'Test parașutiști': { practical: [{ name: 'Ușoară personalizată', images: [] }, { name: 'Medie personalizată', images: [] }, { name: 'Dificilă personalizată', imageSlots: 2, images: [] }] },
    'Test PILOT': { evaluationStages: [{ title: 'Proba 2 salvată' }, { title: 'Proba 3 salvată', imageSlots: 2 }, { title: 'Proba 4 salvată' }] }
  });
  assert.equal(merged['Test MOTO'].title, 'MOTO personalizat');
  assert.deepEqual(merged['Test MOTO'].practicalStage, defaults['Test MOTO'].practicalStage);
  assert.deepEqual(merged['Test MOTO'].questions, defaults['Test MOTO'].questions);
  assert.deepEqual(merged['Test SMULS'].cases, defaults['Test SMULS'].cases);
  assert.deepEqual(merged['Test SMULS'].images, defaults['Test SMULS'].images);
  assert.equal(merged['Test SMULS'].description, 'Text salvat');
  assert.equal(merged['Test parașutiști'].practical.length, 3);
  assert.equal(merged['Test parașutiști'].practical[0].name, 'Ușoară personalizată');
  assert.equal(merged['Test parașutiști'].practical[0].imageSlots, 3);
  assert.deepEqual(merged['Test parașutiști'].practical[0].images.map(image => image.url), ['/jump1.png', '/jump2.png', '/jump3.png']);
  assert.equal(merged['Test parașutiști'].practical[1].imageSlots, 2);
  assert.deepEqual(merged['Test parașutiști'].practical[1].images.map(image => image.url), ['/medium-heli.png', '/medium-landing.png']);
  assert.equal(merged['Test parașutiști'].practical[2].imageSlots, 3);
  assert.equal(merged['Test parașutiști'].practical[2].name, 'Dificilă personalizată');
  assert.equal(merged['Test parașutiști'].practical[2].images.length, 3);
  assert.equal(merged['Test parașutiști'].practical[2].imageSlots, 3);
  assert.equal(merged['Test PILOT'].evaluationStages[1].title, 'Proba 3 salvată');
  assert.equal(merged['Test PILOT'].evaluationStages[1].imageSlots, 3);
  assert.deepEqual(merged['Test PILOT'].evaluationStages[1].images.map(image => image.url), ['/one.png', '/two.png', '/three.png']);
  assert.equal(merged['Test PILOT'].evaluationStages[2].imageSlots, 2);
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

test('parachutism theory verdict controls the separate practical panel', () => {
  assert.match(source, /data-parachutism-theory-result="Admis">Admis Test Teoretic/);
  assert.match(source, /data-parachutism-theory-result="Respins">Respins Test Teoretic/);
  assert.match(source, /parachutismPracticalStage[\s\S]*?id="parachutism-practical-stage" hidden/);
  assert.match(source, /practicalStage\.hidden = false/);
  assert.match(source, /parachutismResultStageFlow/);
  assert.match(source, /class="evaluation-stage-image-slot parachutism-photo-slot" role="img" aria-label="Imagine \$\{imageIndex \+ 1\} pentru/);
  assert.match(source, /parachutism-photo-empty">Imagine \$\{imageIndex \+ 1\}/);
  const stylesheet = readFileSync(join(here, '..', 'style.css'), 'utf8');
  assert.doesNotMatch(source, /data-parachutism-photo|encodeTestReferencePhoto/);
  assert.doesNotMatch(stylesheet, /\.parachutism-photo-slot[^}]*cursor:pointer/);
});

test('parachutism requirements, information cards, and jump photo slots are configured', () => {
  assert.match(testCatalogSource, /eligibilityCriteria: \['Minim Medic Specialist', 'Licență Pilot'\]/);
  assert.match(testCatalogSource, /candidateInformation: \[[\s\S]*?Testarea pentru certificatul de parașutism va conține două probe\./);
  assert.match(testCatalogSource, /testerInformation: \[[\s\S]*?Filmarea nu trebuie să lipsească\./);
  assert.match(testCatalogSource, /name: 'Săritura ușoară'[\s\S]*?imageSlots: 3[\s\S]*?name: 'Săritura medie'[\s\S]*?imageSlots: 2[\s\S]*?name: 'Săritura dificilă'[\s\S]*?imageSlots: 3/);
  assert.match(testCatalogSource, /url: '\/Saritura_Usoara_Aterizare\.png'[\s\S]*?url: '\/Saritura_Usoara_Heli\.png'[\s\S]*?url: '\/Saritura_Usoara_Pozitie\.png'/);
  assert.match(testCatalogSource, /name: 'Săritura medie'[\s\S]*?url: '\/Saritura_Medie_Heli\.png'[\s\S]*?url: '\/Saritura_Medie_Aterizare\.png'/);
  assert.match(testCatalogSource, /name: 'Săritura dificilă'[\s\S]*?url: '\/Saritura_Grea_Heli\.png'[\s\S]*?url: '\/helipad_mediu\.png'[\s\S]*?url: '\/Saritura_Usoara_Pozitie\.png'/);
  assert.match(source, /data-parachutism-check/);
  assert.match(source, /parachutism-test-content/);
  assert.doesNotMatch(source, /data-parachutism-photo/);
  assert.match(source, /parachutismInformationHtml/);
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
  assert.deepEqual(normalizeTests(['Test transfer']), ['Test transfer']);
  assert.deepEqual(effectiveTestsForMember('TESTER', { grantMode: 'override', grantedTests: ['Test transfer'] }), ['Test transfer']);
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

test('Transfer places the six shared pre-test criteria after uploads and gates the questions', () => {
  const markup = admissionChecklistHtml();
  for (const criterion of ['Verificarea ținutei', 'Verificarea tatuajelor faciale', 'Verificarea cazierului', 'Minimum 50 de ore jucate', 'Controlul cu stetoscopul', 'Drug-testul']) assert.ok(markup.includes(criterion));
  assert.match(source, /const transferChecks = isTransferTest \? admissionChecklistHtml\(\) : ''/);
  assert.match(source, /candidateDetails\}\$\{admissionChecks\}\$\{transferChecks\}\$\{testIntro\}/);
  assert.match(source, /isAdmissionTest \|\| isTransferTest \|\| isMotoTest \|\| isSmulsTest \|\| isAlsTest/);
  assert.match(source, /isAdmissionTest \|\| isTransferTest\)/);
});

test('Moto test unlocks only after all three prerequisites are checked', () => {
  assert.equal(motoChecksComplete([true, true, false]), false);
  assert.equal(motoChecksComplete([true, true, true]), true);
  assert.equal(maxWrongForTest('Test MOTO', 2), 2);
});

test('ALS test requires BLS, Radio, three days, and category B checks', () => {
  assert.equal(alsChecksComplete([true, true, true]), false);
  assert.equal(alsChecksComplete([true, true, true, true]), true);
  const markup = alsChecklistHtml();
  for (const requirement of ['Verificare BLS', 'Verificare Radio', 'minimum 3 zile', 'Permis categoria B']) assert.ok(markup.toLowerCase().includes(requirement.toLowerCase()));
  assert.match(source, /const isStagedTest = \[[^\]]*'Test ALS'/);
  assert.match(source, /const isAlsTest = testName === 'Test ALS'/);
});

test('ALS case accordions include all four requested scenarios and interaction counts', () => {
  const markup = alsCaseListHtml([{ title: 'Cazul 1', description: 'Fractură', minimumMe: 13, steps: ['/me stabilizează pacientul'] }]);
  const alsDefinition = testCatalogSource.split("'Test ALS':")[1].split("'Test parașutiști':")[0];
  assert.match(markup, /<details class="als-case">/);
  assert.match(markup, /Fractură/);
  assert.match(markup, /13 \/me-uri/);
  assert.match(markup, /\/me-uri orientative/);
  assert.match(markup, /Admis ALS/);
  assert.match(markup, /Respins ALS/);
  for (const expectedCase of ['accident de motociclet', 'șoc anafilactic', 'benzinărie', 'barcă']) assert.ok(alsDefinition.toLowerCase().includes(expectedCase.toLowerCase()));
  assert.match(alsDefinition, /minimumMe: 13[\s\S]*?minimumMe: 13[\s\S]*?minimumMe: 14[\s\S]*?minimumMe: 18/);
  assert.doesNotMatch(alsDefinition, /questions:/);
});

test('S.M.U.L.S. unlocks after its four prerequisites are checked', () => {
  assert.equal(smulsChecksComplete([true, true, true]), false);
  assert.equal(smulsChecksComplete([true, true, true, true]), true);
  const markup = smulsChecklistHtml();
  for (const requirement of ['Verificare test teoretic', 'Licență Navală', 'Permis Categoria B', 'Mașina Stalker full tunată']) assert.ok(markup.includes(requirement));
  assert.match(source, /isAdmissionTest \|\| isTransferTest \|\| isMotoTest \|\| isSmulsTest \|\| isAlsTest \|\| isParachutismTest/);
  assert.match(source, /const gatedQuestionForm = \(isAdmissionTest \|\| isTransferTest \|\| isMotoTest \|\| isSmulsTest \|\| isAlsTest \|\| isParachutismTest \|\| isPilotTest \|\| isMedicalCertificate\)/);
});

test('S.M.U.L.S. case list expands each descarceration and reserves two images', () => {
  const markup = smulsCaseListHtml([{ title: 'Descarcerare demo', steps: ['/me verifică zona'] }]);
  assert.match(markup, /<details class="smuls-case">/);
  assert.match(markup, /Descarcerare demo/);
  assert.equal((markup.match(/class="smuls-case-image-slot"/g) || []).length, 2);
  assert.ok(markup.indexOf('smuls-descarceration-images') > markup.indexOf('</details>'));
  const caseMarkup = markup.slice(markup.indexOf('<details'), markup.indexOf('</details>') + '</details>'.length);
  assert.doesNotMatch(caseMarkup, /smuls-case-image-slot/);
  assert.match(markup, /Admis Descarcerare/);
  assert.match(markup, /Respins Descarcerare/);
  for (const file of ['server.js', 'tests/dev-server.mjs']) {
    const server = readFileSync(join(here, '..', file), 'utf8');
    assert.match(server, /decodeURIComponent\(url\.pathname\)/);
    assert.match(server, /'\.png': 'image\/png'/);
  }
  const imageMarkup = smulsCaseListHtml([{ title: 'Descarcerare demo', steps: [] }], [
    { label: 'Locație', url: '/Poza_Locatie.png' },
    { label: 'Autospeciale', url: '/Poza_Pozitie_Masini.png' }
  ]);
  assert.deepEqual([...imageMarkup.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]), ['/Poza_Locatie.png', '/Poza_Pozitie_Masini.png']);
  assert.match(testCatalogSource, /descarcerationImages: \[[\s\S]*?url: '\/Poza_Locatie\.png'[\s\S]*?url: '\/Poza_Pozitie_Masini\.png'/);
  assert.match(source, /smuls-stage-active/);
});

test('Moto and Pilot staged practical content is present in test definitions', () => {
  const alsDefinition = testCatalogSource.split("'Test ALS':")[1].split("'Test parașutiști':")[0];
  assert.match(alsDefinition, /minimumMe: 13[\s\S]*?minimumMe: 13[\s\S]*?minimumMe: 14[\s\S]*?minimumMe: 18/);
  for (const scenario of ['accident de motocicletă', 'șoc anafilactic', 'explozii la o benzinărie', 'căzut din barcă']) assert.ok(alsDefinition.includes(scenario));
  assert.doesNotMatch(alsDefinition, /questions:/);
  assert.match(testCatalogSource, /practicalStage:[\s\S]*?5:40 minute \(MOTO/);
  assert.match(testCatalogSource, /'Test SMULS':[\s\S]*?maxWrong: 2/);
  assert.match(testCatalogSource, /5:45 min/);
  assert.match(testCatalogSource, /06:00 min/);
  assert.match(testCatalogSource, /Candidatul nu va depăși limita de 60 km\/h/);
  assert.match(testCatalogSource, /candidateBriefing:[\s\S]*?Testul conține 2 probe[\s\S]*?contra timp[\s\S]*?fără a-l pierde din vizor/);
  assert.match(testCatalogSource, /title: 'Proba 2: Proba Practică'[\s\S]*?5:40 minute \(MOTO\) \(fără zăpadă\)[\s\S]*?7:00 minute \(ATV\) \(cu zăpadă\)[\s\S]*?imageSlots: 1/);
  assert.match(testCatalogSource, /practicalStage:[\s\S]*?imageSlots: 1[\s\S]*?url: '\/Traseu_test_moto_poza_harta\.png'/);
  assert.match(testCatalogSource, /PROBA 2: Locațiile Pacific/);
  assert.match(testCatalogSource, /Buckingham Swift[\s\S]*?3, 2, 1, START[\s\S]*?30 de secunde/);
  assert.match(testCatalogSource, /PROBA 3: Proba de îndemânare și pick-up[\s\S]*?Paleto[\s\S]*?imageSlots: 3/);
  assert.match(testCatalogSource, /url: '\/Proba_3_test_pilot\.png'[\s\S]*?url: '\/Proba_3_test_pilot_poza_2\.png'[\s\S]*?url: '\/Proba_3_test_pilot_poza_3\.png'/);
  assert.match(testCatalogSource, /PROBA 4: Pick-Up de pe Chilliad[\s\S]*?imageSlots: 3[\s\S]*?url: '\/Proba_4_test_pilot_poza_joc_1\.png'[\s\S]*?url: '\/Proba_4_test_pilot_poza_joc_2\.png'[\s\S]*?url: '\/Proba_4_test_pilot_poza_harta\.png'/);
});

test('Pilot certification description and instructions share one intro box', () => {
  assert.match(source, /const introBoxClass = testName === 'Test PILOT' \? 'pilot-intro-box' : isMotoTest \? 'moto-intro-box' : isSmulsTest \? 'smuls-intro-box' : 'als-intro-box'/);
  assert.match(source, /const testIntro = isStagedTest \? `<div class="\$\{introBoxClass\}"><p class="muted">\$\{description\}<\/p>\$\{instructions\}<\/div>`/);
});

test('every test page omits the permanent-access subtitle and places access controls in its header', () => {
  assert.doesNotMatch(source, /Acces permanent pentru testerul conectat/);
  assert.match(source, /class="test-guide-header-actions">\$\{testAccessControl\}/);
  assert.match(source, /const headerActions = `<div class="test-guide-header-actions">/);
  assert.match(source, /const testAccessControl = testAccessMarkup\(testName\)/);
  assert.match(source, /function testAccessMarkup\(testName\) \{\s*if \(!isLeadershipUser\(currentUser\)\) return ''/);
});

test('Moto uses direct theory verdict buttons, a header access control, and a practical stage verdict', () => {
  assert.match(source, /data-moto-theory-result="Admis">Admis Proba Teoretică/);
  assert.match(source, /data-moto-theory-result="Respins">Respins Proba Teoretică/);
  assert.match(source, /testName === 'Test PILOT' \? 'pilot-intro-box' : isMotoTest \? 'moto-intro-box' : isSmulsTest \? 'smuls-intro-box' : 'als-intro-box'/);
  assert.match(source, /const headerActions = `<div class="test-guide-header-actions">\$\{testAccessControl\}/);
  assert.match(source, /\{ result: 'Admis', text: 'Admis Proba 2' \}/);
  assert.match(source, /\{ result: 'Respins', text: 'Respins Proba 2' \}/);
});

test('S.M.U.L.S. access control is placed in the test header', () => {
  assert.match(source, /const headerActions = `<div class="test-guide-header-actions">\$\{testAccessControl\}/);
});

test('ALS case completion uses the existing Discord result submission path', () => {
  assert.match(source, /const finishAlsTest = async/);
  assert.match(source, /recordTestRun\(testName, finalResult, \{ candidateCallsign, candidateName \}\)/);
  assert.match(source, /data-als-result="Admis">Admis ALS/);
  assert.match(source, /data-als-result="Respins">Respins ALS/);
  assert.match(source, /als-stage-active/);
});

test('Moto candidate fields render before checks while remaining outside the gated quiz', () => {
  assert.match(source, /const candidateIdentityBeforeChecks = isMotoTest \|\| isSmulsTest \|\| isAlsTest \|\| isParachutismTest \|\| isPilotTest \? candidateIdentityFields : ''/);
  assert.match(source, /const candidateIdentityInQuiz = isMotoTest \|\| isSmulsTest \|\| isAlsTest \|\| isParachutismTest \|\| isPilotTest \? '' : candidateIdentityFields/);
  assert.match(source, /testIntro\}\$\{candidateIdentityBeforeChecks\}\$\{stagedCandidateSummary\}\$\{alsChecks\}\$\{motoChecks\}\$\{smulsChecks\}/);
  assert.match(source, /class="question-list">\$\{candidateIdentityInQuiz\}/);
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
  assert.match(markup, /evaluation-verdict-admitted/);
  assert.match(markup, /evaluation-verdict-rejected/);
});

test('Pilot verdict buttons isolate the current stage and use distinct verdict styles', () => {
  assert.match(source, /data-pilot-theory-result="Admis">Admis Proba Teoretică/);
  assert.match(source, /data-pilot-theory-result="Respins">Respins Proba Teoretică/);
  assert.match(source, /pilot-stage-active/);
  assert.match(source, /stageFlow\.replaceChildren\(\)/);
});

test('evaluation stage cards render three right-side image placeholders when requested', () => {
  const markup = evaluationStageHtml({ title: 'PROBA 3', imageSlots: 3, images: [
    { label: 'Imagine 1', url: '/first.png' },
    { label: 'Imagine 2', url: '/second.png' },
    { label: 'Imagine 3', url: '/third.png' }
  ] }, []);
  assert.match(markup, /evaluation-stage-card has-image-slots/);
  assert.match(markup, /aria-label="Imagine 1"/);
  assert.match(markup, /aria-label="Imagine 2"/);
  assert.match(markup, /aria-label="Imagine 3"/);
  assert.deepEqual([...markup.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]), ['/first.png', '/second.png', '/third.png']);
  const motoMarkup = evaluationStageHtml({ title: 'Proba 2', imageSlots: 1 }, []);
  assert.match(motoMarkup, /style="--image-slot-count:1"/);
  assert.match(motoMarkup, /Imagine 1/);
});

test('admission test rejects the fourth mistake', () => {
  const limit = maxWrongForTest('Test admitere', 2);
  assert.equal(limit, 3);
  assert.equal(isTestFailed(3, limit), false);
  assert.equal(isTestFailed(4, limit), true);
  assert.equal(maxWrongForTest('Test PILOT'), 1);
  assert.equal(maxWrongForTest('Test transfer', 2), 2);
  assert.match(source, /if \(count\) count\.textContent = wrongCount/);
});

test('Discord session and browser auth cache both last 24 hours', () => {
  assert.match(source, /const AUTH_TTL=24\*60\*60\*1000/);
  assert.match(serverSource, /const SESSION_TTL = 24 \* 60 \* 60 \* 1000/);
  assert.match(serverSource, /Max-Age=\$\{SESSION_TTL \/ 1000\}/);
});

test('auth screen no longer renders the preview card', () => {
  assert.doesNotMatch(source, /auth-preview/);
  assert.doesNotMatch(readFileSync(join(here, '..', 'index.html'), 'utf8'), /auth-preview|Verificare automată|Discord ID \+ Google Sheets/);
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

test('identity card OCR extracts values beneath labels from a textured card crop', () => {
  const details = parseIdentityCardText('CNP 1081325869966\nNume/Nom/Last name . wn n\nToporisca ~\nPrenume/Prenom/Fir3t-nsima\nVlad !\nCetatenie/Nationality\nRomana');
  assert.deepEqual(details, { name: 'Toporisca Vlad', lastName: 'Toporisca', firstName: 'Vlad', cnp: '1081325869966' });
});

test('identity card OCR drops short trailing noise but preserves a short standalone name', () => {
  const details = parseIdentityCardText('CNP 1022122252146\nNume/Nom/Last name . ur cu\nHernandez a.\nPrenume/Prenom/First name\nStefan oo');
  assert.deepEqual(details, { name: 'Hernandez Stefan', lastName: 'Hernandez', firstName: 'Stefan', cnp: '1022122252146' });
  assert.equal(parseIdentityCardText('Nume/Nom/Last name\nLi').lastName, 'Li');
});

test('identity card OCR keeps real 13-character alphanumeric CNPs and longer numeric values', () => {
  assert.equal(parseIdentityCardText('CNP 104182531ARZ6').cnp, '104182531ARZ6');
  assert.equal(parseIdentityCardText('CNP 124761832451723176').cnp, '124761832451723176');
  assert.equal(parseIdentityCardText('CNP EEEEEEEEEEEEE').cnp, '');
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
  assert.equal(rejected.testers.thumbnail.url, 'attachment://buletin-candidat.jpg');
  assert.equal(rejected.testers.thumbnail.url, 'attachment://buletin-candidat.jpg');
  assert.equal(rejected.medicalSheet.thumbnail.url, 'attachment://fisa-medicala.jpg');
  assert.equal(rejected.drugTest.thumbnail.url, 'attachment://drug-test.jpg');
  assert.deepEqual(Object.keys(rejected), ['admission', 'testers', 'medicalSheet', 'drugTest']);
  assert.match(source, /submissionDetails = \{ candidateName, candidateId, candidateCallsign, identityImage, medicalSheetImage, drugTestImage \}/);
  const admitted = createAdmissionEmbeds({ testerName: 'Tester', candidateName: 'Candidat', candidateId: '12345', candidateCallsign: 'M-302', result: 'Admis' });
  assert.equal(admitted.testers.fields.at(-1).name, 'Callsign');
});

test('ALS result embed contains tester, candidate, callsign, and verdict', () => {
  const embed = createAlsResultEmbed({ testerName: 'Tester', candidateName: 'Candidat', candidateCallsign: 'M-302', result: 'Respins' });
  assert.equal(embed.title, 'Test ALS');
  assert.equal(embed.color, 0xCD363C);
  assert.deepEqual(embed.fields.map(field => field.name), ['👨‍⚕️ Tester', '📟 Callsign', '🧑‍⚕️ Candidat', '🏁 Rezultat']);
  assert.deepEqual(embed.fields.map(field => field.inline), [true, true, false, false]);
  assert.deepEqual(embed.fields.slice(0, 3).map(field => field.value), ['**Tester**', '`M-302`', '**Candidat**']);
  assert.equal(embed.fields[3].value, '❌ **Respins**');
  assert.equal(embed.footer.text, 'Rezultat oficial · DMLS');
});

test('specialty result embeds contain tester, candidate, callsign, and verdict', () => {
  const embed = createSpecialtyResultEmbed({ testName: 'Test PILOT', testerName: 'Tester', candidateName: 'Candidat', candidateCallsign: 'M-302', result: 'Admis' });
  assert.equal(embed.title, 'Test PILOT 🚁');
  assert.equal(embed.color, 0xCD363C);
  assert.deepEqual(embed.fields.map(field => field.name), ['👨‍⚕️ Tester', '📟 Callsign', '🧑‍⚕️ Candidat', '🏁 Rezultat']);
  assert.deepEqual(embed.fields.map(field => field.inline), [true, true, false, false]);
  assert.deepEqual(embed.fields.slice(0, 3).map(field => field.value), ['**Tester**', '`M-302`', '**Candidat**']);
  assert.equal(embed.fields[3].value, '✅ **Admis**');
  assert.equal(embed.footer.text, 'Rezultat oficial · DMLS');
});

test('specialty notification payload maps the candidate sheet callsign to the Discord embed field', () => {
  assert.deepEqual(specialtyNotificationDetails({ callsign: '603', name: 'Antonio Shades' }, 'Admis'), {
    candidateCallsign: '603', candidateName: 'Antonio Shades', result: 'Admis'
  });
});

test('ALS guide form includes callsign and candidate name inputs', () => {
  const formMarkup = source.match(/const candidateNameField = \[[\s\S]*?\.includes\(testName\)[\s\S]*?;/)?.[0] || '';
  assert.match(formMarkup, /Nume candidat/);
  assert.match(formMarkup, /als-candidate-name/);
  for (const testName of ['Test ALS', 'Test SMULS', 'Test MOTO', 'Test PILOT', 'Test parașutiști']) assert.ok(formMarkup.includes(testName));
  assert.match(source, /class="candidate-identity-fields">\$\{candidateCallsign\}\$\{candidateNameField\}/);
});

test('bulletin photo targets use the themed circular GIF without changing other uploads', () => {
  assert.match(source, /function bulletinGifArtworkHtml\(\)/);
  assert.match(source, /const isBulletinPhoto = id === 'candidate-document' \|\| id === 'certificate-document'/);
  assert.match(source, /class="image-paste-target\$\{isBulletinPhoto \? ' bulletin-image-target' : ''\}"/);
  assert.match(source, /class="bulletin-dot-art" src="\/gif\.gif"/);
  assert.doesNotMatch(source, /bulletinArtwork\.style\.setProperty\('--hole-/);
  assert.match(source, /class="candidate-photo-spinner"/);
  assert.match(source, /data-photo-state="empty"/);
  assert.doesNotMatch(source, /Lipește poza buletinului aici/);
  const stylesheet = readFileSync(join(here, '..', 'style.css'), 'utf8');
  assert.match(stylesheet, /\.image-paste-target\.bulletin-image-target\{[^}]*border:0[^}]*border-radius:50%/);
  assert.match(stylesheet, /\.bulletin-dot-art\{[^}]*mix-blend-mode:screen/);
  assert.doesNotMatch(stylesheet, /mask-image:radial-gradient\(circle 20px at var\(--hole-x,50%\) var\(--hole-y,50%\)/);
  for (const file of ['server.js', 'tests/dev-server.mjs']) {
    const server = readFileSync(join(here, '..', file), 'utf8');
    assert.match(server, /'\.gif': 'image\/gif'/);
  }
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
