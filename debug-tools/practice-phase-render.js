// Behavioural test of the LEARNING path's practice phase in games/math-dojo.html.
//
// This is the "5 correct in a row" gate that marks a skill mastered. It used to
// render question.options unconditionally, so every skill at every tier was
// mastered by clicking one of four buttons — the tier-5+ typed-answer rule only
// ever ran in the arcade path. This harness drives the real functions against a
// minimal DOM stub and asserts:
//
//   1. a tier 5+ computed question renders a TEXT INPUT, not option buttons
//   2. typing the correct answer advances the streak
//   3. typing a wrong answer resets the streak AND names the correct answer
//   4. a vocabulary answer still renders option buttons (typing "SSS" would be
//      a spelling test, not mathematics)
//   5. a tier 1-4 question still renders option buttons
//
// It extracts renderPracticePhase / submitPracticeTypedAnswer / selectPracticeOption
// / applyPracticeResult verbatim from the page, so it cannot drift from shipped code.
//
// Usage: node debug-tools/practice-phase-render.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'games/math-dojo.html'), 'utf8');

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
function fnSource(name) {
  const d = src.indexOf(`function ${name}(`);
  if (d < 0) throw new Error(`function ${name} not found in games/math-dojo.html`);
  const o = src.indexOf('{', d);
  return src.slice(d, findMatchingBrace(src, o) + 1);
}
function sliceByLine(startsWith) {
  const lines = src.split('\n');
  const s = lines.findIndex(l => l.startsWith(startsWith));
  if (s < 0) throw new Error(`${startsWith} not found`);
  let e = s + 1;
  while (e < lines.length && !/^\};/.test(lines[e])) e++;
  return lines.slice(s, e + 1).join('\n');
}

// ---- minimal DOM stub: only what the practice phase touches ----
function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', disabled: false, style: {},
    selectionStart: 0, selectionEnd: 0,
    _classes: new Set(), _listeners: {},
    classList: {
      add: (...c) => c.forEach(x => el._classes.add(x)),
      remove: (...c) => c.forEach(x => el._classes.delete(x)),
      toggle: (c, on) => { if (on) el._classes.add(c); else el._classes.delete(c); },
      contains: c => el._classes.has(c),
    },
    addEventListener: (ev, fn) => { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
    focus: () => {},
    appendChild: () => {},
  };
  Object.defineProperty(el, 'className', {
    get: () => [...el._classes].join(' '),
    set: v => { el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  return el;
}
const els = new Map();
const document = {
  getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  // The only querySelectorAll the practice path uses is '.practice-option'.
  querySelectorAll: sel => {
    if (sel !== '.practice-option') return [];
    const html = document.getElementById('practice-options').innerHTML;
    const count = (html.match(/class="practice-option"/g) || []).length;
    return Array.from({ length: count }, (_, i) => makeEl('opt' + i));
  },
  createElement: () => makeEl('tmp'),
};

// ---- sandbox ----
let seed = 7;
function seeded() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const sandbox = {
  Math: Object.create(Math), JSON, String, Number, Array, Object, RegExp, Boolean,
  isNaN, parseInt, parseFloat, console, document,
  setTimeout: () => 0, clearTimeout: () => {},
  state: {
    practiceCorrect: 0, practiceAttempts: 0, learningTier: 5,
    learningSkill: 'Linear Equations', currentLesson: {}, practiceRecentQuestions: [],
  },
  recordQuestionResult: () => {},
  renderVisual: () => {},
  getSmartPlaceholder: () => 'e.g. 5',
  completeLearning: () => {},
};
sandbox.Math.random = seeded;
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);

vm.runInContext(
  `${sliceByLine('const AnswerInterpreter = {')}\n` +
  `const NON_TYPEABLE_ANSWER_TYPES = ${src.slice(
    src.indexOf('const NON_TYPEABLE_ANSWER_TYPES = new Set(') + 'const NON_TYPEABLE_ANSWER_TYPES = '.length,
    src.indexOf(']);', src.indexOf('const NON_TYPEABLE_ANSWER_TYPES = new Set(')) + 3)};\n` +
  `${fnSource('answerIsTypeable')}\n` +
  `${fnSource('shouldTypeAnswer')}\n` +
  `${fnSource('typedAnswerIsCorrect')}\n` +
  `${fnSource('renderPracticePhase')}\n` +
  `${fnSource('insertPracticeSymbol')}\n` +
  `${fnSource('submitPracticeTypedAnswer')}\n` +
  `${fnSource('selectPracticeOption')}\n` +
  `${fnSource('applyPracticeResult')}\n` +
  `${fnSource('dismissPracticeFeedback')}\n` +
  `globalThis.renderPracticePhase = renderPracticePhase;\n` +
  `globalThis.submitPracticeTypedAnswer = submitPracticeTypedAnswer;\n` +
  `globalThis.selectPracticeOption = selectPracticeOption;\n`,
  ctx, { filename: 'practice-phase.js' });

// generateQuestion is stubbed so each case is deterministic and isolated.
let NEXT = null;
ctx.generateQuestion = () => NEXT;

// ---- assertions ----
let pass = 0; const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
}
function optsHTML() { return ctx.document.getElementById('practice-options').innerHTML; }
function reset(tier) {
  ctx.state.practiceCorrect = 0;
  ctx.state.practiceRecentQuestions = [];
  ctx.state.learningTier = tier;
}

