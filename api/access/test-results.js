import { catalog, callsignNumber, candidateForCallsign, effectiveTestsForMember, functionsForMember, isLeadershipRow, normalizeTests } from './shared.js';
import { cooldownIsActive, parseCooldownS } from './cooldowns.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:F';
const RESULTS_RANGE = process.env.GOOGLE_TEST_RESULTS_RANGE || 'TEST_HISTORY!A1:G';
const MEDICAL_CERTIFICATES_RANGE = process.env.GOOGLE_MEDICAL_CERTIFICATES_RANGE || 'MEDICAL_CERTIFICATES!A1:K';
const RESULTS_HEADER = ['discordId', 'callsign', 'testName', 'result', 'createdAt', 'candidateCallsign', 'candidateName'];
const MEDICAL_CERTIFICATES_HEADER = ['number', 'testerDiscordId', 'testerName', 'candidateId', 'lastName', 'firstName', 'phone', 'hoursAccount', 'hoursCharacter', 'result', 'createdAt'];
const MEDICAL_CERTIFICATE_LAST_NUMBER = 7014;
const MEDICAL_CERTIFICATE_MAX_NUMBER = 30000;
const MAX_IDENTITY_IMAGE_BYTES = 2 * 1024 * 1024;
const SITE_BRAND_EMBED_COLOR = 0xCD363C;
const SPECIALTY_WEBHOOKS = {
  'Test ALS': 'DISCORD_ALS_WEBHOOK',
  'Test SMULS': 'DISCORD_SMULS_WEBHOOK',
  'Test MOTO': 'DISCORD_MOTO_WEBHOOK',
  'Test PILOT': 'DISCORD_PILOT_WEBHOOK',
  'Test parașutiști': 'DISCORD_PARASUTIST_WEBHOOK'
};

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

function json(res, status, body) { return res.status(status).json(body); }
export function discordTesterMentionPayload(discordId) {
  const id = String(discordId || '').trim();
  return /^\d+$/.test(id)
    ? { content: `<@${id}>`, allowed_mentions: { parse: [], users: [id] } }
    : { allowed_mentions: { parse: [] } };
}
export function canResetTestCounts(member) {
  const callsign = callsignNumber(member?.[2]);
  return callsign >= 1 && callsign <= 20;
}

async function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Google Sheets service account is not configured');
  }
  const { google } = await import('googleapis');
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : undefined;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

function sheetTitle() { return RESULTS_RANGE.split('!')[0].replace(/^'|'$/g, ''); }
function departmentDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function bonusEntryFromRow(row, testerNames = new Map()) {
  const discordId = String(row?.[0] || '').trim();
  return {
    callsign: String(row?.[5] || row?.[1] || '').trim(),
    testerName: String(row?.[6] || testerNames.get(discordId) || '').trim(),
    testName: String(row?.[2] || '').trim(),
    result: String(row?.[3] || '').trim(),
    createdAt: String(row?.[4] || '').trim()
  };
}

async function ensureResultsSheet(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
  if ((spreadsheet.data.sheets || []).some(sheet => sheet.properties?.title === sheetTitle())) return;
  const request = { addSheet: { properties: { title: sheetTitle() } } };
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [request] } });
}

async function readValues(sheets, range) {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  return Array.isArray(result.data.values) ? result.data.values : [];
}

async function ensureResultsHeader(sheets) {
  await ensureResultsSheet(sheets);
  const rows = await readValues(sheets, RESULTS_RANGE);
  if (!rows.length) {
    const range = RESULTS_RANGE.split('!')[0] + '!A1:G1';
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range, valueInputOption: 'RAW', requestBody: { values: [RESULTS_HEADER] } });
    return [RESULTS_HEADER];
  }
  if (rows[0]?.[5] !== 'candidateCallsign' || rows[0]?.[6] !== 'candidateName') {
    const range = RESULTS_RANGE.split('!')[0] + '!A1:G1';
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range, valueInputOption: 'RAW', requestBody: { values: [RESULTS_HEADER] } });
    rows[0] = RESULTS_HEADER;
  }
  return rows;
}

