// Excusing an assignment that was already handed in (Jordan, 2026-10-06).
//
// The teacher can now excuse a row that holds work, not only an empty one.
// Excusing it deletes what was submitted: the text, the file, and any grade
// and feedback. Three things have to hold:
//
//   * THE FILE GOES FIRST. The server only trashes a Drive file it finds named
//     on a submission row. Clear the row first and the file is orphaned in the
//     school Drive with nothing pointing at it.
//   * THE SAME ROW IS EXCUSED, BY ITS ID. A split-id student's row is keyed by
//     their auth uid; an upsert keyed by profile id would make a second row.
//   * A FAILED TRASH ASKS. Say no and nothing is written; say yes and the row
//     is excused with the file left in Drive.
//
// Run: node tests/excuse-submitted-work.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
console.warn = () => {}; // the failed-trash case warns on purpose

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Brace-extract a method from the page; async ones come back async.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function extract(name) {
  const re = new RegExp('\\n      (async\\s+)?' + name + '\\s*\\(([^)]*)\\)\\s*\\{');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length, depth = 1;
  const start = i;
  for (; i < html.length && depth; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
  }
  const Ctor = m[1] ? AsyncFunction : Function;
  return new Ctor(m[2], html.slice(start, i - 1));
}

// ---- a Supabase client that records every write ------------------------
function makeApp({ row, trashFails = false, confirmAnswer = true }) {
  const log = [];
  const db = { row: row ? { ...row } : null };
  const builder = () => {
    const q = { op: 'select', filters: {}, payload: null, opts: null };
    const b = {
      select() { return b; },
      eq(k, v) { q.filters[k] = v; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return b; },
      maybeSingle() { return b; },
      then(res, rej) {
        log.push({ kind: q.op, filters: q.filters, payload: q.payload, opts: q.opts });
        // Hand back a copy, as a real client would.
        const data = q.op === 'select' ? (db.row ? { ...db.row } : null) : null;
        return Promise.resolve({ data, error: null }).then(res, rej);
      }
    };
    return b;
  };
  const app = {
    auth: { supabase: { from: () => builder() } },
    userInfo: { user: { id: 'teacher-1' } },
    supabaseQuery: (fn) => fn(),
    trashDriveFile: async (id) => {
      log.push({ kind: 'trash', id });
      if (trashFails) throw new Error('Drive said no');
      return true;
    },
    showNotification: (msg, type) => log.push({ kind: 'notify', msg, type }),
    closeModal: () => {},
    viewSubmissions: () => {},
  };
  for (const n of ['loadSubmissionToExcuse', 'submissionHasWork', 'submitExcuseStudent']) {
    const fn = extract(n);
    app[n] = function (...a) { return fn.apply(app, a); };
  }
  global.document = { getElementById: (id) => (id === 'excuse-reason' ? { value: 'Was ill' } : null) };
  global.confirm = () => { log.push({ kind: 'confirm' }); return confirmAnswer; };
  global.setTimeout = () => {};
  return { app, log };
}

const HANDED_IN = {
  id: 'sub-9', status: 'graded', content: 'My essay', file_url: 'https://drive/x', file_name: 'essay.pdf',
  drive_file_id: 'drv-1', file_path: null, points_earned: 8
};

(async () => {
  console.log('\n== what counts as work ==\n');
  const { app: a0 } = makeApp({});
  check('no row', a0.submissionHasWork(null), false);
  check('an excused row', a0.submissionHasWork({ status: 'excused', content: 'Assignment excused by teacher' }), false);
  check('text only', a0.submissionHasWork({ status: 'submitted', content: 'hi' }), true);
  check('blank text', a0.submissionHasWork({ status: 'submitted', content: '   ' }), false);
  check('a file only', a0.submissionHasWork({ status: 'submitted', drive_file_id: 'd' }), true);
  check('a Gradebook grade of zero', a0.submissionHasWork({ status: 'graded', points_earned: 0 }), true);

  console.log('\n== handed in, with a Drive file ==\n');
  {
    const { app, log } = makeApp({ row: HANDED_IN });
    await app.submitExcuseStudent('auth-uid-7', 'asg-1');
    const kinds = log.map(l => l.kind);
    check('read, trash, then write', kinds.slice(0, 3), ['select', 'trash', 'update']);
    check('the file trashed is the submitted one', log[1].id, 'drv-1');
    const w = log[2];
    check('the row is found by the id the list passed', log[0].filters, { assignment_id: 'asg-1', student_id: 'auth-uid-7' });
    check('the same row is written, by its id', w.filters, { id: 'sub-9' });
    check('it is excused, with the reason', [w.payload.status, w.payload.excuse_reason, w.payload.excused_by], ['excused', 'Was ill', 'teacher-1']);
    check('the work and the file are gone',
      [w.payload.file_url, w.payload.file_name, w.payload.drive_file_id, w.payload.file_path, w.payload.submitted_at],
      [null, null, null, null, null]);
    check('the text is replaced', w.payload.content, 'Assignment excused by teacher');
    check('the grade and feedback are gone',
      [w.payload.grade, w.payload.points_earned, w.payload.feedback, w.payload.graded_at], [null, null, null, null]);
    ok('the teacher is told the work was deleted', log.some(l => l.kind === 'notify' && /deleted/.test(l.msg)));
  }

  console.log('\n== the file will not trash ==\n');
  {
    const { app, log } = makeApp({ row: HANDED_IN, trashFails: true, confirmAnswer: false });
    await app.submitExcuseStudent('s1', 'asg-1');
    ok('the teacher is asked', log.some(l => l.kind === 'confirm'));
    ok('said no -> nothing is written', !log.some(l => l.kind === 'update' || l.kind === 'upsert'));
  }
  {
    const { app, log } = makeApp({ row: HANDED_IN, trashFails: true, confirmAnswer: true });
    await app.submitExcuseStudent('s1', 'asg-1');
    ok('said yes -> the row is still excused', log.some(l => l.kind === 'update' && l.payload.status === 'excused'));
  }

  console.log('\n== text only, no file ==\n');
  {
    const { app, log } = makeApp({ row: { id: 'sub-2', status: 'submitted', content: 'answer', drive_file_id: null } });
    await app.submitExcuseStudent('s1', 'asg-1');
    ok('no trash call', !log.some(l => l.kind === 'trash'));
    ok('the row is cleared and excused', log.some(l => l.kind === 'update' && l.payload.content === 'Assignment excused by teacher'));
  }

  console.log('\n== nothing handed in (unchanged) ==\n');
  {
    const { app, log } = makeApp({ row: null });
    await app.submitExcuseStudent('s1', 'asg-1');
    const up = log.find(l => l.kind === 'upsert');
    ok('still an upsert on the unique key', up && up.opts.onConflict === 'assignment_id,student_id');
    check('and excused', up && [up.payload.status, up.payload.student_id], ['excused', 's1']);
    ok('no trash call', !log.some(l => l.kind === 'trash'));
  }

  console.log('\n== the list offers it ==\n');
  ok('a handed-in row has an Excuse button keyed by the submission\'s own student_id',
    html.includes(`onclick="app.excuseStudent('\${submission.student_id}', '\${assignmentId}')"`));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
