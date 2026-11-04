import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readTestDefinitions, writeTestDefinitions } from '../lib/test-definitions-store.js';
const ROOT = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const MOCK = [
  { discordId: '1', name: 'Ion Popescu', callsign: '001', csNum: 1, rank: 'Medic Inspector', gradeGroup: 'Conducerea departamentului', isLeadership: true, isTester: true, functions: 'MOTO', grantedTests: ['Test admitere','Test transfer','Adeverință medicală','Test MOTO'], avatar: 'https://cdn.discordapp.com/avatars/1/a.png' },
  { discordId: '2', name: 'Ana Vasilescu', callsign: '003', csNum: 3, rank: 'Medic Inspector', gradeGroup: 'Conducerea departamentului', isLeadership: true, isTester: true, grantedTests: ['Test admitere'], avatar: '' },
  { discordId: '3', name: 'Mihai Radu', callsign: '105', csNum: 105, rank: 'Medic Primar', gradeGroup: 'Medici Primari (101-115)', isTester: true, grantedTests: ['Test admitere','Test transfer','Adeverință medicală'], avatar: '' },
  { discordId: '4', name: 'Elena Stan', callsign: '210', csNum: 210, rank: 'Medic Specialist', gradeGroup: 'Medici Specialisti (201-230)', isTester: true, functions: 'A.L.S.', grantedTests: ['Test admitere','Test transfer','Adeverință medicală','Test ALS'], avatar: '' },
  { discordId: '5', name: 'Radu Test', callsign: '320', csNum: 320, rank: 'Medic Rezident', gradeGroup: '', isTester: true, functions: 'S.M.U.L.S.', grantedTests: ['Test SMULS'], avatar: '' },
  { discordId: '6', name: 'Fara Functie', callsign: '330', csNum: 330, rank: 'Medic Rezident', gradeGroup: '', isTester: false, functions: 'AMBULANTA', grantedTests: [], avatar: '' },
  { discordId: '7', name: 'Pilot Test', callsign: '220', csNum: 220, rank: 'Medic Specialist', isTester: true, functions: 'PILOT', grantedTests: ['Test PILOT'], avatar: '' },
  { discordId: '8', name: 'Para Test', callsign: '221', csNum: 221, rank: 'Medic Specialist', isTester: true, functions: 'PARASUTIST', grantedTests: ['Test parașutiști'], avatar: '' },
  { discordId: '9', name: '', callsign: '004', csNum: 4, rank: 'Medic Inspector', isLeadership: true, isTester: true, functions: 'A.L.S.', grantedTests: ['Test ALS'], avatar: '' }
];
const CANDIDATES = [...MOCK, {
  callsign: '603', name: 'Antonio Shades', cooldowns: {
    'Test MOTO': Date.parse('2026-10-20T20:59:59.999Z'),
    'Test PILOT': Date.parse('2026-10-20T20:59:59.999Z'),
    'Test SMULS': Date.parse('2026-10-20T20:59:59.999Z'),
    'Test parașutiști': Date.parse('2026-10-10T20:59:59.999Z')
  }
}];
const BONUS_TESTS = [
  { callsign: '105', testerName: 'Mihai Radu', testName: 'Test PILOT', result: 'Admis' },
  { callsign: '105', testerName: 'Mihai Radu', testName: 'Test MOTO', result: 'Admis' },
  { callsign: '105', testerName: 'Mihai Radu', testName: 'Test transfer', result: 'Respins' },
  { callsign: '105', testerName: 'Mihai Radu', testName: 'Test admitere', result: 'Admis' },
  { callsign: '210', testerName: 'Elena Stan', testName: 'Adeverință medicală', result: 'Admis' },
  { callsign: '210', testerName: 'Elena Stan', testName: 'Test ALS', result: 'Admis' },
  { callsign: '320', testerName: 'Radu Test', testName: 'Test SMULS', result: 'Admis' }
];
const testResults = [];
const lifetimeTestResults = [];
const attendanceEntriesByMember = Object.fromEntries(MOCK.map(member => [member.discordId, []]));
attendanceEntriesByMember['1'] = [
  { start: Date.parse('2026-11-02T10:15:00+02:00'), end: Date.parse('2026-11-02T12:10:00+02:00') }
];
for (const [index, member] of MOCK.entries()) {
  member.attendanceWeeks = [
    { label: 'TOTAL/ZI\nCW 40', value: String(120 + index) },
    { label: 'TOTAL/ZI\nCW 41', value: index % 2 ? '138/5CCV' : '134/2CO' },
    { label: 'TOTAL/ZI\nCW 42', value: '—' }
  ];
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/test-definitions') {
    if (req.method === 'GET') {
      const definitions = await readTestDefinitions();
      res.writeHead(definitions ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(definitions ? { definitions } : { error: 'Nu am putut citi definițiile' }));
      return;
    }
    if (req.method === 'PUT') {
      let body = ''; for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload || typeof payload.definitions !== 'object' || Array.isArray(payload.definitions)) throw new Error('bad');
        await writeTestDefinitions(payload.definitions);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Salvarea a eșuat' }));
      }
      return;
    }
  }
  if (url.pathname === '/api/access/attendance') {
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      const entries = attendanceEntriesByMember[payload.requesterId] || (attendanceEntriesByMember[payload.requesterId] = []);
      if (payload.action === 'start') entries.push({ start: Date.now(), end: null });
      else if (payload.action === 'stop') {
        const active = [...entries].reverse().find(item => !item.end);
        if (active) active.end = Date.now();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, entries }));
      return;
    }
    const requesterId = url.searchParams.get('requesterId');
    const entries = url.searchParams.get('view') === 'own'
      ? attendanceEntriesByMember[requesterId] || (attendanceEntriesByMember[requesterId] = [...attendanceEntriesByMember['1']])
      : attendanceEntriesByMember;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ entries, configured: true }));
    return;
  }
  if (url.pathname.startsWith('/api/access/directory')) {
    const callsign = url.searchParams.get('callsign');
    if (callsign !== null) {
      const number = Number(String(callsign).replace(/\D/g, '')) || 0;
      const candidate = CANDIDATES.find(member => (Number(String(member.callsign).replace(/\D/g, '')) || 0) === number);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ candidate: candidate ? { callsign: candidate.callsign, name: candidate.name, cooldowns: candidate.cooldowns || {} } : null })); return;
    }
    const members = url.searchParams.get('view') === 'attendance'
      ? [{ ...(MOCK.find(member => member.discordId === url.searchParams.get('requesterId')) || MOCK[0]), discordId: url.searchParams.get('requesterId') }]
      : MOCK;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ members, syncedAt: new Date().toISOString() })); return;
  }
  if (url.pathname.startsWith('/api/access/test-results')) {
    if (url.searchParams.get('view') === 'bonuses') {
      const from = url.searchParams.get('from');
      const fixtures = BONUS_TESTS.map((entry, index) => ({ ...entry, createdAt: `${from}T${String(9 + index).padStart(2, '0')}:00:00+03:00` }));
      const recorded = testResults.map((entry, index) => {
        const tester = MOCK.find(member => member.discordId === entry.requesterId);
        return {
          callsign: tester?.callsign || '001',
          testerName: tester?.name || 'Tester demo',
          testName: entry.testName,
          result: entry.result,
          createdAt: `${from}T${String(16 + index).padStart(2, '0')}:00:00+03:00`
        };
      });
      const entries = [...fixtures, ...recorded];
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ entries })); return;
    }
    let cleared = null;
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body);
        if (payload.action === 'reset-counts') { cleared = testResults.length; testResults.length = 0; lifetimeTestResults.length = 0; }
        else { testResults.push(payload); lifetimeTestResults.push(payload); }
      } catch {}
    }
    const counts = testResults.map(result => ({ discordId: result.requesterId, callsign: '001', testName: result.testName, count: testResults.filter(item => item.requesterId === result.requesterId && item.testName === result.testName).length }));
    const processedCounts = lifetimeTestResults.map(result => ({ discordId: result.requesterId, callsign: '001', testName: result.testName, count: lifetimeTestResults.filter(item => item.requesterId === result.requesterId && item.testName === result.testName).length }));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ counts, processedCounts, ...(req.method === 'POST' ? { success: true, ...(cleared === null ? { discordNotificationsSent: false, discordNotificationError: 'Serverul demo local nu trimite notificari Discord.' } : { cleared }) } : {}) })); return;
  }
  if (url.pathname === '/api/guide') {
    const apiGuide = (await import('../api/guide.js')).default;
    res.setHeader('Cache-Control', 'no-store');
    res.status = code => {
      res.statusCode = code;
      return {
        send: content => res.end(content),
        json: content => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(content));
        }
      };
    };
    await apiGuide(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ grants: [] })); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); res.end('bad path'); return; }
  const file = path.resolve(ROOT, pathname === '/' ? 'index.html' : '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(404); res.end('nf'); return; }
  try { const data = await fs.readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); }
  catch { res.writeHead(404); res.end('nf'); }
}).listen(4321, () => console.log('stub 4321'));
