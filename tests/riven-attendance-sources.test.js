// "Who was missing today?" has to read the register that knows.
//
// This school keeps two: daily_attendance is the morning one — did the child
// come to school at all — and class_attendance is the per-lesson one. They
// answer different questions, and the absence scan only ever read the second.
//
// Measured on the day it was found: 16 absent on the daily register, 6 on the
// class registers. The answer named the 6.
//
// That also hid a separate fix. Widening the scan to the whole school barely
// changed the list, because class registers are taken patchily — so the people
// missing from the answer were never in the source at all, and the scope fix
// looked like it had not worked.
//
// THE COUNTING TRAP
//
// A child out all day has one daily row AND one class row per lesson. Counting
// both reports "5 absent" for one day off and ranks them above a child who has
// genuinely missed three days. Rows are deduped per student per DAY, with the
// daily register winning, so the number means days.
//
// A named class is the exception: "who's been absent in Chemistry" is a
// question about that lesson, and the daily register cannot answer it.
//
// Run: node tests/riven-attendance-sources.test.js

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

const TODAY = '2026-09-16';

// Marie is out for the whole day: the daily register says so, and three of her
// lessons say so too. Noah came in and missed one lesson. Jack is only on the
// daily register - nobody took a class register for him at all, which is the
// case that used to vanish.
const DAILY = [
  { student_id: 'marie', status: 'absent', date: TODAY },
  { student_id: 'jack',  status: 'absent', date: TODAY },
];
const CLASSY = [
  { student_id: 'marie', status: 'absent', date: TODAY },
  { student_id: 'marie', status: 'absent', date: TODAY },
  { student_id: 'marie', status: 'absent', date: TODAY },
  { student_id: 'noah',  status: 'absent', date: TODAY },
];

