// What a parent sees of one child's assignment (2026-11-18): work turned in
// says so until it is graded, and work graded offline stays hidden until it
// is graded or excused. The real method is extracted from the page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n      (?:async )?' + name + '\\('));
  assert(start >= 0, name);
  const end = html.indexOf('\n      }', start);
  return html.slice(start, end + 8).trim();
}
const app = eval(`({${method('_parentAssignmentStatus')}})`);
const now = new Date('2026-11-18T12:00:00Z');
const past = '2026-11-10T16:00:00Z', future = '2026-11-25T16:00:00Z';
const key = (a, s) => app._parentAssignmentStatus(a, s, now)?.key ?? null;
const online = (due = past) => ({ due_date: due, graded_offline: false, assignment_type: 'regular' });
const offline = (due = past) => ({ due_date: due, graded_offline: true, assignment_type: 'regular' });

// Turned in but not graded: says so, whether submitted or under review, and
// whether or not it is past due.
assert.equal(key(online(), { status: 'submitted' }), 'turned_in');
assert.equal(key(online(), { status: 'under_review' }), 'turned_in', 'under review is still turned in');
assert.equal(key(online(future), { status: 'submitted' }), 'turned_in');
assert.equal(app._parentAssignmentStatus(online(), { status: 'submitted' }, now).text, 'Turned in, not graded yet');
// Graded, excused, missing, not yet due.
assert.equal(key(online(), { status: 'graded' }), 'graded');
assert.equal(key(online(), { status: 'excused' }), 'excused');
assert.equal(key(online(), undefined), 'missing');
assert.equal(key(online(future), undefined), 'not_turned_in');

// Offline: hidden until graded or excused - never "missing", never "turned in".
assert.equal(key(offline(), undefined), null);
assert.equal(key(offline(future), undefined), null);
assert.equal(key(offline(), { status: 'submitted' }), null);
assert.equal(key(offline(), { status: 'graded' }), 'graded');
assert.equal(key(offline(), { status: 'excused' }), 'excused');

// Info posts (saved as offline, nothing to hand in) are reading: shown.
assert.equal(key({ ...offline(), assignment_type: 'info' }, undefined), 'info');

console.log('parent-assignment-status: all passed');
