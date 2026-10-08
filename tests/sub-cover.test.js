// Sub cover: the pieces that can be checked without a browser.
//
// The journey (teacher flags days, admin assigns, sub covers, teacher reads
// back) is debug-tools/sub-cover-journeys.mjs. The rules about who may do what
// live in the backend repo and are tested there against a real Postgres. This
// file holds the pure helpers honest:
//
//   * FLAGGING A RANGE ADDS ONLY THE DAYS THE CLASS MEETS, and never runs away:
//     a mistyped year cannot flag a decade.
//   * EVERYTHING A PERSON TYPED IS ESCAPED. Teacher notes, sub notes, class and
//     teacher names all reach other people's screens.
//   * THE WIRING IS THERE: the class tile, the admin card, the mount.
//
// Run: node tests/sub-cover.test.js

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

// Brace-extract a method of the app class (4- or 6-space indent).
function extract(name) {
  const re = new RegExp('\\n {4,6}' + name + '\\s*\\(([^)]*)\\)\\s*\\{');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length, depth = 1;
  const start = i;
  for (; i < html.length && depth; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
  }
  return new Function(m[1], html.slice(start, i - 1));
}

const app = {};
for (const n of ['_localDateStr', 'escapeHtml', 'coverDateLabel', 'coverExpandDates',
                 'coverSubNotesHtml', 'coverDayHtml', 'coverTodayHtml']) {
  const fn = extract(n);
  app[n] = function (...a) { return fn.apply(app, a); };
}

console.log('\n== flagging a range ==\n');
const weekdays = new Set([1, 2, 3, 4, 5]);
// 2026-10-08 is a Thursday.
check('Thu..Tue on a Mon-Fri class skips the weekend',
  app.coverExpandDates('2026-10-08', '2026-10-13', weekdays),
  ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13']);
check('one day when "to" is empty', app.coverExpandDates('2026-10-08', '', weekdays), ['2026-10-08']);
check('"to" before "from" is read as the one day', app.coverExpandDates('2026-10-08', '2026-10-01', weekdays), ['2026-10-08']);
check('a Saturday on a weekday class adds nothing', app.coverExpandDates('2026-10-10', '2026-10-10', weekdays), []);
check('a Tuesday/Thursday class', app.coverExpandDates('2026-10-05', '2026-10-11', new Set([2, 4])), ['2026-10-06', '2026-10-08']);
check('across a month end', app.coverExpandDates('2026-10-30', '2026-11-02', weekdays), ['2026-10-30', '2026-11-02']);
ok('a mistyped year stops at 120 days', app.coverExpandDates('2026-10-08', '2036-10-08', new Set([0, 1, 2, 3, 4, 5, 6])).length === 120);
check('no start, no days', app.coverExpandDates('', '2026-10-09', weekdays), []);
check('a date reads in words', app.coverDateLabel('2026-10-08'), 'Thu, Oct 8');

console.log('\n== what people typed is escaped ==\n');
const evil = '<img src=x onerror=alert(1)>';
const notes = app.coverSubNotesHtml([{ note: evil, name: evil, at: '2026-10-08T17:00:00Z' }]);
ok('a sub note cannot run', !notes.includes('<img') && notes.includes('&lt;img'));
check('no notes, nothing drawn', app.coverSubNotesHtml([]), '');
check('a missing list is no notes', app.coverSubNotesHtml(null), '');
const DAY = { id: 'cov-1', class_id: 'c-1', class_name: evil, date: '2026-10-08', teacher_name: evil,
              notes_for_sub: evil, sub_id: null, sub_name: null, sub_notes: [] };
const dayHtml = app.coverDayHtml(DAY, '2026-10-08', true);
ok('a teacher note in the editor cannot run', !dayHtml.includes('<img') && dayHtml.includes('&lt;img'));
ok('an unassigned day says it needs a sub', dayHtml.includes('Needs a sub'));
ok('today is marked today', dayHtml.includes('Thu, Oct 8 · today'));
ok('the editable day can be saved and removed', dayHtml.includes('app.saveCoverNote(') && dayHtml.includes('app.removeCoverDay('));
const pastHtml = app.coverDayHtml({ ...DAY, sub_id: 's', sub_name: 'Sam Basalt' }, '2026-10-09', false);
ok('a past day is read-only', !pastHtml.includes('<textarea') && !pastHtml.includes('removeCoverDay'));
ok('  and names who covered', pastHtml.includes('Sub: Sam Basalt'));
const strip = app.coverTodayHtml([DAY]);
ok('the sub\'s strip escapes the class and teacher', !strip.includes('<img') && strip.includes('&lt;img'));
ok('  and opens the register for that day', strip.includes("app.showClassAttendance('c-1', '2026-10-08')"));
ok('  the read-only assignment list', strip.includes("app.showCoverAssignments('c-1')"));
ok('  and the notes', strip.includes("app.showCoverNotes('cov-1')"));

console.log('\n== wiring ==\n');
ok('the class has a Sub Days tile', html.includes(`onclick="app.showCoverDays('\${classId}')"`));
ok('the admin dashboard has a Sub Cover card', html.includes('onclick="app.showCoverBoard()"'));
ok('the Classes page has a mount for "Covering today"', html.includes('<div id="cover-today" hidden></div>'));
ok('renderClasses fills it for staff', /if \(isTeacherOrAdmin\) this\.renderCoverToday\(\);/.test(html));
ok('every write goes through an rt_cover_ function, never the table',
  !/from\('class_cover_days'\)/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
