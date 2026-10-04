/**
 * Local storage + test-definition persistence layer.
 * Loaded before script.js; classic scripts share one global scope.
 */
const coreTests = ['Test admitere','Test transfer','Adeverință medicală'];
const specialtyTests = ['Test ALS','Test SMULS','Test MOTO','Test PILOT','Test parașutiști'];
const docsTesterFilters = ['Test SMULS', 'Test ALS'];
const testSummaryDefinitions = [['Test SMULS', 'Test S.M.U.L.S.'], ['Test MOTO', 'Test MOTO'], ['Test PILOT', 'Test PILOT'], ['Test ALS', 'Test A.L.S.'], ['Test parașutiști', 'Test Parasutism']];
const catalog = [...coreTests, ...specialtyTests];
const TEST_CATALOG_KEY = 'medici-test-catalog-v4';
/** @param {string} key @param {any} fallback @returns {any} */
function readStored(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function activeRouteStorageKey(user) { return `${ACTIVE_ROUTE_STORAGE_PREFIX}${String(user?.discordId || '')}`; }
function saveActiveRoute(route) {
  if (!currentUser?.discordId) return;
  try {
    localStorage.setItem(activeRouteStorageKey(currentUser), JSON.stringify(route));
  } catch (error) {
    console.error('Active page could not be saved for refresh:', error);
  }
}
function routeFromLocation(hash) {
  const profileMatch = String(hash || '').match(/^#tester-profile-(.+)$/);
  if (profileMatch) {
    try { return { view: 'tester-profile', callsign: decodeURIComponent(profileMatch[1]), previousView: 'testers' }; }
    catch { return null; }
  }
  const testName = testNameFromHash(hash);
  if (testName) return { view: 'test', testName, previousView: 'overview' };
  const view = String(hash || '').replace(/^#/, '');
  return labels[view] ? { view } : null;
}
function validSavedRoute(route) {
  if (route?.view === 'test' && typeof route.testName === 'string' && route.testName) return route;
  if (route?.view === 'tester-profile' && typeof route.callsign === 'string' && route.callsign) return route;
  return labels[route?.view] ? route : null;
}
function testProgressStorageKey(user, testName) {
  return `${TEST_PROGRESS_STORAGE_PREFIX}${String(user?.discordId || '')}:${testName}`;
}
function saveTestProgress(testName) {
  if (!currentUser?.discordId) return;
  const panel = viewContent.querySelector('.view-panel');
  if (!panel) return;
  const key = testProgressStorageKey(currentUser, testName);
  const previous = readStored(key, {}) || {};
  const controls = [...panel.querySelectorAll('input:not([type="file"]),select,textarea')].map((control, index) => {
    const key = control.id || control.dataset.progressKey || `control-${index}`;
    control.dataset.progressKey = key;
    return {
      key,
      value: control.value,
      checked: control.type === 'checkbox' || control.type === 'radio' ? control.checked : undefined
    };
  });
  try {
    localStorage.setItem(key, JSON.stringify({
      ...previous,
      controls,
      stage: panel.dataset.progressStage || '',
      stageIndex: Number(panel.dataset.progressIndex) || 0,
      media: previous.media || {}
    }));
  } catch (error) {
    console.error(`Progress for ${testName} could not be saved:`, error);
  }
}
async function saveTestProgressPhoto(testName, fieldId, file) {
  if (!currentUser?.discordId) return;
  const key = testProgressStorageKey(currentUser, testName);
  const savedPhoto = file ? { name: file.name, dataUrl: await encodeIdentityPhoto(file, 400 * 1024) } : null;
  const progress = readStored(key, {}) || {};
  const media = { ...(progress.media || {}) };
  if (savedPhoto) media[fieldId] = savedPhoto;
  else delete media[fieldId];
  try {
    localStorage.setItem(key, JSON.stringify({ ...progress, media }));
  } catch (error) {
    throw new Error('Fotografia nu a putut fi păstrată când schimbi testul.', { cause: error });
  }
}
function restoreTestProgress(testName) {
  if (!currentUser?.discordId) return null;
  const progress = readStored(testProgressStorageKey(currentUser, testName), null);
  if (!progress || !Array.isArray(progress.controls)) return null;
  const panel = viewContent.querySelector('.view-panel');
  if (!panel) return null;
  const controls = [...panel.querySelectorAll('input:not([type="file"]),select,textarea')];
  const legacyCandidateName = String(progress.controls.find(item => item.key === 'candidate-name')?.value || '').trim();
  const [legacyLastName = '', ...legacyFirstNames] = legacyCandidateName.split(/\s+/);
  controls.forEach((control, index) => {
    const key = control.id || control.dataset.progressKey || `control-${index}`;
    control.dataset.progressKey = key;
    const saved = progress.controls.find(item => item.key === key);
    if (!saved) {
      if (key === 'candidate-last-name') control.value = legacyLastName;
      else if (key === 'candidate-first-name') control.value = legacyFirstNames.join(' ');
      return;
    }
    if (control.type === 'checkbox' || control.type === 'radio') control.checked = Boolean(saved.checked);
    else if (!control.readOnly) control.value = String(saved.value ?? '');
  });
  panel.dataset.progressStage = String(progress.stage || '');
  panel.dataset.progressIndex = String(Number(progress.stageIndex) || 0);
  return progress;
}
function saveTestProgressStage(testName, stage, stageIndex = 0) {
  const panel = viewContent.querySelector('.view-panel');
  if (!panel) return;
  panel.dataset.progressStage = stage;
  panel.dataset.progressIndex = String(stageIndex);
  saveTestProgress(testName);
}
function clearTestProgress(testName) {
  if (!currentUser?.discordId) return;
  try {
    localStorage.removeItem(testProgressStorageKey(currentUser, testName));
  } catch (error) {
    console.error(`Progress for ${testName} could not be cleared:`, error);
  }
}
function cooldownDraftStorageKey(user) {
  return `${COOLDOWN_DRAFT_STORAGE_PREFIX}${String(user?.discordId || '')}`;
}
function saveCooldownDraft(test, days) {
  if (!currentUser?.discordId) return;
  try {
    if (!test && !days) localStorage.removeItem(cooldownDraftStorageKey(currentUser));
    else localStorage.setItem(cooldownDraftStorageKey(currentUser), JSON.stringify({ test, days }));
  } catch (error) {
    console.error('Cooldown payment draft could not be saved:', error);
  }
}
function clearCooldownDraft() {
  if (!currentUser?.discordId) return;
  try {
    localStorage.removeItem(cooldownDraftStorageKey(currentUser));
  } catch (error) {
    console.error('Cooldown payment draft could not be cleared:', error);
  }
}
function cooldownPaymentAmount(test, days) {
  const rate = COOLDOWN_PAYMENT_RATES[test];
  const count = Number(days);
  if (!rate || !Number.isSafeInteger(count) || count < 1 || count > cooldownPaymentMaxDays(test)) return null;
  const amount = rate * count;
  return Number.isSafeInteger(amount) ? amount : null;
}
function cooldownPaymentMaxDays(test) {
  return ['ALS', 'BLS', 'RADIO'].includes(test) ? 3 : Object.hasOwn(COOLDOWN_PAYMENT_RATES, test) ? 5 : 0;
}
function cooldownPaymentPayerForCallsign(callsign, members) {
  const number = callsignNumber(callsign);
  if (number < 1) return null;
  return (Array.isArray(members) ? members : []).find(member =>
    callsignNumber(member?.callsign || member?.callSign) === number &&
    String(member?.name || '').trim() &&
    /^\d+$/.test(String(member?.discordId || '').trim())
  ) || null;
}
function cooldownPaymentMessage(member, test, days) {
  const amount = cooldownPaymentAmount(test, days);
  if (!member || !amount) return '';
  const callsign = normalizeCallsign(member.callsign || member.callSign);
  const discordId = String(member.discordId || '').trim();
  const name = String(member.name || '').replace(/\s+/g, ' ').trim();
  const rank = String(member.rank || '').replace(/\s+/g, ' ').trim();
  if (callsignNumber(callsign) < 1 || !/^\d+$/.test(discordId) || !name) return '';
  return [
    `CANDIDAT: <@${discordId}>`,
    `Grad: ${rank || '—'}`,
    `Calificare: ${COOLDOWN_PAYMENT_LABELS[test]}`,
    `Nr. zile: ${Number(days)}`,
    `Suma: ${new Intl.NumberFormat('ro-RO').format(amount)}$`
  ].join('\n');
}
function mergeTestDefinitions(defaults, stored) {
  defaults ||= {};
  stored ||= {};
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const safeStored = Object.fromEntries(Object.entries(stored || {}).filter(([key]) => !UNSAFE_KEYS.has(key)));
  const definitions = { ...(defaults || {}), ...safeStored };
  return Object.fromEntries(Object.entries(definitions).filter(([name]) => !UNSAFE_KEYS.has(name)).map(([name, definition]) => {
    const merged = { ...(defaults?.[name] || {}), ...(definition || {}) };
    if (['Test ALS', 'Test SMULS', 'Test PILOT'].includes(name) && defaults?.[name]) {
      if (defaults[name].description) merged.description = defaults[name].description;
      if (defaults[name].instructions) merged.instructions = defaults[name].instructions;
    }
    if (Array.isArray(merged.questions)) {
      merged.questions = merged.questions.map(q => Array.isArray(q) ? { text: q[0] || '', answer: q[1] || '' } : q);
    }
    const defaultPractical = defaults?.[name]?.practical;
    const storedPractical = stored?.[name]?.practical;
    const safeStoredPractical = (Array.isArray(storedPractical) ? storedPractical : []).filter(stage => stage && typeof stage === 'object');
    if (Array.isArray(defaultPractical) && Array.isArray(storedPractical)) {
      merged.practical = defaultPractical.map((stage, index) => {
        const mergedStage = { ...stage, ...(safeStoredPractical[index] || {}) };
        if (stage.images?.length) {
          mergedStage.images = stage.images;
          mergedStage.imageSlots = Number(stage.imageSlots) || stage.images.length;
        }
        return mergedStage;
      });
      merged.practical.push(...safeStoredPractical.slice(defaultPractical.length));
    }
    const defaultPracticalStage = defaults?.[name]?.practicalStage;
    const storedPracticalStage = stored?.[name]?.practicalStage;
    if (defaultPracticalStage && storedPracticalStage) {
      merged.practicalStage = { ...defaultPracticalStage, ...storedPracticalStage };
      if (defaultPracticalStage.images?.length) {
        merged.practicalStage.images = defaultPracticalStage.images;
        merged.practicalStage.imageSlots = Number(defaultPracticalStage.imageSlots) || defaultPracticalStage.images.length;
      }
    }
    const defaultEvaluationStages = defaults?.[name]?.evaluationStages;
    const storedEvaluationStages = stored?.[name]?.evaluationStages;
    const safeStoredEvaluation = (Array.isArray(storedEvaluationStages) ? storedEvaluationStages : []).filter(stage => stage && typeof stage === 'object');
    if (Array.isArray(defaultEvaluationStages) && Array.isArray(storedEvaluationStages)) {
      merged.evaluationStages = defaultEvaluationStages.map((stage, index) => {
        const mergedStage = { ...stage, ...(safeStoredEvaluation[index] || {}) };
        if (stage.images?.length) {
          mergedStage.images = stage.images;
          mergedStage.imageSlots = Number(stage.imageSlots) || stage.images.length;
        }
        return mergedStage;
      });
      merged.evaluationStages.push(...safeStoredEvaluation.slice(defaultEvaluationStages.length));
    }
    return [name, merged];
  }));
}
/** @type {Record<string, TestDefinition>} */
const defaultTestDefinitions = window.MEDICAL_TESTS || Object.fromEntries(catalog.map(name => [name, { name, description: `Acces disponibil pentru ${name}.`, questions: [] }]));
let testDefinitions = mergeTestDefinitions(defaultTestDefinitions, readStored(TEST_CATALOG_KEY, {}));
function saveTestDefinitions() { localStorage.setItem(TEST_CATALOG_KEY, JSON.stringify(testDefinitions)); }
async function fetchGlobalTestDefinitions() {
  try {
    const res = await fetch('/api/test-definitions', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data.definitions === 'object' && data.definitions) {
      testDefinitions = mergeTestDefinitions(defaultTestDefinitions, data.definitions);
      saveTestDefinitions();
    }
  } catch {}
}
async function persistTestDefinitions() {
  const res = await fetch('/api/test-definitions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definitions: testDefinitions })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Eroare server (${res.status})`);
  return data;
}
