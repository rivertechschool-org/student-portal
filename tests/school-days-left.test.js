// The "days of school left" counter above the dashboard calendar.
//
// The count has to agree with the school year as it is actually published, so
// this runs the real methods out of index.html against the real 2026-27 rows
// (quarters and the holiday events, copied from the database) and checks them
// against three numbers worked out independently from the calendar:
//
//     199 weekdays  -  30 closure weekdays  =  169 school days
//
// If a break is mis-expanded, a weekend is counted, or an end date is read
// exclusively, at least one of those three stops matching.
//
// It also pins the two things that were asked for explicitly: today counts as a
// day left when it is a school day, and the last day of the year counts.
//
// Run: node tests/school-days-left.test.js

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const lines = SRC.split('\n');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- pull the real methods out of the page ----------------------------------
// They are class methods at twelve spaces; method shorthand is also valid inside
// an object literal, so they can be lifted verbatim rather than restated.
function methodSource(name) {
  const head = new RegExp('^ {12}(?:async )?' + name + '\\(');
  const at = lines.findIndex(l => head.test(l));
  if (at === -1) throw new Error('method not found: ' + name);
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i] === '            }') return lines.slice(at, i + 1).join('\n');
  }
  throw new Error('method unterminated: ' + name);
}

const NAMES = ['countSchoolDays', 'dateKey', 'expandNoSchoolDates', 'resolveSchoolYearSpan',
  'schoolYearCountdown', 'pickSchoolYearStart', 'renderSchoolCountdown', 'escapeHtml', 'localTodayStr'];
const portal = new Function('return {\n' + NAMES.map(methodSource).join(',\n') + '\n};')();

// ---- the real 2026-27 rows ---------------------------------------------------
const QUARTERS = [
  { name: 'Quarter 1', start_date: '2026-09-01', end_date: '2026-10-30', school_year: '2026-2027', is_current: true },
  { name: 'Quarter 2', start_date: '2026-11-02', end_date: '2027-01-15', school_year: '2026-2027', is_current: false },
  { name: 'Quarter 3', start_date: '2027-01-18', end_date: '2027-03-25', school_year: '2026-2027', is_current: false },
  { name: 'Quarter 4', start_date: '2027-04-05', end_date: '2027-06-04', school_year: '2026-2027', is_current: false },
];
const CLOSURES = [
  { title: 'Labor Day',            event_type: 'holiday', start_date: '2026-09-07', end_date: null },
  { title: 'Veterans Day',         event_type: 'holiday', start_date: '2026-11-11', end_date: null },
  { title: 'Thanksgiving Break',   event_type: 'holiday', start_date: '2026-11-21', end_date: '2026-11-29' },
  { title: 'Christmas Break',      event_type: 'holiday', start_date: '2026-12-19', end_date: '2027-01-03' },
  { title: 'MLK Day',              event_type: 'holiday', start_date: '2027-01-18', end_date: null },
  { title: 'Winter Break',         event_type: 'holiday', start_date: '2027-02-13', end_date: '2027-02-21' },
  { title: 'Easter / Spring Break',event_type: 'holiday', start_date: '2027-03-26', end_date: '2027-04-03' },
  { title: 'Memorial Day',         event_type: 'holiday', start_date: '2027-05-31', end_date: null },
];
const YEAR_START = '2026-09-01', YEAR_END = '2027-06-04';
const noSchool = portal.expandNoSchoolDates(CLOSURES);

// ---------------------------------------------------------------- 1. the year adds up
{
  check('weekdays in the year', portal.countSchoolDays(YEAR_START, YEAR_END, new Set()), 199);

  const closureWeekdays = [...noSchool].filter(s => {
    if (s < YEAR_START || s > YEAR_END) return false;
    const dow = new Date(s + 'T12:00:00').getDay();
    return dow !== 0 && dow !== 6;
  }).length;
  check('closure weekdays in the year', closureWeekdays, 30);

  check('school days in the year', portal.countSchoolDays(YEAR_START, YEAR_END, noSchool), 199 - 30);
}