async function findRequester(sheets, discordId) {
  const members = await readValues(sheets, MEMBER_RANGE);
  return members.slice(1).find(row => String(row[19] || '').trim() === discordId) || null;
}

async function canRecordTest(sheets, member, discordId, testName) {
  if (isLeadershipRow(member)) return true;
  const grants = (await readValues(sheets, GRANTS_RANGE).catch(() => [])).slice(1);
  const grant = grants.find(row => String(row[0] || '').trim() === discordId);
  const storedGrant = grant ? { grantMode: String(grant[5] || '').trim(), grantedTests: normalizeTests(String(grant[2] || '').split('|')) } : null;
  return effectiveTestsForMember(functionsForMember(callsignNumber(member[2]), member[10]), storedGrant).includes(testName);
}

function webhookUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'discord.com' && url.pathname.startsWith('/api/webhooks/') ? url.toString() : '';
  } catch {
    return '';
  }
}

function parseIdentityImage(value) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IDENTITY_IMAGE_BYTES) return null;
  return { buffer, mimeType: `image/${match[1]}` };
}

async function sendWebhookMessage(url, embed, testerDiscordId) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...discordTesterMentionPayload(testerDiscordId), embeds: [embed] })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function sendWebhookImages(url, embeds, images, testerDiscordId) {
  const form = new FormData();
  form.set('payload_json', JSON.stringify({ ...discordTesterMentionPayload(testerDiscordId), embeds, attachments: images.map((image, id) => ({ id, filename: image.filename })) }));
  images.forEach((image, id) => form.set(`files[${id}]`, new Blob([image.buffer], { type: image.mimeType }), image.filename));
  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export function createAdmissionEmbeds({ testerName, candidateName, candidateId, candidateCallsign, result }) {
  const summaryFields = [
    { name: 'Nume Tester', value: testerName || '—', inline: false },
    { name: 'Nume Candidat', value: candidateName || '—', inline: false },
    { name: 'Rezultat', value: result || '—', inline: false }
  ];
  const testersFields = [
    { name: 'Nume Tester', value: testerName || '—', inline: false },
    { name: 'Nume Candidat', value: candidateName || '—', inline: false },
    { name: 'ID', value: candidateId || '—', inline: false },
    { name: 'Rezultat', value: result || '—', inline: false }
  ];
  if (result === 'Admis' && candidateCallsign) testersFields.push({ name: 'Callsign', value: candidateCallsign, inline: false });
  return {
    admission: { title: 'Admitere', color: 0x23A2E8, fields: summaryFields },
    testers: { title: 'Test Admitere', color: 0x23A2E8, fields: testersFields, thumbnail: { url: 'attachment://buletin-candidat.jpg' } },
    medicalSheet: { title: 'Fișă medicală', color: 0x23A2E8, thumbnail: { url: 'attachment://fisa-medicala.jpg' } },
    drugTest: { title: 'Drug-test', color: 0x23A2E8, thumbnail: { url: 'attachment://drug-test.jpg' } }
  };
}

async function sendAdmissionNotifications(details) {
  const admissionSetting = process.env.DISCORD_ADMISSION_WEBHOOK;
  const testersSetting = process.env.DISCORD_TESTERS_WEBHOOK;
  const missing = [
    !admissionSetting && 'DISCORD_ADMISSION_WEBHOOK',
    !testersSetting && 'DISCORD_TESTERS_WEBHOOK'
  ].filter(Boolean);
  if (missing.length) return { sent: false, error: `Lipsesc setările: ${missing.join(', ')}.` };

  const admissionWebhook = webhookUrl(admissionSetting);
  const testersWebhook = webhookUrl(testersSetting);
  const invalid = [
    !admissionWebhook && 'DISCORD_ADMISSION_WEBHOOK',
    !testersWebhook && 'DISCORD_TESTERS_WEBHOOK'
  ].filter(Boolean);
  if (invalid.length) return { sent: false, error: `URL invalid pentru: ${invalid.join(', ')}.` };

  const embeds = createAdmissionEmbeds(details);
  const deliveries = await Promise.all([
    sendWebhookMessage(admissionWebhook, embeds.admission, details.testerDiscordId).then(() => null, error => `Canalul de rezultate: ${error.message.startsWith('HTTP ') ? error.message : 'eroare de rețea Discord'}.`),
    sendWebhookImages(testersWebhook, [embeds.testers, embeds.medicalSheet, embeds.drugTest], [
      { ...details.identityImage, filename: 'buletin-candidat.jpg' },
      { ...details.medicalSheetImage, filename: 'fisa-medicala.jpg' },
      { ...details.drugTestImage, filename: 'drug-test.jpg' }
    ], details.testerDiscordId).then(() => null, error => `Canalul testerilor: ${error.message.startsWith('HTTP ') ? error.message : 'eroare de rețea Discord'}.`)
  ]);
  const errors = deliveries.filter(Boolean);
  return { sent: errors.length === 0, error: errors.join(' ') };
}

export function createAlsResultEmbed({ testerName, candidateName, candidateCallsign, result }) {
  return {
    title: 'Test ALS',
    color: SITE_BRAND_EMBED_COLOR,
    author: { name: 'DMLS · Departamentul Testerilor' },
    fields: [
      { name: '👨‍⚕️ Tester', value: `**${testerName || '—'}**`, inline: true },
      { name: '📟 Callsign', value: `\`${candidateCallsign || '—'}\``, inline: true },
      { name: '🧑‍⚕️ Candidat', value: `**${candidateName || '—'}**`, inline: false },
      { name: '🏁 Rezultat', value: result === 'Admis' ? '✅ **Admis**' : result === 'Respins' ? '❌ **Respins**' : result || '—', inline: false }
    ],
    footer: { text: 'Rezultat oficial · DMLS' },
    timestamp: new Date().toISOString()
  };
}

export function createSpecialtyResultEmbed({ testName, testerName, candidateName, candidateCallsign, result }) {
  return {
    title: testName === 'Test PILOT' ? `${testName} 🚁` : testName,
    color: SITE_BRAND_EMBED_COLOR,
    author: { name: 'DMLS · Departamentul Testerilor' },
    fields: [
      { name: '👨‍⚕️ Tester', value: `**${testerName || '—'}**`, inline: true },
      { name: '📟 Callsign', value: `\`${candidateCallsign || '—'}\``, inline: true },
      { name: '🧑‍⚕️ Candidat', value: `**${candidateName || '—'}**`, inline: false },
      { name: '🏁 Rezultat', value: result === 'Admis' ? '✅ **Admis**' : result === 'Respins' ? '❌ **Respins**' : result || '—', inline: false }
    ],
    footer: { text: 'Rezultat oficial · DMLS' },
    timestamp: new Date().toISOString()
  };
}

export function specialtyNotificationDetails(candidate, result) {
  return { candidateCallsign: String(candidate?.callsign || '').trim(), candidateName: String(candidate?.name || '').trim(), result };
}

async function sendSpecialtyNotification(testName, details) {
  const settingName = SPECIALTY_WEBHOOKS[testName];
  const setting = process.env[settingName];
  if (!setting) return { sent: false, error: `Lipsește ${settingName}.` };
  const url = webhookUrl(setting);
  if (!url) return { sent: false, error: `URL invalid pentru ${settingName}.` };
  try {
    const embed = testName === 'Test ALS'
      ? createAlsResultEmbed(details)
      : createSpecialtyResultEmbed({ testName, ...details });
    await sendWebhookMessage(url, embed, details.testerDiscordId);
    return { sent: true, error: '' };
  } catch (error) {
    return { sent: false, error: `Canalul ${testName}: ${error.message.startsWith('HTTP ') ? error.message : 'eroare de rețea Discord'}.` };
  }
}

async function sendMedicalCertificateNotification(details, number, testerDiscordId) {
  const setting = process.env.DISCORD_MEDICAL_CERTIFICATES_WEBHOOK;
  if (!setting) return { sent: false, error: 'Lipsește DISCORD_MEDICAL_CERTIFICATES_WEBHOOK.' };
  const url = webhookUrl(setting);
  if (!url) return { sent: false, error: 'URL invalid pentru DISCORD_MEDICAL_CERTIFICATES_WEBHOOK.' };
  try {
    const images = [
      { ...details.identityImage, filename: 'buletin-candidat.jpg' },
      { ...details.medicalSheetImage, filename: 'fisa-medicala.jpg' }
    ];
    await sendWebhookImages(url, createMedicalCertificateEmbeds(details, number), images, testerDiscordId);
    return { sent: true, error: '' };
  } catch (error) {
    return { sent: false, error: `Canalul de adeverințe: ${error.message.startsWith('HTTP ') ? error.message : 'eroare de rețea Discord'}.` };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const requesterId = req.method === 'GET' ? req.query?.requesterId : req.body?.requesterId;
  const discordId = typeof requesterId === 'string' ? requesterId.trim() : '';
  if (!discordId) return json(res, 400, { error: 'Missing requesterId' });

  try {
    const sheets = await sheetsClient();
    const member = await findRequester(sheets, discordId);
    if (!member) return json(res, 403, { error: 'Requester is not a department member' });

    if (req.method === 'GET' && req.query?.view === 'bonuses') {
      if (!isLeadershipRow(member)) return json(res, 403, { error: 'Pagina Bonusuri este rezervată conducerii.' });
      const from = String(req.query?.from || '');
      const to = String(req.query?.to || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        return json(res, 400, { error: 'Selectează un interval calendaristic valid.' });
      }
      const rows = await ensureResultsHeader(sheets);
      const members = (await readValues(sheets, MEMBER_RANGE)).slice(1);
      const names = new Map(members.map(row => [String(row[19] || '').trim(), String(row[3] || '').trim()]));
      const entries = rows.slice(1).flatMap(row => {
        const entry = bonusEntryFromRow(row, names);
        const date = departmentDateKey(entry.createdAt);
        if (!catalog.includes(entry.testName) || date < from || date > to) return [];
        return [entry];
      });
      return json(res, 200, { entries });
    }

    if (req.method === 'POST') {
      if (req.body?.action === 'reset-counts') {
        if (!canResetTestCounts(member)) return json(res, 403, { error: 'Resetarea testelor este rezervată conducerii cu callsign între 001 și 020' });
        const rows = await ensureResultsHeader(sheets);
        const title = sheetTitle().replace(/'/g, "''");
        await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `'${title}'!A2:G` });
        return json(res, 200, { success: true, cleared: Math.max(0, rows.length - 1) });
      }
      const testName = String(req.body?.testName || '').trim();
      if (!catalog.includes(testName)) return json(res, 400, { error: 'Unknown test' });
      if (!await canRecordTest(sheets, member, discordId, testName)) return json(res, 403, { error: 'This test is not assigned to the requester' });
      let admissionDetails = null;
      let specialtyDetails = null;
      let certificateDetails = null;
      if (testName === 'Test admitere') {
        const candidateName = String(req.body?.candidateName || '').trim().slice(0, 100);
        const candidateId = String(req.body?.candidateId || '').trim().slice(0, 24);
        const candidateCallsign = String(req.body?.candidateCallsign || '').trim().slice(0, 24);
        const result = String(req.body?.result || '').trim();
        const identityImage = parseIdentityImage(req.body?.identityImage);
        const medicalSheetImage = parseIdentityImage(req.body?.medicalSheetImage);
        const drugTestImage = parseIdentityImage(req.body?.drugTestImage);
        if (!['Admis', 'Respins'].includes(result)) return json(res, 400, { error: 'Invalid admission result' });
        if (!candidateName || !candidateId || !identityImage || !medicalSheetImage || !drugTestImage || (result === 'Admis' && !candidateCallsign)) {
          return json(res, 400, { error: 'Numele, ID-ul și fotografiile buletinului, fișei medicale și drug-testului sunt obligatorii; la Admis este necesar și callsign-ul.' });
        }
        admissionDetails = { candidateName, candidateId, candidateCallsign, result, identityImage, medicalSheetImage, drugTestImage };
      }
      if (Object.hasOwn(SPECIALTY_WEBHOOKS, testName)) {
        const candidateCallsign = String(req.body?.candidateCallsign || '').trim().slice(0, 24);
        const result = String(req.body?.result || '').trim();
        if (!candidateCallsign) return json(res, 400, { error: 'Testul necesită callsign-ul candidatului.' });
        if (!['Admis', 'Respins'].includes(result)) return json(res, 400, { error: 'Invalid test result' });
        const candidateRows = (await readValues(sheets, MEMBER_RANGE)).slice(1).filter(Array.isArray);
        const candidate = candidateForCallsign(candidateRows, candidateCallsign);
        if (!candidate) return json(res, 404, { error: 'Nu a fost găsit un candidat cu acest callsign în coloana C.' });
        const candidateRow = candidateRows.find(row => callsignNumber(row[2]) === callsignNumber(candidateCallsign));
        const cooldowns = parseCooldownS(candidateRow?.[18] || '');
        if (cooldownIsActive(cooldowns, testName)) {
          const expiry = new Date(cooldowns[testName]);
          const expiryDate = expiry.toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric' });
          return json(res, 403, { error: `Candidatul are CD activ la ${testName} până pe ${expiryDate}. Testarea este oprită.` });
        }
        specialtyDetails = specialtyNotificationDetails(candidate, result);
      }
      if (testName === 'Adeverință medicală') {
        const details = {
          lastName: String(req.body?.lastName || '').trim().slice(0, 80),
          firstName: String(req.body?.firstName || '').trim().slice(0, 80),
          candidateId: String(req.body?.candidateId || '').trim().slice(0, 24),
          phone: String(req.body?.phone || '').trim().slice(0, 32),
          hoursAccount: String(req.body?.hoursAccount || '').trim().slice(0, 16),
          hoursCharacter: String(req.body?.hoursCharacter || '').trim().slice(0, 16),
          medicalStatus: String(req.body?.medicalStatus || '').trim(),
          identityImage: parseIdentityImage(req.body?.identityImage),
          medicalSheetImage: parseIdentityImage(req.body?.medicalSheetImage)
        };
        const validHours = value => /^\d+(?:\.\d{1,2})?$/.test(value);
        if (!details.lastName || !details.firstName || !details.candidateId || !details.phone || !validHours(details.hoursAccount) || !validHours(details.hoursCharacter) || !details.identityImage || !details.medicalSheetImage) {
          return json(res, 400, { error: 'Adeverința necesită nume, prenume, ID, telefon, ore valide și ambele imagini.' });
        }
        if (!['Admis', 'Respins'].includes(details.medicalStatus)) return json(res, 400, { error: 'Invalid medical status' });
        certificateDetails = details;
      }
      await ensureResultsHeader(sheets);
      const title = sheetTitle().replace(/'/g, "''");
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `'${title}'!A1:G`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[discordId, String(member[2] || '').trim(), testName, String(req.body?.result || '').slice(0, 32), new Date().toISOString(), specialtyDetails?.candidateCallsign || String(req.body?.candidateCallsign || '').trim().slice(0, 24), specialtyDetails?.candidateName || String(req.body?.candidateName || '').trim().slice(0, 100)]] }
      });
      const discordNotifications = admissionDetails
        ? await sendAdmissionNotifications({ testerDiscordId: discordId, testerName: String(member[3] || '').trim().slice(0, 100), ...admissionDetails })
        : undefined;
      const specialtyNotification = specialtyDetails
        ? await sendSpecialtyNotification(testName, { testerDiscordId: discordId, testerName: String(member[3] || '').trim().slice(0, 100), ...specialtyDetails })
        : undefined;
      let certificateNumber;
      let certificateNotification;
      if (certificateDetails) {
        certificateNumber = await appendMedicalCertificate(sheets, certificateDetails, { discordId, name: String(member[3] || '').trim().slice(0, 100) });
        certificateNotification = await sendMedicalCertificateNotification(certificateDetails, certificateNumber, discordId);
      }
      return json(res, 200, {
        success: true,
        ...(admissionDetails ? { discordNotificationsSent: discordNotifications.sent, discordNotificationError: discordNotifications.error } : {}),
        ...(specialtyDetails ? { discordNotificationsSent: specialtyNotification.sent, discordNotificationError: specialtyNotification.error } : {}),
        ...(certificateDetails ? { certificateNumber, discordNotificationsSent: certificateNotification.sent, discordNotificationError: certificateNotification.error } : {})
      });
    }

    const rows = await ensureResultsHeader(sheets);
    const counts = new Map();
    for (const row of rows.slice(1)) {
      const id = String(row[0] || '').trim();
      const testName = String(row[2] || '').trim();
      if (!id || !catalog.includes(testName)) continue;
      const key = `${id}\u0000${testName}`;
      const count = counts.get(key) || { discordId: id, callsign: String(row[1] || '').trim(), testName, count: 0 };
      count.count += 1;
      counts.set(key, count);
    }
    return json(res, 200, { counts: [...counts.values()] });
  } catch (error) {
    console.error('Test history failed:', error);
    return json(res, 500, { error: 'Test history unavailable' });
  }
}

