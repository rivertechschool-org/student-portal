// account_status means different things depending on who the row is.
//
//   teacher/admin  inactive -> they have left
//   parent         inactive -> never set up access
//   student        inactive -> NORMAL; enrolled, signs in by PIN
//
// 114 of 137 students are inactive and perfectly current, so labelling them the
// same way as a departed teacher was actively misleading. These cases pin the
// wording down, because it is the sort of thing that drifts the next time
// somebody edits one of the four render sites.
//
// Run: node tests/extract-portalui.js && node tests/account-status-badge.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

// Pull the two methods out of the class body and rebuild them as plain
// functions on a stub. Extracting rather than re-implementing is the point:
// a copy would pass even if the real code changed underneath it.
function extract(name) {
  const start = html.indexOf(`\n      ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  const end = html.indexOf('\n      }\n', start);
  if (end === -1) throw new Error(`end of ${name} not found`);
  return html.slice(start, end + '\n      }\n'.length);
}

const app = { jsAttr: (s) => String(s).replace(/'/g, '&#39;') };
for (const name of ['isActivated', 'accountStatusLabel', 'accountStatusBadge']) {
  const body = extract(name);
  const asFn = body.replace(new RegExp(`^\\s*${name}\\(`), 'function (');
  app[name] = eval(`(${asFn.trim()})`);
}

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const cases = [
  // [user_type, account_status, expected text]
  ['teacher', 'activated', 'Active'],
  ['teacher', 'inactive',  'Former'],
  ['admin',   'activated', 'Active'],
  ['admin',   'inactive',  'Former'],
  ['parent',  'activated', 'Active'],
  ['parent',  'inactive',  'No login'],
  ['student', 'activated', 'Has login'],
  ['student', 'inactive',  'PIN only'],

  // The Students roster does not select user_type, so rows arrive without one.
  // They come from a query already filtered to students, so student wording is
  // the correct fallback - not an accident to be relied on silently.
  [undefined, 'inactive',  'PIN only'],
  [undefined, 'activated', 'Has login'],

  // 'active' is the pre-rename spelling of 'activated' and still exists on old
  // rows. isActivated accepts it, so the badge must too.
  ['teacher', 'active',    'Active'],
  ['student', 'active',    'Has login'],
];

for (const [user_type, account_status, expected] of cases) {
  const profile = { user_type, account_status };
  check(`${user_type || '(no type)'} / ${account_status}`,
        app.accountStatusLabel(profile).text, expected);
}

// The two things a departed teacher and an enrolled PIN student must never
// share, since that confusion is the whole reason this helper exists.
check('teacher inactive !== student inactive',
      app.accountStatusLabel({ user_type: 'teacher', account_status: 'inactive' }).text
        !== app.accountStatusLabel({ user_type: 'student', account_status: 'inactive' }).text,
      true);

// Every case must carry an explanatory title; the label alone is terse.
for (const [user_type, account_status] of cases) {
  const b = app.accountStatusLabel({ user_type, account_status });
  check(`${user_type || '(no type)'}/${account_status} has a title`,
        typeof b.title === 'string' && b.title.length > 10, true);
}

// Badge markup: pill by default, bare when asked (for coloured headers).
const pill = app.accountStatusBadge({ user_type: 'student', account_status: 'inactive' });
check('pill has a background', /background:/.test(pill), true);
check('pill carries the label', /PIN only/.test(pill), true);
const bare = app.accountStatusBadge({ user_type: 'student', account_status: 'inactive' }, true);
check('plain has no background', /background:/.test(bare), false);
check('plain carries the label', /PIN only/.test(bare), true);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
