#!/usr/bin/env node
// Behavioural test for the attendance filter on group RTC awards.
// Extracts the REAL methods from portal/index.html (same brace-matching as
// nlp-stress.js / rt-surface.js) and runs them against an in-memory Supabase
// stub, so what is asserted here is what ships.
//
// The rule under test: a group award covers the students who were actually
// here that day. The interesting cases are the edges — an empty register, a
// register where nobody is present, and the phrases that opt out.
const fs = require('fs'), path = require('path');
// PORTAL_SRC lets this be pointed at another build, which is how the
// assertions below were checked to actually fail before the change.
const SRC = [process.env.PORTAL_SRC,
             path.join(__dirname, '..', 'portal', 'index.html'),
             path.join(process.cwd(), 'portal', 'index.html')].filter(Boolean).find(fs.existsSync);
if (!SRC) { console.error('group-attendance: cannot find portal/index.html'); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '(') pd++; else if (c === ')') { pd--; if (pd === 0) { i++; break; } } }
  const parEnd = i;
  i = src.indexOf('{', parEnd);
  let depth = 0, start = i;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  const sig = src.slice(m.index + 1, parEnd).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^async\b/.test(sig);
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(...(args ? args.split(',').map(s => s.trim()).filter(Boolean) : []), src.slice(start + 1, i - 1));
}

const TODAY = '2026-09-04';
let DB = {};
const WRITES = [];
// Deferred, like the real client: .delete()/.insert() do nothing until the
// builder is awaited, so the filters chained AFTER them still apply. An
// eager stub deletes the whole table on `.delete().eq(...)` and hides the
// very bug this file exists to catch.
function qb(table) {
  const filters = [];
  let op = 'select', payload = null;
  const matches = r => filters.every(([k, v]) => (r[k] === undefined ? null : r[k]) === v);
  const api = {
    select() { return api; },
    eq(k, v) { filters.push([k, v]); return api; },
    is(k, v) { filters.push([k, v]); return api; },
    in(k, vs) { filters.push([k, vs, true]); return api; },
    order() { return api; },
    insert(p) { op = 'insert'; payload = p; return api; },
    delete() { op = 'delete'; return api; },
    run() {
      const all = DB[table] || [];
      const hit = r => filters.every(([k, v, isIn]) => isIn ? v.includes(r[k]) : (r[k] === undefined ? null : r[k]) === v);
      if (op === 'insert') {
        const made = (Array.isArray(payload) ? payload : [payload]).map(o => ({ ...o }));
        DB[table] = all.concat(made);
        WRITES.push({ table, op: 'insert', rows: made });
        return { data: made, error: null };
      }
      if (op === 'delete') {
        const keep = all.filter(r => !hit(r));
        WRITES.push({ table, op: 'delete', n: all.length - keep.length });
        DB[table] = keep;
        return { data: [], error: null };
      }
      return { data: all.filter(hit), error: null };
    },
    then(res) { return Promise.resolve(api.run()).then(res); },
  };
  return api;
}

