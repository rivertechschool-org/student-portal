// Filtering attendance by cohort and by Homeschool/Full-Time.
//
// Two screens, two mechanisms, because the data lives in different places:
//
//   * The daily roster filters rows already on screen, by hiding them - the
//     same rule attendance-search.test.js guards, since those rows hold
//     unsaved status selects that a re-render would destroy. Group membership
//     rides along on each row as data-groups.
//   * The Attendance search screen filters FETCHED RECORDS. Group and
//     enrolment describe the student, not the attendance row, so they cannot
//     be expressed as query filters and are applied after the fetch, before
//     the statistics are computed.
//
// The rule that fails silently, and the reason the matcher is its own method:
// everywhere in this file a NULL enrollment_type reads as Full-Time. Comparing
// the raw column instead would drop every student whose type was never set out
// of BOTH filters, and attendance that quietly goes missing looks like
// attendance that was never taken.
//
// Run: node tests/attendance-group-filter.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};

// ---- extract the real methods -----------------------------------------
function method(name, indent = '      ') {
  const sig = `\n${indent}${name}(`;
  const start = html.indexOf(sig);
  if (start === -1) throw new Error(name + ' not found');
  const end = html.indexOf(`\n${indent}}\n`, start);
  if (end === -1) throw new Error(name + ' unterminated');
  const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
  return eval(`(function ${body.slice(name.length)})`);
}

// ======================================================================
// 1. The Attendance search screen: record-level matching.
// ======================================================================
const matches = method('_attendanceStudentMatches');

// Index shaped as _loadAttendanceStudentIndex builds it: enrolment already
// normalised, groups as studentId -> [groupId].
const index = {
  enrollment: {
    ann: 'full-time',
    ben: 'homeschool',
    cal: 'full-time',   // came back NULL from the column, folded here
    dee: 'homeschool',
  },
  groupsOf: {
    ann: ['g-jh'],
    ben: ['g-jh', 'g-choir'],
    cal: [],            // in no group at all
    // dee is absent from the map entirely
  },
};
const ALL = ['ann', 'ben', 'cal', 'dee', 'ghost'];
const keep = (group, enrollment) => ALL.filter((id) => matches(id, group, enrollment, index));

check('no filters keeps everyone', keep('all', 'all'), ALL);
check('group only', keep('g-jh', 'all'), ['ann', 'ben']);
check('a group nobody is in returns nobody', keep('g-empty', 'all'), []);
check('enrolment only: full-time', keep('all', 'full-time'), ['ann', 'cal']);
check('enrolment only: homeschool', keep('all', 'homeschool'), ['ben', 'dee']);
check('group AND enrolment intersect', keep('g-jh', 'homeschool'), ['ben']);
check('intersection can be empty', keep('g-choir', 'full-time'), []);

// A student with no groups is not secretly in every group.
check('no-group student excluded by any group filter', matches('cal', 'g-jh', 'all', index), false);
// A student missing from the group map behaves the same as one with [].
check('student absent from the group map is excluded', matches('dee', 'g-jh', 'all', index), false);

// The NULL normalisation, which is the whole reason the index exists.
check('a student whose type was NULL counts as Full-Time', matches('cal', 'all', 'full-time', index), true);
check('...and is not counted as Homeschool', matches('cal', 'all', 'homeschool', index), false);

// An unknown student is excluded rather than defaulted - defaulting would
// quietly pad the Full-Time results with records we cannot vouch for.
check('unknown student excluded by an enrolment filter', matches('ghost', 'all', 'full-time', index), false);
check('unknown student excluded by a group filter', matches('ghost', 'g-jh', 'all', index), false);
check('unknown student kept when nothing is filtered', matches('ghost', 'all', 'all', index), true);

// A half-built index must not throw - the screen degrades to no filter, and
// the load path already logs why.
check('missing groupsOf does not throw', matches('ann', 'g-jh', 'all', { enrollment: {} }), false);
check('missing enrollment does not throw', matches('ann', 'all', 'full-time', { groupsOf: {} }), false);

// ======================================================================
// 2. The daily roster: hiding rows in place.
// ======================================================================
class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.style = {};
    this._text = '';
    const self = this;
    this.classList = {
      _s: new Set(),
      contains: (c) => self.classList._s.has(c),
      toggle: (c, on) => { on ? self.classList._s.add(c) : self.classList._s.delete(c); },
      add: (c) => self.classList._s.add(c),
    };
  }
  getAttribute(k) { return this.attrs[k]; }
  setAttribute(k, v) { this.attrs[k] = v; }
  get innerText() { return this._text || this.children.map((c) => c.innerText).join(' '); }
  set textContent(v) { this._text = v; }
  get textContent() { return this._text; }
  get hidden() { return this.classList.contains('att-hidden'); }
}

const roster = [
  { id: 'ann', name: 'Anne Becker', grade: '5', type: 'Full-Time', groups: 'g-jh' },
  { id: 'ben', name: 'Jack Becker', grade: '1', type: 'Homeschool', groups: 'g-jh g-choir' },
  { id: 'cal', name: 'Gabriel Chiarizio', grade: '4', type: 'Full-Time', groups: '' },
  { id: 'dee', name: 'Penny Mays', grade: '5', type: 'Homeschool', groups: 'g-choir' },
];

