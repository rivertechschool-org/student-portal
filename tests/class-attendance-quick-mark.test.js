// Taking a class register is one click per student.
//
// The status column used to be a <select>: open it, then pick an option, for
// every single student on the roster. Present and Not Present are now buttons
// that mark in one tap, and the three rarer marks (late, left early, both) sit
// in a picker beside them.
//
// What must hold no matter which control was touched:
//   - the hidden .class-attendance-status carries the value, because that is
//     what saveClassAttendance reads;
//   - exactly one button reads aria-pressed="true", or none of them when the
//     mark came from the picker;
//   - the picker shows a secondary mark and nothing else, so it can never
//     display "Late" for a student who is marked present;
//   - tapping the mark a student already has clears it, since unmarked is not
//     the same as absent and is not saved at all.
//
// Run: node tests/class-attendance-quick-mark.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

// --- a DOM just real enough ---------------------------------------------
class El {
  constructor(tag, attrs = {}) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.value = '';
    this.options = [];
    this.parent = null;
  }
  get dataset() {
    const out = {};
    for (const [k, v] of Object.entries(this.attrs)) {
      if (k.startsWith('data-')) out[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    }
    return out;
  }
  getAttribute(k) { return this.attrs[k]; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(child) { child.parent = this; this.children.push(child); return child; }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  matches(sel) {
    if (sel.startsWith('.')) return (this.attrs.class || '').split(/\s+/).includes(sel.slice(1));
    if (sel.startsWith('tr[')) return this.tag === 'tr' && 'data-student-id' in this.attrs;
    return this.tag === sel;
  }
  querySelectorAll(sel) { return this.descendants().filter((el) => el.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    let node = this;
    while (node) { if (node.matches(sel)) return node; node = node.parent; }
    return null;
  }
}

// One roster row, shaped the way showClassAttendance renders it.
function buildRow(id, status = '') {
  const tr = new El('tr', { 'data-student-id': id });
  tr.append(new El('input', { class: 'class-attendance-status', 'data-student-id': id })).value = status;

  for (const s of ['present', 'absent']) {
    tr.append(new El('button', {
      class: 'att-quick-btn',
      'data-status': s,
      'aria-pressed': String(status === s),
    }));
  }

  const more = tr.append(new El('select', { class: 'att-quick-more' }));
  more.options = [
    { value: '' },
    { value: 'late' },
    { value: 'left_early' },
    { value: 'late_left_early' },
  ];
  const isExtra = more.options.some((o) => o.value && o.value === status);
  more.value = isExtra ? status : '';
  more.setAttribute('data-chosen', String(isExtra));
  return tr;
}

// --- pull the real methods out of the page -------------------------------
function method(name) {
  const start = html.indexOf(`\n    ${name}(`);
  if (start === -1) throw new Error(`${name} not found in portal/index.html`);
  const end = html.indexOf('\n    }\n', start);
  const body = html.slice(start, end + '\n    }\n'.length).trim();
  return eval(`(function ${body.slice(name.length)})`);
}

const app = {
  setClassAttendanceStatus: method('setClassAttendanceStatus'),
  _paintClassAttendanceRow: method('_paintClassAttendanceRow'),
  markAllClassPresent: method('markAllClassPresent'),
};

// --- what the row says ---------------------------------------------------
const saved = (tr) => tr.querySelector('.class-attendance-status').value;
const lit = (tr) => tr.querySelectorAll('.att-quick-btn')
  .filter((b) => b.getAttribute('aria-pressed') === 'true')
  .map((b) => b.getAttribute('data-status'))
  .join(',');
const picker = (tr) => {
  const more = tr.querySelector('.att-quick-more');
  return `${more.value}/${more.getAttribute('data-chosen')}`;
};
const btn = (tr, status) => tr.querySelectorAll('.att-quick-btn')
  .find((b) => b.getAttribute('data-status') === status);

console.log('\n== one click marks a student ==\n');

let row = buildRow('s1');
check('starts unmarked', saved(row), '');
check('  ...with no button lit', lit(row), '');

app.setClassAttendanceStatus.call(app, btn(row, 'present'), 'present');
check('Present saves the value', saved(row), 'present');
check('  ...and lights only Present', lit(row), 'present');
check('  ...leaving the picker on its placeholder', picker(row), '/false');

app.setClassAttendanceStatus.call(app, btn(row, 'absent'), 'absent');
check('Not Present replaces it in one click', saved(row), 'absent');
check('  ...and only Not Present is lit', lit(row), 'absent');

console.log('\n== the secondary marks live in the picker ==\n');

for (const extra of ['late', 'left_early', 'late_left_early']) {
  const r = buildRow('s2', 'present');
  const more = r.querySelector('.att-quick-more');
  more.value = extra;
  app.setClassAttendanceStatus.call(app, more, extra);
  check(`${extra} saves`, saved(r), extra);
  check(`  ...clears both buttons`, lit(r), '');
  check(`  ...and marks the picker chosen`, picker(r), `${extra}/true`);
}

// A student who was late and is then just present must not leave "Late"
// showing in the picker next to a lit Present button.
row = buildRow('s3', 'late');
check('a late student renders with the picker set', picker(row), 'late/true');
app.setClassAttendanceStatus.call(app, btn(row, 'present'), 'present');
check('switching to Present resets the picker', picker(row), '/false');
check('  ...and saves present', saved(row), 'present');

console.log('\n== a mistaken tap can be taken back ==\n');

row = buildRow('s4', 'present');
app.setClassAttendanceStatus.call(app, btn(row, 'present'), 'present');
check('tapping the current mark clears it', saved(row), '');
check('  ...and unlights the button', lit(row), '');

row = buildRow('s5', 'late');
const more5 = row.querySelector('.att-quick-more');
more5.value = 'late';
app.setClassAttendanceStatus.call(app, more5, 'late');
check('re-picking the current extra clears it too', saved(row), '');
check('  ...and releases the picker', picker(row), '/false');

console.log('\n== Mark All Present still works ==\n');

const box = new El('div', { class: 'rows' });
const rows = ['a', 'b', 'c'].map((id) => box.append(buildRow(id)));
rows[1].querySelector('.class-attendance-status').value = 'late';
rows[1].querySelector('.att-quick-more').value = 'late';

global.document = {
  querySelectorAll: (sel) => (sel === '#class-attendance-rows .class-attendance-status'
    ? box.querySelectorAll('.class-attendance-status')
    : []),
};

app.markAllClassPresent.call(app, 'class-1', '2026-09-10');
check('every row saves present', rows.map(saved).join(','), 'present,present,present');
check('every Present button lights', rows.map(lit).join(','), 'present,present,present');
check('the late student\'s picker is released', picker(rows[1]), '/false');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
