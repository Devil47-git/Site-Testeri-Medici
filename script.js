const coreTests = ['Test admitere','Test transfer','Adeverință medicală'];
const specialtyTests = ['Test ALS','Test SMULS','Test MOTO','Test PILOT','Test parașutiști'];
const catalog = [...coreTests, ...specialtyTests];
const TEST_CATALOG_KEY = 'medici-test-catalog-v4';
let testDefinitions = JSON.parse(localStorage.getItem(TEST_CATALOG_KEY) || 'null') || window.MEDICAL_TESTS || Object.fromEntries(catalog.map(name => [name, { name, description: `Acces disponibil pentru ${name}.`, questions: [] }]));
function saveTestDefinitions() { localStorage.setItem(TEST_CATALOG_KEY, JSON.stringify(testDefinitions)); }
const rows = document.querySelector('#tester-rows');
const viewContent = document.querySelector('#view-content');
const roleColors = ['cyan','orange','violet','green'];
let activeTesterFilter = 'all';
const GRANTS_KEY = 'medici-grants';
let currentUser = null;
let testers = JSON.parse(localStorage.getItem(GRANTS_KEY) || '[]');
function saveTesters() { localStorage.setItem(GRANTS_KEY, JSON.stringify(testers)); }
function refreshCurrentView() { const active = document.querySelector('.nav-item.active')?.dataset.view || 'overview'; renderView(active); }
function candidateSummary(member, result = 'Admis') { if (!member) return ''; return `Candidat: @[${normalizeCallsign(member.callsign)}] ${member.name || '—'}\nGrad: ${member.rank || '—'}\nRezultat: ${result}`; }
async function loadRemoteGrants() {
  if (!currentUser?.discordId) return;
  const response = await fetch(`/api/access/grants?requesterId=${encodeURIComponent(currentUser.discordId)}`);
  if (!response.ok) return;
  const payload = await response.json();
  if (isLeadershipUser(currentUser)) {
    const grants = payload.grants || [];
    testers = directoryMembers.length ? directoryMembers.filter(member => member.isTester || memberIsTester(member)).map(member => { const grant = grants.find(item => item.discordId === member.discordId); return { ...member, ...grant, grantedTests: grant?.grantedTests || member.grantedTests || [] }; }) : grants;
  } else {
    const ownGrant = (payload.grants || []).find(grant => grant.discordId === currentUser.discordId);
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
function normalizeCallsign(value) { const number = String(value || '').replace(/\D/g, ''); return number ? `M-${number.padStart(3, '0')}` : ''; }
function isLeadershipUser(user) { const cs = Number(user?.csNum || String(user?.callsign || user?.callSign || '').replace(/\D/g, '')); return Boolean(user?.accessLevel === 'leadership' || user?.isConducere || user?.isLeadership || (cs >= 1 && cs <= 15)); }
function memberIsLeadership(member) { const cs = Number(member?.csNum || String(member?.callsign || '').replace(/\D/g, '')); return Boolean(member?.isLeadership || (cs >= 1 && cs <= 15)); }
function leadershipTitleForCallsign(value) { const cs = Number(String(value || '').replace(/\D/g, '')); if (cs === 1) return 'Director General'; if (cs >= 2 && cs <= 4) return 'Director Adjunct'; if (cs >= 5 && cs <= 8) return 'Medic Inspector'; if (cs >= 9 && cs <= 15) return 'Medic Chirurg'; return ''; }
function allowedForUser(user) { if (isLeadershipUser(user)) return catalog; return [...new Set([...(user?.allowedTests || []), ...(user?.eligibleSpecializations || []), ...(user?.grantedTests || [])])].filter(test => catalog.includes(test) && testDefinitions[test]); }
function dateOnly(value) { return value ? new Date(value).toLocaleDateString('ro-RO') : '—'; }
function memberIsTester(member) { return (member.grantedTests || []).length > 0 || (member.csNum >= 200 && member.csNum < 300) || /TESTER/.test(String(member.functions || '').toUpperCase()); }
function sortMembers(members) { return [...members].sort((a, b) => (a.csNum < 16 ? -1 : b.csNum < 16 ? 1 : a.csNum - b.csNum)); }
function syncCoreAccess(user) { if (user && (user.grantedTests || []).length) user.allowedTests = [...new Set([...(user.allowedTests || []), ...coreTests])]; }
function renderRows(list = testers) { rows.innerHTML = list.length ? list.map((t,index) => `<tr><td><div class="tester"><div class="avatar ${roleColors[index%roleColors.length]}">${initialsFrom(t.name || 'Membru')}</div>${t.name || 'Membru departament'}</div></td><td>${normalizeCallsign(t.callsign)}</td><td><div class="tags">${(t.grantedTests||[]).filter(test => !coreTests.includes(test)).map((x,i) => `<span class="tag ${i%3===1?'orange':i%3===2?'cyan':''}">${x}</span>`).join('')||'<span class="muted">Tester</span>'}</div></td><td>${dateOnly(t.updatedAt)}</td><td><span class="status ${isActive(t) ? 'online' : 'offline'}"><i></i>${isActive(t) ? 'Activ' : 'Inactiv'}</span></td><td><button class="more" data-member-menu="${normalizeCallsign(t.callsign)}">•••</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">Nu există testeri adăugați.</td></tr>'; document.querySelector('#tester-count').textContent=list.length;document.querySelector('#active-count').textContent=list.length; }
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
  if (view === 'tests') viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><h2>${title}</h2><p class="muted">Instrument pentru testeri. Tu poți deschide orice test disponibil oricând.</p></div></div><div class="test-cards">${allowedForUser(currentUser).map(test => `<article class="test-card"><h3>${test}</h3><p class="muted">${testDefinitions[test]?.description || 'Test disponibil.'}</p><button class="primary" data-test="${test}">Deschide ghidul</button></article>`).join('') || '<div class="empty-state">Nu ai teste disponibile.</div>'}</div></div>`;
  else if (view === 'testers') {
    const grouped = [{ title: 'TESTER GENERAL', members: testers.filter(member => (member.grantedTests || []).some(test => coreTests.includes(test)) && !(member.grantedTests || []).some(test => specialtyTests.includes(test))) }, ...specialtyTests.map(test => ({ title: test, members: testers.filter(member => (member.grantedTests || []).includes(test)) }))].filter(group => group.members.length);
    viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><h2>Testerii departamentului</h2><p class="muted">Testerii sunt grupați după specializare. Admiterea, transferul și adeverința sunt acces general.</p></div>${isLeadershipUser(currentUser) ? '<button class="primary" id="view-add">＋ Adaugă tester</button>' : ''}</div>${grouped.map(group => `<section class="tester-group"><h3>${group.title}</h3><div class="table-wrap"><table><thead><tr><th>TESTER</th><th>CALLSIGN</th><th>DATA</th><th>ACȚIUNI</th></tr></thead><tbody>${group.members.map(member => `<tr><td>${member.name || 'Membru departament'}</td><td>${normalizeCallsign(member.callsign)}</td><td>${dateOnly(member.updatedAt)}</td><td>${isLeadershipUser(currentUser) ? `<button type="button" class="outline danger-button" data-remove-member="${normalizeCallsign(member.callsign)}">Scoate accesul</button>` : '—'}</td></tr>`).join('')}</tbody></table></div></section>`).join('') || '<div class="empty-state">Nu există testeri.</div>'}</div>`;
  } else if (view === 'members') {
        const groups = ['Conducerea departamentului', ...new Set(directoryMembers.filter(member => !memberIsLeadership(member)).map(member => member.gradeGroup).sort((a, b) => Number(a) - Number(b)))];
    viewContent.innerHTML = `<div class="panel view-panel"><h2>Membri departament</h2><p class="muted">Membrii relevanți ai departamentului sunt grupați după conducere și grade.</p>${groups.map(group => { const members = sortMembers(directoryMembers.filter(member => group === 'Conducerea departament' ? memberIsLeadership(member) : !memberIsLeadership(member) && member.gradeGroup === group)); return members.length ? `<section class="member-group"><h3>${group}</h3><div class="table-wrap"><table><thead><tr><th>FUNCȚIE</th><th>NUME</th><th>CALLSIGN</th><th>GRAD</th></tr></thead><tbody>${members.map(member => `<tr><td>${member.leadershipTitle || leadershipTitleForCallsign(member.callsign) || member.functions || '—'}</td><td>${member.name || '—'}</td><td>${normalizeCallsign(member.callsign)}</td><td>${member.rank || member.gradeGroup}</td></tr>`).join('')}</tbody></table></div></section>` : ''; }).join('')}</div>`;
  } else viewContent.innerHTML = `<div class="panel view-panel"><h2>${title}</h2><p class="muted">Gestionează preferințele și sesiunea contului tău.</p><div class="settings-list"><p><b>Identitate:</b> ${currentUser?.name || '—'}</p><p><b>Callsign:</b> ${normalizeCallsign(currentUser?.callsign || currentUser?.callSign)}</p><p><b>Nivel acces:</b> ${isLeadershipUser(currentUser) ? 'Conducere' : 'Tester'}</p>${isLeadershipUser(currentUser) ? `<hr><h3>Configurare teste</h3><p class="muted">Poți importa aici textul testului; îl voi transforma automat în întrebări după structura fișierului.</p><label>Test<select id="test-editor-select">${catalog.map(test => `<option value="${test}">${test}</option>`).join('')}</select></label><input id="test-file-input" type="file" accept=".txt,.md,.json"><textarea id="test-editor-json" rows="8"></textarea><button class="primary" id="save-test-definition">Salvează testul</button><span id="test-editor-status" class="muted"></span>` : ''}<hr><button class="outline danger-button" id="logout-btn">Deconectează-te</button></div></div>`;
  const add = document.querySelector('#view-add'); if (add) add.onclick = () => document.querySelector('#add-btn').click();
  viewContent.querySelectorAll('[data-remove-member]').forEach(button => button.onclick = async () => { if (!isLeadershipUser(currentUser)) return; try { await saveRemoteGrant(button.dataset.removeMember, [], true, testers.find(member => normalizeCallsign(member.callsign) === button.dataset.removeMember)?.discordId || ''); testers = testers.filter(member => normalizeCallsign(member.callsign) !== button.dataset.removeMember); saveTesters(); renderRows(); renderDashboardData(); renderView('testers'); } catch (error) { alert(error.message); } });
  const logout = document.querySelector('#logout-btn'); if (logout) logout.onclick = () => { localStorage.removeItem(AUTH_STORAGE_KEY); window.location.reload(); };
  const editor = document.querySelector('#test-editor-select'); const editorJson = document.querySelector('#test-editor-json'); const editorStatus = document.querySelector('#test-editor-status');
  if (editor && editorJson) { const loadDefinition = () => { editorJson.value = JSON.stringify(testDefinitions[editor.value], null, 2); }; editor.onchange = loadDefinition; loadDefinition(); const fileInput = document.querySelector('#test-file-input'); if (fileInput) fileInput.onchange = async () => { const file = fileInput.files?.[0]; if (!file) return; editorJson.value = await file.text(); editorStatus.textContent = 'Fișier încărcat. Verifică și salvează.'; }; document.querySelector('#save-test-definition').onclick = () => { try { const value = JSON.parse(editorJson.value); testDefinitions[editor.value] = { ...value, name: editor.value }; saveTestDefinitions(); editorStatus.textContent = 'Salvat'; renderView('settings'); } catch { editorStatus.textContent = 'Format invalid. Pentru moment folosește JSON; după ce primesc Notepad-ul adaptez importul exact.'; } }; }
  viewContent.querySelectorAll('[data-test]').forEach(button => button.onclick = () => openTest(button.dataset.test));
}
function openTest(testName) {
  const definition = testDefinitions[testName] || { description: 'Test disponibil.', questions: [] };
  const questions = Array.isArray(definition.questions) ? definition.questions : [];
  const previousView = document.querySelector('.nav-item.active')?.dataset.view || 'tests';
  if (window.history.state?.view !== 'test') window.history.pushState({ view: 'test', testName, previousView }, '', `#test-${encodeURIComponent(testName)}`);
  const images = (definition.images || []).map(image => `<a class="test-image-link" href="${image.url}" target="_blank" rel="noopener">${image.label || 'Deschide imaginea'}</a>`).join('');
  const cases = (definition.cases || []).map((item, index) => `<option value="${index}">${item.title}</option>`).join('');
  const practical = (definition.practical || []).map((item, index) => `<option value="${index}">${item.name}</option>`).join('');

  viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><p class="eyebrow">GHID PENTRU TESTER</p><h2>${testName}</h2><p class="muted">Acces permanent pentru testerul conectat: ${normalizeCallsign(currentUser?.callsign)}.</p></div><button class="outline" id="back-to-tests">← Înapoi</button></div><p class="muted">${definition.description}</p><p class="test-instructions">${definition.instructions || ''}</p>${images ? `<div class="test-images">${images}</div>` : ''}${cases ? `<label>Cazul ales de candidat<select id="case-select">${cases}</select></label><div id="case-steps" class="case-steps"></div>` : ''}${practical ? `<label>Probă practică<select id="practical-select">${practical}</select></label><div id="practical-steps" class="case-steps"></div>` : ''}${questions.length ? `<form id="test-form" class="question-list"><label>Callsign candidat<input id="candidate-callsign" type="text" placeholder="510 sau M-510"></label><div id="candidate-summary" class="candidate-summary"></div>${testName === 'Test admitere' || testName === 'Test transfer' || testName === 'Adeverință medicală' ? `<label>Imagine document candidat<input id="candidate-document" type="file" accept="image/*"></label><p class="muted">Imaginea este disponibilă testerului pentru verificare manuală.</p>` : ''}${questions.map((question, index) => `<fieldset><legend>${index + 1}. ${question.text}</legend><div class="correct-answer"><b>Răspuns:</b><span>${question.answer || 'Verifică ghidul.'}</span></div><label class="answer-check"><input type="checkbox" data-wrong="${index}"> Răspuns greșit</label></fieldset>`).join('')}<p>Greșeli: <strong id="wrong-count">0</strong> / ${definition.maxWrong ?? '—'}</p><button class="primary" type="submit">Finalizează evaluarea</button></form>` : '<div class="test-runner"><p>Acest ghid nu are întrebări teoretice configurate.</p></div>'}</div>`;
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
document.querySelector('#add-btn').onclick = () => {if (!isLeadershipUser(currentUser)) { memberResult.textContent='Doar conducerea poate acorda acces.'; return; } selectedMember=null; modal.classList.add('open');callsignInput.value='';memberResult.textContent='';grantChecks.innerHTML='';}; document.querySelector('#close-modal').onclick = () => modal.classList.remove('open'); modal.onclick = e => { if (e.target === modal) modal.classList.remove('open') };
let selectedMember=null;
async function lookupMember(){const value=callsignInput.value.trim();if(!value){selectedMember=null;memberResult.textContent='';return} const normalized=normalizeCallsign(value);const member=directoryMembers.find(item=>normalizeCallsign(item.callsign)===normalized);const local=testers.find(item=>normalizeCallsign(item.callsign)===normalized);if(!member){selectedMember=null;memberResult.textContent='Callsign inexistent sau liber în lista departamentului.';grantChecks.innerHTML='';return}selectedMember={...member,...local, callsign:normalized, name:member.name, grantedTests:local?.grantedTests||member.grantedTests||[]};memberResult.textContent=`${member.name} · ${normalized}`;renderGrantChecks(catalog)}
function renderGrantChecks(options){grantChecks.innerHTML=`<button type="button" class="grant-preset" id="tester-preset">Acordă rolul TESTER (admitere, transfer și adeverință)</button>${options.filter(test=>!coreTests.includes(test)).map(test=>`<label><input type="checkbox" value="${test}" ${selectedMember?.grantedTests?.includes(test)?'checked':''}> ${test}</label>`).join('')}`;document.querySelector('#tester-preset').onclick=()=>{selectedMember.grantedTests=[...new Set([...selectedMember.grantedTests,...coreTests])];memberResult.textContent='Rolul TESTER selectat.';renderGrantChecks(options)}}
callsignInput.onchange=lookupMember;callsignInput.oninput=()=>{clearTimeout(window.lookupTimer);window.lookupTimer=setTimeout(lookupMember,350)};
document.querySelector('#invite-btn').onclick = async () => {if(!selectedMember){memberResult.textContent='Selectează un membru existent.';return} const granted=[...new Set([...coreTests,...grantChecks.querySelectorAll('input:checked').map(x=>x.value)])];const normalized=normalizeCallsign(selectedMember.callsign);if(!normalized||!selectedMember.discordId){memberResult.textContent='Membrul nu are un Discord ID valid în lista departamentului.';return} try { const saved=await saveRemoteGrant(normalized, granted, false, selectedMember.discordId); const existing=testers.find(t=>normalizeCallsign(t.callsign)===normalized);if(existing){Object.assign(existing,{...selectedMember,...saved})}else{testers.push({...selectedMember,...saved})}saveTesters();renderRows();renderDashboardData();renderView('testers');modal.classList.remove('open'); } catch (error) { memberResult.textContent=error.message; } };
document.querySelector('#search').oninput = e => { const q = e.target.value.toLowerCase(); renderRows(testers.filter(t => (t.name+t.callsign+(t.grantedTests||[]).join('')).toLowerCase().includes(q))) };
document.querySelector('#filter-btn').onclick = () => { const filters = ['all', ...specialtyTests]; const index = filters.indexOf(activeTesterFilter); activeTesterFilter = filters[(index + 1) % filters.length]; document.querySelector('#filter-btn').firstChild.textContent = activeTesterFilter === 'all' ? 'Filtrează ' : `${activeTesterFilter.replace('Test ', '')} `; const filtered = activeTesterFilter === 'all' ? testers : testers.filter(member => (member.grantedTests || []).includes(activeTesterFilter)); renderRows(filtered); }; rows.addEventListener('click', event => { const button = event.target.closest('[data-member-menu]'); if (!button) return; const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberMenu); if (member) { selectedMember = member; navigateTo('testers'); } }); document.querySelector('#brand-settings').onclick = () => navigateTo('settings'); document.querySelector('#user-menu').onclick = () => navigateTo('settings'); document.querySelector('#top-avatar').onclick = () => navigateTo('settings'); document.querySelector('#help-btn').onclick = () => alert('Folosește meniul din stânga pentru a naviga.'); document.querySelector('#sync-btn').onclick = async e => { e.currentTarget.disabled=true; e.currentTarget.textContent='Sincronizare...'; try { await loadDirectory(); await loadRemoteGrants(); document.querySelector('#sync-detail').textContent='Actualizat acum'; document.querySelector('#last-sync').textContent=new Date().toLocaleDateString('ro-RO'); } catch { document.querySelector('#sync-detail').textContent='Sincronizarea a eșuat'; } finally { e.currentTarget.disabled=false; e.currentTarget.textContent='Sincronizează acum'; } };
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
const PRESENCE_KEY='medici-presence';
function markPresence() { if (!currentUser?.discordId) return; const presence = JSON.parse(localStorage.getItem(PRESENCE_KEY) || '{}'); presence[currentUser.discordId] = Date.now(); localStorage.setItem(PRESENCE_KEY, JSON.stringify(presence)); }
function isActive(member) { return Number(member.lastSeen || 0) > Date.now() - 120000; }
async function sendPresence() { if (!currentUser?.discordId) return; await fetch('/api/access/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discordId: currentUser.discordId }) }).catch(() => {}); }
window.addEventListener('storage', event => { if (event.key === PRESENCE_KEY) { renderRows(); refreshCurrentView(); } });
function initialsFrom(name='User'){return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function applyUser(user){
  currentUser=user; syncCoreAccess(user); const name=user.name||user.displayName||'Utilizator'; const initials=initialsFrom(name); const first=name.split(/\s+/)[0];
  const callsign=normalizeCallsign(user.callsign||user.callSign); user.callsign=callsign;
  document.querySelector('#welcome-name').textContent=first; document.querySelector('#user-name').textContent=name;
  document.querySelector('#user-role').textContent=isLeadershipUser(user)?'Conducere':'Tester';
  document.querySelector('#top-avatar').textContent=initials; document.querySelector('.user-mini .avatar').textContent=initials;
  if(callsign) document.querySelector('.welcome .muted').textContent=`${callsign} · Acces sincronizat din departament.`;
  document.querySelector('.stat-card:nth-child(2) strong').textContent=allowedForUser(user).length;
  document.querySelector('#local-state').textContent='Sincronizat';
  document.querySelector('#add-btn').hidden = !isLeadershipUser(user);
  document.querySelector('[data-view="members"]').hidden = !isLeadershipUser(user);
  document.querySelector('#sync-panel').hidden = !isLeadershipUser(user);
  document.querySelector('#section-label').textContent = isLeadershipUser(user) ? 'Administrare' : 'Spațiul tău';
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
  const response = await fetch(`/api/access/directory?requesterId=${encodeURIComponent(user.discordId)}`);
  return response.ok;
}
async function startSession(){
  try{
    const callbackUser=await exchangeCallbackCode(); if(callbackUser) return enterApp(callbackUser);
    const cached=JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)||'null');
    if(cached?.version===AUTH_SCHEMA_VERSION&&cached?.user&&cached.expiresAt>Date.now()&&await verifyCachedUser(cached.user)) return enterApp(cached.user);
    localStorage.removeItem(AUTH_STORAGE_KEY); throw new Error('not-authorized');
  }catch(error){appShell.classList.remove('ready');const message=error.message==='not-authorized'?'Conectează-te cu Discord pentru a verifica accesul.':error.message;showAuthError(message)}
}
document.querySelector('#discord-login').onclick=()=>{window.location.href=LOGIN_ENDPOINT};
const themeToggle=document.querySelector('#theme-toggle');
const savedTheme=localStorage.getItem('medici-theme');
if(savedTheme==='dark') document.body.classList.add('dark-mode');
function updateThemeButton(){if(themeToggle){themeToggle.textContent=document.body.classList.contains('dark-mode')?'☀':'◐';themeToggle.classList.toggle('theme-toggle-active',document.body.classList.contains('dark-mode'));}}
updateThemeButton();
if(themeToggle) themeToggle.onclick=()=>{document.body.classList.toggle('dark-mode');localStorage.setItem('medici-theme',document.body.classList.contains('dark-mode')?'dark':'light');updateThemeButton()};
startSession();
