// Partitioning Shapes, guided walkthrough: halves and fourths in Grade 1.
//
// 2026-11-10, Jordan: "In the fractions guided learning it asked about a pizza
// cut 2 ways and then expected the answer to be a quarter, then asked what the
// pieces are called and it said the answer was fourths, but only accepted
// quarter." Step 2 told the student the parts were "fourths" and then asked
// for "another name", so only "quarters" passed; and a child spelling it
// "forths" or "4ths" was refused with no hint until shown a word to copy.
//
// Run: node tests/dojo-partitioning-guided.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

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

const lines = html.split('\n');
const lineOf = re => lines.findIndex(l => re.test(l));
function tableSource(re) {
  const at = lineOf(re);
  for (let i = at + 1; i < lines.length; i++) if (/^};\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  throw new Error('unterminated table');
}
const helpers = ['rand', 'pick', 'shuffle', 'cap', 'gcd', 'simplifyFrac']
  .map(n => lines[lineOf(new RegExp('^const ' + n + ' = '))]).join('\n');
const lessons = new Function('"use strict";\nconst state = {};\n' + helpers + '\n'
  + tableSource(/^const lessons = \{/) + '\nreturn lessons;')();

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`pass  ${label}`); } else { fail++; console.log(`  FAIL  ${label}`); } };
const steps = lessons[1]['Partitioning Shapes']().guided.interactiveSteps;
const accepts = (step, typed) => AI.checkAnswer(typed, step.acceptableAnswers || [step.answer]).correct;
const name = steps[1], each = steps[2];

ok('step 2 does not hand over the answer in its question', !/called fourths/i.test(name.prompt));
for (const t of ['fourths', 'Fourths', 'quarters', 'fourth', 'quarter', 'forths', '4ths'])
  ok(`step 2 (what are 4 equal parts called) accepts "${t}"`, accepts(name, t));
for (const t of ['fourth', 'a fourth', 'quarter', 'a quarter', 'one quarter', 'forth', 'a forth', '4th', 'fourths', '1/4'])
  ok(`step 3 (each slice is a) accepts "${t}"`, accepts(each, t));
for (const t of ['halves', 'half', 'thirds', 'third', 'eighths', '2'])
  ok(`"${t}" is still wrong in steps 2 and 3`, !accepts(name, t) && !accepts(each, t));
ok('the answer shown after 3 misses is one the step accepts', accepts(name, String(name.answer)) && accepts(each, String(each.answer)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
