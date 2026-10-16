// Radicals typed without the √ key, the radicals "add" generator, and format
// examples that gave the answer away.
//
// Reported 2026-10-16 (T5 Radicals, simplify): typing the root as sqrt() was not
// accepted, and the √ key was not there to get it right. The √ key does show on
// every typed surface when the answer has a root (checked in a browser); what
// failed was the reader: "3*sqrt(2)", "3 sqrt 2", "3√(2)" and "3 root 2" were
// all marked wrong for 3√2. Found on the way: the "add" questions could key
// "2√4 + 3√4 = 5√4" (it is 10), and the box's fixed format example ("e.g., 2√3")
// was sometimes the answer itself - in ~36 skills, not just this one.
//
// Run: node tests/dojo-radicals-typing.test.js
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

const q32 = { answer: '3√2', acceptableAnswers: [], tier: 5, type: 'procedural', question: 'Simplify: √18' };
for (const t of ['3√2', '3 √2', '3sqrt(2)', '3sqrt2', '3 sqrt(2)', '3*sqrt(2)', '3·√2', '3 sqrt 2', '3√(2)', '3 root 2', '3 square root of 2'])
  ok(`"${t}" is right for 3√2`, typedAnswerIsCorrect(t, q32));
for (const t of ['√18', 'sqrt(18)', 'root 18', '2 root 2', '3 cube root of 2', '3', '4.24'])
  ok(`"${t}" is not 3√2`, !typedAnswerIsCorrect(t, q32));
ok('cube roots read the same way', typedAnswerIsCorrect('2 cube root of 3', { answer: '2∛3' }) && typedAnswerIsCorrect('2∛(3)', { answer: '2∛3' }));

// The legacy T5 Radicals generator, every subtype: sub-skill gating reads the
// student's progress, so open all three for the draw.
sandbox.getUnlockedSubSkillTypes = (key, map, order) => order.map(k => map[k]);
const adds = [];
for (let i = 0; i < 3000; i++) { const q = generators[5].Radicals(); if (q.subType === 'add') adds.push(q); }
ok('radicals "add" never puts a perfect square under the root', adds.length > 300 && adds.every(q => !/√(4|9)\b/.test(q.question)),
   (adds.find(q => /√(4|9)\b/.test(q.question)) || {}).question);

// No typed question's format example is its own answer.
const gsp = sandbox.getSmartPlaceholder, squash = v => String(v).replace(/\s+/g, '').toLowerCase();
let leaks = [], n = 0;
for (const tier of Object.keys(generators)) for (const name of Object.keys(generators[tier])) for (let r = 0; r < 60; r++) {
  let q; try { q = generators[tier][name](); } catch (e) { continue; }
  if (!q || !sandbox.shouldTypeAnswer(q, +tier)) continue;
  n++;
  const ph = gsp({ answer: q.answer, acceptableAnswers: q.acceptableAnswers }) || '';
  const ex = ph.replace(/^e\.g\.,?\s*/i, '').split(/\s+or\s+|\s+—|\s+\(/)[0];
  if (ex && [q.answer, ...(q.acceptableAnswers || [])].some(a => squash(a) === squash(ex))) leaks.push(`${tier}::${name}: ${q.answer} | ${ph}`);
}
ok('no format example gives the answer away', n > 5000 && !leaks.length, leaks.slice(0, 3).join('\n        '));
ok('Simplify √12 is shown a different example', !/2√3/.test(gsp({ answer: '2√3' })), gsp({ answer: '2√3' }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
