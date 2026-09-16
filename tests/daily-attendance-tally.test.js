// The morning register says how the morning went.
//
// It reported how much of the register had been TYPED IN — "18 of 23 students
// have attendance marked" — and never what those marks said. The one question
// anybody actually asks at the door, how many are in and how many are out, was
// the one thing on the screen you had to work out by counting rows.
//
// WHY IT COUNTS THE ROSTER INSTEAD OF KEEPING A TOTAL
//
// This register is edited from more than one phone, and pulls other devices'
// marks in every 20 seconds. A tally incremented as changes happen drifts the
// first time two people touch the same child — and drifts silently, which on
// an attendance screen is the worst way to be wrong.
//
// So it counts the dropdowns, which are what is actually on screen. A remote
// change repaints it for free, because refreshDailyAttendance routes every row
// it moves through the same handler a local change uses.
//
// Run: node tests/daily-attendance-tally.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', i);
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^\s*async\b/.test(m[0].slice(1));
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// Enough DOM to hold a register: rows carrying a status dropdown, a tally
// strip, and the per-row panels the change handler shows and hides.
function makeDom(statuses) {
  const strip = { id: 'daily-attendance-tally', innerHTML: '' };
  const selects = statuses.map((v, i) => ({
    value: v || '',
    dataset: { studentId: 's' + i },
    className: 'attendance-status',
  }));
  const panel = () => ({ style: { display: 'none' }, querySelector: () => panel() });

  global.document = {
    getElementById: (id) => (id === 'daily-attendance-tally' ? strip : null),
    querySelectorAll: (sel) =>
      sel.includes('.attendance-status') ? selects : [],
    // The handler reaches for the row's panels by student id; any of them can
    // be a throwaway, this test is about the counting.
    querySelector: () => panel(),
  };
  return { strip, selects };
}

const app = {
  escapeHtml: (t) => String(t == null ? '' : t),
  saveOneAttendance: () => {},
};
app._renderDailyTally = extract('_renderDailyTally');
app.onAttendanceStatusChange = extract('onAttendanceStatusChange');

// Pull the number sitting next to a label out of the rendered strip.
const countOf = (html, label) => {
  const m = html.match(new RegExp('<strong[^>]*>(\\d+)</strong>\\s*<span[^>]*>' + label + '<'));
  return m ? Number(m[1]) : null;
};

