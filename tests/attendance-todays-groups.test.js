// The daily roster's two cohort pickers.
//
// There used to be one, listing every cohort in the school on every day, so a
// teacher taking Tuesday's register read past the Monday and Thursday groups
// to reach the two that meet today. It is now split: Today's Groups is the
// short list, All Groups sits beside it for reaching a cohort with nobody in
// today.
//
// What "today" can mean here is fixed by the data: student_groups has a name
// and members and no day of its own, so the only honest test of relevance is
// whether the cohort has anyone on the roster already on screen - which is
// built from student_schedule for this weekday. Two consequences worth
// stating, because both fail quietly:
//
//   * FULL-TIME STUDENTS ARE IN. They are scheduled every day, so a cohort
//     holding them is relevant every day. Deriving "today" from homeschool
//     scheduling alone would drop the students who are there every time the
//     roster is opened.
//
//   * THE COUNT IS OF ROWS, NOT OF MEMBERS. Both lists count students on THIS
//     roster, so the number always says how many rows the choice will leave
//     showing. An All Groups entry reading (0) is correct and useful: picking
//     it empties the roster, and the number said so first.
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

const GROUPS = [
  { id: 'g-jh', name: 'Junior High' },
  { id: 'g-choir', name: 'Choir' },
  { id: 'g-mon', name: 'Monday Robotics' },
  { id: 'g-empty', name: 'Nobody' },
];

// Who is on the roster is decided before this runs: it is today's scheduled
// students, full-time and homeschool alike.
const MEMBERS = {
  ann: ['g-jh'],               // full-time, in today every day
  ben: ['g-jh', 'g-choir'],    // homeschool, in today
  cal: [],                     // in no cohort at all
  dee: ['g-choir'],            // homeschool, in today
  eve: ['g-mon'],              // homeschool, NOT scheduled today
};

const roster = (...ids) => ids.map(id => ({ id }));
const run = (...ids) => cohortsForRoster(roster(...ids), GROUPS, MEMBERS);
const names = list => list.map(g => `${g.name} (${g.n})`);

console.log('\n== today is derived from who is on the roster ==\n');

let r = run('ann', 'ben', 'cal', 'dee');
check('all lists every cohort in the school',
  names(r.all), ['Junior High (2)', 'Choir (2)', 'Monday Robotics (0)', 'Nobody (0)']);
check('today lists only the ones with someone on the roster',
  names(r.today), ['Junior High (2)', 'Choir (2)']);
ok('and the Monday cohort is still reachable from the full list',
  r.all.some(g => g.id === 'g-mon'));

// eve is a member of Monday Robotics but is not on today's roster, so the
// cohort is still absent from today's list - membership alone is not presence.
r = run('ann', 'ben');
check('a cohort whose members are not scheduled today is left out',
  names(r.today), ['Junior High (2)', 'Choir (1)']);

console.log('\n== full-time students count as relevant today ==\n');

// The roster on a day only one full-time student attends. Junior High must be
// in today's list on the strength of that student alone.
r = run('ann');
check('a cohort held up by a full-time student is in today', names(r.today), ['Junior High (1)']);
check('  and nothing else is', r.today.length, 1);

// Deriving "today" from homeschool students alone would produce this instead,
// which is the bug the test above exists to catch.
ok('the full-time student is not skipped when counting',
  r.all.find(g => g.id === 'g-jh').n === 1);

console.log('\n== the counts describe the roster, not the group ==\n');

r = run('ann', 'ben', 'cal', 'dee');
check('a cohort nobody on the roster is in reads zero',
  r.all.find(g => g.id === 'g-empty').n, 0);
check('a student in two cohorts is counted in both',
  [r.all.find(g => g.id === 'g-jh').n, r.all.find(g => g.id === 'g-choir').n], [2, 2]);
check('a student in no cohort inflates nothing',
  r.all.reduce((t, g) => t + g.n, 0), 4);
check('order follows the group list, which arrives sorted by name',
  r.all.map(g => g.id), ['g-jh', 'g-choir', 'g-mon', 'g-empty']);

console.log('\n== nothing to show does not throw ==\n');

check('an empty roster leaves today empty', names(run().today), []);
check('  but still lists the cohorts', run().all.length, 4);
check('no cohorts at all', cohortsForRoster(roster('ann'), [], MEMBERS), { all: [], today: [] });
check('a missing group list', cohortsForRoster(roster('ann'), null, MEMBERS), { all: [], today: [] });
check('a missing membership index',
  names(cohortsForRoster(roster('ann'), GROUPS, null).today), []);
check('a missing roster', names(cohortsForRoster(null, GROUPS, MEMBERS).today), []);

console.log('\n== the page wires both pickers up ==\n');

ok('today\'s picker exists', /id="daily-attendance-group-today"/.test(html));
ok('the all-groups picker exists', /id="daily-attendance-group-all"/.test(html));
ok('today\'s picker routes through setAttendanceGroup',
  /id="daily-attendance-group-today"[\s\S]{0,240}setAttendanceGroup\('daily-attendance', 'today'\)/.test(html));
ok('the all-groups picker routes through setAttendanceGroup',
  /id="daily-attendance-group-all"[\s\S]{0,240}setAttendanceGroup\('daily-attendance', 'all'\)/.test(html));
ok('the old single picker is gone', !/id="daily-attendance-group"/.test(html));

// An empty today list must say so rather than presenting a picker that looks
// broken when opened.
ok('today\'s picker disables itself when nothing meets today',
  /todaysGroups\.length \? '' : 'disabled'/.test(html));
ok('  and says why in its label', /No groups today/.test(html));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
