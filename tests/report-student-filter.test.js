// The Reports student picker filtered on `account_status === 'active'`.
// Nothing in user_profiles is spelled that way - the column holds 'activated'
// or 'inactive' - so the default option matched zero rows and the dropdown
// loaded empty on every visit. You had to switch to "All Students" before you
// could pick anyone.
//
// It was also the wrong question. A report card cares whether the child is
// still at the school. 114 of the 137 enrolled students have an inactive
// account, sign in by PIN, and are graded exactly like everyone else.
//
// Counts below are the real distribution as of 2026-09-07.
//
//   enrolled + activated    23
//   enrolled + inactive    114   <- the ones the old filter hid
//   past     + activated    14
//   past     + inactive     17
//
// Run: node tests/report-student-filter.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function extract(name) {
  const start = html.indexOf(`\n      ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  const end = html.indexOf('\n      }\n', start);
  return html.slice(start, end + '\n      }\n'.length);
}

// Minimal DOM: the method reads two selects and rebuilds one of them.
const made = [];
const studentSelect = {
  innerHTML: '',
  appendChild: (o) => made.push(o),
};
const statusSelect = { value: 'enrolled' };
const stubs = {
  'report-account-status': statusSelect,
  'report-student': studentSelect,
  'report-card-btn': { disabled: false, title: '' },
  'report-card-options': { style: {} },
};
global.document = {
  getElementById: (id) => stubs[id] || null,
  createElement: () => ({ value: '', textContent: '' }),
};

const app = {};
for (const name of ['isEnrolled', 'updateStudentFilterByStatus']) {
  const body = extract(name);
  const trimmed = body.trim();                       // starts with `<name>(`
  app[name] = eval(`(function ${trimmed.slice(name.length)})`);
}

// Rebuild the real population.
const rows = [];
const add = (n, student_status, account_status) => {
  for (let i = 0; i < n; i++) {
    rows.push({ id: `${student_status}-${account_status}-${i}`, first_name: 'A',
                last_name: `B${i}`, grade_level: 5, student_status, account_status });
  }
};
add(23,  'active', 'activated');
add(114, 'active', 'inactive');
add(14,  'past',   'activated');
add(17,  'past',   'inactive');
app.reportAllStudents = rows;

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${expected}, got ${actual}`); }
};

const run = (value) => {
  statusSelect.value = value;
  made.length = 0;
  app.updateStudentFilterByStatus();
  return made.length;   // "All Students" is set via innerHTML, not appendChild
};

check('enrolled -> every current student',      run('enrolled'), 137);
check('past -> only leavers',                   run('past'),      31);
check('all -> everybody',                       run('all'),      168);

// The specific regression: the default option must not come up empty.
check('default option is not empty',            run('enrolled') > 0, true);

// The old predicate, kept as a guard. If someone reintroduces a literal
// comparison, this is the number of students they would silently hide.
check('the old comparison still matches nothing',
      rows.filter((s) => s.account_status === 'active').length, 0);

// Only past students get a suffix, and a PIN-only pupil never gets one.
run('all');
const suffixed = made.filter((o) => /\[past student\]/.test(o.textContent)).length;
check('31 rows marked past under "all"', suffixed, 31);
check('no row says "[inactive]"',
      made.filter((o) => /inactive/i.test(o.textContent)).length, 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
