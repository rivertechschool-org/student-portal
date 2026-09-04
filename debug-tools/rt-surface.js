#!/usr/bin/env node
// Test harness for the /rt structured surface. Extracts the REAL methods from
// portal/index.html (brace-matched, same approach as nlp-stress.js) and runs
// them against an in-memory Supabase stub, so there is no drift between this
// harness and shipped code.
const fs = require('fs'), path = require('path');
const SRC = [path.join(__dirname,'..','portal','index.html'), path.join(process.cwd(),'portal','index.html')].find(fs.existsSync);
if (!SRC) { console.error('rt-surface: cannot find portal/index.html'); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');

function extract(name) {
  // handles both "  name(" and "  async name("
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  // Walk the PARAMETER list to its matching ')' first — a destructured param
  // like ({ scope = 'mine' } = {}) contains braces, so indexOf('{') would find
  // the parameter rather than the method body.
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '(') pd++; else if (c === ')') { pd--; if (pd === 0) { i++; break; } } }
  const parEnd = i;
  i = src.indexOf('{', parEnd);
  let depth = 0, start = i;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  const sig = src.slice(m.index + 1, parEnd).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^async\b/.test(sig);
  const Ctor = isAsync ? Object.getPrototypeOf(async function(){}).constructor : Function;
  return new Ctor(...splitArgs(args), src.slice(start + 1, i - 1));
}
// split top-level commas only (default values contain braces/commas)
function splitArgs(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) {
    if ('{[('.includes(ch)) d++; if ('}])'.includes(ch)) d--;
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// ---- in-memory Supabase stub ------------------------------------------------
const DB = {
  class_schedule: [
    { class_id: 'c1', day_of_week: 2, period: 3 },
    { class_id: 'c1', day_of_week: 4, period: 3 },
    { class_id: 'c5', day_of_week: 2, period: 6 },
  ],
  class_enrollments: [
    { id: 'e1', class_id: 'c1', student_id: 's1', status: 'active' },
    { id: 'e2', class_id: 'c1', student_id: 's2', status: 'active' },
    { id: 'e3', class_id: 'c1', student_id: 's3', status: 'active' },
    { id: 'e4', class_id: 'c5', student_id: 's1', status: 'active' },
    { id: 'e5', class_id: 'c7', student_id: 's1', status: 'active' },
    { id: 'e6', class_id: 'c7', student_id: 's3', status: 'active' },
  ],
  quarter_grade_snapshots: [
    { id: 'q1', enrollment_id: 'e1', quarter_id: 'Q1', participation_grade: 92, academic_grade: 88, class_grade: 90, class_grade_override: false, academic_grade_override: false },
    { id: 'q2', enrollment_id: 'e2', quarter_id: 'Q1', participation_grade: null, academic_grade: null, class_grade: null },
  ],
  quarters: [
    { id: 'Q1', name: 'Quarter 1', start_date: '2026-08-25', end_date: '2026-10-30', is_current: true, is_archived: false },
    { id: 'Q2', name: 'Quarter 2', start_date: '2026-11-01', end_date: '2027-01-15', is_current: false, is_archived: false },
  ],
  assignments: [
    { id: '11111111-1111-1111-1111-111111111111', class_id: 'c1', title: 'Storyboard', due_date: '2026-09-15T23:59:00.000Z', max_points: 100, grading_type: 'points', assignment_type: 'regular', is_published: true, graded_offline: false, assigned_to_all: true, rtc_reward: 0 },
  ],
  assignment_students: [],
  class_attendance: [
    { student_id: 's1', class_id: 'c1', date: '2026-09-01', status: 'present' },
    { student_id: 's2', class_id: 'c1', date: '2026-09-01', status: 'absent' },
  ],
};
let SEQ = 0;
const WRITES = [];
function qb(table) {
  let rows = (DB[table] || []).slice();
  let pending = null, filters = [];
  const api = {
    select() { return api; },
    eq(k, v) { filters.push([k, v]); rows = rows.filter(r => r[k] === v); return api; },
    in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return api; },
    order() { return api; }, gte() { return api; },
    limit(n) { rows = rows.slice(0, n); return api; },
    insert(payload) {
      const arr = Array.isArray(payload) ? payload : [payload];
      const made = arr.map(o => ({ id: 'new' + (++SEQ), ...o }));
      DB[table] = (DB[table] || []).concat(made);
      WRITES.push({ table, op: 'insert', rows: made });
      pending = made; return api;
    },
    update(patch) {
      const hit = (DB[table] || []).filter(r => filters.every(([k, v]) => r[k] === v));
      hit.forEach(r => Object.assign(r, patch));
      WRITES.push({ table, op: 'update', patch, n: hit.length });
      pending = hit; return api;
    },
    delete() {
      const keep = (DB[table] || []).filter(r => !filters.every(([k, v]) => r[k] === v));
      WRITES.push({ table, op: 'delete', n: (DB[table] || []).length - keep.length });
      DB[table] = keep; pending = []; return api;
    },
    single() { return { then: (res) => Promise.resolve({ data: (pending || rows)[0] || null, error: null }).then(res) }; },
    maybeSingle() { return api.single(); },
    then(res) { return Promise.resolve({ data: pending || rows, error: null }).then(res); },
  };
  return api;
}
// ---- app stub ---------------------------------------------------------------
const app = {
  auth: { supabase: { from: qb, rpc: async (name, args) => { WRITES.push({ rpc: name, args }); return { data: null, error: null }; } } },
  userInfo: { user: { id: 't1' }, profile: { id: 'p1', user_type: 'teacher' } },
  _terminalAllStudents: [
    { id: 's1', first_name: 'Jordan', last_name: 'Games', full_name: 'Jordan Games', rtc_balance: 100 },
    { id: 's2', first_name: 'Elijah', last_name: 'Douglas', full_name: 'Elijah Douglas', rtc_balance: 40 },
    { id: 's3', first_name: 'Eli', last_name: 'Morris', full_name: 'Eli Morris', rtc_balance: 55 },
    { id: 's4', first_name: 'Hegelund', last_name: 'Gamer', full_name: 'Hegelund Gamer', rtc_balance: 10 },
  ],
  _terminalAllClasses: [
    { id: 'c1', name: 'Filmmaking', subject: 'Art', teacher_id: 't1', secondary_teacher_id: null, is_active: true, status: 'open', teacher_name: 'Luke H' },
    { id: 'c5', name: 'Filmmaking Advanced', subject: 'Art', teacher_id: 't1', secondary_teacher_id: null, is_active: true, status: 'open', teacher_name: 'Luke H' },
    { id: 'c9', name: 'World History', subject: 'History', teacher_id: 't2', secondary_teacher_id: null, is_active: true, status: 'open', teacher_name: 'Someone Else' },
    { id: 'c7', name: 'Filmmaking Last Year', subject: 'Art', teacher_id: 't1', secondary_teacher_id: null, is_active: true, status: 'closed', teacher_name: 'Luke H' },
  ],
  escapeHtml: (s) => String(s),
  _pctToLetter: (v) => (v >= 90 ? 'A' : v >= 80 ? 'B' : v >= 70 ? 'C' : 'F'),
  _letterToPct: (l) => ({ a: 95, 'a-': 92, b: 85, 'b+': 88, 'b-': 82, c: 75, d: 65, f: 50 }[l] ?? null),
  _rivenCurrentQuarter: async () => ({ id: 'Q1', name: 'Quarter 1' }),
  _fetchAllNotes: async () => ({ rows: [
    { student_id: 's1', class_id: 'c1', note: 'Great work', sentiment: 'positive', category: 'behavior', visibility: 'staff', created_at: '2026-09-01T10:00:00Z' },
    { student_id: 's3', class_id: 'c1', note: 'Noisy', sentiment: 'negative', category: 'behavior', visibility: 'staff', created_at: '2026-09-01T11:00:00Z' },
    { student_id: 's3', class_id: 'c1', note: 'Noisy again', sentiment: 'negative', category: 'behavior', visibility: 'staff', created_at: '2026-09-02T11:00:00Z' },
    { student_id: 's3', class_id: 'c5', note: 'Other class', sentiment: 'negative', category: 'behavior', visibility: 'staff', created_at: '2026-09-02T12:00:00Z' },
  ] }),
  _showRivenMessage(html) { app._lastHtml = html; },
  terminalPrint() {}, terminalPrintError(m) { app._lastErr = m; },
  _rtcTxn: async ({ userId, amount, description }) => { WRITES.push({ rtc: userId, amount, description }); },
  _insertNote: async (o) => { WRITES.push({ note: o }); return { id: 'note' + (++SEQ) }; },
  _pushUndo(desc, fn) { app._undo = { desc, fn }; },
  _rivenFindEnrollment: async (classId, studentId) =>
    (DB.class_enrollments || []).find(e => e.class_id === classId && e.student_id === studentId) || null,
  _loadTerminalStudents: async () => {},
  _loadTerminalGroups: async () => { app._terminalAllGroups = app._terminalAllGroups || []; },
  _loadTerminalClasses: async () => {
    (DB.classes || []).forEach(c => {
      if (!app._terminalAllClasses.find(x => x.id === c.id)) {
        app._terminalAllClasses.push({ ...c, is_active: true, status: c.status || 'open', teacher_name: 'Luke H' });
      }
    });
  },
  _requestConfirmation(summary, execute) { app._pending = { summary, execute }; },
};
DB.classes = [];
for (const n of ['_rtOut','_rtErr','_rtErrFor','_rtResolveStudent','_rtResolveClass','_rtResolveClassSpec','_rtClassList','_rtRoster','_rtStudentSearch','_rtGrades','_rtGradeReview','_rtQuarters','_rtQuarterFor','_rtDueDate','_rtAssignmentFields','_rtResolveAssignment','_rtAssignments','_rtNotes','_rtAttendance','_rtPlan','_rtApply','_rtRunOps','_rtDispatch','_rtBundle','terminalRtCommand']) {
  const fn = extract(n);
  app[n] = function (...a) { return fn.apply(app, a); };
}
// capture the JSON /rt prints
async function rt(input) {
  app._lastHtml = '';
  await app.terminalRtCommand(input);
  const m = app._lastHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
  return m ? JSON.parse(m[1]) : null;
}

