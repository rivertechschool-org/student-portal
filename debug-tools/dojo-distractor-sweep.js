// Math Dojo: on a multiple-choice question, could a student pick the answer
// without doing the maths?
//
// Reported 2026-10-02 with "Order from shortest to longest: ruler, paperclip,
// book" offering  -1 / paperclip, book, ruler / 2 / 1. Only one choice was even
// the right KIND of thing. The cause was generateQuestion's fallback: a
// generator that returned a word answer and no options got distractors made by
// nudging the number 0, so every word question built that way showed three
// small integers beside its answer.
//
// This runs the REAL page script (every generator, through the real
// generateQuestion and its option hygiene) many times and flags:
//
//   1. an answer that is a list, a point or words, beside two or more bare
//      numbers - the only choice that is even the right shape
//   2. a list or point answer that is the only list or point on the board
//   3. fewer than two choices, the answer missing from the board, or
//      answerIndex pointing elsewhere
//   4. a wrong choice with the same VALUE as the answer ("4 2/2" for 5): a
//      right answer marked wrong. Not judged when the question is about form
//      (simplest form, rounding, converting), where that is the lesson.
//   5. two wrong choices with the same value (2/8 and 1/4): neither can be it
//
// Yes/no and three-way comparisons are allowed fewer than four choices.
//
// Usage: node debug-tools/dojo-distractor-sweep.js    (exits non-zero on a finding)
//        RUNS=200 node debug-tools/dojo-distractor-sweep.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const RUNS = Number(process.env.RUNS || 60);

// Same accept-anything page as dojo-step-hints.js: the script touches the DOM
// while loading and none of it matters to the generators.
function anything() {
  const fn = function () { return anything(); };
  return new Proxy(fn, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'length') return 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      return anything();
    },
    set: () => true, apply: () => anything(), construct: () => anything(),
  });
}
const storage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }; };
const sandbox = {
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  document: anything(), navigator: { userAgent: 'node', language: 'en' },
  location: { href: 'http://localhost/games/math-dojo.html', search: '', hash: '', pathname: '/games/math-dojo.html', reload() {} },
  localStorage: storage(), sessionStorage: storage(),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  fetch: () => new Promise(() => {}), Image: function () { return anything(); },
  Audio: function () { return anything(); }, AudioContext: function () { return anything(); },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  getComputedStyle: () => anything(), performance: { now: () => 0 },
  speechSynthesis: anything(), SpeechSynthesisUtterance: function () { return anything(); },
  supabase: anything(), Quill: function () { return anything(); },
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const probe = '\n;globalThis.__dojo = { generators, generateQuestion, shouldTypeAnswer, AnswerInterpreter };';
const loadErrors = [];
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); }
  catch (e) { loadErrors.push(`script ${i}: ${e.message}`); }
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) { loadErrors.push('probe: ' + e.message); } }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script:\n  ' + loadErrors.join('\n  ')); process.exit(2); }
const { generators, generateQuestion, shouldTypeAnswer } = sandbox.__dojo;

