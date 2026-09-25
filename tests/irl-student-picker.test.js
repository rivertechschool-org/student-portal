// The IRL shop picks one student, then shows the shop.
//
// It used to open with a table of every student in the school -- name, grade,
// balance, Select -- and a search that filtered it. A shop serves one child at
// a time, so the other hundred-odd rows were never what anybody was looking
// at, and on a phone they pushed the actual work off the bottom.
//
// A combobox instead. Three things this holds:
//
//   1. NOTHING BELOW UNTIL SOMEBODY IS CHOSEN. The shop actions are built by
//      _selectIRLStudent into their own area; the picker's job is to stay out
//      of the way until then, and to shrink to one line afterwards.
//   2. TYPING IS THE SHORTCUT. Three letters and Enter, without ever looking
//      at the list. That only works if Enter takes the highlighted row and the
//      highlight resets whenever the query changes.
//   3. THE LIST STAYS SHORT. An unbounded dropdown is the same problem in a
//      smaller box, so it caps -- and says so, rather than silently truncating
//      and letting somebody conclude a child is not enrolled.
//
// Run: node tests/irl-student-picker.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', closeParen);
  let depth = 0; const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  return new Function(args, html.slice(start + 1, i - 1));   // these are all sync
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Invented roster, deliberately awkward: a shared first name, a shared last
// name, and one whose surname is an ordinary word.
const STUDENTS = [
  { id: 's1', first_name: 'Marisol', last_name: 'Vance',    grade_level: 4, rtc_balance: 120 },
  { id: 's2', first_name: 'Marisol', last_name: 'Okonjo',   grade_level: 7, rtc_balance: 15 },
  { id: 's3', first_name: 'Teodor',  last_name: 'Vance',    grade_level: 6, rtc_balance: 0 },
  { id: 's4', first_name: 'Winnow',  last_name: 'Bell',     grade_level: 2, rtc_balance: 43 },
  { id: 's5', first_name: 'Bram',    last_name: 'Oyelaran', grade_level: 9, rtc_balance: 7 },
  { id: 's6', first_name: 'Ines',    last_name: 'Kaur',     grade_level: 5, rtc_balance: 250 },
  { id: 's7', first_name: 'Otto',    last_name: 'Lindqvist',grade_level: 3, rtc_balance: 88 },
  { id: 's8', first_name: 'Suri',    last_name: 'Patel',    grade_level: 8, rtc_balance: 12 },
  { id: 's9', first_name: 'Yusuf',   last_name: 'Adeyemi',  grade_level: 1, rtc_balance: 30 },
  { id: 's10', first_name: 'Zora',   last_name: 'Meier',    grade_level: 6, rtc_balance: 64 },
];

