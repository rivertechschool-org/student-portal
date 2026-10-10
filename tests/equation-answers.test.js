// Equation answers in the Math Dojo are compared by meaning.
//
// Reported 2026-10-10: a question expecting "x = (2+m)/2" rejected
// "(2+m)/2 = x" - the variable can be on either side. AnswerInterpreter's
// equationsMatch now evaluates both sides at sample values of every variable:
//   * expected solved for a letter: the student needs that letter alone on
//     either side, and the other sides must agree ("2x = 24" is not "x = 12")
//   * otherwise: (left - right) agrees up to sign (swap sides, move terms)
// It runs before the looser readers, one of which accepted
// "n = (t + y)/x" for "n = (t - y)/x".
//
// Run: node tests/equation-answers.test.js
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

const probe = '\n;globalThis.__dojo = { AnswerInterpreter };';
const loadErrors = [];
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); }
  catch (e) { loadErrors.push(`script ${i}: ${e.message}`); }
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) { loadErrors.push('probe: ' + e.message); } }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script:\n  ' + loadErrors.join('\n  ')); process.exit(2); }
const AI = sandbox.__dojo.AnswerInterpreter;
let pass = 0, fail = 0;
const t = (label, user, expected, want) => {
  const got = AI.checkAnswer(user, expected).correct;
  if (got === want) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}: "${user}" vs "${expected}" gave ${got}`); }
};
console.log('\n== either side ==\n');
t('the report: (2+m)/2 = x', '(2+m)/2 = x', 'x = (2+m)/2', true);
t('literal equation swapped', '(y - b)/m = x', 'x = (y - b)/m', true);
t('a line swapped', '-3x + 15 = y', 'y = -3x + 15', true);
t('a formula swapped', 'a² + b² - 2ab·cos(C) = c²', 'c² = a² + b² - 2ab·cos(C)', true);
t('vertex form swapped', '(x + 4)^2 + 2 = y', 'y = (x + 4)^2 + 2', true);
t('a substitution swapped', 'x² + 1 = u', 'u = x² + 1', true);
t('a solution swapped', '12 = x', 'x = 12', true);
console.log('\n== same meaning, other spelling ==\n');
t('terms reordered', 'x = (m+2)/2', 'x = (2+m)/2', true);
t('^2 for ², no dot', 'c^2 = a^2 + b^2 - 2abcos(C)', 'c² = a² + b² - 2ab·cos(C)', true);
t('expanded vertex form', 'y = x^2 + 8x + 18', 'y = (x + 4)^2 + 2', true);
t('capital letter', 'X = 12', 'x = 12', true);
console.log('\n== different answers stay wrong ==\n');
t('sign inside', 'x = (2-m)/2', 'x = (2+m)/2', false);
t('literal equation, wrong sign', 'n = (t + y)/x', 'n = (t - y)/x', false);
t('formula, wrong sign', 'c² = a² + b² + 2ab·cos(C)', 'c² = a² + b² - 2ab·cos(C)', false);
t('vertex form, wrong shift', 'y = (x - 4)^2 + 2', 'y = (x + 4)^2 + 2', false);
t('reflection', 'y = (x - 1)^2 - 2', 'y = -(x - 1)^2 - 2', false);
t('f(-x) is not -f(x)', 'y = -f(x)', 'y = f(-x)', false);
t('unsolved is not solved', '2x = 24', 'x = 12', false);
t('wrong solution', 'x = 13', 'x = 12', false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
