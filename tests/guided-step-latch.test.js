// The guided Check button, after the step before it.
//
// Holding Enter used to walk a whole guided problem on its own: the handler was
// on `keypress`, which auto-repeats, and a correct answer schedules the next
// step on a timer, so every repeat landing in that window submitted again.
//
// The guard for that is a latch — refuse to be re-entered while a correct
// answer is being celebrated. Which introduced a worse bug than the one it
// fixed: the latch was set and never released, so the FIRST correct answer
// worked and the Check button never responded again.
//
// That shipped. It shipped because the test written alongside it asserted on
// the source text — that the handler said `keydown`, that the guard existed —
// and source text cannot tell you a latch is never released. So this one runs
// the real function, twice, and looks at what happened.
//
// Three properties, and the second is the one that was broken:
//
//   * A HELD KEY SUBMITS ONCE. A second call inside the advance window is
//     ignored.
//   * THE LATCH ALWAYS RELEASES. Once the next step is drawn the box works
//     again — including when drawing it throws, because a latch that leaks on
//     an exception is a Check button that is dead for the rest of the lesson.
//   * A WRONG ANSWER NEVER LATCHES. Getting it wrong must leave you able to
//     try again immediately.
//
// Run: node tests/guided-step-latch.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the real function, with its neighbours passed in --------------------
function extractFn(name) {
  const marker = `function ${name}(`;
  const at = html.indexOf(marker);
  if (at < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', at), depth = 0, end = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return html.slice(html.indexOf('{', at) + 1, end - 1);
}

const BODY = extractFn('checkGuidedStepAnswer');

function makeHarness({ renderThrows = false } = {}) {
  const h = {
    rendered: 0,
    completed: 0,
    added: [],
    feedback: '',
    inputValue: '',
    state: {
      guidedCurrentStep: 0,
      guidedAttempts: 0,
      guidedAnswerRevealed: false,
      guidedAdvancing: false,
      guidedSteps: [
        { answer: '7', acceptableAnswers: ['7'] },
        { answer: 'tenths', acceptableAnswers: ['tenths', 'tenth'] },
        { answer: '0.06', acceptableAnswers: ['0.06'] },
      ],
    },
  };
  const fbEl = { className: '', set innerHTML(v) { h.feedback = v; }, get innerHTML() { return h.feedback; } };
  const inputEl = { get value() { return h.inputValue; }, select() {} };
  const document = {
    getElementById: (id) => (id === 'guided-answer-input' ? inputEl : id === 'guided-feedback' ? fbEl : null),
  };
  const AnswerInterpreter = {
    checkAnswer: (input, acceptable) => ({
      correct: acceptable.some(a => String(a).toLowerCase() === String(input).toLowerCase()),
      matchType: 'exact',
    }),
  };
  h.fn = new Function(
    'state', 'document', 'AnswerInterpreter', 'getEncouragement',
    'addCompletedStep', 'renderGuidedStep', 'showGuidedCompletion', BODY
  ).bind(
    null, h.state, document, AnswerInterpreter,
    () => 'Nice.',
    (step, ans) => h.added.push(ans),
    () => { h.rendered++; if (renderThrows) throw new Error('render blew up'); },
    () => { h.completed++; }
  );
  return h;
}

const settle = () => new Promise(r => setTimeout(r, 1100));

(async () => {
  console.log('\n== the step after the step ==\n');

  {
    const h = makeHarness();

    h.inputValue = '7';
    h.fn();
    check('a correct answer is accepted', h.added, ['7']);
    ok('  and latches while it advances', h.state.guidedAdvancing);

    // The whole bug, in one line: what a held key used to do.
    h.fn();
    check('a second submission inside that window is ignored', h.added, ['7']);

    await settle();
    check('the next step is drawn', h.state.guidedCurrentStep, 1);
    check('  and the latch is released', h.state.guidedAdvancing, false);

    // THE REGRESSION. Before the release was added, this did nothing at all.
    h.inputValue = 'tenths';
    h.fn();
    check('THE NEXT STEP ACCEPTS AN ANSWER', h.added, ['7', 'tenths']);

    await settle();
    h.inputValue = '0.06';
    h.fn();
    check('and so does the one after that', h.added, ['7', 'tenths', '0.06']);

    await settle();
    check('finishing the last step completes the problem', h.completed, 1);
  }

  console.log('\n== the latch cannot leak ==\n');

  {
    // A latch released by a plain assignment after the render call would be
    // stranded here, and the Check button would be dead for the rest of the
    // lesson — a worse failure than the one the latch prevents.
    //
    // The throw escapes the timer, which is what it should do: in a browser
    // that is an uncaught error in the console and nothing else, and the next
    // click still works. Node kills the process for one instead, so it is
    // caught here rather than swallowed in the code under test.
    const thrown = [];
    const onErr = (e) => thrown.push(e.message);
    process.on('uncaughtException', onErr);

    const h = makeHarness({ renderThrows: true });
    h.inputValue = '7';
    h.fn();
    await settle();
    process.off('uncaughtException', onErr);

    check('drawing the step threw', h.rendered, 1);
    check('  and the throw was not swallowed', thrown, ['render blew up']);
    check('  and the latch still released', h.state.guidedAdvancing, false);

    h.inputValue = 'tenths';
    h.fn();
    check('  so the box still works', h.added, ['7', 'tenths']);
  }

  console.log('\n== wrong answers and empty boxes ==\n');

  {
    const h = makeHarness();
    h.inputValue = 'nope';
    h.fn();
    check('a wrong answer is not accepted', h.added, []);
    check('  and does not latch', h.state.guidedAdvancing, false);
    check('  it counts as an attempt', h.state.guidedAttempts, 1);

    h.inputValue = '7';
    h.fn();
    check('  so the next try lands', h.added, ['7']);
  }

  {
    const h = makeHarness();
    h.inputValue = '   ';
    h.fn();
    check('an empty box is not an answer', h.added, []);
    check('  and is not even an attempt', h.state.guidedAttempts, 0);
  }

  console.log('\n== and the key that started it ==\n');

  ok('the guided input listens on keydown, not keypress',
    /id="guided-answer-input"[^>]*onkeydown=/.test(html));
  check('  no keypress handler is left', /id="guided-answer-input"[^>]*onkeypress=/.test(html), false);
  ok('  and auto-repeat is refused', /event\.key==='Enter'&&!event\.repeat/.test(html));
  ok('a fresh problem starts unlatched',
    /state\.guidedCurrentStep = 0;\s*\n\s*state\.guidedAdvancing = false;/.test(html));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
