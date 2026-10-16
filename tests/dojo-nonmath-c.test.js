// Math Dojo: no non-math questions in the late _addSkill block (part c).
//
// The teacher's ruling: "keep running through and pruning non-math skills from
// dojo". A question is non-math when it can be answered with no mathematical
// reasoning at all: recall of a name, acronym or attribution, programming
// keywords, sorting by colour, or a real-world fact unrelated to quantity.
//
// Part c covers every skill registered with _addSkill from the first
// `function _addSkill` up to, not including, Separable Differential Equations
// (Slope ... Logarithmic and Exponential Models, ~120 skills). An audit on
// 2026-10-16 found nothing there to prune, so this suite is a guard:
//
//   1. every skill in that range is sampled and no question or option reads
//      as trivia recall;
//   2. the statistics-reasoning and justification subtypes that LOOK like
//      "reading" questions but are math (survey bias, sampling, correlation vs
//      cause, naming the property that justifies a step, choosing a chart) are
//      still there, so a later pruning pass does not remove them by mistake.
//
// Extraction mirrors tests/dojo-late-content.test.js.
//
// Run: node tests/dojo-nonmath-c.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// ---- extraction (same as tests/dojo-late-content.test.js) ------------------
function findMatchingBrace(text, openIdx) {
  const stack = [{ mode: 'code', depth: 1 }];
  let i = openIdx + 1;
  while (i < text.length && stack.length > 0) {
    const top = stack[stack.length - 1];
    const c = text[i], n = text[i + 1];
    if (top.mode === 'code') {
      if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '/' && n === '*') { i += 2; while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"') { stack.push({ mode: 'dq' }); i++; continue; }
      if (c === "'") { stack.push({ mode: 'sq' }); i++; continue; }
      if (c === '`') { stack.push({ mode: 'tpl' }); i++; continue; }
      if (c === '{') { top.depth++; i++; continue; }
      if (c === '}') { top.depth--; i++; if (top.depth === 0) { stack.pop(); if (!stack.length) return i - 1; } continue; }
      i++; continue;
    }
    if (top.mode === 'dq') { if (c === '\\') { i += 2; continue; } if (c === '"') stack.pop(); i++; continue; }
    if (top.mode === 'sq') { if (c === '\\') { i += 2; continue; } if (c === "'") stack.pop(); i++; continue; }
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { stack.pop(); i++; continue; }
    if (c === '$' && n === '{') { stack.push({ mode: 'code', depth: 1 }); i += 2; continue; }
    i++;
  }
  return -1;
}
function literal(decl) {
  const o = src.indexOf('{', src.indexOf(decl));
  return src.slice(o, findMatchingBrace(src, o) + 1);
}
function sliceByLine(startsWith) {
  const lines = src.split('\n');
  const s = lines.findIndex(l => l.startsWith(startsWith));
  let e = s + 1;
  while (e < lines.length && !/^\};/.test(lines[e])) e++;
  return lines.slice(s, e + 1).join('\n');
}
function fnSource(name) {
  const d = src.indexOf(`function ${name}(`);
  return src.slice(d, findMatchingBrace(src, src.indexOf('{', d)) + 1);
}
const grad = (() => {
  const re = /\/\/ ==== GRADUATION PLAN CONTENT: ([A-Z-]+) ====\n([\s\S]*?)\/\/ ==== END GRADUATION PLAN CONTENT: \1 ====/g;
  let m, out = '';
  while ((m = re.exec(src))) out += '\n' + m[2];
  return out;
})();
const V2 = src.slice(src.indexOf('// ===== V2 NEW-SKILL CONTENT'),
  src.lastIndexOf('// ===== end V2 NEW-SKILL CONTENT =====') + '// ===== end V2 NEW-SKILL CONTENT ====='.length) + grad;