export function medicalCertificateNumberForRow(rowNumber) {
  const row = Number(rowNumber);
  if (!Number.isInteger(row) || row < 2) return null;
  const number = MEDICAL_CERTIFICATE_LAST_NUMBER + row - 1;
  return number <= MEDICAL_CERTIFICATE_MAX_NUMBER ? number : null;
}

export function createMedicalCertificateEmbeds(details, number) {
  const result = details.medicalStatus === 'Admis' ? 'ADMIS' : 'RESPINS';
  const description = [
    'SECTIA DE PSIHOLOGIE & PSIHIATRIE',
    'SECTIUNEA I: DETALII PERSONALE (IC-IN CHARACTER)',
    `NUME: ${details.lastName}`,
    `PRENUME: ${details.firstName}`,
    `NR DE TELEFON: ${details.phone}`,
    `REZULTAT: ${result}`,
    'ELIBERATA DE: SPITALUL MUNICIPAL ECLIPSE',
    'SECTIUNEA II: DETALII (OOC-OUT OF CHARACTER)',
    `ID (CNP): ${details.candidateId}`,
    `ORE(LUNI): ${details.hoursAccount} (cont) ${details.hoursCharacter} (character)`
  ].join('\n');
  return [{
    title: `D.M.L.S. - EVIDENTA MEDICALA NR. ${number}`,
    description: `\`\`\`text\n${description}\n\`\`\``,
    color: 0x23A2E8,
    thumbnail: { url: 'attachment://buletin-candidat.jpg' },
    image: { url: 'attachment://fisa-medicala.jpg' }
  }];
}

