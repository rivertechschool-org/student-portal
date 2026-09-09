// End-to-end coverage audit for games/math-dojo.html.
//
// Why this exists alongside audit-generators.js: that script evaluates ONLY the
// `const generators = {...}` literal. The game also registers skills at load
// time through `_addSkill(tier, name, primaryTitle, difficulty, lesson, gen)`
// inside the "V2 NEW-SKILL CONTENT" block. Auditing just the literal reports a
// healthy 199/199 while the V2 block is broken — which is precisely how ~3,985
// lines of it sat outside the document, unexecuted, without any test noticing.
//
// This harness evaluates the four literals AND the V2 block in the same order
// the browser does, then reports what is actually playable.
//
// Checks, per skill that ends up registered:
//   1. has both a generator and a lesson
//   2. generator runs without throwing, over many seeds
//   3. returns question / answer / explanation, answer not NaN or empty
//   4. options (when present) contain the answer and have no duplicates
//   5. no literal ${...} left in any string field
//   6. output actually varies
// Plus, across the whole game:
//   7. every TIERS domain resolves to a generator and a lesson
//   8. no skill is registered under two different names for one graph node
//   9. no skill lists a hard prerequisite taught at a higher tier
//
// Usage: node tools/audit-dojo-coverage.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'games/math-dojo.html'), 'utf8');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/math_curriculum_v2.json'), 'utf8'));

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
    if (top.mode === 'dq') { if (c === '\\') { i += 2; continue; } if (c === '"') { stack.pop(); } i++; continue; }
    if (top.mode === 'sq') { if (c === '\\') { i += 2; continue; } if (c === "'") { stack.pop(); } i++; continue; }
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

// ---- the V2 block, and whether it is actually inside the document ----
const V2_START = src.indexOf('// ===== V2 NEW-SKILL CONTENT');
const V2_END = src.lastIndexOf('// ===== end V2 NEW-SKILL CONTENT =====');
const problems = [];
let v2 = '';
if (V2_START < 0) {
  problems.push('FATAL: V2 NEW-SKILL CONTENT block not found at all');
} else {
  v2 = src.slice(V2_START, V2_END + '// ===== end V2 NEW-SKILL CONTENT ====='.length);
  // It must sit before </body>, inside a <script>. This is the regression that bit.
  const closeBody = src.lastIndexOf('</body>');
  if (V2_START > closeBody) {
    problems.push('FATAL: V2 block is after </body> — it will never execute');
  }
  const before = src.slice(0, V2_START);
  const opens = (before.match(/<script[\s>]/g) || []).length;
  const closes = (before.match(/<\/script>/g) || []).length;
  if (opens <= closes) {
    problems.push('FATAL: V2 block is not inside a <script> tag — it will never execute');
  }
}

// ---- stubs mirroring the page's helpers ----
let seed = 1;
function seeded() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const sandbox = {
  Math: Object.create(Math),
  JSON, String, Number, Array, Object, isNaN, parseInt, parseFloat, console,
  rand: (a, b) => { if (b === undefined) { b = a; a = 0; } return Math.floor(seeded() * (b - a + 1)) + a; },
  shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seeded() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  gcd: (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; },
  state: { completedSubSkills: {}, history: [], mode: 'arcade', currentTier: 5 },
};
sandbox.Math.random = seeded;
sandbox.pick = (a) => a[sandbox.rand(0, a.length - 1)];
// Page-level helpers the literal generators close over (games/math-dojo.html).
// Leaving one out shows up as a bogus "generator threw" for every skill using it.
sandbox.cap = (s) => String(s).length === 0 ? s : String(s).charAt(0).toUpperCase() + String(s).slice(1);
sandbox.answerValue = (...a) => answerValue(...a);
sandbox.backfillOptions = (...a) => backfillOptions(...a);
sandbox.uniqOpts = (...a) => uniqOpts(...a);
sandbox.simplifyFrac = (n, d) => { const g = sandbox.gcd(Math.abs(n), Math.abs(d)); return [n / g, d / g]; };
sandbox.getUnlockedSubSkillTypes = (lessonKey, map, ordered) => {
  const first = map[ordered[0]];
  return Array.isArray(first) ? first.slice() : (first ? [first] : []);
};
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
try {
  vm.runInContext(
    `const TIERS = ${literal('const TIERS = {')};\n` +
    `const Q_MATRIX = ${literal('const Q_MATRIX = {')};\n` +
    `const generators = ${literal('const generators = {')};\n` +
    `const lessons = ${literal('const lessons = {')};\n` +
    `globalThis.TIERS = TIERS; globalThis.Q_MATRIX = Q_MATRIX;\n` +
    `globalThis.generators = generators; globalThis.lessons = lessons;\n`,
    ctx, { filename: 'math-dojo-literals.js' });
} catch (e) {
  console.error('FAILED to evaluate literals:', e.message);
  process.exit(1);
}

