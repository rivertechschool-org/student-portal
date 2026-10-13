// Attendance reports, one student picked: every absence, and excusing them.
//
// Picking a single student in the attendance report shows every day in the
// date range they were not marked present (absent, late, left early),
// whatever the status and type filters say, with the classes they were marked
// absent from that day. Each day can be excused, with a reason, or unexcused.
//
// Excused is stored on the DAY (daily_attendance); class_attendance has no
// excused column. A day with only class absences and no daily record is shown
// but cannot be excused, and says why.
//
// Run: node tests/attendance-student-absences.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function extract(name) {
  const re = new RegExp('\\n      (async\\s+)?' + name + '\\s*\\(([^)]*)\\)\\s*\\{');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const body = html.slice(start + 1, i - 1);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return m[1] ? new AsyncFunction(m[2], body) : new Function(m[2], body);
}

// ---- a database the methods can talk to ---------------------------------
function makeDb(tables, log) {
  return {
    from(table) {
      const filters = [];
      let patch = null;
      const q = {
        select() { return q; },
        order() { return q; },
        eq(c, v) { filters.push(r => r[c] === v); return q; },
        neq(c, v) { filters.push(r => r[c] !== v); return q; },
        gte(c, v) { filters.push(r => r[c] >= v); return q; },
        lte(c, v) { filters.push(r => r[c] <= v); return q; },
        in(c, vs) { filters.push(r => vs.includes(r[c])); return q; },
        update(p) { patch = p; return q; },
        then(res, rej) {
          const rows = (tables[table] || []).filter(r => filters.every(f => f(r)));
          if (patch) { rows.forEach(r => Object.assign(r, patch)); log.push({ table, patch, ids: rows.map(r => r.id) }); }
          return Promise.resolve({ data: rows.map(r => ({ ...r })), error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

const STU = 'stu1';
function makeApp() {
  const tables = {
    daily_attendance: [
      { id: 'd1', student_id: STU, date: '2026-10-05', status: 'absent', excused: false, excuse_note: null },
      { id: 'd2', student_id: STU, date: '2026-10-06', status: 'late', excused: true, excuse_note: 'dentist' },
      { id: 'd3', student_id: STU, date: '2026-10-07', status: 'present', excused: false, excuse_note: null },
      { id: 'd4', student_id: 'other', date: '2026-10-05', status: 'absent', excused: false, excuse_note: null },
      { id: 'd5', student_id: STU, date: '2026-09-01', status: 'absent', excused: false, excuse_note: null },
    ],
    class_attendance: [
      { student_id: STU, date: '2026-10-05', class_id: 'c1', status: 'absent' },
      { student_id: STU, date: '2026-10-05', class_id: 'c2', status: 'absent' },
      { student_id: STU, date: '2026-10-07', class_id: 'c1', status: 'absent' },
      { student_id: STU, date: '2026-10-06', class_id: 'c2', status: 'late' },
    ],
    classes: [{ id: 'c1', name: 'Math' }, { id: 'c2', name: 'Science' }],
  };
  const log = [], notes = {}, notices = [];
  const app = {
    auth: { supabase: makeDb(tables, log) },
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    jsAttr: s => String(s),
    showNotification: (m, k) => notices.push(`${k}:${m}`),
    currentAttendanceData: { type: 'class' },
    renderCount: 0,
    async renderStudentAbsences() { this.renderCount++; },
    async searchAttendance() { this.searchCount = (this.searchCount || 0) + 1; },
  };
  for (const n of ['_loadStudentAbsences', '_groupStudentAbsences', '_studentAbsencesHtml',
                   'setAbsenceExcused', 'excuseAllStudentAbsences', '_afterAbsenceExcuseChange']) {
    const fn = extract(n);
    app[n] = function (...a) { return fn.apply(app, a); };
  }
  global.document = { getElementById: id => (id.startsWith('abs-note-') ? { value: notes[id.slice(9)] || '' } : null) };
  return { app, tables, log, notes, notices };
}

(async () => {
  console.log('\n== every absence in the range ==\n');
  {
    const { app } = makeApp();
    const days = await app._loadStudentAbsences(STU, '2026-10-01', '2026-10-31');
    check('days newest first: absent, late, and a class-only day', days.map(d => d.date),
          ['2026-10-07', '2026-10-06', '2026-10-05']);
    check('  a present day is not an absence, but its missed class is', days[0].day, null);
    check('  the classes missed that day', days[2].classes, ['Math', 'Science']);
    check('  only class ABSENCES count as missed', days[1].classes, []);
    ok('  another student\'s absence is not shown', !days.some(d => d.day && d.day.id === 'd4'));
    ok('  nor one outside the dates', !days.some(d => d.date === '2026-09-01'));

    const body = app._studentAbsencesHtml(days, 'Fenmore, Willow');
    ok('the panel names the student', /Fenmore, Willow: all absences/.test(body));
    ok('  an unexcused day has an Excuse button', /setAbsenceExcused\('d1', true\)">Excuse</.test(body));
    ok('  an excused day can be unexcused', /setAbsenceExcused\('d2', false\)">Unexcuse</.test(body));
    ok('  and keeps its reason', /value="dentist"/.test(body));
    ok('  a class-only day says why it cannot be excused', /Excusing is by day/.test(body));
    ok('  the totals are honest', /1 full day absent · 1 of 2 excused/.test(body));
    ok('no "excuse all" for a single unexcused day', !/Excuse all/.test(body));
    ok('an empty range says so', /No absences in this date range/.test(app._studentAbsencesHtml([], 'X')));
  }

  console.log('\n== excusing ==\n');
  {
    const { app, tables, log, notes } = makeApp();
    notes.d1 = '  sick  ';
    await app.setAbsenceExcused('d1', true);
    check('excusing writes the day with its reason', log[0], { table: 'daily_attendance', patch: { excused: true, excuse_note: 'sick' }, ids: ['d1'] });
    check('  only that day', tables.daily_attendance.filter(r => r.excused).map(r => r.id).sort(), ['d1', 'd2']);
    check('  and the panel redraws', app.renderCount, 1);

    await app.setAbsenceExcused('d2', false);
    check('unexcusing clears the flag', log[1].patch, { excused: false });
    check('  and keeps the reason on file', tables.daily_attendance.find(r => r.id === 'd2').excuse_note, 'dentist');

    app.currentAttendanceData = { type: 'daily' };
    await app.setAbsenceExcused('d1', true);
    check('with the daily table showing, the whole report redraws', app.searchCount, 1);
  }
  {
    const { app, log } = makeApp();
    app._studentAbsenceDays = await app._loadStudentAbsences(STU, '2026-08-01', '2026-10-31');
    global.confirm = () => false;
    await app.excuseAllStudentAbsences();
    check('"excuse all" does nothing without confirming', log.length, 0);
    global.confirm = () => true;
    await app.excuseAllStudentAbsences();
    check('"excuse all" excuses only the unexcused days', log.map(l => l.ids[0]).sort(), ['d1', 'd5']);
    delete global.confirm;
  }

  console.log('\n== wired into the report ==\n');
  {
    const search = html.slice(html.indexOf('      async searchAttendance() {'), html.indexOf('      // ---- one student\'s absences, excusable'));
    ok('a single student gets the panel', /if \(studentId !== 'all'\)/.test(search) && /attendance-student-absences/.test(search));
    ok('  even when no records match the other filters', /resultsDiv\.innerHTML = absencesSlot \+/.test(search));
    ok('  and above the statistics', /let html = absencesSlot \+/.test(search));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
