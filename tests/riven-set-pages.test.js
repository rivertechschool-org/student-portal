// Riven: "set noah's pages to 31-34" on a Workbook Pages assignment.
//
// 2026-10-26: runs the real _rivenPagesSpec and terminalSetPages over invented
// students and an in-memory stand-in for the database, then presses Confirm
// and checks the row that would be written - and that undo puts it back.
//
// Run: node tests/riven-set-pages.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  let start = html.indexOf(`\n    ${name}(`);
  if (start < 0) start = html.indexOf(`\n    async ${name}(`);
  if (start < 0) start = html.indexOf(`\n      ${name}(`);
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

const app = eval(`({ ${['_rivenPagesSpec', 'terminalSetPages', '_rivenResolvedStudent', '_pagesEndText'].map(method).join(',\n')} })`);

// ---- reading the sentence ----
const spec = s => JSON.stringify(app._rivenPagesSpec(s));
ok('a range', spec("set noah's pages to 31-34") === '{"start":31,"end":34}', spec("set noah's pages to 31-34"));
ok('a range in words, with an en dash too',
  spec('noah pages 31 to 34') === '{"start":31,"end":34}' && spec('noah pp. 31–34') === '{"start":31,"end":34}');
ok('a count alone', spec('clementine does 5 pages') === '{"count":5}', spec('clementine does 5 pages'));
ok('"set X to 5 pages" is a count, not a range', spec('set clementine to 5 pages') === '{"count":5}', spec('set clementine to 5 pages'));
ok('a first page alone', spec('noah starts on page 40') === '{"start":40}', spec('noah starts on page 40'));
ok('count and first page', spec('noah does 4 pages starting at 31') === '{"count":4,"start":31}', spec('noah does 4 pages starting at 31'));
ok('"page 31" alone is one page', spec('noah page 31') === '{"start":31,"count":1}', spec('noah page 31'));

// ---- the command, end to end over a stand-in database ----
function makeDb(tables) {
  const db = JSON.parse(JSON.stringify(tables));
  const copy = r => JSON.parse(JSON.stringify(r));
  const from = name => {
    let filters = [], op = 'select', payload = null, single = false, lim = null;
    const rows = () => (db[name] = db[name] || []).filter(r => filters.every(f => f(r)));
    const q = {
      select() { return q; },
      eq(c, v) { filters.push(r => r[c] === v); return q; },
      in(c, vs) { filters.push(r => vs.includes(r[c])); return q; },
      limit(n) { lim = n; return q; },
      maybeSingle() { single = true; return q; },
      update(p) { op = 'update'; payload = p; return q; },
      insert(p) { op = 'insert'; payload = p; return q; },
      delete() { op = 'delete'; return q; },
      then(res, rej) {
        try {
          if (op === 'insert') { db[name].push({ id: 'new' + db[name].length, ...copy(payload) }); return Promise.resolve({ error: null }).then(res, rej); }
          if (op === 'update') { rows().forEach(r => Object.assign(r, payload)); return Promise.resolve({ error: null }).then(res, rej); }
          if (op === 'delete') { const keep = db[name].filter(r => !filters.every(f => f(r))); db[name] = keep; return Promise.resolve({ error: null }).then(res, rej); }
          let out = rows().map(copy);
          if (lim != null) out = out.slice(0, lim);
          return Promise.resolve({ data: single ? (out[0] || null) : out, error: null }).then(res, rej);
        } catch (e) { return Promise.reject(e).then(res, rej); }
      },
    };
    return q;
  };
  return { db, from };
}

const noah = { id: 'p-noah', full_name: 'Noah Wren', first_name: 'Noah' };
const pella = { id: 'p-pella', full_name: 'Pella Ostrander', first_name: 'Pella' };

function setup(tables) {
  const stub = makeDb(tables);
  const said = { errors: [], messages: [], confirm: null, undo: null, success: [] };
  Object.assign(app, {
    auth: { supabase: { from: stub.from } },
    _terminalAllClasses: [{ id: 'c-math', name: 'Math 7' }, { id: 'c-art', name: 'Art' }],
    _rivenCanManageClass: c => c.id === 'c-math',
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    terminalPrintError: m => said.errors.push(m),
    _showRivenMessage: m => said.messages.push(m),
    _requestConfirmation: (m, fn) => { said.confirm = { m, fn }; },
    _pushUndo: (label, fn) => { said.undo = fn; },
    _naturalSuccess: l => said.success.push(...l),
    _rivenPolicyError: e => e,
  });
  return { db: stub.db, said };
}
const run = (text, st) => app.terminalSetPages({ original: text, student: st });

const base = () => ({
  assignments: [
    { id: 'w8', title: 'Workbook week 8', class_id: 'c-math', grading_type: 'pages', due_date: '2026-10-19T23:59:00Z', created_at: '2026-10-12', pages_continues_from: null },
    { id: 'w9', title: 'Workbook week 9', class_id: 'c-math', grading_type: 'pages', due_date: '2026-10-26T23:59:00Z', created_at: '2026-10-19', pages_continues_from: 'w8' },
    // Somebody else's class: never touched.
    { id: 'art1', title: 'Sketchbook', class_id: 'c-art', grading_type: 'pages', due_date: '2026-10-30T23:59:00Z', created_at: '2026-10-20', pages_continues_from: null },
  ],
  assignment_student_versions: [
    { id: 'v8', assignment_id: 'w8', student_id: 'p-noah', page_start: 23, page_end: 26 },
    { id: 'v9', assignment_id: 'w9', student_id: 'p-noah', page_start: 27, page_end: 30 },
    { id: 'v9p', assignment_id: 'w9', student_id: 'p-pella', page_start: 10, page_end: 13 },
  ],
  assignment_submissions: [],
});

