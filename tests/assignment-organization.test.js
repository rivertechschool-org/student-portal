// Sort/group the real portal methods without a browser or hosted backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
const names = ['_normalizeAssignmentLayout', '_assignmentSortOptions', '_orderedClassAssignments', '_classAssignmentSections', '_renderClassAssignmentLayout', 'escapeHtml'];
const app = eval('({' + names.map(name => {
  const start = html.indexOf('\n      ' + name + '(');
  assert(start >= 0, name + ' exists');
  const end = html.indexOf('\n      }', start) + '\n      }'.length;
  return html.slice(start, end).trim();
}).join(',') + '})');
const work = [
  { id: 'a', title: 'Task 10', due_date: '2026-11-10T23:59:00Z', created_at: '2026-11-01T12:00:00Z' },
  { id: 'b', title: 'task 2', due_date: '2026-11-09T23:59:00Z', created_at: '2026-11-02T12:00:00Z' },
  { id: 'c', title: 'Task 1', due_date: '2026-11-11T23:59:00Z', created_at: '2026-11-03T12:00:00Z' }
];
const snapshot = JSON.stringify(work);
for (const [sort, expected] of [ ['newest', ['c','b','a']], ['oldest', ['a','b','c']],
  ['due_asc', ['b','a','c']], ['due_desc', ['c','a','b']], ['title', ['c','b','a']], ['custom', ['a','b','c']] ]) {
  assert.deepEqual(app._orderedClassAssignments(work, { sort, order: ['a', 'b'] }).map(a => a.id), expected, sort);
}
assert.equal(JSON.stringify(work), snapshot, 'ordering does not mutate query rows');
const ownVersion = work.map(a => a.id === 'a' ? { ...a, class_due_date: a.due_date, due_date: '2026-11-20T23:59:00Z' } : a);
assert.deepEqual(app._orderedClassAssignments(ownVersion, { sort: 'due_asc' }).map(a => a.id), ['b','a','c'], 'personal deadlines keep the class order');
const layout = { sort: 'custom', order: ['b', 'a', 'c'], groups: [
  { id: 'g', name: '<Unit 1>', assignment_ids: ['a', 'b', 'hidden'] },
  { id: 'hidden', name: 'Hidden work', assignment_ids: ['hidden'] }
] };
assert.deepEqual(app._classAssignmentSections(work, layout).map(s => [s.name, s.assignments.map(a => a.id)]), [
  ['<Unit 1>', ['b', 'a']], ['Other assignments', ['c']]
], 'group membership/order, newly added ungrouped work, and hidden-only groups');
const rendered = app._renderClassAssignmentLayout(work, layout, a => `<p>${a.id}</p>`);
assert(rendered.includes('&lt;Unit 1&gt;') && !rendered.includes('Hidden work'), 'group names are escaped and empty groups omitted');
const duplicate = structuredClone(layout);
duplicate.groups[1].assignment_ids = ['a', 'c'];
assert.deepEqual(app._classAssignmentSections(work, duplicate).flatMap(s => s.assignments.map(a => a.id)), ['b','a','c'], 'a duplicated ID never duplicates a visible assignment');
assert.deepEqual(app._normalizeAssignmentLayout({ sort: 'bad', order: [1,'a','a'], groups: [null, {}, { id: 'g', name: 'Unit', assignment_ids: ['b','b',null] }, { id: 'g', name: 'Duplicate' }] }),
  { sort: 'newest', order: ['a'], groups: [{ id: 'g', name: 'Unit', assignment_ids: ['b'] }] }, 'malformed/duplicate saved layout is normalized');
console.log('Assignment sort/group regressions passed');
