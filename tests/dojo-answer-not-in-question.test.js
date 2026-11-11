// Math Dojo questions that printed their own answer.
//
// 2026-11-10, Jordan: "There were several other lessons that spell out their
// expected answer like this length is 8 tiles, how many tiles does this make."
// A scan of every practice question and guided step for its answer in its own
// text found these; the rest of the scan's hits were either/or questions
// ("Is 18 even or odd?"), reading a value off given data, or numbers that
// happen to match (12 - 6 = 6). Each case here now draws the thing to count,
// or leaves the step for the student to do.
//
// Run: node tests/dojo-answer-not-in-question.test.js
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

const probe = '\n;globalThis.__dojo = { AnswerInterpreter, generators, lessons };';
const loadErrors = [];
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); }
  catch (e) { loadErrors.push(`script ${i}: ${e.message}`); }
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) { loadErrors.push('probe: ' + e.message); } }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script:\n  ' + loadErrors.join('\n  ')); process.exit(2); }
const AI = sandbox.__dojo.AnswerInterpreter;
const { generators, lessons } = sandbox.__dojo;

let pass = 0, fail = 0;
const ok = (label, cond, detail) => { if (cond) { pass++; console.log(`pass  ${label}`); } else { fail++; console.log(`  FAIL  ${label}${detail ? ': ' + detail : ''}`); } };
const draw = (tier, dom, sub, n = 400) => { const out = []; for (let i = 0; i < n; i++) { const q = generators[tier][dom](); if (q.subType === sub) out.push(q); } return out; };
const says = (text, n) => new RegExp(`(^|[^\d.])${n}(?![\d])`).test(String(text));

const measure = draw(1, 'Comparing Lengths', 'measure');
ok('length in tiles: drawn', measure.length > 0);
ok('length in tiles: the count is not in the question', measure.every(q => !says(q.question, q.answer)), measure.find(q => says(q.question, q.answer))?.question);
ok('length in tiles: units drawn, as many as the answer', measure.every(q => q.visual?.data?.mode === 'units' && q.visual.data.count === q.answer));

const shaded = draw(1, 'Partitioning Shapes', 'equal_parts');
ok('shaded parts: drawn', shaded.length > 0);
ok('shaded parts: the question does not say how many are shaded', shaded.every(q => !/shaded\. How/.test(q.question) && !/\d+ parts? (is|are) shaded/.test(q.question)));
ok('shaded parts: picture without its "1/2" label', shaded.every(q => q.visual?.type === 'fraction' && q.visual.data.hideLabel === true && q.visual.data.numerator === q.answer));

const pieces = draw(1, 'Composing Shapes', 'count_pieces', 600);
ok('composing: no count question names its count', pieces.every(q => !says(q.question, q.answer)), pieces.find(q => says(q.question, q.answer))?.question);

const ap = draw(6, 'Area and Perimeter', 'compare');
ok('area vs perimeter: the two numbers are not printed', ap.length > 0 && ap.every(q => !/\(\d+\)/.test(q.question)));

const mid = draw(6, 'Coordinate Geometry', 'midpoint', 2000);
ok('midpoint: never of a point and itself', mid.length > 0 && mid.every(q => { const m = q.question.match(/\((\d+), (\d+)\) and \((\d+), (\d+)\)/); return m && !(m[1] === m[3] && m[2] === m[4]); }));

// Guided steps: the step's own answer is not stated in its prompt.
const steps = (tier, name, sub) => { const L = lessons[tier][name](); const u = sub ? L.subSkills.find(s => s.id === sub) : L; return u.guided.interactiveSteps; };
const quad = steps(1, 'Shapes').find(s => s.answer === 'quadrilateral');
ok('Shapes: "what do we call a 4-sided shape" does not say "square" and accept it', !/square/i.test(quad.prompt) && !quad.acceptableAnswers.includes('square'));
const evenStep = steps(1, 'Even and Odd').at(-1);
ok('Even and Odd: last step asks, does not tell', !/\(an even digit\)/.test(evenStep.prompt) && /even or odd/.test(evenStep.prompt));
const cos0 = steps(8, 'Trig Functions').at(-1);
ok('cos(0°): not "the x-coordinate is 1"', !/x-coordinate is 1/.test(cos0.prompt));
const product = steps(9, 'Product Rule', 'basic').at(-1);
ok('product rule: last step does not print the answer', !product.prompt.includes('2x·e^x + x²·e^x'));
const unitCircle = steps(8, 'Unit Circle', 'special');
ok('sin(π/3): not "the y-coordinate is √3/2"', unitCircle.every(s => !/y-coordinate is √3\/2/.test(s.prompt)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
