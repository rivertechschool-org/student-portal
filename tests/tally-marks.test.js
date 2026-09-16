// Tally marks in Math Dojo's Data Collection skill.
//
// A group of five tally marks is four upright marks with the fifth drawn
// ACROSS them. No character can do that, and the two attempts in this file
// both shipped broken:
//
//   * The question generator wrote "||||" followed by U+0338 COMBINING LONG
//     SOLIDUS OVERLAY. A combining mark attaches to the character BEFORE it, so
//     at best it struck through the fourth bar instead of all four — and since
//     most fonts have no glyph for that pair, the browser drew that cluster
//     from a fallback font, which is why some marks came out a different size
//     from their neighbours.
//   * The lesson just wrote four plain pipes and called them five. Every number
//     in the lesson disagreed with the chart above it: the goal problem showed
//     7 + 5 + 4 marks and asked for 20, the guided problem showed 19 and
//     expected 23, and one step asked what "|||| (4 marks with a line through)"
//     means while showing no line through anything.
//
// Neither is visible to a test that reads the source for the right words, so
// this one runs the real tallyMarks() and counts the strokes it draws, then
// checks every number the Data Collection lesson states against the marks
// drawn beside it.
//
// Run: node tests/tally-marks.test.js

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const lines = SRC.split('\n');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- pull the real code out of the page, the way tools/dojo-lesson-audit.js does
function lineOf(re) {
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i;
  throw new Error('not found: ' + re);
}
function fnSource(name) {
  const at = lineOf(new RegExp('^function ' + name + '\\b'));
  for (let i = at + 1; i < lines.length; i++) if (/^}\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  throw new Error(name + ' unterminated');
}
function tableSource(name) {
  const at = lineOf(new RegExp('^const ' + name + ' = \\{'));
  for (let i = at + 1; i < lines.length; i++) if (/^};\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  throw new Error(name + ' unterminated');
}

const helpers = [
  lines[lineOf(/^const rand = /)],
  lines[lineOf(/^const pick = /)],
  lines[lineOf(/^const shuffle = /)],
  lines[lineOf(/^const cap = /)],
  lines[lineOf(/^const gcd = /)],
  lines[lineOf(/^const simplifyFrac = /)],
  fnSource('tallyMarks'),
  fnSource('generateDistractors'),
  fnSource('backfillOptions'),
  fnSource('answerValue'),
  fnSource('uniqOpts'),
  fnSource('getUnlockedSubSkillTypes'),
].join('\n');

const stateStub = `const state = new Proxy({ completedSubSkills: new Proxy({}, { get: () => [] }) }, { get: (t, k) => k in t ? t[k] : {} });`;

const { tallyMarks, generators, lessons } = new Function(
  '"use strict";' + stateStub + '\n' + helpers + '\n'
  + tableSource('generators') + '\n' + tableSource('lessons')
  + '\nreturn { tallyMarks, generators, lessons };')();