const beforeCount = Object.values(ctx.TIERS).reduce((n, t) => n + t.domains.length, 0);
if (v2 && !problems.some(p => p.startsWith('FATAL'))) {
  try {
    vm.runInContext(v2, ctx, { filename: 'math-dojo-v2.js' });
  } catch (e) {
    problems.push(`FATAL: V2 block threw at load: ${e.message}`);
  }
}
const afterCount = Object.values(ctx.TIERS).reduce((n, t) => n + t.domains.length, 0);

console.log(`TIERS placements: ${beforeCount} from the literal, `
  + `+${afterCount - beforeCount} from the V2 block = ${afterCount}`);

// ---- coverage ----
const placements = [];
for (const [tier, t] of Object.entries(ctx.TIERS)) {
  for (const name of t.domains) placements.push({ tier: Number(tier), name });
}
const distinct = new Set(placements.map(p => p.name));
console.log(`distinct playable skills: ${distinct.size}`);

for (const { tier, name } of placements) {
  const hasGen = ctx.generators[tier] && typeof ctx.generators[tier][name] === 'function';
  const hasLes = ctx.lessons[tier] && ctx.lessons[tier][name];
  if (!hasGen) problems.push(`T${tier} ${name}: listed in TIERS but has NO generator`);
  if (!hasLes) problems.push(`T${tier} ${name}: listed in TIERS but has NO lesson`);
}

// ---- graph reconciliation ----
const byName = new Map();
const byId = new Map();
for (const n of graph.nodes) {
  byId.set(n.id, n);
  byName.set(n.dojo_skill || n.title, n);
}
const titleOnly = new Map();
for (const n of graph.nodes) {
  if (n.dojo_skill && n.title !== n.dojo_skill) titleOnly.set(n.title, n);
}
for (const name of distinct) {
  if (!byName.has(name)) {
    const t = titleOnly.get(name);
    problems.push(t
      ? `"${name}" is registered under the graph TITLE; canonical dojo_skill is "${t.dojo_skill}" (${t.id}) — duplicate concept`
      : `"${name}" is playable but matches no graph node`);
  }
}
const notPlayable = [...byName.keys()].filter(n => !distinct.has(n));
if (notPlayable.length) {
  problems.push(`${notPlayable.length} graph skills have no playable content: `
    + notPlayable.sort().join(', '));
}

// tier of each skill in the game = lowest tier it is introduced at
const gameTier = new Map();
for (const { tier, name } of placements) {
  if (!gameTier.has(name) || tier < gameTier.get(name)) gameTier.set(name, tier);
}
for (const n of graph.nodes) {
  const nm = n.dojo_skill || n.title;
  const gt = gameTier.get(nm);
  if (gt === undefined) continue;
  if (gt !== n.dojo_tier) {
    problems.push(`tier mismatch: ${nm} introduced at T${gt} in the game, dojo_tier=${n.dojo_tier} in the graph`);
  }
  for (const p of n.hard_prereqs || []) {
    const pn = byId.get(p);
    if (!pn) continue;
    const pt = gameTier.get(pn.dojo_skill || pn.title);
    if (pt !== undefined && pt > gt) {
      problems.push(`unsatisfiable prerequisite: ${nm} (T${gt}) requires ${pn.dojo_skill || pn.title} (T${pt})`);
    }
  }
}

