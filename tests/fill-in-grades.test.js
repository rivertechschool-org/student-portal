// "Fill in grades" on an assignment's submissions list.
//
// 2026-10-27: runs the real _fillGradesPlan, _fillGradePoints and
// submitFillInGrades over invented students and an in-memory stand-in for the
// database: who is filled, who is never touched, the points each one gets,
// and a student who turns in between the list loading and the button press.
//
// Run: node tests/fill-in-grades.test.js
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

const app = eval(`({ ${['_fillGradesPlan', '_fillGradePoints', 'submitFillInGrades', '_fillGradesCount'].map(method).join(',\n')} })`);

// ---- who is filled ----
const students = [
  { id: 'p-a', auth_user_id: 'u-a', first_name: 'Pella', last_name: 'Ostrander' },   // nothing at all
  { id: 'p-b', auth_user_id: 'u-b', first_name: 'Quill', last_name: 'Marrow' },      // turned in, not graded
  { id: 'p-c', auth_user_id: 'u-c', first_name: 'Rook', last_name: 'Ash' },          // graded
  { id: 'p-d', auth_user_id: 'u-d', first_name: 'Sorrel', last_name: 'Vane' },       // excused
  { id: 'p-e', auth_user_id: 'u-e', first_name: 'Tamsin', last_name: 'Holt' },       // nothing at all
  { id: 'p-f', auth_user_id: 'u-f', first_name: 'Ulric', last_name: 'Penn' },        // graded, row under the auth uid
];
const rows = () => ([
  { id: 's-b', assignment_id: 'as1', student_id: 'p-b', status: 'submitted', grade: null },
  { id: 's-c', assignment_id: 'as1', student_id: 'p-c', status: 'graded', grade: 'B' },
  { id: 's-d', assignment_id: 'as1', student_id: 'p-d', status: 'excused', grade: null },
  { id: 's-f', assignment_id: 'as1', student_id: 'u-f', status: 'graded', grade: 'A' },
]);
const mapOf = list => Object.fromEntries(list.map(s => [s.student_id, s]));

let plan = app._fillGradesPlan(students, mapOf(rows()), false);
ok('by default only students with nothing at all', plan.targets.map(t => t.student.id).join() === 'p-a,p-e', JSON.stringify(plan.targets));
ok('turned-in work is listed apart', plan.ungraded.map(t => t.student.id).join() === 'p-b');
plan = app._fillGradesPlan(students, mapOf(rows()), true);
ok('with the box ticked, turned-in work too', plan.targets.map(t => t.student.id).join() === 'p-a,p-e,p-b');
ok('a row under the auth uid counts as theirs', !plan.targets.some(t => t.student.id === 'p-f'));

// ---- points ----
ok('F is 0', app._fillGradePoints('F', 20) === 0);
ok('B is the middle of its band', app._fillGradePoints('B', 20) === 17);
ok('out of 100 when there is no maximum', app._fillGradePoints('C', null) === 75);
ok('rounded to cents', app._fillGradePoints('A-', 7) === 6.41, app._fillGradePoints('A-', 7));

// ---- the button, end to end over a stand-in database ----
function makeDb(tables) {
  const db = JSON.parse(JSON.stringify(tables));
  const copy = r => JSON.parse(JSON.stringify(r));
  const from = name => {
    let filters = [], op = 'select', payload = null;
    const rowsNow = () => (db[name] = db[name] || []).filter(r => filters.every(f => f(r)));
    const q = {
      select() { return q; },
      eq(c, v) { filters.push(r => r[c] === v); return q; },
      neq(c, v) { filters.push(r => r[c] !== v); return q; },
      is(c, v) { filters.push(r => (r[c] ?? null) === v); return q; },
      update(p) { op = 'update'; payload = p; return q; },
      insert(p) { op = 'insert'; payload = p; return q; },
      then(res, rej) {
        if (op === 'insert') {
          // The unique key on (assignment_id, student_id).
          if (db[name].some(r => r.assignment_id === payload.assignment_id && r.student_id === payload.student_id))
            return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(res, rej);
          const row = { id: 'new' + db[name].length, ...copy(payload) };
          db[name].push(row);
          return Promise.resolve({ data: [{ id: row.id }], error: null }).then(res, rej);
        }
        if (op === 'update') {
          const hit = rowsNow();
          hit.forEach(r => Object.assign(r, copy(payload)));
          return Promise.resolve({ data: hit.map(r => ({ id: r.id })), error: null }).then(res, rej);
        }
        return Promise.resolve({ data: rowsNow().map(copy), error: null }).then(res, rej);
      },
    };
    return q;
  };
  return { db, from };
}

