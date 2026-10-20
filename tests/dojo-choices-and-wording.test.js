// Place-value choices come from the number; "solve by factoring" asks for x.
//
// Reported 2026-10-20:
//   * "it gave a number and then no answer had a number from the set" - which
//     digit is in a place offered the page's filled-in neighbours of the answer
//     (8, 3, 12 for 6), not the number's own digits.
//   * a factoring question "expected the solved x value and not the factored
//     expression" - "Solve by factoring: x² + 6x − 7 = 0" read as "factor it".
//
// Run: node tests/dojo-choices-and-wording.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const __dirname2 = path.join(__dirname, '..', 'tests');
const html = fs.readFileSync(path.join(__dirname2, '..', 'games', 'math-dojo.html'), 'utf8');
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

const probe = '\n;globalThis.__dojo = { AnswerInterpreter, generators, typedAnswerIsCorrect, shouldTypeAnswer };';
const loadErrors = [];
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); }
  catch (e) { loadErrors.push(`script ${i}: ${e.message}`); }
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) { loadErrors.push('probe: ' + e.message); } }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script:\n  ' + loadErrors.join('\n  ')); process.exit(2); }
const AI = sandbox.__dojo.AnswerInterpreter;

const { generators, typedAnswerIsCorrect } = sandbox.__dojo;

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail !== undefined ? '\n        ' + detail : ''}`); }
};
sandbox.getUnlockedSubSkillTypes = (key, map, order) => order.map(k => map[k]);
const draw = (t, n, k = 3000) => Array.from({ length: k }, () => generators[t][n]()).filter(Boolean);

const dec = draw(3, 'Decimal Operations', 6000);
const whichDigit = dec.filter(q => /which digit is in the/.test(q.question));
ok('which digit: every choice is a digit of the number, and the answer is one',
  whichDigit.length > 100 && whichDigit.every(q => {
    const num = /In (\d\.\d+),/.exec(q.question)[1].replace('.', '');
    return q.options.length === 4 && q.options.every(o => num.includes(String(o))) && q.options.includes(q.answer);
  }), (whichDigit.find(q => !q.options || !q.options.includes(q.answer)) || {}).question);
const valueOf = dec.filter(q => /What is the value of the/.test(q.question));
ok('value of a digit: choices are that digit in each place, answer included',
  valueOf.length > 100 && valueOf.every(q => {
    const d = +/value of the (\d)/.exec(q.question)[1];
    return q.options.length === 4 && q.options.includes(q.answer) && q.options.every(o => [d, d / 10, d / 100, d / 1000].some(v => Math.abs(v - o) < 1e-9));
  }));

const pv = draw(1, 'Place Value', 3000).filter(q => q.subType === 'tens' || q.subType === 'ones');
ok('T1 place value: the two choices are the two (different) digits',
  pv.length > 500 && pv.every(q => {
    const n = /number (\d\d)/.exec(q.question)[1];
    return q.options.length === 2 && n[0] !== n[1] && q.options.map(String).sort().join() === [...n].sort().join() && q.options.includes(q.answer);
  }));

const quad = draw(5, 'Quadratics', 3000).filter(q => q.subType === 'solve_by_factoring');
ok('solve by factoring asks for the values of x', quad.length > 100 && quad.every(q => /What are the values of x\?$/.test(q.question)), (quad[0] || {}).question);
ok('...and its explanation never writes (x + 0)', quad.every(q => !/\(x [+-] 0\)/.test(q.explanation)), (quad.find(q => /\(x [+-] 0\)/.test(q.explanation)) || {}).explanation);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
