// Bulk-adding school events, and hiding last year's off the Manage list.
//
// Three rules here, each of which fails quietly rather than loudly:
//
//   * EVERY PARSED ROW CARRIES THE SAME KEYS. PostgREST rejects a bulk insert
//     whose objects have differing key sets, so a line that omits the end date
//     must still emit end_date: null rather than dropping the key. Get this
//     wrong and a paste of twenty dates fails as a single opaque 400 - the
//     same trap the attendance upsert already carries a comment about.
//
//   * A BAD LINE IS SKIPPED, NOT GUESSED AT. Someone pasting a year of dates
//     off a printed calendar will typo one. Inventing a date for that line
//     puts a wrong event on the school calendar that nobody is looking for;
//     reporting it by line number puts it back in their hands.
//
//   * THE SCHOOL-YEAR CUTOFF IS THE YEAR'S FIRST QUARTER, NOT THE CURRENT
//     QUARTER'S START. Filtering from the current quarter would hide events
//     from earlier this same year - September's calendar would vanish the
//     moment Q2 opened, which is exactly when someone goes looking to copy it.
//
// Dates are compared as YYYY-MM-DD strings throughout. That ordering is
// lexicographic and correct, and it never routes a calendar day through a
// Date object, which is where the UTC-vs-local bug in this repo lives.
//
// Run: node tests/school-events-bulk.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- extract the real methods -----------------------------------------
function method(name, indent = '            ') {
  for (const sig of [`\n${indent}async ${name}(`, `\n${indent}${name}(`]) {
    const start = html.indexOf(sig);
    if (start === -1) continue;
    const end = html.indexOf(`\n${indent}}\n`, start);
    if (end === -1) throw new Error(name + ' unterminated');
    const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
    const isAsync = body.startsWith('async ');
    const src = isAsync ? body.slice('async '.length) : body;
    return eval(`(${isAsync ? 'async ' : ''}function ${src.slice(name.length)})`);
  }
  throw new Error(name + ' not found');
}

const app = {};
app.isValidDateStr = method('isValidDateStr');
app.parseBulkEvents = method('parseBulkEvents');
app.pickSchoolYearStart = method('pickSchoolYearStart');

// ---- isValidDateStr ----------------------------------------------------
console.log('\n== a date has to be a real one ==\n');

check('a real date', app.isValidDateStr('2026-09-24'), true);
check('leap day in a leap year', app.isValidDateStr('2028-02-29'), true);
check('leap day in a common year', app.isValidDateStr('2027-02-29'), false);
check('the 31st of November', app.isValidDateStr('2026-11-31'), false);
check('month 13', app.isValidDateStr('2026-13-01'), false);
check('US ordering is not silently accepted', app.isValidDateStr('09/24/2026'), false);
check('a single-digit month is not padded for you', app.isValidDateStr('2026-9-24'), false);
check('empty', app.isValidDateStr(''), false);
check('null', app.isValidDateStr(null), false);

// ---- parseBulkEvents: the happy path ----------------------------------
console.log('\n== the lines a person actually pastes ==\n');

let r = app.parseBulkEvents('2026-09-24 | Chemistry Lab');
check('one clean line yields one row', r.rows.length, 1);
check('and no complaints', r.errors, []);
check('type defaults to event', r.rows[0].event_type, 'event');
check('a single-day event has a null end_date', r.rows[0].end_date, null);
check('the key set is exactly what the table wants',
  Object.keys(r.rows[0]).sort(),
  ['description', 'end_date', 'event_type', 'start_date', 'title']);

r = app.parseBulkEvents('2026-11-21 | Thanksgiving Break | closure | 2026-11-29');
check('an explicit type is taken', r.rows[0].event_type, 'closure');
check('a multi-day event keeps its end', r.rows[0].end_date, '2026-11-29');

r = app.parseBulkEvents('2026-12-18 | Christmas Party | event | 2026-12-18');
check('end date equal to start collapses to null', r.rows[0].end_date, null);

r = app.parseBulkEvents('2027-03-25\tSpring Lab\thalf_day');
check('a tab-separated line parses too', r.rows.length, 1);
check('  and keeps its type', r.rows[0].event_type, 'half_day');

r = app.parseBulkEvents('2026-10-07 | Half Day | Half-Day');
check('type is case- and hyphen-forgiving', r.rows[0].event_type, 'half_day');

r = app.parseBulkEvents('2026-09-24 | Lab | event | | ');
check('trailing empty fields do not break the line', r.rows.length, 1);

r = app.parseBulkEvents('2026-05-27 | Field Trip: Silverwood | event');
check('a title may contain a colon', r.rows[0].title, 'Field Trip: Silverwood');

// ---- parseBulkEvents: what gets skipped --------------------------------
console.log('\n== a bad line is skipped and named ==\n');

r = app.parseBulkEvents('\n   \n# a comment\n2026-09-24 | Lab\n');
check('blanks and # comments are ignored', r.rows.length, 1);
check('  and are not reported as errors', r.errors, []);