// ---------------------------------------------------------------- 2. each break costs the right days
{
  const cost = ev => {
    const s = portal.expandNoSchoolDates([ev]);
    return [...s].filter(x => { const g = new Date(x + 'T12:00:00').getDay(); return g !== 0 && g !== 6; }).length;
  };
  const expected = {
    'Labor Day': 1, 'Veterans Day': 1, 'Thanksgiving Break': 5, 'Christmas Break': 10,
    'MLK Day': 1, 'Winter Break': 5, 'Easter / Spring Break': 6, 'Memorial Day': 1,
  };
  for (const ev of CLOSURES) check(`"${ev.title}" removes the right number of weekdays`, cost(ev), expected[ev.title]);

  // A break that starts on a Saturday must not cost a day for that Saturday.
  check('Thanksgiving break spans 9 calendar days', portal.expandNoSchoolDates([CLOSURES[2]]).size, 9);
}

// ---------------------------------------------------------------- 3. today and the last day are included
{
  const on = todayStr => portal.schoolYearCountdown(todayStr, QUARTERS, CLOSURES);

  const firstDay = on('2026-09-01');
  check('on the first day, the whole year is still left', firstDay.left, 169);
  check('...and nothing is done yet', firstDay.done, 0);
  ok('...and the first day is a school day', firstDay.todayIsSchoolDay);

  const lastDay = on('2027-06-04');
  check('THE LAST DAY COUNTS: one day left on the last day', lastDay.left, 1);
  check('...with the rest done', lastDay.done, 168);

  const dayAfter = on('2027-06-05');
  check('the day after the last day is zero', dayAfter.left, 0);
  check('...and the year reads as over', dayAfter.state, 'ended');

  // TODAY COUNTS: a school day is one of the days still left, so tomorrow is
  // always exactly one fewer.
  const thu = on('2026-09-10'), fri = on('2026-09-11');
  ok('Thursday is a school day', thu.todayIsSchoolDay);
  check('today is included in the days left', thu.left - fri.left, 1);

  // Left + done is the whole year on any day inside it.
  for (const day of ['2026-09-01', '2026-10-15', '2027-01-20', '2027-06-04']) {
    const c = on(day);
    check(`${day}: left + done = the year`, c.left + c.done, c.total);
  }
}

// ---------------------------------------------------------------- 4. days that are not school days
{
  const on = todayStr => portal.schoolYearCountdown(todayStr, QUARTERS, CLOSURES);

  // A weekend does not count itself, and does not change what is left.
  const fri = on('2026-09-11'), sat = on('2026-09-12'), sun = on('2026-09-13'), mon = on('2026-09-14');
  ok('Saturday is not a school day', !sat.todayIsSchoolDay);
  ok('Sunday is not a school day', !sun.todayIsSchoolDay);
  check('the weekend leaves Monday\'s count unchanged', [sat.left, sun.left, mon.left], [mon.left, mon.left, mon.left]);
  check('Friday has exactly one more left than Monday', fri.left - mon.left, 1);

  // A holiday does not count itself either.
  const labor = on('2026-09-07');
  ok('Labor Day is not a school day', !labor.todayIsSchoolDay);
  check('Labor Day leaves the same count as the Tuesday after', labor.left, on('2026-09-08').left);

  // Mid-break.
  const xmas = on('2026-12-25');
  ok('Christmas Day is not a school day', !xmas.todayIsSchoolDay);

  // Before the year opens, the whole year is ahead.
  const august = on('2026-08-15');
  check('before the year starts, everything is left', august.left, 169);
  check('...and the state says so', august.state, 'not-started');
  ok('...and today is not a school day', !august.todayIsSchoolDay);
}

// ---------------------------------------------------------------- 5. which events close the school
{
  // The calendar shades a cell as no-school for holiday and closure only; a half
  // day is still a day of school. The counter must use the same rule.
  const kinds = [
    { event_type: 'holiday', start_date: '2026-09-08', end_date: null },
    { event_type: 'closure', start_date: '2026-09-09', end_date: null },
    { event_type: 'half_day', start_date: '2026-09-10', end_date: null },
    { event_type: 'event', start_date: '2026-09-11', end_date: null },
  ];
  const s = portal.expandNoSchoolDates(kinds);
  ok('a holiday closes the school', s.has('2026-09-08'));
  ok('a closure closes the school', s.has('2026-09-09'));
  ok('a half day is still a day of school', !s.has('2026-09-10'));
  ok('an ordinary event is still a day of school', !s.has('2026-09-11'));
}

