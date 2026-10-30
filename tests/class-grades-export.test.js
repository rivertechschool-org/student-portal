// Export Grades: a class's grades as a spreadsheet - every student, every
// assignment due in the quarter, and the saved quarter grade.
//
// Run: node tests/class-grades-export.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  const m = new RegExp('\\n      (?:async\\s+)?' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('not found: ' + name);
  let p = html.indexOf('(', m.index), pd = 0;
  for (; p < html.length; p++) {
    if (html[p] === '(') pd++;
    else if (html[p] === ')' && --pd === 0) break;
  }
  let i = html.indexOf('{', p), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(m.index + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const names = ['exportClassGrades', '_classGradesCsv', 'percentageToLetter', '_localDateStr', 'fetchAllRows'];
const proto = eval(`({ ${names.map(method).join(',\n')} })`);

// Parse what we wrote back, so the checks read cells, not string fragments.
function parse(csv) {
  const rows = []; let row = [], f = '', q = false;
  const t = csv.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r') {}
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  return rows;
}

const db = {
  classes: [{ id: 'c1', name: 'Literature - HS', subject: 'English', teacher_id: 't1' }],
  quarters: [{ id: 'q1', name: 'Quarter 1', start_date: '2026-09-01', end_date: '2026-10-30', is_current: true }],
  class_enrollments: [
    { id: 'e1', class_id: 'c1', student_id: 's1', status: 'active' },
    { id: 'e2', class_id: 'c1', student_id: 's2', status: 'active' },
    { id: 'e3', class_id: 'c1', student_id: 's3', status: 'active' },
    { id: 'e9', class_id: 'c1', student_id: 's9', status: 'archived' },
  ],
  user_profiles: [
    { id: 's1', first_name: 'Wren', last_name: 'Okafor' }, { id: 's2', first_name: 'Ivy', last_name: 'Arden' },
    { id: 's3', first_name: '=cmd', last_name: 'Bram, Jr.' }, { id: 's9', first_name: 'Gone', last_name: 'Left' },
    { id: 't1', first_name: 'Ada', last_name: 'Teach' },
  ],
  assignments: [
    { id: 'a1', class_id: 'c1', title: 'Essay "Light"', due_date: '2026-09-15T23:59:00Z', max_points: 10, created_at: '2026-09-01' },
    { id: 'a2', class_id: 'c1', title: 'Quiz', due_date: '2026-10-29T23:59:00Z', max_points: 20, created_at: '2026-09-01' },
    { id: 'a3', class_id: 'c1', title: 'Last year', due_date: '2026-05-01T23:59:00Z', max_points: 5, created_at: '2026-04-01' },
    { id: 'a4', class_id: 'c1', title: 'Template', due_date: '2026-09-20T23:59:00Z', max_points: 5, is_template: true, created_at: '2026-09-01' },
    { id: 'a5', class_id: 'c1', title: 'Later', due_date: '2026-10-30T20:00:00Z', max_points: 8, created_at: '2026-09-01' },
  ],
  assignment_submissions: [
    { id: 1, assignment_id: 'a1', student_id: 's1', points_earned: 9, status: 'graded', submitted_at: '2026-09-15' },
    { id: 2, assignment_id: 'a1', student_id: 's2', points_earned: 7, status: 'graded', submitted_at: '2026-09-15' },
    { id: 3, assignment_id: 'a2', student_id: 's1', points_earned: null, status: 'submitted', submitted_at: '2026-10-29' },
    { id: 4, assignment_id: 'a1', student_id: 's3', points_earned: null, excused_at: '2026-09-16' },
    { id: 5, assignment_id: 'a2', student_id: 's3', points_earned: 12, status: 'graded', submitted_at: '2026-10-29' },
  ],
  assignment_student_versions: [{ assignment_id: 'a2', student_id: 's3', points_possible: 15 }],
  quarter_grade_snapshots: [
    { enrollment_id: 'e1', quarter_id: 'q1', academic_grade: 91.5, participation_grade: 88, class_grade: 91.5 },
    { enrollment_id: 'e2', quarter_id: 'q1', academic_grade: 0, participation_grade: 0, class_grade: 0 },
  ],
};

function from(table) {
  const f = [];
  const rows = () => (db[table] || []).filter(r => f.every(fn => fn(r))).map(r => ({ ...r }));
  const q = {
    select() { return q; },
    eq(c, v) { f.push(r => r[c] === v); return q; },
    in(c, v) { f.push(r => v.includes(r[c])); return q; },
    order() { return q; }, limit() { return q; },
    range(a, b) { q._r = [a, b]; return q; },
    single() { const r = rows(); return Promise.resolve({ data: r[0] || null, error: r.length ? null : { message: 'none' } }); },
    maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
    then(res, rej) { let r = rows(); if (q._r) r = r.slice(q._r[0], q._r[1] + 1); return Promise.resolve({ data: r, error: null }).then(res, rej); },
  };
  return q;
}

let downloaded = null;
global.Blob = class { constructor(parts) { this.text = parts.join(''); } };
global.URL = { createObjectURL: (b) => { downloaded = b.text; return 'blob:x'; }, revokeObjectURL() {} };
let link = null;
global.document = {
  createElement: () => (link = { click() {} }),
  body: { appendChild() {}, removeChild() {} },
};
global.window = {};

(async () => {
  const notes = [];
  const app = Object.assign(Object.create(proto), {
    auth: { supabase: { from } },
    supabaseQuery: fn => Promise.resolve(fn()),
    showNotification: (m, k) => notes.push(`${k}:${m}`),
  });
  // "Today" for Missing / not due yet: 30 Oct, mid-morning.
  const RealDate = Date;
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : ['2026-10-30T17:00:00Z'])); } static now() { return new RealDate('2026-10-30T17:00:00Z').getTime(); } };

  await app.exportClassGrades('c1');
  global.Date = RealDate;
  ok('a file is downloaded', !!downloaded, JSON.stringify(notes));
  ok('  named for the class, quarter and day', /^Literature_-_HS_Quarter_1_grades_\d{4}-\d{2}-\d{2}\.csv$/.test(link?.download || ''), link?.download);
  ok('  with a byte-order mark, so Excel reads names right', downloaded.startsWith('﻿'));
  const rows = parse(downloaded);
  ok('the header names the class, teacher and quarter', rows[0][1] === 'Literature - HS' && rows[1][1] === 'Ada Teach' && /^Quarter 1 \(2026-09-01 to 2026-10-30\)$/.test(rows[2][1]), JSON.stringify(rows.slice(0, 3)));
  const head = rows[5];
  ok('one column per assignment due this quarter, in due order', head.length === 2 + 3 + 4
    && /^Essay "Light" \(10 pts, due /.test(head[2]) && /^Quiz \(20 pts/.test(head[3]) && /^Later \(8 pts/.test(head[4]), JSON.stringify(head));
  ok("  not last year's, not templates", !head.some(h => /Last year|Template/.test(h)));
  ok('  then the quarter grade', JSON.stringify(head.slice(-4)) === '["Academic %","Participation %","Class grade %","Letter"]');
  const body = rows.slice(6);
  ok('one row per student now in the class, sorted by last name', body.length === 3
    && body.map(r => r[0]).join('|') === 'Arden|Bram, Jr.|Okafor', JSON.stringify(body.map(r => r[0])));
  const [arden, bram, okafor] = body;
  ok('points earned', okafor[2] === '9' && arden[2] === '7');
  ok('handed in, not graded yet: "Turned in"', okafor[3] === 'Turned in');
  ok('past due with nothing handed in: "Missing"', arden[3] === 'Missing');
  ok('not due yet: blank', arden[4] === '' && okafor[4] === '');
  ok('excused: "Excused"', bram[2] === 'Excused');
  ok("a student's own version shows its points", bram[3] === '12 / 15', bram[3]);
  ok('the saved quarter grade and its letter', okafor.slice(-4).join('|') === '91.5|88|91.5|A-', okafor.slice(-4).join('|'));
  ok('a grade of 0 (nothing saved) is blank, not an F', arden[arden.length - 2] === '' && arden[arden.length - 1] === '');
  ok('a name that looks like a formula is defused', bram[1] === "'=cmd");
  ok('the button is in Manage Grades, exporting the quarter on screen',
    /app\.exportClassGrades\(teacherGrades\.currentClassId, teacherGrades\.currentQuarterId\)[^>]*>📊 Export grades</.test(html));
  ok('the teacher is told what was exported', notes.some(n => /^success:Exported Literature - HS: 3 students, 3 assignments/.test(n)), JSON.stringify(notes));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
