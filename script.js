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
const specialtyTests = ['Test ALS','Test SMULS','Test MOTO','Test PILOT','Test parașutiști'];
const docsTesterFilters = ['Test SMULS', 'Test ALS'];
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
let testers = readStored(GRANTS_KEY, []);
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
    refreshCurrentView();
    return;
  }
  if (isLeadershipUser(currentUser)) {
    const grants = grantsPayload;
    testers = directoryMembers.length ? directoryMembers.filter(member => member.isTester || memberIsTester(member)).map(member => { const grant = grants.find(item => item.discordId === member.discordId);
      if (!grant) return member;
      return { ...member, ...grant, grantedTests: grant.grantedTests || member.grantedTests || [] }; }) : grants;
  } else {
    const ownGrant = grantsPayload.find(grant => grant.discordId === currentUser.discordId);
    currentUser.grantedTests = ownGrant?.grantedTests || currentUser.grantedTests || [];
    testers = ownGrant ? [ownGrant] : [];
  }
  saveTesters();
  renderRows();
  refreshCurrentView();
}
async function saveRemoteGrant(callsign, grantedTests, remove = false, targetDiscordId = '') {
  if (!currentUser?.discordId) throw new Error('Sesiunea nu conține Discord ID.');
  const response = await fetch('/api/access/grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requesterId: currentUser.discordId, targetDiscordId, callsign, grantedTests, remove }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Accesul nu a putut fi salvat.');
  return payload;
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
function allowedForUser(user) { if (isLeadershipUser(user)) return catalog; return [...new Set(user?.grantedTests || [])].filter(test => catalog.includes(test) && testDefinitions[test]); }
/** @param {any} value @returns {string} */
function dateOnly(value) { return value ? new Date(value).toLocaleDateString('ro-RO') : '—'; }
/** @param {any} member @returns {boolean} */
/** @param {any} value @returns {string} */
function normalizeText(value) { return String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function memberCanGiveTest(member, test) {
  const functions = normalizeText(member?.functions);
  if (test === 'Test SMULS') return /S\.?\s*M\.?\s*U\.?\s*L\.?\s*S\.?|\s*S\s*\|/.test(functions);
  if (test === 'Test ALS') return /A\.?\s*L\.?\s*S\.?|\s*A\s*\|/.test(functions);
  return false;
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
  const assignedTests = member.grantedTests || [];
  if (isLeadershipUser(member)) return '<span class="muted">Acces general</span>';
  return assignedTests.length
    ? assignedTests.map((test, i) => `<span class="tag ${i % 3 === 1 ? 'orange' : i % 3 === 2 ? 'cyan' : ''}">${escapeHtml(test)}</span>`).join('')
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
  directoryMembers = payload.members || [];
  if (isLeadershipUser(currentUser)) {
    testers = directoryMembers.filter(member => member.isTester || memberIsTester(member)).map(member => ({ ...member, grantedTests: member.grantedTests || [] }));
    saveTesters();
  }
  renderRows();
  renderDashboardData();
  refreshCurrentView();
}
function renderDashboardData() {
  const counts = Object.fromEntries(specialtyTests.map(test => [test, testers.filter(member => (member.grantedTests || []).includes(test)).length]));
  const roleBars = document.querySelector('#role-bars');
  roleBars.innerHTML = specialtyTests.map(test => `<div class="role-row"><span>${test.replace('Test ', '')}</span><strong>${counts[test] || 0}</strong><div class="bar"><i style="width:${Math.min((counts[test] || 0) * 20, 100)}%"></i></div></div>`).join('');
  const overview = document.querySelector('#overview-view');
  if (overview) overview.dataset.updatedAt = new Date().toISOString();
  document.querySelector('#sync-panel')?.toggleAttribute('hidden', !isLeadershipUser(currentUser));
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
  wireTestEvents(definition);
}
function buildTestMarkup(testName, definition, questions) {
  const images = (definition.images || []).map(image => `<a class="test-image-link" href="${image.url}" target="_blank" rel="noopener">${image.label || 'Deschide imaginea'}</a>`).join('');
  const cases = (definition.cases || []).map((item, index) => `<option value="${index}">${item.title}</option>`).join('');
  const practical = (definition.practical || []).map((item, index) => `<option value="${index}">${item.name}</option>`).join('');
  return `<div class="panel view-panel"><div class="panel-head"><div><p class="eyebrow">GHID PENTRU TESTER</p><h2>${testName}</h2><p class="muted">Acces permanent pentru testerul conectat: ${normalizeCallsign(currentUser?.callsign)}.</p></div><button class="outline" id="back-to-tests">← Înapoi</button></div><p class="muted">${definition.description}</p><p class="test-instructions">${definition.instructions || ''}</p>${images ? `<div class="test-images">${images}</div>` : ''}${cases ? `<label>Cazul ales de candidat<select id="case-select">${cases}</select></label><div id="case-steps" class="case-steps"></div>` : ''}${practical ? `<label>Probă practică<select id="practical-select">${practical}</select></label><div id="practical-steps" class="case-steps"></div>` : ''}${questions.length ? `<form id="test-form" class="question-list"><label>Callsign candidat<input id="candidate-callsign" type="text" placeholder="510 sau M-510"></label><div id="candidate-summary" class="candidate-summary"></div>${testName === 'Test admitere' || testName === 'Test transfer' || testName === 'Adeverință medicală' ? `<label>Imagine document candidat<input id="candidate-document" type="file" accept="image/*"></label><p class="muted">Imaginea este disponibilă testerului pentru verificare manuală.</p>` : ''}${questions.map((question, index) => `<fieldset><legend>${index + 1}. ${question.text}</legend><div class="correct-answer"><b>Răspuns:</b><span>${question.answer || 'Verifică ghidul.'}</span></div><label class="answer-check"><input type="checkbox" data-wrong="${index}"> Răspuns greșit</label></fieldset>`).join('')}<p>Greșeli: <strong id="wrong-count">0</strong> / ${definition.maxWrong ?? '—'}</p><button class="primary" type="submit">Finalizează evaluarea</button></form>` : '<div class="test-runner"><p>Acest ghid nu are întrebări teoretice configurate.</p></div>'}</div>`;
}
function wireTestEvents(definition) {
  document.querySelector('#back-to-tests').onclick = () => renderView('tests');
  const caseSelect = document.querySelector('#case-select'); const caseSteps = document.querySelector('#case-steps');
  const renderCase = () => { if (!caseSelect || !caseSteps) return; const item = definition.cases[Number(caseSelect.value)]; caseSteps.innerHTML = `<h3>${item.title}</h3><p>Minimum interacțiuni: ${item.minimumMe || 0} /me</p><ol>${item.steps.map(step => `<li>${step}</li>`).join('')}</ol>`; }; if (caseSelect) { caseSelect.onchange = renderCase; renderCase(); }
  const practicalSelect = document.querySelector('#practical-select'); const practicalSteps = document.querySelector('#practical-steps');
  const renderPractical = () => { if (!practicalSelect || !practicalSteps) return; const item = definition.practical[Number(practicalSelect.value)]; practicalSteps.innerHTML = `<h3>${item.name}</h3><p><b>Locație:</b> ${item.location}</p><p><b>Altitudine:</b> ${item.altitude}</p><p><b>Aterizare:</b> ${item.landing}</p>${(item.images || []).map(image => `<a class="test-image-link" href="${image.url}" target="_blank" rel="noopener">${image.label || 'Imagine traseu'}</a>`).join('')}`; }; if (practicalSelect) { practicalSelect.onchange = renderPractical; renderPractical(); }
  const wrongInputs = [...document.querySelectorAll('[data-wrong]')]; wrongInputs.forEach(input => input.onchange = () => { document.querySelector('#wrong-count').textContent = wrongInputs.filter(item => item.checked).length; });
  const candidateInput = document.querySelector('#candidate-callsign'); const candidateSummaryEl = document.querySelector('#candidate-summary'); if (candidateInput) candidateInput.oninput = () => { const member = directoryMembers.find(item => normalizeCallsign(item.callsign) === normalizeCallsign(candidateInput.value)); candidateSummaryEl.textContent = member ? candidateSummary(member) : ''; };
  const form = document.querySelector('#test-form'); if (form) form.onsubmit = event => { event.preventDefault(); const wrong = wrongInputs.filter(item => item.checked).length; const limit = Number(definition.maxWrong ?? Infinity); const failed = wrong > limit; const member = directoryMembers.find(item => normalizeCallsign(item.callsign) === normalizeCallsign(candidateInput?.value)); const result = failed ? 'Respins (CS)' : 'Admis'; form.innerHTML = `<pre class="candidate-summary">${candidateSummary(member, result) || `Rezultat: ${result}`}</pre>`; };
}
renderRows();
const modal = document.querySelector('#modal'); const callsignInput=document.querySelector('#callsign'); const memberResult=document.querySelector('#member-result'); const grantChecks=document.querySelector('#grant-checks');
function openAddModal(member) {
  if (!isLeadershipUser(currentUser)) { alert('Doar conducerea poate acorda acces.'); return; }
  modal.classList.add('open');
  callsignInput.value = member ? normalizeCallsign(member.callsign) : '';
  grantChecks.innerHTML = '';
  if (member) { selectedMember = { ...member }; renderGrantChecks(catalog); memberResult.textContent = `${memberNameFor(member)} · ${normalizeCallsign(member.callsign)}`; }
  else { selectedMember = null; memberResult.textContent = ''; lookupMember(); }
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
  removeTestChecks.innerHTML = granted.length
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
  const toRemove = [...removeTestChecks.querySelectorAll('input:checked')].map(input => input.value);
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
async function lookupMember(){const value=callsignInput.value.trim();if(!value){selectedMember=null;memberResult.textContent='';return} const normalized=normalizeCallsign(value);const member=directoryMembers.find(item=>normalizeCallsign(item.callsign)===normalized);const local=testers.find(item=>normalizeCallsign(item.callsign)===normalized);if(!member){selectedMember=null;memberResult.textContent='Callsign inexistent sau liber în lista departamentului.';grantChecks.innerHTML='';return}selectedMember={...member,...local, callsign:normalized, name:member.name, grantedTests:local?.grantedTests||member.grantedTests||[]};memberResult.textContent=`${member.name} · ${normalized}`;renderGrantChecks(catalog)}
function renderGrantChecks(options){grantChecks.innerHTML=`<button type="button" class="grant-preset" id="tester-preset">Acordă acces la testele de bază</button>${options.map(test=>`<label><input type="checkbox" value="${test}" ${selectedMember?.grantedTests?.includes(test)?'checked':''}> ${test}</label>`).join('')}`;document.querySelector('#tester-preset').onclick=()=>{selectedMember.grantedTests=[...new Set([...(selectedMember.grantedTests||[]),...coreTests])];memberResult.textContent='Testele de bază au fost selectate.';renderGrantChecks(options)}}
callsignInput.onchange=lookupMember;callsignInput.oninput=()=>{clearTimeout(window.lookupTimer);window.lookupTimer=setTimeout(lookupMember,350)};
document.querySelector('#invite-btn').onclick = async () => {
  if (!selectedMember) { memberResult.textContent = 'Selectează un membru existent.'; return; }
  const checked = [...grantChecks.querySelectorAll('input:checked')].map(input => input.value);
  const granted = [...new Set(checked)];
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
testerGroups?.addEventListener('click', event => { const button = event.target.closest('[data-member-menu]'); if (!button) return; const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberMenu); if (member) { selectedMember = member; openAddModal(member); } }); rows?.addEventListener('click', event => { const button = event.target.closest('[data-member-menu]'); if (!button) return; const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberMenu); if (member) { selectedMember = member; openAddModal(member); } }); document.querySelector('#brand-settings').onclick = () => navigateTo('settings'); document.querySelector('#user-menu').onclick = () => navigateTo('settings'); document.querySelector('#top-avatar').onclick = () => navigateTo('settings'); document.querySelector('#help-btn').onclick = () => alert('Folosește meniul din stânga pentru a naviga.'); document.querySelector('#sync-btn').onclick = async e => { e.currentTarget.disabled=true; e.currentTarget.textContent='Sincronizare...'; try { await loadDirectory(); await loadRemoteGrants(); document.querySelector('#sync-detail').textContent='Actualizat acum'; document.querySelector('#last-sync').textContent=new Date().toLocaleDateString('ro-RO'); } catch { document.querySelector('#sync-detail').textContent='Sincronizarea a eșuat'; } finally { e.currentTarget.disabled=false; e.currentTarget.textContent='Sincronizează acum'; } };
const labels = { overview: 'Dashboard', testers: 'Testerii departamentului', tests: 'Teste disponibile', members: 'Membri departament', settings: 'Setări' };
function navigateTo(view, { push = true } = {}) {
  if (!labels[view]) return;
  if (push && window.history.state?.view !== view) window.history.pushState({ view }, '', `#${view}`);
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  document.querySelector('#page-label').textContent = labels[view];
  document.querySelector('#section-label').textContent = view === 'settings' || view === 'members' ? 'Administrare' : 'Generale';
  document.querySelector('.sidebar').classList.remove('open');
  renderView(view);
  if (view === 'tests') { document.querySelector('#test-count').textContent = allowedForUser(currentUser).length; document.querySelector('#local-state').textContent = 'Sincronizat'; }
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
const today=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());document.querySelector('#today-label').textContent=today.toUpperCase();document.querySelector('#test-count').textContent=catalog.length;document.querySelector('#local-state').textContent='Pregătit';

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
  const syncPanel = document.querySelector('#sync-panel');
  if (addBtn) addBtn.hidden = !leadership;
  if (removeBtn) removeBtn.hidden = !leadership;
  if (membersNav) membersNav.hidden = !leadership;
  if (syncPanel) syncPanel.hidden = !leadership;
  const sectionLabel = document.querySelector('#section-label');
  if (sectionLabel) sectionLabel.textContent = leadership ? 'Administrare' : 'Spațiul tău';
}
/** @param {any} user @returns {void} */
function setStats(user){
  const stat = document.querySelector('.stat-card:nth-child(2) strong');
  if (stat) stat.textContent = allowedForUser(user).length;
  const localState = document.querySelector('#local-state');
  if (localState) localState.textContent = 'Sincronizat';
}
/** @param {any} user @returns {void} */
function applyUser(user){
  currentUser = user;
  setWelcomeHeader(user); setVisibilityPermissions(user); setStats(user);
}
function showAuthError(message){authError.textContent=message;authError.classList.add('show')}
async function enterApp(user){applyUser(user);markPresence();sendPresence();authScreen.style.display='none';appShell.classList.add('ready');window.history.replaceState({ view: 'overview' }, '', `${window.location.pathname}#overview`);navigateTo('overview', { push: false });try { await loadDirectory(); await loadRemoteGrants(); } catch (error) { document.querySelector('#sync-detail').textContent='Sincronizarea a eșuat'; console.error(error); }}
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
