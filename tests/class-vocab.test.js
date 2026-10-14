// Class Progress -> 📖 Word Lab: a class's vocabulary at a glance.
//
// One row per student from rt_class_vocab: the level they are on and where the
// Assessment placed them, words mastered of words met, levels passed, words due
// for review, when they last practised, and the words they miss most. A student
// who has never opened Word Lab says so rather than showing a row of zeros that
// reads like a student who tried and learned nothing.
//
// Run: node tests/class-vocab.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`pass  ${label}`); } else { fail++; console.log(`  FAIL  ${label}`); } };

function extract(name) {
  const re = new RegExp('\\n {6}(?:async\\s+)?' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) { if (html[i] === '(') pd++; else if (html[i] === ')') { pd--; if (pd === 0) { i++; break; } } }
  const sig = html.slice(m.index + 1, i).trim();
  i = html.indexOf('{', i);
  const start = i; let depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return new Function(sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')), html.slice(start + 1, i - 1));
}

const app = {
  escapeHtml: (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  _classVocabHtml: extract('_classVocabHtml'),
};
const NOW = new Date('2026-10-13T18:00:00Z');
const rows = [
  { first_name: 'Ada', last_name: 'Pell', current_grade: '6', current_level: 3, placement_grade: '5', words_met: 40, mastered: 18,
    levels_passed: 2, due: 5, last_practised: '2026-10-12T15:00:00Z', trouble: ['scrutinize', 'ambiguous'] },
  { first_name: 'Bo', last_name: '<b>Rook</b>', current_grade: 'K', current_level: 1, placement_grade: 'K', words_met: 3, mastered: 0,
    levels_passed: 0, due: 0, last_practised: '2026-10-13T09:00:00Z', trouble: [] },
  { first_name: 'Cy', last_name: 'Moss', current_grade: null, words_met: 0, mastered: 0, levels_passed: 0, due: 0, trouble: [] },
];
const out = app._classVocabHtml(rows, NOW);
const text = out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

ok('counts who is using it', /2 of 3 students using Word Lab/.test(text));
ok('level and placement', /Gr 6 · L3/.test(text) && /placed Gr 5/.test(text));
ok('Kindergarten reads as K', /K · L1/.test(text) && /placed K/.test(text));
ok('mastered of met, and levels passed', /18 \/ 40/.test(text) && /2 levels passed/.test(text) && /0 levels passed/.test(text));
ok('words due are highlighted', /color: var\(--warning, #e67e22\); font-weight: 600;">5</.test(out));
ok('last practised in days', /yesterday/.test(text) && /today/.test(text));
ok('the words to work on', /scrutinize, ambiguous/.test(text));
ok('a student who never started says so', /Cy Moss Not started Word Lab/.test(text));
ok('names are escaped', !/<b>Rook<\/b>/.test(out) && /&lt;b&gt;Rook/.test(out));
ok('an empty class says so', /No students are enrolled/.test(app._classVocabHtml([], NOW)));
ok('the tab is offered in Class Progress', /\['vocab', '📖 Word Lab'\]/.test(html));
ok('  and loads rt_class_vocab', /_pickupRpc\('rt_class_vocab', \{ p_class_id: classId \}\)/.test(html));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