// ---- mirror of generateQuestion's option pipeline in games/math-dojo.html ----
// Keep these two in step: if the game's hygiene rules change, this must too, or
// the audit starts grading something the student never sees.
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
  if (!arr.length) return arr;
  const answer = arr[0];
  const target = answerValue(answer);
  const seen = new Set([optKey(answer)]);
  const out = [answer];
  for (const c of arr.slice(1)) {
    if (out.length >= 4) break;
    const k = optKey(c);
    if (k === '' || seen.has(k)) continue;
    const cv = answerValue(c);
    if (!isNaN(target) && !isNaN(cv) && Math.abs(cv - target) < 1e-9) continue;
    seen.add(k); out.push(c);
  }
  if (out.length < 4) backfillOptions(answer, out, seen, 4);
  return out;
}
function optionPipeline(q) {
  const seen = new Set(), opts = [];
  for (const o of (q.options || [])) {
    const k = optKey(o);
    if (k !== '' && !seen.has(k)) { seen.add(k); opts.push(o); }
  }
  if (!seen.has(optKey(q.answer))) { seen.add(optKey(q.answer)); opts.push(q.answer); }
  if (opts.length < 4) backfillOptions(q.answer, opts, seen, 4);
  return { options: opts, answerIndex: opts.findIndex(o => optKey(o) === optKey(q.answer)) };
}

// ---- run every generator ----
const hygiene = new Set();
const samples = new Map();
const sample = (key, q) => {
  if (!samples.has(key)) samples.set(key, JSON.stringify({
    question: q.question, answer: q.answer, options: q.options }));
};
// Sampling has to be wide: several collisions only fire for one parameter
// combination (a sphere's zero vertices, x === y in a coordinate pair), and a
// narrow seed sweep walks straight past them.
const ITER = 150;
let ran = 0;
for (const { tier, name } of placements) {
  const fn = ctx.generators[tier] && ctx.generators[tier][name];
  if (typeof fn !== 'function') continue;
  ran++;
  const seen = new Set();
  for (let i = 0; i < ITER; i++) {
    seed = (tier * 7919 + i * 104729 + name.length * 6151) | 0;
    let q;
    try {
      q = fn();
    } catch (e) {
      problems.push(`T${tier} ${name}: generator threw — ${e.message}`);
      break;
    }
    if (!q || typeof q !== 'object') { problems.push(`T${tier} ${name}: did not return an object`); break; }
    for (const f of ['question', 'answer', 'explanation']) {
      if (q[f] === undefined || q[f] === null || q[f] === '') {
        problems.push(`T${tier} ${name}: missing/empty ${f}`);
      }
    }
    if (typeof q.answer === 'number' && isNaN(q.answer)) problems.push(`T${tier} ${name}: answer is NaN`);
    const walk = (o, p) => {
      if (typeof o === 'string') { if (/\$\{[^}]+\}/.test(o)) problems.push(`T${tier} ${name}: unresolved template in ${p} — ${o.slice(0, 60)}`); return; }
      if (Array.isArray(o)) return o.forEach((v, k) => walk(v, `${p}[${k}]`));
      if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], `${p}.${k}`);
    };
    walk(q, 'gen');
    if (Array.isArray(q.options)) {
      // What the student sees is the generator's output AFTER generateQuestion's
      // option pipeline, so that is what must be correct. Raw defects the
      // pipeline repairs are reported separately as hygiene warnings.
      const raw = q.options.map(optKey);
      const final = optionPipeline(q);
      const fkeys = final.options.map(optKey);
      if (new Set(fkeys).size !== fkeys.length) {
        problems.push(`T${tier} ${name}: options contain duplicates`);
        sample(`T${tier} ${name} [dup options]`, q);
      }
      if (final.answerIndex < 0) {
        problems.push(`T${tier} ${name}: answer is not among the options`);
        sample(`T${tier} ${name} [omits answer]`, q);
      }
      if (final.options.length < 2) {
        problems.push(`T${tier} ${name}: fewer than two distinct options`);
        sample(`T${tier} ${name} [too few options]`, q);
      }
      if (new Set(raw).size !== raw.length) hygiene.add(`T${tier} ${name}: emits duplicate options (repaired at runtime)`);
      if (!raw.includes(optKey(q.answer))) hygiene.add(`T${tier} ${name}: omits its own answer (repaired at runtime)`);
    }
    // Key on the whole item, not the prompt. Diagram-based skills ("What time
    // does this clock show?") reuse one prompt and vary the `visual` and the
    // answer; keying on question alone reports those as frozen when they are not.
    if (q.question) seen.add([q.question, q.visual, q.answer].join('\u0000'));
  }
  if (seen.size === 1) problems.push(`T${tier} ${name}: always produces the same question`);
}
console.log(`generators executed: ${ran} × ${ITER} samples`);