const tbody = new El('tbody');
const box = new El('div');
box.children.push(tbody);
for (const s of roster) {
  const tr = new El('tr');
  tr.attrs['data-student-id'] = s.id;
  tr.attrs['data-enrollment'] = s.type === 'Homeschool' ? 'homeschool' : 'full-time';
  tr.attrs['data-groups'] = s.groups;
  tr._text = `${s.name} ${s.grade} ${s.type}`;
  tbody.children.push(tr);
  // An excuse-note row that must follow its student's fate, groups included.
  const note = new El('tr');
  note.classList.add('excuse-note-row');
  note.attrs['data-student-id'] = s.id;
  note._text = 'excuse note';
  tbody.children.push(note);
}
box.querySelectorAll = () => tbody.children;

const input = new El('input');
input.value = '';
const countEl = new El('span');
// The daily roster carries two group pickers: the short list of cohorts with
// someone on today's roster, and the full list of every cohort in the school.
// They share one filter, so whichever holds a choice is the one that applies.
const todaySel = new El('select');
todaySel.value = 'all';
const allSel = new El('select');
allSel.value = 'all';

const bar = new El('div');
bar.children = ['all', 'full-time', 'homeschool'].map((v) => {
  const b = new El('button');
  b.attrs['data-enrollment'] = v;
  b.attrs['data-active'] = String(v === 'all');
  return b;
});
bar.querySelectorAll = (sel) => (sel === 'button'
  ? bar.children
  : bar.children.filter((b) => b.attrs['data-active'] === 'true'));
bar.querySelector = (sel) => bar.querySelectorAll(sel)[0] || null;

const byId = {
  'daily-attendance-search': input,
  'daily-attendance-rows': box,
  'daily-attendance-search-count': countEl,
  'daily-attendance-enrollment': bar,
  'daily-attendance-group-today': todaySel,
  'daily-attendance-group-all': allSel,
};
global.document = { getElementById: (id) => byId[id] || null };

const filterAttendanceRoster = method('filterAttendanceRoster', '    ');
const setAttendanceEnrollment = method('setAttendanceEnrollment', '    ');
const setAttendanceGroup = method('setAttendanceGroup', '    ');
// setAttendanceEnrollment and setAttendanceGroup both re-run the filter
// through `this`.
const app = { filterAttendanceRoster };
const runFilter = () => filterAttendanceRoster.call(app, 'daily-attendance');
const setEnrolment = (v) => setAttendanceEnrollment.call(app, 'daily-attendance', v);
// Pick a cohort the way the page does: set the select, then fire its handler.
const pickToday = (v) => { todaySel.value = v; setAttendanceGroup.call(app, 'daily-attendance', 'today'); };
const pickAll = (v) => { allSel.value = v; setAttendanceGroup.call(app, 'daily-attendance', 'all'); };

const rows = tbody.children;
const entry = rows.filter((r) => !r.classList.contains('excuse-note-row'));
const notes = rows.filter((r) => r.classList.contains('excuse-note-row'));
const visible = () => entry.filter((r) => !r.hidden).map((r) => r.attrs['data-student-id']);
const visibleNotes = () => notes.filter((r) => !r.hidden).map((r) => r.attrs['data-student-id']);

runFilter();
check('unfiltered roster shows everyone', visible(), ['ann', 'ben', 'cal', 'dee']);
check('unfiltered count reads as a total', countEl.textContent, '4 students');

pickToday('g-jh');
check('group filter hides non-members', visible(), ['ann', 'ben']);
check('excuse notes follow their student', visibleNotes(), ['ann', 'ben']);
check('count switches to "of"', countEl.textContent, '2 of 4 shown');

pickToday('g-choir');
check('multi-group student appears under each group', visible(), ['ben', 'dee']);

// The same cohort reached from the other picker filters identically.
pickToday('all');
pickAll('g-choir');
check('the all-groups picker filters the same way', visible(), ['ben', 'dee']);

// Two group filters at once can only mean an empty roster, so choosing in one
// picker releases the other rather than intersecting with it.
pickToday('g-jh');
check('choosing in one picker clears the other', allSel.value, 'all');
check('  and only the new choice applies', visible(), ['ann', 'ben']);
pickAll('g-choir');
check('and the same the other way round', todaySel.value, 'all');
check('  leaving the all-groups choice showing', visible(), ['ben', 'dee']);

pickAll('all');
pickToday('g-choir');

// Group and enrolment compose, and so does the search box.
setEnrolment('homeschool');
check('group + enrolment', visible(), ['ben', 'dee']);
setEnrolment('full-time');
check('group + enrolment can empty the roster', visible(), []);
check('an empty result warns', countEl.style.color, 'var(--warning)');

setEnrolment('all');
input.value = 'penny';
runFilter();
check('group + search', visible(), ['dee']);

// Clearing puts everything back, notes included.
input.value = '';
pickToday('all');
check('clearing restores every row', visible(), ['ann', 'ben', 'cal', 'dee']);
check('clearing restores every note', visibleNotes(), ['ann', 'ben', 'cal', 'dee']);

// A school with no cohorts renders neither picker, and the class roster has
// never had one. Their absence must read as "all" rather than hiding every row.
delete byId['daily-attendance-group-today'];
runFilter();
check('one picker missing still filters on the other', visible(), ['ann', 'ben', 'cal', 'dee']);
delete byId['daily-attendance-group-all'];
runFilter();
check('no group picker means no group filtering', visible(), ['ann', 'ben', 'cal', 'dee']);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
