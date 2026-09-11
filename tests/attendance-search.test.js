// The attendance search filters rows without destroying unsaved work.
//
// Every row on the daily roster holds a status <select> the teacher may have
// already set. Re-rendering the list to filter it would discard those
// selections silently, which on this screen is the worst possible outcome -
// the unsaved selections ARE the work.
//
// The daily roster also pairs each student with an excuse-note-row whose own
// display is table-row or none depending on whether they are excused. Hiding
// by writing style.display would clobber that; hiding by class does not, and
// leaves the note row's own state intact when the filter clears.
//
// Run: node tests/attendance-search.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

// --- a DOM just real enough --------------------------------------------
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
  get innerText() {
    return this._text || this.children.map((c) => c.innerText).join(' ');
  }
  set textContent(v) { this._text = v; }
  get textContent() { return this._text; }
  get hidden() { return this.classList.contains('att-hidden'); }
}

function buildRoster(students) {
  const box = new El('div');
  const tbody = new El('tbody');
  box.children.push(tbody);
  for (const s of students) {
    const tr = new El('tr');
    tr.attrs['data-student-id'] = s.id;
    tr.attrs['data-enrollment'] = s.type === 'Homeschool' ? 'homeschool' : 'full-time';
    tr._text = `${s.name} ${s.grade} ${s.type}`;
    tbody.children.push(tr);
    if (s.excused !== undefined) {
      const note = new El('tr');
      note.classList.add('excuse-note-row');
      note.attrs['data-student-id'] = s.id;
      note._text = 'excuse note';
      // Its own pre-existing show/hide state, which the filter must not eat.
      note.style.display = s.excused ? 'table-row' : 'none';
      tbody.children.push(note);
    }
  }
  box.querySelectorAll = () => tbody.children;
  return box;
}

// --- pull the real method out of the page -------------------------------
const start = html.indexOf('\n    filterAttendanceRoster(scope) {');
if (start === -1) throw new Error('filterAttendanceRoster not found');
const end = html.indexOf('\n    }\n', start);
const body = html.slice(start, end + '\n    }\n'.length).trim();
const filterAttendanceRoster = eval(`(function ${body.slice('filterAttendanceRoster'.length)})`);

const students = [
  { id: 'a', name: 'Anne Becker', grade: '5', type: 'Full-Time', excused: true },
  { id: 'b', name: 'Jack Becker', grade: '1', type: 'Homeschool', excused: false },
  { id: 'c', name: 'Gabriel Chiarizio', grade: '4', type: 'Full-Time' },
  { id: 'd', name: 'Penny Mays', grade: '5', type: 'Homeschool' },
];

const input = new El('input');
const box = buildRoster(students);
const countEl = new El('span');

global.document = {
  getElementById: (id) => ({
    'daily-attendance-search': input,
    'daily-attendance-rows': box,
    'daily-attendance-search-count': countEl,
  }[id] || null),
};

const rows = box.querySelectorAll();
const entry = rows.filter((r) => !r.classList.contains('excuse-note-row'));
const notes = rows.filter((r) => r.classList.contains('excuse-note-row'));
const visible = () => entry.filter((r) => !r.hidden).map((r) => r.attrs['data-student-id']);

const app = { filterAttendanceRoster };
const run = (q) => {
  input.value = q;
  filterAttendanceRoster.call(app, 'daily-attendance');
};

run('becker');
check('surname matches both siblings', visible().join(','), 'a,b');
check('  ...and reports the count', countEl.textContent, '2 of 4 shown');

run('gabriel');
check('first name matches one', visible().join(','), 'c');

run('homeschool');
check('the enrolment line is searchable too', visible().join(','), 'b,d');

run('5');
check('grade is searchable', visible().join(','), 'a,d');

run('BECKER');
check('matching ignores case', visible().join(','), 'a,b');

run('zzzz');
check('no match hides everything', visible().length, 0);
check('  ...and says so', countEl.textContent, '0 of 4 shown');

run('');
check('clearing restores every row', visible().join(','), 'a,b,c,d');
check('  ...and the plain count', countEl.textContent, '4 students');

// The point of hiding by class: a note row that was closed stays closed, and
// one that was open reopens. Writing style.display would have lost both.
check("excused student's note is still marked open",
      notes.find((n) => n.attrs['data-student-id'] === 'a').style.display, 'table-row');
check("unexcused student's note is still closed",
      notes.find((n) => n.attrs['data-student-id'] === 'b').style.display, 'none');

// A filtered-out student must not leave their note row behind.
run('gabriel');
check('a hidden student hides their note row too',
      notes.every((n) => n.hidden), true);
run('anne');
check('a matched student un-hides their note row',
      notes.find((n) => n.attrs['data-student-id'] === 'a').hidden, false);

// --- the search box is now the only text filter on this screen ----------
//
// The All / Full-Time / Homeschool buttons were taken off the daily roster:
// every student on it is scheduled for today whatever their enrolment. The
// enrolment caption under each name stays, so it is still reachable by typing.
run('homeschool');
check('enrolment is reachable through the search box', visible().join(','), 'b,d');
run('full-time');
check('  ...and so is the other half', visible().join(','), 'a,c');

run('becker');
check('a surname still narrows to the pair', visible().join(','), 'a,b');
run('');
check('and clearing restores everyone', visible().join(','), 'a,b,c,d');
check('  ...with a plain count', countEl.textContent, '4 students');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
