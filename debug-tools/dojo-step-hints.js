// Math Dojo: does every guided step and typed question tell the student the
// right SHAPE of answer?
//
// The box a student types into shows an example ("e.g., 3/4") chosen by
// getSmartPlaceholder from the expected answer. It chose by surface features,
// so the answer "favorable / total" got "e.g., 3/4" because it contains a "/",
// and students typed the probability as numbers when the step wanted the
// formula. "perpendicular" got "e.g., 30° or 30 degrees" because one of its
// accepted alternatives was "90°". Every one of those is a student told the
// wrong thing by the screen, not by the lesson.
//
// This runs the REAL page script (every lesson generator and question
// generator, the real getSmartPlaceholder and AnswerInterpreter) and checks:
//
//   1. a step whose answer is words or a formula is never shown a NUMBER as
//      its example
//   2. a step accepts its own expected answer
//   3. where the answer is a fraction that can be reduced, the reduced form is
//      accepted too - unless the step is about the form itself (simplify,
//      lowest terms, equivalent, common denominator...)
//
// Usage: node debug-tools/dojo-step-hints.js     (exits non-zero on a finding)
//        RUNS=20 node debug-tools/dojo-step-hints.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const RUNS = Number(process.env.RUNS || 8);

// A page that accepts anything. The script touches the DOM while it loads
// (listeners, lookups, a canvas); none of that matters to the functions under
// test, so every property is a harmless callable that returns another one.
function anything() {
  const fn = function () { return anything(); };
  return new Proxy(fn, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'length') return 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;   // not a promise
      return anything();
    },
    set: () => true,
    apply: () => anything(),
    construct: () => anything(),
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

// Top-level `const` in a classic script is not a property of the global, so
// ask for the three things by name in the same realm.
const probe = '\n;globalThis.__dojo = { lessons, generateQuestion, shouldTypeAnswer, getSmartPlaceholder, AnswerInterpreter };';
const loadErrors = [];
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); }
  catch (e) { loadErrors.push(`script ${i}: ${e.message}`); }
});
if (!sandbox.__dojo) {
  // The probe runs at the end of the last script; if loading stopped early,
  // try it on its own before giving up.
  try { vm.runInContext(probe, sandbox); } catch (e) { loadErrors.push('probe: ' + e.message); }
}
if (!sandbox.__dojo) {
  console.error('Could not load the Math Dojo script:\n  ' + loadErrors.join('\n  '));
  process.exit(2);
}
const { lessons, generateQuestion, shouldTypeAnswer, getSmartPlaceholder, AnswerInterpreter } = sandbox.__dojo;

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const accepts = (input, acceptable) => {
  if (AnswerInterpreter.checkAnswer(String(input), acceptable).correct) return true;
  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');
  return acceptable.some(a => a != null && norm(a) === norm(input));   // the page's own fallback
};
const wordy = ans => /[a-z]{3,}/.test(ans) && !/^-?\d/.test(ans);
const numberExample = ph => /e\.g\.,?\s*[-(]?\d/.test(ph);
const ABOUT_FORM = /simplif|lowest|reduce|simplest|unsimplified|equivalent|rename|convert|common denominator|denominator of/i;

const findings = new Map();
const note = (kind, where, detail) => { const k = `${kind} | ${where} | ${detail}`; findings.set(k, (findings.get(k) || 0) + 1); };
let steps = 0, typed = 0, lessonCount = 0;

for (const tier of Object.keys(lessons)) {
  for (const skill of Object.keys(lessons[tier])) {
    lessonCount++;
    for (let r = 0; r < RUNS; r++) {
      let L;
      try { L = lessons[tier][skill](); } catch (e) { note('lesson throws', `T${tier} ${skill}`, e.message); break; }
      for (const st of (L?.guided?.interactiveSteps || [])) {
        steps++;
        const ans = String(st.answer ?? '').trim();
        const acc = st.acceptableAnswers || [st.answer];
        const ph = st.formatHint || getSmartPlaceholder(st);
        const where = `T${tier} ${skill} step "${String(st.prompt).replace(/\d+/g, '#').slice(0, 60)}"`;
        if (wordy(ans) && numberExample(ph)) note('words expected, number shown', where, `${ans} / "${ph}"`);
        if (ans && !accepts(ans, acc)) note('own answer rejected', where, ans);
        const f = ans.match(/^(-?\d+)\s*\/\s*(\d+)$/);
        if (f && gcd(+f[1], +f[2]) > 1 && !ABOUT_FORM.test(`${st.prompt} ${st.hint || ''} ${st.formatHint || ''}`)) {
          const g = gcd(+f[1], +f[2]);
          if (!accepts(`${f[1] / g}/${f[2] / g}`, acc)) note('reduced fraction rejected', where, `${ans} vs ${f[1] / g}/${f[2] / g}`);
        }
      }
      let q;
      try { q = generateQuestion(+tier, skill); } catch (e) { note('generator throws', `T${tier} ${skill}`, e.message); continue; }
      if (!q || !shouldTypeAnswer(q, +tier)) continue;
      typed++;
      const ans = String(q.answer ?? '').trim();
      const ph = getSmartPlaceholder({ answer: q.answer, acceptableAnswers: q.acceptableAnswers });
      if (wordy(ans) && numberExample(ph)) note('words expected, number shown (typed question)', `T${tier} ${skill}`, `${ans.slice(0, 50)} / "${ph}"`);
    }
  }
}

console.log(`${lessonCount} lessons, ${steps} guided steps, ${typed} typed questions (RUNS=${RUNS})`);
if (!findings.size) { console.log('No findings.'); process.exit(0); }
for (const [k, n] of [...findings].sort()) console.log(`  ${n}x ${k}`);
process.exit(1);