// ---- read a drawn tally back out of its markup -------------------------------
const strokesOf = svg => [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"\/>/g)]
  .map(m => m.slice(1).map(Number));
const uprightsOf = svg => strokesOf(svg).filter(([x1, , x2]) => x1 === x2);
const diagonalsOf = svg => strokesOf(svg).filter(([x1, , x2]) => x1 !== x2);
// What a student would count: every stroke is one mark, crossing strokes included.
const readCount = svg => strokesOf(svg).length;
const svgsIn = text => String(text).match(/<svg class="dojo-tally"[\s\S]*?<\/svg>/g) || [];

// ---------------------------------------------------------------- 1. the marks
{
  for (const n of [0, 1, 3, 4, 5, 6, 9, 10, 14, 15, 23, 30]) {
    const svg = tallyMarks(n);
    const up = uprightsOf(svg), diag = diagonalsOf(svg);
    check(`${n} marks: strokes drawn`, readCount(svg), n);
    check(`${n} marks: crossing strokes`, diag.length, Math.floor(n / 5));
    check(`${n} marks: upright strokes`, up.length, n - Math.floor(n / 5));

    // THE size complaint: every upright mark identical, no odd one out.
    const sizes = new Set(up.map(([x1, y1, x2, y2]) => `${x2 - x1}x${y2 - y1}`));
    check(`${n} marks: all upright marks the same size`, [...sizes], up.length ? ['0x26'] : []);

    // THE slash complaint: each crossing stroke spans its own four marks.
    for (const [dx1, , dx2] of diag) {
      const crossed = up.filter(([bx]) => bx > dx1 && bx < dx2).length;
      check(`${n} marks: a crossing stroke covers four uprights`, crossed, 4);
    }
    // ...and it leans, rather than being another upright.
    for (const [dx1, dy1, dx2, dy2] of diag) {
      ok(`${n} marks: the crossing stroke is diagonal`, dx2 > dx1 && dy2 < dy1);
    }

    const [, W, H] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
    const outside = strokesOf(svg).filter(([x1, y1, x2, y2]) =>
      Math.min(x1, x2) < 0 || Math.max(x1, x2) > W || Math.min(y1, y2) < 0 || Math.max(y1, y2) > H);
    check(`${n} marks: nothing drawn outside the viewBox`, outside, []);
  }

  // Groups must not run into each other.
  const wide = tallyMarks(20);
  const diag = diagonalsOf(wide);
  for (let i = 1; i < diag.length; i++) {
    ok(`group ${i + 1} starts after group ${i} ends`, diag[i][0] > diag[i - 1][2]);
  }

  // Scales, so the inline marks in the lesson and the big one on the question
  // screen are the same drawing at two sizes.
  const small = tallyMarks(7, { scale: 0.62 }), big = tallyMarks(7, { scale: 1.4 });
  check('scaling keeps the same strokes', readCount(small), readCount(big));
  ok('scaling changes the rendered size', Number(big.match(/height="(\d+)"/)[1]) > Number(small.match(/height="(\d+)"/)[1]));

  // The label must not read out the total - that is the question.
  ok('the accessible label describes groups, not the total', /groups? of five/.test(tallyMarks(13)) && !/\b13\b/.test(tallyMarks(13)));
}

// ---------------------------------------------------------------- 2. no typed tallies left
{
  ok('no combining solidus overlay anywhere in the page', !SRC.includes('̸'));
  const pipeRuns = lines
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /\|{3,}/.test(l) && !/^\s*\/\//.test(l));
  check('no run of pipes left standing in for tally marks', pipeRuns.map(([n]) => n), []);
}

// ---------------------------------------------------------------- 3. every renderer knows the type
{
  // The visual dispatch is copied in three places (question screen, practice
  // screen, teaching step). A type registered in only some of them renders as
  // nothing on the others, silently.
  const chartSites = (SRC.match(/renderChart\(\w+/g) || []).length;
  const tallySites = (SRC.match(/renderTally\(\w+/g) || []).length;
  check('tally is dispatched everywhere chart is', tallySites, chartSites);
}

// ---------------------------------------------------------------- 4. the generated question
{
  const gen = generators[3] && generators[3]['Data Collection'];
  ok('Data Collection generator exists at tier 3', typeof gen === 'function');

  let seen = 0;
  for (let i = 0; i < 600 && seen < 60; i++) {
    const q = gen();
    if (!q || q.subType !== 'tally') continue;
    seen++;
    ok('tally question carries a drawn visual', q.visual && q.visual.type === 'tally');
    check('the visual shows exactly the answer', q.visual.data.count, q.answer);
    ok('the prompt no longer types the marks', !/\|/.test(q.question));
    ok('the answer is among the options', q.options.map(String).includes(String(q.answer)));
    // and the drawing really contains that many marks
    check('marks drawn = answer', readCount(tallyMarks(q.visual.data.count)), q.answer);
  }
  ok(`saw tally questions (${seen})`, seen > 0);
}

// ---------------------------------------------------------------- 5. the lesson agrees with its own pictures
{
  const lesson = lessons[3]['Data Collection']();

  const sum = text => svgsIn(text).reduce((t, s) => t + readCount(s), 0);

  // The goal problem asks for a total; the marks beside each category must add
  // up to the total the worked example lands on.
  check('goal problem draws three tallies', svgsIn(lesson.goalProblem).length, 3);
  check('goal problem marks add up to the stated total', sum(lesson.goalProblem), 20);
  ok('the example lands on that same total', /\b20\b/.test(lesson.example.steps[lesson.example.steps.length - 1].math));
  check('the example problem draws the same chart', sum(lesson.example.problem), 20);

  // The guided problem's marks must add up to the answer the student is asked for.
  check('guided problem marks add up to the guided answer', sum(lesson.guided.problem), Number(lesson.guided.answer));

  // Any guided step that shows a tally and asks for a count: the drawing has to
  // BE that count. This is the check the old lesson failed on every step.
  let counted = 0;
  for (const step of lesson.guided.interactiveSteps) {
    const svgs = svgsIn(step.prompt);
    if (svgs.length !== 1 || !/^\d+$/.test(String(step.answer))) continue;
    counted++;
    check(`step "${step.prompt.replace(/<[^>]*>/g, '').trim().slice(0, 40)}" draws its own answer`,
      readCount(svgs[0]), Number(step.answer));
  }
  ok(`guided steps that show a tally were checked (${counted})`, counted >= 3);

  // Labelled steps: "Red: [tally] =" must match the value beside it.
  for (const step of lesson.guided.steps) {
    const svgs = svgsIn(step.label);
    if (svgs.length !== 1) continue;
    const stated = Number(String(step.value).split('=').pop().trim());
    check(`guided step label "${step.label.replace(/<[^>]*>/g, '').trim()}" matches its value`, readCount(svgs[0]), stated);
  }

  // Hints are written with textContent and values are parsed for the expected
  // answer, so markup in either would show up raw or break answer checking.
  for (const step of lesson.guided.interactiveSteps) {
    ok(`hint stays plain text: "${String(step.hint).slice(0, 34)}"`, !/[<>]/.test(String(step.hint || '')));
  }
  for (const step of lesson.guided.steps) {
    ok(`guided value stays plain text: "${step.value}"`, !/[<>]/.test(String(step.value)));
  }

  // The teaching step that explains the fifth mark has to show four AND five.
  const five = lesson.teachingSteps.find(s => /fifth/.test(s.explanation));
  ok('a teaching step explains the fifth mark', !!five);
  check('it draws a four and a five side by side', svgsIn(five.visual).map(readCount), [4, 5]);

  // Nothing student-visible still claims four marks are five.
  const visible = [lesson.goalProblem, lesson.example.problem, lesson.guided.problem]
    .concat(lesson.keyPoints, lesson.mistakes.map(m => m.wrong + ' ' + m.why),
            lesson.teachingSteps.map(s => s.explanation + ' ' + s.visual),
            lesson.guided.interactiveSteps.map(s => s.prompt)).join(' ');
  ok('no typed pipes anywhere in the lesson', !/\|/.test(visible));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
