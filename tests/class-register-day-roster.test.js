// The class register shows who is actually in that day.
//
// A class roster is an ENROLMENT list. It says who takes the subject; it says
// nothing about which days they come in. That is student_schedule - the same
// timetable the morning register reads, and the thing the Attendance Schedule
// screen means when it says "attendance can only be marked on scheduled days".
//
// So a Tuesday/Thursday child sat on a Monday register every week, and the only
// mark that fits them, absent, is false and then feeds the attendance reports.
//
// WHY THIS IS NOT JUST A FILTER
//
// Two kinds of student would lose a record if the filter were applied plainly,
// and one of them loses it silently:
//
//   * A MARK THAT ALREADY EXISTS. Timetables change and children turn up on
//     days they are not down for; 31 marks this school year sit on an
//     off-timetable day. saveClassAttendance DELETES every row for the
//     class/date/period and re-inserts what the page is showing - so a hidden
//     student is not merely invisible, their existing mark is destroyed by the
//     next save anybody makes. That is the assertion that matters most here.
//   * A CHILD WITH NO TIMETABLE AT ALL. Five active students have none. That is
//     a gap in the office's records, not a child who stays home, and hiding
//     them is how somebody goes unmarked for a term.
//
// Both are shown under the register, labelled with which case they are.
//
// Run: node tests/class-register-day-roster.test.js

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

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Monday 2026-09-14. Every "is this student in today" question below is asked
// against it, and Monday is day 1.
const MONDAY = '2026-09-14';

const STUDENTS = [
  { id: 'mon', first_name: 'Mona', last_name: 'Day', grade_level: '7' },        // Mon/Wed
  { id: 'tue', first_name: 'Tess', last_name: 'Day', grade_level: '8' },        // Tue/Thu
  { id: 'none', first_name: 'Nils', last_name: 'Unset', grade_level: '9' },     // no timetable
  { id: 'marked', first_name: 'Mark', last_name: 'Already', grade_level: '9' }, // Tue/Thu, has a mark
];

const SCHEDULE = [
  { student_id: 'mon', day_of_week: 1 },
  { student_id: 'mon', day_of_week: 3 },
  { student_id: 'tue', day_of_week: 2 },
  { student_id: 'tue', day_of_week: 4 },
  { student_id: 'marked', day_of_week: 2 },
];