// ---------------------------------------------------------------- 6. bad data must not hang or lie
{
  // school_events has no constraints, so these rows are all possible.
  const started = Date.now();
  const junk = [
    { event_type: 'holiday', start_date: '2027-01-10', end_date: '2026-01-10' },  // end before start
    { event_type: 'holiday', start_date: 'not-a-date', end_date: null },
    { event_type: 'holiday', start_date: '2026-10-01', end_date: '2099-01-01' },  // absurd span
    { event_type: 'holiday', start_date: null, end_date: null },
    null,
  ];
  const s = portal.expandNoSchoolDates(junk);
  ok('expanding junk rows finishes quickly', Date.now() - started < 2000);
  ok('an end date before the start keeps just the start day', s.has('2027-01-10'));
  ok('a runaway span is bounded', s.size < 1000);

  const t0 = Date.now();
  check('counting with a reversed range is zero', portal.countSchoolDays('2027-06-04', '2026-09-01', noSchool), 0);
  check('counting with a missing date is zero', portal.countSchoolDays(null, '2026-09-01', noSchool), 0);
  check('counting with an unparseable date is zero', portal.countSchoolDays('rubbish', 'also-rubbish', noSchool), 0);
  ok('the guards return immediately', Date.now() - t0 < 1000);
}

// ---------------------------------------------------------------- 7. when the dates are unknown, say nothing
{
  check('no quarters at all', portal.schoolYearCountdown('2026-09-15', [], CLOSURES), null);
  check('null quarters', portal.schoolYearCountdown('2026-09-15', null, CLOSURES), null);
  check('quarters with no end dates', portal.schoolYearCountdown('2026-09-15',
    [{ start_date: '2026-09-01', end_date: null, school_year: '2026-2027' }], CLOSURES).total, 1);

  // A year that cannot be resolved renders nothing rather than a guess.
  const blank = Object.create(portal); blank.schoolDaysLeft = null;
  check('no card when the year is unknown', blank.renderSchoolCountdown(), '');
}

// ---------------------------------------------------------------- 8. what the card says
{
  const card = state => {
    const v = Object.create(portal);
    v.schoolDaysLeft = portal.schoolYearCountdown(state, QUARTERS, CLOSURES);
    return v.renderSchoolCountdown();
  };

  const midYear = card('2026-09-15');
  ok('the card shows the number left', /<div[^>]*>160<\/div>/.test(midYear));
  ok('the card names the last day', /Last day/.test(midYear) && /Jun/.test(midYear));
  ok('the card shows progress out of the year', /9 of 169 done/.test(midYear));
  ok('the card says today counts on a school day', /today counts/.test(midYear));
  ok('the progress bar is a real progressbar', /role="progressbar"/.test(midYear) && /aria-valuemax="169"/.test(midYear));

  const weekend = card('2026-09-12');
  ok('the card says there is no school today on a weekend', /no school today/.test(weekend));

  const notStarted = card('2026-08-15');
  ok('before the year, the card says when it starts', /Starts/.test(notStarted));

  const over = card('2027-07-01');
  ok('after the year, the card says school is out', /School's out|School&#39;s out/.test(over));
  ok('...and does not show a countdown number', !/school days? left/.test(over));

  // Singular/plural on the label under the number.
  const oneLeft = card('2027-06-04');
  ok('the last day shows a 1', /<div[^>]*>1<\/div>/.test(oneLeft));
  ok('...labelled "school day left", not "days"', /school day left/.test(oneLeft) && !/school days left/.test(oneLeft));
  ok('any other day is labelled "school days left"', /school days left/.test(midYear));
}

// ---------------------------------------------------------------- 9. where it sits, and how it dates
{
  // "Above the calendar" - the countdown has to come before the calendar
  // container in the markup the calendar mount receives.
  const mount = SRC.slice(SRC.indexOf('mount.innerHTML = `'), SRC.indexOf('calendar-grid">${cellsHTML}'));
  const countdownAt = mount.indexOf('renderSchoolCountdown()');
  const calendarAt = mount.indexOf('calendar-container');
  ok('the countdown is rendered into the calendar mount', countdownAt !== -1);
  ok('...above the calendar itself', countdownAt < calendarAt);

  // The school is Pacific and the browser default is UTC, so a day must never
  // be derived from toISOString(). tests/local-dates.test.js guards the portal;
  // this guards the new code here.
  const added = NAMES.map(methodSource).join('\n');
  ok('the counter never derives a day from UTC', !/toISOString\(\)/.test(added));
  ok('the counter anchors dates at noon before stepping', /T12:00:00/.test(added));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