const app = {
  auth: { supabase: { from: qb } },
  userInfo: { user: { id: 't1' }, profile: { id: 't1', user_type: 'teacher' } },
  _nlpContext: {},
  _terminalAllStudents: [
    { id: 'a', full_name: 'Ada Reyes', first_name: 'Ada', last_name: 'Reyes', status: 'active', rtc_balance: 0 },
    { id: 'b', full_name: 'Ben Okafor', first_name: 'Ben', last_name: 'Okafor', status: 'active', rtc_balance: 0 },
    { id: 'c', full_name: 'Cleo Marsh', first_name: 'Cleo', last_name: 'Marsh', status: 'active', rtc_balance: 0 },
    { id: 'd', full_name: 'Dov Lantz', first_name: 'Dov', last_name: 'Lantz', status: 'active', rtc_balance: 0 },
  ],
  _terminalAllClasses: [],
  _terminalAllGroups: [{ id: 'g1', name: 'Full Young Middle', studentIds: ['a', 'b', 'c', 'd'] }],
  escapeHtml: s => String(s),
  terminalPrintError(m) { app._errors.push(m); },
  _requestConfirmation(summary, execute) { app._confirm = { summary, execute }; },
  _rtcTxn: async ({ userId }) => { app._paid.push(userId); },
  _pushUndo() {}, _naturalSuccess() {},
  _isoDaysAgo: () => TODAY,
  terminalMultiAward: async () => { throw new Error('should not route to multi-award'); },
};
for (const n of ['_rivenPresentOn', '_rivenIgnoresAttendance', '_normalizeInput',
                 '_rivenGroupCanon', '_rivenMatchGroup', '_rivenMatchClass',
                 '_rivenFindExcluded', '_fuzzyFindStudent', '_calculateSimilarity',
                 '_levenshteinDistance', '_rivenResolveGroup', '_rivenRequireClasses',
                 '_hasCommandSignal', '_hasCommandVerb', '_isCommonWordTypo', '_commonWords',
                 '_rivenRequireClass', '_preferOwnedClasses', '_rivenQuantifiesClasses',
                 '_rememberClass', '_showClassPicker', '_showGroupPicker',
                 '_rivenResolveClassRow', '_rivenFindEnrollment', '_rivenNamesEachClass', '_rivenResolvedStudent', '_rivenPeriodsOn', '_rivenClassLabels', 'terminalGroupAddRTC',
                 'terminalMarkAttendanceGroup', '_rivenCanManageClass']) {
  const fn = extract(n);
  app[n] = function (...a) { return fn.apply(app, a); };
}

let pass = 0, fail = 0;
const t = (label, ok, got) => { ok ? pass++ : fail++; if (!ok) console.log('  FAIL', label, got !== undefined ? '\n        got: ' + JSON.stringify(got) : ''); };

// Drive the award the way _executeIntent does, then run the confirmation.
async function award(text, attendance) {
  DB = { class_attendance: attendance };
  app._errors = []; app._paid = []; app._confirm = null; app._nlpContext = {};
  const normalized = app._normalizeInput(text);
  const entities = {
    normalized, original: text, amount: parseInt((normalized.match(/\d+/) || [0])[0], 10),
    classMatch: app._rivenMatchClass(normalized), groupMatch: app._rivenMatchGroup(normalized),
    students: [], student: null,
  };
  await app.terminalGroupAddRTC(entities);
  if (app._confirm) await app._confirm.execute();
  return { paid: app._paid.slice().sort(), errors: app._errors.slice(), summary: app._confirm?.summary || '' };
}

