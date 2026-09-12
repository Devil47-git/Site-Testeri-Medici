const coreTests = ['Test admitere','Test transfer','Adeverință medicală'];
const specialtyTests = ['Test ALS','Test SMULS','Test MOTO','Test PILOT','Test parașutiști'];
const catalog = [...coreTests, ...specialtyTests];
const TEST_CATALOG_KEY = 'medici-test-catalog';
let testDefinitions = JSON.parse(localStorage.getItem(TEST_CATALOG_KEY) || 'null') || Object.fromEntries(catalog.map(name => [name, { name, description: `Acces disponibil pentru ${name}.`, questions: [] }]));
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
async function loadRemoteGrants() {
  if (!currentUser?.discordId) return;
  const response = await fetch(`/api/access/grants?requesterId=${encodeURIComponent(currentUser.discordId)}`);
  if (!response.ok) return;
  const payload = await response.json();
  if (isLeadershipUser(currentUser)) {
    const grants = payload.grants || [];
    testers = directoryMembers.length ? directoryMembers.filter(memberIsTester).map(member => { const grant = grants.find(item => item.discordId === member.discordId); return { ...member, ...grant, grantedTests: grant?.grantedTests || member.grantedTests || [] }; }) : grants;
  } else {
    const ownGrant = (payload.grants || []).find(grant => grant.discordId === currentUser.discordId);
    currentUser.grantedTests = ownGrant?.grantedTests || currentUser.grantedTests || [];
    testers = ownGrant ? [ownGrant] : [];
  }
  saveTesters();
  renderRows();
  refreshCurrentView();
}
async function saveRemoteGrant(callsign, grantedTests) {
  if (!currentUser?.discordId) throw new Error('Sesiunea nu conține Discord ID.');
  const response = await fetch('/api/access/grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requesterId: currentUser.discordId, callsign, grantedTests }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Accesul nu a putut fi salvat.');
  return payload.grant;
}
function normalizeCallsign(value) { const number = String(value || '').replace(/\D/g, ''); return number ? `M-${number.padStart(3, '0')}` : ''; }
function isLeadershipUser(user) { const cs = Number(user?.csNum || String(user?.callsign || user?.callSign || '').replace(/\D/g, '')); return Boolean(user?.accessLevel === 'leadership' || user?.isConducere || user?.isLeadership || (cs >= 1 && cs <= 15)); }
function allowedForUser(user) { if (isLeadershipUser(user)) return catalog; return [...new Set([...(user?.allowedTests || []), ...(user?.eligibleSpecializations || []), ...(user?.grantedTests || [])])].filter(test => catalog.includes(test) && testDefinitions[test]); }
function dateOnly(value) { return value ? new Date(value).toLocaleDateString('ro-RO') : '—'; }
function memberIsTester(member) { return (member.grantedTests || []).length > 0 || member.csNum >= 200 || /TESTER/.test(String(member.functions || '').toUpperCase()); }
function sortMembers(members) { return [...members].sort((a, b) => (a.csNum < 16 ? -1 : b.csNum < 16 ? 1 : a.csNum - b.csNum)); }
function syncCoreAccess(user) { if (user && (user.grantedTests || []).length) user.allowedTests = [...new Set([...(user.allowedTests || []), ...coreTests])]; }
function renderRows(list = testers) { rows.innerHTML = list.length ? list.map((t,index) => `<tr><td><div class="tester"><div class="avatar ${roleColors[index%roleColors.length]}">${initialsFrom(t.name || 'Membru')}</div>${t.name || 'Membru departament'}</div></td><td>${normalizeCallsign(t.callsign)}</td><td><div class="tags">${(t.grantedTests||[]).filter(test => !coreTests.includes(test)).map((x,i) => `<span class="tag ${i%3===1?'orange':i%3===2?'cyan':''}">${x}</span>`).join('')||'<span class="muted">Tester</span>'}</div></td><td>${dateOnly(t.updatedAt)}</td><td><span class="status"><i></i>Activ</span></td><td><button class="more" data-member-menu="${normalizeCallsign(t.callsign)}">•••</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">Nu există testeri adăugați.</td></tr>'; document.querySelector('#tester-count').textContent=list.length;document.querySelector('#active-count').textContent=list.length; }
let directoryMembers = [];
async function loadDirectory() {
  if (!currentUser?.discordId) return;
  const response = await fetch(`/api/access/directory?requesterId=${encodeURIComponent(currentUser.discordId)}`);
  if (!response.ok) return;
  const payload = await response.json();
  directoryMembers = payload.members || [];
  if (isLeadershipUser(currentUser)) {
    testers = directoryMembers.filter(memberIsTester).map(member => ({ ...member, grantedTests: member.grantedTests || [] }));
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
  const activity = document.querySelector('#activity-list');
  const recent = [...testers].filter(member => member.updatedAt).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);
  activity.innerHTML = recent.length ? recent.map(member => `<div class="activity-item"><b>${member.name || normalizeCallsign(member.callsign)}</b><span>${normalizeCallsign(member.callsign)} · ${dateOnly(member.updatedAt)}</span></div>`).join('') : '<div class="empty-state">Nu există activitate înregistrată.</div>';
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
  if (view === 'tests') viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><h2>${title}</h2><p class="muted">Sunt afișate doar testele la care ai acces, pentru ${normalizeCallsign(currentUser?.callsign)}.</p></div></div><div class="test-cards">${allowedForUser(currentUser).map(test => `<article class="test-card"><h3>${test}</h3><p class="muted">${testDefinitions[test]?.description || 'Test disponibil.'}</p><button class="primary" data-test="${test}">Deschide testul</button></article>`).join('') || '<div class="empty-state">Nu ai teste disponibile.</div>'}</div></div>`;
  else if (view === 'testers') {
    const grouped = specialtyTests.map(test => ({ title: test, members: testers.filter(member => (member.grantedTests || []).includes(test)) })).filter(group => group.members.length);
    viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><h2>Testerii departamentului</h2><p class="muted">Testerii sunt grupați după specializare. Admiterea, transferul și adeverința sunt acces general pentru rolul de tester.</p></div>${isLeadershipUser(currentUser) ? '<button class="primary" id="view-add">＋ Adaugă tester</button>' : ''}</div>${grouped.map(group => `<section class="tester-group"><h3>${group.title}</h3><div class="table-wrap"><table><thead><tr><th>TESTER</th><th>CALLSIGN</th><th>DATA</th></tr></thead><tbody>${group.members.map(member => `<tr><td>${member.name || 'Membru departament'}</td><td>${normalizeCallsign(member.callsign)}</td><td>${dateOnly(member.updatedAt)}</td></tr>`).join('')}</tbody></table></div></section>`).join('') || '<div class="empty-state">Nu există testeri pe specializări.</div>'}</div>`;
  } else if (view === 'members') {
      const groups = ['Conducerea departamentului', ...new Set(directoryMembers.filter(member => !member.isLeadership).map(member => member.gradeGroup).sort((a, b) => Number(a) - Number(b)))];
    viewContent.innerHTML = `<div class="panel view-panel"><h2>Membri departament</h2><p class="muted">Membrii sunt grupați după conducere și grade.</p>${groups.map(group => { const members = sortMembers(directoryMembers.filter(member => group === 'Conducerea departament' ? member.isLeadership : !member.isLeadership && member.gradeGroup === group)); return members.length ? `<section class="member-group"><h3>${group}</h3><div class="table-wrap"><table><thead><tr><th>MEMBRU</th><th>CALLSIGN</th><th>FUNCȚII</th><th>GRAD</th></tr></thead><tbody>${members.map(member => `<tr><td>${member.name || '—'}</td><td>${normalizeCallsign(member.callsign)}</td><td>${member.functions || '—'}</td><td>${member.rank || member.gradeGroup}</td></tr>`).join('')}</tbody></table></div></section>` : ''; }).join('')}</div>`;
  } else viewContent.innerHTML = `<div class="panel view-panel"><h2>${title}</h2><p class="muted">Gestionează preferințele și sesiunea contului tău.</p><div class="settings-list"><p><b>Identitate:</b> ${currentUser?.name || '—'}</p><p><b>Callsign:</b> ${normalizeCallsign(currentUser?.callsign || currentUser?.callSign)}</p><p><b>Nivel acces:</b> ${isLeadershipUser(currentUser) ? 'Conducere' : 'Tester'}</p>${isLeadershipUser(currentUser) ? `<hr><h3>Configurare teste</h3><p class="muted">Editează întrebările în format JSON pentru testul selectat.</p><label>Test<select id="test-editor-select">${catalog.map(test => `<option value="${test}">${test}</option>`).join('')}</select></label><textarea id="test-editor-json" rows="8"></textarea><button class="primary" id="save-test-definition">Salvează testul</button><span id="test-editor-status" class="muted"></span>` : ''}<hr><button class="outline" id="clear-local">Șterge datele locale ale acestui dispozitiv</button><button class="outline" id="logout-btn">Deconectează-te</button></div></div>`;
  const add = document.querySelector('#view-add'); if (add) add.onclick = () => document.querySelector('#add-btn').click();
  const clear = document.querySelector('#clear-local'); if (clear) clear.onclick = () => { localStorage.removeItem(GRANTS_KEY); testers = []; renderRows(); renderView(view); };
  const logout = document.querySelector('#logout-btn'); if (logout) logout.onclick = () => { localStorage.removeItem(AUTH_STORAGE_KEY); window.location.reload(); };
  const editor = document.querySelector('#test-editor-select'); const editorJson = document.querySelector('#test-editor-json'); const editorStatus = document.querySelector('#test-editor-status');
  if (editor && editorJson) { const loadDefinition = () => { editorJson.value = JSON.stringify(testDefinitions[editor.value], null, 2); }; editor.onchange = loadDefinition; loadDefinition(); document.querySelector('#save-test-definition').onclick = () => { try { const value = JSON.parse(editorJson.value); testDefinitions[editor.value] = { ...value, name: editor.value }; saveTestDefinitions(); editorStatus.textContent = 'Salvat'; renderView('settings'); } catch { editorStatus.textContent = 'JSON invalid'; } }; }
  viewContent.querySelectorAll('[data-test]').forEach(button => button.onclick = () => openTest(button.dataset.test));
}
function openTest(testName) {
  const definition = testDefinitions[testName] || { description: 'Test disponibil.', questions: [] };
  const questions = Array.isArray(definition.questions) ? definition.questions : [];
  viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><p class="eyebrow">TEST ÎN DESFĂȘURARE</p><h2>${testName}</h2><p class="muted">Acces confirmat pentru ${normalizeCallsign(currentUser?.callsign)}.</p></div><button class="outline" id="back-to-tests">← Înapoi</button></div><p class="muted">${definition.description}</p>${questions.length ? `<form id="test-form" class="question-list">${questions.map((question, index) => `<fieldset><legend>${index + 1}. ${question.text}</legend>${(question.options || []).map(option => `<label><input required type="radio" name="q-${index}" value="${option}"> ${option}</label>`).join('')}</fieldset>`).join('')}<button class="primary" type="submit">Finalizează testul</button></form>` : '<div class="test-runner"><p>Testul este configurat, dar încă nu are întrebări introduse.</p></div>'}</div>`;
  document.querySelector('#back-to-tests').onclick = () => renderView('tests');
  const form = document.querySelector('#test-form'); if (form) form.onsubmit = event => { event.preventDefault(); form.innerHTML = '<p class="success-message">Testul a fost completat și trimis.</p>'; };
}
renderRows();
const modal = document.querySelector('#modal'); const callsignInput=document.querySelector('#callsign'); const memberResult=document.querySelector('#member-result'); const grantChecks=document.querySelector('#grant-checks');
document.querySelector('#add-btn').onclick = () => {if (!isLeadershipUser(currentUser)) { memberResult.textContent='Doar conducerea poate acorda acces.'; return; } selectedMember=null; modal.classList.add('open');callsignInput.value='';memberResult.textContent='';grantChecks.innerHTML='';}; document.querySelector('#close-modal').onclick = () => modal.classList.remove('open'); modal.onclick = e => { if (e.target === modal) modal.classList.remove('open') };
let selectedMember=null;
async function lookupMember(){const value=callsignInput.value.trim();if(!value){selectedMember=null;memberResult.textContent='';return} const normalized=normalizeCallsign(value);const member=directoryMembers.find(item=>normalizeCallsign(item.callsign)===normalized);const local=testers.find(item=>normalizeCallsign(item.callsign)===normalized);if(!member){selectedMember=null;memberResult.textContent='Callsign inexistent sau liber în lista departamentului.';grantChecks.innerHTML='';return}selectedMember={...member,...local, callsign:normalized, name:member.name, grantedTests:local?.grantedTests||member.grantedTests||[]};memberResult.textContent=`${member.name} · ${normalized}`;renderGrantChecks(catalog)}
function renderGrantChecks(options){grantChecks.innerHTML=`<button type="button" class="grant-preset" id="tester-preset">Acordă rolul TESTER (admitere, transfer și adeverință)</button>${options.filter(test=>!coreTests.includes(test)).map(test=>`<label><input type="checkbox" value="${test}" ${selectedMember?.grantedTests?.includes(test)?'checked':''}> ${test}</label>`).join('')}`;document.querySelector('#tester-preset').onclick=()=>{selectedMember.grantedTests=[...new Set([...selectedMember.grantedTests,...coreTests])];memberResult.textContent='Rolul TESTER selectat.';renderGrantChecks(options)}}
callsignInput.onchange=lookupMember;callsignInput.oninput=()=>{clearTimeout(window.lookupTimer);window.lookupTimer=setTimeout(lookupMember,350)};
document.querySelector('#invite-btn').onclick = async () => {if(!selectedMember){memberResult.textContent='Selectează un membru existent.';return} const granted=[...new Set([...coreTests,...grantChecks.querySelectorAll('input:checked').map(x=>x.value)])];const normalized=normalizeCallsign(selectedMember.callsign);if(!normalized||!selectedMember.discordId){memberResult.textContent='Membrul nu are un Discord ID valid în lista departamentului.';return} try { const saved=await saveRemoteGrant(normalized, granted); const existing=testers.find(t=>normalizeCallsign(t.callsign)===normalized);if(existing){Object.assign(existing,{...selectedMember,...saved})}else{testers.push({...selectedMember,...saved})}saveTesters();renderRows();renderDashboardData();renderView('testers');modal.classList.remove('open'); } catch (error) { memberResult.textContent=error.message; } };
document.querySelector('#search').oninput = e => { const q = e.target.value.toLowerCase(); renderRows(testers.filter(t => (t.name+t.callsign+(t.grantedTests||[]).join('')).toLowerCase().includes(q))) };
document.querySelector('#filter-btn').onclick = () => { const filters = ['all', ...specialtyTests]; const index = filters.indexOf(activeTesterFilter); activeTesterFilter = filters[(index + 1) % filters.length]; document.querySelector('#filter-btn').firstChild.textContent = activeTesterFilter === 'all' ? 'Filtrează ' : `${activeTesterFilter.replace('Test ', '')} `; const filtered = activeTesterFilter === 'all' ? testers : testers.filter(member => (member.grantedTests || []).includes(activeTesterFilter)); renderRows(filtered); }; rows.addEventListener('click', event => { const button = event.target.closest('[data-member-menu]'); if (!button) return; const member = testers.find(item => normalizeCallsign(item.callsign) === button.dataset.memberMenu); if (member) { selectedMember = member; navigateTo('testers'); } }); document.querySelector('#activity-menu').onclick = () => navigateTo('testers'); document.querySelector('#activity-btn').onclick = () => navigateTo('testers'); document.querySelector('#brand-settings').onclick = () => navigateTo('settings'); document.querySelector('#user-menu').onclick = () => navigateTo('settings'); document.querySelector('#help-btn').onclick = () => alert('Folosește meniul din stânga pentru a naviga. Conducerea poate acorda acces din Testerii departamentului.'); document.querySelector('#sync-btn').onclick = async e => { e.currentTarget.disabled=true; e.currentTarget.textContent='Sincronizare...'; try { await loadDirectory(); await loadRemoteGrants(); document.querySelector('#sync-detail').textContent='Actualizat acum'; document.querySelector('#last-sync').textContent=new Date().toLocaleDateString('ro-RO'); } catch { document.querySelector('#sync-detail').textContent='Sincronizarea a eșuat'; } finally { e.currentTarget.disabled=false; e.currentTarget.textContent='Sincronizează acum'; } };
const labels = { overview: 'Dashboard', testers: 'Testerii departamentului', tests: 'Teste disponibile', members: 'Membri departament', settings: 'Setări' };
function navigateTo(view, { push = true } = {}) {
  if (!labels[view]) return;
  if (push && window.history.state?.view !== view) window.history.pushState({ view }, '', `#${view}`);
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  document.querySelector('#page-label').textContent = labels[view];
  document.querySelector('#section-label').textContent = view === 'settings' || view === 'members' || view === 'testers' ? 'Administrare' : 'Spațiul tău';
  document.querySelector('.sidebar').classList.remove('open');
  renderView(view);
  if (view === 'tests') { document.querySelector('#test-count').textContent = allowedForUser(currentUser).length; document.querySelector('#local-state').textContent = 'Sincronizat'; }
}
document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));
window.addEventListener('popstate', event => {
  if (!currentUser) return;
  navigateTo(event.state?.view || 'overview', { push: false });
});
window.addEventListener('hashchange', () => {
  if (!currentUser) return;
  const view = window.location.hash.slice(1);
  navigateTo(labels[view] ? view : 'overview', { push: false });
});
document.querySelector('.mobile-menu').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
window.setInterval(async () => { if (!currentUser) return; try { await loadDirectory(); await loadRemoteGrants(); } catch { /* următoarea sincronizare va reîncerca */ } }, 60000);
const today=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());document.querySelector('#today-label').textContent=today.toUpperCase();document.querySelector('#test-count').textContent=catalog.length;document.querySelector('#local-state').textContent='Pregătit';