function makeApp() {
  const app = {
    _irlStudents: STUDENTS.slice(),
    _irlQuery: '',
    _irlHighlight: 0,
    _irlSelectedStudent: null,
    selected: [],
    escapeHtml: esc,
    jsAttr: (t) => String(t == null ? '' : t).replace(/'/g, '&#39;'),
    _selectIRLStudent(id) {
      app.selected.push(id);
      // Look in whatever roster the test set, not the module constant.
      app._irlSelectedStudent = (app._irlStudents || []).find(s => s.id === id) || null;
      app._closeIRLOptions();
      app._renderIRLPicker();
    },
  };
  app.picker  = { innerHTML: '' };
  app.form    = { innerHTML: 'SHOP ACTIONS' };
  app.options = { innerHTML: '', style: { display: 'none' },
                  querySelectorAll: () => [] };
  app.input   = { value: '', setAttribute(k, v) { this[k] = v; }, focus() {} };
  global.document = { getElementById: (id) =>
      id === 'irl-student-picker'  ? app.picker
    : id === 'irl-student-options' ? app.options
    : id === 'irl-student-search'  ? app.input
    : id === 'irl-purchase-form-area' ? app.form : null };
  for (const m of ['_renderIRLPicker', '_irlMatches', '_filterIRLStudents',
                   '_renderIRLOptions', '_closeIRLOptions', '_irlPickerKey', '_paintIRLHighlight',
                   '_changeIRLStudent']) {
    app[m] = extract(m);
  }
  return app;
}

const type = (app, q) => { app.input.value = q; app._filterIRLStudents(); };

(async () => {

  console.log('\n== the giant list is gone ==\n');

  ok('no table of every student is rendered any more',
     !/_renderIRLStudentList/.test(html));
  {
    const app = makeApp();
    app._renderIRLPicker();
    ok('the picker is one input', /id="irl-student-search"/.test(app.picker.innerHTML));
    ok('  and no student is listed before it is opened',
       !/Marisol/.test(app.picker.innerHTML));
  }

  console.log('\n== typing is the shortcut ==\n');

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'teo');
    const out = app.options.innerHTML;
    ok('three letters narrows to one', /Teodor/.test(out) && !/Marisol/.test(out));
    check('  and the dropdown is open', app.options.style.display, 'block');
  }

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'vance');
    check('a surname matches too', app._irlMatches().map(s => s.id), ['s1', 's3']);
  }

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'marisol o');
    check('first and last together narrow further', app._irlMatches().map(s => s.id), ['s2']);
  }

  {
    // The whole point: type, Enter, done -- without looking at the list.
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'winn');
    app._irlPickerKey({ key: 'Enter', preventDefault() {} });
    check('Enter takes the highlighted one', app.selected, ['s4']);
  }

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'marisol');
    app._irlPickerKey({ key: 'ArrowDown', preventDefault() {} });
    app._irlPickerKey({ key: 'Enter', preventDefault() {} });
    check('arrowing down picks the second', app.selected, ['s2']);
  }

  {
    // A stale highlight is how somebody charges the wrong child: arrow down,
    // keep typing, press Enter, and get whoever happens to sit at that index.
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'marisol');
    app._irlPickerKey({ key: 'ArrowDown', preventDefault() {} });
    check('  highlight moved', app._irlHighlight, 1);
    type(app, 'teo');
    check('typing again resets the highlight', app._irlHighlight, 0);
    app._irlPickerKey({ key: 'Enter', preventDefault() {} });
    check('  so Enter takes the new top match', app.selected, ['s3']);
  }

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'zzzz');
    ok('no match says so', /No student by that name/.test(app.options.innerHTML));
    app._irlPickerKey({ key: 'Enter', preventDefault() {} });
    check('  and Enter on nothing selects nobody', app.selected, []);
  }

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'mar');
    app._irlPickerKey({ key: 'Escape' });
    check('Escape closes it', app.options.style.display, 'none');
  }

  console.log('\n== the list stays short ==\n');

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, '');
    check('an empty query is capped, not the whole school', app._irlMatches().length, 8);
    ok('  and it says there are more', /Type to narrow/.test(app.options.innerHTML));
    ok('  with the real total', /10 students/.test(app.options.innerHTML));
  }

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'mar');
    ok('a narrowed list does not nag about narrowing',
       !/Type to narrow/.test(app.options.innerHTML));
  }

  console.log('\n== chosen, then the shop ==\n');

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'ines');
    app._irlPickerKey({ key: 'Enter', preventDefault() {} });
    const out = app.picker.innerHTML;
    ok('the picker shrinks to a line', /Ines/.test(out) && !/irl-student-search/.test(out));
    ok('  showing the balance, which is what a shop needs', /250 RTC/.test(out));
    ok('  and the grade', /Grade 5/.test(out));
    ok('  with a way to change it', /_changeIRLStudent/.test(out));
    check('  and the dropdown is shut', app.options.style.display, 'none');
  }

  {
    const app = makeApp();
    app._renderIRLPicker();
    type(app, 'ines');
    app._irlPickerKey({ key: 'Enter', preventDefault() {} });
    app._changeIRLStudent();
    ok('changing brings the input back', /irl-student-search/.test(app.picker.innerHTML));
    check('  clears the query', app._irlQuery, '');
    check('  and clears the shop actions, so they cannot belong to the old student',
          app.form.innerHTML, '');
  }

  console.log('\n== the wiring ==\n');

  ok('choosing a student collapses the picker before the form loads',
     /this\._irlSelectedStudent = student;\s*\n\s*this\._closeIRLOptions\(\);\s*\n\s*this\._renderIRLPicker\(\);/.test(html));
  ok('the shop actions still have their own area', /id="irl-purchase-form-area"/.test(html));
  {
    // Behavioural, not a source grep: that same `${esc(a)} ${esc(b)}` shape
    // appears in several other screens, so a regex over the file passes even
    // with the escaping stripped out of THIS one.
    const app = makeApp();
    app._irlStudents = [{ id: 'x1', first_name: '<img src=x onerror=alert(1)>',
                          last_name: 'O’"Brien', grade_level: 5, rtc_balance: 1 }];
    app._renderIRLPicker();
    type(app, 'img');
    const out = app.options.innerHTML;
    ok('a name is escaped in the dropdown', /&lt;img/.test(out) && !/<img/.test(out));
    ok('  including quotes', !/"Brien/.test(out) || /&quot;Brien/.test(out));

    app._irlPickerKey({ key: 'Enter', preventDefault() {} });
    const chip = app.picker.innerHTML;
    ok('  and in the line it collapses to', /&lt;img/.test(chip) && !/<img src=x/.test(chip));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