async function ensureMedicalCertificatesSheet(sheets) {
  const title = MEDICAL_CERTIFICATES_RANGE.split('!')[0];
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
  if (!(spreadsheet.data.sheets || []).some(sheet => sheet.properties?.title === title)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
  }
  const rows = await readValues(sheets, MEDICAL_CERTIFICATES_RANGE);
  if (rows.length) return rows;
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${title}'!A1:K1`, valueInputOption: 'RAW', requestBody: { values: [MEDICAL_CERTIFICATES_HEADER] } });
  return [MEDICAL_CERTIFICATES_HEADER];
}

async function appendMedicalCertificate(sheets, details, tester) {
  const rows = await ensureMedicalCertificatesSheet(sheets);
  if (rows.length >= MEDICAL_CERTIFICATE_MAX_NUMBER - MEDICAL_CERTIFICATE_LAST_NUMBER + 1) throw new Error('Numărul maxim de adeverințe, 30000, a fost atins.');
  const title = MEDICAL_CERTIFICATES_RANGE.split('!')[0].replace(/'/g, "''");
  const appended = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${title}'!A1:K`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [['', tester.discordId, tester.name, details.candidateId, details.lastName, details.firstName, details.phone, details.hoursAccount, details.hoursCharacter, details.medicalStatus, new Date().toISOString()]] }
  });
  const rowNumber = Number(appended.data.updates?.updatedRange?.match(/![A-Z]+(\d+):/i)?.[1]);
  const number = medicalCertificateNumberForRow(rowNumber);
  if (!number) throw new Error('Nu s-a putut aloca numărul adeverinței.');
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${title}'!A${rowNumber}:A${rowNumber}`, valueInputOption: 'RAW', requestBody: { values: [[number]] } });
  return number;
}