// No two methods of ClassesPortalApp may share a name.
//
// Quick Add Note stopped adding notes, and nothing threw, nothing logged, and
// no request was made. The class carried TWO methods called addStudentNote:
//
//   line  9099  addStudentNote()                              the quick-add
//   line 18611  addStudentNote(classId, studentId, name)      opens a form
//
// A JS class body is not a merge - the later definition replaces the earlier
// one outright. So every "Add Note" button in the student hub, which calls
// app.addStudentNote() with no arguments, reached the form-opening one with
// all three arguments undefined. It opened a modal reading "Add Note for
// undefined" beneath the hub's own overlay, so from the front the button
// simply did nothing.
//
// That is the whole failure mode and why this test exists: the collision is
// silent. No syntax error, no runtime error, no console warning - the only
// symptom is a feature that quietly stops working, possibly thousands of
// lines from the edit that broke it. In a 62,000-line single-file app with
// 345 methods on one class, that is a trap worth a standing check.
//
// Run: node tests/no-duplicate-methods.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
const lines = html.split('\n');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};

const classAt = lines.findIndex((l) => /^\s*class ClassesPortalApp\s*\{/.test(l));
check('ClassesPortalApp was found', classAt !== -1, true);

// The class closes at the first 4-space `}` after it opens - every method sits
// deeper than that.
let classEnd = -1;
for (let i = classAt + 1; i < lines.length; i++) {
  if (/^ {4}\}\s*$/.test(lines[i])) { classEnd = i; break; }
}
check('its closing brace was found', classEnd !== -1, true);

// Methods are written at two indents in this file (4 and 6 spaces), so both
// are collected - reading only one depth is how a duplicate hides.
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return',
                          'else', 'try', 'do', 'function', 'constructor']);
const DEF = /^( {4}| {6})(?:async\s+|static\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/;

const seen = new Map();
for (let i = classAt + 1; i < classEnd; i++) {
  const m = DEF.exec(lines[i]);
  if (!m || KEYWORDS.has(m[2])) continue;
  if (!seen.has(m[2])) seen.set(m[2], []);
  seen.get(m[2]).push(i + 1);
}

check('methods were collected', seen.size > 100, true);

const dupes = [...seen.entries()]
  .filter(([, at]) => at.length > 1)
  .map(([name, at]) => `${name} at lines ${at.join(', ')} - line ${at[at.length - 1]} silently wins`);

check('no method name is defined twice', dupes, []);

// The specific pair that shipped broken, named so a regression says which.
check('addStudentNote is defined exactly once', (seen.get('addStudentNote') || []).length, 1);
check('the form-opener has its own name', (seen.get('showAddStudentNoteModal') || []).length, 1);

// A rename is only half a fix if a caller still points at the old name. The
// quick-add buttons call addStudentNote with NO arguments; the roster button
// passes three. If a call with arguments reappears, the collision is back in
// spirit even though the names now differ.
const argCalls = [...html.matchAll(/app\.addStudentNote\(([^)]*)\)/g)]
  .map((m) => m[1].trim())
  .filter((a) => a.length > 0);
check('every app.addStudentNote() call is argument-free', argCalls, []);

const modalCalls = [...html.matchAll(/app\.showAddStudentNoteModal\(([^)]*)\)/g)];
check('the modal opener is actually called', modalCalls.length > 0, true);

console.log(`\n  ${seen.size} methods checked on ClassesPortalApp`);
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
