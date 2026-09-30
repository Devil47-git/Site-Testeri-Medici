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
const admissionRequirements = ['Verificarea ținutei', 'Verificarea tatuajelor faciale', 'Verificarea cazierului', 'Minimum 50 de ore jucate', 'Controlul cu stetoscopul', 'Drug-testul'];
const specialtyTests = ['Test ALS','Test SMULS','Test MOTO','Test PILOT','Test parașutiști'];
const docsTesterFilters = ['Test SMULS', 'Test ALS'];
const testSummaryDefinitions = [['Test SMULS', 'Test S.M.U.L.S.'], ['Test MOTO', 'Test MOTO'], ['Test PILOT', 'Test PILOT'], ['Test ALS', 'Test A.L.S.'], ['Test parașutiști', 'Test parașutism']];
const catalog = [...coreTests, ...specialtyTests];
const TEST_CATALOG_KEY = 'medici-test-catalog-v4';
/** @param {string} key @param {any} fallback @returns {any} */
function readStored(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
/** @type {Record<string, TestDefinition>} */
let testDefinitions = readStored(TEST_CATALOG_KEY, null) || window.MEDICAL_TESTS || Object.fromEntries(catalog.map(name => [name, { name, description: `Acces disponibil pentru ${name}.`, questions: [] }]));
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
let expandedSummaryMember = '';
function saveTesters() { localStorage.setItem(GRANTS_KEY, JSON.stringify(testers)); }
function refreshCurrentView() { const active = document.querySelector('.nav-item.active')?.dataset.view || 'overview'; renderView(active); }
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
          return { ...member, ...grant, grantedTests: normalizeGrantBundle([...(member.grantedTests || []), ...docsAssignedTests(member), ...(grant?.grantedTests || [])]) };
        })
      : grants.map(grant => ({ ...grant, grantedTests: normalizeGrantBundle(grant.grantedTests || []) }));
  } else {
    const ownGrant = grantsPayload.find(grant => grant.discordId === currentUser.discordId);
    currentUser.grantedTests = ownGrant?.grantedTests || currentUser.grantedTests || [];
    testers = ownGrant ? [ownGrant] : [];
  }
  saveTesters();
  renderRows();
  renderDashboardData();
  refreshCurrentView();
}
async function saveRemoteGrant(callsign, grantedTests, remove = false, targetDiscordId = '') {
  if (!currentUser?.discordId) throw new Error('Sesiunea nu conține Discord ID.');
  const response = await fetch('/api/access/grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requesterId: currentUser.discordId, targetDiscordId, callsign, grantedTests, remove }) });
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
function isLeadershipUser(user) { const cs = callsignNumber(user?.csNum || user?.callsign || user?.callSign); return Boolean(user?.accessLevel === 'leadership' || user?.isConducere || user?.isLeadership || (cs >= 1 && cs <= 15)); }
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
  if (n >= 1 && n <= 15) return 'Conducerea departamentului';
  if (n >= 101 && n <= 115) return 'Medici Primari (101-115)';
  if (n >= 201 && n <= 230) return 'Medici Specialisti (201-230)';
  return '';
}
function gradeGroupForMember(member) { return member?.gradeGroup || gradeGroupFor(member?.csNum || member?.callsign); }
/** @param {any} user @returns {string[]} */
function allowedForUser(user) { if (isLeadershipUser(user)) return catalog; return [...new Set([...(user?.grantedTests || []), ...docsAssignedTests(user)])].filter(test => catalog.includes(test) && testDefinitions[test]); }
/** @param {any} value @returns {string} */
function dateOnly(value) { return value ? new Date(value).toLocaleDateString('ro-RO') : '—'; }
/** @param {any} member @returns {boolean} */
/** @param {any} value @returns {string} */
function normalizeText(value) { return String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function memberCanGiveTest(member, test) {
  const functions = normalizeText(member?.functions);
  if (test === 'Test SMULS') return /S\.?\s*M\.?\s*U\.?\s*L\.?\s*S\.?|\s*S\s*\|/.test(functions);
  if (test === 'Test ALS') return /A\.?\s*L\.?\s*S\.?|\s*A\s*\|/.test(functions);
  if (test === 'Test MOTO') return /MOTO|\s*M\s*\|/.test(functions);
  if (test === 'Test PILOT') return /PILOT|\s*P\s*\|/.test(functions);
  if (test === 'Test parașutiști') return /PARASUTIST|PARACHUTIST|\s*PT\s*\|/.test(functions);
  return false;
}
function docsAssignedTests(member) {
  const assigned = testSummaryDefinitions.map(([test]) => test).filter(test => memberCanGiveTest(member, test));
  if (/\bTESTER\b/.test(normalizeText(member?.functions))) assigned.unshift(...coreTests);
  return [...new Set(assigned)];
}
function normalizeGrantBundle(tests) {
  const normalized = [...new Set(tests)];
  if (coreTests.some(test => normalized.includes(test))) {
    for (const test of coreTests) if (!normalized.includes(test)) normalized.push(test);
  }
  return normalized;
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
    ? `<div class="avatar ${colorClass} has-photo"><img src="${escapeHtml(url)}" alt="${initials}" loading="lazy" onerror="this.remove()"></div>`
    : `<div class="avatar ${colorClass}">${initials}</div>`;
}
function memberNameFor(member) { return String(member?.name || '').trim() || normalizeCallsign(member?.callsign) || '—'; }
function rankFor(member) { return String(member?.rank || '').trim() || String(member?.gradeGroup || '').trim() || '—'; }
function testerAccessHtml(member) {
  const assignedTests = normalizeGrantBundle(member.grantedTests || []);
  if (isLeadershipUser(member)) return '<span class="muted">Acces general</span>';
  const hasTesterBundle = coreTests.every(test => assignedTests.includes(test));
  const visibleTests = [...(hasTesterBundle ? ['Tester'] : []), ...assignedTests.filter(test => !hasTesterBundle || !coreTests.includes(test))];
  return visibleTests.length
    ? visibleTests.map((test, i) => `<span class="tag ${i % 3 === 1 ? 'orange' : i % 3 === 2 ? 'cyan' : ''}">${escapeHtml(test)}</span>`).join('')
    : '<span class="muted">Fără teste alocate</span>';
}
function testerRowHtml(member, index) {
  const tags = testerAccessHtml(member);
  return `<tr><td><div class="tester">${avatarFor(member)}<span>${escapeHtml(memberNameFor(member))}</span></div></td><td>${escapeHtml(normalizeCallsign(member.callsign))}</td><td>${escapeHtml(rankFor(member))}</td><td><div class="tags">${tags}</div></td><td>${dateOnly(member.updatedAt)}</td><td><span class="status ${isActive(member) ? 'online' : 'offline'}"><i></i>${isActive(member) ? 'Activ' : 'Inactiv'}</span></td><td><button class="more" data-member-menu="${escapeHtml(normalizeCallsign(member.callsign))}">•••</button></td></tr>`;
}
function testerTableHtml(members) {
  return `<div class="table-wrap"><table><thead><tr><th>TESTER</th><th>CALLSIGN</th><th>RANK</th><th>TESTE ALOCATE</th><th>ULTIMA ACTIVITATE</th><th>STATUS</th><th></th></tr></thead><tbody>${members.map((member, index) => testerRowHtml(member, index)).join('')}</tbody></table></div>`;
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
  { label: 'Conducere', members: member => (callsignNumber(member?.csNum) >= 1 && callsignNumber(member?.csNum) <= 15) },
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
  const status = isActive(member) ? 'online' : 'offline';
  return `<article class="tester-search-result"><div class="search-result-person">${avatarFor(member)}<div><strong>${escapeHtml(memberNameFor(member))}</strong><small>${escapeHtml(normalizeCallsign(member.callsign))} · ${escapeHtml(rankFor(member))}</small></div></div><div class="search-result-tests tags">${testerAccessHtml(member)}</div><span class="status ${status}"><i></i>${isActive(member) ? 'Activ' : 'Inactiv'}</span></article>`;
}
/** @type {Member[]} */
let directoryMembers = [];
async function loadDirectory() {
  if (!currentUser?.discordId) return;
  const response = await fetch(`/api/access/directory?requesterId=${encodeURIComponent(currentUser.discordId)}`);
  if (!response.ok) return;
  const payload = await response.json();
  directoryMembers = (payload.members || []).filter(member => String(member?.name || '').trim());
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
  const summaries = document.querySelector('#test-summary-grid');
  if (summaries) summaries.innerHTML = testSummaryDefinitions.map(([test, label]) => {
    const members = testers.filter(member => (member.grantedTests || []).includes(test) && memberCanGiveTest(member, test)).sort((a, b) => callsignNumber(a.csNum) - callsignNumber(b.csNum));
    const rows = members.length
      ? members.map(member => {
          const count = testRunCounts[member.discordId]?.[test] || 0;
          const key = `${test}:${member.discordId || normalizeCallsign(member.callsign)}`;
          const expanded = expandedSummaryMember === key;
          return `<div class="test-summary-member"><button type="button" class="test-summary-member-toggle" data-summary-member="${escapeHtml(key)}" aria-expanded="${expanded}"><span class="summary-member-identity"><strong>${escapeHtml(memberNameFor(member))}</strong><small>${escapeHtml(rankFor(member))} · ${escapeHtml(normalizeCallsign(member.callsign))}</small></span><span class="summary-member-count">${count} ${count === 1 ? 'test' : 'teste'} <span aria-hidden="true">${expanded ? '⌃' : '⌄'}</span></span></button>${expanded ? testerSummaryDetailHtml(member) : ''}</div>`;
        }).join('')
      : '<p class="muted">Nu există testeri cu acest test alocat.</p>';
    return `<article class="panel test-summary-card"><header><h2>${escapeHtml(label)}</h2><span>${members.length}</span></header>${rows}</article>`;
  }).join('');
  const overview = document.querySelector('#overview-view');
  if (overview) overview.dataset.updatedAt = new Date().toISOString();
}
function testerSummaryDetailHtml(member) {
  const assignedTests = normalizeGrantBundle([...(member.grantedTests || []), ...docsAssignedTests(member)]);
  const roleBadges = isLeadershipUser(member) ? testerAccessHtml(member) : testerAccessHtml({ ...member, grantedTests: assignedTests });
  const counts = catalog.map(test => {
    const count = testRunCounts[member.discordId]?.[test] || 0;
    const hasAccess = isLeadershipUser(member) || assignedTests.includes(test);
    return `<div class="summary-test-count"><span>${escapeHtml(test)}</span><small>${hasAccess ? 'Acces activ' : 'Fără acces'}</small><strong>${count}</strong></div>`;
  }).join('');
  return `<div class="summary-member-detail"><div class="summary-member-roles"><strong>Roluri tester</strong><div class="tags">${roleBadges}</div></div><div class="summary-test-counts">${counts}</div></div>`;
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
function renderTestsView(title) {
  return `<div class="panel view-panel"><div class="panel-head"><div><h2>${title}</h2><p class="muted">Instrument pentru testeri. Tu poți deschide orice test disponibil oricând.</p></div></div><div class="test-cards">${allowedForUser(currentUser).map(test => `<article class="test-card"><h3>${test}</h3><p class="muted">${testDefinitions[test]?.description || 'Test disponibil.'}</p><button class="primary" data-test="${test}">Deschide ghidul</button></article>`).join('') || '<div class="empty-state">Nu ai teste disponibile.</div>'}</div></div>`;
}
function renderTestersView() {
  const groups = DASHBOARD_GROUPS.map(group => ({ label: group.label, members: sortMembers(testers.filter(group.members)) })).filter(group => group.members.length);
  const orphan = sortMembers(testers.filter(member => !DASHBOARD_GROUPS.some(group => group.members(member))));
  if (orphan.length) groups.push({ label: 'Alți membri', members: orphan });
  const actions = isLeadershipUser(currentUser) ? '<div class="welcome-actions"><button class="primary" id="view-add">＋ Adaugă tester</button><button class="primary" id="view-remove">－ Scoatere Tester</button></div>' : '';
  const sections = groups.map(group => `<section class="tester-group"><h3>${escapeHtml(group.label)}</h3><div class="table-wrap"><table><thead><tr><th>TESTER</th><th>CALLSIGN</th><th>RANK</th><th>TESTE ALOCATE</th><th>ULTIMA ACTIVITATE</th><th>STATUS</th><th></th></tr></thead><tbody>${group.members.map((member, index) => testerRowHtml(member, index)).join('')}</tbody></table></div></section>`).join('');
  return `<div class="panel view-panel"><div class="panel-head"><div><h2>Testerii departamentului</h2><p class="muted">Aceiași testeri ca pe dashboard, grupați pe grade.</p></div>${actions}</div>${sections || '<div class="empty-state">Nu există testeri.</div>'}</div>`;
}
function renderMembersView() {
  const groups = GRADE_GROUP_ORDER.filter(group => directoryMembers.some(member => gradeGroupForMember(member) === group));
  const sections = groups.map(group => {
    const members = sortMembers(directoryMembers.filter(member => gradeGroupForMember(member) === group));
    if (!members.length) return '';
    const rowsHtml = members.map(member => `<tr><td>${escapeHtml(member.leadershipTitle || leadershipTitleForCallsign(member.callsign) || member.functions || '—')}</td><td>${escapeHtml(member.name || '—')}</td><td>${escapeHtml(normalizeCallsign(member.callsign))}</td><td>${escapeHtml(member.rank || '—')}</td></tr>`).join('');
    return `<section class="member-group"><h3>${escapeHtml(group)}</h3><div class="table-wrap"><table><thead><tr><th>FUNCȚIE</th><th>NUME</th><th>CALLSIGN</th><th>GRAD</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></section>`;
  }).join('');
  return `<div class="panel view-panel"><h2>Membri departament</h2><p class="muted">Membrii departamentului sunt grupați pe grade: conducere, medici primari și medici specialiști.</p>${sections || '<p class="muted">Nu s-a putut încărca lista membrilor.</p>'}</div>`;
}
function renderSettingsView(title) {
  return `<div class="panel view-panel"><h2>${title}</h2><p class="muted">Gestionează preferințele și sesiunea contului tău.</p><div class="settings-list"><p><b>Identitate:</b> ${currentUser?.name || '—'}</p><p><b>Callsign:</b> ${normalizeCallsign(currentUser?.callsign || currentUser?.callSign)}</p><p><b>Nivel acces:</b> ${isLeadershipUser(currentUser) ? 'Conducere' : 'Tester'}</p>${isLeadershipUser(currentUser) ? `<hr><h3>Configurare teste</h3><p class="muted">Poți importa aici textul testului; îl voi transforma automat în întrebări după structura fișierului.</p><label>Test<select id="test-editor-select">${catalog.map(test => `<option value="${test}">${test}</option>`).join('')}</select></label><input id="test-file-input" type="file" accept=".txt,.md,.json"><textarea id="test-editor-json" rows="8"></textarea><button class="primary" id="save-test-definition">Salvează testul</button><span id="test-editor-status" class="muted"></span>` : ''}<hr><button class="outline danger-button" id="logout-btn">Deconectează-te</button></div></div>`;
}
function wireTestersEvents() {
  const add = document.querySelector('#view-add'); if (add) add.onclick = () => openAddModal();
  const remove = document.querySelector('#view-remove'); if (remove) remove.onclick = () => openRemoveModal();
}
function wireSettingsEvents() {
  const logout = document.querySelector('#logout-btn'); if (logout) logout.onclick = () => { localStorage.removeItem(AUTH_STORAGE_KEY); window.location.reload(); };
  const editor = document.querySelector('#test-editor-select'); const editorJson = document.querySelector('#test-editor-json'); const editorStatus = document.querySelector('#test-editor-status');
  if (editor && editorJson) { const loadDefinition = () => { editorJson.value = JSON.stringify(testDefinitions[editor.value], null, 2); }; editor.onchange = loadDefinition; loadDefinition(); const fileInput = document.querySelector('#test-file-input'); if (fileInput) fileInput.onchange = async () => { const file = fileInput.files?.[0]; if (!file) return; editorJson.value = await file.text(); editorStatus.textContent = 'Fișier încărcat. Verifică și salvează.'; }; document.querySelector('#save-test-definition').onclick = () => { try { const value = JSON.parse(editorJson.value); testDefinitions[editor.value] = { ...value, name: editor.value }; saveTestDefinitions(); editorStatus.textContent = 'Salvat'; renderView('settings'); } catch { editorStatus.textContent = 'Format invalid. Pentru moment folosește JSON; după ce primesc Notepad-ul adaptez importul exact.'; } }; }
}
function renderView(view) {
  const overview = document.querySelector('#overview-view');
  const isOverview = view === 'overview';
  viewContent.hidden = isOverview;
  overview.hidden = !isOverview;
  viewContent.style.display = isOverview ? 'none' : 'block';
  overview.style.display = isOverview ? 'block' : 'none';
  if (isOverview) return;
  const title = labels[view] || 'Spațiul tău';
  document.querySelector('#section-label').textContent = view === 'settings' || view === 'members' ? 'Administrare' : 'Generale';
  if (view === 'tests') viewContent.innerHTML = renderTestsView(title);
  else if (view === 'testers') { viewContent.innerHTML = renderTestersView(); wireTestersEvents(); }
  else if (view === 'members') viewContent.innerHTML = renderMembersView();
  else { viewContent.innerHTML = renderSettingsView(title); wireSettingsEvents(); }
  // redundant remove-member wiring; handled by wireTestersEvents()
  viewContent.querySelectorAll('[data-test]').forEach(button => button.onclick = () => openTest(button.dataset.test));
}
function openTest(testName) {
  const definition = testDefinitions[testName] || { description: 'Test disponibil.', questions: [] };
  const questions = Array.isArray(definition.questions) ? definition.questions : [];
  const previousView = document.querySelector('.nav-item.active')?.dataset.view || 'tests';
  if (window.history.state?.view !== 'test') window.history.pushState({ view: 'test', testName, previousView }, '', `#test-${encodeURIComponent(testName)}`);
  viewContent.innerHTML = buildTestMarkup(testName, definition, questions);
  wireTestEvents(testName, definition);
}
function admissionChecklistHtml() {
  return `<section class="admission-checklist" aria-labelledby="admission-checklist-title"><h3 id="admission-checklist-title">Verificări înainte de proba teoretică</h3>${admissionRequirements.map((requirement, index) => `<label class="admission-check-row"><span>${escapeHtml(requirement)}</span><span class="admission-check-control"><input type="checkbox" data-admission-check="${index}" aria-label="${escapeHtml(requirement)}"><span class="admission-check-error" aria-hidden="true">!</span></span></label>`).join('')}</section>`;
}
function admissionChecksComplete(checks) { return checks.length === admissionRequirements.length && checks.every(Boolean); }
function isTestFailed(wrong, maxWrong) { return wrong > maxWrong; }
function maxWrongForTest(testName, maxWrong) { return testName === 'Test admitere' ? 2 : Number(maxWrong ?? Infinity); }
function parseIdentityCardText(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const valueAfterLabel = (pattern, nextLabel) => {
    const index = lines.findIndex(line => pattern.test(line));
    if (index < 0) return '';
    const inline = lines[index].replace(pattern, '').replace(/^[:\s-]+/, '').trim();
    if (inline) return inline;
    return lines.slice(index + 1).find(line => !nextLabel.test(line)) || '';
  };
  const lastName = valueAfterLabel(/Nume.*Last\s*name|Last\s*name/i, /Prenume|First\s*name|CNP|SERIA|SERIE/i);
  const firstName = valueAfterLabel(/Prenume.*First\s*name|First\s*name/i, /CNP|SERIA|SERIE/i);
  const cnpLine = String(text || '').match(/CNP[^0-9]{0,16}((?:\d[\s.-]?){12}\d)/i)?.[1] || '';
  const cnp = cnpLine.replace(/\D/g, '').slice(0, 13);
  const idMatch = String(text || '').match(/\bSERIA?\s+([A-Z0-9]{1,3})\s*(?:NR\.?|NO\.?)\s*(\d{4,8})/i);
  return { name: [lastName, firstName].filter(Boolean).join(' '), cnp, id: idMatch ? `${idMatch[1]} ${idMatch[2]}` : '' };
}
function admissionCandidateDetailsHtml() {
  return `<section class="admission-candidate-details" aria-labelledby="admission-candidate-title"><h3 id="admission-candidate-title">Date candidat</h3><div class="admission-candidate-grid"><label>Nume și prenume<input id="candidate-name" type="text" autocomplete="name"></label><label>CNP<input id="candidate-cnp" type="text" inputmode="numeric" maxlength="13" autocomplete="off"></label><label>ID / serie și număr<input id="candidate-id" type="text" autocomplete="off"></label><label>Callsign atribuit<input id="candidate-callsign" type="text" placeholder="M-510" autocomplete="off"></label></div><label class="candidate-document-upload">Fotografie buletin<input id="candidate-document" type="file" accept="image/*"></label><label class="admission-photo-consent"><input id="candidate-photo-consent" type="checkbox"> Candidatul a fost informat și este de acord ca fotografia buletinului să fie trimisă pe Discord.</label><p id="candidate-document-status" class="muted" aria-live="polite"></p></section>`;
}
function admissionCandidateSummary(result) {
  const value = selector => document.querySelector(selector)?.value?.trim() || '—';
  return [`Nume candidat: ${value('#candidate-name')}`, `CNP: ${value('#candidate-cnp')}`, `ID: ${value('#candidate-id')}`, `Callsign atribuit: ${value('#candidate-callsign')}`, `Rezultat: ${result}`].join('\n');
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
  const worker = await tesseract.createWorker('eng');
  try {
    const result = await worker.recognize(file);
    return parseIdentityCardText(result.data.text);
  } finally {
    await worker.terminate();
  }
}
async function encodeIdentityPhoto(file) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.84, 0.7, 0.56]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 2 * 1024 * 1024) {
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
  const maxWrong = maxWrongForTest(testName, definition.maxWrong);
  const candidateDetails = isAdmissionTest ? admissionCandidateDetailsHtml() : '';
  const admissionChecks = isAdmissionTest ? admissionChecklistHtml() : '';
  const description = isAdmissionTest ? 'Candidatul poate greși de maximum 2 ori; la a 3-a greșeală este respins. Promovare: minimum 17/20.' : definition.description;
  const images = (definition.images || []).map(image => `<a class="test-image-link" href="${image.url}" target="_blank" rel="noopener">${image.label || 'Deschide imaginea'}</a>`).join('');
  const cases = (definition.cases || []).map((item, index) => `<option value="${index}">${item.title}</option>`).join('');
  const practical = (definition.practical || []).map((item, index) => `<option value="${index}">${item.name}</option>`).join('');
  const candidateCallsign = isAdmissionTest ? '' : '<label class="candidate-call-sign">Callsign candidat<input id="candidate-callsign" type="text" placeholder="510 sau M-510"></label>';
  const candidateDocument = !isAdmissionTest && (testName === 'Test transfer' || testName === 'Adeverință medicală') ? '<label>Imagine document candidat<input id="candidate-document" type="file" accept="image/*"></label><p class="muted">Imaginea este disponibilă testerului pentru verificare manuală.</p>' : '';
  const questionForm = questions.length ? `<form id="test-form" class="question-list">${candidateCallsign}<div id="candidate-summary" class="candidate-summary"></div>${candidateDocument}${questions.map((question, index) => `<fieldset><legend>${index + 1}. ${question.text}</legend><div class="correct-answer"><b>Răspuns:</b><span>${question.answer || 'Verifică ghidul.'}</span></div><label class="answer-check"><input type="checkbox" data-wrong="${index}"> Răspuns greșit</label></fieldset>`).join('')}<p>Greșeli: <strong id="wrong-count">0</strong> / ${Number.isFinite(maxWrong) ? maxWrong : '—'}</p><button class="primary" type="submit">Finalizează evaluarea</button></form>` : '<div class="test-runner"><p>Acest ghid nu are întrebări teoretice configurate.</p></div>';
  const gatedQuestionForm = isAdmissionTest && questions.length ? `<div id="admission-test-content" hidden>${questionForm}</div>` : questionForm;
  return `<div class="panel view-panel"><div class="panel-head"><div><p class="eyebrow">GHID PENTRU TESTER</p><h2>${testName}</h2><p class="muted">Acces permanent pentru testerul conectat: ${normalizeCallsign(currentUser?.callsign)}.</p></div><button class="outline" id="back-to-tests">← Înapoi</button></div>${candidateDetails}${admissionChecks}<p class="muted">${description}</p><p class="test-instructions">${definition.instructions || ''}</p>${images ? `<div class="test-images">${images}</div>` : ''}${cases ? `<label>Cazul ales de candidat<select id="case-select">${cases}</select></label><div id="case-steps" class="case-steps"></div>` : ''}${practical ? `<label>Probă practică<select id="practical-select">${practical}</select></label><div id="practical-steps" class="case-steps"></div>` : ''}${gatedQuestionForm}</div>`;
}
function wireTestEvents(testName, definition) {
  document.querySelector('#back-to-tests').onclick = () => renderView('tests');
  if (testName === 'Test admitere') {
    const checks = [...document.querySelectorAll('[data-admission-check]')];
    const testContent = document.querySelector('#admission-test-content');
    const updateAdmissionGate = () => {
      const complete = admissionChecksComplete(checks.map(check => check.checked));
      checks.forEach(check => { check.closest('.admission-check-row').classList.toggle('is-incomplete', !check.checked); });
      if (testContent) testContent.hidden = !complete;
    };
    checks.forEach(check => check.onchange = updateAdmissionGate);
    updateAdmissionGate();
    const documentInput = document.querySelector('#candidate-document');
    const documentStatus = document.querySelector('#candidate-document-status');
    if (documentInput) documentInput.onchange = async () => {
      const file = documentInput.files?.[0];
      if (!file) return;
      documentStatus.textContent = 'Se citesc datele de pe buletin în browser...';
      try {
        const details = await readIdentityCard(file);
        if (details.name) document.querySelector('#candidate-name').value = details.name;
        if (details.cnp) document.querySelector('#candidate-cnp').value = details.cnp;
        if (details.id) document.querySelector('#candidate-id').value = details.id;
        documentStatus.textContent = details.name || details.cnp || details.id
          ? 'Datele au fost completate automat. Verifică-le înainte de continuare.'
          : 'Nu am putut identifica datele. Completează câmpurile manual.';
      } catch (error) {
        console.error('Identity card OCR failed:', error);
        documentStatus.textContent = 'Citirea automată nu este disponibilă. Completează câmpurile manual.';
      }
    };
  }
  const caseSelect = document.querySelector('#case-select'); const caseSteps = document.querySelector('#case-steps');
  const renderCase = () => { if (!caseSelect || !caseSteps) return; const item = definition.cases[Number(caseSelect.value)]; caseSteps.innerHTML = `<h3>${item.title}</h3><p>Minimum interacțiuni: ${item.minimumMe || 0} /me</p><ol>${item.steps.map(step => `<li>${step}</li>`).join('')}</ol>`; }; if (caseSelect) { caseSelect.onchange = renderCase; renderCase(); }
  const practicalSelect = document.querySelector('#practical-select'); const practicalSteps = document.querySelector('#practical-steps');
  const renderPractical = () => { if (!practicalSelect || !practicalSteps) return; const item = definition.practical[Number(practicalSelect.value)]; practicalSteps.innerHTML = `<h3>${item.name}</h3><p><b>Locație:</b> ${item.location}</p><p><b>Altitudine:</b> ${item.altitude}</p><p><b>Aterizare:</b> ${item.landing}</p>${(item.images || []).map(image => `<a class="test-image-link" href="${image.url}" target="_blank" rel="noopener">${image.label || 'Imagine traseu'}</a>`).join('')}`; }; if (practicalSelect) { practicalSelect.onchange = renderPractical; renderPractical(); }
  const wrongInputs = [...document.querySelectorAll('[data-wrong]')]; wrongInputs.forEach(input => input.onchange = () => { document.querySelector('#wrong-count').textContent = wrongInputs.filter(item => item.checked).length; });
  const candidateInput = document.querySelector('#candidate-callsign'); const candidateSummaryEl = document.querySelector('#candidate-summary'); if (candidateInput && testName !== 'Test admitere') candidateInput.oninput = () => { const member = directoryMembers.find(item => normalizeCallsign(item.callsign) === normalizeCallsign(candidateInput.value)); candidateSummaryEl.textContent = member ? candidateSummary(member) : ''; };
  const form = document.querySelector('#test-form'); if (form) form.onsubmit = async event => {
    event.preventDefault();
    const wrong = wrongInputs.filter(item => item.checked).length;
    const limit = maxWrongForTest(testName, definition.maxWrong);
    const result = isTestFailed(wrong, limit) ? 'Respins (CS)' : 'Admis';
    const member = directoryMembers.find(item => normalizeCallsign(item.callsign) === normalizeCallsign(candidateInput?.value));
    let admissionDetails = {};
    let status = 'Testul a fost înregistrat.';
    if (testName === 'Test admitere') {
      const candidateName = document.querySelector('#candidate-name').value.trim();
      const candidateCallsign = document.querySelector('#candidate-callsign').value.trim();
      const photo = document.querySelector('#candidate-document').files?.[0];
      const consent = document.querySelector('#candidate-photo-consent').checked;
      const statusElement = document.querySelector('#candidate-document-status');
      if (!candidateName || !candidateCallsign || !photo || !consent) {
        statusElement.textContent = 'Completează numele și callsign-ul, încarcă buletinul și confirmă acordul candidatului.';
        statusElement.classList.add('error-text');
        return;
      }
      try {
        admissionDetails = { candidateName, candidateCallsign, identityConsent: true, identityImage: await encodeIdentityPhoto(photo) };
      } catch (error) {
        statusElement.textContent = error.message;
        statusElement.classList.add('error-text');
        return;
      }
    }
    try {
      const saved = await recordTestRun(testName, result, admissionDetails);
      if (testName === 'Test admitere' && !saved.discordNotificationsSent) status = 'Rezultatul a fost salvat, dar notificările Discord nu au fost trimise. Verifică setările webhook.';
    }
    catch (error) { status = `Rezultatul a fost afișat, dar numărătoarea nu s-a salvat: ${error.message}`; }
    const summary = testName === 'Test admitere' ? admissionCandidateSummary(result) : candidateSummary(member, result) || `Rezultat: ${result}`;
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
    selectedMember = { ...member };
    selectedGrantDraft = normalizeGrantBundle([...(member.grantedTests || []), ...docsAssignedTests(member)]);
    renderGrantChecks(catalog);
    memberResult.textContent = `${memberNameFor(member)} · ${normalizeCallsign(member.callsign)}`;
  } else { selectedMember = null; selectedGrantDraft = []; memberResult.textContent = ''; lookupMember(); }
}
document.querySelector('#add-btn').onclick = () => openAddModal();
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
    ? `<label><input type="checkbox" value="${TESTER_BUNDLE_KEY}"> Tester (admitere, transfer, adeverință)</label>${otherTests.map(test => `<label><input type="checkbox" value="${escapeHtml(test)}"> ${escapeHtml(test)}</label>`).join('')}`
    : granted.length
      ? granted.map(test => `<label><input type="checkbox" value="${escapeHtml(test)}"> ${escapeHtml(test)}</label>`).join('')
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
    if (updated) { updated.grantedTests = grant.grantedTests || next; updated.updatedAt = grant.updatedAt; }
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
let selectedMember=null;
let selectedGrantDraft=[];
async function lookupMember() {
  const value = callsignInput.value.trim();
  if (!value) { selectedMember = null; selectedGrantDraft = []; memberResult.textContent = ''; return; }
  const normalized = normalizeCallsign(value);
  const member = directoryMembers.find(item => normalizeCallsign(item.callsign) === normalized && String(item.name || '').trim());
  const local = testers.find(item => normalizeCallsign(item.callsign) === normalized);
  if (!member) { selectedMember = null; selectedGrantDraft = []; memberResult.textContent = 'Callsign inexistent, liber sau fără nume în lista departamentului.'; grantChecks.innerHTML = ''; return; }
  selectedMember = { ...member, ...local, callsign: normalized, name: member.name, functions: member.functions, grantedTests: normalizeGrantBundle([...(member.grantedTests || []), ...(local?.grantedTests || [])]) };
  selectedGrantDraft = normalizeGrantBundle([...selectedMember.grantedTests, ...docsAssignedTests(member)]);
  memberResult.textContent = `${member.name} · ${normalized}`;
  renderGrantChecks(catalog);
}
function renderGrantChecks(options) {
  const hasTesterBundle = coreTests.every(test => selectedGrantDraft.includes(test));
  const otherTests = options.filter(test => !coreTests.includes(test));
  grantChecks.innerHTML = `<button type="button" class="grant-preset" id="tester-preset">Preia testele din Docs</button><label><input type="checkbox" value="${TESTER_BUNDLE_KEY}" ${hasTesterBundle ? 'checked' : ''}> Tester (admitere, transfer, adeverință)</label>${otherTests.map(test => `<label><input type="checkbox" value="${escapeHtml(test)}" ${selectedGrantDraft.includes(test) ? 'checked' : ''}> ${escapeHtml(test)}</label>`).join('')}`;
  grantChecks.querySelectorAll('input[type="checkbox"]').forEach(input => input.onchange = () => {
    const checked = [...grantChecks.querySelectorAll('input:checked')].flatMap(item => item.value === TESTER_BUNDLE_KEY ? coreTests : [item.value]);
    selectedGrantDraft = normalizeGrantBundle(checked);
  });
  document.querySelector('#tester-preset').onclick = () => { selectedGrantDraft = normalizeGrantBundle([...(selectedMember?.grantedTests || []), ...docsAssignedTests(selectedMember)]); renderGrantChecks(options); };
}
callsignInput.onchange=lookupMember;callsignInput.oninput=()=>{clearTimeout(window.lookupTimer);window.lookupTimer=setTimeout(lookupMember,350)};
document.querySelector('#invite-btn').onclick = async () => {
  if (!selectedMember) { memberResult.textContent = 'Selectează un membru existent.'; return; }
  const checked = [...grantChecks.querySelectorAll('input:checked')].map(input => input.value);
  const granted = normalizeGrantBundle(checked.flatMap(test => test === TESTER_BUNDLE_KEY ? coreTests : [test]));
  const normalized = normalizeCallsign(selectedMember.callsign);
  if (!normalized) { memberResult.textContent = 'Callsign invalid.'; return; }
  if (!selectedMember.discordId) { memberResult.textContent = 'Membrul nu are un Discord ID pe coloana T; nu i se poate salva accesul.'; return; }
  const button = document.querySelector('#invite-btn');
  button.disabled = true; button.textContent = 'Se salvează…';
  try {
    const saved = await saveRemoteGrant(normalized, granted, false, selectedMember.discordId);
    const grant = saved?.grant || { discordId: selectedMember.discordId, callsign: normalized, grantedTests: granted, updatedAt: new Date().toISOString() };
    const merged = { ...selectedMember, ...grant, grantedTests: grant.grantedTests || granted, name: selectedMember.name, callsign: normalized };
    const existing = testers.find(item => normalizeCallsign(item.callsign) === normalized);
    if (existing) Object.assign(existing, merged); else testers.push(merged);
    saveTesters();
    renderRows();
    renderDashboardData();
    refreshCurrentView();
    modal.classList.remove('open');
  } catch (error) { memberResult.textContent = error.message || 'Salvarea a eșuat.'; }
  finally { button.disabled = false; button.innerHTML = 'Salvează accesul →'; }
};
document.querySelector('#search').oninput = () => renderRows();
document.querySelector('#test-summary-grid')?.addEventListener('click', event => {
  const button = event.target.closest('[data-summary-member]');
  if (!button) return;
  expandedSummaryMember = expandedSummaryMember === button.dataset.summaryMember ? '' : button.dataset.summaryMember;
  renderDashboardData();
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
testerGroups?.addEventListener('click', event => { const button = event.target.closest('[data-member-menu]'); if (!button) return; const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberMenu); if (member) { selectedMember = member; openAddModal(member); } }); rows?.addEventListener('click', event => { const button = event.target.closest('[data-member-menu]'); if (!button) return; const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberMenu); if (member) { selectedMember = member; openAddModal(member); } }); document.querySelector('#brand-settings').onclick = () => navigateTo('settings'); document.querySelector('#user-menu').onclick = () => navigateTo('settings'); document.querySelector('#top-avatar').onclick = () => navigateTo('settings'); document.querySelector('#help-btn').onclick = () => alert('Folosește meniul din stânga pentru a naviga.');
const labels = { overview: 'Dashboard', testers: 'Testerii departamentului', tests: 'Teste disponibile', members: 'Membri departament', settings: 'Setări' };
function navigateTo(view, { push = true } = {}) {
  if (!labels[view]) return;
  if (push && window.history.state?.view !== view) window.history.pushState({ view }, '', `#${view}`);
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  document.querySelector('#page-label').textContent = labels[view];
  document.querySelector('#section-label').textContent = view === 'settings' || view === 'members' ? 'Administrare' : 'Generale';
  document.querySelector('.sidebar').classList.remove('open');
  renderView(view);
  if (view === 'tests') document.querySelector('#test-count').textContent = allowedForUser(currentUser).length;
}
document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));
window.addEventListener('popstate', event => {
  if (!currentUser) return;
  if (event.state?.view === 'test' && event.state.testName) return openTest(event.state.testName);
  navigateTo(event.state?.view || 'overview', { push: false });
});
window.addEventListener('hashchange', () => {
  if (!currentUser || window.location.hash.startsWith('#test-')) return;
  const view = window.location.hash.slice(1);
  navigateTo(labels[view] ? view : 'overview', { push: false });
});
document.querySelector('.mobile-menu').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
window.setInterval(() => { markPresence(); sendPresence(); renderRows(); }, 30000);
window.setInterval(async () => { if (!currentUser) return; try { await loadDirectory(); await loadRemoteGrants(); } catch { /* următoarea sincronizare va reîncerca */ } }, 60*60*1000);
const today=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());document.querySelector('#today-label').textContent=today.toUpperCase();document.querySelector('#test-count').textContent=catalog.length;