// ---- progress sync resolves to the right curriculum node ----
// getSkillTreeName(domain) decides the skill_name the Dojo posts to the portal,
// which is stored verbatim in skill_progress. The skill_progress_with_graph view
// joins curriculum_nodes.legacy_name = skill_progress.skill_name, and legacy_name
// is the node TITLE. So every playable skill must resolve to its graph title, or
// that student's practice silently fails to link to any curriculum node.
try {
  vm.runInContext(
    `globalThis.__DTT = ${literal('const DOJO_TO_TREE_SKILL = {')};
` +
    `globalThis.__STM = ${literal('const SKILL_TREE_MAPPING = {')};
`,
    ctx, { filename: 'math-dojo-maps.js' });
  const resolve = d => ctx.__DTT[d] || ctx.__STM[d] || d;
  for (const node of graph.nodes) {
    const ds = node.dojo_skill || node.title;
    if (!distinct.has(ds)) continue;
    const got = resolve(ds);
    if (got !== node.title) {
      problems.push(`progress sync: "${ds}" resolves to "${got}" but ${node.id} is titled `
        + `"${node.title}" — skill_progress rows will not join to the curriculum node`);
    }
  }
} catch (e) {
  problems.push(`could not check progress-sync mapping: ${e.message}`);
}

// ---- lessons, at runtime ----
// tools/audit-lessons.js reads only the `const lessons` literal, so the lessons
// registered by the V2 block were never checked, and it cannot see that
// _addSkill OVERWRITES a literal entry at load time — it reports defects in
// lesson bodies the game replaces. These checks run against what the game
// actually serves.
const warnings = new Set();
// A commonMistakes key colliding with the correct answer is usually harmless:
// selectGuidedOption() runs checkAnswer() FIRST and only consults commonMistakes
// in the incorrect branch, so a colliding key simply never fires — and lessons
// randomise, so `[String(exp)]: ...` against answer String(base) collides only on
// the 3^3 draw and is a good distractor on every other one. What IS a defect is a
// key that collides on EVERY draw: feedback the author wrote that can never show.
const mistakeStats = new Map();
const REQUIRED = ['teachingSteps', 'example', 'keyPoints', 'mistakes', 'guided'];

// A lesson is either a single body, or a `hasSubSkills` wrapper whose
// subSkills[] entries each carry a full body. Checking the wrapper as if it
// were a body reports every one of its fields as missing.
function checkLessonBody(at, L) {
  if (!L || typeof L !== 'object') { warnings.add(`${at}: lesson body is not an object`); return; }
  for (const k of REQUIRED) if (!(k in L)) warnings.add(`${at}: lesson missing field ${k}`);
  if (Array.isArray(L.teachingSteps)) {
    if (L.teachingSteps.length < 3) warnings.add(`${at}: only ${L.teachingSteps.length} teaching step(s)`);
    L.teachingSteps.forEach((s, i) => {
      if (!s || typeof s !== 'object') warnings.add(`${at}: teachingSteps[${i}] is not an object`);
      else if (!s.title || !s.explanation) warnings.add(`${at}: teachingSteps[${i}] missing title/explanation`);
    });
  }
  if (Array.isArray(L.mistakes)) {
    const seen = new Set();
    L.mistakes.forEach((m, i) => {
      if (!m || typeof m !== 'object') return;
      if (!m.wrong || !m.why) warnings.add(`${at}: mistakes[${i}] missing wrong/why`);
      const k = optKey(m.wrong);
      if (seen.has(k)) warnings.add(`${at}: mistakes[${i}] repeats "${m.wrong}"`);
      seen.add(k);
    });
  }
  // The one that actually hurts a student: typing the correct answer into a
  // guided step and being shown a "common mistake" correction for it.
  if (L.guided && Array.isArray(L.guided.interactiveSteps)) {
    L.guided.interactiveSteps.forEach((step, i) => {
      if (!step || typeof step !== 'object') return;
      const ans = step.answer;
      if (ans === undefined || ans === null || ans === '') {
        warnings.add(`${at}: guided step ${i} has no answer`);
        return;
      }
      const nAns = optKey(ans);
      const accept = (step.acceptableAnswers || []).map(optKey);
      if (accept.length && !accept.includes(nAns)) {
        warnings.add(`${at}: guided step ${i} acceptableAnswers omits "${ans}"`);
      }
      if (step.commonMistakes && typeof step.commonMistakes === 'object') {
        const acceptSet = new Set(accept.length ? accept : [nAns]);
        // Key by ORDINAL, not by the rendered key text. These keys are computed
        // — `[`${b} groups of ${a}`]` against answer `${a} groups of ${b}` —
        // so the rendering that collides only exists on the draw where it
        // collides. Keying by text makes every conditional collision look
        // permanently dead.
        Object.keys(step.commonMistakes).forEach((key, mi) => {
          const id = `${at}|guided step ${i}|entry ${mi}`;
          const st = mistakeStats.get(id) || { seen: 0, dead: 0, sample: key };
          st.seen++;
          if (acceptSet.has(optKey(key))) { st.dead++; st.sample = key; }
          mistakeStats.set(id, st);
        });
      }
    });
  }
}