(async () => {
  // A range, on the newest one he is on.
  let { db, said } = setup(base());
  await run("set noah's pages to 31-34", noah);
  ok('confirms, naming the assignment, the class and the change',
    said.confirm && /Workbook week 9/.test(said.confirm.m) && /Math 7/.test(said.confirm.m) && /pp\. 27–30 → <b>pp\. 31–34<\/b> \(4 pages\)/.test(said.confirm.m),
    said.confirm?.m || said.errors.join(' | '));
  const v9 = () => db.assignment_student_versions.find(v => v.id === 'v9');
  ok('nothing is written before Confirm', v9().page_start === 27);
  await said.confirm.fn();
  ok('Confirm writes his row only', v9().page_start === 31 && v9().page_end === 34
    && db.assignment_student_versions.find(v => v.id === 'v9p').page_start === 10, JSON.stringify(db.assignment_student_versions));
  ok('and says so', /Noah Wren is on pp\. 31–34 for Workbook week 9/.test(said.success[0]), said.success[0]);
  await said.undo();
  ok('undo puts his pages back', v9().page_start === 27 && v9().page_end === 30);

  // A count keeps his first page.
  ({ db, said } = setup(base()));
  await run('noah does 5 pages', noah);
  await said.confirm.fn();
  ok('a count keeps the first page', v9().page_start === 27 && v9().page_end === 31, JSON.stringify(v9()));

  // A first page keeps his count.
  ({ db, said } = setup(base()));
  await run('noah starts on page 40', noah);
  await said.confirm.fn();
  ok('a first page keeps the count', v9().page_start === 40 && v9().page_end === 43, JSON.stringify(v9()));

  // Named by title: the older one, and the number in its title is not a page.
  ({ db, said } = setup(base()));
  await run('set noah to 6 pages on workbook week 8', noah);
  await said.confirm.fn();
  const v8 = db.assignment_student_versions.find(v => v.id === 'v8');
  ok('a named assignment is the one changed, and "8" in its title is not a page',
    v8.page_start === 23 && v8.page_end === 28 && v9().page_end === 30, JSON.stringify(v8));

  // A student new to the series: a count alone carries on from where they
  // finished the one before.
  const t = base();
  t.assignment_student_versions.push({ id: 'v8p', assignment_id: 'w8', student_id: 'p-pella', page_start: 1, page_end: 9 });
  t.assignment_student_versions = t.assignment_student_versions.filter(v => v.id !== 'v9p');
  ({ db, said } = setup(t));
  await run('pella does 4 pages on workbook week 9', pella);
  ok('no pages yet: shown as such', said.confirm && /no pages → <b>pp\. 10–13<\/b>/.test(said.confirm.m), said.confirm?.m || said.errors.join(' | '));
  await said.confirm.fn();
  const fresh = () => db.assignment_student_versions.find(v => v.assignment_id === 'w9' && v.student_id === 'p-pella');
  ok('a row is made for her, carrying on from last time', fresh() && fresh().page_start === 10 && fresh().page_end === 13, JSON.stringify(fresh()));
  await said.undo();
  ok('undo removes the row it made', !fresh());

  // Nothing to carry on from and no first page: asks rather than guesses.
  const t2 = base();
  t2.assignment_student_versions = t2.assignment_student_versions.filter(v => v.student_id !== 'p-pella');
  ({ db, said } = setup(t2));
  await run('pella does 4 pages on workbook week 9', pella);
  ok('a count with nowhere to start asks for both', !said.confirm && /need both/.test(said.errors[0] || ''), said.errors.join(' | '));
  await run('pella does 4 pages', pella);
  ok('no assignment named and none she is on: asks which', /has no pages on any Workbook Pages assignment/.test(said.errors[1] || ''), said.errors.join(' | '));

  // Already graded: the grade stays, and the confirmation says so.
  const t3 = base();
  t3.assignment_submissions.push({ assignment_id: 'w9', student_id: 'p-noah', status: 'graded', grade: 'B' });
  ({ db, said } = setup(t3));
  await run("set noah's pages to 31-34", noah);
  ok('an existing grade is mentioned and left alone', /already have a <b>B<\/b>/.test(said.confirm?.m || ''), said.confirm?.m);

  // The same pages: nothing to confirm.
  ({ db, said } = setup(base()));
  await run("set noah's pages to 27-30", noah);
  ok('the same pages: says so, no confirmation', !said.confirm && /already on pp\. 27–30/.test(said.messages[0] || ''), said.messages.join(' | '));

  // Backwards.
  ({ db, said } = setup(base()));
  await run("set noah's pages to 34-31", noah);
  ok('a backwards range is refused', !said.confirm && /not a range/.test(said.errors[0] || ''), said.errors.join(' | '));

  // Another teacher's class is never searched.
  ({ db, said } = setup(base()));
  await run("set noah's pages on sketchbook to 1-4", noah);
  await said.confirm.fn();
  ok("another teacher's Pages assignment is not reachable",
    !db.assignment_student_versions.some(v => v.assignment_id === 'art1'), JSON.stringify(db.assignment_student_versions));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