// Builds the one query stub showClassAttendance talks to. Each table answers
// with what that table would hold; the shape is a thenable so `await` on the
// chain works the way PostgREST's does.
function supabaseStub({ students = STUDENTS, schedule = SCHEDULE, marks = [], meets = true }) {
  const rowsFor = (table) => {
    if (table === 'class_schedule') return meets ? [{ class_id: 'c1', day_of_week: 1, period: 1 }] : [];
    if (table === 'class_enrollments') return students.map(s => ({ student_id: s.id }));
    if (table === 'user_profiles') return students;
    if (table === 'student_schedule') return schedule;
    if (table === 'class_attendance_sessions') return [];
    if (table === 'class_attendance') return marks;
    return [];
  };
  return {
    from(table) {
      const q = {
        select() { return q; },
        eq() { return q; },
        in() { return q; },
        is() { return q; },
        or() { return q; },
        order() { return q; },
        then(res, rej) {
          return Promise.resolve({ data: rowsFor(table), error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

async function register(opts = {}) {
  let captured = '';
  const app = {
    classes: [{ id: 'c1', name: 'Latin' }],
    userInfo: { user: { id: 'teacher-1' } },
    escapeHtml: esc,
    jsAttr: (t) => String(t == null ? '' : t).replace(/'/g, "\\'"),
    _localDateStr: (d) => d.toISOString().slice(0, 10),
    dailyStatusChip: () => '',
    showLoading() {},
    closeModal() {},
    showNotification() {},
    showModal(id, title, content) { captured = content; },
    // The day's roll-up is a nicety; it must never decide the roster.
    _pickupRpc: async () => [],
    auth: { supabase: supabaseStub(opts) },
  };
  app._classAttendanceRowHtml = extract('_classAttendanceRowHtml');
  app.showClassAttendance = extract('showClassAttendance');

  global.document = { getElementById: () => null };
  await app.showClassAttendance.call(app, 'c1', opts.date || MONDAY, null);
  return captured;
}

// Which student ids ended up in each list. The second list is its own container
// precisely so the two can be told apart.
function lists(out) {
  const cut = out.indexOf('class-attendance-extra-rows');
  const main = cut === -1 ? out : out.slice(0, cut);
  const extra = cut === -1 ? '' : out.slice(cut);
  const ids = (s) => [...s.matchAll(/data-student-id="([^"]+)"/g)].map(m => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
  return { main: ids(main), extra: ids(extra) };
}

(async () => {

  console.log('\n== only who is in on the day ==\n');

  {
    const out = await register({});
    const { main, extra } = lists(out);

    check('the register holds the student who attends Mondays', main, ['mon']);
    ok('  and not the Tuesday/Thursday one', !main.includes('tue'));
    // Four are enrolled. Two are on the page: the Monday student, and the one
    // whose attending days were never set.
    ok('the count is the roster, not the enrolment list', /">2 students</.test(out));
  }

  {
    // The one that destroys data if it goes wrong. saveClassAttendance deletes
    // every row for this class/date/period and re-inserts what is on screen, so
    // a student hidden with a mark against them does not just disappear from
    // view - the next save wipes the mark.
    const out = await register({
      marks: [{ student_id: 'marked', status: 'present', notes: 'came in for the test' }],
    });
    const { main, extra } = lists(out);

    ok('a student with a mark is still on the page', main.concat(extra).includes('marked'));
    check('  below the register, not in it', extra.includes('marked'), true);
    ok('  with the mark still on the row', /value="present"/.test(out));
    ok('  and the note it carried', /came in for the test/.test(out));
    ok('  said to be off the timetable', /not down for Monday/.test(out));
  }

  {
    const out = await register({});
    const { extra } = lists(out);
    check('a student with no attending days set is shown too', extra.includes('none'), true);
    ok('  and named as a records gap, not a day off', /no attending days set/.test(out));
    ok('the section says why anyone is in it',
      /already a mark against them today, or because nobody/.test(out));
  }

  {
    // Nobody in the second list, nothing to explain.
    const out = await register({
      students: [STUDENTS[0], STUDENTS[1]],
      schedule: [{ student_id: 'mon', day_of_week: 1 }, { student_id: 'tue', day_of_week: 2 }],
    });
    ok('with nothing to explain the section is absent', !/Not on today's timetable/.test(out));
    check('and the register is just the Monday student', lists(out).main, ['mon']);
  }

  console.log('\n== a day with nobody in ==\n');

  {
    const out = await register({
      students: [STUDENTS[1]],
      schedule: [{ student_id: 'tue', day_of_week: 2 }],
    });
    ok('it says nobody on the roster attends that day', /Nobody on this roster attends on Monday/.test(out));
    // "No students enrolled" would send a teacher to the enrolment screen to
    // fix something that is not broken.
    ok('  not that the class is empty', !/No students enrolled/.test(out));
    ok('  and counts who is enrolled, for context', /1 enrolled/.test(out));
    ok('there is nothing to save', !/Save Attendance/.test(out));
  }

  {
    const out = await register({ students: [], schedule: [] });
    ok('an actually empty class still says so', /No students enrolled/.test(out));
  }

  {
    const out = await register({ meets: false });
    ok('a class that does not meet that day says that instead',
      /does not meet on Monday/i.test(out));
  }

  console.log('\n== the two lists stay in step ==\n');

  {
    const out = await register({
      marks: [{ student_id: 'marked', status: 'late' }],
    });
    // One template builds both, so a mark control added to one cannot go
    // missing from the other.
    const controls = (out.match(/class-attendance-status/g) || []).length;
    check('every row on the page carries a mark field', controls, 3);
    const notes = (out.match(/class-attendance-notes/g) || []).length;
    check('  and a notes field', notes, 3);
    ok('an extra mark shows on its chip in the second list', /selected>⏰ Late/.test(out));
  }

  {
    const src = html.slice(html.indexOf('filterAttendanceRoster('));
    ok('the search box reaches the second list too',
      /extra-rows/.test(src.slice(0, 2000)));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