for (const { tier, name } of placements) {
  const fn = ctx.lessons[tier] && ctx.lessons[tier][name];
  if (typeof fn !== 'function') continue;
  const at = `T${tier} ${name}`;
  // Literal lessons build their worked example from rand(), so a collision
  // between a commonMistakes key and the correct answer often only fires for
  // some draws. One call per lesson misses most of them.
  for (let iter = 0; iter < 40; iter++) {
    seed = (tier * 6737 + iter * 95443 + name.length * 2749) | 0;
    let L;
    try {
      L = fn();
    } catch (e) { problems.push(`${at}: lesson threw — ${e.message}`); break; }
    if (!L || typeof L !== 'object') { problems.push(`${at}: lesson did not return an object`); break; }
    if (L.hasSubSkills) {
      if (!Array.isArray(L.subSkills)) { warnings.add(`${at}: hasSubSkills but subSkills is not an array`); break; }
      if (!L.subSkills.length) { warnings.add(`${at}: subSkills is empty`); break; }
      const ids = new Set();
      L.subSkills.forEach((s, i) => {
        if (s && s.id) {
          if (ids.has(s.id)) warnings.add(`${at}: duplicate subSkill id ${s.id}`);
          ids.add(s.id);
        } else warnings.add(`${at}: subSkills[${i}] missing id`);
        checkLessonBody(`${at}/${(s && s.id) || i}`, s);
      });
    } else {
      checkLessonBody(at, L);
    }
  }
}

// An entry dead on every sampled draw is feedback that can never reach a student.
for (const [id, st] of mistakeStats) {
  if (st.seen >= 5 && st.dead === st.seen) {
    const [at, step] = id.split('|');
    warnings.add(`${at}: ${step} lists "${st.sample}" as a common mistake, but it is the correct answer on every draw — the hint can never show`);
  }
}

// ---- report ----
// --verbose prints one real failing sample per problem, which is the only way
// to tell a bad distractor set from a bad answer format.
if (process.argv.includes('--verbose')) {
  console.log('\n=== samples ===');
  for (const [key, s] of samples) console.log(`  ${key}\n      ${s}`);
}

const uniq = [...new Set(problems)];
const fatal = uniq.filter(p => p.startsWith('FATAL'));
console.log(`\n=== ${uniq.length} problem(s) ===`);
for (const p of uniq) console.log('  ' + p);
if (!uniq.length) console.log('  none — every playable skill has a lesson, a working generator, '
  + 'a matching graph node and a satisfiable prerequisite chain.');
if (hygiene.size) {
  console.log(`\n=== ${hygiene.size} generator hygiene warning(s) — repaired at runtime, not student-visible ===`);
  for (const h of [...hygiene].sort()) console.log('  ' + h);
}
if (warnings.size) {
  console.log(`\n=== ${warnings.size} lesson quality warning(s) ===`);
  for (const w of [...warnings].sort()) console.log('  ' + w);
}
process.exit(fatal.length || uniq.length ? 1 : 0);