let seed = 11;
function seeded() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const sandbox = {
  Math: Object.create(Math), JSON, String, Number, Array, Object, RegExp, Set, Map,
  isNaN, parseInt, parseFloat, console,
  rand: (a, b) => { if (b === undefined) { b = a; a = 0; } return Math.floor(seeded() * (b - a + 1)) + a; },
  shuffle: arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seeded() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  gcd: (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; },
  state: { completedSubSkills: {}, history: [], mode: 'arcade', currentTier: 5 },
  answerValue: s => parseFloat(s), backfillOptions: (a, o) => o,
  uniqOpts: c => [...new Set(c)],
  getUnlockedSubSkillTypes: (k, map, ord) => ord.flatMap(id => [].concat(map[id] || [])),
};
sandbox.Math.random = seeded;
sandbox.pick = a => a[sandbox.rand(0, a.length - 1)];
sandbox.cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
sandbox.simplifyFrac = (n, d) => { const g = sandbox.gcd(Math.abs(n), Math.abs(d)); return [n / g, d / g]; };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(
  `${src.split('\n').filter(l => /^const [A-Z_]+_RE = \//.test(l)).join('\n')}\n${sliceByLine('const AnswerInterpreter = {')}\n${fnSource('isFactoredForm')}\n${fnSource('typedAnswerIsCorrect')}\n` +
  `const TIERS = ${literal('const TIERS = {')};\nconst Q_MATRIX = ${literal('const Q_MATRIX = {')};\n` +
  `const generators = ${literal('const generators = {')};\nconst lessons = ${literal('const lessons = {')};\n` +
  `globalThis.generators = generators; globalThis.lessons = lessons;\n`,
  ctx, { filename: 'dojo-literals.js' });
vm.runInContext(V2, ctx, { filename: 'dojo-late.js' });

// ---- the skills in part c's range ------------------------------------------
const from = src.indexOf('function _addSkill');
const to = src.indexOf('_addSkill(9, "Separable Differential Equations"');
ok('range markers found', from > 0 && to > from);
const skills = [];
{
  const re = /_addSkill\((\d+),\s*"([^"]+)"/g;
  const part = src.slice(from, to);
  let m;
  while ((m = re.exec(part))) skills.push([Number(m[1]), m[2]]);
}
ok(`skills found in range (${skills.length})`, skills.length >= 100);

// Trivia-recall shapes. Probability questions legitimately use coloured
// marbles, so colour is only flagged when the question asks ABOUT a colour.
const NONMATH = [
  /\bstands? for\b.*\?$/i,                 // "What does APR stand for?"
  /\bacronym\b/i,
  /\bwho (proved|discovered|invented|wrote|first)\b/i,
  /\bnamed (after|for)\b/i,
  /\bwhat colou?r\b|\bsame colou?r\b|\bsort(ed)? by colou?r\b/i,
  /\bodd one out\b/i,
  /\b(planet|continent|capital city|keyword|HTML)\b/i,
];
const draws = {};
const bad = [];
for (const [tier, name] of skills) {
  const gf = ctx.generators[tier] && ctx.generators[tier][name];
  if (typeof gf !== 'function') { bad.push(`no generator T${tier} ${name}`); continue; }
  const qs = [];
  for (let i = 0; i < 250; i++) { const q = gf(); if (q) qs.push(q); }
  draws[name] = qs;
  for (const q of qs) {
    const texts = [q.question].concat(q.options || []).map(String);
    const hit = texts.find(t => NONMATH.some(re => re.test(t)));
    if (hit) { bad.push(`${name}: ${hit}`); break; }
  }
}
ok('no trivia-recall question or option in part c', bad.length === 0, bad.slice(0, 5).join('\n        '));

// ---- math that reads like "reading" stays --------------------------------
const subs = name => new Set((draws[name] || []).map(q => q.subType));
const keep = [
  ['Questioning Data', ['flaw', 'best-sample', 'rate-context', 'truncated-axis']],
  ['Mathematical Communication', ['justify_algebra', 'justify_geometry', 'counterexample', 'conclusion']],
  ['Spreadsheet Formulas', ['chart_choice', 'fill_formula']],
  ['Calculator Fluency', ['e-read', 'mis-keyed']],
  ['Personal Finance', ['net_pay', 'debt', 'better_buy']],
];
for (const [name, want] of keep) {
  const have = subs(name);
  const missing = want.filter(s => !have.has(s));
  ok(`${name} keeps its statistics / reasoning subtypes`, missing.length === 0, 'missing: ' + missing.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
