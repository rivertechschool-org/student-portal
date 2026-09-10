// Riven's cohort register: "attendance for lower ms", "who's here in jr high".
//
// The school takes ONE daily register, per cohort, against the students who
// come in on that weekday - not per class. This file guards the three things
// that make that answer trustworthy, using the REAL methods lifted out of
// portal/index.html so what is asserted here is what ships:
//
//  1. UNMARKED IS NOT ABSENT. The failure that matters on this screen is the
//     two reading the same: "nobody is missing" and "nobody has been marked"
//     look identical to a teacher and mean opposite things.
//  2. WHO WAS DUE IN. A cohort member who does not attend on a Thursday is
//     not part of Thursday's register... unless somebody recorded them, in
//     which case hiding them would make the register disagree with the room.
//  3. THE TEACHER'S WORDS. "jr high", "lower ms", "upper middle" and "HS" all
//     have to reach the right cohort, since nobody types the group's real name.
//
// Run: node tests/riven-daily-roster.test.js

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'portal', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

// Same brace-matching lift as debug-tools/group-attendance.js.
function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '(') pd++; else if (c === ')') { pd--; if (pd === 0) { i++; break; } } }
  const parEnd = i;
  i = src.indexOf('{', parEnd);
  let depth = 0; const start = i;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  const sig = src.slice(m.index + 1, parEnd).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^async\b/.test(sig);
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(...(args ? args.split(',').map(s => s.trim()).filter(Boolean) : []), src.slice(start + 1, i - 1));
}

let pass = 0, fail = 0;
const t = (label, ok, got) => {
  if (ok) pass++;
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n        got: ' + JSON.stringify(got) : '')); }
};

// ---- a deferred query builder, like the real client --------------------
// .eq()/.in()/.order() chained after .select() still have to apply, so the
// builder collects filters and only runs when awaited.
let DB = {};
function qb(table) {
  const filters = [];
  const api = {
    select() { return api; },
    eq(k, v) { filters.push([k, v, false]); return api; },
    in(k, vs) { filters.push([k, vs, true]); return api; },
    order() { return api; },
    then(res) {
      if (DB[table] === undefined) return Promise.resolve({ data: null, error: { message: 'no such table: ' + table } }).then(res);
      const hit = r => filters.every(([k, v, isIn]) => isIn ? v.includes(r[k]) : r[k] === v);
      return Promise.resolve({ data: (DB[table] || []).filter(hit), error: null }).then(res);
    },
  };
  return api;
}

const THURSDAY = '2026-09-10';   // getDay() === 4
const GROUPS = [
  { id: 'g-ym', name: 'Full Young Middle', studentIds: ['ada', 'ben', 'cleo', 'dov', 'eve'] },
  { id: 'g-om', name: 'Full Junior High', studentIds: ['finn'] },
  { id: 'g-hs', name: 'Full High', studentIds: [] },
  { id: 'g-ye', name: 'Full Young Elementary', studentIds: ['gus'] },
  { id: 'g-oe', name: 'Full Old Elementary', studentIds: ['hana'] },
];
const PEOPLE = [
  { id: 'ada', first_name: 'Ada', last_name: 'Reyes', grade_level: 6, enrollment_type: null },
  { id: 'ben', first_name: 'Ben', last_name: 'Okafor', grade_level: 7, enrollment_type: 'homeschool' },
  { id: 'cleo', first_name: 'Cleo', last_name: 'Marsh', grade_level: 6, enrollment_type: null },
  { id: 'dov', first_name: 'Dov', last_name: 'Lantz', grade_level: 7, enrollment_type: null },
  { id: 'eve', first_name: 'Eve', last_name: 'Nakamura', grade_level: 6, enrollment_type: 'homeschool' },
  { id: 'finn', first_name: 'Finn', last_name: 'Oyelaran', grade_level: 9, enrollment_type: null },
];

const app = {
  auth: { supabase: { from: qb } },
  _terminalAllGroups: GROUPS,
  _nlpContext: {},
  escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  _isoDaysAgo: () => THURSDAY,
  terminalPrint(msg) { app._printed.push(msg); },
  terminalPrintError(msg) { app._errors.push(msg); },
  _showRivenMessage(html) { app._html = html; },
  _showGroupPicker(rows) { app._picked = rows.map(r => r.name); },
  async _loadTerminalGroups() { app._loadedGroups = true; },
};
for (const n of ['_rivenGroupCanon', '_rivenMatchGroup', '_rivenDailyBuckets', 'terminalDailyRoster']) {
  const fn = extract(n);
  app[n] = function (...a) { return fn.apply(app, a); };
}

