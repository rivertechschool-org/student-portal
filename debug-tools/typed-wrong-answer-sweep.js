// Math Dojo: does any typed question accept a WRONG answer?
//
// For every skill, generate questions; where the student types the answer,
// check (1) the answer and every listed alternative is accepted, and (2) none
// of the question's own wrong choices is accepted when typed. (2) is the hole
// this exists for: the answer checker's loose readers have marked wrong typed
// answers right - "x = 8" for "x = 4", "$678,976" for "$678,400",
// "(x+3)/(x+2)" for "(x+3)/(x-2)". Found 36 such groups when written
// (2026-10-10); 13 skills (18 question types) remained after that day's fixes (integrals, some factored
// forms, two-value comma lists, literal equations in letters other than x,
// a few word answers) - work for another day, listed by this tool.
//
// Usage: node debug-tools/typed-wrong-answer-sweep.js        (RUNS=200 default)
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

const probe = '\n;globalThis.__dojo = { generators, generateQuestion, shouldTypeAnswer, typedAnswerIsCorrect };';
const loadErrors = [];
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); }
  catch (e) { loadErrors.push(`script ${i}: ${e.message}`); }
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) { loadErrors.push('probe: ' + e.message); } }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script:\n  ' + loadErrors.join('\n  ')); process.exit(2); }
const d = sandbox.__dojo; const issues = new Map(); let qs = 0, typed = 0;
const note = (k, ex) => { if (!issues.has(k)) issues.set(k, { n: 0, ex }); issues.get(k).n++; };
const N_RUNS = +(process.env.RUNS || 200);
// Every skill in the Dojo, not just the plan: the answer checker changed for all of them.
for (const t of Object.keys(d.generators)) for (const s of Object.keys(d.generators[t])) {
  for (let i = 0; i < N_RUNS; i++) {
    let q; try { q = d.generateQuestion(+t, s); } catch (e) { note(`THROWS T${t} ${s}`, e.message); break; }
    if (!q) continue; qs++;
    if (!d.shouldTypeAnswer(q, +t)) continue; typed++;
    for (const a of [q.answer].concat(q.acceptableAnswers || [])) if (!d.typedAnswerIsCorrect(String(a), q)) note(`REJECTS OWN T${t} ${s} (${q.subType})`, `${a} | ${String(q.question).slice(0, 60)}`);
    for (const o of (q.options || [])) if (String(o).trim().toLowerCase() !== String(q.answer).trim().toLowerCase() && d.typedAnswerIsCorrect(String(o), q)) note(`ACCEPTS WRONG T${t} ${s} (${q.subType})`, `${o} for ${q.answer}`);
  }
}
console.log(`${qs} questions, ${typed} typed`); if (!issues.size) console.log('No findings.'); else for (const [k, v] of [...issues]) console.log(`  ${v.n}x ${k} :: ${v.ex}`);
console.log(issues.size + ' finding groups');
