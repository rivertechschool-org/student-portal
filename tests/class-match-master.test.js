// "Match Master" on the class register.
//
// The daily attendance is the master. A teacher taking period 3 presses this to
// pull the day's marks onto the class rows rather than retyping them, and the
// button it replaced set every row to 'present' regardless of what the day said.
//
// Three rules, each of which fails silently rather than loudly:
//
//   * A STUDENT WITH NOTHING ON THE DAY IS LEFT ALONE. "Not taken" is not
//     "present". Defaulting those rows is the exact bug the old button had:
//     once saved, a guessed 'present' is indistinguishable from a mark someone
//     actually made, and the contradiction only surfaces weeks later when the
//     day and the period registers disagree.
//
//   * AN EXISTING MARK IS OVERWRITTEN, BUT ONLY WHERE THE DAY HAS AN ANSWER.
//     That is the point of the button - the day wins. What it must not do is
//     blank a mark the teacher made because the day happens to be silent.
//
//   * THE COUNTS ARE HONEST. "12 set from the day" when only 3 changed teaches
//     a teacher to distrust the button, and they will go back to retyping.
//
// The status vocabulary is shared with the daily register (present, absent,
// late, left_early, late_left_early), so this is a straight copy with no
// mapping - if those two lists ever diverge, this test is where it shows up.
//
// Run: node tests/class-match-master.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- extract the real method ------------------------------------------
function method(name, indent = '    ') {
  for (const sig of [`\n${indent}async ${name}(`, `\n${indent}${name}(`]) {
    const start = html.indexOf(sig);
    if (start === -1) continue;
    const end = html.indexOf(`\n${indent}}\n`, start);
    if (end === -1) throw new Error(name + ' unterminated');
    const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
    const isAsync = body.startsWith('async ');
    const src = isAsync ? body.slice('async '.length) : body;
    return eval(`(${isAsync ? 'async ' : ''}function ${src.slice(name.length)})`);
  }
  throw new Error(name + ' not found');
}

const matchClassToMaster = method('matchClassToMaster');

// ---- the smallest DOM the method touches -------------------------------
function run(rows, daily) {
  const selects = rows.map(r => ({ dataset: { studentId: r.id }, value: r.value || '' }));
  global.document = { querySelectorAll: () => selects };
  const notes = [];
  const app = {
    _classDaily: daily,
    showNotification: (message, type) => notes.push({ message, type }),
    matchClassToMaster,
  };
  app.matchClassToMaster();
  return { values: selects.map(s => s.value), note: notes[0] || null, notes };
}

// ---- the day wins ------------------------------------------------------
console.log('\n== the day is copied onto the class ==\n');

let r = run(
  [{ id: 'a', value: '' }, { id: 'b', value: '' }, { id: 'c', value: '' }],
  { a: { status: 'present' }, b: { status: 'absent' }, c: { status: 'late' } }
);
check('every status comes across', r.values, ['present', 'absent', 'late']);
ok('and the count is the number actually set', /3 set from the day/.test(r.note.message));
check('reported as a success', r.note.type, 'success');

r = run(
  [{ id: 'a', value: '' }, { id: 'b', value: '' }],
  { a: { status: 'left_early' }, b: { status: 'late_left_early' } }
);
check('the compound statuses copy too', r.values, ['left_early', 'late_left_early']);

r = run([{ id: 'a', value: 'present' }], { a: { status: 'absent' } });
check('the day overwrites a mark already on the row', r.values, ['absent']);

// ---- silence is not a mark ---------------------------------------------
console.log('\n== a student the day says nothing about ==\n');

r = run([{ id: 'a', value: '' }, { id: 'b', value: '' }], { a: { status: 'present' } });
check('no daily record leaves the row untouched', r.values, ['present', '']);
ok('and it is reported, not hidden', /1 not on the day's register/.test(r.note.message));

r = run([{ id: 'a', value: 'late' }], {});
check('an existing mark is never blanked by a silent day', r.values, ['late']);
check('nothing to do warns rather than claiming success', r.note.type, 'warning');
ok('  and says why', /nothing recorded for these students/.test(r.note.message));

r = run([{ id: 'a', value: '' }], { a: { status: null } });
check('a daily row with no status counts as silent', r.values, ['']);
check('  and warns', r.note.type, 'warning');

r = run([{ id: 'a', value: '' }], { a: {} });
check('an empty daily row counts as silent', r.values, ['']);

// ---- honest counts -----------------------------------------------------
console.log('\n== the counts match what happened ==\n');

r = run(
  [{ id: 'a', value: 'present' }, { id: 'b', value: '' }, { id: 'c', value: '' }],
  { a: { status: 'present' }, b: { status: 'absent' } }
);
check('values land correctly', r.values, ['present', 'absent', '']);
ok('one set', /1 set from the day/.test(r.note.message));
ok('one already matching, counted separately', /1 already matched/.test(r.note.message));
ok('one absent from the day', /1 not on the day's register/.test(r.note.message));

r = run([{ id: 'a', value: 'present' }], { a: { status: 'present' } });
check('nothing changed is not a failure', r.note.type, 'info');
ok('  and does not claim to have set anything', !/set from the day/.test(r.note.message));

ok('the note points at what still has to happen',
  /Save Attendance/.test(run([{ id: 'a', value: '' }], { a: { status: 'present' } }).note.message));

// ---- degenerate cases --------------------------------------------------
console.log('\n== nothing on screen ==\n');

r = run([], { a: { status: 'present' } });
check('no rows means no notification at all', r.notes.length, 0);

r = run([{ id: 'a', value: '' }], undefined);
check('a missing day map does not throw', r.values, ['']);
check('  it warns', r.note.type, 'warning');

// ---- the two vocabularies have to stay in step -------------------------
console.log('\n== daily and class offer the same statuses ==\n');

const lists = [...html.matchAll(/const statusOptions = \[\s*\{ value: 'present'[\s\S]*?\];/g)]
  .map(m => [...m[0].matchAll(/value: '([a-z_]+)'/g)].map(x => x[1]));
check('both registers were found', lists.length, 2);
check('and they offer identical statuses', lists[0], lists[1]);
ok('including the ones this test copies',
  ['present', 'absent', 'late', 'left_early', 'late_left_early'].every(v => lists[0].includes(v)));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