console.log('\n--- 1. tier 5 computed answer renders a TEXT INPUT ---');
reset(5);
NEXT = { question: 'Solve: 4x + 8 = 36', answer: '7', type: 'procedural', options: ['7', '8', '6', '9'] };
ctx.renderPracticePhase({});
check('renders <input id="practice-typed-input">', /id="practice-typed-input"/.test(optsHTML()));
check('renders NO option buttons', !/class="practice-option"/.test(optsHTML()), optsHTML().slice(0, 120));
check('renders a Check button', /practice-submit-btn/.test(optsHTML()));

console.log('\n--- 2. correct typed answer advances the streak ---');
ctx.document.getElementById('practice-typed-input').value = '7';
ctx.submitPracticeTypedAnswer();
check('streak advanced to 1', ctx.state.practiceCorrect === 1, `got ${ctx.state.practiceCorrect}`);
check('feedback marked correct', ctx.document.getElementById('practice-feedback').classList.contains('correct'));

console.log('\n--- 2b. equivalent formatting is accepted (7.0 for 7) ---');
reset(5);
NEXT = { question: 'Solve: 4x + 8 = 36', answer: '7', type: 'procedural', options: ['7', '8', '6', '9'] };
ctx.renderPracticePhase({});
ctx.document.getElementById('practice-typed-input').value = '7.0';
ctx.submitPracticeTypedAnswer();
check('"7.0" accepted for answer "7"', ctx.state.practiceCorrect === 1, `got ${ctx.state.practiceCorrect}`);

console.log('\n--- 3. wrong typed answer resets streak and names the answer ---');
reset(5);
NEXT = { question: 'Solve: 4x + 8 = 36', answer: '7', type: 'procedural', options: ['7', '8', '6', '9'] };
ctx.renderPracticePhase({});
ctx.state.practiceCorrect = 3;
ctx.document.getElementById('practice-typed-input').value = '9';
ctx.submitPracticeTypedAnswer();
check('streak reset to 0', ctx.state.practiceCorrect === 0, `got ${ctx.state.practiceCorrect}`);
const fbHTML = ctx.document.getElementById('practice-feedback').innerHTML;
check('feedback names the correct answer', /<strong>7<\/strong>/.test(fbHTML), fbHTML);

console.log('\n--- 4. vocabulary answer still renders option buttons ---');
reset(6);
NEXT = { question: 'Which postulate proves the triangles congruent?', answer: 'ASA',
         type: 'conceptual', options: ['ASA', 'SSS', 'SAS', 'AAS'] };
ctx.renderPracticePhase({});
check('renders option buttons', /class="practice-option"/.test(optsHTML()));
check('renders NO text input', !/practice-typed-input/.test(optsHTML()));

console.log('\n--- 5. below tier 5 still renders option buttons ---');
reset(3);
NEXT = { question: 'What is 20% of 50?', answer: '10', type: 'procedural', options: ['10', '5', '20', '15'] };
ctx.renderPracticePhase({});
check('tier 3 stays multiple choice', /class="practice-option"/.test(optsHTML()) && !/practice-typed-input/.test(optsHTML()));

console.log('\n--- 6. clicking an option still works (no regression) ---');
reset(3);
NEXT = { question: 'What is 20% of 50?', answer: '10', type: 'procedural', options: ['10', '5', '20', '15'] };
ctx.renderPracticePhase({});
ctx.selectPracticeOption(0);
check('correct click advances streak', ctx.state.practiceCorrect === 1, `got ${ctx.state.practiceCorrect}`);

console.log('\n--- 7. spamming the right answer counts once ---');
// The options stay up for 1.2s after a correct pick; every extra click used
// to count again, so one question could be clicked to 5 in a row.
for (let i = 0; i < 6; i++) ctx.selectPracticeOption(0);
check('six more clicks on the same question add nothing', ctx.state.practiceCorrect === 1, `got ${ctx.state.practiceCorrect}`);
ctx.selectPracticeOption(1);
check('nor does a wrong click after it reset the streak', ctx.state.practiceCorrect === 1, `got ${ctx.state.practiceCorrect}`);
ctx.renderPracticePhase({});
ctx.selectPracticeOption(0);
check('the next question counts again', ctx.state.practiceCorrect === 2, `got ${ctx.state.practiceCorrect}`);

console.log('\n--- 8. typed: a second Check on the same question counts once ---');
reset(5);
NEXT = { question: 'Solve: 4x + 8 = 36', answer: '7', type: 'procedural', options: ['7', '8', '6', '9'] };
ctx.renderPracticePhase({});
ctx.document.getElementById('practice-typed-input').value = '7';
ctx.submitPracticeTypedAnswer();
ctx.submitPracticeTypedAnswer();
check('streak is 1, not 2', ctx.state.practiceCorrect === 1, `got ${ctx.state.practiceCorrect}`);

console.log(`\n=== ${pass} passed, ${fails.length} failed ===`);
if (fails.length) { fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
process.exit(0);
