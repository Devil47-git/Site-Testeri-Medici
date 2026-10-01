import { catalog, callsignNumber, effectiveTestsForMember, functionsForMember, isLeadershipRow, normalizeTests } from './shared.js';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || '1uaXnzKcNeOOXrQB2TU2aGrq9ZTie4AeFlAUX_FhH06M';
const MEMBER_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'LISTA DEPARTAMENT!A1:T400';
const GRANTS_RANGE = process.env.GOOGLE_GRANTS_RANGE || 'GRANTS!A1:F';
const RESULTS_RANGE = process.env.GOOGLE_TEST_RESULTS_RANGE || 'TEST_HISTORY!A1:E';
const MEDICAL_CERTIFICATES_RANGE = process.env.GOOGLE_MEDICAL_CERTIFICATES_RANGE || 'MEDICAL_CERTIFICATES!A1:K';
const RESULTS_HEADER = ['discordId', 'callsign', 'testName', 'result', 'createdAt'];
const MEDICAL_CERTIFICATES_HEADER = ['number', 'testerDiscordId', 'testerName', 'candidateId', 'lastName', 'firstName', 'phone', 'hoursAccount', 'hoursCharacter', 'result', 'createdAt'];
const MEDICAL_CERTIFICATE_LAST_NUMBER = 7014;
const MEDICAL_CERTIFICATE_MAX_NUMBER = 30000;
const MAX_IDENTITY_IMAGE_BYTES = 2 * 1024 * 1024;
const SPECIALTY_WEBHOOKS = {
  'Test ALS': 'DISCORD_ALS_WEBHOOK',
  'Test SMULS': 'DISCORD_SMULS_WEBHOOK',
  'Test MOTO': 'DISCORD_MOTO_WEBHOOK',
  'Test PILOT': 'DISCORD_PILOT_WEBHOOK',
  'Test parașutiști': 'DISCORD_PARASUTIST_WEBHOOK'
};

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

function json(res, status, body) { return res.status(status).json(body); }

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
    const range = RESULTS_RANGE.split('!')[0] + '!A1:E1';
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range, valueInputOption: 'RAW', requestBody: { values: [RESULTS_HEADER] } });
    return [RESULTS_HEADER];
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

async function sendWebhookMessage(url, content) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [content], allowed_mentions: { parse: [] } })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function sendWebhookImage(url, embed, image) {
  const form = new FormData();
  form.set('payload_json', JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: 'buletin-candidat.jpg' }] }));
  form.set('files[0]', new Blob([image.buffer], { type: image.mimeType }), 'buletin-candidat.jpg');
  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function sendWebhookImages(url, embeds, images) {
  const form = new FormData();
  form.set('payload_json', JSON.stringify({ embeds, allowed_mentions: { parse: [] }, attachments: images.map((image, id) => ({ id, filename: image.filename })) }));
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
    testers: { title: 'Test Admitere', color: 0x23A2E8, fields: testersFields, thumbnail: { url: 'attachment://buletin-candidat.jpg' } }
  };
}

async function sendAdmissionNotifications(details, image) {
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
    sendWebhookMessage(admissionWebhook, embeds.admission).then(() => null, error => `Canalul de rezultate: ${error.message.startsWith('HTTP ') ? error.message : 'eroare de rețea Discord'}.`),
    sendWebhookImage(testersWebhook, embeds.testers, image).then(() => null, error => `Canalul testerilor: ${error.message.startsWith('HTTP ') ? error.message : 'eroare de rețea Discord'}.`)
  ]);
  const errors = deliveries.filter(Boolean);
  return { sent: errors.length === 0, error: errors.join(' ') };
}

export function createAlsResultEmbed({ testerName, candidateName, candidateCallsign, result }) {
  return {
    title: 'Test ALS',
    color: 0x23A2E8,
    fields: [
      { name: 'Nume Tester', value: testerName || '—', inline: false },
      { name: 'Callsign', value: candidateCallsign || '—', inline: false },
      { name: 'Nume Candidat', value: candidateName || '—', inline: false },
      { name: 'Rezultat', value: result || '—', inline: false }
    ]
  };
}

export function createSpecialtyResultEmbed({ testName, testerName, candidateName, candidateCallsign, result }) {
  return {
    title: testName,
    color: 0x23A2E8,
    fields: [
      { name: 'Nume Tester', value: testerName || '—', inline: false },
      { name: 'Callsign', value: candidateCallsign || '—', inline: false },
      { name: 'Nume Candidat', value: candidateName || '—', inline: false },
      { name: 'Rezultat', value: result || '—', inline: false }
    ]
  };
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
    await sendWebhookMessage(url, embed);
    return { sent: true, error: '' };
  } catch (error) {
    return { sent: false, error: `Canalul ${testName}: ${error.message.startsWith('HTTP ') ? error.message : 'eroare de rețea Discord'}.` };
  }
}

async function sendMedicalCertificateNotification(details, number) {
  const setting = process.env.DISCORD_MEDICAL_CERTIFICATES_WEBHOOK;
  if (!setting) return { sent: false, error: 'Lipsește DISCORD_MEDICAL_CERTIFICATES_WEBHOOK.' };
  const url = webhookUrl(setting);
  if (!url) return { sent: false, error: 'URL invalid pentru DISCORD_MEDICAL_CERTIFICATES_WEBHOOK.' };
  try {
    const images = [
      { ...details.identityImage, filename: 'buletin-candidat.jpg' },
      { ...details.medicalSheetImage, filename: 'fisa-medicala.jpg' }
    ];
    await sendWebhookImages(url, createMedicalCertificateEmbeds(details, number), images);
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

    if (req.method === 'POST') {
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
        const image = parseIdentityImage(req.body?.identityImage);
        if (!['Admis', 'Respins'].includes(result)) return json(res, 400, { error: 'Invalid admission result' });
        if (!candidateName || !candidateId || !image || (result === 'Admis' && !candidateCallsign)) {
          return json(res, 400, { error: 'Candidate name, ID, and ID image are required; admitted candidates also need a callsign' });
        }
        admissionDetails = { candidateName, candidateId, candidateCallsign, result, image };
      }
      if (Object.hasOwn(SPECIALTY_WEBHOOKS, testName)) {
        const candidateName = String(req.body?.candidateName || '').trim().slice(0, 100);
        const candidateCallsign = String(req.body?.candidateCallsign || '').trim().slice(0, 24);
        const result = String(req.body?.result || '').trim();
        if (!candidateName || !candidateCallsign) return json(res, 400, { error: 'Testul necesită numele și callsign-ul candidatului.' });
        if (!['Admis', 'Respins'].includes(result)) return json(res, 400, { error: 'Invalid test result' });
        specialtyDetails = { candidateName, candidateCallsign, result };
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
        range: `'${title}'!A1:E`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[discordId, String(member[2] || '').trim(), testName, String(req.body?.result || '').slice(0, 32), new Date().toISOString()]] }
      });
      const discordNotifications = admissionDetails
        ? await sendAdmissionNotifications({ testerName: String(member[3] || '').trim().slice(0, 100), ...admissionDetails }, admissionDetails.image)
        : undefined;
      const specialtyNotification = specialtyDetails
        ? await sendSpecialtyNotification(testName, { testerName: String(member[3] || '').trim().slice(0, 100), ...specialtyDetails })
        : undefined;
      let certificateNumber;
      let certificateNotification;
      if (certificateDetails) {
        certificateNumber = await appendMedicalCertificate(sheets, certificateDetails, { discordId, name: String(member[3] || '').trim().slice(0, 100) });
        certificateNotification = await sendMedicalCertificateNotification(certificateDetails, certificateNumber);
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