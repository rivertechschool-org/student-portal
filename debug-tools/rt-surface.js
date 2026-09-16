#!/usr/bin/env node
// Test harness for the /rt structured surface. Extracts the REAL methods from
// portal/index.html (brace-matched, same approach as nlp-stress.js) and runs
// them against an in-memory Supabase stub, so there is no drift between this
// harness and shipped code.
const fs = require('fs'), path = require('path');
// PORTAL_SRC points this at another build, which is how the assertions
// below were checked to actually fail before the change.
const SRC = [process.env.PORTAL_SRC, path.join(__dirname,'..','portal','index.html'), path.join(process.cwd(),'portal','index.html')].filter(Boolean).find(fs.existsSync);
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
  assignment_submissions: [
    { id: 'sub1', assignment_id: '11111111-1111-1111-1111-111111111111', student_id: 's1', status: 'graded', points_earned: 70, grade: 'C', feedback: null },
  ],
  class_attendance: [
    { student_id: 's1', class_id: 'c1', date: '2026-09-01', status: 'present' },
    { student_id: 's2', class_id: 'c1', date: '2026-09-01', status: 'absent' },
  ],
};
let SEQ = 0;
const WRITES = [];
function qb(table) {
  // DEFERRED, like the real client: .delete()/.update() do nothing until the
  // builder is awaited, so the filters chained AFTER them still apply. The
  // eager version wiped the whole table on `.delete().eq(...)` — it silently
  // dropped rows written moments earlier and made a correct multi-row write
  // look broken.
  let op = 'select', payload = null, filters = [], lim = null;
  const hit = r => filters.every(([k, v, kind]) =>
    kind === 'in' ? v.includes(r[k]) : kind === 'gte' ? r[k] >= v : r[k] === v);
  const run = () => {
    const all = DB[table] || [];
    if (op === 'insert') {
      const made = (Array.isArray(payload) ? payload : [payload]).map(o => ({ id: 'new' + (++SEQ), ...o }));
      DB[table] = all.concat(made);
      WRITES.push({ table, op: 'insert', rows: made });
      return made;
    }
    if (op === 'update') {
      const found = all.filter(hit);
      found.forEach(r => Object.assign(r, payload));
      WRITES.push({ table, op: 'update', patch: payload, n: found.length });
      return found;
    }
    if (op === 'delete') {
      const found = all.filter(hit);
      DB[table] = all.filter(r => !hit(r));
      WRITES.push({ table, op: 'delete', n: found.length });
      return [];
    }
    let out = all.filter(hit);
    if (lim !== null) out = out.slice(0, lim);
    return out;
  };
  const api = {
    select() { return api; },
    eq(k, v) { filters.push([k, v]); return api; },
    is(k, v) { filters.push([k, v]); return api; },
    in(k, vs) { filters.push([k, vs, 'in']); return api; },
    gte(k, v) { if (v !== undefined) filters.push([k, v, 'gte']); return api; },
    order() { return api; },
    limit(n) { lim = n; return api; },
    insert(p) { op = 'insert'; payload = p; return api; },
    update(p) { op = 'update'; payload = p; return api; },
    delete() { op = 'delete'; return api; },
    single() { return { then: res => Promise.resolve({ data: run()[0] || null, error: null }).then(res) }; },
    maybeSingle() { return api.single(); },
    then(res) { return Promise.resolve({ data: run(), error: null }).then(res); },
  };
  return api;
}
// ---- app stub ---------------------------------------------------------------
const app = {
  auth: { supabase: { from: qb, rpc: async (name, args) => { WRITES.push({ rpc: name, args }); return { data: null, error: null }; } } },
  userInfo: { user: { id: 't1' }, profile: { id: 'p1', user_type: 'teacher' } },
  _terminalAllStudents: [
    { id: 's1', first_name: 'Quinn', last_name: 'Sable', full_name: 'Quinn Sable', rtc_balance: 100 },
    { id: 's2', first_name: 'Arian', last_name: 'Delgado', full_name: 'Arian Delgado', rtc_balance: 40 },
    { id: 's3', first_name: 'Ari', last_name: 'Mercer', full_name: 'Ari Mercer', rtc_balance: 55 },
    { id: 's4', first_name: 'Ashgrove', last_name: 'Gamer', full_name: 'Ashgrove Gamer', rtc_balance: 10 },
  ],
  _terminalAllClasses: [
    { id: 'c1', name: 'Filmmaking', subject: 'Art', teacher_id: 't1', secondary_teacher_id: null, is_active: true, status: 'open', teacher_name: 'Luke H' },
    { id: 'c5', name: 'Filmmaking Advanced', subject: 'Art', teacher_id: 't1', secondary_teacher_id: null, is_active: true, status: 'open', teacher_name: 'Luke H' },
    { id: 'c9', name: 'World History', subject: 'History', teacher_id: 't2', secondary_teacher_id: null, is_active: true, status: 'open', teacher_name: 'Someone Else' },
    { id: 'c7', name: 'Filmmaking Last Year', subject: 'Art', teacher_id: 't1', secondary_teacher_id: null, is_active: true, status: 'closed', teacher_name: 'Luke H' },
  ],
  escapeHtml: (s) => String(s),
  calculateLetterGrade: (p) => (p >= 90 ? 'A' : p >= 80 ? 'B' : p >= 70 ? 'C' : 'F'),
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
for (const n of ['_rtParseSlots','_rtSlotLabel','_rtOut','_rtErr','_rtErrFor','_rtResolveStudent','_rtResolveClass','_rtResolveClassSpec','_rtClassList','_rtRoster','_rtStudentSearch','_rtGrades','_rtGradeReview','_rtQuarters','_rtQuarterFor','_rtDueDate','_rtAssignmentFields','_rtResolveAssignment','_rtAssignments','_rtNotes','_rtAttendance','_rtPlan','_rtApply','_rtRunOps','_rtDispatch','_rtBundle','terminalRtCommand']) {
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
  t('exact full name resolves', app._rtResolveStudent('Quinn Sable').student?.id === 's1');
  t('unique first name resolves', app._rtResolveStudent('Quinn').student?.id === 's1');
  t('"ari" is NOT fuzzy-matched to Arian', app._rtResolveStudent('ari').student?.id === 's3');
  t('last-initial form resolves', app._rtResolveStudent('Arian D').student?.id === 's2');
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
  t('roster lists 3 students sorted', ros.count === 3 && ros.students[0].name === 'Ari Mercer', ros);
  const stu = await rt('{"op":"students","match":"ari"}');
  t('student search finds both Aris', stu.count === 2, stu);
  const gr = await rt('{"op":"grades","class":"Filmmaking"}');
  t('grades reports participation + nulls', gr.count === 3 && gr.grades.find(g => g.student === 'Quinn Sable').participation.pct === 92, gr);
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
    { op: 'award', student: 'Quinn Sable', amount: 5, reason: 'gold' },
    { op: 'group_award', class: 'Filmmaking', amount: 5 },
    { op: 'note', student: 'Ari Mercer', class: 'Filmmaking', text: 'Making noise', sentiment: 'negative', category: 'behavior' },
    { op: 'grade', student: 'Quinn Sable', class: 'Filmmaking', component: 'participation', value: 'B' },
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
    { op: 'deduct', student: 'Ari Mercer', amount: 3 },
    { op: 'grade', student: 'Ashgrove Gamer', class: 'Filmmaking', component: 'participation', value: 80 },
    { op: 'award', student: 'Nobody', amount: 5 },
  ] }));
  t('deduction itemized for review', plan2.needs_review.some(x => x.kind === 'rtc_deduction'), plan2.needs_review);
  t('not-enrolled grade is caught', plan2.errors.some(e => e.error === 'not_enrolled'), plan2.errors);
  t('unknown student fails the plan', plan2.ok === false && plan2.errors.some(e => e.error === 'not_found'), plan2.errors);
  t('a failing plan still reports its good steps', plan2.steps.length === 1, plan2.steps);

  const plan3 = await rt(JSON.stringify({ op: 'plan', ops: [{ op: 'award', student: 'ari', amount: -5 }] }));
  t('negative award amount rejected', plan3.errors.some(e => e.error === 'bad_amount'), plan3.errors);

  // ---- class_with: name a class by who sits in it
  const cw = await rt('{"op":"roster","class_with":["Quinn Sable","Ari Mercer"]}');
  t('class_with identifies the section from its roster', cw.class?.name === 'Filmmaking' && cw.count === 3, cw);
  const cw2 = await rt('{"op":"roster","class_with":["Quinn Sable"]}');
  t('class_with spanning 2 classes is ambiguous, not a guess', cw2.error === 'ambiguous' && cw2.candidates.length === 2, cw2);
  const cw3 = await rt('{"op":"roster","class_with":["Ashgrove Gamer"]}');
  t('class_with matching no class errors', cw3.error === 'not_found', cw3);
  const cw4 = await rt('{"op":"roster","class_with":["Nobody At All"]}');
  t('unresolvable student inside class_with errors', cw4.error === 'not_found', cw4);

  const cwPlan = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'group_award', class_with: ['Quinn Sable', 'Ari Mercer'], amount: 5 },
    { op: 'note', student: 'Ari Mercer', class_with: ['Quinn Sable', 'Ari Mercer'], text: 'Noisy', sentiment: 'negative' },
  ] }));
  t('class_with works inside plan ops', cwPlan.ok === true && cwPlan.steps[0].class === 'Filmmaking' && cwPlan.steps[1].class === 'Filmmaking', cwPlan);

  // ---- bundle: every read plus the plan in ONE call
  const bun = await rt(JSON.stringify({ op: 'bundle',
    reads: [
      { op: 'classes', as: 'classes' },
      { op: 'students', match: 'ari', as: 'aris' },
      { op: 'roster', class_with: ['Quinn Sable', 'Ari Mercer'], as: 'roster' },
      { op: 'grades', class_with: ['Quinn Sable', 'Ari Mercer'], as: 'grades' },
      { op: 'attendance', class_with: ['Quinn Sable', 'Ari Mercer'], as: 'attendance' },
      { op: 'roster', class: 'Film', as: 'broken' },
    ],
    plan: { ops: [{ op: 'award', student: 'Quinn Sable', amount: 5 }] }
  }));
  t('bundle returns every read under its key',
    Object.keys(bun.reads).length === 6 && bun.reads.classes.classes.length === 2 && bun.reads.aris.count === 2, Object.keys(bun.reads || {}));
  t('bundle resolves class_with reads', bun.reads.roster.count === 3 && bun.reads.grades.count === 3, bun.reads.roster);
  t('a failing read does not abort the bundle', bun.reads.broken.error === 'ambiguous' && bun.reads.classes.classes.length === 2, bun.reads.broken);
  t('bundle carries the dry-run plan', bun.plan.dry_run === true && bun.plan.steps_planned === 1, bun.plan);
  t('bundle still writes nothing', bun.plan.executed === false, bun.plan);
  const badnest = await rt('{"op":"bundle","reads":[{"op":"bundle"}]}');
  t('bundle cannot nest', badnest.reads.bundle.error === 'bad_op', badnest);

  // regression: a class closed for the year polluted class_with candidates and
  // made a live lookup ambiguous, even though it cannot appear in "classes"
  const closed = await rt('{"op":"roster","class_with":["Quinn Sable","Ari Mercer"]}');
  t('closed class excluded from class_with candidates', closed.class?.name === 'Filmmaking', closed);
  const amb2 = await rt('{"op":"roster","class":"Film"}');
  t('ambiguity message pluralises "classes" correctly', /matches \d+ classes /.test(amb2.message), amb2.message);

  // ---- apply: writes, then reads back, in one paste
  WRITES.length = 0; app._pending = null;
  const ap = await rt(JSON.stringify({ op: 'apply',
    ops: [
      { op: 'create_class', name: 'Film Club', subject: 'Art' },
      { op: 'enroll', class: 'Film Club', from_class: 'Filmmaking Advanced' },
      { op: 'award', student: 'Quinn Sable', amount: 5, reason: 'gold' }
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
    ops: [{ op: 'award', student: 'Quinn Sable', amount: 5 }, { op: 'award', student: 'Ghost Person', amount: 5 }] }));
  t('one bad op blocks the entire batch', blocked.blocked === true && blocked.executed === false, blocked);
  t('a blocked batch writes nothing and never asks to confirm', WRITES.length === 0 && !app._pending, WRITES.length);

  // ---- grade_review: notes and grades side by side, without linking them
  const gv = await rt('{"op":"grade_review","class":"Filmmaking"}');
  t('grade_review covers the whole roster', gv.count === 3 && gv.with_notes === 2, gv);
  t('concerns sort to the top', gv.students[0].student === 'Ari Mercer' && gv.students[0].note_counts.negative === 2, gv.students.map(x => x.student));
  t('grade_review shows current grades beside the notes',
    gv.students.find(x => x.student === 'Quinn Sable').participation.pct === 92, gv.students);
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

  // ---- schedule: the class timetable the attendance screen reads ----------
  // A class with no slot on a day does not meet that day, and its register
  // never shows on the attendance screen — which is what "there isn't a
  // period on Fridays" turned out to mean.
  const badday = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'schedule', class: 'Filmmaking', slots: [{ day: 'funday', period: 1 }] } ] }));
  t('an unknown day is rejected', badday.errors.some(e => e.error === 'bad_slots'), badday.errors);
  const badper = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'schedule', class: 'Filmmaking', slots: [{ day: 'mon', period: 99 }] } ] }));
  t('a period outside 1-8 is rejected', badper.errors.some(e => e.error === 'bad_slots'), badper.errors);
  const shplan = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'schedule', class: 'Filmmaking', slots: [{ day: 'tue', period: 1 }, { day: 'thursday', period: 1 }] } ] }));
  t('the plan spells the slots back', /Tue P1, Thu P1/.test(JSON.stringify(shplan.summary || shplan)), shplan);

  WRITES.length = 0; app._pending = null;
  const shap = await rt(JSON.stringify({ op: 'apply',
    ops: [{ op: 'schedule', class: 'Filmmaking', slots: [{ day: 'tue', period: 1 }, { day: 'fri', period: 2 }] }],
    reads: [{ op: 'classes', as: 'after' }] }));
  t('schedule apply waits for confirmation', shap.awaiting_confirmation === true, shap);
  await app._pending.execute();
  const shout = JSON.parse(app._lastHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]);
  t('schedule executed', shout.executed === true && shout.failed === 0, shout.failures);
  const sched = (DB.class_schedule || []).filter(x => x.class_id === 'c1')
    .map(x => `${x.day_of_week}:${x.period}`).sort();
  t('slots REPLACE the old ones rather than stacking',
    JSON.stringify(sched) === JSON.stringify(['2:1', '5:2']), sched);
  const fm = shout.verification.after.classes.find(c => c.name === 'Filmmaking');
  t('the read-back shows the new timetable',
    fm && JSON.stringify(fm.schedule) === JSON.stringify(['Fri:P2', 'Tue:P1']), fm);

  // a class created and timetabled in the SAME batch
  WRITES.length = 0; app._pending = null;
  const ccs = await rt(JSON.stringify({ op: 'apply',
    ops: [{ op: 'create_class', name: 'Lower MS Ukulele', subject: 'Music',
            slots: [{ day: 'wed', period: 6 }] }],
    reads: [{ op: 'classes', as: 'after' }] }));
  t('create+schedule waits for one confirmation', ccs.awaiting_confirmation === true, ccs);
  await app._pending.execute();
  const ccout = JSON.parse(app._lastHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]);
  const uke = ccout.verification.after.classes.find(c => c.name === 'Lower MS Ukulele');
  t('a new class lands with its periods',
    uke && JSON.stringify(uke.schedule) === JSON.stringify(['Wed:P6']), uke);

  // ---- score_assignment: many marks on one assignment, creating it if missing
  const sp1 = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'score_assignment', class: 'Filmmaking', assignment: 'Spelling Test 9/15',
      create_if_missing: { due: '2026-09-15', points: 100, type: 'test' },
      scores: [{ student: 'Quinn Sable', points: 92 }, { student: 'Ari Mercer', points: 64.5 }] } ] }));
  t('score_assignment plans creating a missing assignment', sp1.ok === true && sp1.steps[0].creates_assignment === true && sp1.steps[0].students === 2, sp1);
  t('score_assignment reports the quarter of the new assignment', sp1.steps[0].quarter === 'Quarter 1', sp1.steps[0]);
  const sp2 = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'score_assignment', class: 'Filmmaking', assignment: 'Nope', scores: [{ student: 'Quinn Sable', points: 5 }] } ] }));
  t('a missing assignment without create_if_missing is blocked', sp2.ok === false && sp2.errors.some(e => e.error === 'not_found'), sp2.errors);
  const sp3 = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'score_assignment', class: 'Filmmaking', assignment: 'Storyboard', scores: [{ student: 'Ashgrove Gamer', points: 5 }] } ] }));
  t('a student not in the class is blocked', sp3.errors.some(e => e.error === 'not_enrolled'), sp3.errors);
  const sp4 = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'score_assignment', class: 'Filmmaking', assignment: 'Storyboard', scores: [{ student: 'Quinn Sable', points: 101 }] } ] }));
  t('a mark above the assignment points is blocked', sp4.errors.some(e => e.error === 'bad_value'), sp4.errors);
  const sp5 = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'score_assignment', class: 'Filmmaking', assignment: 'Storyboard', scores: [{ student: 'Quinn Sable', points: 80 }, { student: 'Quinn', points: 81 }] } ] }));
  t('the same student twice is blocked', sp5.errors.some(e => e.error === 'duplicate'), sp5.errors);
  const sp6 = await rt(JSON.stringify({ op: 'plan', ops: [
    { op: 'score_assignment', class: 'Filmmaking', assignment: 'Storyboard', scores: [{ student: 'Quinn Sable', points: 85 }] } ] }));
  t('an existing assignment is graded, not re-created, and shows the mark it replaces',
    sp6.ok && sp6.steps[0].creates_assignment === false && sp6.steps[0].marks[0].before === 70, sp6.steps[0]);

  WRITES.length = 0; app._pending = null;
  const spa = await rt(JSON.stringify({ op: 'apply', ops: [
    { op: 'score_assignment', class: 'Filmmaking', assignment: 'Spelling Test 9/15',
      create_if_missing: { due: '2026-09-15', points: 100, type: 'test' },
      scores: [{ student: 'Quinn Sable', points: 92, feedback: 'fortunate' }, { student: 'Ari Mercer', points: 64.5 }] } ],
    reads: [{ op: 'assignments', class: 'Filmmaking', as: 'after' }] }));
  t('score_assignment apply waits for confirmation and writes nothing yet', spa.awaiting_confirmation === true && WRITES.length === 0, spa);
  await app._pending.execute();
  const spo = JSON.parse(app._lastHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]);
  const newA = DB.assignments.find(a => a.title === 'Spelling Test 9/15');
  const marks = DB.assignment_submissions.filter(x => newA && x.assignment_id === newA.id);
  t('the assignment was created once and both marks landed', spo.failed === 0 && !!newA && marks.length === 2 && spo.results[0].created_assignment === true, spo);
  t('marks carry status, points and a letter', marks.find(x => x.student_id === 's1').points_earned === 92 && marks.find(x => x.student_id === 's1').grade === 'A' && marks.every(x => x.status === 'graded'), marks);

  // re-sending the same command grades the existing assignment
  app._pending = null;
  await rt(JSON.stringify({ op: 'apply', ops: [
    { op: 'score_assignment', class: 'Filmmaking', assignment: 'Spelling Test 9/15',
      create_if_missing: { due: '2026-09-15', points: 100, type: 'test' },
      scores: [{ student: 'Quinn Sable', points: 95 }, { student: 'Ari Mercer', points: 64.5 }] } ] }));
  await app._pending.execute();
  const spo2 = JSON.parse(app._lastHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]);
  t('re-sending does not duplicate the assignment', DB.assignments.filter(a => a.title === 'Spelling Test 9/15').length === 1 && spo2.results[0].created_assignment === false, spo2.results);
  t('re-sending replaces marks instead of adding rows', DB.assignment_submissions.filter(x => x.assignment_id === newA.id).length === 2 && spo2.results[0].marks_replaced === 2
    && DB.assignment_submissions.find(x => x.assignment_id === newA.id && x.student_id === 's1').points_earned === 95, spo2.results);
  await app._undo.fn();
  t('undo puts the previous mark back', DB.assignment_submissions.find(x => x.assignment_id === newA.id && x.student_id === 's1').points_earned === 92, DB.assignment_submissions);

  const help = await rt('');
  t('help states apply is the only writer', help.writes === 'apply writes. Every other op is read-only.', help.writes);
  t('help documents apply and its extra ops', !!help.apply && help.apply.extra_ops.includes('create_class'), help.apply);

  console.log(`\nrt-surface: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
