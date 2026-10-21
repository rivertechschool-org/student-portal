// A question that asks you to pick from what it shows is answered from that
// set and nothing else.
//
// Reported 2026-10-20: "In the number 48, what digit is in the tens place?"
// offered 6 and 5, which are not in 48; "Which is larger: 10 or 12?" offered
// 13 and 14; "Team 0" appeared beside a question about Team 1 and Team 2.
// Every one of those generators supplied the right set. generateQuestion then
// topped any board under four choices up with invented values, and re-spaced
// the numbers around the answer, and each invented choice could be crossed
// off without doing the maths.
//
// This runs the real page script and the real generateQuestion.
// debug-tools/dojo-distractor-sweep.js checks the rule across every generator.
//
// Run: node tests/dojo-closed-choice-set.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

// Same accept-anything page as debug-tools/dojo-distractor-sweep.js.
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
const probe = '\n;globalThis.__dojo = { generators, generateQuestion };';
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); } catch (e) {}
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) {} }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script'); process.exit(2); }
const { generators, generateQuestion } = sandbox.__dojo;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};
// Run one hand-made question through generateQuestion, as if a generator
// had returned it.
function board(raw, tier = 1, domain = 'Comparison') {
  const real = generators[tier][domain];
  generators[tier][domain] = () => ({ ...raw, options: raw.options && raw.options.slice() });
  try { return generateQuestion(tier, domain); } finally { generators[tier][domain] = real; }
}
const same = (a, b) => JSON.stringify(a.map(String).sort()) === JSON.stringify(b.map(String).sort());

console.log('\n== a closed set is left as the generator made it ==\n');
{
  const q = board({ question: 'Which is larger: 10 or 12?', answer: 12, options: [10, 12] });
  ok('"10 or 12" offers 10 and 12 and nothing else', same(q.options, [10, 12]), JSON.stringify(q.options));
}
{
  const q = board({ question: 'In the number 48, what digit is in the tens place?', answer: 4, options: [4, 8] });
  ok('the tens digit of 48 is chosen from 4 and 8', same(q.options, [4, 8]), JSON.stringify(q.options));
}
{
  const q = board({ question: 'In 8.354, which digit is in the thousandths place?', answer: 4, options: [5, 3, 4, 8] });
  ok('the digits of 8.354 are not re-spaced around the answer', same(q.options, [5, 3, 4, 8]), JSON.stringify(q.options));
}
{
  const q = board({ question: 'Team 1: 5, 9. Team 2: 6, 7. Which has more spread?', answer: 'Team 1', options: ['Team 1', 'Team 2', 'Same'] });
  ok('"Same" may sit beside the two teams, and no "Team 0" appears', same(q.options, ['Team 1', 'Team 2', 'Same']), JSON.stringify(q.options));
}
{
  const q = board({ question: 'Which is greater: |-5| or |3|?', answer: '|-5|', options: ['|-5|', '|3|', 'equal'] });
  ok('|-5| or |3| offers just those and "equal"', same(q.options, ['|-5|', '|3|', 'equal']), JSON.stringify(q.options));
}

console.log('\n== a computed answer is still topped up ==\n');
{
  // 5 + 7: two choices supplied, neither 12 nor 9 is in the question, so it
  // is not a closed set and still gets four.
  const q = board({ question: 'What is 5 + 7?', answer: 12, options: [12, 9] });
  ok('"What is 5 + 7?" with two supplied choices still gets four', q.options.length === 4, JSON.stringify(q.options));
  ok('  and the answer is among them', q.options.map(String).includes('12'));
}
{
  // The answer and the one choice supplied both happen to be in the question,
  // but nothing is being chosen: still four.
  const q = board({ question: 'What is 1/2 of 4?', answer: 2, options: [2, 4] });
  ok('"What is 1/2 of 4?" with [2, 4] supplied still gets four', q.options.length === 4, JSON.stringify(q.options));
}
{
  const q = board({ question: 'f(x) = {2x - 3 if x < -1, -x + 2 if x ≥ -1}. Find f(1).', answer: 1, options: [-1, 2, 1] });
  ok('"Find f(1)" with values that appear in f still gets four', q.options.length === 4, JSON.stringify(q.options));
}

console.log('\n== the real generators ==\n');
for (const [tier, domain, re] of [[1, 'Comparison', /Which is larger: (\d+) or (\d+)/],
                                  [1, 'Place Value', /In the number (\d+), what digit/]]) {
  let bad = null;
  for (let i = 0; i < 300 && !bad; i++) {
    const q = generateQuestion(tier, domain);
    const m = String(q.question).match(re);
    if (!m) continue;
    const allowed = new Set(re.source.includes('digit') ? m[1].split('') : [m[1], m[2]]);
    if (!q.options.every(o => allowed.has(String(o)))) bad = `${q.question} -> ${JSON.stringify(q.options)}`;
  }
  ok(`T${tier} ${domain}: every choice is from the question`, !bad, bad || '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
