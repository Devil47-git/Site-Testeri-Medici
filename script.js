const catalog = ['Test admitere','Test transfer','Adeverință medicală','Test SMULS','Test MOTO','Test ALS','Test PILOT','Test parașutiști'];
const rows = document.querySelector('#tester-rows');
const viewContent = document.querySelector('#view-content');
const roleColors = ['cyan','orange','violet','green'];
const GRANTS_KEY = 'medici-grants';
let currentUser = null;
let testers = JSON.parse(localStorage.getItem(GRANTS_KEY) || '[]');
function saveTesters() { localStorage.setItem(GRANTS_KEY, JSON.stringify(testers)); }
function normalizeCallsign(value) { const number = String(value || '').replace(/\D/g, ''); return number ? `M-${number.padStart(3, '0')}` : ''; }
function allowedForUser(user) { if (user?.isConducere || user?.isLeadership) return catalog; return [...new Set([...(user?.allowedTests || []), ...(user?.eligibleSpecializations || [])])]; }
function renderRows(list = testers) { rows.innerHTML = list.length ? list.map((t,index) => `<tr><td><div class="tester"><div class="avatar ${roleColors[index%roleColors.length]}">${initialsFrom(t.name)}</div>${t.name}</div></td><td>${t.callsign}</td><td><div class="tags">${(t.grantedTests||[]).map((x,i) => `<span class="tag ${i%3===1?'orange':i%3===2?'cyan':''}">${x}</span>`).join('')||'<span class="muted">Niciun test</span>'}</div></td><td>${t.updatedAt||'—'}</td><td><span class="status"><i></i>Activ</span></td><td><button class="more">•••</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">Nu există testeri adăugați.</td></tr>'; document.querySelector('#tester-count').textContent=list.length;document.querySelector('#active-count').textContent=list.length; }
function renderView(view) {
  viewContent.hidden = view === 'overview';
  if (view === 'overview') return;
  const title = labels[view] || 'Spațiul tău';
  if (view === 'tests') viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><h2>${title}</h2><p class="muted">Testele disponibile pentru ${currentUser?.callsign || 'contul curent'}.</p></div></div><div class="test-cards">${allowedForUser(currentUser).map(test => `<article class="test-card"><h3>${test}</h3><p class="muted">Acces disponibil conform callsign-ului și permisiunilor acordate.</p><button class="primary" data-test="${test}">Deschide testul</button></article>`).join('') || '<div class="empty-state">Nu ai teste disponibile.</div>'}</div></div>`;
  else if (view === 'testers' || view === 'members') viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><h2>${title}</h2><p class="muted">Accesul este păstrat local și rămâne disponibil după închiderea site-ului.</p></div><button class="primary" id="view-add">＋ Adaugă tester</button></div><div class="table-wrap"><table><thead><tr><th>TESTER</th><th>CALLSIGN</th><th>TESTE ALOCATE</th><th>ULTIMA ACTIVITATE</th><th>STATUS</th></tr></thead><tbody>${testers.map(t => `<tr><td>${t.name}</td><td>${t.callsign}</td><td>${(t.grantedTests || []).join(', ') || '—'}</td><td>${t.updatedAt || '—'}</td><td>Activ</td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Nu există testeri salvați.</td></tr>'}</tbody></table></div></div>`;
  else viewContent.innerHTML = `<div class="panel view-panel"><h2>${title}</h2><p class="muted">Setările dashboardului și ale sesiunii tale.</p><button class="outline" id="clear-local">Șterge accesul salvat pe acest dispozitiv</button></div>`;
  const add = document.querySelector('#view-add'); if (add) add.onclick = () => document.querySelector('#add-btn').click();
  const clear = document.querySelector('#clear-local'); if (clear) clear.onclick = () => { localStorage.removeItem(GRANTS_KEY); testers = []; renderRows(); renderView(view); };
  viewContent.querySelectorAll('[data-test]').forEach(button => button.onclick = () => openTest(button.dataset.test));
}
function openTest(testName) {
  viewContent.innerHTML = `<div class="panel view-panel"><div class="panel-head"><div><p class="eyebrow">TEST ÎN DESFĂȘURARE</p><h2>${testName}</h2><p class="muted">Acces confirmat pentru ${currentUser?.callsign || 'contul curent'}.</p></div><button class="outline" id="back-to-tests">← Înapoi</button></div><div class="test-runner"><p>Testul este disponibil. Conținutul întrebărilor trebuie încărcat din fișierele testului.</p><p class="muted">În această versiune poți verifica accesul și reveni la catalog fără ca sesiunea sau permisiunile să se reseteze.</p></div></div>`;
  document.querySelector('#back-to-tests').onclick = () => renderView('tests');
}
}
renderRows();
const modal = document.querySelector('#modal'); const callsignInput=document.querySelector('#callsign'); const memberResult=document.querySelector('#member-result'); const grantChecks=document.querySelector('#grant-checks');
document.querySelector('#add-btn').onclick = () => {if (!(currentUser?.isConducere || currentUser?.isLeadership)) { memberResult.textContent='Doar conducerea poate acorda acces.'; return; } modal.classList.add('open');callsignInput.value='';memberResult.textContent='';grantChecks.innerHTML='';}; document.querySelector('#close-modal').onclick = () => modal.classList.remove('open'); modal.onclick = e => { if (e.target === modal) modal.classList.remove('open') };
let selectedMember=null;
async function lookupMember(){const value=callsignInput.value.trim();if(!value){selectedMember=null;memberResult.textContent='';return} const normalized=normalizeCallsign(value);const local=testers.find(t=>normalizeCallsign(t.callsign)===normalized); if(local){selectedMember=local;memberResult.textContent=`${local.name} · ${normalized}`;renderGrantChecks(local.eligibleTests||catalog);return} memberResult.textContent='Membrul va fi căutat în lista sincronizată.';selectedMember={callsign:normalized,name:normalized,eligibleTests:catalog,grantedTests:[]};renderGrantChecks(catalog)}
function renderGrantChecks(options){grantChecks.innerHTML=options.map(test=>`<label><input type="checkbox" value="${test}" ${selectedMember?.grantedTests?.includes(test)?'checked':''}> ${test}</label>`).join('')}
callsignInput.onchange=lookupMember;callsignInput.oninput=()=>{clearTimeout(window.lookupTimer);window.lookupTimer=setTimeout(lookupMember,350)};
document.querySelector('#invite-btn').onclick = () => {if(!selectedMember){memberResult.textContent='Introdu un callsign valid.';return} const granted=[...grantChecks.querySelectorAll('input:checked')].map(x=>x.value);const normalized=normalizeCallsign(selectedMember.callsign);if(!normalized){memberResult.textContent='Introdu un callsign valid.';return} const existing=testers.find(t=>normalizeCallsign(t.callsign)===normalized);if(existing){existing.callsign=normalized;existing.grantedTests=granted;existing.updatedAt='Acum'}else{testers.push({...selectedMember,callsign:normalized,grantedTests:granted,updatedAt:'Acum'})}saveTesters();renderRows();renderView('testers');modal.classList.remove('open')};
document.querySelector('#search').oninput = e => { const q = e.target.value.toLowerCase(); renderRows(testers.filter(t => (t.name+t.callsign+(t.grantedTests||[]).join('')).toLowerCase().includes(q))) };
document.querySelector('#filter-btn').onclick = () => { document.querySelector('#search').focus() }; document.querySelector('#sync-btn').onclick = e => {e.currentTarget.textContent='Sincronizare indisponibilă';document.querySelector('#sync-detail').textContent='Necesită sursa de grants'};
const labels = { overview: 'Prezentare generală', testers: 'Testerii mei', tests: 'Teste disponibile', members: 'Membri departament', settings: 'Setări' }; document.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => { document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active')); if (btn.classList.contains('nav-item')) btn.classList.add('active'); document.querySelector('#page-label').textContent = labels[btn.dataset.view] || 'Testerii mei'; document.querySelector('.sidebar').classList.remove('open'); renderView(btn.dataset.view); if (btn.dataset.view==='tests') {document.querySelector('#test-count').textContent=allowedForUser(currentUser).length;document.querySelector('#local-state').textContent='Catalog'} }); document.querySelector('.mobile-menu').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
const today=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());document.querySelector('#today-label').textContent=today.toUpperCase();document.querySelector('#test-count').textContent=catalog.length;document.querySelector('#local-state').textContent='Pregătit';

// Fluxul OAuth: Discord redirecționează înapoi cu ?code=..., apoi codul este trimis server-side către API-ul Vercel.
const authScreen=document.querySelector('#auth-screen');
const appShell=document.querySelector('#app-shell');
const authError=document.querySelector('#auth-error');
const AUTH_API_ENDPOINT='/api/auth/discord';
const LOGIN_ENDPOINT='/api/auth/login';
const AUTH_STORAGE_KEY='medici-auth';
const AUTH_TTL=3*24*60*60*1000;
function initialsFrom(name='User'){return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function applyUser(user){
  currentUser=user; const name=user.name||user.displayName||'Utilizator'; const initials=initialsFrom(name); const first=name.split(/\s+/)[0];
  const callsign=normalizeCallsign(user.callsign||user.callSign); user.callsign=callsign;
  document.querySelector('#welcome-name').textContent=first; document.querySelector('#user-name').textContent=name;
  document.querySelector('#user-role').textContent=user.isConducere||user.isLeadership?'Conducere':'Tester';
  document.querySelector('#top-avatar').textContent=initials; document.querySelector('.user-mini .avatar').textContent=initials;
  if(callsign) document.querySelector('.welcome .muted').textContent=`${callsign} · Acces sincronizat din departament.`;
  document.querySelector('.stat-card:nth-child(2) strong').textContent=allowedForUser(user).length;
  document.querySelector('#sync-label').textContent='Conectat'; document.querySelector('#local-state').textContent='Sincronizat';
}
function showAuthError(message){authError.textContent=message;authError.classList.add('show')}
function enterApp(user){applyUser(user);authScreen.style.display='none';appShell.classList.add('ready')}
async function exchangeCallbackCode(){
  const params=new URLSearchParams(window.location.search); const code=params.get('code');
  if(params.get('error')) throw new Error('Autentificarea Discord a fost anulată.');
  if(!code) return null;
  const response=await fetch(AUTH_API_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  const payload=await response.json(); if(!response.ok||!payload.success||!payload.user) throw new Error(payload.error==='not_found'?'Discord ID-ul nu există în lista departamentului.':'Verificarea autentificării a eșuat.');
  const stored={user:payload.user,expiresAt:Date.now()+AUTH_TTL}; localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(stored));
  window.history.replaceState({},document.title,window.location.pathname); return payload.user;
}
async function startSession(){
  try{
    const callbackUser=await exchangeCallbackCode(); if(callbackUser) return enterApp(callbackUser);
    const cached=JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)||'null');
    if(cached?.user&&cached.expiresAt>Date.now()) return enterApp(cached.user);
    localStorage.removeItem(AUTH_STORAGE_KEY); throw new Error('not-authorized');
  }catch(error){appShell.classList.remove('ready');showAuthError(error.message==='not-authorized'?'Conectează-te cu Discord pentru a verifica accesul.':error.message)}
}
document.querySelector('#discord-login').onclick=()=>{window.location.href=LOGIN_ENDPOINT};
const themeToggle=document.querySelector('#theme-toggle');
const savedTheme=localStorage.getItem('medici-theme');
if(savedTheme==='dark') document.body.classList.add('dark-mode');
function updateThemeButton(){if(themeToggle){themeToggle.textContent=document.body.classList.contains('dark-mode')?'☀':'◐';themeToggle.classList.toggle('theme-toggle-active',document.body.classList.contains('dark-mode'));}}
updateThemeButton();
if(themeToggle) themeToggle.onclick=()=>{document.body.classList.toggle('dark-mode');localStorage.setItem('medici-theme',document.body.classList.contains('dark-mode')?'dark':'light');updateThemeButton()};
startSession();
