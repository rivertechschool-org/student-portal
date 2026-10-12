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

// Reported 2026-10-12: "y = 9" written "9 = y" was marked wrong, worst on
// quadratics where the answer is a list of roots. Every item of a list is
// oriented on its own, "±" is expanded, and a set of roots matches in any
// spelling and order. debug-tools/semantic-answer-sweep.js does the same
// rewrites over every generated question.
console.log('\n== flipped, item by item ==\n');
t('restated number, flipped', '9 = y', '9', true);
t('negative restatement, flipped', '-9 = y', '-9', true);
t('both roots flipped', '5 = x or 3 = x', 'x = 5, 3', true);
t('both roots flipped, comma', '5 = x, 3 = x', 'x = 5, 3', true);
t('function on the right', 'f(x) + 2 = y', 'y = f(x) + 2', true);
t('shift inside f', 'f(x + 2) = y', 'y = f(x + 2)', true);
t('subscripted letter', '2A/(b_1 + b_2) = h', 'h = 2A/(b_1 + b_2)', true);
t('no lone letter either side', '7eˣ dx = dy/y', 'dy/y = 7eˣ dx', true);
console.log('\n== a set of roots, any spelling ==\n');
t('other order', 'x = 3 or x = 5', 'x = 5, 3', true);
t('"and"', 'x = 5 and x = 3', 'x = 5, 3', true);
t('one x for both', 'x = 3, 5', 'x = 5, 3', true);
t('set braces', '{3, 5}', 'x = 5, 3', true);
t('bare values', '3, 5', 'x = 5, 3', true);
t('fractions', '1 = x or 4/3 = x', 'x = 4/3, 1', true);
t('± for a pair', 'x = ±2', 'x = 2 or x = -2', true);
t('± flipped', '±2 = x', 'x = 2 or x = -2', true);
t('+/- typed', 'x = +/-2', 'x = 2 or x = -2', true);
t('a ± b', 'x = 3 ± 2', 'x = 5, 1', true);
t('letter added to an "or" answer', 'x = 8, x = -8', '8 or -8', true);
console.log('\n== wrong roots stay wrong ==\n');
t('one root of two', 'x = 5', 'x = 5, 3', false);
t('one root of two, flipped', '5 = x', 'x = 5, 3', false);
t('a root sign-flipped', 'x = 5 or x = -3', 'x = 5, 3', false);
t('an extra root', 'x = 5, 3, 1', 'x = 5, 3', false);
t('± where the roots are not ±', 'x = ±3', 'x = 5, 3', false);
t('roots for the wrong letter', 'y = 5, 3', 'x = 5, 3', false);
t('flipped but wrong', '10 = y', 'y = 9', false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
