// Typed answers the Math Dojo used to mark right although they were wrong,
// and the right answers written another way that must still pass.
//
// Found 2026-10-10 by debug-tools/typed-wrong-answer-sweep.js and by listing
// the multiple-choice options the checker counted as equal to the answer.
// Most came from one loose reader that kept a single x coefficient and one
// constant ("e^x + C" = "ln|x| + C", "UX" = "GX", "x = 12, 0" = "x = 6, 6");
// the rest from readers that matched a word inside a sentence ("brightness"
// holds "right", so any two sentences with it were the same right angle).
//
// Run: node tests/answer-checker-false-accepts.test.js
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
const check = (typed, expected, want, label) => {
  let got; try { got = AI.checkAnswer(typed, expected).correct; } catch (e) { got = 'threw ' + e.message; }
  if (got === want) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}: ${JSON.stringify(typed)} for ${JSON.stringify(expected)} gave ${got}`); }
};
const wrong = (t, e, l) => check(t, e, false, l);
const right = (t, e, l) => check(t, e, true, l);

console.log('\n== wrong answers are wrong ==\n');
wrong('x = 12, 0', 'x = 6, 6', 'solution list with other values');
wrong('x = -6, 3', 'x = -6, -3', 'solution list with one sign wrong');
wrong('x = 2, 5', 'x = 1/2, 5', 'solution list: 2 is not 1/2');
wrong('x(t - z)', '(t - z)/x', 'literal equation: times is not divided by');
wrong('(t + z)/x', '(t - z)/x', 'literal equation: sign');
wrong('UX', 'GX', 'congruence: another side');
wrong('exactly 2', 'exactly 1', 'a word answer with a number');
wrong('x^(4/5)', 'x^(5/4)', 'rational exponent upside down');
wrong('∛(x^4)', '∛(x^3)', 'radical with another power');
wrong('e^x + C', 'ln|x| + C', 'integral of 1/x');
wrong('x^6 + C', 'x^6/6 + C', 'power rule: missing the divide');
wrong('5x^4 + C', '5x^5 + C', 'power rule: wrong power');
wrong('⟨8y, 8x⟩', '⟨8x, 8y⟩', 'gradient components swapped');
wrong('1/√3', '1', 'a number followed by more maths is not a number with a unit');
wrong('Randomly assign many phones to the low-brightness setting or the default setting, then compare', 'Give all of the phones the low-brightness setting, then compare', '"brightness" is not a right angle');
wrong('scalene triangle', 'isosceles triangle', 'shape: the kind of triangle counts');
wrong('The diagonals are perpendicular', 'The sides are perpendicular', 'shape: a sentence is not a shape word');
wrong('candle, book, surfboard', 'book, candle, surfboard', 'an order is not a set');
wrong('11 ft 2 in', '2 ft 11 in', 'feet and inches are not letters');
wrong('1 cm / 2.54 in', '1 in / 2.54 cm', 'a conversion factor upside down');
wrong('!a && b', '!a && !b', 'logical NOT survives');
wrong('minimum of 0 at x = -3', 'minimum of 0 at x = 3', 'words in an equation');
wrong('rotation 90° counterclockwise', 'rotation 90° clockwise', 'rotation direction');
wrong('8.1 × 10^5', '8.10 × 10^5', 'significant figures: the trailing zero');
wrong('9.75200 × 10^5', '9.752 × 10^5', 'significant figures: extra zeros');
wrong('57 × 10^6', '5.7 × 10^7', 'scientific notation needs 1 to 10 in front');

console.log('\n== right answers written another way still pass ==\n');
right('x = -3, -6', 'x = -6, -3', 'solutions in another order');
right('x = 6', 'x = 6, 6', 'a double root once');
right('x = 5 or x = 1/2', 'x = 1/2, 5', 'solutions with "or"');
right('x = 0.5, 5', 'x = 1/2, 5', 'a decimal for a fraction');
right('(-z+t)/x', '(t - z)/x', 'terms reordered');
right('(1/6)x^6 + C', 'x^6/6 + C', 'integral written another way');
right('x^5 + C', '1x^5 + C', 'a coefficient of 1 left out');
right('ln|x|+C', 'ln|x| + C', 'spacing');
right('2(x+1)', '2x+2', 'factored and expanded');
right('√3/3', '1/√3', 'rationalised radical');
right('Isosceles triangle', 'isosceles triangle', 'capital letter');
right('perpendicular lines', 'perpendicular', 'shape word with filler');
right('a right angle', 'right', 'angle type with filler');
right('134 in', '11 ft 2 in', 'feet and inches as inches');
right('!a&&!b', '!a && !b', 'logic spacing');
right('90 degrees', '90°', 'degrees in words');
right('8.10 x 10^5', '8.10 × 10^5', 'x for the times sign');
right('5.7 x 10^7', '5.7 × 10^7', 'scientific notation');
right('c^2 = a^2 + b^2 - 2abcos(C)', 'c² = a² + b² - 2ab·cos(C)', 'formula with cos run into letters');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
