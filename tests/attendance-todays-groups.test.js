// The daily roster's cohort picker.
//
// It used to list every cohort in the school on every day, so a teacher taking
// Tuesday's register read past the Monday and Thursday groups to reach the two
// that meet today. It now lists only today's, and it is the one filter left
// beside the search box.
//
// "Today" is decided by student_groups.meets_days, the weekdays a cohort was
// told it meets. Friday Art is in Friday's list and absent from Thursday's,
// however many of its students are in the building on Thursday.
//
// That column exists because membership cannot answer the question. The first
// version of this list inferred "today" from whether any member was on today's
// roster, and full-time students are scheduled every weekday, so every cohort
// holding one passed on every day - the list showed everything, which is what
// it was built to stop. That inference survives only as the fallback for a
// cohort whose days have never been set, so an untagged cohort stays reachable
// instead of vanishing.
//
// Also guarded here: THE COUNT IS OF ROWS, NOT OF MEMBERS. Both lists count
// students on THIS roster, so the number always says how many rows the choice
// will leave showing. An entry reading (0) is correct and useful: picking it
// empties the roster, and the number said so first.
//
// Run: node tests/attendance-todays-groups.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- extract the real method -------------------------------------------
function method(name, indent = '    ') {
  const sig = `\n${indent}${name}(`;
  const start = html.indexOf(sig);
  if (start === -1) throw new Error(name + ' not found');
  const end = html.indexOf(`\n${indent}}\n`, start);
  if (end === -1) throw new Error(name + ' unterminated');
  const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
  return eval(`(function ${body.slice(name.length)})`);
}

const cohortsForRoster = method('_cohortsForRoster');

const MON = 1, TUE = 2, THU = 4, FRI = 5;

const GROUPS = [
  { id: 'g-jh', name: 'Junior High', meets_days: [MON, THU] },
  { id: 'g-choir', name: 'Choir', meets_days: [THU] },
  { id: 'g-art', name: 'Friday Art', meets_days: [FRI] },
  { id: 'g-untagged', name: 'Untagged Cohort' },
];

const MEMBERS = {
  ann: ['g-jh', 'g-art', 'g-untagged'],  // full-time: on the roster every day
  ben: ['g-jh', 'g-choir'],
  cal: [],
  dee: ['g-choir', 'g-art'],
};

const roster = (...ids) => ids.map(id => ({ id }));
const EVERYONE = roster('ann', 'ben', 'cal', 'dee');
const on = (day, students = EVERYONE, groups = GROUPS) =>
  cohortsForRoster(students, groups, MEMBERS, day);
const names = list => list.map(g => `${g.name} (${g.n})`);

console.log('\n== the day a cohort meets decides the list ==\n');

let r = on(THU);
check('Thursday shows Thursday cohorts', names(r.today).sort(),
  ['Choir (2)', 'Junior High (2)', 'Untagged Cohort (1)']);
check("  and not Friday's", r.today.some(g => g.id === 'g-art'), false);

r = on(FRI);
check('Friday shows the Friday cohort', r.today.some(g => g.id === 'g-art'), true);
check('  and drops the Thursday-only one', r.today.some(g => g.id === 'g-choir'), false);

r = on(MON);
check('a cohort meeting twice a week appears on both days',
  r.today.some(g => g.id === 'g-jh'), true);
check('Tuesday has only the untagged cohort', names(on(TUE).today), ['Untagged Cohort (1)']);

check('every cohort stays in the full list whatever the day',
  on(TUE).all.map(g => g.id), ['g-jh', 'g-choir', 'g-art', 'g-untagged']);

console.log('\n== a full-time student no longer drags a cohort into every day ==\n');

// ann is full-time and in Friday Art, so she is on Thursday's roster and the
// cohort has a member present. Under the old rule that alone put Friday Art in
// Thursday's list. The day now overrules it.
check('ann is on Thursday\'s roster', on(THU).all.find(g => g.id === 'g-art').n > 0, true);
check('  and Friday Art is still absent from Thursday', on(THU).today.some(g => g.id === 'g-art'), false);

// The same cohort on a day nobody is in: the day still decides, so it shows
// with a count of zero rather than being hidden.
check('a tagged cohort shows on its day even with nobody in',
  names(on(FRI, roster('cal')).today), ['Friday Art (0)']);

