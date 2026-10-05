// Typed-answer gate for games/math-dojo.html.
//
// From Algebra I up (tier 5+) students type the answer instead of picking from
// four buttons. Two things have to hold for that to be safe, and this harness
// checks both:
//
//   1. COVERAGE  — how many generated questions actually render as typed input.
//   2. ROUND-TRIP — for every question that renders as typed, a student who
//      types the generator's OWN expected answer, character for character, is
//      graded correct. If AnswerInterpreter can't parse an answer it produced
//      itself, that question is unanswerable and the skill is bricked.
//
// (2) is the one that matters. Multiple choice hid every parser gap, because
// the student clicked a string and we compared strings. Typed input exposes
// them all at once.
//
// This extracts the REAL functions from the page (shouldTypeAnswer,
// answerIsTypeable, typedAnswerIsCorrect, AnswerInterpreter) so it cannot drift
// from shipped code — same approach as the Riven harnesses.
//
// Usage: node debug-tools/typed-answer-coverage.js
// Exits non-zero if any tier 5+ question fails to round-trip.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'games/math-dojo.html'), 'utf8');
const SAMPLES = Number(process.env.SAMPLES || 400);

// ---- brace matcher that understands strings, template literals and comments ----
function findMatchingBrace(text, openIdx) {
  if (text[openIdx] !== '{') return -1;
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
    if (top.mode === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && n === '{') { stack.push({ mode: 'code', depth: 1 }); i += 2; continue; }
      i++; continue;
    }
  }
  return -1;
}
function literal(decl) {
  const d = src.indexOf(decl);
  if (d < 0) throw new Error(`${decl} not found`);
  const o = src.indexOf('{', d);
  return src.slice(o, findMatchingBrace(src, o) + 1);
}
// AnswerInterpreter contains regex quantifier braces ({1,3}) that defeat the
// brace matcher, so slice it by line: declaration through the next column-0 `};`.
function sliceByLine(startsWith) {
  const lines = src.split('\n');
  const s = lines.findIndex(l => l.startsWith(startsWith));
  if (s < 0) throw new Error(`${startsWith} not found`);
  let e = s + 1;
  while (e < lines.length && !/^\};/.test(lines[e])) e++;
  return lines.slice(s, e + 1).join('\n');
}
// Pull a top-level `function name(...) {...}` out of the page verbatim.
function fnSource(name) {
  const d = src.indexOf(`function ${name}(`);
  if (d < 0) throw new Error(`function ${name} not found`);
  const o = src.indexOf('{', d);
  return src.slice(d, findMatchingBrace(src, o) + 1);
}

// The graduation-plan content blocks (one <script> per group near the end of
// the page, each registering skills with _addSkill exactly like the V2
// block). Run them after it, or none of their skills are seen at all.
function graduationBlocks(text) {
  const re = /\/\/ ==== GRADUATION PLAN CONTENT: ([A-Z-]+) ====\n([\s\S]*?)\/\/ ==== END GRADUATION PLAN CONTENT: \1 ====/g;
  let m, out = '';
  while ((m = re.exec(text))) out += '\n' + m[2];
  return out;
}
const V2 = src.slice(src.indexOf('// ===== V2 NEW-SKILL CONTENT'),
  src.lastIndexOf('// ===== end V2 NEW-SKILL CONTENT =====') + '// ===== end V2 NEW-SKILL CONTENT ====='.length)
  + graduationBlocks(src);

// ---- page helper stubs (mirrors tools/audit-dojo-coverage.js) ----
let seed = 1;
function seeded() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const optKey = v => String(v).trim().toLowerCase();
function answerValue(str) {
  const t = String(str).trim();
  const f = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (f) return parseFloat(f[1]) / parseFloat(f[2]);
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return parseFloat(t);
  return NaN;
}
function backfillOptions(answer, opts, seen, want = 4) {
  const target = answerValue(answer);
  const tryPush = cand => {
    if (opts.length >= want) return;
    const k = optKey(cand);
    if (k === '' || seen.has(k)) return;
    const cv = answerValue(cand);
    if (!isNaN(target) && !isNaN(cv) && Math.abs(cv - target) < 1e-9) return;
    seen.add(k); opts.push(cand);
  };
  if (typeof answer === 'number' && isFinite(answer)) {
    const step = Math.max(1, Math.round(Math.abs(answer) * 0.1));
    for (let m = 1; opts.length < want && m <= 12; m++) {
      tryPush(parseFloat((answer + m * step).toFixed(4)));
      tryPush(parseFloat((answer - m * step).toFixed(4)));
    }
    return opts;
  }
  const s = String(answer);
  const nums = [...s.matchAll(/-?\d+(?:\.\d+)?/g)];
  if (!nums.length) return opts;
  for (const d of [1, -1, 2, -2, 3, -3, 5, -5, 10, -10]) {
    for (let i = 0; i < nums.length && opts.length < want; i++) {
      const m = nums[i];
      const v = parseFloat(m[0]);
      const nv = parseFloat((v + d).toFixed(4));
      if (nv === v) continue;
      tryPush(s.slice(0, m.index) + nv + s.slice(m.index + m[0].length));
    }
    if (opts.length >= want) break;
  }
  return opts;
}
function uniqOpts(cands) {
  const arr = Array.isArray(cands) ? cands.slice() : [cands];
  const seen = new Set(); const out = [];
  for (const c of arr) { const k = optKey(c); if (k === '' || seen.has(k)) continue; seen.add(k); out.push(c); }
  return out;
}