// ======================================================================
// 1. Bucketing: the pure rules, with no database in the way.
// ======================================================================
console.log('== unmarked is not absent ==');
{
  const people = PEOPLE.slice(0, 5);
  const scheduled = ['ada', 'ben', 'cleo', 'dov'];   // eve does not come Thursdays

  let b = app._rivenDailyBuckets(people, [], scheduled);
  t('an untaken register marks nobody absent', b.absent.length === 0, b.absent);
  t('everyone due in is simply unmarked', b.unmarked.map(e => e.student.id), b.unmarked.map(e => e.student.id));
  t('...all four of them', b.unmarked.length === 4, b.unmarked.length);
  t('the student who is not in on Thursdays is set aside',
    b.notToday.map(e => e.student.id).join() === 'eve', b.notToday.map(e => e.student.id));

  b = app._rivenDailyBuckets(people, [
    { student_id: 'ada', status: 'present' },
    { student_id: 'ben', status: 'late', arrived_at_period: 3 },
    { student_id: 'cleo', status: 'absent', excused: true, excuse_note: 'dentist' },
  ], scheduled);
  t('present, late and absent each land in their own bucket',
    [b.present.length, b.late.length, b.absent.length].join() === '1,1,1',
    [b.present.length, b.late.length, b.absent.length]);
  t('the one nobody got to is still only unmarked',
    b.unmarked.map(e => e.student.id).join() === 'dov', b.unmarked.map(e => e.student.id));

  // Marked on a day they do not normally attend: still on the register.
  b = app._rivenDailyBuckets(people, [{ student_id: 'eve', status: 'present' }], scheduled);
  t('a student in on an off day appears anyway',
    b.present.map(e => e.student.id).join() === 'eve', b.present.map(e => e.student.id));
  t('...and is flagged as not expected', b.present[0].expected === false, b.present[0]);
  t('...and no longer counts as merely not-today', b.notToday.length === 0, b.notToday);

  // A status the roster select cannot produce must not vanish silently.
  b = app._rivenDailyBuckets(people, [{ student_id: 'ada', status: 'wat' }], scheduled);
  t('an unrecognised status is not dropped',
    b.unmarked.some(e => e.student.id === 'ada'), b.unmarked.map(e => e.student.id));
}

// ======================================================================
// 2. The whole command, end to end.
// ======================================================================
console.log('\n== "attendance for lower ms" ==');
async function ask(text, extra = {}) {
  app._printed = []; app._errors = []; app._html = ''; app._picked = null;
  app._nlpContext = {};
  const entities = Object.assign({
    normalized: text, original: text,
    groupMatch: app._rivenMatchGroup(text),
  }, extra);
  await app.terminalDailyRoster(entities);
  return { html: app._html, errors: app._errors, picked: app._picked };
}

