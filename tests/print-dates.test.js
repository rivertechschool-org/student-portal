// A date of birth prints the day that is on file, in every timezone.
//
// 2026-11-05: birthdays on transcripts and report cards printed a day early.
// `new Date('2010-05-12')` means midnight UTC, which is still the 11th anywhere
// west of Greenwich, so a date with no time in it slid back a day when read as
// local time. Runs the real formatDate from each page, on invented dates.
//
// Run: node tests/print-dates.test.js
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${expected}, got ${actual}`); }
};

const zones = ['America/Los_Angeles', 'America/Denver', 'UTC', 'Asia/Tokyo'];

for (const page of ['report-card.html', 'transcript.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'portal', page), 'utf8');
  const start = html.indexOf('function formatDate(date) {');
  if (start < 0) throw new Error('formatDate not found in ' + page);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  const formatDate = eval(`(${html.slice(start, i + 1)})`);

  for (const tz of zones) {
    process.env.TZ = tz;
    const at = `${page} in ${tz}`;
    check(`${at}: a birthday`, formatDate('2010-05-12'), '05/12/2010');
    check(`${at}: the first of a month`, formatDate('2009-03-01'), '03/01/2009');
    check(`${at}: New Year's Day`, formatDate('2011-01-01'), '01/01/2011');
    check(`${at}: a leap day`, formatDate('2012-02-29'), '02/29/2012');
    check(`${at}: a birthday stored with a time`, formatDate('2010-05-12T00:00:00+00:00'), '05/12/2010');
    // The print date is a real moment, so it stays local.
    check(`${at}: today's print date`, formatDate(new Date(2026, 10, 5, 23, 30)), '11/05/2026');
  }
}

// The test means nothing unless the zone really changed.
process.env.TZ = 'America/Los_Angeles';
check('the timezone switch works here', new Date('2010-05-12').getDate(), 11);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