let pass = 0, fail = 0;
const t = (label, ok, got) => { ok ? pass++ : fail++; if (!ok) console.log('  FAIL', label, '\n        got:', JSON.stringify(got)); };

(async () => {
  console.log('== /rt structured surface ==');

  // ---- strict resolution: the whole point of the surface
  t('exact full name resolves', app._rtResolveStudent('Jordan Games').student?.id === 's1');
  t('unique first name resolves', app._rtResolveStudent('Jordan').student?.id === 's1');
  t('"eli" is NOT fuzzy-matched to Elijah', app._rtResolveStudent('eli').student?.id === 's3');
  t('last-initial form resolves', app._rtResolveStudent('Elijah D').student?.id === 's2');
  t('unknown name errors, never guesses', app._rtResolveStudent('Zebediah').error === 'not_found');
  t('typo errors rather than fuzzy-matching', app._rtResolveStudent('Jordn Games').error === 'not_found');
  t('id resolves', app._rtResolveStudent('s4').student?.id === 's4');
  const amb = app._rtResolveClass('Filmmaking');
  t('exact class name beats substring sibling', amb.row?.id === 'c1', amb);
  t('ambiguous class prefix errors with candidates', (() => { const r = app._rtResolveClass('Film'); return r.error === 'ambiguous' && r.candidates.length === 2; })(), app._rtResolveClass('Film'));
  t("другой teacher's class not in default scope", app._rtResolveClass('World History').error === 'not_found');
  t('scope:all reaches other classes', app._rtResolveClass('World History', { scope: 'all' }).row?.id === 'c9');

  // ---- reads
  const cls = await rt('{"op":"classes"}');
  t('classes returns only mine with schedule + counts',
    cls.classes.length === 2 && cls.classes[0].schedule.includes('Tue:P3') && cls.classes[0].students === 3, cls);
  const ros = await rt('{"op":"roster","class":"Filmmaking"}');
  t('roster lists 3 students sorted', ros.count === 3 && ros.students[0].name === 'Eli Morris', ros);
  const stu = await rt('{"op":"students","match":"eli"}');
  t('student search finds both Elis', stu.count === 2, stu);
  const gr = await rt('{"op":"grades","class":"Filmmaking"}');
  t('grades reports participation + nulls', gr.count === 3 && gr.grades.find(g => g.student === 'Jordan Games').participation.pct === 92, gr);
  const nt = await rt('{"op":"notes","class":"Filmmaking"}');
  t('notes filtered by class', nt.count === 3, nt);
  const att = await rt('{"op":"attendance","class":"Filmmaking","date":"2026-09-01"}');
  t('attendance returns records', att.records.length === 2, att);

  // ---- errors are structured, not prose
  const bad = await rt('{"op":"roster","class":"Film"}');
  t('ambiguous read errors with candidates', bad.error === 'ambiguous' && bad.candidates.length === 2, bad);
  const badjson = await rt('{nope');
  t('malformed JSON reports bad_json', badjson.error === 'bad_json', badjson);
  const unk = await rt('{"op":"frobnicate"}');
  t('unknown op is rejected', unk.error === 'unknown_op', unk);

  // ---- dry-run planner
  const plan = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'award', student: 'Jordan Games', amount: 5, reason: 'gold' },
    { op: 'group_award', class: 'Filmmaking', amount: 5 },
    { op: 'note', student: 'Eli Morris', class: 'Filmmaking', text: 'Making noise', sentiment: 'negative', category: 'behavior' },
    { op: 'grade', student: 'Jordan Games', class: 'Filmmaking', component: 'participation', value: 'B' },
  ] }));
  t('plan never executes', plan.executed === false && plan.dry_run === true, { e: plan.executed });
  t('plan resolves all 4 steps', plan.ok === true && plan.steps_planned === 4, plan.errors);
  t('award shows balance before/after', plan.steps[0].balance_before === 100 && plan.steps[0].balance_after === 105, plan.steps[0]);
  t('group_award prices the whole class', plan.steps[1].students === 3 && plan.steps[1].total_rtc === 15, plan.steps[1]);
  t('grade letter converts and shows prior value',
    plan.steps[3].after === '85 (B)' && plan.steps[3].before === '92 (A)', plan.steps[3]);
  t('grade change is itemized for review',
    plan.needs_review.some(x => x.kind === 'grade_change'), plan.needs_review);

  const plan2 = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'deduct', student: 'Eli Morris', amount: 3 },
    { op: 'grade', student: 'Hegelund Gamer', class: 'Filmmaking', component: 'participation', value: 80 },
    { op: 'award', student: 'Nobody', amount: 5 },
  ] }));
  t('deduction itemized for review', plan2.needs_review.some(x => x.kind === 'rtc_deduction'), plan2.needs_review);
  t('not-enrolled grade is caught', plan2.errors.some(e => e.error === 'not_enrolled'), plan2.errors);
  t('unknown student fails the plan', plan2.ok === false && plan2.errors.some(e => e.error === 'not_found'), plan2.errors);
  t('a failing plan still reports its good steps', plan2.steps.length === 1, plan2.steps);

  const plan3 = await rt(JSON.stringify({ op: 'plan', ops: [{ op: 'award', student: 'eli', amount: -5 }] }));
  t('negative award amount rejected', plan3.errors.some(e => e.error === 'bad_amount'), plan3.errors);

  // ---- class_with: name a class by who sits in it
  const cw = await rt('{"op":"roster","class_with":["Jordan Games","Eli Morris"]}');
  t('class_with identifies the section from its roster', cw.class?.name === 'Filmmaking' && cw.count === 3, cw);
  const cw2 = await rt('{"op":"roster","class_with":["Jordan Games"]}');
  t('class_with spanning 2 classes is ambiguous, not a guess', cw2.error === 'ambiguous' && cw2.candidates.length === 2, cw2);
  const cw3 = await rt('{"op":"roster","class_with":["Hegelund Gamer"]}');
  t('class_with matching no class errors', cw3.error === 'not_found', cw3);
  const cw4 = await rt('{"op":"roster","class_with":["Nobody At All"]}');
  t('unresolvable student inside class_with errors', cw4.error === 'not_found', cw4);

  const cwPlan = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'group_award', class_with: ['Jordan Games', 'Eli Morris'], amount: 5 },
    { op: 'note', student: 'Eli Morris', class_with: ['Jordan Games', 'Eli Morris'], text: 'Noisy', sentiment: 'negative' },
  ] }));
  t('class_with works inside plan ops', cwPlan.ok === true && cwPlan.steps[0].class === 'Filmmaking' && cwPlan.steps[1].class === 'Filmmaking', cwPlan);

  // ---- bundle: every read plus the plan in ONE call
  const bun = await rt(JSON.stringify({ op: 'bundle',
    reads: [
      { op: 'classes', as: 'classes' },
      { op: 'students', match: 'eli', as: 'elis' },
      { op: 'roster', class_with: ['Jordan Games', 'Eli Morris'], as: 'roster' },
      { op: 'grades', class_with: ['Jordan Games', 'Eli Morris'], as: 'grades' },
      { op: 'attendance', class_with: ['Jordan Games', 'Eli Morris'], as: 'attendance' },
      { op: 'roster', class: 'Film', as: 'broken' },
    ],
    plan: { ops: [{ op: 'award', student: 'Jordan Games', amount: 5 }] }
  }));
  t('bundle returns every read under its key',
    Object.keys(bun.reads).length === 6 && bun.reads.classes.classes.length === 2 && bun.reads.elis.count === 2, Object.keys(bun.reads || {}));
  t('bundle resolves class_with reads', bun.reads.roster.count === 3 && bun.reads.grades.count === 3, bun.reads.roster);
  t('a failing read does not abort the bundle', bun.reads.broken.error === 'ambiguous' && bun.reads.classes.classes.length === 2, bun.reads.broken);
  t('bundle carries the dry-run plan', bun.plan.dry_run === true && bun.plan.steps_planned === 1, bun.plan);
  t('bundle still writes nothing', bun.plan.executed === false, bun.plan);
  const badnest = await rt('{"op":"bundle","reads":[{"op":"bundle"}]}');
  t('bundle cannot nest', badnest.reads.bundle.error === 'bad_op', badnest);

  // regression: a class closed for the year polluted class_with candidates and
  // made a live lookup ambiguous, even though it cannot appear in "classes"
  const closed = await rt('{"op":"roster","class_with":["Jordan Games","Eli Morris"]}');
  t('closed class excluded from class_with candidates', closed.class?.name === 'Filmmaking', closed);
  const amb2 = await rt('{"op":"roster","class":"Film"}');
  t('ambiguity message pluralises "classes" correctly', /matches \d+ classes /.test(amb2.message), amb2.message);

  // ---- apply: writes, then reads back, in one paste
  WRITES.length = 0; app._pending = null;
  const ap = await rt(JSON.stringify({ op: 'apply',
    ops: [
      { op: 'create_class', name: 'Film Club', subject: 'Art' },
      { op: 'enroll', class: 'Film Club', from_class: 'Filmmaking Advanced' },
      { op: 'award', student: 'Jordan Games', amount: 5, reason: 'gold' }
    ],
    reads: [{ op: 'classes', as: 'after' }] }));
  t('apply asks for ONE confirmation, not one per op', ap.awaiting_confirmation === true && !!app._pending, ap);
  t('apply writes nothing before confirmation', WRITES.length === 0 && ap.executed === false, WRITES.length);
  t('apply previews a class it will create', ap.steps.some(s => s.op === 'create_class' && s.name === 'Film Club'), ap.steps);

  await app._pending.execute();
  const out = JSON.parse(app._lastHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]);
  t('apply reports executed after confirming', out.executed === true && out.failed === 0, out.failures);
  t('create_class actually inserted', WRITES.some(w => w.table === 'classes' && w.op === 'insert'), null);
  t('enroll copied the source roster', out.results.find(r => r.op === 'enroll')?.enrolled === 1, out.results);
  t('award hit the RTC ledger', WRITES.some(w => w.rtc && w.amount === 5), null);
  t('a later op used the class created earlier in the same batch',
    out.results.find(r => r.op === 'enroll')?.class === 'Film Club', out.results);
  t('read-back runs after the writes', !!out.verification?.after?.classes, out.verification);
  t('the whole batch gets ONE undo entry', /rt batch/.test(app._undo?.desc || ''), app._undo?.desc);

  // a plan error must block every write
  WRITES.length = 0; app._pending = null;
  const blocked = await rt(JSON.stringify({ op: 'apply',
    ops: [{ op: 'award', student: 'Jordan Games', amount: 5 }, { op: 'award', student: 'Ghost Person', amount: 5 }] }));
  t('one bad op blocks the entire batch', blocked.blocked === true && blocked.executed === false, blocked);
  t('a blocked batch writes nothing and never asks to confirm', WRITES.length === 0 && !app._pending, WRITES.length);

  // ---- grade_review: notes and grades side by side, without linking them
  const gv = await rt('{"op":"grade_review","class":"Filmmaking"}');
  t('grade_review covers the whole roster', gv.count === 3 && gv.with_notes === 2, gv);
  t('concerns sort to the top', gv.students[0].student === 'Eli Morris' && gv.students[0].note_counts.negative === 2, gv.students.map(x => x.student));
  t('grade_review shows current grades beside the notes',
    gv.students.find(x => x.student === 'Jordan Games').participation.pct === 92, gv.students);
  t('notes from another class are not counted',
    gv.students[0].note_counts.total === 2, gv.students[0].note_counts);
  t('a student with no notes still appears',
    gv.students.some(x => x.note_counts.total === 0), gv.students);
  t('grade_review writes nothing and says so', /never change a grade/.test(gv.reminder), gv.reminder);

  // regression: a group op on a class created in the SAME batch previewed as
  // "0 students, 0 RTC" and then moved real RTC on confirm
  const newcls = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'create_class', name: 'Brand New', subject: 'Art' },
    { op: 'enroll', class: 'Brand New', from_class: 'Filmmaking' },
    { op: 'group_award', class: 'Brand New', amount: 5 },
  ] }));
  const ga = newcls.steps.find(x => x.op === 'group_award');
  t('group op on a batch-created class previews the real size', ga.students === 3 && ga.total_rtc === 15, ga);
  t('an estimated preview says it is estimated', ga.estimated_from_batch === true, ga);

  // ---- assignments
  const due = app._rtDueDate('2026-09-18');
  t('a bare date means END of that day', /T\d{2}:\d{2}/.test(due.iso) && due.end_of_day === true, due);
  t('a nonsense date is rejected', !!app._rtDueDate('not-a-date').error, app._rtDueDate('not-a-date'));
  const qs = await app._rtQuarters();
  t('due date maps to the right quarter', app._rtQuarterFor('2026-09-18', qs) === 'Quarter 1', app._rtQuarterFor('2026-09-18', qs));
  t('a date in no quarter maps to null', app._rtQuarterFor('2027-07-04', qs) === null, app._rtQuarterFor('2027-07-04', qs));

  const alist = await rt('{"op":"assignments","class":"Filmmaking"}');
  t('assignments read reports the derived quarter', alist.assignments[0].quarter === 'Quarter 1', alist.assignments[0]);

  const ap2 = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'create_assignment', class: 'Filmmaking', title: 'Shot List', due: '2026-09-20', points: 50, description: '<p>Ten shots</p>' },
    { op: 'create_assignment', class: 'Filmmaking', title: 'Summer Thing', due: '2027-07-04' },
    { op: 'create_assignment', class: 'Filmmaking', title: 'Syllabus', type: 'info' },
    { op: 'edit_assignment', assignment: 'Storyboard', class: 'Filmmaking', set: { due: '2026-09-25', points: 75 } },
  ] }));
  t('create_assignment plans with quarter + defaults',
    ap2.steps[0].quarter === 'Quarter 1' && ap2.steps[0].points === 50 && ap2.steps[0].published === true, ap2.steps[0]);
  t('a due date outside every quarter is flagged',
    !!ap2.steps[1].warnings && ap2.needs_review.some(r => r.kind === 'due_date'), ap2.steps[1]);
  t('type info needs no due date', ap2.steps[2].type === 'info' && ap2.ok === true, ap2.errors);
  t('edit_assignment shows before and after for only the named fields',
    ap2.steps[3].changing.join(',') === 'max_points,due_date' || ap2.steps[3].changing.includes('max_points'), ap2.steps[3]);
  t('edit_assignment does not touch unnamed fields',
    !ap2.steps[3].changing.includes('title'), ap2.steps[3].changing);

  const badf = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'create_assignment', class: 'Filmmaking', title: 'X', due: '2026-09-20', grading_type: 'bogus' } ] }));
  t('an invalid grading_type is rejected', badf.errors.some(e => e.error === 'bad_field'), badf.errors);
  const nodue = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'create_assignment', class: 'Filmmaking', title: 'X' } ] }));
  t('a regular assignment with no due date is rejected', nodue.errors.some(e => /due is required/.test(e.message)), nodue.errors);
  const noedit = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'edit_assignment', assignment: 'Storyboard', class: 'Filmmaking', set: {} } ] }));
  t('an edit with nothing to change is rejected', noedit.errors.some(e => e.error === 'missing_field'), noedit.errors);

  // execute a create + edit and read back
  WRITES.length = 0; app._pending = null;
  const aap = await rt(JSON.stringify({ op: 'apply',
    ops: [{ op: 'create_assignment', class: 'Filmmaking', title: 'Bulk One', due: '2026-09-22', points: 20 }],
    reads: [{ op: 'assignments', class: 'Filmmaking', as: 'after' }] }));
  t('assignment apply waits for confirmation', aap.awaiting_confirmation === true, aap);
  await app._pending.execute();
  const aout = JSON.parse(app._lastHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]);
  t('assignment created and read back', aout.executed === true && aout.failed === 0
    && aout.verification.after.assignments.some(a => a.title === 'Bulk One'), aout.failures);

  const help = await rt('');
  t('help states apply is the only writer', help.writes === 'apply writes. Every other op is read-only.', help.writes);
  t('help documents apply and its extra ops', !!help.apply && help.apply.extra_ops.includes('create_class'), help.apply);

  console.log(`\nrt-surface: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
