const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n      (async )?' + name + '\\('));
  const end = html.indexOf('\n      }\n', start);
  return eval('(' + html.slice(start, end + 9).trim().replace(/^(async )?\w+\(/, (_, a) => (a || '') + 'function(') + ')');
}
const app = {
  _weekSessionsKey: () => 'week', _weekSessionsFor: 'week',
  _weekMonday: method('_weekMonday'), _localDateStr: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
  _weekClassEnrollments: ['a', 'b', 'c'].map(student_id => ({ class_id: 'class', student_id })),
  _weekSessions: {}, _weekClassMarks: [],
};
const date = app._localDateStr(app._weekMonday(new Date()));
const cls = { id: 'class', student_count: 3, max_students: 30 };
const count = () => method('classAttendanceCount').call(app, cls, 1, 2);
assert.equal(count(), '—/3');
app._weekSessions.class = [{ date, period: 2, status: 'completed' }];
assert.equal(count(), '0/3');
app._weekClassMarks = [
  { student_id: 'a', period: 2, status: 'present' },
  { student_id: 'a', period: 2, status: 'present' },
  { student_id: 'b', period: 2, status: 'late' },
  { student_id: 'c', period: 2, status: 'absent' },
  { student_id: 'withdrawn', period: 2, status: 'present' },
  { student_id: 'c', period: 3, status: 'present' },
].map(r => ({ class_id: 'class', date, ...r }));
assert.equal(count(), '2/3');
app._weekSessions.class[0].status = 'canceled';
assert.equal(count(), '—/3');
app._weekSessionsFor = null;
assert.equal(count(), '—/3');
app._weekSessionsFor = 'week';
app._weekClassEnrollments = [];
app._weekClassMarks = [];
app._weekSessions.class[0].status = 'completed';
assert.equal(count(), '0/0');
// Both the compact week cells and full class cards use the same counter.
assert.match(html, /classAttendanceCount\(cls, d, p\)/);
assert.match(html, /classAttendanceCount\(cls\)/);
console.log('Class card attendance counts: passed');
