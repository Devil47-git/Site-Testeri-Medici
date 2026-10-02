/**
 * @typedef {Object} Grant
 * @property {string} [discordId]
 * @property {string} [callsign]
 * @property {string} [name]
 * @property {string[]} [grantedTests]
 * @property {string} [updatedAt]
 * @property {number} [lastSeen]
 *
 * @typedef {Grant & { csNum?: number|string, isTester?: boolean, isLeadership?: boolean, isConducere?: boolean, functions?: string, accessLevel?: string, allowedTests?: string[], eligibleSpecializations?: string[], rank?: string, lastName?: string }} Member
 *
 * @typedef {Object} TestDefinition
 * @property {string} name
 * @property {string} [description]
 * @property {Array<any>} [questions]
 */

const coreTests = ['Test admitere','Test transfer','Adeverință medicală'];
const TESTER_BUNDLE_KEY = '__tester_bundle__';
const admissionRequirements = ['Verificarea ținutei', 'Verificarea tatuajelor faciale', 'Verificarea cazierului', 'Minimum 50 de ore jucate', 'Controlul cu stetoscopul (amănunțit, în salon)', 'Drug-testul'];
const motoRequirements = ['Grad Medic-Rezident', 'Certificat S.M.U.L.S.', 'Permis Categoria A'];
const alsRequirements = ['Verificare BLS', 'Verificare Radio', 'Au trecut minimum 3 zile de la promovarea ultimului test Radio sau BLS', 'Permis categoria B'];
const specialtyTests = ['Test ALS','Test SMULS','Test MOTO','Test PILOT','Test parașutiști'];
const docsTesterFilters = ['Test SMULS', 'Test ALS'];
const testSummaryDefinitions = [['Test SMULS', 'Test S.M.U.L.S.'], ['Test MOTO', 'Test MOTO'], ['Test PILOT', 'Test PILOT'], ['Test ALS', 'Test A.L.S.'], ['Test parașutiști', 'Test Parasutism']];
const catalog = [...coreTests, ...specialtyTests];
const TEST_CATALOG_KEY = 'medici-test-catalog-v4';
/** @param {string} key @param {any} fallback @returns {any} */
function readStored(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function mergeTestDefinitions(defaults, stored) {
  defaults ||= {};
  stored ||= {};
  const definitions = { ...(defaults || {}), ...(stored || {}) };
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => {
    const merged = { ...(defaults?.[name] || {}), ...(definition || {}) };
    const defaultPractical = defaults?.[name]?.practical;
    const storedPractical = stored?.[name]?.practical;
    if (Array.isArray(defaultPractical) && Array.isArray(storedPractical)) {
      merged.practical = defaultPractical.map((stage, index) => {
        const mergedStage = { ...stage, ...(storedPractical[index] || {}) };
        if (stage.images?.length) {
          mergedStage.images = stage.images;
          mergedStage.imageSlots = Number(stage.imageSlots) || stage.images.length;
        }
        return mergedStage;
      });
      merged.practical.push(...storedPractical.slice(defaultPractical.length));
    }
    const defaultPracticalStage = defaults?.[name]?.practicalStage;
    const storedPracticalStage = stored?.[name]?.practicalStage;
    if (defaultPracticalStage && storedPracticalStage) {
      merged.practicalStage = { ...defaultPracticalStage, ...storedPracticalStage };
      if (defaultPracticalStage.images?.length) {
        merged.practicalStage.images = defaultPracticalStage.images;
        merged.practicalStage.imageSlots = Number(defaultPracticalStage.imageSlots) || defaultPracticalStage.images.length;
      }
    }
    const defaultEvaluationStages = defaults?.[name]?.evaluationStages;
    const storedEvaluationStages = stored?.[name]?.evaluationStages;
    if (Array.isArray(defaultEvaluationStages) && Array.isArray(storedEvaluationStages)) {
      merged.evaluationStages = defaultEvaluationStages.map((stage, index) => {
        const mergedStage = { ...stage, ...(storedEvaluationStages[index] || {}) };
        if (stage.images?.length) {
          mergedStage.images = stage.images;
          mergedStage.imageSlots = Number(stage.imageSlots) || stage.images.length;
        }
        return mergedStage;
      });
      merged.evaluationStages.push(...storedEvaluationStages.slice(defaultEvaluationStages.length));
    }
    return [name, merged];
  }));
}
/** @type {Record<string, TestDefinition>} */
const defaultTestDefinitions = window.MEDICAL_TESTS || Object.fromEntries(catalog.map(name => [name, { name, description: `Acces disponibil pentru ${name}.`, questions: [] }]));
let testDefinitions = mergeTestDefinitions(defaultTestDefinitions, readStored(TEST_CATALOG_KEY, {}));
function saveTestDefinitions() { localStorage.setItem(TEST_CATALOG_KEY, JSON.stringify(testDefinitions)); }
const rows = document.querySelector('#tester-rows');
const testerGroups = document.querySelector('#tester-groups');
const viewContent = document.querySelector('#view-content');
const roleColors = ['cyan','orange','violet','green'];
/** @type {string} */
let activeTesterFilter = 'all';
const GRANTS_KEY = 'medici-grants';
/** @type {Member|null} */
let currentUser = null;
/** @type {Member[]} */
let testers = readStored(GRANTS_KEY, []).filter(member => String(member?.name || '').trim()).map(member => ({ ...member, grantedTests: normalizeGrantBundle(member.grantedTests || []) }));
let testRunCounts = {};
let selectedBonusPeriodIndex = null;
function saveTesters() { localStorage.setItem(GRANTS_KEY, JSON.stringify(testers)); }
function refreshCurrentView() {
  renderAvailableTestsSubmenu();
  if (window.history.state?.view === 'test') return;
  if (window.history.state?.view === 'tester-profile') {
    const callsign = window.history.state.callsign;
    const member = testers.find(item => normalizeCallsign(item.callsign) === callsign) || directoryMembers.find(item => normalizeCallsign(item.callsign) === callsign);
    if (member) openTesterProfile(member, { push: false });
    return;
  }
  const active = document.querySelector('.nav-item.active')?.dataset.view || 'overview';
  renderView(active);
}
function candidateSummary(member, result = 'Admis') { if (!member) return ''; return `Candidat: @[${normalizeCallsign(member.callsign)}] ${member.name || '—'}\nGrad: ${member.rank || '—'}\nRezultat: ${result}`; }
async function loadRemoteGrants() {
  if (!currentUser?.discordId) return;
  let payload;
  try {
    const response = await fetch(`/api/access/grants?requesterId=${encodeURIComponent(currentUser.discordId)}`);
    if (!response.ok) { setSyncDetail('Sincronizarea accesului a eșuat'); return; }
    payload = await response.json().catch(() => null);
  } catch (error) {
    console.error(error);
    setSyncDetail('Sincronizarea accesului a eșuat');
    return;
  }
  if (!payload) { setSyncDetail('Sincronizarea accesului a eșuat'); return; }
  const grantsPayload = Array.isArray(payload?.grants) ? payload.grants : [];
  if (!Array.isArray(payload?.grants)) {
    testers = [];
    saveTesters();
    renderRows();
    renderDashboardData();
    refreshCurrentView();
    return;
  }
  if (isLeadershipUser(currentUser)) {
    const grants = grantsPayload;
    testers = directoryMembers.length
      ? directoryMembers.filter(member => String(member.name || '').trim() && (member.isTester || memberIsTester(member))).map(member => {
          const grant = grants.find(item => item.discordId === member.discordId);
          const grantMode = grant?.grantMode || member.grantMode || '';
          const grantedTests = grantMode === 'override'
            ? (grant?.grantedTests || member.grantedTests || [])
            : [...(member.grantedTests || []), ...docsAssignedTests(member), ...(grant?.grantedTests || [])];
          return { ...member, ...grant, grantMode, grantedTests: normalizeGrantBundle(grantedTests) };
        })
      : grants.map(grant => ({ ...grant, grantedTests: normalizeGrantBundle(grant.grantedTests || []) }));
  } else {
    const ownGrant = grantsPayload.find(grant => grant.discordId === currentUser.discordId);
    currentUser.grantMode = ownGrant?.grantMode || currentUser.grantMode || '';
    currentUser.grantedTests = currentUser.grantMode === 'override'
      ? (ownGrant?.grantedTests || currentUser.grantedTests || [])
      : normalizeGrantBundle([...(currentUser.grantedTests || []), ...(ownGrant?.grantedTests || [])]);
    testers = ownGrant ? [{ ...currentUser, ...ownGrant, grantMode: currentUser.grantMode, grantedTests: currentUser.grantedTests }] : [];
  }
  saveTesters();
  renderRows();
  renderDashboardData();
  refreshCurrentView();
}
async function saveRemoteGrant(callsign, grantedTests, remove = false, targetDiscordId = '', individualRemoval = false) {
  if (!currentUser?.discordId) throw new Error('Sesiunea nu conține Discord ID.');
  const response = await fetch('/api/access/grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requesterId: currentUser.discordId, targetDiscordId, callsign, grantedTests, remove, individualRemoval }) });
  const payload = await parseApiResponse(response);
  if (!response.ok) throw new Error(payload.error || 'Accesul nu a putut fi salvat.');
  return payload;
}
async function parseApiResponse(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error(text.trim().slice(0, 240) || `Răspuns invalid de la server (${response.status}).`); }
}
function setSyncDetail(message) { const el = document.querySelector('#sync-detail'); if (el) el.textContent = message; }
/** @param {any} value @returns {string} */
function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
/** @param {any} value @returns {string} */
function normalizeCallsign(value) { const number = String(value || '').replace(/\D/g, ''); return number ? `M-${number.padStart(3, '0')}` : ''; }
/** @param {any} value @returns {number} */
function callsignNumber(value) { const digits = String(value == null ? '' : value).replace(/\D/g, ''); const n = Number(digits); return Number.isFinite(n) ? n : 0; }
/** @param {any} user @returns {boolean} */
function isLeadershipUser(user) { const cs = callsignNumber(user?.csNum || user?.callsign || user?.callSign); return Boolean(user?.accessLevel === 'leadership' || user?.isConducere || user?.isLeadership || (cs >= 1 && cs <= 20)); }
function hasLeadershipCallsign(user) { const cs = callsignNumber(user?.csNum || user?.callsign || user?.callSign); return cs >= 1 && cs <= 20; }
/** @param {any} member @returns {boolean} */
function memberIsLeadership(member) { return isLeadershipUser(member); }
/** @param {any} value @returns {string} */
function leadershipTitleForCallsign(value) { const cs = callsignNumber(value);
  if (cs === 1) return 'Director General';
  if (cs >= 2 && cs <= 4) return 'Director Adjunct';
  if (cs >= 5 && cs <= 8) return 'Medic Inspector';
  if (cs >= 9 && cs <= 10) return 'Medic Chirurg';
  return '';
}
const GRADE_GROUP_ORDER = ['Conducerea departamentului', 'Medici Primari (101-115)', 'Medici Specialisti (201-230)'];
function gradeGroupFor(csNum) { const n = callsignNumber(csNum);
  if (n >= 1 && n <= 20) return 'Conducerea departamentului';
  if (n >= 101 && n <= 115) return 'Medici Primari (101-115)';
  if (n >= 201 && n <= 230) return 'Medici Specialisti (201-230)';
  return '';
}
function gradeGroupForMember(member) { return member?.gradeGroup || gradeGroupFor(member?.csNum || member?.callsign); }
/** @param {any} user @returns {string[]} */
function allowedForUser(user) { if (isLeadershipUser(user)) return catalog; return [...new Set([...(user?.grantedTests || []), ...docsAssignedTests(user)])].filter(test => catalog.includes(test) && testDefinitions[test]); }
function memberHasTestAccess(member, test) { return !isLeadershipUser(member) && allowedForUser(member).includes(test); }
/** @param {any} value @returns {string} */
/** @param {any} member @returns {boolean} */
/** @param {any} value @returns {string} */
function normalizeText(value) { return String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function memberCanGiveTest(member, test) {
  if (member?.grantMode === 'override') return (member.grantedTests || []).includes(test);
  if ((member?.grantedTests || []).includes(test)) return true;
  const functions = normalizeText(member?.functions);
  if (test === 'Test SMULS') return /S\.?\s*M\.?\s*U\.?\s*L\.?\s*S\.?|\s*S\s*\|/.test(functions);
  if (test === 'Test ALS') return /A\.?\s*L\.?\s*S\.?|\s*A\s*\|/.test(functions);
  if (test === 'Test MOTO') return /MOTO|\s*M\s*\|/.test(functions);
  if (test === 'Test PILOT') return /PILOT|\s*P\s*\|/.test(functions);
  if (test === 'Test parașutiști') return (member?.grantedTests || []).includes(test);
  return false;
}
function docsAssignedTests(member) {
  if (member?.grantMode === 'override') return [];
  const assigned = testSummaryDefinitions.map(([test]) => test).filter(test => memberCanGiveTest(member, test));
  if (/\bTESTER\b/.test(normalizeText(member?.functions))) assigned.unshift(...coreTests);
  return [...new Set(assigned)];
}
function normalizeGrantBundle(tests) {
  return [...new Set(tests)].filter(test => catalog.includes(test));
}
function memberIsTester(member) { const cs = callsignNumber(member?.csNum); const specialty = RESIDENT_TESTER_PATTERN.test(normalizeText(member?.functions)); return (member?.grantedTests || []).length > 0 || (cs >= 101 && cs <= 230) || (cs >= 301 && cs <= 340 && specialty) || /TESTER/.test(normalizeText(member?.functions)); }
/** @param {any[]} members @returns {any[]} */
function sortMembers(members) { return [...members].sort((a, b) => { const ca = callsignNumber(a?.csNum); const cb = callsignNumber(b?.csNum); return ca - cb; }); }
function avatarFor(member) {
  const name = String(member?.name || '').trim();
  const initials = escapeHtml(initialsFrom(name || '??'));
  const url = String(member?.avatar || '').trim();
  const colorClass = roleColors[(callsignNumber(member?.csNum) || 0) % roleColors.length];
  return url
    ? `<div class="avatar ${colorClass} has-photo"><img src="${escapeHtml(url)}" alt="${initials}" loading="lazy" onerror="this.parentElement.textContent='${initials}'"></div>`
    : `<div class="avatar ${colorClass}">${initials}</div>`;
}
function memberNameFor(member) { return String(member?.name || '').trim() || normalizeCallsign(member?.callsign) || '—'; }
function rankFor(member) { return String(member?.rank || '').trim() || String(member?.gradeGroup || '').trim() || '—'; }
function memberStatus(member) {
  const status = normalizeText(member?.status);
  if (status === 'CO CIVIL' || status === 'CO-CIVIL') return 'Co Civil';
  return ['ACTIV', 'INACTIV', 'CONCEDIU'].includes(status) ? status[0] + status.slice(1).toLowerCase() : 'Inactiv';
}
function testerFunctionsForDisplay(member) {
  const functions = normalizeText(member?.functions);
  const visibleFunctions = [
    [/A\.?\s*L\.?\s*S\.?/, 'A.L.S.'],
    [/S\.?\s*M\.?\s*U\.?\s*L\.?\s*S\.?/, 'S.M.U.L.S.'],
    [/\bTESTER\b/, 'Tester'],
    [/MOTO/, 'Moto'],
    [/PILOT/, 'Pilot'],
    [/PARACHUTIST|PARAȘUTISM/, 'Test Parasutism']
  ];
  const labels = visibleFunctions.filter(([pattern]) => pattern.test(functions)).map(([, label]) => label);
  if ((member?.grantedTests || []).includes('Test parașutiști') && !labels.includes('Test Parasutism')) labels.push('Test Parasutism');
  return labels.join(' | ') || '—';
}
function memberStatusHtml(member) {
  const status = memberStatus(member);
  const statusClass = status === 'Activ' ? 'online' : status === 'Concediu' ? 'leave' : status === 'Co Civil' ? 'civil' : 'offline';
  return `<span class="status ${statusClass}"><i></i>${status}</span>`;
}
function testerAccessHtml(member) {
  const assignedTests = normalizeGrantBundle(member.grantedTests || []);
  if (isLeadershipUser(member)) return '<span class="muted">Acces general</span>';
  const hasTesterBundle = coreTests.every(test => assignedTests.includes(test));
  const visibleTests = [...(hasTesterBundle ? ['Tester'] : []), ...assignedTests.filter(test => !hasTesterBundle || !coreTests.includes(test))];
  return visibleTests.length
    ? visibleTests.map((test, i) => `<span class="tag ${i % 3 === 1 ? 'orange' : i % 3 === 2 ? 'cyan' : ''}">${escapeHtml(displayTestName(test))}</span>`).join('')
    : '<span class="muted">Fără teste alocate</span>';
}
function testerRowHtml(member, index) {
  const tags = testerAccessHtml(member);
  const profileAction = hasLeadershipCallsign(currentUser) ? `<button class="more" type="button" data-member-profile="${escapeHtml(normalizeCallsign(member.callsign))}" aria-label="Vezi profilul ${escapeHtml(memberNameFor(member))}" title="Vezi profilul">•••</button>` : '';
  return `<tr><td><div class="tester">${avatarFor(member)}<span>${escapeHtml(memberNameFor(member))}</span></div></td><td>${escapeHtml(normalizeCallsign(member.callsign))}</td><td>${escapeHtml(rankFor(member))}</td><td><div class="tags">${tags}</div></td><td>${memberStatusHtml(member)}</td><td>${profileAction}</td></tr>`;
}
function testerTableHtml(members) {
  return `<div class="table-wrap"><table class="tester-access-table"><thead><tr><th>TESTER</th><th>CALLSIGN</th><th>RANK</th><th>TESTE ALOCATE</th><th>STATUS</th><th></th></tr></thead><tbody>${members.map((member, index) => testerRowHtml(member, index)).join('')}</tbody></table></div>`;
}
function currentFilteredTesters() {
  const q = String(document.querySelector('#search')?.value || '').trim().toLowerCase();
  return testers.filter(member => {
    const haystack = `${memberNameFor(member)} ${member.callsign || ''} ${(member.grantedTests || []).join(' ')} ${member.rank || ''}`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (activeTesterFilter !== 'all' && !memberCanGiveTest(member, activeTesterFilter)) return false;
    return true;
  });
}
const RESIDENT_TESTER_PATTERN = /S\.?\s*M\.?\s*U\.?\s*L\.?\s*S\.?|MOTO|A\.?\s*L\.?\s*S\.?|PILOT/;
const DASHBOARD_GROUPS = [
  { label: 'Conducere', members: member => (callsignNumber(member?.csNum) >= 1 && callsignNumber(member?.csNum) <= 20) },
  { label: 'Medici Primari', members: member => { const cs = callsignNumber(member?.csNum); return cs >= 101 && cs <= 115; } },
  { label: 'Medici Specialisti', members: member => { const cs = callsignNumber(member?.csNum); return cs >= 201 && cs <= 230; } },
  { label: 'Medici Rezidenți', members: member => { const cs = callsignNumber(member?.csNum); return cs >= 301 && cs <= 340 && RESIDENT_TESTER_PATTERN.test(normalizeText(member?.functions)); } }
];
function renderRows(list = testers) {
  const query = String(document.querySelector('#search')?.value || '').trim();
  const filtered = currentFilteredTesters();
  if (rows) rows.innerHTML = query ? filtered.map((member, index) => testerRowHtml(member, index)).join('') : '';
  if (testerGroups) {
    testerGroups.innerHTML = !query
      ? '<div class="empty-state">Caută un tester după nume sau callsign.</div>'
      : filtered.length
        ? filtered.map(testerSearchResultHtml).join('')
        : '<div class="empty-state">Nu există testeri pentru căutarea și filtrul selectate.</div>';
  }
  const count = document.querySelector('#tester-count');
  if (count) count.textContent = list.length;
  const active = document.querySelector('#active-count');
  if (active) active.textContent = list.length;
}
function testerSearchResultHtml(member) {
  return `<article class="tester-search-result"><div class="search-result-person">${avatarFor(member)}<div><strong>${escapeHtml(memberNameFor(member))}</strong><small>${escapeHtml(normalizeCallsign(member.callsign))} · ${escapeHtml(rankFor(member))}</small></div></div><div class="search-result-tests tags">${testerAccessHtml(member)}</div>${memberStatusHtml(member)}</article>`;
}
/** @type {Member[]} */
let directoryMembers = [];
async function loadDirectory() {
  if (!currentUser?.discordId) return;
  const response = await fetch(`/api/access/directory?requesterId=${encodeURIComponent(currentUser.discordId)}`);
  if (!response.ok) return;
  const payload = await response.json();
  directoryMembers = (payload.members || []).filter(member => String(member?.name || '').trim());
  const currentDirectoryMember = directoryMembers.find(member => member.discordId === currentUser.discordId);
  if (currentDirectoryMember && !isLeadershipUser(currentUser)) {
    currentUser.grantMode = currentDirectoryMember.grantMode || '';
    currentUser.grantedTests = currentUser.grantMode === 'override'
      ? (currentDirectoryMember.grantedTests || [])
      : normalizeGrantBundle([...(currentUser.grantedTests || []), ...(currentDirectoryMember.grantedTests || [])]);
  }
  await loadTestRunCounts();
  if (isLeadershipUser(currentUser)) {
    testers = directoryMembers.filter(member => member.isTester || memberIsTester(member)).map(member => ({ ...member, grantedTests: normalizeGrantBundle([...(member.grantedTests || []), ...docsAssignedTests(member)]) }));
    saveTesters();
  }
  renderRows();
  renderDashboardData();
  refreshCurrentView();
}
function renderDashboardData() {
  const testerList = document.querySelector('#tester-statistics-list');
  if (testerList) {
    const members = sortMembers(testers);
    testerList.innerHTML = members.length ? members.map(member => {
      const key = String(member.discordId || normalizeCallsign(member.callsign));
      return `<article class="statistics-tester"><div class="statistics-tester-row"><dl class="statistics-tester-fields"><div><dt>CALLSIGN</dt><dd>${escapeHtml(normalizeCallsign(member.callsign))}</dd></div><div><dt>NUME</dt><dd>${escapeHtml(memberNameFor(member))}</dd></div><div><dt>GRAD</dt><dd>${escapeHtml(rankFor(member))}</dd></div></dl><button type="button" class="outline statistics-tests-toggle" data-statistics-member="${escapeHtml(key)}">Teste</button></div></article>`;
    }).join('') : '<div class="empty-state">Nu există testeri.</div>';
  }
  const overview = document.querySelector('#overview-view');
  if (overview) overview.dataset.updatedAt = new Date().toISOString();
}
function renderStatisticsView() {
  return `<div class="statistics-view"><div class="panel-head"><div><h2>Statistica Teste</h2><p class="muted">Testerii și testele înregistrate pentru fiecare persoană.</p></div></div><section class="tester-statistics-list" id="tester-statistics-list" aria-label="Statistica testerilor"></section></div>`;
}
function renderProfileData() {
  if (!currentUser) return;
  const directoryMember = directoryMembers.find(member => member.discordId === currentUser.discordId || normalizeCallsign(member.callsign) === normalizeCallsign(currentUser.callsign || currentUser.callSign));
  const grantMode = directoryMember?.grantMode || currentUser.grantMode || '';
  const profileGrantedTests = grantMode === 'override'
    ? (directoryMember?.grantMode === 'override' ? directoryMember.grantedTests : currentUser.grantedTests)
    : [...(currentUser.grantedTests || []), ...(directoryMember?.grantedTests || []), ...docsAssignedTests(directoryMember || currentUser)];
  const profile = { ...currentUser, ...(directoryMember || {}), grantMode, name: currentUser.discordDisplayName || currentUser.discordUsername || currentUser.displayName || directoryMember?.name || currentUser.name, avatar: currentUser.avatar || directoryMember?.avatar, grantedTests: normalizeGrantBundle(profileGrantedTests || []) };
  const name = memberNameFor(profile);
  const callsign = normalizeCallsign(profile.callsign || profile.callSign);
  const avatar = document.querySelector('#profile-avatar');
  if (avatar) avatar.innerHTML = avatarFor(profile);
  document.querySelector('#profile-name').textContent = name;
  document.querySelector('#profile-callsign').textContent = callsign || '—';
  document.querySelector('#profile-member-name').textContent = String(directoryMember?.name || currentUser.name || '—').trim();
  document.querySelector('#profile-member-rank').textContent = String(directoryMember?.rank || currentUser.rank || '—').trim();
  const profileTests = document.querySelector('#profile-tests');
  if (profileTests) profileTests.innerHTML = profileTestTagsHtml(profile);
  const profileHistory = document.querySelector('#profile-test-history');
  if (profileHistory) profileHistory.innerHTML = testerTestCountGridHtml(profile);
}
function testerTestCountGridHtml(member) {
  const tests = allowedForUser(member);
  return tests.length
    ? tests.map(test => `<div class="statistics-test-count"><span>${escapeHtml(displayTestName(test))}</span><strong>${Number(testRunCounts[member.discordId]?.[test]) || 0}</strong></div>`).join('')
    : '<p class="statistics-no-tests muted">Nu are teste alocate.</p>';
}
function profileTestTagsHtml(member) {
  const grantedTests = normalizeGrantBundle([...(member.grantedTests || []), ...docsAssignedTests(member)]);
  const assignedTests = (isLeadershipUser(member) ? allowedForUser(member) : grantedTests).filter(test => catalog.includes(test));
  const hasTesterBundle = coreTests.every(test => assignedTests.includes(test));
  const visibleTests = [...(hasTesterBundle ? ['Tester'] : []), ...assignedTests.filter(test => !hasTesterBundle || !coreTests.includes(test))];
  return visibleTests.length
    ? visibleTests.map((test, index) => `<span class="tag ${index % 3 === 1 ? 'orange' : index % 3 === 2 ? 'cyan' : ''}">${escapeHtml(displayTestName(test))}</span>`).join('')
    : '<span class="muted">Nu ai certificări sau teste alocate.</span>';
}
async function loadTestRunCounts() {
  if (!currentUser?.discordId) { testRunCounts = {}; return; }
  try {
    const response = await fetch(`/api/access/test-results?requesterId=${encodeURIComponent(currentUser.discordId)}`);
    const payload = await parseApiResponse(response);
    if (!response.ok) throw new Error(payload.error || 'Istoricul testelor nu a putut fi încărcat.');
    testRunCounts = {};
    for (const item of payload.counts || []) {
      testRunCounts[item.discordId] ||= {};
      testRunCounts[item.discordId][item.testName] = Number(item.count) || 0;
    }
  } catch (error) {
    testRunCounts = {};
    console.error('Test history load failed:', error);
  }
}
async function resetAllTestCounts() {
  const button = document.querySelector('#admin-reset-tests');
  const status = document.querySelector('#admin-reset-status');
  if (!hasLeadershipCallsign(currentUser)) { status.textContent = 'Doar conducerea cu callsign 001–020 poate reseta testele.'; return; }
  if (!window.confirm('Resetezi numărul testelor susținute pentru toți membrii? Această acțiune nu poate fi anulată.')) return;
  button.disabled = true;
  status.textContent = 'Se resetează…';
  try {
    const response = await fetch('/api/access/test-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requesterId: currentUser.discordId, action: 'reset-counts' }) });
    const payload = await parseApiResponse(response);
    if (!response.ok) throw new Error(payload.error || 'Numărătorile nu au putut fi resetate.');
    await loadTestRunCounts();
    renderProfileData();
    renderDashboardData();
    refreshCurrentView();
    status.textContent = `Resetare finalizată. Rezultate șterse: ${Number(payload.cleared) || 0}.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
async function recordTestRun(testName, result = '', details = {}) {
  if (!currentUser?.discordId) throw new Error('Sesiunea nu conține Discord ID.');
  const response = await fetch('/api/access/test-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...details, requesterId: currentUser.discordId, testName, result }) });
  const payload = await parseApiResponse(response);
  if (!response.ok) throw new Error(payload.error || 'Testul susținut nu a putut fi înregistrat.');
  testRunCounts[currentUser.discordId] ||= {};
  testRunCounts[currentUser.discordId][testName] = (testRunCounts[currentUser.discordId][testName] || 0) + 1;
  renderDashboardData();
  return payload;
}
function renderAvailableTestsSubmenu() {
  const submenu = document.querySelector('#available-tests-submenu');
  const bonusNav = document.querySelector('#bonuses-nav');
  if (bonusNav) bonusNav.hidden = !isLeadershipUser(currentUser);
  if (!submenu || !currentUser) return;
  const selectedTest = window.history.state?.testName;
  const tests = allowedForUser(currentUser);
  submenu.innerHTML = tests.length
          ? tests.map(test => `<button type="button" class="nav-subitem ${selectedTest === test ? 'active' : ''}" data-available-test="${escapeHtml(test)}">${escapeHtml(displayTestName(test))}</button>`).join('')
    : '<span class="nav-submenu-empty">Nu ai teste disponibile.</span>';
}
function testAccessMarkup(testName) {
  if (!isLeadershipUser(currentUser)) return '';
  const accessibleMembers = sortMembers(testers.filter(member => memberHasTestAccess(member, testName)));
  const members = accessibleMembers.length
    ? `<ul>${accessibleMembers.map(member => `<li><strong>${escapeHtml(memberNameFor(member))}</strong> <span>${escapeHtml(normalizeCallsign(member.callsign))}</span></li>`).join('')}</ul>`
    : '<p class="muted">Nu există testeri cu acces.</p>';
  return `<div class="test-guide-access"><button class="outline test-access-toggle" type="button" data-test-access="${escapeHtml(testName)}" aria-expanded="false">Vezi cine are acces (${accessibleMembers.length})</button><div class="test-access-list" hidden>${members}</div></div>`;
}
function wireTestAccessEvents() {
  viewContent.querySelectorAll('[data-test-access]').forEach(button => {
    button.onclick = () => {
      const list = button.nextElementSibling;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      list.hidden = expanded;
      button.setAttribute('aria-expanded', String(!expanded));
    };
  });
}
function displayTestName(testName) {
  const title = String(testDefinitions[testName]?.title || '').trim();
  return title || (testName === 'Test parașutiști' ? 'Test Parasutism' : testName);
}
function renderTestersView() {
  const groups = DASHBOARD_GROUPS.map(group => ({ label: group.label, members: sortMembers(testers.filter(group.members)) })).filter(group => group.members.length);
  const orphan = sortMembers(testers.filter(member => !DASHBOARD_GROUPS.some(group => group.members(member))));
  if (orphan.length) groups.push({ label: 'Alți membri', members: orphan });
  const actions = isLeadershipUser(currentUser) ? '<div class="welcome-actions"><button class="primary" id="view-add">＋ Adaugă tester</button><button class="primary" id="view-remove">－ Scoatere Tester</button></div>' : '';
  const sections = groups.map(group => `<section class="tester-group"><h3>${escapeHtml(group.label)}</h3><div class="table-wrap"><table class="tester-access-table"><thead><tr><th>TESTER</th><th>CALLSIGN</th><th>RANK</th><th>TESTE ALOCATE</th><th>STATUS</th><th></th></tr></thead><tbody>${group.members.map((member, index) => testerRowHtml(member, index)).join('')}</tbody></table></div></section>`).join('');
  return `<div class="panel view-panel"><div class="panel-head"><div><h2>Testerii departamentului</h2></div>${actions}</div>${sections || '<div class="empty-state">Nu există testeri.</div>'}</div>`;
}
function renderTesterProfileView(member) {
  const callsign = normalizeCallsign(member.callsign || member.callSign);
    const name = memberNameFor(member);
  const testCountGrid = testerTestCountGridHtml(member);
  const removalControls = hasLeadershipCallsign(currentUser) && !hasLeadershipCallsign(member)
    ? `<button class="profile-settings-button" id="profile-test-settings" type="button" aria-label="Gestionează testele" title="Gestionează testele">⚙</button><div class="profile-test-removal" id="profile-test-removal" hidden><h3>Teste alocate</h3><div class="profile-test-removal-list">${(member.grantedTests || []).length ? member.grantedTests.map(test => `<div class="profile-test-removal-item"><span>${escapeHtml(displayTestName(test))}</span><button class="outline danger-button" type="button" data-remove-profile-test="${escapeHtml(test)}">Scoate</button></div>`).join('') : '<p class="muted">Nu există teste alocate.</p>'}</div><p class="profile-test-removal-status muted" role="status" aria-live="polite"></p></div>`
    : '';
  return `<div class="tester-profile-view"><div class="panel-head"><div><p class="eyebrow">PROFIL TESTER</p><h2>${escapeHtml(name)}</h2></div><button class="outline" id="back-to-testers" type="button">← Înapoi</button></div><div class="profile-layout"><section class="panel profile-card">${removalControls}<div class="profile-identity"><div>${avatarFor(member)}</div><div><h1>${escapeHtml(name)}</h1></div></div><dl class="profile-details"><div><dt>CALLSIGN</dt><dd>${escapeHtml(callsign || '—')}</dd></div><div><dt>NUME</dt><dd>${escapeHtml(member.name || '—')}</dd></div><div><dt>GRAD</dt><dd>${escapeHtml(member.rank || '—')}</dd></div></dl></section><section class="panel profile-certifications"><div class="panel-head"><div><h2>Grade de test</h2><p class="muted">Certificările și testele alocate contului tău</p></div></div><div class="tags profile-test-tags">${profileTestTagsHtml(member)}</div></section></div><section class="panel profile-test-history"><div class="panel-head"><div><h2>Statistica Teste</h2></div></div><div class="statistics-test-grid">${testCountGrid}</div></section></div>`;
}
function openTesterProfile(member, { push = true, previousView: requestedPreviousView } = {}) {
  if (!hasLeadershipCallsign(currentUser)) return;
  const callsign = normalizeCallsign(member.callsign || member.callSign);
  const currentState = window.history.state || {};
  const previousView = requestedPreviousView || (currentState.view === 'tester-profile' ? currentState.previousView : document.querySelector('.nav-item.active')?.dataset.view || 'overview');
  const canReturnHistory = push ? previousView === 'testers' : Boolean(currentState.canReturnHistory);
  const routeState = { view: 'tester-profile', callsign, previousView, canReturnHistory };
  const route = `#tester-profile-${encodeURIComponent(callsign)}`;
  if (push) window.history.pushState(routeState, '', route);
  else window.history.replaceState(routeState, '', route);
  const profile = { ...member, grantedTests: normalizeGrantBundle([...(member.grantedTests || []), ...docsAssignedTests(member)]) };
  document.querySelector('#overview-view').hidden = true;
  document.querySelector('#overview-view').style.display = 'none';
  viewContent.hidden = false;
  viewContent.style.display = 'block';
  viewContent.innerHTML = renderTesterProfileView(profile);
  document.querySelector('#section-label').textContent = 'SITE TESTERI';
  document.querySelector('#page-label').textContent = `Profil: ${memberNameFor(profile)}`;
  document.querySelector('#back-to-testers').onclick = () => {
    if (window.history.state?.canReturnHistory) window.history.back();
    else {
      const destination = labels[previousView] ? previousView : 'overview';
      window.history.replaceState({ view: destination }, '', `#${destination}`);
      navigateTo(destination, { push: false });
    }
  };
  wireProfileTestRemoval(profile);
}
function wireProfileTestRemoval(member) {
  const settings = document.querySelector('#profile-test-settings');
  const removalPanel = document.querySelector('#profile-test-removal');
  if (!settings || !removalPanel) return;
  settings.onclick = () => {
    removalPanel.hidden = !removalPanel.hidden;
    settings.setAttribute('aria-expanded', String(!removalPanel.hidden));
  };
  removalPanel.querySelectorAll('[data-remove-profile-test]').forEach(button => {
    button.onclick = async () => {
      if (!hasLeadershipCallsign(currentUser) || hasLeadershipCallsign(member)) return;
      const status = removalPanel.querySelector('.profile-test-removal-status');
      if (!member.discordId) { status.textContent = 'Membrul nu are un Discord ID asociat.'; return; }
      const test = button.dataset.removeProfileTest;
      const nextTests = (member.grantedTests || []).filter(item => item !== test);
      button.disabled = true;
      status.textContent = 'Se salvează…';
      try {
        const saved = await saveRemoteGrant(normalizeCallsign(member.callsign), nextTests, false, member.discordId, true);
        const updatedMember = {
          ...member,
          ...(saved?.grant || {}),
          grantMode: 'override',
          grantedTests: normalizeGrantBundle(saved?.grant?.grantedTests ?? nextTests)
        };
        const isTarget = candidate => candidate.discordId === member.discordId || normalizeCallsign(candidate.callsign) === normalizeCallsign(member.callsign);
        testers = testers.map(candidate => isTarget(candidate) ? { ...candidate, ...updatedMember } : candidate);
        directoryMembers = directoryMembers.map(candidate => isTarget(candidate) ? { ...candidate, ...updatedMember } : candidate);
        saveTesters();
        renderRows();
        renderDashboardData();
        openTesterProfile(updatedMember, { push: false });
        document.querySelector('#profile-test-settings')?.click();
        const updatedStatus = document.querySelector('.profile-test-removal-status');
        if (updatedStatus) updatedStatus.textContent = `Testul ${displayTestName(test)} a fost scos.`;
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    };
  });
}
function renderMembersView() {
  const groups = GRADE_GROUP_ORDER.filter(group => directoryMembers.some(member => gradeGroupForMember(member) === group));
  const sections = groups.map(group => {
    const members = sortMembers(directoryMembers.filter(member => gradeGroupForMember(member) === group));
    if (!members.length) return '';
    const rowsHtml = members.map(member => `<tr><td>${escapeHtml(normalizeCallsign(member.callsign))}</td><td>${escapeHtml(member.name || '—')}</td><td>${escapeHtml(member.rank || '—')}</td><td>${escapeHtml(isLeadershipUser(member) ? 'Conducere' : testerFunctionsForDisplay(member))}</td></tr>`).join('');
    return `<section class="member-group"><h3>${escapeHtml(group)}</h3><div class="table-wrap"><table><thead><tr><th>CALLSIGN</th><th>NUME</th><th>GRAD</th><th>FUNCȚII</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></section>`;
  }).join('');
  return `<div class="panel view-panel"><h2>Membri departament</h2><p class="muted">Membrii departamentului sunt grupați pe grade: conducere, medici primari și medici specialiști.</p>${sections || '<p class="muted">Nu s-a putut încărca lista membrilor.</p>'}</div>`;
}
function renderSettingsView(title) {
  return `<div class="panel view-panel"><h2>${title}</h2><p class="muted">Gestionează preferințele și sesiunea contului tău.</p><div class="settings-list"><p><b>Identitate:</b> ${currentUser?.name || '—'}</p><p><b>Callsign:</b> ${normalizeCallsign(currentUser?.callsign || currentUser?.callSign)}</p><p><b>Nivel acces:</b> ${isLeadershipUser(currentUser) ? 'Conducere' : 'Tester'}</p>${isLeadershipUser(currentUser) ? `<hr><section class="test-editor"><h3>Configurare teste</h3><div class="test-editor-controls"><label>Test<select id="test-editor-select">${catalog.map(test => `<option value="${test}">${displayTestName(test)}</option>`).join('')}</select></label><label>Titlu afișat<input id="test-editor-title" type="text"></label><label>Conținut card<textarea id="test-editor-description" rows="3"></textarea></label><label>Instrucțiuni<textarea id="test-editor-instructions" rows="3"></textarea></label><label>Greșeli permise<input id="test-editor-max-wrong" type="number" min="0" step="1"></label></div><div class="test-editor-question-header"><h4>Întrebări și răspunsuri</h4><button class="outline" id="add-test-question" type="button">＋ Adaugă întrebare</button></div><div id="test-editor-questions" class="test-editor-questions"></div><details class="test-editor-advanced"><summary>Configurare avansată</summary><p class="muted">Pentru cazuri, probe practice și imagini.</p><input id="test-file-input" type="file" accept=".txt,.md,.json"><textarea id="test-editor-json" rows="8" spellcheck="false"></textarea></details><button class="primary" id="save-test-definition">Salvează testul</button><span id="test-editor-status" class="muted" role="status"></span></section>` : ''}</div></div>`;
}
function testQuestionEditorHtml(question, index) {
  return `<fieldset class="test-editor-question"><legend>Întrebarea ${index + 1}</legend><label>Întrebare<textarea data-question-text rows="2">${escapeHtml(question?.text || '')}</textarea></label><label>Răspuns<textarea data-question-answer rows="2">${escapeHtml(question?.answer || '')}</textarea></label><button type="button" class="outline danger-button" data-remove-question="${index}">Șterge întrebarea</button></fieldset>`;
}
function renderTestQuestionEditor(container, questions) {
  container.innerHTML = questions.map(testQuestionEditorHtml).join('') || '<p class="muted">Nu există întrebări. Adaugă una pentru a începe.</p>';
}
function wireTestersEvents() {
  const add = document.querySelector('#view-add'); if (add) add.onclick = () => openAddModal();
  const remove = document.querySelector('#view-remove'); if (remove) remove.onclick = () => openRemoveModal();
}
function wireSettingsEvents() {
  const editor = document.querySelector('#test-editor-select');
  const editorJson = document.querySelector('#test-editor-json');
  const editorTitle = document.querySelector('#test-editor-title');
  const editorDescription = document.querySelector('#test-editor-description');
  const editorInstructions = document.querySelector('#test-editor-instructions');
  const editorMaxWrong = document.querySelector('#test-editor-max-wrong');
  const questionContainer = document.querySelector('#test-editor-questions');
  const editorStatus = document.querySelector('#test-editor-status');
  if (!editor || !editorJson || !questionContainer) return;
  const readEditorQuestions = () => [...questionContainer.querySelectorAll('.test-editor-question')].map(item => ({
    text: item.querySelector('[data-question-text]').value.trim(),
    answer: item.querySelector('[data-question-answer]').value.trim()
  }));
  const loadDefinition = definition => {
    const value = definition || testDefinitions[editor.value] || {};
    editorTitle.value = value.title || (editor.value === 'Test parașutiști' ? 'Test Parasutism' : editor.value);
    editorDescription.value = value.description || '';
    editorInstructions.value = value.instructions || '';
    editorMaxWrong.value = Number.isFinite(Number(value.maxWrong)) ? value.maxWrong : '';
    editorJson.value = JSON.stringify(value, null, 2);
    renderTestQuestionEditor(questionContainer, Array.isArray(value.questions) ? value.questions : []);
  };
  editor.onchange = () => loadDefinition();
  loadDefinition();
  questionContainer.onclick = event => {
    const removeButton = event.target.closest('[data-remove-question]');
    if (!removeButton) return;
    const questions = readEditorQuestions();
    questions.splice(Number(removeButton.dataset.removeQuestion), 1);
    renderTestQuestionEditor(questionContainer, questions);
  };
  document.querySelector('#add-test-question').onclick = () => {
    renderTestQuestionEditor(questionContainer, [...readEditorQuestions(), { text: '', answer: '' }]);
  };
  const fileInput = document.querySelector('#test-file-input');
  if (fileInput) fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported || typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Format JSON invalid');
      editorJson.value = JSON.stringify(imported, null, 2);
      loadDefinition(imported);
      editorStatus.textContent = 'Fișier încărcat. Verifică rubricile și salvează.';
    } catch { editorStatus.textContent = 'Fișierul trebuie să conțină o definiție JSON validă.'; }
  };
  document.querySelector('#save-test-definition').onclick = () => {
    try {
      const advanced = JSON.parse(editorJson.value);
      if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced)) throw new Error('Format JSON invalid');
      const value = {
        ...advanced,
        name: editor.value,
        title: editorTitle.value.trim() || editor.value,
        description: editorDescription.value.trim(),
        instructions: editorInstructions.value.trim(),
        questions: readEditorQuestions()
      };
      if (editorMaxWrong.value.trim() === '') delete value.maxWrong;
      else value.maxWrong = Number(editorMaxWrong.value);
      if (!Number.isFinite(value.maxWrong) && value.maxWrong !== undefined) throw new Error('Număr maxim de greșeli invalid');
      testDefinitions[editor.value] = value;
      saveTestDefinitions();
      editorJson.value = JSON.stringify(value, null, 2);
      editorStatus.textContent = 'Test salvat local.';
      renderRows();
    } catch (error) { editorStatus.textContent = error.message || 'Definiție JSON invalidă.'; }
  };
}
function renderView(view) {
  const overview = document.querySelector('#overview-view');
  const isOverview = view === 'overview';
  viewContent.hidden = isOverview;
  overview.hidden = !isOverview;
  viewContent.style.display = isOverview ? 'none' : 'block';
  overview.style.display = isOverview ? 'block' : 'none';
  if (isOverview) { renderProfileData(); return; }
  const title = labels[view] || 'Spațiul tău';
  document.querySelector('#section-label').textContent = view === 'settings' ? 'Administrare' : 'Spațiul tău';
  if (view === 'testers') { viewContent.innerHTML = renderTestersView(); wireTestersEvents(); }
  else if (view === 'statistics') { viewContent.innerHTML = renderStatisticsView(); renderDashboardData(); }
  else if (view === 'bonuses') { viewContent.innerHTML = renderBonusesView(); wireBonusesEvents(); }
  else { viewContent.innerHTML = renderSettingsView(title); wireSettingsEvents(); }
}
  const BONUS_ANCHOR_UTC = Date.UTC(2026, 8, 21);
  const BONUS_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
