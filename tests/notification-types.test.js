// Every notification type the database permits must have an icon and a label.
//
// There used to be three copies of this map - a toast, a list row, a detail
// modal - and they had already drifted: the toast was missing two types the
// other two had. Because unknown types fall back to a bell, the gap never
// looked like a bug. It looked like a screen of identical grey bells.
//
// The value set comes from tools/checks.json, generated from the live CHECK
// constraint, so adding a type in the database and forgetting the front end
// fails here instead of shipping.
//
// Run: node tests/notification-types.test.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'portal', 'index.html'), 'utf8');
const contracts = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'checks.json'), 'utf8'));

const permitted = contracts['notifications.type'];
if (!permitted) throw new Error('notifications.type missing from tools/checks.json');
const types = permitted[0];

// Pull the real helper out of the page rather than restating it.
const start = html.indexOf('\n      notificationTypeConfig(');
if (start === -1) throw new Error('notificationTypeConfig not found');
const end = html.indexOf('\n      }\n', start);
const body = html.slice(start, end + '\n      }\n'.length).trim();
const notificationTypeConfig = eval(`(function ${body.slice('notificationTypeConfig'.length)})`);

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

const FALLBACK = notificationTypeConfig('__no_such_type__');

for (const t of types) {
  const c = notificationTypeConfig(t);
  // A type that silently resolves to the fallback is the drift this catches.
  check(`${t} has its own entry`, c.icon !== FALLBACK.icon || c.label !== FALLBACK.label, true);
  check(`${t} has a css class`, typeof c.class === 'string' && c.class.length > 0, true);
  check(`${t} has a label`, typeof c.label === 'string' && c.label.length > 0, true);
}

// The fallback itself must stay usable - an unknown type should render, not crash.
check('fallback has an icon', typeof FALLBACK.icon === 'string' && FALLBACK.icon.length > 0, true);
check('fallback has a class', FALLBACK.class, 'system');

// Only classes the stylesheet actually styles, or the icon renders unstyled.
const known = new Set(['message', 'assignment', 'grade', 'note', 'system']);
for (const t of types) {
  check(`${t} uses a known css class`, known.has(notificationTypeConfig(t).class), true);
}

// All three former call sites must now go through the helper: no map literals left.
check('no leftover typeConfig map', /const typeConfig = \{/.test(html), false);
check('no leftover typeIcons map', /const typeIcons = \{/.test(html), false);

console.log(`\n  ${types.length} permitted types checked`);
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
