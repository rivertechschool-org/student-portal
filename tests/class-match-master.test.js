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
const _paintClassAttendanceRow = method('_paintClassAttendanceRow');

// ---- the smallest DOM the method touches -------------------------------
//
// A mark is no longer one <select>. It is a hidden field the save reads, two
// buttons, and a picker for the rarer statuses, and this button has to move all
// four together - a row whose stored value says 'absent' while the Present
// button is still lit is a lie the teacher will act on. So the stub is a real
// enough row rather than a bare value holder.
function buildRow(id, value) {
  const field = { dataset: { studentId: id }, value: value || '' };

  const buttons = ['present', 'absent'].map(status => ({
    dataset: { status },
    attrs: { 'aria-pressed': String(value === status) },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  }));

  const extras = ['late', 'left_early', 'late_left_early'];
  const more = {
    options: [{ value: '' }, ...extras.map(value => ({ value }))],
    value: extras.includes(value) ? value : '',
    attrs: { 'data-chosen': String(extras.includes(value)) },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  };

  const tr = {
    querySelector: (sel) => (sel === '.class-attendance-status' ? field
      : sel === '.att-quick-more' ? more : null),
    querySelectorAll: (sel) => (sel === '.att-quick-btn' ? buttons : []),
  };

  field.closest = () => tr;
  return { field, buttons, more, tr };
}

function run(rows, daily) {
  const built = rows.map(r => buildRow(r.id, r.value));
  const fields = built.map(b => b.field);
  global.document = { querySelectorAll: () => fields };
  const notes = [];
  const app = {
    _classDaily: daily,
    showNotification: (message, type) => notes.push({ message, type }),
    matchClassToMaster,
    _paintClassAttendanceRow,
  };
  app.matchClassToMaster();
  return {
    values: fields.map(f => f.value),
    // What the teacher actually sees: the lit button, or the picker's choice.
    shown: built.map(b => b.buttons.filter(x => x.getAttribute('aria-pressed') === 'true')
      .map(x => x.dataset.status)[0] || (b.more.getAttribute('data-chosen') === 'true' ? b.more.value : '')),
    note: notes[0] || null,
    notes,
  };
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

// ---- the row shows what it stores --------------------------------------
console.log('\n== the buttons follow the copied marks ==\n');

r = run(
  [{ id: 'a', value: '' }, { id: 'b', value: 'present' }, { id: 'c', value: '' }],
  { a: { status: 'present' }, b: { status: 'absent' }, c: { status: 'late' } }
);
check('stored values', r.values, ['present', 'absent', 'late']);
check('and the controls agree with them', r.shown, ['present', 'absent', 'late']);

// The one that used to go wrong: a lit Present button left behind after the
// day overwrote that row with a secondary mark.
r = run([{ id: 'a', value: 'present' }], { a: { status: 'left_early' } });
check('a button releases when the day supplies an extra', r.shown, ['left_early']);
check('  and the value follows', r.values, ['left_early']);

// ---- degenerate cases --------------------------------------------------
console.log('\n== nothing on screen ==\n');

r = run([], { a: { status: 'present' } });
check('no rows means no notification at all', r.notes.length, 0);

r = run([{ id: 'a', value: '' }], undefined);
check('a missing day map does not throw', r.values, ['']);
check('  it warns', r.note.type, 'warning');

// ---- the two vocabularies have to stay in step -------------------------
console.log('\n== daily and class offer the same statuses ==\n');

// The daily register still declares one flat list. The class register splits
// the same vocabulary across two buttons and an extras picker, so it is
// reassembled here in the order the daily list uses.
const dailyList = [...html.matchAll(/const statusOptions = \[\s*\{ value: 'present'[\s\S]*?\];/g)]
  .map(m => [...m[0].matchAll(/value: '([a-z_]+)'/g)].map(x => x[1]));
check('the daily register was found', dailyList.length, 1);

const classButtons = [...html.matchAll(/class="att-quick-btn" data-status="([a-z_]+)"/g)].map(m => m[1]);
const classExtras = [...html.matchAll(/const extraStatusOptions = \[[\s\S]*?\];/g)]
  .map(m => [...m[0].matchAll(/value: '([a-z_]+)'/g)].map(x => x[1]));
check('the class register was found', classExtras.length, 1);

const classList = [...classButtons, ...classExtras[0]];
check('and the two registers offer identical statuses', classList, dailyList[0]);
ok('including the ones this test copies',
  ['present', 'absent', 'late', 'left_early', 'late_left_early'].every(v => classList.includes(v)));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
