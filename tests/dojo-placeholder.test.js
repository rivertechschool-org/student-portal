// The example shown in a Math Dojo answer box must match the SHAPE of the
// answer, or the screen tells the student to type the wrong kind of thing.
//
// Every case here was a real one: "favorable / total" was shown "e.g., 3/4",
// so students typed the probability as numbers when the step asked for the
// formula; "perpendicular" was shown "e.g., 30° or 30 degrees"; "2x = 8" was
// shown the Pythagorean theorem. debug-tools/dojo-step-hints.js sweeps every
// lesson and generator for the same class; this pins the rules themselves.
//
// Run: node tests/dojo-placeholder.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const start = html.indexOf('function getSmartPlaceholder(step) {');
if (start < 0) throw new Error('getSmartPlaceholder not found');
// The function is plain code with no template literals spanning braces, but
// count braces outside strings and regexes anyway: the body is full of both.
let i = html.indexOf('{', start), depth = 0, mode = null;
for (; i < html.length; i++) {
  const c = html[i], prev = html[i - 1];
  if (mode) {
    if (c === '\\') { i++; continue; }
    if ((mode === 're' && c === '/') || c === mode) mode = null;
    continue;
  }
  if (c === "'" || c === '"' || c === '`') { mode = c; continue; }
  if (c === '/' && html[i + 1] === '/') { i = html.indexOf('\n', i); continue; }
  if (c === '/' && /[(=,:!&|?;{}\s]/.test(prev) && html[i + 1] !== '/') { mode = 're'; continue; }
  if (c === '{') depth++;
  else if (c === '}' && --depth === 0) break;
}
const getSmartPlaceholder = new Function(html.slice(start, i + 1) + '\nreturn getSmartPlaceholder;')();

let pass = 0, fail = 0;
const ph = (answer, acceptableAnswers) => getSmartPlaceholder({ answer, acceptableAnswers });
const ok = (label, cond, got) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)}`); }
};
const noNumber = (label, answer, acc) => { const p = ph(answer, acc); ok(label, !/e\.g\.,?\s*[-(]?\d/.test(p), p); };

console.log('\n== words and formulas are never shown a number ==\n');
noNumber('a formula in words ("favorable / total")', 'favorable / total');
noNumber('a formula in letters (Law of Sines)', 'a/sin(A) = b/sin(B)');
noNumber('a formula with a coefficient (Law of Cosines)', 'c² = a² + b² - 2ab·cos(C)');
noNumber('a formula with subscripts', 'h = 2A/(b_1 + b_2)');
noNumber('a word with a numeric alternative ("perpendicular" / "90°")', 'perpendicular', ['perpendicular', '90°']);
noNumber('a word with a percent alternative', 'half', ['half', '50%']);
ok('  and a word is asked for as words', /words/.test(ph('perpendicular', ['perpendicular', '90°'])), ph('perpendicular'));
ok('a formula in words asks for words', /in words/.test(ph('favorable / total')), ph('favorable / total'));

console.log('\n== numbers still get number examples ==\n');
ok('a fraction', ph('3/8') === 'e.g., 3/4', ph('3/8'));
ok('a negative number', /minus/.test(ph('-5')), ph('-5'));
ok('an angle', /°/.test(ph('30°')), ph('30°'));
ok('a variable assignment', /x = -2/.test(ph('x = -2')), ph('x = -2'));
ok('two solutions', /list both/.test(ph('x = 1/2, 3')), ph('x = 1/2, 3'));
ok('a log expression is typed as written', /as written/.test(ph('log(31)/log(5)')), ph('log(31)/log(5)'));
ok('an equation is not shown the Pythagorean theorem', !/a² \+ b²/.test(ph('2x = 8')), ph('2x = 8'));

console.log('\n== letters that are not words ==\n');
ok('a segment name ("XY") is not asked for "in words"', !/words/.test(ph('XY')), ph('XY'));
ok('a variable ("x") is not asked for "in words"', !/words/.test(ph('x')), ph('x'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