r = app.parseBulkEvents('2026-09-24');
check('a date with no title is skipped', r.rows.length, 0);
ok('  and says so', /Line 1: needs a date and a title/.test(r.errors[0]));

r = app.parseBulkEvents('2026-02-30 | Lab');
check('an unreal date is skipped', r.rows.length, 0);
ok('  and quotes the offending value', /"2026-02-30" is not a real date/.test(r.errors[0]));

r = app.parseBulkEvents('2026-09-24 | Lab | picnic');
check('an unknown type is skipped', r.rows.length, 0);
ok('  and lists the types that work', /event, holiday, closure, half_day/.test(r.errors[0]));

r = app.parseBulkEvents('2026-11-29 | Break | closure | 2026-11-21');
check('an end before the start is skipped', r.rows.length, 0);
ok('  and says which way round it is', /falls before the start date/.test(r.errors[0]));

r = app.parseBulkEvents('2026-09-24 | Lab | event | not-a-date');
check('an unreal end date is skipped', r.rows.length, 0);

r = app.parseBulkEvents([
  '2026-09-24 | Good One',
  'rubbish',
  '2026-10-29 | Good Two',
  '2026-02-30 | Bad Date',
].join('\n'));
check('good lines survive alongside bad ones', r.rows.map(x => x.title), ['Good One', 'Good Two']);
check('and every bad line is reported', r.errors.length, 2);
ok('errors carry the real line number', /Line 2:/.test(r.errors[0]) && /Line 4:/.test(r.errors[1]));

const mixed = app.parseBulkEvents([
  '2026-09-24 | No End Date',
  '2026-11-21 | With End Date | closure | 2026-11-29',
].join('\n'));
check('mixed rows still share one key set',
  JSON.stringify(Object.keys(mixed.rows[0]).sort()) === JSON.stringify(Object.keys(mixed.rows[1]).sort()),
  true);

check('nothing in, nothing out', app.parseBulkEvents('').rows, []);
check('  and no errors either', app.parseBulkEvents('').errors, []);
check('undefined is survivable', app.parseBulkEvents(undefined).rows, []);

// ---- pickSchoolYearStart ----------------------------------------------
console.log('\n== the cutoff is the year\'s first quarter ==\n');

const QUARTERS = [
  { start_date: '2025-09-02', end_date: '2025-10-31', school_year: '2025-26', is_current: false },
  { start_date: '2025-11-03', end_date: '2026-01-16', school_year: '2025-26', is_current: false },
  { start_date: '2026-09-01', end_date: '2026-10-30', school_year: '2026-27', is_current: false },
  { start_date: '2026-11-02', end_date: '2027-01-15', school_year: '2026-27', is_current: true },
  { start_date: '2027-01-19', end_date: '2027-03-25', school_year: '2026-27', is_current: false },
];

check('is_current picks the year, and the year picks its first quarter',
  app.pickSchoolYearStart(QUARTERS, '2026-12-01'), '2026-09-01');

const noFlag = QUARTERS.map(q => ({ ...q, is_current: false }));
check('without the flag, the quarter containing today decides',
  app.pickSchoolYearStart(noFlag, '2026-12-01'), '2026-09-01');

check('a date in the gap between quarters falls back to the last one started',
  app.pickSchoolYearStart(noFlag, '2027-01-17'), '2026-09-01');

check('last year resolves to last year, not this one',
  app.pickSchoolYearStart(noFlag, '2025-12-01'), '2025-09-02');

const noYear = QUARTERS.map(({ start_date, end_date }) => ({ start_date, end_date }));
check('with no school_year at all, the last twelve months decide',
  app.pickSchoolYearStart(noYear, '2026-12-01'), '2026-09-01');

check('no quarters at all means no filtering', app.pickSchoolYearStart([], '2026-12-01'), null);
check('undefined means no filtering', app.pickSchoolYearStart(undefined, '2026-12-01'), null);
check('rows without a start_date are ignored',
  app.pickSchoolYearStart([{ school_year: '2026-27' }], '2026-12-01'), null);

// ---- the filter the list actually applies ------------------------------
console.log('\n== what the Manage list hides ==\n');

const EVENTS = [
  { start_date: '2026-12-18', title: 'Christmas Party' },
  { start_date: '2026-09-24', title: 'Chemistry Lab' },
  { start_date: '2026-09-01', title: 'First Day' },
  { start_date: '2026-08-31', title: 'Last year, one day early' },
  { start_date: '2025-11-03', title: 'Prior year' },
];
const start = app.pickSchoolYearStart(QUARTERS, '2026-12-01');
const shown = EVENTS.filter(e => e.start_date >= start).map(e => e.title);
const hidden = EVENTS.filter(e => e.start_date < start).map(e => e.title);

check('this year stays', shown, ['Christmas Party', 'Chemistry Lab', 'First Day']);
check('earlier years go', hidden, ['Last year, one day early', 'Prior year']);
ok('the first day of school is itself kept', shown.includes('First Day'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
