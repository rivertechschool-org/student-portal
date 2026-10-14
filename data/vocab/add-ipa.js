#!/usr/bin/env node
// Adds an IPA pronunciation (`ipa`) to every Word Lab word the CMU Pronouncing
// Dictionary knows, converting its ARPAbet to IPA. Words it does not know keep
// only their respelling (`say`), which every entry has anyway.
//
// The dictionary is not kept in this repo (it is 3.6 MB). Fetch it, then run:
//   curl -sSfLO https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
//   node data/vocab/add-ipa.js path/to/cmudict.dict
//
// CMU Pronouncing Dictionary: BSD licence, copy in LICENSE-cmudict.txt.

const fs = require('fs');
const path = require('path');

const dictPath = process.argv[2];
if (!dictPath || !fs.existsSync(dictPath)) {
  console.error('usage: node data/vocab/add-ipa.js path/to/cmudict.dict');
  process.exit(2);
}

// General American IPA. Stressed AH is ʌ, unstressed ə; ER likewise ɝ / ɚ.
const IPA = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ',
  IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm',
  N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j',
  Z: 'z', ZH: 'ʒ',
};
const isVowel = (p) => /\d$/.test(p);
// Consonant pairs English lets start a syllable; the stress mark goes before
// them ("ɪˈnɔɹ" not "ɪnˈɔɹ").
const ONSETS = new Set(['P R', 'P L', 'B R', 'B L', 'T R', 'D R', 'K R', 'K L', 'G R', 'G L', 'F R', 'F L',
  'TH R', 'SH R', 'S P', 'S T', 'S K', 'S M', 'S N', 'S L', 'S W', 'K W', 'T W', 'D W', 'G W', 'P Y', 'B Y',
  'K Y', 'F Y', 'M Y', 'H Y', 'V Y']);

function toIpa(phones) {
  const out = phones.map((p) => {
    const base = p.replace(/\d$/, '');
    if (base === 'AH' && p.endsWith('0')) return 'ə';
    if (base === 'ER' && p.endsWith('0')) return 'ɚ';
    return IPA[base] || '';
  });
  // Stress marks, inserted from the end so earlier indexes stay put.
  const marks = [];
  phones.forEach((p, i) => {
    const s = p.match(/(\d)$/);
    if (!s || s[1] === '0') return;
    let start = i;
    if (i >= 1 && !isVowel(phones[i - 1])) {
      start = i - 1;
      if (i >= 2 && !isVowel(phones[i - 2]) && ONSETS.has(`${phones[i - 2].replace(/\d$/, '')} ${phones[i - 1].replace(/\d$/, '')}`)) start = i - 2;
    }
    marks.push([start, s[1] === '1' ? 'ˈ' : 'ˌ']);
  });
  // A one-syllable word needs no stress mark.
  const vowels = phones.filter(isVowel).length;
  if (vowels > 1) marks.sort((a, b) => b[0] - a[0]).forEach(([i, m]) => { out.splice(i, 0, m); });
  return out.join('');
}

const dict = new Map();
for (const line of fs.readFileSync(dictPath, 'utf8').split('\n')) {
  const m = line.match(/^([^\s(]+)(\(\d+\))?\s+(.+?)(\s+#.*)?$/);
  if (!m || m[2]) continue;            // first pronunciation only
  dict.set(m[1].toLowerCase(), m[3].trim().split(/\s+/));
}

let added = 0, missing = 0;
for (const f of fs.readdirSync(__dirname).filter((n) => /^grade-[0-9K]+\.json$/.test(n))) {
  const file = path.join(__dirname, f);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const e of data.words) {
    const ph = dict.get(String(e.w).toLowerCase());
    if (ph) { e.ipa = toIpa(ph); added++; }
    else { delete e.ipa; missing++; }
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
}
console.log(`ipa added to ${added} words; ${missing} not in the dictionary (they keep their respelling)`);
