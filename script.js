const testers = [{ name: 'Daria V.', initials: 'DV', call: 'MED-214', tests: ['ALS', 'Admitere'], time: 'Acum 12 min', color: 'cyan' }, { name: 'Matei C.', initials: 'MC', call: 'MED-327', tests: ['MOTO', 'SMULS'], time: 'Acum 47 min', color: 'orange' }, { name: 'Ioana P.', initials: 'IP', call: 'MED-108', tests: ['Admitere', 'Transfer'], time: 'Acum 2 ore', color: 'violet' }, { name: 'Radu A.', initials: 'RA', call: 'MED-301', tests: ['SMULS'], time: 'Ieri, 18:42', color: 'green' }, { name: 'Sorin D.', initials: 'SD', call: 'MED-222', tests: ['PILOT', 'ALS'], time: 'Ieri, 16:10', color: 'cyan' }];
const rows = document.querySelector('#tester-rows');
function renderRows(list = testers) { rows.innerHTML = list.map(t => `<tr><td><div class="tester"><div class="avatar ${t.color}">${t.initials}</div>${t.name}</div></td><td>${t.call}</td><td><div class="tags">${t.tests.map((x, i) => `<span class="tag ${i % 3 === 1 ? 'orange' : i % 3 === 2 ? 'cyan' : ''}">${x}</span>`).join('')}</div></td><td>${t.time}</td><td><span class="status"><i></i>Activ</span></td><td><button class="more">•••</button></td></tr>`).join('') }
renderRows();
const modal = document.querySelector('#modal'); document.querySelector('#add-btn').onclick = () => modal.classList.add('open'); document.querySelector('#close-modal').onclick = () => modal.classList.remove('open'); modal.onclick = e => { if (e.target === modal) modal.classList.remove('open') };
document.querySelector('#invite-btn').onclick = () => { const email = document.querySelector('#email'); if (!email.value) { email.focus(); return } modal.classList.remove('open'); email.value = ''; alert('Invitația a fost pregătită și va fi trimisă prin Discord.') };
document.querySelector('#search').oninput = e => { const q = e.target.value.toLowerCase(); renderRows(testers.filter(t => (t.name + t.call + t.tests.join('')).toLowerCase().includes(q))) };
document.querySelector('#filter-btn').onclick = () => { const active = [...new Set(testers.flatMap(t => t.tests))].join(', '); alert(`Specializări active: ${active}`) }; document.querySelector('#sync-btn').onclick = e => { e.currentTarget.textContent = 'Se sincronizează...'; setTimeout(() => { e.currentTarget.textContent = 'Sincronizat acum'; setTimeout(() => e.currentTarget.textContent = 'Sincronizează acum', 1800) }, 800) };
const labels = { overview: 'Prezentare generală', testers: 'Testerii mei', tests: 'Teste disponibile', members: 'Membri departament', settings: 'Setări' }; document.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => { document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active')); if (btn.classList.contains('nav-item')) btn.classList.add('active'); document.querySelector('#page-label').textContent = labels[btn.dataset.view] || 'Testerii mei'; if (btn.dataset.view !== 'overview') alert(`${labels[btn.dataset.view]} — această secțiune este pregătită pentru conectarea la backend.`) }); document.querySelector('.mobile-menu').onclick = () => document.querySelector('.sidebar').classList.toggle('open');

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
  const name=user.name||user.displayName||'Utilizator'; const initials=initialsFrom(name); const first=name.split(/\s+/)[0];
  document.querySelector('#welcome-name').textContent=first; document.querySelector('#user-name').textContent=name;
  document.querySelector('#user-role').textContent=user.isConducere||user.isLeadership?'Conducere':'Tester';
  document.querySelector('#top-avatar').textContent=initials; document.querySelector('.user-mini .avatar').textContent=initials;
  if(user.callsign||user.callSign) document.querySelector('.welcome .muted').textContent=`${user.callsign||user.callSign} · Acces sincronizat din departament.`;
  if(user.allowedTests?.length) document.querySelector('.stat-card:nth-child(2) strong').textContent=user.allowedTests.length;
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