const BONUS_CATEGORIES = [
  { label: 'PILOT', tests: ['Test PILOT'] },
  { label: 'MOTO', tests: ['Test MOTO'] },
  { label: 'ADMITERE', tests: ['Test admitere', 'Test transfer'] },
  { label: 'ADEVERINȚE', tests: ['Adeverință medicală'] },
  { label: 'ALS', tests: ['Test ALS'] },
  { label: 'S.M.U.L.S.', tests: ['Test SMULS'] }
];
const BONUS_TEST_CATEGORY = new Map(BONUS_CATEGORIES.flatMap((category, index) => category.tests.map(test => [test, index])));
  function departmentCalendarDate(date) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  }
  function latestCompleteBonusPeriodIndex(now = new Date()) {
    const today = departmentCalendarDate(now);
    const currentIndex = Math.floor((today - BONUS_ANCHOR_UTC) / BONUS_PERIOD_MS);
    const currentStart = BONUS_ANCHOR_UTC + currentIndex * BONUS_PERIOD_MS;
    return today < currentStart + BONUS_PERIOD_MS ? currentIndex - 1 : currentIndex;
  }
function activeBonusPeriodIndex(now = new Date()) {
  return Math.floor((departmentCalendarDate(now) - BONUS_ANCHOR_UTC) / BONUS_PERIOD_MS);
}
  function bonusPeriodFor(index) {
    const start = BONUS_ANCHOR_UTC + index * BONUS_PERIOD_MS;
    const end = start + BONUS_PERIOD_MS - 24 * 60 * 60 * 1000;
    return { index, from: new Date(start).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10) };
  }
  function bonusPeriodLabel(period) {
    const format = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit' });
    return `${format(period.from)}–${format(period.to)}`;
  }
  function renderBonusesView() {
    if (selectedBonusPeriodIndex === null) selectedBonusPeriodIndex = activeBonusPeriodIndex();
    const period = bonusPeriodFor(selectedBonusPeriodIndex);
    const activePeriod = bonusPeriodFor(activeBonusPeriodIndex());
    return `<section class="panel bonus-panel"><div class="panel-head"><div><p class="eyebrow">ACTIVITATE TESTERI</p><h2>Bonusuri</h2></div></div><p class="bonus-active-period"><strong>Perioada activă:</strong> ${bonusPeriodLabel(activePeriod)}</p><div class="bonus-period-controls"><button class="outline" type="button" data-bonus-shift="-1" aria-label="Perioada anterioară">←</button><strong>Perioada afișată: ${bonusPeriodLabel(period)}</strong><button class="outline" type="button" data-bonus-shift="1" aria-label="Perioada următoare" ${selectedBonusPeriodIndex >= activePeriod.index ? 'disabled' : ''}>→</button></div><p class="bonus-period-status muted" id="bonus-period-status" role="status" aria-live="polite">Se încarcă testele...</p><div class="bonus-table-wrap"><table class="bonus-table"><thead><tr><th>CALLSIGN</th><th>MEDIC</th>${BONUS_CATEGORIES.map(category => `<th>${category.label}</th>`).join('')}<th></th></tr></thead><tbody id="bonus-rows"><tr><td colspan="9">Se încarcă...</td></tr></tbody></table></div></section>`;
  }
  async function loadBonusEntries(period) {
    const status = document.querySelector('#bonus-period-status');
    const body = document.querySelector('#bonus-rows');
    try {
      const query = new URLSearchParams({ requesterId: currentUser.discordId, view: 'bonuses', from: period.from, to: period.to });
      const response = await fetch(`/api/access/test-results?${query}`);
      const payload = await parseApiResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Bonusurile nu au putut fi încărcate.');
      const rowsByCallsign = new Map();
      for (const entry of payload.entries || []) {
        const callsign = callsignNumber(entry.callsign);
        const category = BONUS_TEST_CATEGORY.get(entry.testName);
        if (callsign < 101 || callsign > 399 || category === undefined) continue;
        const key = String(callsign).padStart(3, '0');
        const row = rowsByCallsign.get(key) || { callsign: key, name: entry.testerName || '—', counts: Array(BONUS_CATEGORIES.length).fill(0) };
        row.counts[category] += 1;
        rowsByCallsign.set(key, row);
      }
      const rows = [...rowsByCallsign.values()].sort((left, right) => callsignNumber(left.callsign) - callsignNumber(right.callsign));
      if (body) body.innerHTML = rows.length
        ? rows.map(row => `<tr><td>${escapeHtml(row.callsign)}</td><td>${escapeHtml(row.name)}</td>${row.counts.map(count => `<td data-bonus-count>${count}</td>`).join('')}<td><button class="outline bonus-row-copy" type="button" data-bonus-copy title="Copiază doar valorile pentru rândul ${escapeHtml(row.callsign)}">Copiază</button></td></tr>`).join('')
        : '<tr><td colspan="9">Nu sunt teste în această perioadă.</td></tr>';
      if (status) status.textContent = `${rows.length} persoane cu teste în perioada ${bonusPeriodLabel(period)}.`;
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  }
  function wireBonusesEvents() {
    const period = bonusPeriodFor(selectedBonusPeriodIndex ?? activeBonusPeriodIndex());
    loadBonusEntries(period);
    document.querySelectorAll('[data-bonus-shift]').forEach(button => button.addEventListener('click', () => {
      selectedBonusPeriodIndex += Number(button.dataset.bonusShift);
      navigateTo('bonuses', { push: false });
    }));
    document.querySelector('#bonus-rows')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-bonus-copy]');
      if (!button) return;
      const values = [...button.closest('tr').querySelectorAll('[data-bonus-count]')].map(cell => cell.textContent.trim()).join('\t');
      const status = document.querySelector('#bonus-period-status');
      try {
        await navigator.clipboard.writeText(values);
        status.textContent = `Valorile pentru ${button.closest('tr').cells[0].textContent} au fost copiate.`;
      } catch {
        const input = document.createElement('textarea');
        input.value = values;
        document.body.append(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        status.textContent = `Valorile pentru ${button.closest('tr').cells[0].textContent} au fost copiate.`;
      }
    });
  }
