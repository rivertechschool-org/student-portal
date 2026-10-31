// Synthetic class registers: saving must precede the success summary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const re = new RegExp('\\n    (async )?' + name + '\\(');
  const start = html.search(re);
  const end = html.indexOf('\n    }\n', start);
  const body = html.slice(start, end + 7).trim();
  return eval('(' + body.replace(/^(async )?\w+\(/, (_, a) => (a || '') + 'function(') + ')');
}
const summary = method('_matchAndSummarizeClassAttendance');
const save = method('saveClassAttendance');
const fixture = () => ({ classId: 'class-a', className: 'Test class', date: '2026-10-30', period: 4,
  meetsThatDay: true, isCanceled: false,
  roster: [{ id: 'a', first_name: 'Sample', last_name: 'One' }, { id: 'b', first_name: 'Sample', last_name: 'Two' }, { id: 'c', first_name: 'Sample', last_name: 'Three' }],
  daily: { a: { status: 'late', arrived_at_period: 2 }, b: { status: 'left_early', left_at_period: 3 } },
  existing: [{ student_id: 'c', status: 'absent', notes: 'Keep note' }, { student_id: 'outside', status: 'present' }],
  lateEarly: { a: [{ kind: 'early', at_time: '13:30' }] }, periodBlock: { starts_at: '13:00', ends_at: '14:00' },
});
async function run(input, saved = true) {
  const writes = [], modals = [], events = [];
  const app = { userInfo: { user: { id: 'teacher' } }, _dayStatusForPeriod: method('_dayStatusForPeriod'),
    _localDateStr: () => '2026-10-30', escapeHtml: x => String(x).replaceAll('<', '&lt;'),
    _lateEarlyChip: plans => plans?.length ? '<div>Expected to leave early, at 1:30 PM</div>' : '',
    dailyStatusChip: day => `<div>${day.status}</div>`,
    saveClassAttendance: async (...args) => { writes.push(args); events.push('save'); return saved; },
    showModal: (...args) => { modals.push(args); events.push('modal'); },
  };
  await summary.call(app, input);
  return { writes, content: modals[0][2], events };
}
(async () => {
  let result = await run(fixture());
  assert.deepEqual(result.events, ['save', 'modal']);
  assert.match(result.content, /Matched to Master! You have 1 student present today\./);
  assert.match(result.content, /Expected to leave early/);
  assert.match(result.content, /update attendance manually/);
  assert.match(result.content, /showClassAttendance\('class-a', '2026-10-30', 4\)/);
  const records = result.writes[0][3].records;
  assert.equal(records.find(r => r.student_id === 'a').status, 'present');
  assert.equal(records.find(r => r.student_id === 'b').status, 'absent');
  assert.equal(records.find(r => r.student_id === 'c').notes, 'Keep note');
  assert.equal(records.find(r => r.student_id === 'outside').status, 'present');
  assert.match(result.content, /1 student has no master mark/);
  for (const changes of [{ isCanceled: true }, { meetsThatDay: false }, { daily: {} }, { roster: [] }]) {
    result = await run({ ...fixture(), ...changes });
    assert.equal(result.writes.length, 0);
    assert.doesNotMatch(result.content, /Matched to Master!/);
    assert.match(result.content, /update attendance manually/);
  }
  result = await run(fixture(), false);
  assert.doesNotMatch(result.content, /Matched to Master!/);
  assert.match(result.content, /could not be fully saved/);

  // Exercise real persistence with an in-memory query double, including failures.
  async function persist(failure) {
    const calls = [];
    const app = { userInfo: { user: { id: 'teacher' } }, showNotification() {},
      sendAttendanceAlertNotifications() {}, _weekAttendanceChanged() {},
      showClassAttendance() { throw Error('Summary must not reopen manual register'); },
      auth: { supabase: { from(table) {
        let operation;
        const q = { select() { operation = 'select'; return q; }, delete() { operation = 'delete'; return q; },
          insert() { operation = 'insert'; return q; }, eq() { return q; }, is() { return q; },
          then(resolve) { calls.push(`${table}:${operation}`); resolve({ data: [], error: failure === `${table}:${operation}` ? { message: 'Synthetic failure' } : null }); } };
        return q;
      } } },
    };
    const error = console.error; console.error = () => {};
    try { return { saved: await save.call(app, 'class-a', '2026-10-30', 4, { records: [{ student_id: 'a', status: 'present' }], summary: true }), calls }; }
    finally { console.error = error; }
  }
  let persisted = await persist();
  assert.equal(persisted.saved, true);
  assert.deepEqual(persisted.calls, ['class_attendance:select', 'class_attendance:delete', 'class_attendance:insert', 'class_attendance_sessions:delete', 'class_attendance_sessions:insert']);
  for (const failure of ['class_attendance:select', 'class_attendance:delete', 'class_attendance:insert', 'class_attendance_sessions:insert']) {
    persisted = await persist(failure);
    assert.equal(persisted.saved, false);
    if (failure === 'class_attendance:select') assert.deepEqual(persisted.calls, ['class_attendance:select']);
  }
  console.log('Class attendance summary: passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
