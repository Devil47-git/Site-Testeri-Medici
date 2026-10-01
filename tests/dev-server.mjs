import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const ROOT = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
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
const testResults = [];
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/access/directory')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ members: MOCK })); return; }
  if (url.pathname.startsWith('/api/access/test-results')) {
    let cleared = null;
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body);
        if (payload.action === 'reset-counts') { cleared = testResults.length; testResults.length = 0; }
        else testResults.push(payload);
      } catch {}
    }
    const counts = testResults.map(result => ({ discordId: result.requesterId, callsign: '001', testName: result.testName, count: testResults.filter(item => item.requesterId === result.requesterId && item.testName === result.testName).length }));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ counts, ...(req.method === 'POST' ? { success: true, ...(cleared === null ? { discordNotificationsSent: false, discordNotificationError: 'Serverul demo local nu trimite notificari Discord.' } : { cleared }) } : {}) })); return;
  }
  if (url.pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ grants: [] })); return; }
  const file = path.resolve(ROOT, url.pathname === '/' ? 'index.html' : '.' + url.pathname);
  try { const data = await fs.readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('nf'); }
}).listen(4321, () => console.log('stub 4321'));
