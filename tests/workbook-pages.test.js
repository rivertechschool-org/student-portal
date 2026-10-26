// Workbook Pages assignments, portal side.
//
// 2026-10-26: each student gets their own pages, carried on from the previous
// Pages assignment, and the database grades the turn-in on the way in (the
// grading rules are tested in the backend repo). This runs the real methods
// over invented students: the carry-on plan, reading the table back, the
// student's badge, and what a student is told after turning in.
//
// Run: node tests/workbook-pages.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  let start = html.indexOf(`\n      ${name}(`);
  if (start < 0) start = html.indexOf(`\n      async ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const names = ['_pagesPlan', '_pagesReadTargets', '_pagesSyncFromInputs', '_pagesEndText', 'studentVersionBadge', '_pagesGradedMessage'];
const app = eval(`({ ${names.map(method).join(',\n')} })`);
app.escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const students = [
  { id: 'a', first_name: 'Pella', last_name: 'Ostrander' },
  { id: 'b', first_name: 'Quill', last_name: 'Marrow' },
  { id: 'c', first_name: 'Rook', last_name: 'Ash' },
];

// ---- carrying on from the previous assignment ----
const prev = new Map([
  ['a', { page_start: 23, page_end: 26 }],   // 4 pages last time
  ['b', { page_start: 10, page_end: 15 }],   // 6 pages last time
]);
const rows = app._pagesPlan(students, prev, 4);
ok('starts one page after the last TARGET page', rows[0].start === 27 && rows[1].start === 16, JSON.stringify(rows));
ok("keeps each student's own page count", rows[0].count === 4 && rows[1].count === 6, JSON.stringify(rows));
ok('a student new to the series is left blank for the teacher, at the default count',
  rows[2].start === '' && rows[2].count === 4, JSON.stringify(rows[2]));
ok('starting fresh leaves everyone blank', app._pagesPlan(students, new Map(), 5).every(r => r.start === '' && r.count === 5));

ok('pages text: a range', app._pagesEndText(27, 4) === 'pp. 27–30');
ok('pages text: one page', app._pagesEndText(27, 1) === 'p. 27');
ok('pages text: incomplete', app._pagesEndText('', 4) === '—');

// ---- reading the table back ----
const inputs = { 'start-a': '27', 'count-a': '4', 'start-b': '16', 'count-b': '3', 'start-c': '', 'count-c': '4' };
global.document = {
  querySelector: sel => {
    const m = sel.match(/\.pages-(start|count)\[data-id="(\w+)"\]/);
    return m ? { value: inputs[`${m[1]}-${m[2]}`] } : null;
  },
};
app._pagesCtx = { rows: app._pagesPlan(students, prev, 4) };
const read = app._pagesReadTargets();
ok('targets read back, with the teacher\'s edit to one count',
  JSON.stringify(read.targets) === JSON.stringify([
    { student_id: 'a', page_start: 27, page_end: 30 },
    { student_id: 'b', page_start: 16, page_end: 18 },
  ]), JSON.stringify(read.targets));
ok('a student with no first page is reported by name', read.blank.length === 1 && read.blank[0].name === 'Rook Ash', JSON.stringify(read.blank));

// ---- the student's badge ----
const badge = app.studentVersionBadge({ student_version: { page_start: 27, page_end: 30, description: null, due_date: null, points_possible: null } });
ok('a pages-only version shows the pages, not "Adjusted"', /📖 Pages 27–30/.test(badge) && !/Adjusted/.test(badge), badge);
const both = app.studentVersionBadge({ student_version: { page_start: 5, page_end: 5, due_date: '2026-11-01T00:00:00Z' } });
ok('pages plus a real adjustment shows both', /📖 Page 5/.test(both) && /Adjusted for you/.test(both), both);
ok('an ordinary version is unchanged', /Adjusted for you/.test(app.studentVersionBadge({ student_version: { due_date: 'x' } })));

// ---- after turning in ----
const graded = { status: 'graded', grade: 'B', feedback: 'Pages 27–30 were due. You turned in 26–29. Missing: 30 (1 page). Grade: B. Graded automatically - your teacher can change it.' };
const msg = app._pagesGradedMessage(graded);
ok('the student is told the grade and why', msg === 'Turned in - graded B. Pages 27–30 were due. You turned in 26–29. Missing: 30 (1 page).', msg);
ok('left for the teacher: the ordinary message', app._pagesGradedMessage({ status: 'submitted', grade: null }) === null);
ok('a teacher-graded row is not dressed up as automatic', app._pagesGradedMessage({ status: 'graded', grade: 'A', feedback: 'Nice work' }) === null);

// ---- the page itself ----
ok('the type is offered', html.includes('<option value="pages">📖 Workbook Pages (auto-graded)</option>'));
ok('saved as a regular assignment graded by pages', html.includes("assignmentData.grading_type = 'pages';"));
ok('the version editor keeps pages when the rest goes back to the class',
  html.includes("row = row || { assignment_id: a.id, student_id: studentId, description: null, due_date: null, points_possible: null };"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
