// Which attendance buttons match to the master register automatically
// (2026-11-19): only the quick 📋 on a class card and its cell in the week
// view. "Class Attendance" inside a class opens the manual register, so a
// teacher can cancel the class without the day being matched and saved first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');

// Inside the class: manual (no quickMatch argument).
const inClass = html.match(/onclick="(app\.showClassAttendance\([^"]*\))">\s*📋 Class Attendance/);
assert(inClass, 'the Class Attendance button inside a class');
assert(!/,\s*true\)$/.test(inClass[1]), 'Class Attendance inside a class opens the manual register: ' + inClass[1]);

// The class card's quick button: automatic.
const card = html.match(/app\.showClassAttendance\('\$\{cls\.id\}', null, null, true\)"\s+title="Take attendance">📋/);
assert(card, 'the 📋 on the class card still matches automatically');

// The week view's cells: automatic.
assert(/\? `app\.showClassAttendance\('\$\{cls\.id\}', '\$\{dateStr\}', \$\{p === null \? 'null' : Number\(p\)\}, true\)`/.test(html), 'week-view cell matches automatically');

// The quick summary offers Cancel Class.
const summary = html.slice(html.indexOf('async _matchAndSummarizeClassAttendance('), html.indexOf('async _matchAndSummarizeClassAttendance(') + 6000);
assert(/showCancelClassModal\(/.test(summary), 'the quick-match summary can cancel the class');

console.log('class-attendance-entry-points: all passed');
