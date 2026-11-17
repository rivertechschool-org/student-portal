// D or below (admin): which classes are flagged for a quarter, filtering, and
// the CSV. The real methods are extracted from the page. Invented students.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n      (?:async )?' + name + '\\('));
  assert(start >= 0, name);
  const end = html.indexOf('\n      }', start);
  return html.slice(start, end + 8).trim();
}
const app = eval(`({${['_lowGradeRows', '_lowGradeFilter', '_lowGradeCsv', 'percentageToLetter', '_studentGradeBand', '_studentGradeNumber'].map(method).join(',')}})`);

const cls = (id, extra = {}) => ({ id, name: id.toUpperCase(), subject: 'Math', teacher_id: 't1', status: 'active', on_report_card: true, ...extra });
const students = [
  { id: 'ava', first_name: 'Ava', last_name: 'Brook', grade_level: '7' },
  { id: 'ben', first_name: 'Ben', last_name: 'Alder', grade_level: '10' },
  { id: 'cy', first_name: 'Cy', last_name: 'Cole', grade_level: '3' },
];
const enrollments = [
  { id: 'e1', student_id: 'ava', class_id: 'alg', status: 'active', class_grade: 95, classes: cls('alg') },
  { id: 'e2', student_id: 'ava', class_id: 'bio', status: 'active', class_grade: 64, classes: cls('bio', { subject: 'Science' }) },
  { id: 'e3', student_id: 'ben', class_id: 'alg', status: 'active', class_grade: 69.9, classes: cls('alg') },
  { id: 'e4', student_id: 'ben', class_id: 'art', status: 'active', class_grade: 40, classes: cls('art', { on_report_card: false }) },
  { id: 'e5', student_id: 'cy', class_id: 'rd', status: 'active', class_grade: 0, classes: cls('rd') },
  { id: 'e6', student_id: 'cy', class_id: 'old', status: 'archived', class_grade: 50, classes: cls('old') },
  { id: 'e7', student_id: 'teacher', class_id: 'alg', status: 'active', class_grade: 10, classes: cls('alg') },
];
const teacherName = { t1: 'Ms. Fennick' };

// ---- the quarter in progress: snapshot first, else live ----
let rows = app._lowGradeRows({ quarterId: 'q2', isCurrent: true, enrollments, students, teacherName,
  snapshots: [{ enrollment_id: 'e1', quarter_id: 'q2', class_grade: 61 }, { enrollment_id: 'e3', quarter_id: 'q1', class_grade: 20 }] });
assert.deepEqual(rows.map(r => [r.studentId, r.classId, r.grade, r.letter, r.live]), [
  ['ben', 'alg', 69.9, 'D', true],   // 69.9 is a D, not a C-
  ['ava', 'alg', 61, 'D', false],    // the snapshot wins over a live 95
  ['ava', 'bio', 64, 'D', true],
], 'sorted by last name; off-report-card, no-grade (0), archived and non-students left out');
assert.equal(rows[0].teacher, 'Ms. Fennick');

// ---- a past quarter: only saved grades ----
rows = app._lowGradeRows({ quarterId: 'q1', isCurrent: false, enrollments, students, teacherName,
  snapshots: [{ enrollment_id: 'e3', quarter_id: 'q1', class_grade: 20 }, { enrollment_id: 'e6', quarter_id: 'q1', class_grade: 70 },
    { enrollment_id: 'e2', quarter_id: 'q1', class_grade: 0 }] });
assert.deepEqual(rows.map(r => [r.studentId, r.grade, r.letter]), [['ben', 20, 'F']], 'live grades ignored; exactly 70 is a C-');

// Enrolled twice in one class: one row, the saved grade over the live one.
rows = app._lowGradeRows({ quarterId: 'q2', isCurrent: true, students, teacherName,
  enrollments: [{ id: 'a', student_id: 'ava', class_id: 'alg', status: 'active', class_grade: 55, classes: cls('alg') },
    { id: 'b', student_id: 'ava', class_id: 'alg', status: 'archived', class_grade: null, classes: cls('alg') }],
  snapshots: [{ enrollment_id: 'b', quarter_id: 'q2', class_grade: 66 }] });
assert.deepEqual(rows.map(r => [r.grade, r.live]), [[66, false]]);
// A closed class has no live grade.
assert.equal(app._lowGradeRows({ quarterId: 'q2', isCurrent: true, students, snapshots: [],
  enrollments: [{ id: 'c', student_id: 'ava', class_id: 'x', status: 'active', class_grade: 30, classes: cls('x', { status: 'closed' }) }] }).length, 0);

// ---- filtering ----
rows = app._lowGradeRows({ quarterId: 'q2', isCurrent: true, enrollments, students, teacherName, snapshots: [] });
const bands = [{ code: 'jh', min_grade: 6, max_grade: 8 }, { code: 'hs', min_grade: 9, max_grade: 12 }];
assert.deepEqual(app._lowGradeFilter(rows, { studentIds: new Set(['ben']) }).map(r => r.studentId), ['ben']);
assert.equal(app._lowGradeFilter(rows, { studentIds: new Set() }).length, rows.length, 'nobody chosen = everyone');
assert.deepEqual(app._lowGradeFilter(rows, { bandsOff: new Set(['hs']), bands }).map(r => r.studentId), ['ava']);
assert.deepEqual(app._lowGradeFilter(rows, { bandsOff: new Set(['jh']), bands, studentIds: new Set(['ava']) }), []);

// ---- CSV ----
const csv = app._lowGradeCsv([{ ...rows[0], className: '=HYPERLINK("x")', teacher: 'Fennick, J' }]).split('\n');
assert.equal(csv[0], 'Student,Grade level,Class,Subject,Teacher,Percent,Letter,Grade from');
assert.equal(csv[1], `Ben Alder,10,"'=HYPERLINK(""x"")",Math,"Fennick, J",69.9,D,Live (quarter in progress)`, 'formula-safe and quoted');
console.log('D or below: quarter grades, filters and CSV passed.');
