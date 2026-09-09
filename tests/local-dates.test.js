// "Today" must be today HERE, not in UTC.
//
// The school is on Mountain Time. `new Date().toISOString().split('T')[0]`
// returns the UTC date, which from about 5pm local onward is already tomorrow.
// Every screen that defaulted to "today" therefore opened on tomorrow's date
// after the school day ended - which is exactly when you sit down to fill in
// attendance retroactively. 18 places in the file did this.
//
// Two checks: the helper is correct for any instant, and nothing has crept back
// to deriving a calendar day from UTC.
//
// Run: node tests/local-dates.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

// Pull the real helper rather than restating it.
const start = html.indexOf('\n      _localDateStr(d) {');
if (start === -1) throw new Error('_localDateStr not found');
const end = html.indexOf('\n      }\n', start);
const body = html.slice(start, end + '\n      }\n'.length).trim();
const _localDateStr = eval(`(function ${body.slice('_localDateStr'.length)})`);

// The invariant: whatever the timezone, the answer is the LOCAL calendar date.
const pad = (n) => String(n).padStart(2, '0');
const localOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Every hour across a couple of days, plus the boundaries that actually bite.
let checkedHours = 0;
let divergences = 0;
const base = new Date(2026, 8, 8, 0, 0, 0);      // 8 Sep 2026, local midnight
for (let h = 0; h < 48; h++) {
  const d = new Date(base.getTime() + h * 3600000);
  if (_localDateStr(d) !== localOf(d)) {
    fail++;
    console.log(`  FAIL  hour ${h}: got ${_localDateStr(d)}, local date is ${localOf(d)}`);
  } else {
    checkedHours++;
  }
  // How often would the old UTC approach have been wrong here?
  if (d.toISOString().split('T')[0] !== localOf(d)) divergences++;
}
check('local date correct for every hour across two days', checkedHours, 48);

// Late evening is the case that broke attendance. In any timezone behind UTC
// this is the hour where the two disagree.
const evening = new Date(2026, 8, 8, 23, 30, 0);
check('11:30pm still reports the same local day', _localDateStr(evening), localOf(evening));
check('  ...and that is the 8th', _localDateStr(evening), '2026-09-08');

// Tomorrow, as the pickup-note editor computes it.
const tomorrow = new Date(new Date(2026, 8, 8, 23, 30, 0).getTime() + 86400000);
check('tomorrow from a late evening is the 9th', _localDateStr(tomorrow), '2026-09-09');

// A date-only value round-trips rather than shifting.
const parsed = new Date('2026-09-08T12:00:00');
check('a noon-anchored date keeps its day', _localDateStr(parsed), '2026-09-08');

// --- the regression guard ------------------------------------------------
// Any calendar day derived from toISOString is the bug coming back.
const utcDerivations = (html.match(/toISOString\(\)\.split\('T'\)\[0\]/g) || []).length;
check('no calendar day is derived from UTC', utcDerivations, 0);

console.log(`\n  timezone here: UTC${-new Date().getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-new Date().getTimezoneOffset() / 60}`);
console.log(`  hours where UTC would have given the wrong day: ${divergences}/48`);
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
