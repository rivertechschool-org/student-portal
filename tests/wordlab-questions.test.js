// Word Lab: every word in the bank makes sound questions.
//
// Word Lab builds its questions from the word bank at run time - a blank cut
// out of the example, wrong sentences made from other words' examples, wrong
// spellings made by rule. A word whose example doesn't contain it exactly, or
// a misspelling rule that lands on the right spelling, is a broken question a
// child gets marked wrong on. This runs the REAL builders from
// games/lyceum-wordlab.js over every word in data/vocab and checks:
//
//   * the blank removes the word and only that
//   * every question has exactly one right option and no repeated options
//   * a "wrong sentence" is never the right one, and names the word
//   * no misspelling is the real spelling
//   * the schedule: right moves a word up only when due; wrong drops it to 1
//
// Run: node tests/wordlab-questions.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const fails = [];
const check = (label, cond, detail) => {
  if (cond) pass++;
  else { fail++; if (fails.length < 25) fails.push(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// A window just big enough for the module to load.
const store = {};
const ctx = {
  console, setTimeout, clearTimeout, Promise, JSON, Math, Date, String, Number, Array, Object, Set, Map, RegExp,
  USER_ID: 'test', location: { origin: 'http://test' },
  localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  document: { head: { appendChild() {} }, createElement: () => ({ style: {} }), querySelector: () => null, getElementById: () => null },
  fetch: async (url) => {
    const m = url.match(/grade-([0-9K]+)\.json/);
    const file = path.join(ROOT, 'data', 'vocab', `grade-${m[1]}.json`);
    return { ok: fs.existsSync(file), json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  },
};
ctx.window = ctx;
ctx.window.parent = ctx.window;
ctx.addEventListener = () => {};
ctx.window.addEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'games', 'lyceum-wordlab.js'), 'utf8'), ctx);
const W = ctx.WordLab._internals;

(async () => {
  const grades = W.GRADES.filter(g => fs.existsSync(path.join(ROOT, 'data', 'vocab', `grade-${g}.json`)));
  let words = 0;
  for (const g of grades) {
    const bank = await W.loadGrade(g);
    for (const e of bank) {
      words++;
      const tag = `grade ${g} "${e.w}"`;

      const blank = W.blankOut(e);
      check(`${tag}: the blank removes the word`, /wl-blank/.test(blank) && !W.wordRx(e.w).test(blank.replace(/<[^>]+>/g, ' ')), blank);

      for (const kind of ['meaning', 'word', 'blank', 'usage', 'synonym', 'spellpick', 'hear']) {
        const q = W.makeQuestion(e, kind);
        if (!q.options) continue;
        const right = q.options.filter(o => o.ok);
        check(`${tag} ${q.kind}: exactly one right answer`, right.length === 1, JSON.stringify(q.options));
        const texts = q.options.map(o => String(o.t).toLowerCase());
        check(`${tag} ${q.kind}: no repeated options`, new Set(texts).size === texts.length, JSON.stringify(texts));
        check(`${tag} ${q.kind}: at least three options`, q.options.length >= 3, JSON.stringify(texts));
        if (q.kind === 'usage') {
          q.options.filter(o => !o.ok).forEach(o => {
            check(`${tag} usage: a wrong sentence is not the right one`, o.t !== e.ex, o.t);
            check(`${tag} usage: a wrong sentence uses the word`, W.wordRx(e.w).test(o.t), o.t);
          });
        }
        if (q.kind === 'spellpick') {
          q.options.filter(o => !o.ok).forEach(o => check(`${tag}: a misspelling is not the spelling`, o.t.toLowerCase() !== e.w.toLowerCase(), o.t));
        }
      }
      W.misspellings(e.w).forEach(m => check(`${tag}: misspelling differs`, m.toLowerCase() !== e.w.toLowerCase(), m));
    }
    check(`grade ${g}: every level but the last has twelve words`,
      Array.from({ length: Math.ceil(bank.length / W.LEVEL_SIZE) - 1 }, (_, i) => W.levelWords(g, i + 1).length).every(n => n === W.LEVEL_SIZE));
  }

  // The schedule mirror: same rule as rt_vocab_record.
  const S = W.S;
  const e = (await W.loadGrade(grades[0]))[0];
  S.words = {};
  W.applyResult(e, true);
  check('new word, right: box 1', S.words[e.k].box === 1);
  W.applyResult(e, true);
  check('right again before it is due: still box 1, but counted', S.words[e.k].box === 1 && S.words[e.k].right === 2);
  S.words[e.k].due = Date.now() - 1;
  W.applyResult(e, true);
  check('right when due: box 2', S.words[e.k].box === 2);
  for (let i = 0; i < 2; i++) { S.words[e.k].due = Date.now() - 1; W.applyResult(e, true); }
  check('four due reviews right: mastered', S.words[e.k].box === 4 && S.words[e.k].mastered === true);
  W.applyResult(e, false);
  check('wrong: back to box 1, due now, not mastered', S.words[e.k].box === 1 && S.words[e.k].due <= Date.now() && !S.words[e.k].mastered);

  fails.forEach(f => console.log(f));
  console.log(`\n${words} words in ${grades.length} grades checked`);
  console.log(`${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