(async () => {
  console.log('== group award: who actually gets paid ==');

  // 1. Register taken: only the students marked here collect.
  let r = await award('give lower middle 5 rtc', [
    { student_id: 'a', date: TODAY, status: 'present' },
    { student_id: 'b', date: TODAY, status: 'late' },
    { student_id: 'c', date: TODAY, status: 'absent' },
    { student_id: 'd', date: TODAY, status: 'present' },
  ]);
  t('present + late are paid, absent is not', JSON.stringify(r.paid) === JSON.stringify(['a', 'b', 'd']), r.paid);
  t('the skipped student is named in the dialog', /skipping 1 not here today/.test(r.summary), r.summary);

  // 2. Empty register: pay everyone, but SAY the list is unverified.
  //    Awarding nobody here would look exactly like a successful filtered run.
  r = await award('give lower middle 5 rtc', []);
  t('empty register still pays the whole roster', JSON.stringify(r.paid) === JSON.stringify(['a', 'b', 'c', 'd']), r.paid);
  t('empty register warns in the dialog', /No attendance has been taken/.test(r.summary), r.summary);
  t('empty register is not an error', r.errors.length === 0, r.errors);

  // 3. Register taken and nobody is in: that is a real answer, so stop.
  r = await award('give lower middle 5 rtc', [
    { student_id: 'a', date: TODAY, status: 'absent' },
    { student_id: 'b', date: TODAY, status: 'absent' },
  ]);
  t('nobody present pays nobody', r.paid.length === 0, r.paid);
  t('nobody present says so', /Nobody in Full Young Middle is marked present/.test(r.errors[0] || ''), r.errors);

  // 4. The opt-out phrases cover the roster with no warning.
  for (const phrase of ['including absent', 'present or not', 'to everyone on the roster']) {
    r = await award(`give lower middle 5 rtc ${phrase}`, [
      { student_id: 'a', date: TODAY, status: 'present' },
      { student_id: 'b', date: TODAY, status: 'absent' },
    ]);
    t(`"${phrase}" covers the whole roster`, JSON.stringify(r.paid) === JSON.stringify(['a', 'b', 'c', 'd']), r.paid);
    t(`"${phrase}" does not warn`, !/No attendance has been taken/.test(r.summary), r.summary);
  }

  // 5. Yesterday's register does not count as today's.
  r = await award('give lower middle 5 rtc', [
    { student_id: 'a', date: '2026-09-03', status: 'present' },
  ]);
  t('a stale register reads as untaken', /No attendance has been taken/.test(r.summary), r.summary);

  // ---- the sentence from a real session, end to end -----------------------
  // "for all lower ms classes today, mark full attendance except magnolia
  // wasn't there." Two classes, one shared roster, one named exception.
  console.log('\n== group attendance: the whole sentence ==');
  app._terminalAllClasses = [
    { id: 'lme', name: 'Lower MS English', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
    { id: 'lmm', name: 'Lower MS Math', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
    { id: 'other', name: 'Upper MS Math', teacher_id: 't9', secondary_teacher_id: null, is_active: true },
  ];
  app._terminalAllStudents = [
    { id: 'a', full_name: 'Ada Reyes', first_name: 'Ada', last_name: 'Reyes', status: 'active', rtc_balance: 0 },
    { id: 'b', full_name: 'Ben Okafor', first_name: 'Ben', last_name: 'Okafor', status: 'active', rtc_balance: 0 },
    { id: 'm', full_name: 'Marigold Vance', first_name: 'Marigold', last_name: 'Vance', status: 'active', rtc_balance: 0 },
  ];
  DB = {
    class_enrollments: [
      { class_id: 'lme', student_id: 'a', status: 'active' },
      { class_id: 'lme', student_id: 'b', status: 'active' },
      { class_id: 'lme', student_id: 'm', status: 'active' },
      { class_id: 'lmm', student_id: 'a', status: 'active' },
      { class_id: 'lmm', student_id: 'm', status: 'active' },
      { class_id: 'other', student_id: 'a', status: 'active' },
    ],
    class_attendance: [], class_attendance_sessions: [],
  };
  WRITES.length = 0;
  app._errors = []; app._confirm = null; app._nlpContext = {}; app._pickedFrom = null;
  // If resolution ever falls back to "which class did you mean?", record it:
  // that dialog is the exact bug this sentence was reported for.
  app._showClassPicker = rows => { app._pickedFrom = rows.map(r => r.name); };
  app._showGroupPicker = rows => { app._pickedFrom = rows.map(r => r.name); };
  // the shape of a message from a real session, with a fixture name
  const text = "for all lower ms classes today, mark full attendance except marigold wasn't there.";
  const nz = app._normalizeInput(text);
  await app.terminalMarkAttendanceGroup({
    normalized: nz, original: text, amount: null, students: [], student: null,
    classMatch: app._rivenMatchClass(nz), groupMatch: app._rivenMatchGroup(nz),
  });
  t('no class picker — "all lower ms classes" means all of them', !app._pickedFrom, app._pickedFrom);
  t('it asks for confirmation rather than erroring', !!app._confirm, app._errors);
  if (app._confirm) {
    t('both lower MS classes are named', /Lower MS English and Lower MS Math/.test(app._confirm.summary), app._confirm.summary);
    t('the exception is called out as absent',
      /Marigold Vance<\/b> gets <b>absent<\/b>/.test(app._confirm.summary), app._confirm.summary);
    await app._confirm.execute();
  }
  const written = DB.class_attendance.map(r => `${r.class_id}:${r.student_id}:${r.status}`).sort();
  t('rows written for both classes, exception marked absent',
    JSON.stringify(written) === JSON.stringify([
      'lme:a:present', 'lme:b:present', 'lme:m:absent',
      'lmm:a:present', 'lmm:m:absent',
    ]), written);
  t('a class this teacher does not own is untouched',
    !DB.class_attendance.some(r => r.class_id === 'other'), written);
  t('a session row is closed per class',
    DB.class_attendance_sessions.length === 2, DB.class_attendance_sessions);

  // ---- two classes named outright, two names excluded ---------------------
  // "Attendance for English and math: all here except malakai and magnolia."
  // This one crashed: two student names put entities.student into its
  // UNRESOLVED ambiguous shape, which was handed on as if it were a person,
  // and the executor read .full_name off it. It also has to reach the write
  // at all ("all here", no "mark"), and cover BOTH classes it names.
  console.log('\n== two classes named outright, two exclusions ==');
  app._terminalAllClasses = [
    { id: 'e1', name: 'English', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
    { id: 'm1', name: 'Math', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
    { id: 'b1', name: 'Bible', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  ];
  app._terminalAllStudents = [
    { id: 'a', full_name: 'Ada Reyes', first_name: 'Ada', last_name: 'Reyes', status: 'active', rtc_balance: 0 },
    { id: 'mk', full_name: 'Malakai Kaufman', first_name: 'Malakai', last_name: 'Kaufman', status: 'active', rtc_balance: 0 },
    { id: 'mg', full_name: 'Magnolia Mays', first_name: 'Magnolia', last_name: 'Mays', status: 'active', rtc_balance: 0 },
  ];
  DB = {
    class_enrollments: [
      { class_id: 'e1', student_id: 'a', status: 'active' },
      { class_id: 'e1', student_id: 'mk', status: 'active' },
      { class_id: 'e1', student_id: 'mg', status: 'active' },
      { class_id: 'm1', student_id: 'a', status: 'active' },
      { class_id: 'm1', student_id: 'mk', status: 'active' },
      { class_id: 'b1', student_id: 'a', status: 'active' },
    ],
    class_attendance: [], class_attendance_sessions: [],
  };
  WRITES.length = 0;
  app._errors = []; app._confirm = null; app._nlpContext = {}; app._pickedFrom = null;
  app._showClassPicker = rows => { app._pickedFrom = rows.map(r => r.name); };
  app._showGroupPicker = rows => { app._pickedFrom = rows.map(r => r.name); };
  const T2 = 'Attendance for English and math: all here except malakai and magnolia.';
  const n2 = app._normalizeInput(T2);
  let crashed = null;
  try {
    await app.terminalMarkAttendanceGroup({
      normalized: n2, original: T2, amount: null, students: [], student: null,
      classMatch: app._rivenMatchClass(n2), groupMatch: app._rivenMatchGroup(n2),
    });
  } catch (e) { crashed = e.message; }
  t('it does not crash', !crashed, crashed);
  t('no class picker — both classes were named', !app._pickedFrom, app._pickedFrom);
  t('it asks for confirmation', !!app._confirm, app._errors);
  if (app._confirm) {
    t('both named classes appear', /English and Math/.test(app._confirm.summary), app._confirm.summary);
    t('both exclusions are called out',
      /Malakai Kaufman and Magnolia Mays<\/b> get <b>absent<\/b>/.test(app._confirm.summary), app._confirm.summary);
    await app._confirm.execute();
  }
  const w2 = DB.class_attendance.map(r => `${r.class_id}:${r.student_id}:${r.status}`).sort();
  t('both classes written, both exclusions absent, Bible untouched',
    JSON.stringify(w2) === JSON.stringify([
      'e1:a:present', 'e1:mg:absent', 'e1:mk:absent',
      'm1:a:present', 'm1:mk:absent',
    ]), w2);

  // ---- the school's real shape: same names, other teachers, periods -------
  // Luke teaches "Lower MS English" and "Lower MS Math". Other teachers own
  // classes named exactly "English" and "Math". "attendance for english and
  // math" marked THEIR registers, and wrote every row with period null, which
  // the attendance screen filters out — so his own classes showed nothing.
  console.log('\n== the asker\'s own classes, and the right period ==');
  app._terminalAllClasses = [
    { id: 'mine-e', name: 'Lower MS English', teacher_id: 't1', secondary_teacher_id: null, is_active: true, teacher_name: 'Me' },
    { id: 'mine-m', name: 'Lower MS Math', teacher_id: 't1', secondary_teacher_id: null, is_active: true, teacher_name: 'Me' },
    { id: 'hers-e', name: 'English', teacher_id: 't9', secondary_teacher_id: null, is_active: true, teacher_name: 'Caitlin Relvas' },
    { id: 'his-m', name: 'Math', teacher_id: 't8', secondary_teacher_id: null, is_active: true, teacher_name: 'Jordan Ezell' },
  ];
  app._terminalAllStudents = [
    { id: 'a', full_name: 'Ada Reyes', first_name: 'Ada', last_name: 'Reyes', status: 'active', rtc_balance: 0 },
    { id: 'mk', full_name: 'Malakai Kaufman', first_name: 'Malakai', last_name: 'Kaufman', status: 'active', rtc_balance: 0 },
    { id: 'mg', full_name: 'Magnolia Mays', first_name: 'Magnolia', last_name: 'Mays', status: 'active', rtc_balance: 0 },
  ];
  DB = {
    class_enrollments: [
      { class_id: 'mine-e', student_id: 'a', status: 'active' },
      { class_id: 'mine-e', student_id: 'mk', status: 'active' },
      { class_id: 'mine-e', student_id: 'mg', status: 'active' },
      { class_id: 'mine-m', student_id: 'a', status: 'active' },
      { class_id: 'mine-m', student_id: 'mg', status: 'active' },
      { class_id: 'hers-e', student_id: 'a', status: 'active' },
      { class_id: 'his-m', student_id: 'a', status: 'active' },
    ],
    // Lower MS English meets in period 3 that day; Lower MS Math has no slot
    class_schedule: [{ class_id: 'mine-e', day_of_week: new Date(TODAY + 'T12:00:00').getDay(), period: 3 }],
    class_attendance: [], class_attendance_sessions: [],
  };
  WRITES.length = 0;
  app._errors = []; app._confirm = null; app._nlpContext = {}; app._pickedFrom = null;
  app._showClassPicker = rows => { app._pickedFrom = rows.map(r => r.name); };
  app._showGroupPicker = rows => { app._pickedFrom = rows.map(r => r.name); };
  const T3 = 'Attendance for english and math: all here except for malakai and magnolia';
  const n3 = app._normalizeInput(T3);
  await app.terminalMarkAttendanceGroup({
    normalized: n3, original: T3, amount: null, students: [], student: null,
    classMatch: app._rivenMatchClass(n3), groupMatch: app._rivenMatchGroup(n3),
  });
  t('no picker', !app._pickedFrom, app._pickedFrom);
  t('it asks for confirmation', !!app._confirm, app._errors);
  if (app._confirm) {
    t('it targets MY classes, not the identically-named ones',
      /Lower MS English and Lower MS Math/.test(app._confirm.summary), app._confirm.summary);
    t('"except FOR x and y" excludes BOTH',
      /Malakai Kaufman and Magnolia Mays|Magnolia Mays and Malakai Kaufman/.test(app._confirm.summary), app._confirm.summary);
    t('it warns about the class with no period that day',
      /Lower MS Math.*no period scheduled/.test(app._confirm.summary), app._confirm.summary);
    await app._confirm.execute();
  }
  const byPeriod = DB.class_attendance.map(r => `${r.class_id}:${r.student_id}:${r.status}:p${r.period}`).sort();
  t('rows carry the period the screen reads, and null only when unscheduled',
    JSON.stringify(byPeriod) === JSON.stringify([
      'mine-e:a:present:p3', 'mine-e:mg:absent:p3', 'mine-e:mk:absent:p3',
      'mine-m:a:present:pnull', 'mine-m:mg:absent:pnull',
    ].map(x => x.replace(':pnull', ':pnull'))), byPeriod);
  t('the session row carries the same period',
    DB.class_attendance_sessions.some(x => x.class_id === 'mine-e' && x.period === 3), DB.class_attendance_sessions);
  t('nobody else\'s register was touched',
    !DB.class_attendance.some(r => r.class_id === 'hers-e' || r.class_id === 'his-m'), byPeriod);

  // same-named classes must be told apart in the dialog, not read "English and English"
  t('duplicate names get their teacher appended',
    JSON.stringify(app._rivenClassLabels([
      { name: 'English', teacher_name: 'Caitlin Relvas' },
      { name: 'English', teacher_name: 'Emily Allison' },
      { name: 'Math', teacher_name: 'Jordan Ezell' },
    ])) === JSON.stringify(['English (Caitlin Relvas)', 'English (Emily Allison)', 'Math']));

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