// The kind of thing a choice is: one quantity (7, -3, 2.5, 3/4, $12, 45%, 90°,
// 12 cm), a list of numbers ("1, 8, 15"), a point ("(0, -2)"), or words.
// Anything else - expressions, formulas - is not judged.
const QTY = String.raw`[-+±]?\$?-?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?\s*(?:%|°|¢)?`;
function kind(v) {
  const s = String(v).trim();
  if (new RegExp(String.raw`^${QTY}$`).test(s)) return 'number';
  if (new RegExp(String.raw`^\(\s*${QTY}\s*,\s*${QTY}\s*\)$`).test(s)) return 'point';
  if (new RegExp(String.raw`^${QTY}(?:\s*,\s*${QTY}){2,}$`).test(s)) return 'list';
  if (/^[a-z][a-z\s,'’-]*$/i.test(s) && /[a-z]{3,}/i.test(s)) return 'words';
  return 'other';
}
// The classifier is the harness; if it drifts, every finding below is noise.
for (const [v, want] of [['7', 'number'], ['-3/4', 'number'], ['$12', 'number'], ['90°', 'number'],
                         ['(0, -2)', 'point'], ['1, 8, 15', 'list'], ['paperclip, book, ruler', 'words'],
                         ['3(x + 4)', 'other'], ['Quadrant II', 'words']]) {
  if (kind(v) !== want) { console.error(`kind(${v}) = ${kind(v)}, expected ${want}`); process.exit(2); }
}
const num = v => {
  const t = String(v).trim().replace(/^\$/, '');
  const f = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (f) return +f[1] / +f[2];
  const m = t.match(/^(-?\d+) (\d+)\/(\d+)$/);            // mixed number
  if (m) return +m[1] + Math.sign(+m[1] || 1) * (+m[2] / +m[3]);
  return /^-?\d+(?:\.\d+)?$/.test(t) ? +t : NaN;
};
// Two choices that are the same number however they are written. 2/4 beside
// 1/2 is fine when the question is ABOUT simplest form; the answer having a
// twin is not fine anywhere - the student picks the twin and is marked wrong.
const sameValue = (a, b) => { const x = num(a), y = num(b); return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9; };
// Kept identical to the page's own rule in generateQuestion.
const ABOUT_FORM = /simplest|simplif|lowest|reduce|nearest|round|equivalent|as a (?:fraction|decimal|percent|mixed)|improper|unsimplified/i;

// Words among numbers ON PURPOSE: the question is which one is not a number,
// or the right answer is genuinely "infinitely many" / "undefined" and the
// numbers are the real mistakes. Add to this only with that argument.
const INTENDED = [
  /does NOT belong/i,                          // T1 odd one out: the category is the lesson
  /how many lines can be drawn through/i,      // 1, 2, 3 vs infinitely many
  /^\s*tan\(|^\s*(?:sec|csc|cot)\(/i,          // undefined vs the values students compute
];

const findings = new Map();
const note = (kindOf, where, detail) => {
  const k = `${kindOf} | ${where}`;
  if (!findings.has(k)) findings.set(k, { n: 0, example: detail });
  findings.get(k).n++;
};
let asked = 0, mc = 0;

for (const tier of Object.keys(generators)) {
  for (const domain of Object.keys(generators[tier])) {
    const real = generators[tier][domain];
    for (let r = 0; r < RUNS; r++) {
      const where = `T${tier} ${domain}`;
      // One draw, seen twice: as the generator returned it, and after
      // generateQuestion's option hygiene. generateQuestion looks the
      // generator up at call time, so hand it this same draw.
      let raw, q;
      try { raw = real(); } catch (e) { note('generator throws', where, e.message); break; }
      generators[tier][domain] = () => raw;
      try { q = generateQuestion(+tier, domain); } catch (e) { note('generateQuestion throws', where, e.message); generators[tier][domain] = real; break; }
      generators[tier][domain] = real;
      if (!q) continue;
      asked++;
      if (shouldTypeAnswer(q, +tier)) continue;   // typed: the board is never shown
      mc++;
      const sub = q.subType ? `${where} (${q.subType})` : where;
      const show = `${String(q.question).replace(/\s+/g, ' ').slice(0, 70)}  ->  ${JSON.stringify(q.options)}  answer ${JSON.stringify(q.answer)}`;
      const opts = q.options || [];
      if (opts.length < 2) note('fewer than 2 choices', sub, show);
      const ai = opts.findIndex(o => String(o).trim().toLowerCase() === String(q.answer).trim().toLowerCase());
      if (ai < 0) note('answer not on the board', sub, show);
      else if (q.answerIndex !== ai) note('answerIndex points at a different choice', sub, show);
      const others = opts.filter((o, i) => i !== ai);
      // The answer is a list, a point or words, and the distractors are bare
      // numbers: the answer is the only choice that is even the right shape.
      const ak = kind(q.answer);
      if (ak === 'list' || ak === 'point' || ak === 'words') {
        const bare = others.filter(o => kind(o) === 'number').length;
        if (bare >= 2 && !INTENDED.some(re => re.test(q.question))) note(`${ak} answer among bare-number distractors`, sub, show);
      }
      if (ak === 'list' || ak === 'point') {
        const shaped = others.filter(o => kind(o) === ak).length;
        if (shaped === 0) note(`only the answer is a ${ak}`, sub, show);
      }
      const twin = ABOUT_FORM.test(String(q.question)) ? undefined : others.find(o => sameValue(o, q.answer));
      if (twin !== undefined) note('a distractor is the answer written differently (also correct)', sub, show);
      if (!ABOUT_FORM.test(String(q.question))) {
        for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++)
          if (String(others[i]).trim().toLowerCase() === String(others[j]).trim().toLowerCase() || sameValue(others[i], others[j]))
            note('two distractors are the same value', sub, show);
      }
    }
  }
}

console.log(`${asked} questions generated, ${mc} multiple-choice checked (RUNS=${RUNS})`);
if (!findings.size) { console.log('No findings.'); process.exit(0); }
for (const [k, { n, example }] of [...findings].sort()) console.log(`  ${n}x ${k}\n       e.g. ${example}`);
process.exit(1);