function testNameFromHash(hash) {
  const match = String(hash || '').match(/^#test-(.+)$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); }
  catch { return ''; }
}
function openTest(testName, { push = true, previousView: requestedPreviousView } = {}) {
  const definition = testDefinitions[testName] || { description: 'Test disponibil.', questions: [] };
  const questions = Array.isArray(definition.questions) ? definition.questions : [];
  const currentView = window.history.state?.view;
  const previousView = requestedPreviousView || (currentView === 'test' ? window.history.state.previousView : labels[currentView] ? currentView : document.querySelector('.nav-item.active')?.dataset.view || 'overview');
  const routeState = { view: 'test', testName, previousView };
  const route = `#test-${encodeURIComponent(testName)}`;
  if (push && currentView !== 'test') window.history.pushState(routeState, '', route);
  else window.history.replaceState(routeState, '', route);
  document.querySelector('#overview-view').hidden = true;
  document.querySelector('#overview-view').style.display = 'none';
  viewContent.hidden = false;
  viewContent.style.display = 'block';
  document.querySelector('#section-label').textContent = 'Spațiul tău';
  document.querySelector('#page-label').textContent = displayTestName(testName);
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.id === 'available-tests-toggle'));
  document.querySelectorAll('[data-available-test]').forEach(item => item.classList.toggle('active', item.dataset.availableTest === testName));
  document.querySelector('.sidebar').classList.remove('open');
  viewContent.innerHTML = buildTestMarkup(testName, definition, questions);
  wireTestAccessEvents();
  wireTestEvents(testName, definition);
}
function admissionChecklistHtml() {
  return `<section class="admission-checklist" aria-labelledby="admission-checklist-title"><h3 id="admission-checklist-title">Verificări înainte de proba teoretică</h3>${admissionRequirements.map((requirement, index) => `<label class="admission-check-row"><span>${escapeHtml(requirement)}</span><span class="admission-check-control"><input type="checkbox" data-admission-check="${index}" aria-label="${escapeHtml(requirement)}"><span class="admission-check-error" aria-hidden="true">!</span></span></label>`).join('')}</section>`;
}
function admissionChecksComplete(checks) { return checks.length === admissionRequirements.length && checks.every(Boolean); }
function motoChecklistHtml() {
  return `<section class="admission-checklist moto-checklist" aria-labelledby="moto-checklist-title"><h3 id="moto-checklist-title">Verificări înainte de test</h3>${motoRequirements.map((requirement, index) => `<label class="admission-check-row"><span>${escapeHtml(requirement)}</span><span class="admission-check-control"><input type="checkbox" data-moto-check="${index}" aria-label="${escapeHtml(requirement)}"><span class="admission-check-error" aria-hidden="true">!</span></span></label>`).join('')}</section>`;
}
function motoCandidateBriefingHtml(briefing = {}) {
  const points = (briefing.points || []).map(point => `<li>${escapeHtml(point)}</li>`).join('');
  return `<section class="moto-candidate-briefing"><h3>Candidatului i se vor aduce la cunoștință următoarele:</h3><ul>${points}</ul><h4>Atenție</h4><p>${escapeHtml(briefing.warning || '')}</p><p>${escapeHtml(briefing.route || '')}</p></section>`;
}
function parachutismChecklistHtml(criteria = []) {
  return `<section class="admission-checklist parachutism-checklist" aria-labelledby="parachutism-checklist-title"><h3 id="parachutism-checklist-title">Criterii pentru proba teoretică</h3>${criteria.map((criterion, index) => `<label class="admission-check-row"><span>${escapeHtml(criterion)}</span><span class="admission-check-control"><input type="checkbox" data-parachutism-check="${index}" aria-label="${escapeHtml(criterion)}"><span class="admission-check-error" aria-hidden="true">!</span></span></label>`).join('')}</section>`;
}
function parachutismInformationHtml(definition = {}) {
  const candidatePoints = (definition.candidateInformation || []).map(point => `<li>${escapeHtml(point)}</li>`).join('');
  const testerPoints = (definition.testerInformation || []).map(point => `<li>${escapeHtml(point)}</li>`).join('');
  return `<div class="parachutism-information-grid"><section class="parachutism-information-card"><h3>Candidatului i se va aduce la cunoștință:</h3><ul>${candidatePoints}</ul></section><section class="parachutism-information-card"><h3>Informații pentru tester:</h3><ul>${testerPoints}</ul></section></div>`;
}
function motoChecksComplete(checks) { return checks.length === motoRequirements.length && checks.every(Boolean); }
function smulsChecklistHtml() {
  const requirements = ['Verificare test teoretic', 'Licență Navală', 'Permis Categoria B', 'Mașina Stalker full tunată'];
  return `<section class="admission-checklist smuls-checklist" aria-labelledby="smuls-checklist-title"><h3 id="smuls-checklist-title">Verificări înainte de test</h3>${requirements.map((requirement, index) => `<label class="admission-check-row"><span>${escapeHtml(requirement)}</span><span class="admission-check-control"><input type="checkbox" data-smuls-check="${index}" aria-label="${escapeHtml(requirement)}"><span class="admission-check-error" aria-hidden="true">!</span></span></label>`).join('')}</section>`;
}
function smulsChecksComplete(checks) { return checks.length === 4 && checks.every(Boolean); }
function alsChecklistHtml() {
  return `<section class="admission-checklist als-checklist" aria-labelledby="als-checklist-title"><h3 id="als-checklist-title">Verificări înainte de test</h3>${alsRequirements.map((requirement, index) => `<label class="admission-check-row"><span>${escapeHtml(requirement)}</span><span class="admission-check-control"><input type="checkbox" data-als-check="${index}" aria-label="${escapeHtml(requirement)}"><span class="admission-check-error" aria-hidden="true">!</span></span></label>`).join('')}</section>`;
}
function alsChecksComplete(checks) { return checks.length === alsRequirements.length && checks.every(Boolean); }
function alsCaseListHtml(cases) {
  const caseDetails = (cases || []).map((item, index) => `<details class="als-case"><summary>${escapeHtml(item.title || `Cazul ${index + 1}`)}</summary><div class="als-case-content"><p>${escapeHtml(item.description || '')}</p><p class="als-case-count">${Number(item.minimumMe) || 0} /me-uri</p><h4>/me-uri orientative</h4><ol>${(item.steps || []).map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol></div></details>`).join('');
  return `<section class="als-case-stage"><h3>PROBA ALS: Cazuri de intervenție</h3><div class="als-case-list">${caseDetails}</div><div class="evaluation-stage-actions"><button type="button" class="primary evaluation-verdict evaluation-verdict-admitted" data-als-result="Admis">Admis ALS</button><button type="button" class="primary evaluation-verdict evaluation-verdict-rejected" data-als-result="Respins">Respins ALS</button></div></section>`;
}
function smulsCaseListHtml(cases, images = []) {
  const caseDetails = (cases || []).map(item => `<details class="smuls-case"><summary>${escapeHtml(item.title)}</summary><div class="smuls-case-content"><ol>${(item.steps || []).map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol></div></details>`).join('');
  const imageSlots = `<aside class="smuls-descarceration-images" aria-label="Imagini de descarcerare">${Array.from({ length: 2 }, (_, index) => {
    const image = images[index];
    const content = image?.url ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.label || `Imagine ${index + 1}`)}">` : `Imagine ${index + 1}`;
    return `<div class="smuls-case-image-slot" role="img" aria-label="${escapeHtml(image?.label || `Imagine ${index + 1}`)}">${content}</div>`;
  }).join('')}</aside>`;
  return `<section class="smuls-descarceration-stage"><h3>PROBA 1: Descarcerare</h3><div class="smuls-descarceration-layout"><div class="smuls-descarceration-copy"><div class="smuls-case-list">${caseDetails}</div><div class="evaluation-stage-actions"><button type="button" class="primary evaluation-verdict evaluation-verdict-admitted" data-smuls-descarceration-result="Admis">Admis Descarcerare</button><button type="button" class="primary evaluation-verdict evaluation-verdict-rejected" data-smuls-descarceration-result="Respins">Respins Descarcerare</button></div></div>${imageSlots}</div></section>`;
}
function isTestFailed(wrong, maxWrong) { return wrong > maxWrong; }
function maxWrongForTest(testName, maxWrong) { return testName === 'Test admitere' ? 3 : testName === 'Test PILOT' ? 1 : Number(maxWrong ?? Infinity); }
function questionItemHtml(question, index, allowWrong = true) {
  const answer = allowWrong ? `<div class="correct-answer"><span>${question.answer || 'Verifică ghidul.'}</span><label class="answer-check"><input type="checkbox" data-wrong="${index}"> Răspuns greșit</label></div>` : '';
  return `<fieldset><p class="question-prompt">${index + 1}. ${question.text}</p>${answer}</fieldset>`;
}
function evaluationStageHtml(stage, verdictLabels) {
  const paragraphs = (stage.paragraphs || []).map(text => `<p>${escapeHtml(text)}</p>`).join('');
  const conditions = stage.conditions?.length ? `<h4>Condiții</h4><ul>${stage.conditions.map(condition => `<li>${escapeHtml(condition)}</li>`).join('')}</ul>` : '';
  const buttons = verdictLabels.map(label => `<button type="button" class="primary evaluation-verdict evaluation-verdict-${label.result === 'Admis' ? 'admitted' : 'rejected'}" data-evaluation-result="${label.result}">${escapeHtml(label.text)}</button>`).join('');
  const imageCount = Number(stage.imageSlots) || 0;
  const imageSlots = imageCount > 0 ? `<aside class="evaluation-stage-images" aria-label="Imagini de referință" style="--image-slot-count:${imageCount}">${Array.from({ length: imageCount }, (_, index) => {
    const image = stage.images?.[index];
    const content = image?.url ? `<img src="${escapeHtml(image.url)}" alt="">` : `<span>Imagine ${index + 1}</span>`;
    return `<div class="evaluation-stage-image-slot" role="img" aria-label="${escapeHtml(image?.label || `Imagine de referință ${index + 1}`)}">${content}</div>`;
  }).join('')}</aside>` : '';
  return `<section class="evaluation-stage-card${imageSlots ? ' has-image-slots' : ''}"><div class="evaluation-stage-copy"><h3>${escapeHtml(stage.title)}</h3>${paragraphs}${conditions}<div class="evaluation-stage-actions">${buttons}</div></div>${imageSlots}</section>`;
}
function parseIdentityCardText(text) {
  const rawText = String(text || '');
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const fieldMarker = /\b(?:Nume|Nom|Last|name|Prenume|Prenom|Pren\w*|First|CNP|SERIE?|ID|Nationality|Sex|Birth)\b/i;
  const cleanNameValue = value => {
    const words = (String(value || '').match(/[\p{L}][\p{L}'’\-]*/gu) || []).filter(word => !fieldMarker.test(word));
    const meaningfulWords = words.filter(word => word.length > 2);
    if (meaningfulWords.length) return meaningfulWords.join(' ');
    return words.length === 1 ? words[0] : '';
  };
  const isNameValue = value => {
    const candidate = cleanNameValue(value);
    return Boolean(candidate && !fieldMarker.test(candidate) && /^[\p{L}][\p{L}'’ -]{0,79}$/u.test(candidate) && candidate.split(/\s+/).length <= 5);
  };
  const labelPrefix = '^\\s*(?:[iIl|]*\\s*)?';
  const lastNameAliases = '(?:Nume|Nom|Last\\s*name)';
  const firstNameAliases = '(?:Prenume|Prenom|First\\s*name)';
  const lastNamePattern = new RegExp(`${labelPrefix}${lastNameAliases}(?:\\s*[\\/|]\\s*${lastNameAliases})*\\b`, 'i');
  const firstNamePattern = new RegExp(`(?:^|[\\s/|])(?:[iIl|]*\\s*)?${firstNameAliases}(?:\\s*[\\/|]\\s*${firstNameAliases})*\\b`, 'i');
  const fuzzyFirstNamePattern = /^\s*(?:[iIl|]*\s*)?Pren\w{3,}(?:\s+[a-z]{2,8})?\b/i;
  const anyLabelAtStart = new RegExp(`${labelPrefix}(?:Nume|Nom|Last\\s*name|Prenume|Prenom|First\\s*name|CNP|SERIE?|ID|Nationality|Sex|Birth)\\b`, 'i');
  const extractName = (labelPattern, stripPattern, stopPattern, fuzzyPattern = null) => {
    let index = lines.findIndex(line => labelPattern.test(line));
    let fuzzyMatch = false;
    if (index < 0 && fuzzyPattern) {
      index = lines.findIndex(line => fuzzyPattern.test(line));
      fuzzyMatch = index >= 0;
    }
    if (index < 0) return '';
    const labelMatch = lines[index].match(fuzzyMatch ? fuzzyPattern : labelPattern);
    let inline = fuzzyMatch || !labelMatch
      ? ''
      : lines[index].slice(labelMatch.index + labelMatch[0].length).replace(stripPattern, '');
    const nextField = inline.search(stopPattern);
    if (nextField >= 0) inline = inline.slice(0, nextField);
    for (const line of lines.slice(index + 1)) {
      if (anyLabelAtStart.test(line)) break;
      if (fuzzyFirstNamePattern.test(line)) break;
      if (isNameValue(line)) return cleanNameValue(line);
    }
    return isNameValue(inline) ? cleanNameValue(inline) : '';
  };
  const lastName = extractName(
    lastNamePattern,
    /^\s*(?:[iIl|]*\s*)?(?:Nume|Nom|Last\s*name)(?:\s*[\/|]\s*(?:Nume|Nom|Last\s*name))*\s*[:\-]?\s*/i,
    /(?:Prenume|Prenom|First\s*name|CNP|SERIE?|ID)\b/i,
  );
  const firstName = extractName(
    firstNamePattern,
    /^(?:\s|\/|\|)*(?:Prenume|Prenom|First\s*name)(?:\s*[\/|]\s*(?:Prenume|Prenom|First\s*name))*\s*[:\-]?\s*/i,
    /(?:CNP|SERIE?|ID)\b/i,
    fuzzyFirstNamePattern,
  );
  const cnpIndex = lines.findIndex(line => /^\s*C\s*N\s*P\b/i.test(line));
  const cnpLine = cnpIndex < 0 ? '' : lines[cnpIndex];
  const cnpLabel = cnpLine.match(/^\s*C\s*N\s*P\b/i);
  let cnpValue = cnpLabel
    ? cnpLine.slice(cnpLabel.index + cnpLabel[0].length).trim() || lines[cnpIndex + 1] || ''
    : '';
  const nextCnpField = cnpValue.search(/(?:Nume|Nom|Last\s*name|Prenume|Prenom|First\s*name|SERIE?|ID)\b/i);
  if (nextCnpField >= 0) cnpValue = cnpValue.slice(0, nextCnpField);
  const cnpToken = [...cnpValue.matchAll(/[A-Z0-9](?:[\s.-]*[A-Z0-9]){12,23}/gi)]
    .map(match => match[0].replace(/[\s.-]/g, '').toUpperCase())
    .find(value => value.length >= 13 && value.length <= 24 && /\d/.test(value)) || '';
  const cnp = /[A-Z]/i.test(cnpToken) && cnpToken.length > 13 ? cnpToken.slice(0, 13) : cnpToken;
  return { name: [lastName, firstName].filter(Boolean).join(' '), lastName, firstName, cnp };
}
function mergeIdentityCardDetails(primary, retry) {
  return {
    name: primary.name || retry.name,
    lastName: primary.lastName || retry.lastName,
    firstName: primary.firstName || retry.firstName,
    cnp: primary.cnp || retry.cnp
  };
}
function bulletinGifArtworkHtml() {
  return '<img class="bulletin-dot-art" src="/gif.gif" alt="" aria-hidden="true" draggable="false">';
}
function candidateImageFieldHtml(id, label) {
  const isBulletinPhoto = id === 'candidate-document' || id === 'certificate-document';
  const bulletinArtwork = isBulletinPhoto ? bulletinGifArtworkHtml() : '';
  return `<section class="candidate-photo-field" data-photo-field="${id}" data-photo-state="empty"><label class="candidate-document-upload">${label}<input id="${id}" type="file" accept="image/*"></label><div class="image-paste-target${isBulletinPhoto ? ' bulletin-image-target' : ''}" data-paste-for="${id}" tabindex="0" role="button" aria-label="${label}: selectează sau lipește o fotografie">${bulletinArtwork}<span class="candidate-photo-spinner" aria-hidden="true"></span></div><div class="candidate-photo-progress" role="status" aria-live="polite"><span id="${id}-status">Așteaptă fotografia</span></div></section>`;
}
function setCandidatePhotoStatus(id, state, message) {
  const input = document.querySelector(`#${id}`);
  const photoField = input?.closest('.candidate-photo-field');
  const status = document.querySelector(`#${id}-status`);
  if (photoField) photoField.dataset.photoState = state;
  if (status) status.textContent = message;
}
function admissionCandidateDetailsHtml() {
  const photoField = candidateImageFieldHtml;
  return `<section class="admission-candidate-details" aria-labelledby="admission-candidate-title"><h3 id="admission-candidate-title">Date candidat</h3><div class="admission-candidate-grid"><label>Nume și prenume<input id="candidate-name" type="text" autocomplete="name"></label><label>CNP<input id="candidate-cnp" type="text" inputmode="numeric" maxlength="24" autocomplete="off"></label><label>ID candidat<input id="candidate-id" type="text" autocomplete="off"></label><label>Callsign atribuit<input id="candidate-callsign" type="text" placeholder="M-510" autocomplete="off"></label></div><div class="candidate-photo-grid">${photoField('candidate-document', 'Fotografie buletin')}${photoField('candidate-medical-sheet', 'Fotografie fișă medicală')}${photoField('candidate-drug-test', 'Fotografie drug-test')}</div></section>`;
}
function medicalCertificateDetailsHtml() {
  return `<section class="admission-candidate-details" aria-labelledby="medical-certificate-title"><h3 id="medical-certificate-title">Date adeverință</h3><div class="admission-candidate-grid"><label>Nume<input id="certificate-last-name" type="text" autocomplete="family-name"></label><label>Prenume<input id="certificate-first-name" type="text" autocomplete="given-name"></label><label>CNP<input id="certificate-cnp" type="text" inputmode="numeric" maxlength="24" autocomplete="off"></label><label>ID (CNP)<input id="certificate-id" type="text" inputmode="numeric" autocomplete="off"></label><label>Număr de telefon<input id="certificate-phone" type="tel" autocomplete="tel"></label><label>Ore cont<input id="certificate-hours-account" type="number" min="0" step="0.01"></label><label>Ore character<input id="certificate-hours-character" type="number" min="0" step="0.01"></label><label>Apt medical<select id="certificate-medical-status"><option value="Admis">Apt medical</option><option value="Respins">Inapt medical</option></select></label></div><div class="candidate-photo-grid">${candidateImageFieldHtml('certificate-document', 'Fotografie buletin')}${candidateImageFieldHtml('certificate-medical-sheet', 'Fotografie fișă medicală')}</div></section>`;
}
function admissionCandidateSummary(result) {
  const value = selector => document.querySelector(selector)?.value?.trim() || '—';
  const summary = [`Nume candidat: ${value('#candidate-name')}`, `CNP: ${value('#candidate-cnp')}`, `ID: ${value('#candidate-id')}`];
  if (result === 'Admis') summary.push(`Callsign atribuit: ${value('#candidate-callsign')}`);
  summary.push(`Rezultat: ${result}`);
  return summary.join('\n');
}
let identityOcrLibraryPromise;
async function loadIdentityOcr() {
  if (window.Tesseract) return window.Tesseract;
  if (!identityOcrLibraryPromise) identityOcrLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Biblioteca OCR nu este disponibilă.'));
    script.onerror = () => reject(new Error('Biblioteca OCR nu a putut fi încărcată.'));
    document.head.append(script);
  });
  return identityOcrLibraryPromise;
}
async function readIdentityCard(file) {
  const tesseract = await loadIdentityOcr();
  const worker = await tesseract.createWorker('ron+eng');
  try {
    const image = await createImageBitmap(file);
    const sourceX = Math.round(image.width * 0.28);
    const sourceY = Math.round(image.height * 0.15);
    const sourceWidth = Math.round(image.width * 0.43);
    const sourceHeight = Math.round(image.height * 0.4);
    const scale = 4;
    const crop = document.createElement('canvas');
    crop.width = sourceWidth * scale;
    crop.height = sourceHeight * scale;
    const context = crop.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);
    const pixels = context.getImageData(0, 0, crop.width, crop.height);
    const histogram = new Uint32Array(256);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = Math.round(pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114);
      histogram[gray] += 1;
    }
    const pixelCount = pixels.data.length / 4;
    let sum = 0;
    for (let value = 0; value < histogram.length; value += 1) sum += value * histogram[value];
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let threshold = 170;
    let maxVariance = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = pixelCount - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const meanBackground = backgroundSum / backgroundWeight;
      const meanForeground = (sum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = value;
      }
    }
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = Math.round(pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114);
      const color = gray > threshold ? 255 : 0;
      pixels.data[index] = color;
      pixels.data[index + 1] = color;
      pixels.data[index + 2] = color;
    }
    context.putImageData(pixels, 0, 0);
    image.close();
    await worker.setParameters({ tessedit_pageseg_mode: 6, preserve_interword_spaces: '1' });
    const focusedText = (await worker.recognize(crop)).data.text;
    const details = parseIdentityCardText(focusedText);
    return { ...details, name: [details.lastName, details.firstName].filter(Boolean).join(' ') };
  } finally {
    await worker.terminate();
  }
}
async function encodeIdentityPhoto(file) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.8, 0.66, 0.52, 0.4]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 600 * 1024) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Fotografia nu a putut fi pregătită pentru trimitere.'));
        reader.readAsDataURL(blob);
      });
    }
  }
  throw new Error('Fotografia este prea mare pentru trimitere. Încarcă o imagine mai mică.');
}
function buildTestMarkup(testName, definition, questions) {
  const isAdmissionTest = testName === 'Test admitere';
  const isTransferTest = testName === 'Test transfer';
  const isAlsTest = testName === 'Test ALS';
  const isMotoTest = testName === 'Test MOTO';
  const isParachutismTest = testName === 'Test parașutiști';
  const isSmulsTest = testName === 'Test SMULS';
  const isPilotTest = testName === 'Test PILOT';
  const isMedicalCertificate = testName === 'Adeverință medicală';
  const isApplicationTest = isAdmissionTest || testName === 'Test transfer';
  const isStagedTest = ['Test PILOT', 'Test MOTO', 'Test SMULS', 'Test ALS'].includes(testName);
  const maxWrong = maxWrongForTest(testName, definition.maxWrong);
  const candidateDetails = isApplicationTest ? admissionCandidateDetailsHtml() : isMedicalCertificate ? medicalCertificateDetailsHtml() : '';
  const admissionChecks = isAdmissionTest ? admissionChecklistHtml() : '';
  const transferChecks = isTransferTest ? admissionChecklistHtml() : '';
  const motoChecks = isMotoTest ? motoChecklistHtml() : '';
  const parachutismChecks = isParachutismTest ? parachutismChecklistHtml(definition.eligibilityCriteria) : '';
  const parachutismInformation = isParachutismTest ? parachutismInformationHtml(definition) : '';
  const description = isAdmissionTest ? 'Candidatul poate greși de maximum 3 ori; la a 4-a greșeală este respins. Promovare: minimum 17/20.' : definition.description;
  const images = (definition.images || []).map(image => `<a class="test-image-link${image.inline ? ' test-image-preview' : ''}" href="${image.url}" target="_blank" rel="noopener">${image.inline ? `<img src="${image.url}" alt="${escapeHtml(image.label || testName)}">` : image.label || 'Deschide imaginea'}</a>`).join('');
  const cases = isSmulsTest || isAlsTest ? '' : (definition.cases || []).map((item, index) => `<option value="${index}">${item.title}</option>`).join('');
  const parachutismPracticalOptions = (definition.practical || []).map((item, index) => `<option value="${index}">${item.name}</option>`).join('');
  const practical = isParachutismTest ? '' : parachutismPracticalOptions;
  const parachutismPracticalStage = isParachutismTest && parachutismPracticalOptions
    ? `<section class="parachutism-practical-stage" id="parachutism-practical-stage" hidden><h3>Probe practice de parașutism</h3><div id="practical-steps" class="parachutism-case-list"></div><div class="evaluation-stage-actions"><button type="button" class="primary evaluation-verdict evaluation-verdict-admitted" data-parachutism-final-result="Admis">Admis Test Parasutism</button><button type="button" class="primary evaluation-verdict evaluation-verdict-rejected" data-parachutism-final-result="Respins">Respins Test Parasutism</button></div></section>`
    : '';
  const candidateCallsign = isApplicationTest || isMedicalCertificate ? '' : '<label class="candidate-call-sign">Callsign candidat<input id="candidate-callsign" type="text" placeholder="510 sau M-510"></label>';
  const candidateNameField = ['Test ALS', 'Test SMULS', 'Test MOTO', 'Test PILOT', 'Test parașutiști'].includes(testName) ? '<label class="candidate-call-sign">Nume candidat<input id="als-candidate-name" type="text" autocomplete="name" readonly placeholder="Se completează după callsign"></label>' : '';
  const candidateIdentityFields = candidateCallsign && candidateNameField
    ? `<div class="candidate-identity-fields">${candidateCallsign}${candidateNameField}</div>`
    : `${candidateCallsign}${candidateNameField}`;
  const candidateIdentityBeforeChecks = isMotoTest || isSmulsTest || isAlsTest || isParachutismTest || isPilotTest ? candidateIdentityFields : '';
  const candidateIdentityInQuiz = isMotoTest || isSmulsTest || isAlsTest || isParachutismTest || isPilotTest ? '' : candidateIdentityFields;
  const stagedCandidateSummary = isSmulsTest || isAlsTest || isParachutismTest || isPilotTest ? '<div id="candidate-summary" class="candidate-summary"></div>' : '';
  const smulsChecks = isSmulsTest ? smulsChecklistHtml() : '';
  const alsChecks = isAlsTest ? alsChecklistHtml() : '';
  const evaluationActions = testName === 'Test PILOT'
    ? '<div class="evaluation-stage-actions"><button class="primary evaluation-verdict evaluation-verdict-admitted" type="submit" data-pilot-theory-result="Admis">Admis Proba Teoretică</button><button class="primary evaluation-verdict evaluation-verdict-rejected" type="submit" data-pilot-theory-result="Respins">Respins Proba Teoretică</button></div>'
    : isMotoTest
      ? '<div class="evaluation-stage-actions"><button class="primary evaluation-verdict evaluation-verdict-admitted" type="submit" data-moto-theory-result="Admis">Admis Proba Teoretică</button><button class="primary evaluation-verdict evaluation-verdict-rejected" type="submit" data-moto-theory-result="Respins">Respins Proba Teoretică</button></div>'
      : isParachutismTest
        ? '<div class="evaluation-stage-actions"><button class="primary evaluation-verdict evaluation-verdict-admitted" type="submit" data-parachutism-theory-result="Admis">Admis Test Teoretic</button><button class="primary evaluation-verdict evaluation-verdict-rejected" type="submit" data-parachutism-theory-result="Respins">Respins Test Teoretic</button></div>'
    : '<button class="primary" type="submit">Finalizează evaluarea</button>';
  const candidateDocument = !isApplicationTest && !isMedicalCertificate && testName === 'Adeverință medicală' ? '<label>Imagine document candidat<input id="candidate-document" type="file" accept="image/*"></label><p class="muted">Imaginea este disponibilă testerului pentru verificare manuală.</p>' : '';
  const questionForm = isAlsTest || isSmulsTest ? '' : questions.length ? `<form id="test-form" class="question-list">${candidateIdentityInQuiz}${stagedCandidateSummary ? '' : '<div id="candidate-summary" class="candidate-summary"></div>'}${candidateDocument}${questions.map((question, index) => questionItemHtml(question, index, !isMedicalCertificate)).join('')}${isMedicalCertificate ? '' : `<p>Greșeli: <strong id="wrong-count">0</strong> / ${Number.isFinite(maxWrong) ? maxWrong : '—'}</p>`}${evaluationActions}</form>` : '<div class="test-runner"><p>Acest ghid nu are întrebări teoretice configurate.</p></div>';
  const gatedQuestionForm = (isAdmissionTest || isTransferTest || isMotoTest || isSmulsTest || isAlsTest || isParachutismTest || isPilotTest) && questions.length ? `<div id="${isAdmissionTest ? 'admission-test-content' : isTransferTest ? 'transfer-test-content' : isMotoTest ? 'moto-test-content' : isSmulsTest ? 'smuls-test-content' : isAlsTest ? 'als-test-content' : isParachutismTest ? 'parachutism-test-content' : 'pilot-test-content'}" hidden>${questionForm}</div>` : questionForm;
  const evaluationStageFlow = ['Test PILOT', 'Test MOTO', 'Test SMULS', 'Test ALS'].includes(testName) ? '<div id="evaluation-stage-flow" hidden></div>' : '';
  const parachutismResultStageFlow = isParachutismTest ? '<div id="evaluation-stage-flow" hidden></div>' : '';
  const instructions = isAdmissionTest || testName === 'Test transfer' || isMedicalCertificate || !definition.instructions ? '' : `<p class="test-instructions">${definition.instructions}</p>`;
  const introBoxClass = testName === 'Test PILOT' ? 'pilot-intro-box' : isMotoTest ? 'moto-intro-box' : isSmulsTest ? 'smuls-intro-box' : 'als-intro-box';
  const testIntro = isStagedTest ? `<div class="${introBoxClass}"><p class="muted">${description}</p>${instructions}</div>` : `<p class="muted">${description}</p>${instructions}`;
  const motoBriefing = isMotoTest ? motoCandidateBriefingHtml(definition.candidateBriefing) : '';
  const guideBody = `${candidateDetails}${admissionChecks}${transferChecks}${testIntro}${candidateIdentityBeforeChecks}${stagedCandidateSummary}${alsChecks}${motoChecks}${smulsChecks}${parachutismChecks}${parachutismInformation}${motoBriefing}${cases ? `<label>Cazul ales de candidat<select id="case-select">${cases}</select></label><div id="case-steps" class="case-steps"></div>` : ''}${practical ? `<label>Probă practică<select id="practical-select">${practical}</select><div id="practical-steps" class="case-steps"></div>` : ''}${gatedQuestionForm}${isSmulsTest || isAlsTest || isParachutismTest ? '' : evaluationStageFlow}`;
  const content = isSmulsTest || isAlsTest || isParachutismTest
    ? guideBody
    : testName === 'Test SMULS' && images
    ? `<div class="test-with-map"><div class="test-main-column">${guideBody}</div><aside class="test-map-column">${images}</aside></div>`
    : `${guideBody}${images ? `<div class="test-images">${images}</div>` : ''}`;
  const testAccessControl = testAccessMarkup(testName);
  const headerActions = `<div class="test-guide-header-actions">${testAccessControl}<button class="outline" id="back-to-tests">← Înapoi</button></div>`;
  return `<div class="panel view-panel"><div class="panel-head"><div><p class="eyebrow">GHID PENTRU TESTER</p><h2>${displayTestName(testName)}</h2></div>${headerActions}</div>${content}${isSmulsTest || isAlsTest ? evaluationStageFlow : ''}${parachutismResultStageFlow}${parachutismPracticalStage}</div>`;
}
function wireTestEvents(testName, definition) {
  const isAdmissionTest = testName === 'Test admitere';
  const isTransferTest = testName === 'Test transfer';
  const isPilotTest = testName === 'Test PILOT';
  const isAlsTest = testName === 'Test ALS';
  const isMotoTest = testName === 'Test MOTO';
  const isParachutismTest = testName === 'Test parașutiști';
  const isSmulsTest = testName === 'Test SMULS';
  const isMedicalCertificate = testName === 'Adeverință medicală';
  const isApplicationTest = isAdmissionTest || testName === 'Test transfer';
  let candidateCooldowns = {};
  let candidateCooldownMessage = '';
  document.querySelector('#back-to-tests').onclick = () => {
    if (window.history.state?.view === 'test') window.history.back();
    else navigateTo('overview');
  };
  if (isApplicationTest || isMedicalCertificate) {
    if (isAdmissionTest || isTransferTest) {
      const checks = [...document.querySelectorAll('[data-admission-check]')];
      const testContent = document.querySelector(isAdmissionTest ? '#admission-test-content' : '#transfer-test-content');
      const updateAdmissionGate = () => {
        const complete = admissionChecksComplete(checks.map(check => check.checked));
        checks.forEach(check => { check.closest('.admission-check-row').classList.toggle('is-incomplete', !check.checked); });
        if (testContent) testContent.hidden = !complete;
      };
      checks.forEach(check => check.onchange = updateAdmissionGate);
      updateAdmissionGate();
    }
    const imageFields = isMedicalCertificate
      ? [{ id: 'certificate-document', readIdentity: true }, { id: 'certificate-medical-sheet' }]
      : [{ id: 'candidate-document', readIdentity: true }, { id: 'candidate-medical-sheet' }, { id: 'candidate-drug-test' }];
    for (const field of imageFields) {
      const input = document.querySelector(`#${field.id}`);
      const pasteTarget = document.querySelector(`[data-paste-for="${field.id}"]`);
      const status = document.querySelector(`#${field.id}-status`);
      if (!input || !pasteTarget || !status) continue;
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { setCandidatePhotoStatus(field.id, 'empty', 'Așteaptă fotografia'); return; }
        status.classList.remove('error-text');
        if (!field.readIdentity) {
          setCandidatePhotoStatus(field.id, 'ready', 'Fotografie pregătită pentru trimitere.');
          return;
        }
        if (isMedicalCertificate) {
          document.querySelector('#certificate-last-name').value = '';
          document.querySelector('#certificate-first-name').value = '';
          document.querySelector('#certificate-cnp').value = '';
        } else {
          document.querySelector('#candidate-name').value = '';
          document.querySelector('#candidate-cnp').value = '';
        }
        setCandidatePhotoStatus(field.id, 'loading', 'Se citește buletinul...');
        try {
          const details = await readIdentityCard(file);
          if (isMedicalCertificate) {
            if (details.lastName) document.querySelector('#certificate-last-name').value = details.lastName;
            if (details.firstName) document.querySelector('#certificate-first-name').value = details.firstName;
            if (details.cnp) document.querySelector('#certificate-cnp').value = details.cnp;
          } else {
            if (details.name) document.querySelector('#candidate-name').value = details.name;
            if (details.cnp) document.querySelector('#candidate-cnp').value = details.cnp;
          }
          setCandidatePhotoStatus(field.id, 'ready', details.name || details.cnp
            ? 'Datele au fost completate automat. Verifică-le înainte de continuare.'
            : 'Fotografie pregătită; completează datele manual.');
        } catch (error) {
          console.error('Identity card OCR failed:', error);
          setCandidatePhotoStatus(field.id, 'ready', 'Fotografie pregătită; citirea automată nu este disponibilă.');
        }
      };
      pasteTarget.onclick = () => pasteTarget.focus();
      pasteTarget.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
      };
      pasteTarget.onpaste = event => {
        const item = [...(event.clipboardData?.items || [])].find(clipboardItem => clipboardItem.type.startsWith('image/'));
        const file = item?.getAsFile();
        if (!file) return;
        event.preventDefault();
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
    }
  }
  if (isMotoTest) {
    const checks = [...document.querySelectorAll('[data-moto-check]')];
    const testContent = document.querySelector('#moto-test-content');
    const updateMotoGate = () => {
      const checked = checks.map(check => check.checked);
      const candidateComplete = Boolean(document.querySelector('#candidate-callsign')?.value.trim() && document.querySelector('#als-candidate-name')?.value.trim());
      const complete = motoChecksComplete(checked) && candidateComplete && !candidateCooldownMessage;
      checks.forEach(check => { check.closest('.admission-check-row').classList.toggle('is-incomplete', !check.checked); });
      if (testContent) testContent.hidden = !complete;
    };
    checks.forEach(check => check.onchange = updateMotoGate);
    updateMotoGate();
  }
  let refreshSmulsStageGate = () => {};
  if (isSmulsTest) {
    const checks = [...document.querySelectorAll('[data-smuls-check]')];
    const stageFlow = document.querySelector('#evaluation-stage-flow');
    let stageOpened = false;
    const finishSmulsTest = async finalResult => {
      stageFlow.querySelectorAll('button').forEach(button => { button.disabled = true; });
      stageFlow.innerHTML = '<p class="muted">Se înregistrează rezultatul...</p>';
      const candidateCallsign = document.querySelector('#candidate-callsign')?.value?.trim() || '';
      const candidateName = document.querySelector('#als-candidate-name')?.value?.trim() || '';
      try {
        const saved = await recordTestRun(testName, finalResult, { candidateCallsign, candidateName });
        const notificationStatus = saved.discordNotificationsSent ? 'Notificarea Discord a fost trimisă.' : `Notificarea Discord nu a fost trimisă. ${saved.discordNotificationError || ''}`;
        stageFlow.innerHTML = `<pre class="candidate-summary">Test: ${escapeHtml(displayTestName(testName))}\nCandidat: ${escapeHtml(candidateName)}\nCallsign: ${escapeHtml(candidateCallsign)}\nRezultat: ${finalResult}</pre><p class="muted">Testul a fost înregistrat. ${escapeHtml(notificationStatus)}</p>`;
      } catch (error) {
        stageFlow.innerHTML = `<p class="error-text">Rezultatul nu s-a putut înregistra: ${escapeHtml(error.message)}</p>`;
      }
    };
    const showOffroadStage = () => {
      const verdicts = [
        { result: 'Admis', text: 'Admis test SMULS' },
        { result: 'Respins', text: 'Respins test SMULS' }
      ];
      const offroadCard = evaluationStageHtml(definition.practicalStage, verdicts);
      const routeImages = (definition.images || []).map(image => `<a class="test-image-link${image.inline ? ' test-image-preview' : ''}" href="${escapeHtml(image.url)}" target="_blank" rel="noopener">${image.inline ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.label || testName)}">` : escapeHtml(image.label || 'Deschide imaginea')}</a>`).join('');
      stageFlow.innerHTML = routeImages
        ? `<div class="smuls-offroad-layout"><div>${offroadCard}</div><aside class="test-map-column">${routeImages}</aside></div>`
        : offroadCard;
      stageFlow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      stageFlow.querySelectorAll('[data-evaluation-result]').forEach(button => button.onclick = async () => finishSmulsTest(button.dataset.evaluationResult));
    };
    refreshSmulsStageGate = () => {
      const complete = smulsChecksComplete(checks.map(check => check.checked));
      checks.forEach(check => check.closest('.admission-check-row').classList.toggle('is-incomplete', !check.checked));
      if (!complete || stageOpened) return;
      const candidateCallsign = document.querySelector('#candidate-callsign')?.value?.trim() || '';
      const candidateName = document.querySelector('#als-candidate-name')?.value?.trim() || '';
      const summary = document.querySelector('#candidate-summary');
      if (!candidateCallsign || !candidateName) {
        if (summary) summary.textContent = 'Completează callsign-ul candidatului înainte de continuare.';
        return;
      }
      if (candidateCooldownMessage) { if (summary) summary.textContent = candidateCooldownMessage; return; }
      stageOpened = true;
      checks.forEach(check => { check.disabled = true; });
      document.querySelector('#candidate-callsign').disabled = true;
      document.querySelector('#als-candidate-name').disabled = true;
      document.querySelector('.view-panel')?.classList.add('smuls-stage-active');
      stageFlow.hidden = false;
      stageFlow.innerHTML = smulsCaseListHtml(definition.cases, definition.descarcerationImages);
      stageFlow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      stageFlow.querySelectorAll('[data-smuls-descarceration-result]').forEach(button => button.onclick = async () => {
        if (button.dataset.smulsDescarcerationResult === 'Respins') await finishSmulsTest('Respins');
        else showOffroadStage();
      });
    };
    checks.forEach(check => check.onchange = refreshSmulsStageGate);
    refreshSmulsStageGate();
  }
  let refreshAlsStageGate = () => {};
  if (isAlsTest) {
    const checks = [...document.querySelectorAll('[data-als-check]')];
    const stageFlow = document.querySelector('#evaluation-stage-flow');
    let stageOpened = false;
    const finishAlsTest = async finalResult => {
      stageFlow.querySelectorAll('button').forEach(button => { button.disabled = true; });
      stageFlow.innerHTML = '<p class="muted">Se înregistrează rezultatul...</p>';
      const candidateCallsign = document.querySelector('#candidate-callsign')?.value?.trim() || '';
      const candidateName = document.querySelector('#als-candidate-name')?.value?.trim() || '';
      try {
        const saved = await recordTestRun(testName, finalResult, { candidateCallsign, candidateName });
        const notificationStatus = saved.discordNotificationsSent ? 'Notificarea Discord a fost trimisă.' : `Notificarea Discord nu a fost trimisă. ${saved.discordNotificationError || ''}`;
        stageFlow.innerHTML = `<pre class="candidate-summary">Test: ${escapeHtml(displayTestName(testName))}\nCandidat: ${escapeHtml(candidateName)}\nCallsign: ${escapeHtml(candidateCallsign)}\nRezultat: ${finalResult}</pre><p class="muted">Testul a fost înregistrat. ${escapeHtml(notificationStatus)}</p>`;
      } catch (error) {
        stageFlow.innerHTML = `<p class="error-text">Rezultatul nu s-a putut înregistra: ${escapeHtml(error.message)}</p>`;
      }
    };
    refreshAlsStageGate = () => {
      const complete = alsChecksComplete(checks.map(check => check.checked));
      checks.forEach(check => check.closest('.admission-check-row').classList.toggle('is-incomplete', !check.checked));
      if (!complete || stageOpened) return;
      const candidateCallsign = document.querySelector('#candidate-callsign')?.value?.trim() || '';
      const candidateName = document.querySelector('#als-candidate-name')?.value?.trim() || '';
      const summary = document.querySelector('#candidate-summary');
      if (!candidateCallsign || !candidateName) {
        if (summary) summary.textContent = 'Completează callsign-ul candidatului înainte de continuare.';
        return;
      }
      if (candidateCooldownMessage) { if (summary) summary.textContent = candidateCooldownMessage; return; }
      stageOpened = true;
      checks.forEach(check => { check.disabled = true; });
      document.querySelector('#candidate-callsign').disabled = true;
      document.querySelector('#als-candidate-name').disabled = true;
      document.querySelector('.view-panel')?.classList.add('als-stage-active');
      stageFlow.hidden = false;
      stageFlow.innerHTML = alsCaseListHtml(definition.cases);
      stageFlow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      stageFlow.querySelectorAll('[data-als-result]').forEach(button => button.onclick = async () => finishAlsTest(button.dataset.alsResult));
    };
    checks.forEach(check => check.onchange = refreshAlsStageGate);
    refreshAlsStageGate();
  }
  const caseSelect = document.querySelector('#case-select'); const caseSteps = document.querySelector('#case-steps');
  const renderCase = () => { if (!caseSelect || !caseSteps) return; const item = definition.cases[Number(caseSelect.value)]; caseSteps.innerHTML = `<h3>${item.title}</h3><p>Minimum interacțiuni: ${item.minimumMe || 0} /me</p><ol>${item.steps.map(step => `<li>${step}</li>`).join('')}</ol>`; }; if (caseSelect) { caseSelect.onchange = renderCase; renderCase(); }
  const practicalSelect = document.querySelector('#practical-select'); const practicalSteps = document.querySelector('#practical-steps');
  let openParachutismCase = 0;
  const renderPractical = () => {
    if (isParachutismTest && practicalSteps) {
      practicalSteps.innerHTML = (definition.practical || []).map((item, caseIndex) => {
        const imageSlots = Array.from({ length: Number(item.imageSlots) || 0 }, (_, imageIndex) => {
          const imageUrl = item.images?.[imageIndex]?.url;
          const preview = imageUrl ? `<img src="${imageUrl}" alt="Fotografie ${imageIndex + 1} pentru ${escapeHtml(item.name)}">` : `<span class="parachutism-photo-empty">Imagine ${imageIndex + 1}</span>`;
          return `<div class="evaluation-stage-image-slot parachutism-photo-slot" role="img" aria-label="Imagine ${imageIndex + 1} pentru ${escapeHtml(item.name)}">${preview}</div>`;
        }).join('');
        return `<details class="als-case parachutism-case" data-parachutism-case-card="${caseIndex}"${caseIndex === openParachutismCase ? ' open' : ''}><summary>${escapeHtml(item.name)}</summary><div class="als-case-content"><p><b>Locație:</b> ${escapeHtml(item.location)}</p><p><b>Altitudine:</b> ${escapeHtml(item.altitude)}</p><p><b>Aterizare:</b> ${escapeHtml(item.landing)}</p><div class="parachutism-photo-grid" aria-label="Fotografii pentru ${escapeHtml(item.name)}">${imageSlots}</div></div></details>`;
      }).join('');
      return;
    }
    if (!practicalSelect || !practicalSteps) return;
    const item = definition.practical[Number(practicalSelect.value)];
    practicalSteps.innerHTML = `<h3>${item.name}</h3><p><b>Locație:</b> ${item.location}</p><p><b>Altitudine:</b> ${item.altitude}</p><p><b>Aterizare:</b> ${item.landing}</p>${(item.images || []).map(image => `<a class="test-image-link" href="${image.url}" target="_blank" rel="noopener">${image.label || 'Imagine traseu'}</a>`).join('')}`;
  };
  if (isParachutismTest && practicalSteps) {
    renderPractical();
    practicalSteps.addEventListener('toggle', event => {
      const caseCard = event.target.closest('[data-parachutism-case-card]');
      if (caseCard?.open) openParachutismCase = Number(caseCard.dataset.parachutismCaseCard);
    }, true);
  } else if (practicalSelect) {
    practicalSelect.onchange = renderPractical;
    renderPractical();
  }
  const wrongInputs = [...document.querySelectorAll('[data-wrong]')];
  wrongInputs.forEach(input => input.onchange = () => {
    const wrongCount = wrongInputs.filter(item => item.checked).length;
    const count = document.querySelector('#wrong-count');
    if (count) count.textContent = wrongCount;
    const limitExceeded = wrongCount > maxWrongForTest(testName, definition.maxWrong);
    if (limitExceeded) {
      wrongInputs.forEach(item => { item.disabled = true; });
      const rejectedButton = document.querySelector(`[data-pilot-theory-result="Respins"], [data-moto-theory-result="Respins"], [data-parachutism-theory-result="Respins"]`);
      const form = document.querySelector('#test-form');
      if (form && rejectedButton) form.requestSubmit(rejectedButton);
      else form?.requestSubmit();
    }
  });
  const candidateInput = document.querySelector('#candidate-callsign'); const candidateSummaryEl = document.querySelector('#candidate-summary'); const alsCandidateNameInput = document.querySelector('#als-candidate-name');
  let candidateLookupTimer;
  let candidateLookupSequence = 0;
  let refreshParachutismTheoryGate = () => {};
  let refreshPilotTheoryGate = () => {};
  if (candidateInput && !isApplicationTest) candidateInput.oninput = () => {
    const sequence = ++candidateLookupSequence;
    clearTimeout(candidateLookupTimer);
    const callsign = candidateInput.value.trim();
    candidateCooldowns = {};
    candidateCooldownMessage = '';
    if (isPilotTest) { const content = document.querySelector('#pilot-test-content'); if (content) content.hidden = true; }
    if (isMotoTest) { const content = document.querySelector('#moto-test-content'); if (content) content.hidden = true; }
    if (alsCandidateNameInput) alsCandidateNameInput.value = '';
    if (!callsignNumber(callsign)) { if (candidateSummaryEl) candidateSummaryEl.textContent = ''; refreshParachutismTheoryGate(); refreshPilotTheoryGate(); return; }
    if (candidateSummaryEl) candidateSummaryEl.textContent = 'Se caută candidatul…';
    candidateLookupTimer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ requesterId: currentUser.discordId, callsign });
        const response = await fetch(`/api/access/directory?${query}`);
        const payload = await parseApiResponse(response);
        if (sequence !== candidateLookupSequence) return;
        if (!response.ok) throw new Error(payload.error || 'Numele candidatului nu a putut fi căutat.');
        const candidate = payload.candidate;
        if (!candidate) {
          if (candidateSummaryEl) candidateSummaryEl.textContent = 'Nu a fost găsit un candidat cu acest callsign.';
          refreshParachutismTheoryGate();
          return;
        }
        if (alsCandidateNameInput) alsCandidateNameInput.value = candidate.name;
        candidateCooldowns = candidate.cooldowns || {};
        if (candidateSummaryEl) candidateSummaryEl.textContent = `Candidat: @[${normalizeCallsign(candidate.callsign)}] ${candidate.name}`;
        const activeCooldown = candidateCooldowns[testName];
        if (activeCooldown && activeCooldown > Date.now()) {
          const expiryDate = new Date(activeCooldown).toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric' });
          candidateCooldownMessage = `CD activ pentru ${displayTestName(testName)} până pe ${expiryDate}. Testarea nu poate continua.`;
          if (candidateSummaryEl) candidateSummaryEl.textContent += `\n${candidateCooldownMessage}`;
        }
        if (isSmulsTest) refreshSmulsStageGate();
        if (isAlsTest) refreshAlsStageGate();
        if (isParachutismTest) refreshParachutismTheoryGate();
        if (isPilotTest) refreshPilotTheoryGate();
        if (isMotoTest) {
          const checks = [...document.querySelectorAll('[data-moto-check]')];
          const testContent = document.querySelector('#moto-test-content');
          if (testContent && candidateCooldownMessage) testContent.hidden = true;
          else if (testContent) testContent.hidden = !motoChecksComplete(checks.map(check => check.checked)) || !candidate.name;
        }
      } catch (error) {
        if (sequence === candidateLookupSequence && candidateSummaryEl) candidateSummaryEl.textContent = error.message;
        if (sequence === candidateLookupSequence && isParachutismTest) refreshParachutismTheoryGate();
      }
    }, 300);
  };
  if (isParachutismTest) {
    const checks = [...document.querySelectorAll('[data-parachutism-check]')];
    const testContent = document.querySelector('#parachutism-test-content');
    refreshParachutismTheoryGate = () => {
      const criteriaComplete = checks.length === 2 && checks.every(check => check.checked);
      const candidateComplete = Boolean(candidateInput?.value.trim() && alsCandidateNameInput?.value.trim());
      checks.forEach(check => check.closest('.admission-check-row')?.classList.toggle('is-incomplete', !check.checked));
      if (testContent) testContent.hidden = !(criteriaComplete && candidateComplete) || Boolean(candidateCooldownMessage);
      if (criteriaComplete && !candidateComplete && candidateSummaryEl) candidateSummaryEl.textContent = 'Completează callsign-ul și verifică identitatea candidatului înainte de proba teoretică.';
    };
    checks.forEach(check => check.onchange = refreshParachutismTheoryGate);
    refreshParachutismTheoryGate();
  }
  if (isPilotTest) {
    const testContent = document.querySelector('#pilot-test-content');
    refreshPilotTheoryGate = () => {
      const candidateComplete = Boolean(candidateInput?.value.trim() && alsCandidateNameInput?.value.trim());
      if (testContent) testContent.hidden = !candidateComplete || Boolean(candidateCooldownMessage);
      if (!candidateComplete && candidateSummaryEl && candidateInput?.value.trim()) candidateSummaryEl.textContent = 'Verifică callsign-ul candidatului înainte de proba teoretică.';
    };
    refreshPilotTheoryGate();
  }
  const form = document.querySelector('#test-form'); if (form) form.onsubmit = async event => {
    event.preventDefault();
    if (testName === 'Test PILOT' && !event.submitter?.dataset.pilotTheoryResult) return;
    if (isMotoTest && !event.submitter?.dataset.motoTheoryResult) return;
    if (isParachutismTest && !event.submitter?.dataset.parachutismTheoryResult) return;
    const wrong = wrongInputs.filter(item => item.checked).length;
    const limit = maxWrongForTest(testName, definition.maxWrong);
    const result = isMedicalCertificate
      ? document.querySelector('#certificate-medical-status').value
      : isTestFailed(wrong, limit) ? 'Respins' : 'Admis';
    const member = directoryMembers.find(item => normalizeCallsign(item.callsign) === normalizeCallsign(candidateInput?.value));
    let submissionDetails = {};
    let status = 'Testul a fost înregistrat.';
    if (isApplicationTest) {
      const candidateName = document.querySelector('#candidate-name').value.trim();
      const candidateId = document.querySelector('#candidate-id').value.trim();
      const candidateCallsign = document.querySelector('#candidate-callsign').value.trim();
      const identityPhoto = document.querySelector('#candidate-document').files?.[0];
      const medicalSheetPhoto = document.querySelector('#candidate-medical-sheet').files?.[0];
      const drugTestPhoto = document.querySelector('#candidate-drug-test').files?.[0];
      const statusElement = document.querySelector('#candidate-document-status');
      if (!candidateName || !candidateId || !identityPhoto || !medicalSheetPhoto || !drugTestPhoto || (result === 'Admis' && !candidateCallsign)) {
        statusElement.textContent = 'Completează numele și ID-ul, încarcă buletinul, fișa medicală și drug-testul; callsign-ul este necesar la Admis.';
        statusElement.classList.add('error-text');
        return;
      }
      for (const id of ['candidate-document', 'candidate-medical-sheet', 'candidate-drug-test']) setCandidatePhotoStatus(id, 'loading', 'Se pregătește fotografia pentru trimitere...');
      try {
        const [identityImage, medicalSheetImage, drugTestImage] = await Promise.all([
          encodeIdentityPhoto(identityPhoto),
          encodeIdentityPhoto(medicalSheetPhoto),
          encodeIdentityPhoto(drugTestPhoto)
        ]);
        submissionDetails = { candidateName, candidateId, candidateCallsign, identityImage, medicalSheetImage, drugTestImage };
        for (const id of ['candidate-document', 'candidate-medical-sheet', 'candidate-drug-test']) setCandidatePhotoStatus(id, 'ready', 'Fotografie pregătită pentru trimitere.');
      } catch (error) {
        setCandidatePhotoStatus('candidate-document', 'error', error.message);
        statusElement.classList.add('error-text');
        return;
      }
    } else if (isMedicalCertificate) {
      const lastName = document.querySelector('#certificate-last-name').value.trim();
      const firstName = document.querySelector('#certificate-first-name').value.trim();
      const candidateId = document.querySelector('#certificate-id').value.trim();
      const phone = document.querySelector('#certificate-phone').value.trim();
      const hoursAccount = document.querySelector('#certificate-hours-account').value.trim();
      const hoursCharacter = document.querySelector('#certificate-hours-character').value.trim();
      const identityPhoto = document.querySelector('#certificate-document').files?.[0];
      const medicalSheetPhoto = document.querySelector('#certificate-medical-sheet').files?.[0];
      const statusElement = document.querySelector('#certificate-document-status');
      if (!lastName || !firstName || !candidateId || !phone || !hoursAccount || !hoursCharacter || !identityPhoto || !medicalSheetPhoto) {
        statusElement.textContent = 'Completează toate rubricile și încarcă buletinul și fișa medicală.';
        statusElement.classList.add('error-text');
        return;
      }
      try {
        const [identityImage, medicalSheetImage] = await Promise.all([encodeIdentityPhoto(identityPhoto), encodeIdentityPhoto(medicalSheetPhoto)]);
        submissionDetails = { lastName, firstName, candidateId, phone, hoursAccount, hoursCharacter, medicalStatus: result, identityImage, medicalSheetImage };
      } catch (error) {
        statusElement.textContent = error.message;
        statusElement.classList.add('error-text');
        return;
      }
    } else if (['Test ALS', 'Test SMULS', 'Test MOTO', 'Test PILOT', 'Test parașutiști'].includes(testName)) {
      const candidateCallsign = candidateInput?.value?.trim() || '';
      const candidateName = alsCandidateNameInput?.value?.trim() || '';
      if (!candidateCallsign || !candidateName) {
        candidateSummaryEl.textContent = 'Completează callsign-ul și numele candidatului.';
        candidateSummaryEl.classList.add('error-text');
        return;
      }
      submissionDetails = { candidateCallsign, candidateName };
    }
    if (isParachutismTest) {
      const practicalStage = document.querySelector('#parachutism-practical-stage');
      const stageFlow = document.querySelector('#evaluation-stage-flow');
      const reportParachutismResult = async finalResult => {
        practicalStage.querySelectorAll('button').forEach(button => { button.disabled = true; });
        stageFlow.querySelectorAll('button').forEach(button => { button.disabled = true; });
        const output = finalResult === 'Respins' && !practicalStage.hidden ? practicalStage : stageFlow;
        output.innerHTML = '<p class="muted">Se înregistrează rezultatul...</p>';
        try {
          const saved = await recordTestRun(testName, finalResult, submissionDetails);
          const candidateCallsign = submissionDetails.candidateCallsign || '—';
          const candidateName = submissionDetails.candidateName || '—';
          const notificationStatus = saved.discordNotificationsSent ? 'Notificarea Discord a fost trimisă.' : `Notificarea Discord nu a fost trimisă. ${saved.discordNotificationError || ''}`;
          output.innerHTML = `<pre class="candidate-summary">Test: ${escapeHtml(displayTestName(testName))}\nCandidat: ${escapeHtml(candidateName)}\nCallsign: ${escapeHtml(candidateCallsign)}\nRezultat: ${finalResult}</pre><p class="muted">Testul a fost înregistrat. ${escapeHtml(notificationStatus)}</p>`;
        } catch (error) {
          output.innerHTML = `<p class="error-text">Rezultatul nu s-a putut înregistra: ${escapeHtml(error.message)}</p>`;
        }
      };
      const theoryResult = event.submitter.dataset.parachutismTheoryResult;
      form.hidden = true;
      if (theoryResult === 'Respins') {
        stageFlow.hidden = false;
        await reportParachutismResult('Respins');
        return;
      }
      if (wrongInputs.filter(item => item.checked).length > maxWrongForTest(testName, definition.maxWrong)) {
        form.hidden = false;
        return;
      }
      document.querySelector('.view-panel')?.classList.add('parachutism-stage-active');
      practicalStage.hidden = false;
      practicalStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      practicalStage.querySelectorAll('[data-parachutism-final-result]').forEach(button => {
        button.onclick = async () => {
          await reportParachutismResult(button.dataset.parachutismFinalResult);
        };
      });
      return;
    }
    if (testName === 'Test PILOT' || isMotoTest || isSmulsTest) {
      const stageFlow = document.querySelector('#evaluation-stage-flow');
      const disableTheoryInputs = () => form.querySelectorAll('input,button').forEach(input => { input.disabled = true; });
      const finishStagedTest = async finalResult => {
        stageFlow.querySelectorAll('button').forEach(button => { button.disabled = true; });
        stageFlow.innerHTML = '<p class="muted">Se înregistrează rezultatul...</p>';
        try {
          const saved = await recordTestRun(testName, finalResult, submissionDetails);
          const candidate = candidateInput?.value?.trim() || '—';
          const candidateName = alsCandidateNameInput?.value?.trim() || '—';
          const notificationStatus = saved.discordNotificationsSent ? 'Notificarea Discord a fost trimisă.' : `Notificarea Discord nu a fost trimisă. ${saved.discordNotificationError || ''}`;
          stageFlow.innerHTML = `<pre class="candidate-summary">Test: ${escapeHtml(displayTestName(testName))}\nCandidat: ${escapeHtml(candidateName)}\nCallsign: ${escapeHtml(candidate)}\nRezultat: ${finalResult}</pre><p class="muted">Testul a fost înregistrat. ${escapeHtml(notificationStatus)}</p>`;
        } catch (error) {
          stageFlow.innerHTML = `<p class="error-text">Rezultatul nu s-a putut înregistra: ${escapeHtml(error.message)}</p>`;
        }
      };
      disableTheoryInputs();
      stageFlow.hidden = false;
      if (testName === 'Test PILOT') {
        form.hidden = true;
        form.closest('.view-panel')?.classList.add('pilot-stage-active');
        const theoryResult = event.submitter.dataset.pilotTheoryResult;
        const stages = window.MEDICAL_TESTS?.['Test PILOT']?.evaluationStages || definition.evaluationStages || [];
        const renderPilotStage = stageIndex => {
          const isFinalStage = stageIndex === stages.length - 1;
          const stage = stages[stageIndex];
          const verdicts = isFinalStage
            ? [{ result: 'Admis', text: 'Admis test Pilot' }, { result: 'Respins', text: 'Respins Test pilot' }]
            : [{ result: 'Admis', text: `Admis Proba ${stageIndex + 2}` }, { result: 'Respins', text: `Respins Proba ${stageIndex + 2}` }];
          stageFlow.replaceChildren();
          stageFlow.innerHTML = evaluationStageHtml(stage, verdicts);
          stageFlow.scrollIntoView({ behavior: 'smooth', block: 'start' });
          stageFlow.querySelectorAll('[data-evaluation-result]').forEach(button => button.onclick = async () => {
            if (button.dataset.evaluationResult === 'Respins') { await finishStagedTest('Respins'); return; }
            if (isFinalStage) { await finishStagedTest('Admis'); return; }
            renderPilotStage(stageIndex + 1);
          });
        };
        if (theoryResult === 'Respins') await finishStagedTest('Respins');
        else if (stages.length) renderPilotStage(0);
        else await finishStagedTest('Admis');
        return;
      }
      form.hidden = true;
      if (isMotoTest) {
        form.closest('.view-panel')?.classList.add('moto-stage-active');
        const theoryResult = event.submitter.dataset.motoTheoryResult;
        if (theoryResult === 'Respins') { await finishStagedTest('Respins'); return; }
        stageFlow.innerHTML = evaluationStageHtml(definition.practicalStage, [
          { result: 'Admis', text: 'Admis Proba 2' },
          { result: 'Respins', text: 'Respins Proba 2' }
        ]);
        stageFlow.scrollIntoView({ behavior: 'smooth', block: 'start' });
        stageFlow.querySelectorAll('[data-evaluation-result]').forEach(button => button.onclick = async () => finishStagedTest(button.dataset.evaluationResult));
        return;
      }

      form.closest('.view-panel')?.classList.add('smuls-stage-active');
      if (result === 'Respins') { await finishStagedTest('Respins'); return; }
      stageFlow.innerHTML = smulsCaseListHtml(definition.cases, definition.descarcerationImages);
      stageFlow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      stageFlow.querySelectorAll('[data-smuls-descarceration-result]').forEach(button => button.onclick = async () => {
        if (button.dataset.smulsDescarcerationResult === 'Respins') { await finishStagedTest('Respins'); return; }
        const routeImages = (definition.images || []).map(image => `<a class="test-image-link${image.inline ? ' test-image-preview' : ''}" href="${escapeHtml(image.url)}" target="_blank" rel="noopener">${image.inline ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.label || testName)}">` : escapeHtml(image.label || 'Deschide imaginea')}</a>`).join('');
        const offroadCard = evaluationStageHtml(definition.practicalStage, [
          { result: 'Admis', text: 'Admis test SMULS' },
          { result: 'Respins', text: 'Respins test SMULS' }
        ]);
        stageFlow.innerHTML = routeImages
          ? `<div class="smuls-offroad-layout"><div>${offroadCard}</div><aside class="test-map-column">${routeImages}</aside></div>`
          : offroadCard;
        stageFlow.scrollIntoView({ behavior: 'smooth', block: 'start' });
        stageFlow.querySelectorAll('[data-evaluation-result]').forEach(resultButton => resultButton.onclick = async () => finishStagedTest(resultButton.dataset.evaluationResult));
      });
      return;
    }
    let certificateNumber = null;
    try {
      const saved = await recordTestRun(testName, result, submissionDetails);
      if ((isApplicationTest || isMedicalCertificate || Object.hasOwn({ 'Test ALS': true, 'Test SMULS': true, 'Test MOTO': true, 'Test PILOT': true, 'Test parașutiști': true }, testName)) && !saved.discordNotificationsSent) status = `Rezultatul a fost salvat, dar notificările Discord nu au fost trimise. ${saved.discordNotificationError || 'Verifică setările webhook.'}`;
      if (isMedicalCertificate) {
        certificateNumber = saved.certificateNumber;
        if (saved.discordNotificationsSent) status = `Adeverința cu numărul ${certificateNumber} a fost trimisă.`;
      }
    }
    catch (error) { status = `Rezultatul a fost afișat, dar numărătoarea nu s-a salvat: ${error.message}`; }
    const isSpecialtyTest = ['Test ALS', 'Test SMULS', 'Test MOTO', 'Test PILOT', 'Test parașutiști'].includes(testName);
    const specialtySummary = isSpecialtyTest ? `Callsign: ${candidateInput.value.trim()}\nNume candidat: ${alsCandidateNameInput.value.trim()}\nRezultat: ${result}` : '';
    const summary = isApplicationTest ? admissionCandidateSummary(result) : isMedicalCertificate ? `D.M.L.S. - EVIDENTA MEDICA NR. ${certificateNumber || '—'}\nNume: ${document.querySelector('#certificate-last-name').value.trim()}\nPrenume: ${document.querySelector('#certificate-first-name').value.trim()}\nRezultat: ${result}` : specialtySummary || candidateSummary(member, result) || `Rezultat: ${result}`;
    form.innerHTML = `<pre class="candidate-summary">${escapeHtml(summary)}</pre><p class="muted">${escapeHtml(status)}</p>`;
  };
  const runner = document.querySelector('.test-runner');
  if (runner) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'primary'; button.textContent = 'Înregistrează testul susținut';
    const status = document.createElement('p'); status.className = 'muted';
    runner.append(button, status);
    button.onclick = async () => {
      button.disabled = true;
      try { await recordTestRun(testName); status.textContent = 'Testul a fost înregistrat.'; }
      catch (error) { status.textContent = error.message; button.disabled = false; }
    };
  }
}
renderRows();
const modal = document.querySelector('#modal'); const callsignInput=document.querySelector('#callsign'); const memberResult=document.querySelector('#member-result'); const grantChecks=document.querySelector('#grant-checks');
function openAddModal(member) {
  if (!isLeadershipUser(currentUser)) { alert('Doar conducerea poate acorda acces.'); return; }
  modal.classList.add('open');
  callsignInput.value = member ? normalizeCallsign(member.callsign) : '';
  grantChecks.innerHTML = '';
  if (member) {
    selectedMembers = [{ ...member }];
    selectedGrantDraft = normalizeGrantBundle([...(member.grantedTests || []), ...docsAssignedTests(member)]);
    renderGrantChecks(catalog);
    memberResult.textContent = `${memberNameFor(member)} · ${normalizeCallsign(member.callsign)}`;
  } else { selectedMembers = []; selectedGrantDraft = []; memberResult.textContent = ''; lookupMember(); }
}
document.querySelector('#add-btn')?.addEventListener('click', () => openAddModal());
document.querySelector('#close-modal').onclick = () => modal.classList.remove('open');
modal.onclick = e => { if (e.target === modal) modal.classList.remove('open') };

