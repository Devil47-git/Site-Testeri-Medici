*import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'script.js'), 'utf8');

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error('missing ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const parts = ['normalizeText', 'escapeHtml', 'parseIdentityCardText', 'mergeIdentityCardDetails'].map(extract).join('\n');
const fn = new Function(`${parts}\nreturn parseIdentityCardText;`)();

// This is the card the user attached: "Cazan / Silviu Petru".
// These are plausible noisy OCR transcripts of it - the label row is
// watermarked by a hologram, so "Prenume" is often mangled.
const cases = [
  ['clean', `CARTE D'IDENTITE
CNP 903236624
Name/Nom/Last name
Cazan
Prenume/Prenom/First name
Silviu Petru`],

  // "First name" misread as "Firs anime" (rn -> m, t lost) - the reported bug
  ['firs anime', `CARTE DE IDENTITATE
CNP 903236624
Name/Nom/Last name
Cazan
Prenume/Prenom/Firs anime
Silviu Petru`],

  // label row merged with the value on the same line
  ['inline value', `CNP 903236624
Name/Nom/Last name Cazan
Prenume/Prenom/Firs anime Silviu Petru`],

  // hologram noise around the value
  ['noise', `Los Santos
CARTE DE IDENTITATE
SERIA LS NR 66424
CNP 903236624
Name/Nom/Last name
Cazan
Prenume/Prenom/First name
Silviu Petru
Cetatenie/Nationality/Nationality
Romana
Sex/Sex/Sex
M
Loc nastere/Lieu de naissance/Place of birth
Los Santos
Domiciliu/Address/Adress
Emisa de/Delivered par/Issued by
Departamentul de Politie Los Santos
IDLS<<<<<<<<<<<<<<<<<<<<<<
CITIZEN<<<<<<<<<<<<<<<<<<<<<<<<<<
MD22TNYIL34JK58<<<<<<<<23NM45B<<DB08NOWNCT62RGD<<<<<<`],

  // tesseract pageseg 6 often keeps the label and value glued
  ['glued', `Name/Nom/Last name
Cazan
Prenume/Prenom/First name
Silviu Petru`],
];

let bad = 0;
for (const [label, text] of cases) {
  const r = fn(text);
  const ok = r.lastName === 'Cazan' && r.firstName === 'Silviu Petru';
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(14)} last=${JSON.stringify(r.lastName)} first=${JSON.stringify(r.firstName)} cnp=${JSON.stringify(r.cnp)}`);
}
console.log(bad ? `\n${bad} failing` : '\nall pass');

// The CNP on this card is 9 digits - the parser must not silently drop it.
const cnp9 = fn(`CNP 903236624\nName/Nom/Last name\nCazan\nPrenume/Prenom/First name\nSilviu Petru`);
console.log('short CNP ->', JSON.stringify(cnp9.cnp), cnp9.cnp === '903236624' ? 'PASS' : 'FAIL');

// A long CNP that OCR splits across the label row.
const cnpSplit = fn(`CNP 10903236624\nName/Nom/Last name\nPopescu\nPrenume/Prenom/First name\nAna Maria`);
console.log('split CNP ->', JSON.stringify(cnpSplit));

// Surnames containing the letter that trips the label matcher.
for (const [surname, first] of [['Firs', 'Anime'], ['Name', 'Test'], ['Grebla', 'Mihai'], ['Nom', 'Prenume'], ['Ionescu', 'Ștefan'], ['Munteanu', 'Ana-Maria']]) {
  const r = fn(`CNP 10903236624\nName/Nom/Last name\n${surname}\nPrenume/Prenom/First name\n${first}`);
  const ok = r.lastName === surname && r.firstName === first;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${surname} ${first} -> last=${JSON.stringify(r.lastName)} first=${JSON.stringify(r.firstName)}`);
}
console.log(bad ? `\n${bad} failing overall` : '\nall pass overall');