console.log('\n== an untagged cohort falls back to who is in ==\n');

check('untagged with a member present shows', on(TUE, roster('ann')).today.map(g => g.id), ['g-untagged']);
check('untagged with nobody present does not', on(TUE, roster('cal')).today, []);
check('an empty days array is treated as untagged, not as "no day"',
  cohortsForRoster(roster('ann'), [{ id: 'g-e', name: 'E', meets_days: [] }], { ann: ['g-e'] }, THU).today.length, 1);
check('a null days column is treated as untagged',
  cohortsForRoster(roster('ann'), [{ id: 'g-n', name: 'N', meets_days: null }], { ann: ['g-n'] }, THU).today.length, 1);

console.log('\n== the counts describe the roster, not the group ==\n');

r = on(THU);
check('a student in two of the day\'s cohorts is counted in both',
  [r.all.find(g => g.id === 'g-jh').n, r.all.find(g => g.id === 'g-choir').n], [2, 2]);
check('a student in no cohort inflates nothing',
  r.all.find(g => g.id === 'g-untagged').n, 1);
check('order follows the group list, which arrives sorted by name',
  r.all.map(g => g.id), ['g-jh', 'g-choir', 'g-art', 'g-untagged']);

console.log('\n== nothing to show does not throw ==\n');

check('an empty roster still lists tagged cohorts for the day',
  names(on(THU, []).today).sort(), ['Choir (0)', 'Junior High (0)']);
check('no cohorts at all', cohortsForRoster(roster('ann'), [], MEMBERS, THU), { all: [], today: [] });
check('a missing group list', cohortsForRoster(roster('ann'), null, MEMBERS, THU), { all: [], today: [] });
check('a missing membership index',
  cohortsForRoster(roster('ann'), GROUPS, null, TUE).today.length, 0);
check('a missing roster', cohortsForRoster(null, GROUPS, MEMBERS, THU).today.length, 2);
check('a day nobody meets on', cohortsForRoster(EVERYONE, GROUPS.slice(0, 3), MEMBERS, 3).today, []);
check('an unusable day leaves only the fallback',
  cohortsForRoster(roster('ann'), GROUPS, MEMBERS, undefined).today.map(g => g.id), ['g-untagged']);

console.log('\n== the page wires the picker up ==\n');

ok("today's picker exists", /id="daily-attendance-group-today"/.test(html));
ok('  and runs the roster filter', /id="daily-attendance-group-today"[\s\S]{0,240}filterAttendanceRoster\('daily-attendance'\)/.test(html));

// Both of the other filters that shared that bar were taken off the screen:
// every student on this roster is scheduled for today whatever their enrolment,
// and a cohort that does not meet today has no business being filtered to on
// today's register.
ok('the all-groups picker is gone', !/daily-attendance-group-all/.test(html));
ok('the enrolment buttons are gone', !/daily-attendance-enrollment/.test(html));
ok('  and nothing is left calling their handler', !/setAttendanceEnrollment/.test(html));
ok('the prev/next day buttons are gone', !/changeAttendanceDate/.test(html));
ok('  but the date field still moves the roster',
  /id="attendance-date"[\s\S]{0,200}showDailyAttendanceRoster\(this\.value\)/.test(html));
ok('and the search box stays', /id="daily-attendance-search"/.test(html));

// The days are worthless if nothing reads or writes them.
ok('the group load asks for meets_days', /select\('id, name, meets_days'\)/.test(html));
ok('  and survives a database that has not got the column yet',
  /meets_days/i.test(html) && /select\('id, name'\)\.order\('name'\)/.test(html));
ok('the groups screen can set the days', /setStudentGroupDays/.test(html));
ok('  writing them to the column', /meets_days: days\.length \? days : null/.test(html));
ok('  and offers one checkbox per school day',
  /\[\[1,'M'\],\[2,'Tu'\],\[3,'W'\],\[4,'Th'\],\[5,'F'\]\]/.test(html));

// An empty today list must say so rather than presenting a picker that looks
// broken when opened.
ok('today\'s picker disables itself when nothing meets today',
  /todaysGroups\.length \? '' : 'disabled'/.test(html));
ok('  and says why in its label', /No groups today/.test(html));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
