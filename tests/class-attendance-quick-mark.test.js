// Taking a class register is one tap per student.
//
// The status column was a <select>: open it, then pick, for every child on the
// roster. It is now a tick, a cross, and a three-dot picker holding the rarer
// marks. Icons rather than labels because the register is taken on a phone,
// where three labelled buttons do not fit a table row.
//
// What must hold whichever control was touched:
//   - the hidden .class-attendance-status carries the value, because that is
//     what saveClassAttendance reads;
//   - exactly one button reads aria-pressed="true", or neither when the mark
//     came from the picker - a lit tick beside a stored 'late' is a lie;
//   - the chip shows the chosen mark's own icon, so a late student reads as
//     late rather than as three anonymous dots, and goes back to dots for
//     present, absent and unmarked;
//   - tapping the mark a student already has clears it, since unmarked is not
//     the same as absent and is not saved at all.
//
// Match Master paints rows through the same helper; that its controls follow
// the copied marks is covered in class-match-master.test.js.
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
const ok = (label, cond) => check(label, !!cond, true);

// --- a DOM just real enough ---------------------------------------------
const EXTRAS = [
  { value: 'late', text: '⏰ Late' },
  { value: 'left_early', text: '🚪 Left Early' },
  { value: 'late_left_early', text: '⚠️ Late & Left Early' },
];

function attrNode(initial = {}) {
  return {
    attrs: { ...initial },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  };
}

// One roster row, shaped the way showClassAttendance renders it.
function buildRow(id, status = '') {
  const field = { dataset: { studentId: id }, value: status };

  const buttons = ['present', 'absent'].map(s => Object.assign(
    attrNode({ 'aria-pressed': String(status === s) }), { dataset: { status: s } }));

  const chosen = EXTRAS.find(o => o.value === status);
  const glyph = { textContent: chosen ? chosen.text.split(' ')[0] : '⋯' };
  const select = {
    options: [{ value: '', text: '⋯ Other' }, ...EXTRAS],
    value: chosen ? status : '',
  };
  const more = Object.assign(attrNode({ 'data-chosen': String(!!chosen) }), {
    querySelector: (sel) => (sel === 'select' ? select : sel === '.att-more-glyph' ? glyph : null),
  });

  const tr = {
    querySelector: (sel) => (sel === '.class-attendance-status' ? field
      : sel === '.att-more' ? more : null),
    querySelectorAll: (sel) => (sel === '.att-mark button' ? buttons : []),
  };

  for (const node of [field, ...buttons, select]) node.closest = () => tr;
  return { tr, field, buttons, more, select, glyph };
}

// --- pull the real methods out of the page -------------------------------
function method(name) {
  const start = html.indexOf(`\n    ${name}(`);
  if (start === -1) throw new Error(`${name} not found in portal/index.html`);
  const end = html.indexOf('\n    }\n', start);
  return eval(`(function ${html.slice(start, end + 7).trim().slice(name.length)})`);
}

const app = {
  setClassAttendanceStatus: method('setClassAttendanceStatus'),
  _paintClassAttendanceRow: method('_paintClassAttendanceRow'),
};
const tap = (control, status) => app.setClassAttendanceStatus.call(app, control, status);

// --- what the row says ---------------------------------------------------
const saved = (r) => r.field.value;
const lit = (r) => r.buttons.filter(b => b.getAttribute('aria-pressed') === 'true')
  .map(b => b.dataset.status).join(',');
const chip = (r) => `${r.glyph.textContent}/${r.more.getAttribute('data-chosen')}`;
const btn = (r, status) => r.buttons.find(b => b.dataset.status === status);

console.log('\n== one tap marks a student ==\n');

let r = buildRow('s1');
check('starts unmarked', saved(r), '');
check('  ...with neither icon lit', lit(r), '');
check('  ...and the chip showing dots', chip(r), '⋯/false');

tap(btn(r, 'present'), 'present');
check('the tick saves the value', saved(r), 'present');
check('  ...and lights only the tick', lit(r), 'present');
check('  ...leaving the chip on its dots', chip(r), '⋯/false');

tap(btn(r, 'absent'), 'absent');
check('the cross replaces it in one tap', saved(r), 'absent');
check('  ...and only the cross is lit', lit(r), 'absent');

console.log('\n== the rarer marks live behind the three dots ==\n');

for (const { value, text } of EXTRAS) {
  const row = buildRow('s2', 'present');
  row.select.value = value;
  tap(row.select, value);
  check(`${value} saves`, saved(row), value);
  check('  ...clears both icons', lit(row), '');
  check('  ...and the chip shows that mark', chip(row), `${text.split(' ')[0]}/true`);
}

// A student marked late and then simply present must not leave the clock
// showing on the chip beside a lit tick.
r = buildRow('s3', 'late');
check('a late student renders with the clock', chip(r), '⏰/true');
tap(btn(r, 'present'), 'present');
check('switching to present puts the dots back', chip(r), '⋯/false');
check('  ...and saves present', saved(r), 'present');

console.log('\n== a mistaken tap can be taken back ==\n');

r = buildRow('s4', 'present');
tap(btn(r, 'present'), 'present');
check('tapping the current mark clears it', saved(r), '');
check('  ...and unlights the icon', lit(r), '');

r = buildRow('s5', 'late');
r.select.value = 'late';
tap(r.select, 'late');
check('re-picking the current extra clears it too', saved(r), '');
check('  ...and releases the chip', chip(r), '⋯/false');

console.log('\n== the page renders icons, not labels ==\n');

ok('the tick and cross are wired to one call',
  /onclick="app\.setClassAttendanceStatus\(this, '\$\{opt\.value\}'\)"/.test(html));
ok('  and carry only an icon as their content',
  /onclick="app\.setClassAttendanceStatus\(this, '\$\{opt\.value\}'\)">\$\{opt\.icon\}<\/button>/.test(html));
ok('the words Present and Not present survive only as labels for a screen reader',
  /aria-label="\$\{opt\.label\}" title="\$\{opt\.label\}"/.test(html));
ok('the three dots are the resting glyph', /\|\| '⋯'/.test(html));
ok('the picker carries the other marks', /const extraStatusOptions = \[/.test(html));
ok('the old dropdown is gone', !/<select class="class-attendance-status"/.test(html));
ok('the save still reads the same field', /row\.querySelector\('\.class-attendance-status'\)/.test(html));

// A row states what is searchable about it, or the words baked into the
// picker's options would match every student at once.
ok('class rows declare their own search text', /data-search="\$\{this\.escapeHtml/.test(html));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