(async () => {

  console.log('\n== a normal morning ==\n');

  {
    const { strip } = makeDom(['present', 'present', 'present', 'absent', 'late', '']);
    app._renderDailyTally.call(app);

    check('present are counted', countOf(strip.innerHTML, 'Present'), 3);
    check('absent are counted', countOf(strip.innerHTML, 'Absent'), 1);
    check('late are counted', countOf(strip.innerHTML, 'Late'), 1);
    // The one nobody has got to yet is the actionable number at the door.
    check('and the ones not yet marked', countOf(strip.innerHTML, 'not yet marked'), 1);
  }

  {
    // A row of zeroes reads as noise and buries the two numbers that matter.
    const { strip } = makeDom(['present', 'present', 'absent']);
    app._renderDailyTally.call(app);
    ok('a status nobody used is left out', !/Left early/.test(strip.innerHTML));
    ok('  and so is the leftover count when everyone is marked',
       !/not yet marked/.test(strip.innerHTML));
    check('  what did happen is still there', countOf(strip.innerHTML, 'Present'), 2);
  }

  {
    const { strip } = makeDom(['', '', '']);
    app._renderDailyTally.call(app);
    // "3 not yet marked" is more use at the door than "nothing marked yet",
    // and it is the same number the teacher is about to work through.
    check('an untouched register shows what is outstanding',
          countOf(strip.innerHTML, 'not yet marked'), 3);
  }

  {
    // The roster prints its own "no students are scheduled on Wednesday". A
    // second empty-state beside it just makes the screen look broken.
    const { strip } = makeDom([]);
    app._renderDailyTally.call(app);
    check('a day with nobody scheduled shows no strip at all', strip.innerHTML, '');
  }

  console.log('\n== the awkward statuses ==\n');

  {
    const { strip } = makeDom(['late_left_early', 'left_early', 'late']);
    app._renderDailyTally.call(app);
    // Three different things, and none of them should be folded into another.
    check('late & left early is its own total', countOf(strip.innerHTML, 'Late &amp; left early') ?? countOf(strip.innerHTML, 'Late & left early'), 1);
    check('left early is its own', countOf(strip.innerHTML, 'Left early'), 1);
    check('late is its own', countOf(strip.innerHTML, 'Late'), 1);
  }

  console.log('\n== it keeps up ==\n');

  {
    const { strip, selects } = makeDom(['present', 'present', '']);
    app._renderDailyTally.call(app);
    check('starts at two present', countOf(strip.innerHTML, 'Present'), 2);

    // A mark being made: the dropdown changes, then the handler runs.
    selects[2].value = 'absent';
    app.onAttendanceStatusChange.call(app, selects[2], false);
    check('marking the last child updates present', countOf(strip.innerHTML, 'Present'), 2);
    check('  and absent', countOf(strip.innerHTML, 'Absent'), 1);
    ok('  and clears the outstanding count', !/not yet marked/.test(strip.innerHTML));

    // A correction, which is the case a running total gets wrong.
    selects[0].value = 'late';
    app.onAttendanceStatusChange.call(app, selects[0], false);
    check('a correction moves the number down', countOf(strip.innerHTML, 'Present'), 1);
    check('  and up on the other side', countOf(strip.innerHTML, 'Late'), 1);
  }

  console.log('\n== legible under any theme ==\n');

  {
    // The portal ships six themes and lets a person override the palette in
    // site_theme_custom, so --accent-2 is whatever somebody picked. On one
    // theme it is a dark olive: "46 Present" rendered as an unreadable smudge
    // while "17 Absent" beside it was perfectly legible, because --danger
    // happened to contrast.
    //
    // --text is the one colour a theme has to keep readable against its own
    // background. The number wears that; the status colour is spent on the
    // border and the icon, neither of which has to be read as a character.
    const { strip } = makeDom(['present', 'absent']);
    app._renderDailyTally.call(app);

    const numbers = [...strip.innerHTML.matchAll(/<strong style="([^"]*)"/g)].map(m => m[1]);
    check('every count is rendered', numbers.length, 2);
    ok('  the number takes the theme text colour',
       numbers.every(st => /color:\s*var\(--text\)/.test(st)));
    // The specific regression: a status variable on the number itself.
    ok('  and never a status colour',
       numbers.every(st => !/--accent-2|--danger|--warning|--success/.test(st)));
    // The colour still has to be somewhere, or the chips stop being scannable.
    ok('the border still carries the status colour',
       /border: 1px solid var\(--accent-2\)/.test(strip.innerHTML));
  }

  console.log('\n== wiring ==\n');

  {
    // A remote change arrives through the same handler, so the strip repaints
    // without the refresh knowing anything about totals.
    const src = html.slice(html.indexOf('async refreshDailyAttendance'));
    const body = src.slice(0, src.indexOf('async saveDailyAttendance'));
    ok('the 20-second refresh routes changes through the handler',
       /onAttendanceStatusChange\(sel, false\)/.test(body));

    const handler = html.slice(html.indexOf('onAttendanceStatusChange(select, save = true)'));
    ok('and the handler repaints the totals',
       /_renderDailyTally\(\)/.test(handler.slice(0, handler.indexOf('\n    // ---- One child'))));

    // Opening the roster has to fill it too, or it reads empty until someone
    // touches something.
    ok('opening the roster fills the strip',
       /showModal\('daily-attendance'[\s\S]{0,400}?_renderDailyTally\(\)/.test(html));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
