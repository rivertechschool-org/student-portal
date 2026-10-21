// Positional Words: positions are read off a picture, and each has one answer.
//
// 2026-10-21 (Jordan: only maths). The skill used to be a word quiz - "What is
// the opposite of 'in front of'?", "The teddy bear stands ___ the box - it is
// at the back, out of sight" - which tests vocabulary, not where things are.
// It now draws a tower (top to bottom) or a row (left to right) of shapes and
// asks what is above, below, at the top or bottom, next to, or between.
//
// This runs the real generator and checks every answer against the picture
// the question draws: the drawing is parsed back out of the question text, so
// a change that draws one thing and answers another fails here.
//
// Run: node tests/dojo-positional-words.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the real generator, with only the helpers it uses -------------------
function generatorSource(name) {
  const marker = `"${name}": () => {`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(name + ' not found');
  let i = html.indexOf('{', start + marker.length - 1), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(html.indexOf('{', start + marker.length - 1), i);
}

const body = generatorSource('Positional Words');
const make = new Function('pick', 'shuffle', 'rand', '"use strict"; return (() => ' + body + ')();');
// Deterministic, so a failure is reproducible.
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const rand = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const draw = () => make(pick, shuffle, rand);

// The picture, read back from the question: shape names in drawing order.
function picture(q) {
  const lines = q.question.split('\n');
  if (/drawn from top to bottom/.test(lines[0])) {
    return { kind: 'tower', order: lines.slice(1, -1).map(l => l.split(' ')[1]) };
  }
  return { kind: 'row', order: lines[1].split(/\s{3}/).map(c => c.split(' ')[1]) };
}

// What the answer must be, worked out from the picture alone.
function expected(q) {
  const { order } = picture(q);
  const at = n => order.indexOf(n);
  let m;
  if ((m = /just (above|below) the (\w+)\?/.exec(q.question))) return order[at(m[2]) + (m[1] === 'above' ? -1 : 1)];
  if (/very top/.test(q.question)) return order[0];
  if (/very bottom/.test(q.question)) return order[order.length - 1];
  if ((m = /Is the (\w+) above or below the (\w+)\?/.exec(q.question))) return at(m[1]) < at(m[2]) ? 'above' : 'below';
  if ((m = /between the (\w+) and the (\w+)\?/.exec(q.question))) {
    const [i, j] = [at(m[1]), at(m[2])];
    return Math.abs(i - j) === 2 ? order[(i + j) / 2] : '(not exactly one between)';
  }
  if ((m = /The (\w+) is at one end/.exec(q.question))) {
    const i = at(m[1]);
    return i === 0 ? order[1] : i === order.length - 1 ? order[i - 1] : '(not at an end)';
  }
  return '(unrecognised question)';
}

const N = 6000;
const seen = {};
const bad = { wrong: [], missingAnswer: [], dupe: [], foreign: [], words: [] };
for (let i = 0; i < N; i++) {
  const q = draw();
  seen[q.subType] = (seen[q.subType] || 0) + 1;
  const want = expected(q);
  if (q.answer !== want) bad.wrong.push(`${q.question.replace(/\n/g, ' / ')} -> ${q.answer}, picture says ${want}`);
  if (!q.options.includes(q.answer)) bad.missingAnswer.push(q.question);
  if (new Set(q.options).size !== q.options.length) bad.dupe.push(q.question);
  // Every choice is a shape in the picture, or above/below.
  const allowed = new Set(picture(q).order.concat(['above', 'below']));
  if (!q.options.every(o => allowed.has(o))) bad.foreign.push(`${q.question} ${JSON.stringify(q.options)}`);
  if (/opposite|which word|____/i.test(q.question)) bad.words.push(q.question);
}

console.log('\n== every answer is what the picture shows ==\n');
check(`answer matches the drawing (${N} draws)`, bad.wrong.slice(0, 3), []);
check('the answer is always among the options', bad.missingAnswer.slice(0, 3), []);
check('no option appears twice', bad.dupe.slice(0, 3), []);
check('every choice is a shape in the picture (or above/below)', bad.foreign.slice(0, 3), []);

console.log('\n== it is not a word quiz ==\n');
check('no "opposite of" or fill-in-the-word questions', bad.words.slice(0, 3), []);
ok('all five question types were exercised',
   ['tower_next', 'tower_ends', 'above_or_below', 'row_between', 'row_next_to'].every(t => seen[t] > 300));

console.log('\n== the lesson teaches what practice asks ==\n');
const lessonAt = html.indexOf('"Positional Words": () => ({');
const lesson = html.slice(lessonAt, html.indexOf('"Classifying Objects": () => ({', lessonAt));
for (const t of ['A tower: top and bottom', 'Above and below', 'A row: next to', 'Between']) ok(`lesson step "${t}"`, lesson.includes(`title: "${t}"`));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