const sandbox = {
  Math: Object.create(Math), JSON, String, Number, Array, Object, RegExp,
  isNaN, parseInt, parseFloat, console,
  rand: (a, b) => { if (b === undefined) { b = a; a = 0; } return Math.floor(seeded() * (b - a + 1)) + a; },
  shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seeded() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  gcd: (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; },
  state: { completedSubSkills: {}, history: [], mode: 'arcade', currentTier: 5 },
};
sandbox.Math.random = seeded;
sandbox.pick = a => a[sandbox.rand(0, a.length - 1)];
sandbox.cap = s => String(s).length === 0 ? s : String(s).charAt(0).toUpperCase() + String(s).slice(1);
sandbox.answerValue = answerValue;
sandbox.backfillOptions = backfillOptions;
sandbox.uniqOpts = uniqOpts;
sandbox.simplifyFrac = (n, d) => { const g = sandbox.gcd(Math.abs(n), Math.abs(d)); return [n / g, d / g]; };
// Expose the whole generator surface so the harness sees every question type,
// not just the first gate. The live game unlocks these progressively.
sandbox.getUnlockedSubSkillTypes = (k, map, ord) => {
  const out = [];
  for (const id of ord) { const v = map[id]; if (Array.isArray(v)) out.push(...v); else if (v) out.push(v); }
  return out;
};
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
vm.runInContext(
  `${sliceByLine('const AnswerInterpreter = {')}\n` +
  `${literal('const NON_TYPEABLE_ANSWER_TYPES = new Set(')
      ? '' : ''}` +
  `const NON_TYPEABLE_ANSWER_TYPES = ${src.slice(
      src.indexOf('const NON_TYPEABLE_ANSWER_TYPES = new Set(') + 'const NON_TYPEABLE_ANSWER_TYPES = '.length,
      src.indexOf(']);', src.indexOf('const NON_TYPEABLE_ANSWER_TYPES = new Set(')) + 3)};\n` +
  `${fnSource('answerIsTypeable')}\n` +
  `${fnSource('shouldTypeAnswer')}\n` +
  `${fnSource('typedAnswerIsCorrect')}\n` +
  `const TIERS = ${literal('const TIERS = {')};\n` +
  `const Q_MATRIX = ${literal('const Q_MATRIX = {')};\n` +
  `const generators = ${literal('const generators = {')};\n` +
  `const lessons = ${literal('const lessons = {')};\n` +
  `globalThis.AnswerInterpreter = AnswerInterpreter;\n` +
  `globalThis.shouldTypeAnswer = shouldTypeAnswer;\n` +
  `globalThis.typedAnswerIsCorrect = typedAnswerIsCorrect;\n` +
  `globalThis.TIERS = TIERS; globalThis.Q_MATRIX = Q_MATRIX;\n` +
  `globalThis.generators = generators; globalThis.lessons = lessons;\n`,
  ctx, { filename: 'math-dojo-typed.js' });
vm.runInContext(V2, ctx, { filename: 'math-dojo-v2.js' });

// ---- run ----
const strip = h => String(h == null ? '' : h).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
let total = 0, typed = 0;
const failures = new Map();   // "T{tier} {skill}" -> [{q, answer}]
const stillMC = [];

for (const [ts, t] of Object.entries(ctx.TIERS)) {
  const tier = Number(ts);
  if (tier < 5) continue;
  for (const name of t.domains) {
    const gf = ctx.generators[tier] && ctx.generators[tier][name];
    if (typeof gf !== 'function') continue;
    let n = 0, ty = 0;
    const mcAnswers = new Set();
    for (let i = 0; i < SAMPLES; i++) {
      let q; try { q = gf(); } catch (e) { continue; }
      if (!q || q.answer === undefined || q.answer === null) continue;
      n++; total++;
      if (!ctx.shouldTypeAnswer(q, tier)) {
        if (mcAnswers.size < 4) mcAnswers.add(String(q.answer));
        continue;
      }
      ty++; typed++;
      // ROUND-TRIP: type the generator's own answer verbatim.
      // Pass the whole question so declared acceptableAnswers count too.
      if (!ctx.typedAnswerIsCorrect(String(q.answer), q)) {
        const key = `T${tier} ${name}`;
        if (!failures.has(key)) failures.set(key, []);
        const list = failures.get(key);
        if (list.length < 3) list.push({ q: strip(q.question).slice(0, 74), a: String(q.answer) });
      }
    }
    if (n && ty === 0) stillMC.push({ tier, name, answers: [...mcAnswers] });
  }
}

console.log(`tier 5+ questions sampled: ${total}`);
console.log(`renders as TYPED input:    ${typed} (${(100 * typed / total).toFixed(1)}%)`);
console.log(`remains multiple choice:   ${total - typed} (${(100 * (total - typed) / total).toFixed(1)}%)`);
console.log();
console.log(`skills still fully multiple choice: ${stillMC.length}`);
for (const s of stillMC) {
  console.log(`  T${s.tier} ${s.name}  — e.g. ${s.answers.slice(0, 3).map(a => JSON.stringify(a)).join(', ')}`);
}
console.log();

if (failures.size === 0) {
  console.log('=== ROUND-TRIP: 0 failures ===');
  console.log('  every typed question accepts its own expected answer.');
  process.exit(0);
}
let count = 0;
console.log(`=== ROUND-TRIP FAILURES in ${failures.size} skill(s) ===`);
console.log('  A student typing the exact expected answer is marked WRONG.');
console.log('  Fix AnswerInterpreter, or add acceptableAnswers, or keep the skill on MC.\n');
for (const [k, list] of failures) {
  console.log(`  ${k}`);
  for (const f of list) { console.log(`      Q: ${f.q}`); console.log(`      expected: ${JSON.stringify(f.a)}`); }
  count += list.length;
}
process.exit(1);