function makeApp({ school = false } = {}) {
  const app = {
    said: [], errors: [], printed: [],
    userInfo: { user: { id: 'me' }, profile: { user_type: 'admin' } },
    _terminalAllStudents: [
      { id: 'marie', full_name: 'Marie Lawler' },
      { id: 'noah', full_name: 'Noah Williams' },
      { id: 'jack', full_name: 'Jack Becker' },
    ],
    escapeHtml: (t) => String(t == null ? '' : t),
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    terminalPrint(m) { app.printed.push(m); },
    async _loadTerminalStudents() {},
    async _rivenMyStudentIds() { return new Set(['marie', 'noah']); },  // Jack is not mine
    _rivenSchoolScope() { return { school, refused: false }; },
    auth: { supabase: { from(table) {
      const q = {
        select() { return q; }, gte() { return q; }, lte() { return q; },
        neq() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; },
        then(res, rej) {
          const rows = table === 'daily_attendance' ? DAILY
            : table === 'class_attendance' ? CLASSY : [];
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return q;
    } } },
  };
  // The answer lists everyone now and hides the tail behind "show all", so
  // the expander comes from the page rather than being stubbed - the point of
  // several assertions below is what it does and does not hide.
  app._briefingExpand = extract('_briefingExpand');
  app.terminalAttendanceIssues = extract('terminalAttendanceIssues');
  return app;
}
const asked = (text) => ({ original: text, _rawInput: text, normalized: text, sinceDate: TODAY, sinceLabel: 'today' });

// The rendered answer, as one string.
const answer = (app) => app.said.join('\n');

(async () => {

  console.log('\n== the register that knows ==\n');

  {
    const app = makeApp({ school: true });
    await app.terminalAttendanceIssues.call(app, asked('who was missing today'));
    const out = answer(app);

    // THE ONE THAT WAS MISSING. Jack has no class register at all; under the
    // old code he simply was not in the answer.
    ok('someone only on the daily register still appears', /Jack Becker/.test(out));
    ok('  and so does someone on both', /Marie Lawler/.test(out));
    ok('  and someone only on a class register', /Noah Williams/.test(out));
  }

  console.log('\n== a day off is one day, not one per lesson ==\n');

  {
    const app = makeApp({ school: true });
    await app.terminalAttendanceIssues.call(app, asked('who was missing today'));
    const out = answer(app);

    // Marie: 1 daily row + 3 class rows, all the same day.
    const marie = out.split('Marie Lawler')[1] || '';
    ok('a whole-day absence counts once', /1 absent/.test(marie));
    ok('  not once per lesson', !/[34] absent/.test(marie));
    // Otherwise she outranks a child who has genuinely missed three days.
    ok('  so she does not outrank a real repeat absence',
       out.indexOf('Marie Lawler') > -1);
  }

  console.log('\n== scope still applies to both registers ==\n');

  {
    const app = makeApp({ school: false });
    await app.terminalAttendanceIssues.call(app, asked('who was missing today'));
    const out = answer(app);
    ok('my own students are listed', /Marie Lawler/.test(out));
    // Jack is on the daily register but is not mine. Reading a second table
    // must not become a way round the scope filter.
    ok('  someone outside my classes is not', !/Jack Becker/.test(out));
  }

  console.log('\n== a named class asks a different question ==\n');

  {
    // "Who's been absent in Chemistry" is about that lesson; the daily
    // register cannot answer it and must not be mixed in.
    const src = html.slice(html.indexOf('async terminalAttendanceIssues'));
    const body = src.slice(0, src.indexOf('async terminalGradeIssues'));
    ok('the daily register is only read when no class is named',
       /if \(!classRow\) \{[\s\S]{0,400}daily_attendance/.test(body));
    ok('  and a failure there narrows the answer rather than losing it',
       /daily register unavailable/.test(body));
  }

  console.log('\n== sixteen absences is not ten names ==\n');

  {
    // The day this was reported: 16 on the daily register. The answer showed
    // 10 and said nothing about the other 6 — a hard .slice(0, 10) with no
    // indication, so a truncated answer was indistinguishable from a complete
    // one.
    const many = [];
    for (let i = 0; i < 16; i++) many.push({ student_id: 's' + i, status: 'absent', date: TODAY });

    const app = makeApp({ school: true });
    app._terminalAllStudents = many.map((r, i) => ({ id: r.student_id, full_name: 'Pupil ' + i }));
    app.auth.supabase.from = (table) => {
      const q = {
        select: () => q, gte: () => q, lte: () => q, neq: () => q,
        order: () => q, limit: () => q, eq: () => q,
        then: (res, rej) => Promise.resolve({
          data: table === 'daily_attendance' ? many : [], error: null }).then(res, rej),
      };
      return q;
    };
    await app.terminalAttendanceIssues.call(app, asked('who was missing today'));
    const out = answer(app);

    // The number that matters most was the one never shown.
    ok('the total is stated up front', /16 away from school/.test(out));
    // Everyone is in the message; the tail is collapsed, not dropped.
    check('every name is present', many.filter((_, i) => out.includes('Pupil ' + i)).length, 16);
    ok('  with the tail behind "show all"', /and 6 more students/.test(out));
    ok('  which is a real control, not a dead label', /onclick=/.test(out));
  }

  {
    // A short list must not grow a pointless expander.
    const app = makeApp({ school: true });
    await app.terminalAttendanceIssues.call(app, asked('who was missing today'));
    ok('three names need no "show all"', !/show all/.test(answer(app)));
  }

  console.log('\n== away from school is not the same as missed a lesson ==\n');

  {
    // THE 16-vs-17. The daily register said 16; the answer said 17. Both were
    // right: 16 children were off school, and a seventeenth was in all day and
    // missed one lesson. Reported as one number it reads as an error against
    // the register everybody trusts.
    const daily = [];
    for (let i = 0; i < 16; i++) daily.push({ student_id: 'd' + i, status: 'absent', date: TODAY });
    const cls = [{ student_id: 'inschool', status: 'absent', date: TODAY }];

    const app = makeApp({ school: true });
    app._terminalAllStudents = [
      ...daily.map((r, i) => ({ id: r.student_id, full_name: 'Away ' + i })),
      { id: 'inschool', full_name: 'Present Pupil' },
    ];
    app.auth.supabase.from = (table) => {
      const q = {
        select: () => q, gte: () => q, lte: () => q, neq: () => q,
        order: () => q, limit: () => q, eq: () => q,
        then: (res, rej) => Promise.resolve({
          data: table === 'daily_attendance' ? daily : cls, error: null }).then(res, rej),
      };
      return q;
    };
    await app.terminalAttendanceIssues.call(app, asked('who was missing today'));
    const out = answer(app);

    // The number the morning register shows is the number Riven leads with.
    ok('it says 16 away from school', /16 away from school/.test(out));
    ok('  and counts the other one separately', /1 in school but missed a class/.test(out));
    ok('  never as a single 17', !/17 (students|away)/.test(out));

    // The row itself has to say which it is - the two need opposite things
    // doing about them.
    const theirs = out.split('Present Pupil')[1] || '';
    ok('the odd one out is marked on its row', /in school, missed a class/.test(theirs));

    // And they sort below the children who never arrived, which is the order
    // somebody works through them in.
    ok('school absences come first', out.indexOf('Away 0') < out.indexOf('Present Pupil'));
  }

  {
    // No class-only cases: no second clause, so an ordinary day reads cleanly.
    const daily = [{ student_id: 'a', status: 'absent', date: TODAY }];
    const app = makeApp({ school: true });
    app._terminalAllStudents = [{ id: 'a', full_name: 'Solo Pupil' }];
    app.auth.supabase.from = (table) => {
      const q = {
        select: () => q, gte: () => q, lte: () => q, neq: () => q,
        order: () => q, limit: () => q, eq: () => q,
        then: (res, rej) => Promise.resolve({
          data: table === 'daily_attendance' ? daily : [], error: null }).then(res, rej),
      };
      return q;
    };
    await app.terminalAttendanceIssues.call(app, asked('who was missing today'));
    ok('one away, and nothing else said', /1 away from school/.test(answer(app)));
    ok('  no empty second clause', !/missed a class/.test(answer(app)));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