// Fluxul OAuth: Discord redirecționează înapoi cu ?code=..., apoi codul este trimis server-side către API-ul Vercel.
const authScreen=document.querySelector('#auth-screen');
const appShell=document.querySelector('#app-shell');
const authError=document.querySelector('#auth-error');
const AUTH_API_ENDPOINT='/api/auth/discord';
const LOGIN_ENDPOINT='/api/auth/login';
const AUTH_STORAGE_KEY='medici-auth';
const AUTH_SCHEMA_VERSION=3;
const AUTH_TTL=2*24*60*60*1000;
// ===== BANDAL TEMPORAR PENTRU TESTARE =====
// Set to true only for a local preview; production uses Discord authentication.
const DEV_LOGIN_ENABLED=['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
const DEV_LOGIN_USER={ id:'DEV-001', discordId:'0', name:'Tester Local', displayName:'Tester Local', callsign:'M-001', callSign:'M-001', csNum:1, rank:'Medic Inspector', dept:'Departamentul Medical', functions:'TESTER', isLeadership:true, isConducere:true, accessLevel:'leadership', gradeGroup:'leadership', allowedTests:[...coreTests,...specialtyTests], eligibleSpecializations:[], grantedTests:[...coreTests,...specialtyTests], avatar:null };
// ===== SFÂRȘIT BANDAL =====
const PRESENCE_KEY='medici-presence';
function markPresence() { if (!currentUser?.discordId) return; const presence = readStored(PRESENCE_KEY, {}); presence[currentUser.discordId] = Date.now(); localStorage.setItem(PRESENCE_KEY, JSON.stringify(presence)); }
function isActive(member) { return Number(member.lastSeen || 0) > Date.now() - 120000; }
async function sendPresence() { if (!currentUser?.discordId) return; await fetch('/api/access/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discordId: currentUser.discordId }) }).catch(() => {}); }
window.addEventListener('storage', event => { if (event.key === PRESENCE_KEY) { renderRows(); refreshCurrentView(); } });
function initialsFrom(name='User'){return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
/** @param {any} user @returns {{name:string, initials:string, callsign:string}} */
function setWelcomeHeader(user){
  const name = user.name || user.displayName || 'Utilizator';
  const initials = initialsFrom(name);
  const first = name.split(/\s+/)[0];
  const callsign = normalizeCallsign(user.callsign || user.callSign);
  user.callsign = callsign;
  document.querySelector('#welcome-name').textContent = first;
  document.querySelector('#user-name').textContent = name;
  document.querySelector('#user-role').textContent = isLeadershipUser(user) ? 'Conducere' : 'Tester';
  document.querySelector('#top-avatar').textContent = initials;
  document.querySelector('.user-mini .avatar').textContent = initials;
  if (callsign) document.querySelector('.welcome .muted').textContent = `${callsign} · Acces sincronizat din departament.`;
  return { name, initials, callsign };
}
/** @param {any} user @returns {void} */
function setVisibilityPermissions(user){
  const leadership = isLeadershipUser(user);
  const addBtn = document.querySelector('#add-btn');
  const removeBtn = document.querySelector('#remove-btn');
  const membersNav = document.querySelector('[data-view="members"]');
  if (addBtn) addBtn.hidden = !leadership;
  if (removeBtn) removeBtn.hidden = !leadership;
  if (membersNav) membersNav.hidden = !leadership;
  const sectionLabel = document.querySelector('#section-label');
  if (sectionLabel) sectionLabel.textContent = leadership ? 'Administrare' : 'Spațiul tău';
}
/** @param {any} user @returns {void} */
function setStats(user){
  const stat = document.querySelector('.stat-card:nth-child(2) strong');
  if (stat) stat.textContent = allowedForUser(user).length;
}
/** @param {any} user @returns {void} */
function applyUser(user){
  currentUser = user;
  setWelcomeHeader(user); setVisibilityPermissions(user); setStats(user);
}
function showAuthError(message){authError.textContent=message;authError.classList.add('show')}
async function enterApp(user){applyUser(user);markPresence();sendPresence();authScreen.style.display='none';appShell.classList.add('ready');window.history.replaceState({ view: 'overview' }, '', `${window.location.pathname}#overview`);navigateTo('overview', { push: false });try { await loadDirectory(); await loadRemoteGrants(); } catch (error) { setSyncDetail('Sincronizarea a eșuat'); console.error(error); }}
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
async function verifyCachedUser(user) {
  if (!user?.discordId) return false;
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin' });
    if (response.status === 401) return false;
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return Boolean(payload?.authorized);
  } catch { return false; }
}
async function startSession(){
  if(DEV_LOGIN_ENABLED){ return enterApp({ ...DEV_LOGIN_USER }); }
  try{
    const callbackUser=await exchangeCallbackCode(); if(callbackUser) return enterApp(callbackUser);
    const cached=readStored(AUTH_STORAGE_KEY, null);
    if(cached?.version===AUTH_SCHEMA_VERSION&&cached?.user&&cached.expiresAt>Date.now()&&await verifyCachedUser(cached.user)) return enterApp(cached.user);
    localStorage.removeItem(AUTH_STORAGE_KEY); throw new Error('not-authorized');
  }catch(error){appShell.classList.remove('ready');const message=error.message==='not-authorized'?'Conectează-te cu Discord pentru a verifica accesul.':error.message;showAuthError(message)}
}
const discordLoginBtn = document.querySelector('#discord-login');
if (discordLoginBtn) {
  if (DEV_LOGIN_ENABLED) {
    document.querySelector('.auth-card h1').textContent = 'Intră pe site';
    document.querySelector('.auth-copy').textContent = 'Accesează site-ul fără conectare Discord.';
    document.querySelector('.auth-preview b').textContent = 'Acces demo';
    document.querySelector('.auth-preview small').textContent = 'Cont de previzualizare';
    document.querySelector('.auth-note').hidden = true;
    discordLoginBtn.innerHTML = 'Intră pe site <span>→</span>';
    discordLoginBtn.onclick = () => enterApp({ ...DEV_LOGIN_USER });
  } else {
    discordLoginBtn.onclick = () => { window.location.href = LOGIN_ENDPOINT; };
  }
}
startSession();
