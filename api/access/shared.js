export const catalog = ['Test admitere', 'Test transfer', 'Adeverință medicală', 'Test SMULS', 'Test MOTO', 'Test ALS', 'Test PILOT', 'Test parașutiști'];
export const coreTests = ['Test admitere', 'Test transfer', 'Adeverință medicală'];
export const LEADERSHIP_RANK_KEYWORDS = ['DIRECTOR', 'INSPECTOR', 'CONDUCERE', 'MANAGER', 'COORDONATOR'];
export const LEADERSHIP_DEPT_KEYWORDS = ['CONDUCERE'];

// Grade groups: conducere (001-015), medic primar (101-115), medic specialist (201-230).
export const GRADE_GROUPS = {
  leadership: { label: 'Conducerea departamentului', min: 1, max: 15 },
  primar: { label: 'Medici Primari (101-115)', min: 101, max: 115 },
  specialist: { label: 'Medici Specialisti (201-230)', min: 201, max: 230 }
};
export const LEADERSHIP_MAX = 15;

export function gradeGroupFor(csNum) {
  const n = Number(csNum) || 0;
  if (n >= GRADE_GROUPS.leadership.min && n <= GRADE_GROUPS.leadership.max) return 'leadership';
  if (n >= GRADE_GROUPS.primar.min && n <= GRADE_GROUPS.primar.max) return 'primar';
  if (n >= GRADE_GROUPS.specialist.min && n <= GRADE_GROUPS.specialist.max) return 'specialist';
  return '';
}

export function normalize(value = '') { return String(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }

export function callsignNumber(value = '') { return Number(String(value).replace(/\D/g, '')) || 0; }

export function isLeadershipRow(row) {
  const number = callsignNumber(row[2]);
  const rank = normalize(row[4]);
  const dept = normalize(row[5]);
  return (number >= 1 && number <= LEADERSHIP_MAX) || LEADERSHIP_RANK_KEYWORDS.some(value => rank.includes(value)) || LEADERSHIP_DEPT_KEYWORDS.some(value => dept.includes(value));
}

export function isLeadership(csNum, rank, dept) {
  const normalizedRank = normalize(rank);
  const normalizedDept = normalize(dept);
  const number = Number(csNum) || 0;
  return (number >= 1 && number <= LEADERSHIP_MAX) || LEADERSHIP_RANK_KEYWORDS.some(value => normalizedRank.includes(value)) || LEADERSHIP_DEPT_KEYWORDS.some(value => normalizedDept.includes(value));
}

export function hasFunction(functions, pattern) { return pattern.test(normalize(functions)); }

export function specializationFor(functions) {
  const eligible = [];
  if (hasFunction(functions, /S\.?\s*M\.?\s*U\.?\s*L\.?\s*S\.?|\s*S\s*\|/)) eligible.push('Test SMULS');
  if (hasFunction(functions, /MOTO|\s*M\s*\|/)) eligible.push('Test MOTO');
  if (hasFunction(functions, /A\.?\s*L\.?\s*S\.?|\s*A\s*\|/)) eligible.push('Test ALS');
  if (hasFunction(functions, /PILOT|\s*P\s*\|/)) eligible.push('Test PILOT');
  return eligible;
}

export function functionsForMember(csNum, functions = '') {
  const currentFunctions = String(functions || '').trim();
  const group = gradeGroupFor(csNum);
  if (!['primar', 'specialist'].includes(group) || /\bTESTER\b/.test(normalize(currentFunctions))) return currentFunctions;
  return [currentFunctions, 'TESTER'].filter(Boolean).join(' | ');
}

export function testsForFunctions(functions) {
  const assigned = specializationFor(functions);
  if (/\bTESTER\b/.test(normalize(functions))) assigned.unshift(...coreTests);
  return [...new Set(assigned)];
}

export function accessFor(csNum, functions, rank, dept) {
  const leadership = isLeadership(csNum, rank, dept);
  const gradeGroup = gradeGroupFor(csNum);
  const assignedFunctions = functionsForMember(csNum, functions);
  return {
    isConducere: leadership,
    isLeadership: leadership,
    accessLevel: leadership ? 'leadership' : 'tester',
    gradeGroup,
    allowedTests: leadership ? [...catalog] : [],
    eligibleSpecializations: specializationFor(assignedFunctions),
    grantedTests: leadership ? [] : testsForFunctions(assignedFunctions)
  };
}

export function normalizeTests(tests) {
  const normalized = [...new Set((Array.isArray(tests) ? tests : []).filter(test => catalog.includes(test)))];
  if (!coreTests.some(test => normalized.includes(test))) return normalized;
  return [...coreTests, ...normalized.filter(test => !coreTests.includes(test))];
}
