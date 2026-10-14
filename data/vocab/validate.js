#!/usr/bin/env node
// Checks the Word Lab word bank (data/vocab/grade-*.json) against the rules in
// README.md. The game builds its questions straight from these fields - a cloze
// blanks the headword out of `ex`, a definition question offers `def` - so a
// word whose example does not contain it, or whose definition gives it away,
// becomes a broken question. This is that check.
//
// Run: node data/vocab/validate.js            (all grades)
//      node data/vocab/validate.js 3          (one grade)

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection', 'determiner']);
const MIN_WORDS = 500;

const only = process.argv[2];
const grades = only ? [only] : GRADES;
let errors = 0, warnings = 0, total = 0;
const seen = new Map();   // word -> grade, across files

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (w) => new RegExp(`(^|[^A-Za-z'-])${esc(w)}($|[^A-Za-z'-])`, 'i');
// The obvious forms a definition must not lean on: the word itself and its
// stem with a common ending ("enormous" in "enormously", "run" in "running").
const stemOf = (w) => w.toLowerCase().replace(/(ing|ed|es|s|ly|er|est|ness|ment|tion|ful)$/, '');

for (const g of grades) {
  const file = path.join(DIR, `grade-${g}.json`);
  if (!fs.existsSync(file)) { if (only) { console.log(`grade-${g}.json: missing`); errors++; } continue; }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log(`grade-${g}.json: not valid JSON - ${e.message}`); errors++; continue; }
  const err = (i, w, msg) => { errors++; console.log(`grade-${g} #${i + 1} ${w || '?'}: ${msg}`); };
  const warn = (i, w, msg) => { warnings++; console.log(`  warn grade-${g} #${i + 1} ${w}: ${msg}`); };

  if (String(data.grade) !== g) err(-1, '', `"grade" is ${JSON.stringify(data.grade)}, expected "${g}"`);
  const words = Array.isArray(data.words) ? data.words : [];
  if (words.length < MIN_WORDS) err(-1, '', `only ${words.length} words (want at least ${MIN_WORDS})`);
  total += words.length;
  const inFile = new Set();
  // "Use it right" swaps the word into other words' examples; two examples that
  // are the same apart from the headword make the same wrong sentence twice.
  const frames = new Map();

  words.forEach((e, i) => {
    const w = e && e.w;
    if (typeof w !== 'string' || !w.trim()) return err(i, w, 'no headword');
    if (/\s/.test(w)) err(i, w, 'headword has a space');
    if (w !== w.trim()) err(i, w, 'headword has surrounding spaces');
    const key = w.toLowerCase();
    if (inFile.has(key)) err(i, w, 'appears twice in this grade');
    inFile.add(key);
    if (seen.has(key)) err(i, w, `also in grade ${seen.get(key)} (keep the lower grade)`);
    else seen.set(key, g);

    if (!POS.has(e.pos)) err(i, w, `pos "${e.pos}" is not one of ${[...POS].join(', ')}`);

    if (typeof e.def !== 'string' || e.def.trim().length < 3) err(i, w, 'no definition');
    else {
      if (/\.$/.test(e.def.trim())) warn(i, w, 'definition ends with a full stop');
      if (wholeWord(w).test(e.def)) err(i, w, `definition contains the headword: "${e.def}"`);
      const st = stemOf(w);
      if (st.length >= 4 && new RegExp(`\\b${esc(st)}`, 'i').test(e.def)) err(i, w, `definition leans on "${st}": "${e.def}"`);
    }

    if (typeof e.ex !== 'string' || e.ex.trim().length < 8) err(i, w, 'no example sentence');
    else {
      if (!wholeWord(w).test(e.ex)) err(i, w, `example does not use "${w}" exactly: "${e.ex}"`);
      if (!/[.!?]["”']?$/.test(e.ex.trim())) err(i, w, `example does not end with . ! or ?: "${e.ex}"`);
      if (e.ex.length > 160) warn(i, w, 'example is long');
      const frame = e.ex.toLowerCase().split(key).join('_');
      if (frames.has(frame)) err(i, w, `example is the same as "${frames.get(frame)}"'s apart from the word`);
      else frames.set(frame, w);
    }

    if (!Array.isArray(e.syn)) err(i, w, 'syn is not a list');
    else {
      if (e.syn.length > 3) err(i, w, 'more than 3 synonyms');
      e.syn.forEach(s => {
        if (typeof s !== 'string' || !s.trim()) err(i, w, 'empty synonym');
        else if (s.toLowerCase() === key) err(i, w, 'synonym is the headword');
        else if (/\s/.test(s.trim())) warn(i, w, `synonym "${s}" is more than one word`);
      });
    }

    if (e.near !== undefined) {
      if (!Array.isArray(e.near) || e.near.some(x => typeof x !== 'string' || !x.trim())) err(i, w, '`near` must be a list of words');
      else e.near.forEach(x => {
        if (x.toLowerCase() === key) err(i, w, '`near` lists the word itself');
        else if (!words.some(o => o.w.toLowerCase() === x.toLowerCase())) err(i, w, `\`near\` word "${x}" is not in this grade`);
        else if (!(words.find(o => o.w.toLowerCase() === x.toLowerCase()).near || []).some(y => y.toLowerCase() === key)) warn(i, w, `"${x}" does not list "${w}" back in its \`near\``);
      });
    }

    if (typeof e.say !== 'string' || !/^[A-Za-z]+(-[A-Za-z]+)*$/.test(e.say)) err(i, w, `respelling "${e.say}" is not syllables joined by hyphens`);
    else if (!/[A-Z]{2,}|^[A-Z]+$|-[A-Z]+(-|$)|^[A-Z]+-/.test(e.say) && e.say.split('-').length > 1) err(i, w, `respelling "${e.say}" has no stressed syllable in CAPITALS`);
  });
}

console.log(`\n${total} words, ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
