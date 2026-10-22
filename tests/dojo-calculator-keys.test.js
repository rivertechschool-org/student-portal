// Calculator Fluency: the square key is written [x²], never bare x².
//
// Reported 2026-10-22: a question showed "4 + 3 x² =" with numbers for answers.
// It meant the keys 4, +, 3, then the x² (square) key, but read as the algebra
// 4 + 3x², which has no value without x. Runs the real page script.
//
// Run: node tests/dojo-calculator-keys.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

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
const probe = '\n;globalThis.__dojo = { generators, lessons, TIERS, Q_MATRIX, MATH_GRAPH_V2, getTreeSkillName, isSkillUnlocked, skillTreeData, triggerDependentUnlocks };';
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); } catch (e) {}
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) {} }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script'); process.exit(2); }
const D = sandbox.__dojo;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const gen = D.generators[4] && D.generators[4]['Calculator Fluency'];
ok('Calculator Fluency has a generator', typeof gen === 'function');
const qs = [];
for (let i = 0; i < 3000 && gen; i++) { try { qs.push(gen()); } catch (e) {} }
const text = q => [q.question, q.explanation, ...(q.options || [])].join(' | ');
// The square KEY must never read as the algebra "3x²".
const bare = qs.filter(q => /(^|[^\[])x²/.test(text(q)));
ok('no question writes the square key as bare x²', !bare.length, bare[0] && bare[0].question);
const squared = qs.filter(q => q.question.includes('[x²]'));
ok('the square-key questions come up', squared.length > 50, String(squared.length));
ok('  and each says [x²] is the square key', squared.every(q => /\[x²\] is the square key/.test(q.question)),
  (squared.find(q => !/\[x²\] is the square key/.test(q.question)) || {}).question);
const plus = squared.find(q => /^\D*\d+ \+ \d+ \[x²\] =/.test(q.question.split('press: ')[1] || ''));
ok('"a + b [x²] =" has the numeric answer a + b²', !!plus && (() => {
  const [, a, b] = q2m(plus.question); return Number(String(plus.answer).replace(/,/g, '')) === a + b * b;
})(), plus && plus.question + ' -> ' + plus.answer);
function q2m(s) { const m = s.match(/(\d+) \+ (\d+) \[x²\] =/); return [m[0], Number(m[1]), Number(m[2])]; }
// The lesson too: the skill's whole block in the page source.
const start = html.indexOf('M-320  Calculator Fluency');
const block = html.slice(start, html.indexOf('_addSkill(', html.indexOf('_addSkill(4, "Calculator Fluency"') + 10));
ok('the lesson and generator write the key as [x²] everywhere', block.includes('[x²]') && !/(^|[^[])x²/.test(block),
  (block.match(/.{0,40}(?:^|[^[])x².{0,20}/) || [''])[0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
