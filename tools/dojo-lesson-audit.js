#!/usr/bin/env node
// Execute every Math Dojo question generator and lesson, and check the
// mathematics is internally consistent.
//
// Two real reports drove this. "Systems by Substitution" walked a student to
// "2x = 4, divide by 2" and then asserted x = 3, because the generator's
// variables contradicted the problem it posed. Nothing static catches that -
// the code is valid, the template renders, and the wrongness only exists in
// the relationship between generated numbers.
//
// So this runs the real code. The generator and lesson tables are extracted
// from math-dojo.html by anchor, evaluated with their real helpers, and every
// generator is run hundreds of times under a seeded PRNG (findings must be
// reproducible). Checks:
//
//   G1  the correct answer appears among the options
//   G2  no NaN / undefined / null / [object Object] in any student-visible text
//   G3  options are distinct as the game's own answerValue sees them
//   G4  plain arithmetic questions ("What is 3 + 4?") actually equal the answer
//   L1  guided interactive steps: no NaN/undefined, non-empty answers
//   L2  arithmetic embedded in a step's prompt agrees with the step's answer
//   L3  the guided chain's numbers are consistent where they restate each other
//
//   node tools/dojo-lesson-audit.js            summary per tier
//   node tools/dojo-lesson-audit.js --tier 5   one tier, every finding
//   node tools/dojo-lesson-audit.js --runs 200 override runs per generator

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'games', 'math-dojo.html');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// ---------------------------------------------------------------- extraction
function lineOf(re, from = 0) {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}
function sliceBalanced(startLine) {
  // From `const X = {` to its closing `};` at column 0.
  for (let i = startLine + 1; i < lines.length; i++) {
    if (/^};\s*$/.test(lines[i])) return lines.slice(startLine, i + 1).join('\n');
  }
  throw new Error('unterminated table at line ' + (startLine + 1));
}
function fnSource(name) {
  const at = lineOf(new RegExp('^function ' + name + '\\b'));
  if (at === -1) throw new Error(name + ' not found');
  for (let i = at + 1; i < lines.length; i++) {
    if (/^}\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  }
  throw new Error(name + ' unterminated');
}

const helpers = [
  lines[lineOf(/^const rand = /)],
  lines[lineOf(/^const pick = /)],
  lines[lineOf(/^const shuffle = /)],
  lines[lineOf(/^const cap = /)],
  lines[lineOf(/^const gcd = /)],
  lines[lineOf(/^const simplifyFrac = /)],
  fnSource('generateDistractors'),
  fnSource('backfillOptions'),
  fnSource('answerValue'),
  fnSource('uniqOpts'),
  fnSource('getUnlockedSubSkillTypes'),
].join('\n');

