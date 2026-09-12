// What happens to a student marked past.
//
// Three things move, and they move differently on purpose:
//
//   * CLASSES ARE ARCHIVED, NOT DELETED. Grades and attendance hang off the
//     enrolment row. Deleting it would take the transcript with it.
//   * THE TIMETABLE IS DELETED. student_schedule says which weekdays a student
//     is EXPECTED — a statement about the future, not a record of the past. The
//     daily register is built from it, so leaving those rows behind puts a
//     child who left in October on every morning's register for the rest of the
//     year, waiting to be marked absent.
//   * ACTIVITIES GO INACTIVE. Unlike a timetable, being on the team that season
//     is a record.
//
// The register also filters past students itself. That is belt and braces: if
// marking past works, no past student has a timetable row to be found by. It is
// there for the leftover — a bulk import, a half-finished withdrawal — because
// the cost of being wrong is a child's name on a register after they have left.
//
// Run: node tests/past-student-withdrawal.test.js

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
  const re = new RegExp('\\n      (?:async\\s+)?' + name + '\\s*\\(', 'g');
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
  const Ctor = Object.getPrototypeOf(async function () {}).constructor;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// ---- the register never lists someone who has left ----------------------
console.log('\n== the daily register ==\n');

const roster = html.slice(html.indexOf('    async showDailyAttendanceRoster('),
                          html.indexOf('        // Cohort membership for the roster'));
ok('the roster was located', roster.length > 400);
ok('it reads the timetable for the day', /from\('student_schedule'\)/.test(roster));
ok('and then filters past students out',
  /\.or\('student_status\.is\.null,student_status\.neq\.past'\)/.test(roster));
// `.neq('student_status','past')` drops every row that never set the column,
// because SQL comparison against NULL is NULL, not true. That would empty the
// register for a school that has never marked anyone past.
check('not with .neq, which would drop unset rows',
  /\.neq\('student_status', *'past'\)/.test(roster), false);

// ---- what the admin is told ---------------------------------------------
console.log('\n== marking a student past ==\n');

const mark = html.slice(html.indexOf('      async markStudentAsPast('),
                        html.indexOf('      copyParentLinkCode('));
ok('it goes through the database function', /rpc\('mark_student_as_past'/.test(mark));
ok('  passing the leaving date and reason', /p_left_date/.test(mark) && /p_left_reason/.test(mark));
ok('  and reads back what moved', /classes_archived/.test(mark) && /days_removed/.test(mark));

function run(data) {
  const app = {
    notices: [],
    showNotification(m, k) { this.notices.push({ m, k }); },
    async renderAdminStudentRecords() {},
    auth: { supabase: { rpc: async () => ({ data, error: null }) } },
  };
  global.document = { getElementById: () => ({ value: '2026-09-11', remove() {} }) };
  app.markStudentAsPast = extract('markStudentAsPast');
  return app.markStudentAsPast.call(app, 'stu-1').then(() => app.notices.map(n => n.m).join(' | '));
}

(async () => {
  const full = await run({ success: true, pin: '4821', classes_archived: 6, days_removed: 2, activities_ended: 1 });
  ok('it names the classes archived', /6 classes archived/.test(full));
  ok('  the attending days cleared', /2 attending days cleared/.test(full));
  ok('  the activities ended', /1 activity ended/.test(full));
  ok('  and says the records were kept', /Grades and attendance kept/.test(full));
  ok('  passing on a new games PIN', /4821/.test(full));

  const one = await run({ success: true, classes_archived: 1, days_removed: 1, activities_ended: 0 });
  ok('one of each reads as singular', /1 class archived/.test(one) && /1 attending day cleared/.test(one));
  check('  and nothing is said about zero activities', /activit/.test(one), false);

  const none = await run({ success: true });
  ok('a student with nothing to clear still reports cleanly', /marked as past/i.test(none));
  ok('  and still says the records are kept', /Grades and attendance kept/.test(none));
  check('  without an empty list', /\. \. /.test(none), false);

  // ---- the shape of the function itself ---------------------------------
  console.log('\n== and the rule the function has to keep ==\n');

  const sqlPath = path.join(__dirname, '..', '..', 'student-portal-backend', 'supabase', 'migrations',
    'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_past_student_leaves_the_timetable.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    ok('enrolments are archived, never deleted',
      /UPDATE public\.class_enrollments\s*\n\s*SET status = 'archived'/.test(sql)
      && !/DELETE FROM public\.class_enrollments/.test(sql));
    ok('the timetable is deleted', /DELETE FROM public\.student_schedule/.test(sql));
    ok('activities are stood down, not deleted',
      /UPDATE public\.activity_enrollments/.test(sql) && !/DELETE FROM public\.activity_enrollments/.test(sql));
    ok('nothing touches the attendance records',
      !/daily_attendance|class_attendance/.test(sql.replace(/^\s*--.*$/gm, '')));
    ok('a future planned absence is dropped', /DELETE FROM public\.planned_absences/.test(sql));
  } else {
    console.log('skip  the backend repo is not checked out beside this one');
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