// ===== Scoatere Tester =====
const removeModal = document.querySelector('#remove-modal');
const removeMemberSelect = document.querySelector('#remove-member-select');
const removeTestChecks = document.querySelector('#remove-test-checks');
const removeResult = document.querySelector('#remove-result');
function renderRemoveTestChecks() {
  const member = testers.find(item => normalizeCallsign(item.callsign) === normalizeCallsign(removeMemberSelect?.value || ''));
  const granted = member?.grantedTests || [];
  const hasTesterBundle = coreTests.every(test => granted.includes(test));
  const otherTests = granted.filter(test => !coreTests.includes(test));
  removeTestChecks.innerHTML = hasTesterBundle
    ? `<label><input type="checkbox" value="${TESTER_BUNDLE_KEY}"> Tester (admitere, transfer, adeverință)</label>${otherTests.map(test => `<label><input type="checkbox" value="${escapeHtml(test)}"> ${escapeHtml(displayTestName(test))}</label>`).join('')}`
    : granted.length
      ? granted.map(test => `<label><input type="checkbox" value="${escapeHtml(test)}"> ${escapeHtml(displayTestName(test))}</label>`).join('')
      : '<p class="muted">Acest tester nu are teste alocate.</p>';
  removeResult.textContent = member ? `Teste active: ${granted.length}` : '';
}
function openRemoveModal() {
  if (!isLeadershipUser(currentUser)) { alert('Doar conducerea poate retrage accesul.'); return; }
  if (!removeModal) return;
  removeMemberSelect.innerHTML = testers.map(member => `<option value="${escapeHtml(normalizeCallsign(member.callsign))}">${escapeHtml(memberNameFor(member))} · ${escapeHtml(normalizeCallsign(member.callsign))}</option>`).join('');
  removeTestChecks.innerHTML = '';
  removeResult.textContent = testers.length ? '' : 'Nu există testeri.';
  removeModal.classList.add('open');
  if (removeMemberSelect.options.length) renderRemoveTestChecks();
}
if (removeMemberSelect) removeMemberSelect.onchange = renderRemoveTestChecks;
document.querySelector('#close-remove-modal')?.addEventListener('click', () => removeModal.classList.remove('open'));
removeModal?.addEventListener('click', e => { if (e.target === removeModal) removeModal.classList.remove('open'); });
document.querySelector('#remove-btn')?.addEventListener('click', openRemoveModal);
document.querySelector('#confirm-remove-btn')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const member = testers.find(item => normalizeCallsign(item.callsign) === normalizeCallsign(removeMemberSelect?.value || ''));
  if (!member) { removeResult.textContent = 'Alege un tester din listă.'; return; }
  const selectedToRemove = [...removeTestChecks.querySelectorAll('input:checked')].map(input => input.value);
  const toRemove = selectedToRemove.flatMap(test => test === TESTER_BUNDLE_KEY ? coreTests : [test]);
  if (!toRemove.length) { removeResult.textContent = 'Bifează cel puțin un test de revocat.'; return; }
  button.disabled = true;
  try {
    const next = (member.grantedTests || []).filter(test => !toRemove.includes(test));
    const saved = await saveRemoteGrant(normalizeCallsign(member.callsign), next, false, member.discordId || '');
    const grant = saved?.grant || { ...member, grantedTests: next, updatedAt: new Date().toISOString() };
    const refreshed = await loadDirectory();
    const updated = testers.find(item => normalizeCallsign(item.callsign) === normalizeCallsign(member.callsign));
    if (updated) { updated.grantedTests = grant.grantedTests || next; updated.grantMode = grant.grantMode || 'override'; updated.updatedAt = grant.updatedAt; }
    else testers.push({ ...member, ...grant });
    saveTesters();
    renderRows();
    renderDashboardData();
    refreshCurrentView();
    removeModal.classList.remove('open');
    removeResult.textContent = '';
  } catch (error) { removeResult.textContent = error.message; }
  finally { button.disabled = false; }
});
let selectedMembers=[];
let selectedGrantDraft=[];
async function lookupMember() {
  const values = callsignInput.value.split(/[\s,;]+/).map(value => normalizeCallsign(value)).filter(Boolean);
  const uniqueValues = [...new Set(values)];
  if (!uniqueValues.length) { selectedMembers = []; selectedGrantDraft = []; memberResult.textContent = ''; grantChecks.innerHTML = ''; return; }
  const found = uniqueValues.map(normalized => {
    const member = directoryMembers.find(item => normalizeCallsign(item.callsign) === normalized && String(item.name || '').trim());
    const local = testers.find(item => normalizeCallsign(item.callsign) === normalized);
    if (!member) return { normalized, member: null };
    const grantMode = local?.grantMode || member.grantMode || '';
    const grantedTests = grantMode === 'override'
      ? (local?.grantMode === 'override' ? local.grantedTests : member.grantedTests)
      : normalizeGrantBundle([...(member.grantedTests || []), ...(local?.grantedTests || [])]);
    return { normalized, member: { ...member, ...local, callsign: normalized, name: member.name, functions: member.functions, grantMode, grantedTests: normalizeGrantBundle(grantedTests || []) } };
  });
  selectedMembers = found.filter(item => item.member).map(item => item.member);
  const missing = found.filter(item => !item.member).map(item => item.normalized);
  if (!selectedMembers.length) { selectedGrantDraft = []; memberResult.textContent = 'Niciun callsign valid găsit în lista departamentului.'; grantChecks.innerHTML = ''; return; }
  selectedGrantDraft = normalizeGrantBundle([...selectedMembers[0].grantedTests, ...docsAssignedTests(selectedMembers[0])]);
  memberResult.innerHTML = selectedMembers.map(member => `<span class="selected-member">${escapeHtml(memberNameFor(member))} · ${escapeHtml(normalizeCallsign(member.callsign))}</span>`).join('') + (missing.length ? `<span class="lookup-warning">Negăsite: ${escapeHtml(missing.join(', '))}</span>` : '');
  renderGrantChecks(catalog);
}
function renderGrantChecks(options) {
  const hasTesterBundle = coreTests.every(test => selectedGrantDraft.includes(test));
  const otherTests = options.filter(test => !coreTests.includes(test));
  grantChecks.innerHTML = `<button type="button" class="grant-preset" id="tester-preset">Preia testele din Docs</button><label><input type="checkbox" value="${TESTER_BUNDLE_KEY}" ${hasTesterBundle ? 'checked' : ''}> Tester (admitere, transfer, adeverință)</label>${otherTests.map(test => `<label><input type="checkbox" value="${escapeHtml(test)}" ${selectedGrantDraft.includes(test) ? 'checked' : ''}> ${escapeHtml(displayTestName(test))}</label>`).join('')}`;
  grantChecks.querySelectorAll('input[type="checkbox"]').forEach(input => input.onchange = () => {
    const checked = [...grantChecks.querySelectorAll('input:checked')].flatMap(item => item.value === TESTER_BUNDLE_KEY ? coreTests : [item.value]);
    selectedGrantDraft = normalizeGrantBundle(checked);
  });
  document.querySelector('#tester-preset').onclick = () => { const member = selectedMembers[0]; selectedGrantDraft = normalizeGrantBundle([...(member?.grantedTests || []), ...docsAssignedTests(member)]); renderGrantChecks(options); };
}
callsignInput.onchange=lookupMember;callsignInput.oninput=()=>{clearTimeout(window.lookupTimer);window.lookupTimer=setTimeout(lookupMember,350)};
document.querySelector('#invite-btn').onclick = async () => {
  if (!selectedMembers.length) { memberResult.textContent = 'Selectează cel puțin un membru existent.'; return; }
  const checked = [...grantChecks.querySelectorAll('input:checked')].map(input => input.value);
  const granted = normalizeGrantBundle(checked.flatMap(test => test === TESTER_BUNDLE_KEY ? coreTests : [test]));
  const withoutDiscord = selectedMembers.find(member => !member.discordId);
  if (withoutDiscord) { memberResult.textContent = `${memberNameFor(withoutDiscord)} nu are un Discord ID pe coloana T; nu i se poate salva accesul.`; return; }
  const button = document.querySelector('#invite-btn');
  button.disabled = true; button.textContent = 'Se salvează…';
  try {
    const savedGrants = await Promise.all(selectedMembers.map(async member => {
      const normalized = normalizeCallsign(member.callsign);
      const saved = await saveRemoteGrant(normalized, granted, false, member.discordId);
      const grant = saved?.grant || { discordId: member.discordId, callsign: normalized, grantedTests: granted, updatedAt: new Date().toISOString() };
      return { member, grant, normalized };
    }));
    savedGrants.forEach(({ member, grant, normalized }) => {
      const merged = { ...member, ...grant, grantedTests: grant.grantedTests || granted, name: member.name, callsign: normalized };
      const existing = testers.find(item => normalizeCallsign(item.callsign) === normalized);
      if (existing) Object.assign(existing, merged); else testers.push(merged);
    });
    saveTesters();
    renderRows();
    renderDashboardData();
    refreshCurrentView();
    modal.classList.remove('open');
  } catch (error) { memberResult.textContent = error.message || 'Salvarea a eșuat.'; }
  finally { button.disabled = false; button.innerHTML = 'Salvează accesul →'; }
};
viewContent.addEventListener('click', event => {
  const button = event.target.closest('[data-statistics-member]');
  if (!button) return;
  if (!hasLeadershipCallsign(currentUser) && normalizeCallsign(currentUser?.callsign || currentUser?.callSign) !== normalizeCallsign(button.dataset.statisticsMember)) return;
  const member = testers.find(item => String(item.discordId || normalizeCallsign(item.callsign)) === button.dataset.statisticsMember);
  if (member) openTesterProfile(member, { previousView: 'statistics' });
});
const testFilterBtn = document.querySelector('#filter-btn');
const testFilterMenu = document.querySelector('#test-filter-menu');
function renderTestFilterMenu() {
  if (!testFilterMenu) return;
  const options = ['all', ...docsTesterFilters];
  const labels = { 'Test SMULS': 'S.M.U.L.S.', 'Test ALS': 'A.L.S.' };
  testFilterMenu.innerHTML = options.map(test => `<button type="button" class="test-filter-option ${activeTesterFilter === test ? 'active' : ''}" data-test-filter="${escapeHtml(test)}">${test === 'all' ? 'Toți testerii' : labels[test]}<em>${test === 'all' ? testers.length : testers.filter(member => memberCanGiveTest(member, test)).length}</em></button>`).join('');
  testFilterMenu.querySelectorAll('[data-test-filter]').forEach(option => { option.onclick = () => { activeTesterFilter = option.dataset.testFilter; if (testFilterBtn) testFilterBtn.textContent = activeTesterFilter === 'all' ? 'Filtrează după test ☷' : `${labels[activeTesterFilter]} ☷`; renderTestFilterMenu(); renderRows(); if (testFilterMenu) testFilterMenu.hidden = true; if (testFilterBtn) testFilterBtn.setAttribute('aria-expanded', 'false'); }; });
}
if (testFilterBtn) { testFilterBtn.onclick = event => { event.stopPropagation(); if (!testFilterMenu) return; testFilterMenu.hidden = !testFilterMenu.hidden; testFilterBtn.setAttribute('aria-expanded', String(!testFilterMenu.hidden)); if (!testFilterMenu.hidden) renderTestFilterMenu(); }; }
document.addEventListener('click', event => { if (testFilterMenu && !testFilterMenu.hidden && !document.querySelector('#test-filter')?.contains(event.target)) { testFilterMenu.hidden = true; testFilterBtn?.setAttribute('aria-expanded', 'false'); } });
testerGroups?.addEventListener('click', event => { const button = event.target.closest('[data-member-menu]'); if (!button) return; const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberMenu); if (member) { selectedMember = member; openAddModal(member); } }); rows?.addEventListener('click', event => { const button = event.target.closest('[data-member-menu]'); if (!button) return; const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberMenu); if (member) { selectedMember = member; openAddModal(member); } }); document.querySelector('#brand-settings').onclick = () => navigateTo('overview'); document.querySelector('#user-menu').onclick = () => navigateTo('overview'); document.querySelector('#profile-settings').onclick = () => navigateTo('settings'); document.querySelector('#help-btn').onclick = () => alert('Folosește meniul din stânga pentru a naviga.');
viewContent.addEventListener('click', event => {
  const button = event.target.closest('[data-member-profile]');
  if (!button || !hasLeadershipCallsign(currentUser)) return;
  const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberProfile);
  if (member) openTesterProfile(member);
});
document.querySelector('#admin-add-tester').addEventListener('click', () => openAddModal());
document.querySelector('#admin-remove-tester').addEventListener('click', () => openRemoveModal());
document.querySelector('#admin-reset-tests').addEventListener('click', resetAllTestCounts);
document.querySelector('#admin-settings').addEventListener('click', () => navigateTo('settings'));
document.querySelector('#brand-settings').onclick = () => navigateTo('overview'); document.querySelector('#user-menu').onclick = () => navigateTo('overview'); document.querySelector('#profile-settings').onclick = () => navigateTo('settings'); document.querySelector('#help-btn').onclick = () => alert('Folosește meniul din stânga pentru a naviga.');
const labels = { overview: 'Profilul tău', testers: 'Testerii departamentului', statistics: 'Statistica Teste', bonuses: 'Bonusuri', settings: 'Setări' };
function navigateTo(view, { push = true } = {}) {
  if (view === 'bonuses' && !isLeadershipUser(currentUser)) view = 'overview';
  if (!labels[view]) return;
  if (push && window.history.state?.view !== view) window.history.pushState({ view }, '', `#${view}`);
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  document.querySelector('#page-label').textContent = labels[view];
  document.querySelector('#section-label').textContent = view === 'settings' ? 'Administrare' : 'Spațiul tău';
  document.querySelector('.sidebar').classList.remove('open');
  renderView(view);
}
document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));
const availableTestsToggle = document.querySelector('#available-tests-toggle');
const availableTestsSubmenu = document.querySelector('#available-tests-submenu');
availableTestsToggle.addEventListener('click', () => {
  const expanded = availableTestsToggle.getAttribute('aria-expanded') === 'true';
  availableTestsToggle.setAttribute('aria-expanded', String(!expanded));
  availableTestsSubmenu.hidden = expanded;
});
availableTestsSubmenu.addEventListener('click', event => {
  const button = event.target.closest('[data-available-test]');
  if (button) openTest(button.dataset.availableTest);
});
window.addEventListener('popstate', event => {
  if (!currentUser) return;
  if (event.state?.view === 'test' && event.state.testName) return openTest(event.state.testName, { push: false, previousView: event.state.previousView });
  if (event.state?.view === 'tester-profile') {
    const member = testers.find(item => normalizeCallsign(item.callsign) === event.state.callsign) || directoryMembers.find(item => normalizeCallsign(item.callsign) === event.state.callsign);
    return member ? openTesterProfile(member, { push: false }) : navigateTo('testers', { push: false });
  }
  navigateTo(event.state?.view || 'overview', { push: false });
});
window.addEventListener('hashchange', () => {
  if (!currentUser || window.location.hash.startsWith('#test-')) return;
  const memberProfileMatch = window.location.hash.match(/^#tester-profile-(.+)$/);
  if (memberProfileMatch) {
    const callsign = decodeURIComponent(memberProfileMatch[1]);
    const member = testers.find(item => normalizeCallsign(item.callsign) === callsign) || directoryMembers.find(item => normalizeCallsign(item.callsign) === callsign);
    if (member) openTesterProfile(member, { push: false });
    else navigateTo('testers', { push: false });
    return;
  }
  const view = window.location.hash.slice(1);
  navigateTo(labels[view] ? view : 'overview', { push: false });
});
document.querySelector('.mobile-menu').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
window.setInterval(() => { markPresence(); sendPresence(); renderRows(); }, 30000);
window.setInterval(async () => { if (!currentUser) return; try { await loadDirectory(); await loadRemoteGrants(); } catch { /* următoarea sincronizare va reîncerca */ } }, 60*60*1000);
const profileDateFormatter = new Intl.DateTimeFormat('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' });
const romaniaTimeFormatter = new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Bucharest' });
function updateProfileDateTime() {
  const now = new Date();
  document.querySelector('#today-label').textContent = profileDateFormatter.format(now).toUpperCase();
  const localTime = document.querySelector('#local-time');
  localTime.dateTime = now.toISOString();
  localTime.textContent = romaniaTimeFormatter.format(now);
}
updateProfileDateTime();
window.setInterval(updateProfileDateTime, 1000);