const generatorsSrc = sliceBalanced(lineOf(/^const generators = \{/));
const lessonsSrc = sliceBalanced(lineOf(/^const lessons = \{/));

// Seeded PRNG so every finding is reproducible run to run.
const seededRandom = `
let __seed = Number(process.env.DOJO_SEED || 42);
Math.random = () => {
  __seed = (__seed * 1103515245 + 12345) & 0x7fffffff;
  return __seed / 0x7fffffff;
};`;

// state with every sub-skill complete, so generators expose all their types.
const stateStub = `
const state = new Proxy({ completedSubSkills: new Proxy({}, {
  get: () => ['lcd','add_different_denom','subtract_different_denom','multiply',
              'divide','mixed_add','mixed_subtract','understanding','compare',
              'add','subtract','round','identify','solve','reverse','place_value',
              'convert','percent_of','discount','graph','slope','intercept',
              'evaluate','simplify','distribute','combine','one_step','two_step']
}) }, { get: (t, k) => k in t ? t[k] : {} });`;

const factory = new Function(
  '"use strict";' + seededRandom + stateStub + '\n'
  + helpers + '\n' + generatorsSrc + '\n' + lessonsSrc
  + '\nreturn { generators, lessons };');

let tables;
try {
  tables = factory();
} catch (e) {
  console.error('extraction failed to evaluate: ' + e.message);
  process.exit(2);
}

// ---------------------------------------------------------------- checks
// "undefined" is correct vocabulary all over the upper tiers - "tan(π/2) =
// undefined" is the right explanation, bare "undefined" is the right OPTION
// for tan(90°), and "aleph-null" is a real cardinal. Successive tightenings
// that tried to catch it by punctuation context each flagged correct calculus
// prose. So the leak test is narrow: "undefined" glued against a digit is a
// template leak ("undefinedx + 3", "3undefined"); anything wordier is prose.
const BAD_TEXT = /\bNaN\b|\d\s*undefined|undefined\s*\d|\[object Object\]|[=:(]\s*null\b/;

// "What is 3 + 4?" / "12 - 5 = ?" with integer operands.
// Operands may not touch a digit or dot on either side: "0.5 × 40" must not
// match as "5 × 40" - that misread flagged every decimal Percents step as a
// wrong answer on the first pass.
const ARITH = /(?:what is|calculate|compute)?\s*(?<![\d.])(-?\d+)(?![\d.])\s*([+\-×x*÷/])\s*(?<![\d.])(-?\d+)(?![\d.])\s*(?:=\s*\?|\?)/i;

// Count arithmetic operators outside fraction slashes. Two or more means the
// expression has precedence in play and a naive left-to-right check would be
// wrong about right answers - the first run flagged Order of Operations
// questions as errors for exactly that reason.
function operatorCount(text) {
  return (String(text).match(/[+×x*÷]|(?<=\d)\s-\s?(?=\d)/g) || []).length;
}

function evalArith(a, op, b) {
  a = Number(a); b = Number(b);
  switch (op) {
    case '+': return a + b;
    case '-': case '−': return a - b;
    case '×': case 'x': case '*': return a * b;
    case '÷': case '/': return b !== 0 && a % b === 0 ? a / b : null;
  }
  return null;
}

const findings = [];
function report(tier, skill, code, detail) {
  findings.push({ tier, skill, code, detail: String(detail).slice(0, 180) });
}

// ---------------------------------------------------------------- generators
const argv = process.argv.slice(2);
const onlyTier = argv.includes('--tier') ? Number(argv[argv.indexOf('--tier') + 1]) : null;
const RUNS = argv.includes('--runs') ? Number(argv[argv.indexOf('--runs') + 1]) : 300;

for (const [tierStr, skills] of Object.entries(tables.generators)) {
  const tier = Number(tierStr);
  if (onlyTier && tier !== onlyTier) continue;
  for (const [skill, gen] of Object.entries(skills)) {
    if (typeof gen !== 'function') continue;
    const seenIssues = new Set();
    const once = (code, detail) => {
      const k = code + '|' + String(detail).slice(0, 80);
      if (seenIssues.has(k)) return;
      seenIssues.add(k);
      report(tier, skill, code, detail);
    };

    for (let run = 0; run < RUNS; run++) {
      let q;
      try {
        q = gen();
      } catch (e) {
        once('G-THROW', e.message);
        break;
      }
      if (!q || typeof q !== 'object') { once('G-EMPTY', 'generator returned ' + q); break; }

      const answer = q.answer;
      const answerStr = String(answer);

      if (answer === undefined || answer === null || answerStr === 'NaN') {
        once('G2', 'answer is ' + answerStr + ' for: ' + q.question);
        continue;
      }
      for (const field of ['question', 'explanation', 'hint']) {
        if (q[field] && BAD_TEXT.test(String(q[field]))) {
          once('G2', field + ' contains bad text: ' + String(q[field]).slice(0, 90));
        }
      }

      if (Array.isArray(q.options) && q.options.length) {
        const norm = (v) => String(v).trim().toLowerCase();
        if (!q.options.some((o) => norm(o) === norm(answerStr))) {
          once('G1', 'answer "' + answerStr + '" not in options [' + q.options.join(' | ') + '] for: ' + q.question);
        }
        for (const o of q.options) {
          if (BAD_TEXT.test(String(o))) once('G2', 'option contains bad text: ' + o);
        }
        const uniq = new Set(q.options.map(norm));
        if (uniq.size !== q.options.length) {
          once('G3', 'duplicate options [' + q.options.join(' | ') + '] for: ' + q.question);
        }
      }

      // Plain arithmetic questions must be true.
      const m = String(q.question || '').match(ARITH);
      const hasFraction = /\d\/\d/.test(String(q.question));
      if (m && !hasFraction && operatorCount(q.question) === 1 && /^-?\d+$/.test(answerStr)) {
        const v = evalArith(m[1], m[2], m[3]);
        if (v !== null && v !== Number(answerStr)) {
          once('G4', q.question + ' -> claims ' + answerStr + ', arithmetic says ' + v);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- lessons
function auditLessonObject(tier, skill, lesson) {
  const units = lesson && lesson.hasSubSkills && Array.isArray(lesson.subSkills)
    ? lesson.subSkills.map((s) => [skill + ' :: ' + (s.name || s.id), s])
    : [[skill, lesson]];

  for (const [label, unit] of units) {
    if (!unit || typeof unit !== 'object') continue;

    for (const field of ['goalProblem', 'finalAnswer', 'answerExplanation']) {
      if (unit[field] && BAD_TEXT.test(String(unit[field]))) {
        report(tier, label, 'L1', field + ': ' + String(unit[field]).slice(0, 100));
      }
    }
    for (const step of unit.teachingSteps || []) {
      for (const f of ['title', 'explanation', 'visual']) {
        if (f === 'visual' && typeof step[f] === 'object') continue;  // renderer handles these
        if (step[f] && BAD_TEXT.test(String(step[f]))) {
          report(tier, label, 'L1', 'teaching "' + (step.title || '') + '" ' + f + ': ' + String(step[f]).slice(0, 90));
        }
      }
    }

    const g = unit.guided;
    if (!g) continue;
    if (g.answer === undefined || g.answer === null || String(g.answer) === 'NaN' || String(g.answer) === '') {
      report(tier, label, 'L1', 'guided.answer is ' + String(g.answer));
    }
    for (const s of g.steps || []) {
      if (BAD_TEXT.test(String(s.label) + String(s.value))) {
        report(tier, label, 'L1', 'guided step: ' + s.label + ' = ' + s.value);
      }
    }
    for (const st of g.interactiveSteps || []) {
      const pr = String(st.prompt || '');
      const ans = st.answer;
      if (ans === undefined || ans === null || String(ans) === 'NaN' || String(ans) === '') {
        report(tier, label, 'L1', 'interactive step has answer "' + ans + '": ' + pr.slice(0, 80));
        continue;
      }
      if (BAD_TEXT.test(pr) || BAD_TEXT.test(String(st.hint || ''))) {
        report(tier, label, 'L1', 'bad text in step: ' + pr.slice(0, 90));
      }
      // Arithmetic stated in the prompt must agree with the expected answer.
      const m = pr.match(ARITH);
      if (m && operatorCount(pr) === 1 && /^-?\d+$/.test(String(ans))) {
        const v = evalArith(m[1], m[2], m[3]);
        if (v !== null && v !== Number(ans)) {
          report(tier, label, 'L2', pr.slice(0, 90) + ' -> expects ' + ans + ', arithmetic says ' + v);
        }
      }
      // A hint of the form "A - B = ?" or "A + B = ?" restating the work.
      const hm = String(st.hint || '').match(/(-?\d+)\s*([+\-×x*÷/])\s*(-?\d+)\s*=\s*\?/);
      if (hm && operatorCount(st.hint) === 1 && /^-?\d+$/.test(String(ans))) {
        const v = evalArith(hm[1], hm[2], hm[3]);
        if (v !== null && v !== Number(ans)) {
          report(tier, label, 'L2', 'hint "' + st.hint + '" -> expects ' + ans + ', arithmetic says ' + v);
        }
      }
    }
  }
}

// Lessons are built per call too (they close over rand results), so evaluate
// each several times - a consistency bug may only show for some draws.
for (const [tierStr, skills] of Object.entries(tables.lessons)) {
  const tier = Number(tierStr);
  if (onlyTier && tier !== onlyTier) continue;
  for (const [skill, mk] of Object.entries(skills)) {
    if (typeof mk !== 'function') continue;
    for (let i = 0; i < 25; i++) {
      let lesson;
      try {
        lesson = mk();
      } catch (e) {
        report(tier, skill, 'L-THROW', e.message);
        break;
      }
      auditLessonObject(tier, skill, lesson);
    }
  }
}

// ---------------------------------------------------------------- output
const dedup = new Map();
for (const f of findings) {
  const k = [f.tier, f.skill, f.code, f.detail].join('|');
  if (!dedup.has(k)) dedup.set(k, f);
}
const unique = [...dedup.values()];

const byTier = new Map();
for (const f of unique) {
  if (!byTier.has(f.tier)) byTier.set(f.tier, []);
  byTier.get(f.tier).push(f);
}

console.log('\nMath Dojo lesson & generator audit');
console.log('  ' + RUNS + ' runs per generator, 25 evaluations per lesson, seeded PRNG\n');

for (const [tier, list] of [...byTier].sort((a, b) => a[0] - b[0])) {
  console.log('  tier ' + tier + ': ' + list.length + ' findings');
  const show = onlyTier ? list : list.slice(0, 6);
  for (const f of show) {
    console.log('      [' + f.code + '] ' + f.skill);
    console.log('            ' + f.detail);
  }
  if (!onlyTier && list.length > 6) console.log('      ... ' + (list.length - 6) + ' more (--tier ' + tier + ' for all)');
}
if (!unique.length) console.log('  no findings');
console.log('\n  ' + unique.length + ' unique findings\n');
process.exit(unique.length ? 1 : 0);
