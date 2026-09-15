export const catalog = ['Test admitere', 'Test transfer', 'Adeverință medicală', 'Test SMULS', 'Test MOTO', 'Test ALS', 'Test PILOT', 'Test parașutiști'];
export const coreTests = ['Test admitere', 'Test transfer', 'Adeverință medicală'];
export const LEADERSHIP_RANK_KEYWORDS = ['DIRECTOR', 'INSPECTOR', 'CONDUCERE', 'MANAGER', 'COORDONATOR'];
export const LEADERSHIP_DEPT_KEYWORDS = ['CONDUCERE', 'MEDICAL'];

export function normalize(value = '') { return String(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }

export function callsignNumber(value = '') { return Number(String(value).replace(/\D/g, '')) || 0; }

export function isLeadershipRow(row) {
  const number = callsignNumber(row[2]);
  const rank = normalize(row[4]);
  const dept = normalize(row[5]);
  return (number >= 1 && number <= 15) || LEADERSHIP_RANK_KEYWORDS.some(value => rank.includes(value)) || LEADERSHIP_DEPT_KEYWORDS.some(value => dept.includes(value));
}

export function isLeadership(csNum, rank, dept) {
  const normalizedRank = normalize(rank);
  const normalizedDept = normalize(dept);
  const number = Number(csNum) || 0;
  return (number >= 1 && number <= 15) || LEADERSHIP_RANK_KEYWORDS.some(value => normalizedRank.includes(value)) || LEADERSHIP_DEPT_KEYWORDS.some(value => normalizedDept.includes(value));
}

export function hasFunction(functions, pattern) { return pattern.test(normalize(functions)); }

export function specializationFor(functions) {
  const eligible = [];
  if (hasFunction(functions, /SMULS|\s*S\s*\|/)) eligible.push('Test SMULS');
  if (hasFunction(functions, /MOTO|\s*M\s*\|/)) eligible.push('Test MOTO');
  if (hasFunction(functions, /ALS|\s*A\s*\|/)) eligible.push('Test ALS');
  if (hasFunction(functions, /PILOT|\s*P\s*\|/)) eligible.push('Test PILOT');
  if (hasFunction(functions, /PARASUTIST|PARAȘUTIST|\s*PT\s*\|/)) eligible.push('Test parașutiști');
  return eligible;
}

export function accessFor(csNum, functions, rank, dept) {
  const leadership = isLeadership(csNum, rank, dept);
  const isTester = /TESTER/.test(normalize(functions));
  const allowedTests = leadership ? catalog : (isTester ? coreTests : []);
  return {
    isConducere: leadership,
    isLeadership: leadership,
    accessLevel: leadership ? 'leadership' : 'tester',
    allowedTests: [...allowedTests],
    eligibleSpecializations: specializationFor(functions),
    grantedTests: []
  };
}

export function normalizeTests(tests) {
  return [...new Set((Array.isArray(tests) ? tests : []).filter(test => catalog.includes(test)))];
}
