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
  ],
  quarter_grade_snapshots: [
    { id: 'q1', enrollment_id: 'e1', quarter_id: 'Q1', participation_grade: 92, academic_grade: 88, class_grade: 90, class_grade_override: false, academic_grade_override: false },
    { id: 'q2', enrollment_id: 'e2', quarter_id: 'Q1', participation_grade: null, academic_grade: null, class_grade: null },
  ],
  class_attendance: [
    { student_id: 's1', class_id: 'c1', date: '2026-09-01', status: 'present' },
    { student_id: 's2', class_id: 'c1', date: '2026-09-01', status: 'absent' },
  ],
};
function qb(table) {
  let rows = (DB[table] || []).slice();
  const api = {
    select() { return api; },
    eq(k, v) { rows = rows.filter(r => r[k] === v); return api; },
    in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return api; },
    order() { return api; },
    limit(n) { rows = rows.slice(0, n); return api; },
    gte() { return api; },
    then(res) { return Promise.resolve({ data: rows, error: null }).then(res); },
  };
  return api;
}
// ---- app stub ---------------------------------------------------------------
const app = {
  auth: { supabase: { from: qb } },
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
  ],
  escapeHtml: (s) => String(s),
  _pctToLetter: (v) => (v >= 90 ? 'A' : v >= 80 ? 'B' : v >= 70 ? 'C' : 'F'),
  _letterToPct: (l) => ({ a: 95, 'a-': 92, b: 85, 'b+': 88, 'b-': 82, c: 75, d: 65, f: 50 }[l] ?? null),
  _rivenCurrentQuarter: async () => ({ id: 'Q1', name: 'Quarter 1' }),
  _fetchAllNotes: async () => ({ rows: [
    { student_id: 's1', class_id: 'c1', note: 'Great work', sentiment: 'positive', category: 'behavior', visibility: 'staff', created_at: '2026-09-01T10:00:00Z' },
    { student_id: 's3', class_id: 'c1', note: 'Noisy', sentiment: 'negative', category: 'behavior', visibility: 'staff', created_at: '2026-09-01T11:00:00Z' },
  ] }),
  _showRivenMessage(html) { app._lastHtml = html; },
};
for (const n of ['_rtOut','_rtErr','_rtErrFor','_rtResolveStudent','_rtResolveClass','_rtClassList','_rtRoster','_rtStudentSearch','_rtGrades','_rtNotes','_rtAttendance','_rtPlan','terminalRtCommand']) {
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
  t('notes filtered by class', nt.count === 2, nt);
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

  const help = await rt('');
  t('help lists ops and states it never writes', help.writes === 'NONE. /rt is read-and-plan only.', help.writes);

  console.log(`\nrt-surface: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