// Fluxul OAuth: Discord redirecționează înapoi cu ?code=..., apoi codul este trimis server-side către API-ul Vercel.
const authScreen=document.querySelector('#auth-screen');
const appShell=document.querySelector('#app-shell');
const authError=document.querySelector('#auth-error');
const AUTH_API_ENDPOINT='/api/auth/discord';
const LOGIN_ENDPOINT='/api/auth/login';
const AUTH_STORAGE_KEY='medici-auth';
const AUTH_SCHEMA_VERSION=2;
const AUTH_TTL=3*24*60*60*1000;
function initialsFrom(name='User'){return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function applyUser(user){
  currentUser=user; syncCoreAccess(user); const name=user.name||user.displayName||'Utilizator'; const initials=initialsFrom(name); const first=name.split(/\s+/)[0];
  const callsign=normalizeCallsign(user.callsign||user.callSign); user.callsign=callsign;
  document.querySelector('#welcome-name').textContent=first; document.querySelector('#user-name').textContent=name;
  document.querySelector('#user-role').textContent=isLeadershipUser(user)?'Conducere':'Tester';
  document.querySelector('#top-avatar').textContent=initials; document.querySelector('.user-mini .avatar').textContent=initials;
  if(callsign) document.querySelector('.welcome .muted').textContent=`${callsign} · Acces sincronizat din departament.`;
  document.querySelector('.stat-card:nth-child(2) strong').textContent=allowedForUser(user).length;
  document.querySelector('#sync-label').textContent='Conectat'; document.querySelector('#local-state').textContent='Sincronizat';
  document.querySelector('#add-btn').hidden = !isLeadershipUser(user);
  document.querySelector('[data-view="members"]').hidden = false;
  document.querySelector('#section-label').textContent = isLeadershipUser(user) ? 'Administrare' : 'Spațiul tău';
}
function showAuthError(message){authError.textContent=message;authError.classList.add('show')}
async function enterApp(user){applyUser(user);authScreen.style.display='none';appShell.classList.add('ready');window.history.replaceState({ view: 'overview' }, '', `${window.location.pathname}#overview`);navigateTo('overview', { push: false });try { await loadDirectory(); await loadRemoteGrants(); } catch (error) { document.querySelector('#sync-detail').textContent='Sincronizarea a eșuat'; console.error(error); }}
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
async function startSession(){
  try{
    const callbackUser=await exchangeCallbackCode(); if(callbackUser) return enterApp(callbackUser);
    const cached=JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)||'null');
    if(cached?.version===AUTH_SCHEMA_VERSION&&cached?.user&&cached.expiresAt>Date.now()) return enterApp(cached.user);
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