function setup({ letter = 'F', ungraded = false, notify = true, beforeRead } = {}) {
  const stub = makeDb({ assignment_submissions: rows() });
  const said = { notes: [], notified: [], refreshed: 0, closed: [] };
  const fields = {
    'fill-grade-letter': { value: letter },
    'fill-include-ungraded': { checked: ungraded },
    'fill-notify': { checked: notify },
    'fill-grades-go': { disabled: false, textContent: '' },
  };
  global.document = { getElementById: id => fields[id] || null };
  const from = name => { if (beforeRead) { beforeRead(stub.db); beforeRead = null; } return stub.from(name); };
  Object.assign(app, {
    auth: { supabase: { from } },
    supabaseQuery: fn => Promise.resolve(fn()),
    _submissionsCtx: {
      assignment: { id: 'as1', title: 'Chapter 4 review', max_points: 20 },
      students, submissionMap: mapOf(rows()),
      versions: { 'p-e': { points_possible: 10 } },
    },
    // Tamsin's own version is out of 10.
    studentVersionOf: (v, aid, ids) => ids.map(i => v[i]).find(Boolean) || null,
    withStudentVersion: (a, v) => v ? { ...a, max_points: v.points_possible } : a,
    closeModal: id => said.closed.push(id),
    showNotification: (m, t) => said.notes.push([m, t]),
    sendGradeNotifications: async (...args) => { said.notified.push(args); },
    viewSubmissions: async () => { said.refreshed++; },
  });
  return { db: stub.db, said };
}
const row = (db, sid) => db.assignment_submissions.find(r => r.student_id === sid);

(async () => {
  let { db, said } = setup();
  await app.submitFillInGrades('as1');
  ok('the two with nothing get an F at 0 points',
    row(db, 'p-a')?.grade === 'F' && row(db, 'p-a').points_earned === 0 && row(db, 'p-e')?.grade === 'F',
    JSON.stringify(db.assignment_submissions));
  ok('as graded, with no made-up hand-in time', row(db, 'p-a').status === 'graded' && !('submitted_at' in row(db, 'p-a')));
  ok('turned-in work is left alone by default', row(db, 'p-b').status === 'submitted' && row(db, 'p-b').grade === null);
  ok('graded and excused rows are untouched',
    row(db, 'p-c').grade === 'B' && row(db, 'p-d').status === 'excused' && row(db, 'u-f').grade === 'A'
    && !row(db, 'p-f') && db.assignment_submissions.length === 6);
  ok('says how many', /^2 grades filled in as F$/.test(said.notes[0]?.[0] || ''), JSON.stringify(said.notes));
  ok('the list is reloaded', said.refreshed === 1);
  await new Promise(r => setTimeout(r, 0));
  ok('each student filled is notified', said.notified.length === 2 && said.notified[0][2] === 'F');

  ({ db, said } = setup({ letter: 'C', ungraded: true, notify: false }));
  await app.submitFillInGrades('as1');
  ok("each student's own maximum", row(db, 'p-a').points_earned === 15 && row(db, 'p-e').points_earned === 7.5,
    JSON.stringify([row(db, 'p-a'), row(db, 'p-e')]));
  ok('with the box ticked, turned-in work is graded, its row kept', row(db, 'p-b').id === 's-b' && row(db, 'p-b').grade === 'C' && row(db, 'p-b').status === 'graded');
  ok('its own feedback is not replaced', !('feedback' in row(db, 'p-b')));
  await new Promise(r => setTimeout(r, 0));
  ok('no notifications when unticked', said.notified.length === 0);

  // Pella turns in, and Quill is graded by hand, between the list loading and the press.
  ({ db, said } = setup({ ungraded: true, beforeRead: d => {
    d.assignment_submissions.push({ id: 's-a', assignment_id: 'as1', student_id: 'p-a', status: 'submitted', grade: null });
    Object.assign(d.assignment_submissions.find(r => r.id === 's-b'), { status: 'graded', grade: 'A' });
  } }));
  await app.submitFillInGrades('as1');
  ok('work graded since is not overwritten', row(db, 'p-b').grade === 'A');
  ok('work turned in since is graded, not duplicated',
    db.assignment_submissions.filter(r => r.student_id === 'p-a').length === 1 && row(db, 'p-a').grade === 'F');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