(async () => {
  DB = {
    student_schedule: [
      { student_id: 'ada', day_of_week: 4 },
      { student_id: 'ben', day_of_week: 4 },
      { student_id: 'cleo', day_of_week: 4 },
      { student_id: 'dov', day_of_week: 4 },
      { student_id: 'eve', day_of_week: 2 },     // Tuesdays only
      { student_id: 'finn', day_of_week: 4 },
    ],
    user_profiles: PEOPLE,
    daily_attendance: [
      { student_id: 'ada', date: THURSDAY, status: 'present' },
      { student_id: 'ben', date: THURSDAY, status: 'late', arrived_at_period: 3 },
      { student_id: 'cleo', date: THURSDAY, status: 'absent', excused: true, excuse_note: 'dentist' },
      { student_id: 'dov', date: THURSDAY, status: 'left_early', left_at_period: 5 },
      // yesterday's register must not leak into today's
      { student_id: 'ada', date: '2026-09-09', status: 'absent' },
    ],
  };

  let r = await ask('attendance for lower ms');
  t('it resolves the cohort the teacher named', /Full Young Middle/.test(r.html), r.html);
  t('the weekday is stated', /Thursday 2026-09-10/.test(r.html), r.html);
  t('present is listed', /Present \(1\)<\/b> — Ada Reyes/.test(r.html), r.html);
  t('late carries the period they arrived', /Late \(1\)<\/b> — Ben Okafor <span[^>]*>\(in P3\)/.test(r.html), r.html);
  t('left early carries the period they left', /Left early \(1\)<\/b> — Dov Lantz <span[^>]*>\(out P5\)/.test(r.html), r.html);
  t('absent shows the excuse', /Absent \(1\)<\/b> — Cleo Marsh <span[^>]*>\(excused: dentist\)/.test(r.html), r.html);
  t('all four due in are accounted for', /All 4 marked/.test(r.html), r.html);
  t('the Tuesday-only student is counted, not listed',
    /1 other student in Full Young Middle does not come in on Thursdays/.test(r.html), r.html);
  t('nobody else\'s cohort came along', !/Finn|Oyelaran/.test(r.html), r.html);
  t('yesterday\'s absence did not leak in', !/Ada Reyes <span/.test(r.html), r.html);
  t('no errors', r.errors.length === 0, r.errors);
  t('the cohort is remembered for a follow-up',
    app._nlpContext.lastGroup?.groupId === 'g-ym', app._nlpContext.lastGroup);

  // Register not taken yet - the reading that must never look like "all here".
  DB.daily_attendance = [];
  r = await ask('attendance for lower ms');
  t('an untaken register says so', /Attendance has not been taken yet — 4 due in/.test(r.html), r.html);
  t('...and claims nobody is absent', !/Absent \(/.test(r.html), r.html);
  t('...and lists them as not marked', /Not marked yet \(4\)/.test(r.html), r.html);

  // Half done.
  DB.daily_attendance = [{ student_id: 'ada', date: THURSDAY, status: 'present' }];
  r = await ask('who is here in lower middle today');
  t('a partial register counts what is done', /1 of 4 marked/.test(r.html), r.html);

  // A student in on a day they normally are not.
  DB.daily_attendance = [{ student_id: 'eve', date: THURSDAY, status: 'present' }];
  r = await ask('attendance lower ms');
  t('an unexpected attender is shown', /Eve Nakamura/.test(r.html), r.html);
  t('...and is called out as unusual', /not usually in on Thursdays/.test(r.html), r.html);

  // Another day, named.
  DB.daily_attendance = [{ student_id: 'ada', date: '2026-09-08', status: 'absent' }];
  r = await ask('attendance for lower ms yesterday',
    { sinceDate: '2026-09-08', untilDate: '2026-09-08', sinceLabel: 'yesterday' });
  t('a named single day is read, not today', /Tuesday 2026-09-08/.test(r.html), r.html);
  t('...and that day\'s rows are the ones used', /Absent \(1\)<\/b> — Ada Reyes/.test(r.html), r.html);

  // A timeframe that is not one day is a different question - say which day.
  r = await ask('attendance for lower ms last week', { sinceDate: '2026-09-03', sinceLabel: 'last week' });
  t('a range falls back to today rather than reporting one day of it',
    /Thursday 2026-09-10/.test(r.html), r.html);

  console.log('\n== the words teachers actually type ==');
  DB.daily_attendance = [];
  for (const [said, want] of [
    ['attendance for jr high', 'Full Junior High'],
    ['attendance for junior high', 'Full Junior High'],
    ['attendance for upper middle', 'Full Junior High'],
    ['attendance for upper ms', 'Full Junior High'],
    ['attendance for lower ms', 'Full Young Middle'],
    ['attendance for lower middle school', 'Full Young Middle'],
    ['attendance for younger middle', 'Full Young Middle'],
    ['whos here in lower elementary today', 'Full Young Elementary'],
  ]) {
    const got = await ask(said);
    t(`"${said}" -> ${want}`, new RegExp(want).test(got.html), got.html.slice(0, 200) + (got.errors.join('|')));
  }

  console.log('\n== when it cannot answer ==');
  r = await ask('attendance for high school');
  t('an empty cohort says to go fill it in',
    /Full High has no students in it yet/.test(r.errors[0] || ''), r.errors);

  r = await ask('attendance for elementary');
  t('a half-named band asks which one, rather than guessing',
    !!r.picked && r.picked.includes('Full Young Elementary'), r.picked);

  r = await ask('attendance for chess club');
  t('no cohort at all lists the ones there are',
    /Which group's attendance\? I know: /.test(r.errors[0] || ''), r.errors);

  DB = { user_profiles: PEOPLE, daily_attendance: [] };   // student_schedule missing
  r = await ask('attendance for lower ms');
  t('a failed read is reported, not rendered as an empty register',
    /Could not read the register/.test(r.errors[0] || ''), r.errors);
  t('...and nothing is drawn', !r.html, r.html);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