// Fluxul OAuth: Discord redirecționează înapoi cu ?code=..., apoi codul este trimis server-side către API-ul Vercel.
const authScreen=document.querySelector('#auth-screen');
const appShell=document.querySelector('#app-shell');
const authError=document.querySelector('#auth-error');
const AUTH_API_ENDPOINT='/api/auth/discord';
const LOGIN_ENDPOINT='/api/auth/login';
const AUTH_STORAGE_KEY='medici-auth';
const AUTH_SCHEMA_VERSION=4;
const AUTH_TTL=24*60*60*1000;
// ===== BANDAL TEMPORAR PENTRU TESTARE =====
// Set to true only for a local preview; production uses Discord authentication.
const DEV_LOGIN_ENABLED=['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
const DEV_LOGIN_USER={ id:'DEV-001', discordId:'0', name:'Tester Local', displayName:'Tester Local', callsign:'M-001', callSign:'M-001', csNum:1, rank:'Medic Inspector', dept:'Departamentul Medical', functions:'TESTER', isLeadership:true, isConducere:true, accessLevel:'leadership', gradeGroup:'leadership', allowedTests:[...coreTests,...specialtyTests], eligibleSpecializations:[], grantedTests:[...coreTests,...specialtyTests], avatar:null };
// ===== SFÂRȘIT BANDAL =====
const PRESENCE_KEY='medici-presence';
function markPresence() { if (!currentUser?.discordId) return; const presence = readStored(PRESENCE_KEY, {}); presence[currentUser.discordId] = Date.now(); localStorage.setItem(PRESENCE_KEY, JSON.stringify(presence)); }
async function sendPresence() { if (!currentUser?.discordId) return; await fetch('/api/access/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discordId: currentUser.discordId }) }).catch(() => {}); }
window.addEventListener('storage', event => { if (event.key === PRESENCE_KEY) { renderRows(); refreshCurrentView(); } });
function initialsFrom(name='User'){return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
/** @param {any} user @returns {{name:string, callsign:string}} */
function setWelcomeHeader(user){
  const name = user.name || user.displayName || 'Utilizator';
  const callsign = normalizeCallsign(user.callsign || user.callSign);
  user.callsign = callsign;
  document.querySelector('#user-name').textContent = name;
  document.querySelector('#user-role').textContent = isLeadershipUser(user) ? 'Conducere' : 'Tester';
  document.querySelector('#user-avatar').innerHTML = avatarFor(user);
  renderProfileData();
  return { name, callsign };
}
/** @param {any} user @returns {void} */
function setVisibilityPermissions(user){
  const leadership = isLeadershipUser(user);
  const addBtn = document.querySelector('#add-btn');
  const removeBtn = document.querySelector('#remove-btn');
  const profileSettingsButton = document.querySelector('#profile-settings');
  const callsign = callsignNumber(user?.csNum || user?.callsign || user?.callSign);
  const adminPanel = document.querySelector('#admin-panel');
  if (addBtn) addBtn.hidden = !leadership;
  if (removeBtn) removeBtn.hidden = !leadership;
  if (profileSettingsButton) profileSettingsButton.hidden = callsign < 1 || callsign > 20;
  if (adminPanel) adminPanel.hidden = callsign < 1 || callsign > 20;
  const sectionLabel = document.querySelector('#section-label');
  if (sectionLabel) sectionLabel.textContent = 'Spațiul tău';
}
/** @param {any} user @returns {void} */
function setStats(user){
  const stat = document.querySelector('.stat-card:nth-child(2) strong');
  if (stat) stat.textContent = allowedForUser(user).length;
}
/** @param {any} user @returns {void} */
function applyUser(user){
  currentUser = user;
  setWelcomeHeader(user); setVisibilityPermissions(user); setStats(user); renderAvailableTestsSubmenu();
}
function showAuthError(message){authError.textContent=message;authError.classList.add('show')}
async function enterApp(user) {
  const requestedHash = window.location.hash;
  const requestedProfileMatch = requestedHash.match(/^#tester-profile-(.+)$/);
  const requestedProfileCallsign = requestedProfileMatch ? decodeURIComponent(requestedProfileMatch[1]) : '';
  const requestedTestName = testNameFromHash(requestedHash);
  const requestedView = requestedHash.slice(1);
  applyUser(user);
  markPresence();
  sendPresence();
  authScreen.style.display = 'none';
  appShell.classList.add('ready');
  window.history.replaceState({ view: 'overview' }, '', `${window.location.pathname}#overview`);
  navigateTo('overview', { push: false });
  try {
    await loadDirectory();
    await loadRemoteGrants();
    if (requestedProfileCallsign) {
      const member = testers.find(item => normalizeCallsign(item.callsign) === requestedProfileCallsign) || directoryMembers.find(item => normalizeCallsign(item.callsign) === requestedProfileCallsign);
      if (member) openTesterProfile(member, { push: false, previousView: 'testers' });
    } else if (requestedTestName && allowedForUser(currentUser).includes(requestedTestName)) {
      openTest(requestedTestName, { push: false, previousView: 'overview' });
    } else if (labels[requestedView]) {
      navigateTo(requestedView, { push: false });
    }
  } catch (error) {
    setSyncDetail('Sincronizarea a eșuat');
    console.error(error);
  }
}
const accessError = new URLSearchParams(window.location.search).get('access');
if (accessError === 'denied') showAuthError('Contul Discord nu există în lista departamentului.');
if (accessError === 'error') showAuthError('Autentificarea Discord nu a putut fi finalizată.');
async function exchangeCallbackCode(){
  const params=new URLSearchParams(window.location.search); const code=params.get('code');
  if(params.get('error')) throw new Error('Autentificarea Discord a fost anulată.');
  if(!code) return null;
  const response=await fetch(AUTH_API_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  const payload=await response.json(); if(!response.ok||!payload.success||!payload.user) throw new Error(payload.error==='not_found'?'Discord ID-ul nu există în lista departamentului.':'Verificarea autentificării a eșuat.');
  const stored={version:AUTH_SCHEMA_VERSION,user:payload.user,expiresAt:Date.now()+AUTH_TTL}; localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(stored));
  window.history.replaceState({},document.title,window.location.pathname); return payload.user;
}
function cachedUserWithinSession(cached, now = Date.now()) {
  return cached?.version === AUTH_SCHEMA_VERSION && cached?.user?.discordId && Number(cached.expiresAt) > now ? cached.user : null;
}
async function startSession(){
  if(DEV_LOGIN_ENABLED){ return enterApp({ ...DEV_LOGIN_USER }); }
  try{
    const callbackUser=await exchangeCallbackCode(); if(callbackUser) return enterApp(callbackUser);
    const cached=readStored(AUTH_STORAGE_KEY, null);
    const cachedUser=cachedUserWithinSession(cached);
    if(cachedUser) return enterApp(cachedUser);
    localStorage.removeItem(AUTH_STORAGE_KEY); throw new Error('not-authorized');
  }catch(error){appShell.classList.remove('ready');const message=error.message==='not-authorized'?'Conectează-te cu Discord pentru a verifica accesul.':error.message;showAuthError(message)}
}
const discordLoginBtn = document.querySelector('#discord-login');
if (discordLoginBtn) {
  if (DEV_LOGIN_ENABLED) {
    document.querySelector('.auth-card h1').textContent = 'Intră pe site';
    document.querySelector('.auth-copy').textContent = 'Accesează site-ul fără conectare Discord.';
    document.querySelector('.auth-note').hidden = true;
    discordLoginBtn.innerHTML = 'Intră pe site <span>→</span>';
    discordLoginBtn.onclick = () => enterApp({ ...DEV_LOGIN_USER });
  } else {
    discordLoginBtn.onclick = () => { window.location.href = LOGIN_ENDPOINT; };
  }
}
startSession();
