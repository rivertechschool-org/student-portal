// Where a class action lives.
//
// The Class Actions grid had grown to thirteen tiles for a teacher, which is
// past the point where a grid helps you find anything - and four of them were
// not class-level actions at all, they were things you do *inside* one of the
// other four.
//
// So each moved to the screen it operates on:
//
//   Add Students  -> the Students roster. It is what you opened the roster to do.
//   Gradebook     -> Assignments. It grades the assignments listed there.
//   Manage Grades -> Assignments. Same, for weights and the quarter grade.
//   Class Sheets  -> Class Notes. Both are this teacher's private record of the
//                    class; one is prose and one is a grid.
//
// Two rules this guards:
//
//   * A MOVED ACTION HAS EXACTLY ONE HOME IN THE CLASS MODAL. Leaving the tile
//     behind "just in case" is how a grid gets to thirteen in the first place,
//     and two ways in means neither is the obvious one.
//   * THE REMAINING TILES ARE STILL ALL THERE. This was a regrouping, not a
//     cull - losing Award RTC or Analytics to a careless slice would be a
//     silent capability loss that nobody notices until someone goes looking.
//
// Run: node tests/class-actions-grouping.test.js

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

// ---- slice each screen out of the file ---------------------------------
function between(startNeedle, endNeedle, from = 0) {
  const a = html.indexOf(startNeedle, from);
  if (a < 0) throw new Error('not found: ' + startNeedle);
  const b = html.indexOf(endNeedle, a);
  if (b < 0) throw new Error('end not found after ' + startNeedle);
  return html.slice(a, b);
}

// To the end of the whole block, not to the parent branch - the student tiles
// come after it, and a slice that stops early reports them missing.
const grid = between('<h4 style="margin-bottom: 10px;">Class Actions</h4>', "app.closeModal('class-details')");
const teacherTilesSlice = grid.slice(0, grid.indexOf(': isParent ?'));
const students = between('async manageStudents(', "this.showModal('manage-students'");
const assignments = between('async viewAssignments(', "this.showModal('view-assignments'");
const notes = between('showClassNotes(classId', "this.showModal('class-notes'");

ok('the grid was located', grid.length > 500 && grid.length < 6000);
ok('the Students modal was located', students.length > 500);
ok('the Assignments modal was located', assignments.length > 500);
ok('the Class Notes modal was located', notes.length > 500);

// ---- the four moved actions --------------------------------------------
console.log('\n== each moved action has exactly one home ==\n');

const MOVED = [
  ['Add Students', 'app.showAddStudentsToClass(', () => students, 'the Students roster'],
  ['Gradebook', 'gradebook.showGradebook(', () => assignments, 'Assignments'],
  ['Manage Grades', 'teacherGrades.showGradeManagementModal(', () => assignments, 'Assignments'],
  ['Class Sheets', 'app.showClassSheets(', () => notes, 'Class Notes'],
];

for (const [label, call, home, where] of MOVED) {
  check(`${label} is out of the grid`, grid.includes(call), false);
  ok(`${label} is in ${where}`, home().includes(call));
  check(`${label} is wired once in its new home`,
    (home().match(new RegExp(call.replace(/[.()]/g, '\\$&'), 'g')) || []).length, 1);
}

// ---- what stayed --------------------------------------------------------
console.log('\n== the rest of the grid is intact ==\n');

const KEPT = [
  ['Class Attendance', 'app.showClassAttendance('],
  ['Assignments', 'app.viewAssignments('],
  ['Discussions', 'app.viewDiscussions('],
  ['Students', 'app.manageStudents('],
  ['Analytics', 'app.classAnalytics('],
  ['Class Folder', "app.openDriveFolder('class',"],
  ['Resources', "app.openDriveFolder('class_resources',"],
  ['Class Notes', 'app.showClassNotes('],
  ['Award RTC', 'app.showClassRTCAward('],
];
for (const [label, call] of KEPT) ok(`${label} still in the grid`, grid.includes(call));

// Nine tiles for a teacher, not thirteen.
const teacherTiles = (teacherTilesSlice.match(/<button class="btn btn-(primary|secondary)"/g) || []).length;
check(`the teacher grid is down from thirteen tiles to nine`, teacherTiles, 9);

// ---- the moves did not break the people who never had these ------------
console.log('\n== students and parents are unaffected ==\n');

ok('parents still get their own two tiles',
   grid.includes('app.viewChildrenGrades(') && grid.includes("Children's Grades"));
ok('students still get My Grades', grid.includes('app.viewGrades('));
ok('students still get Class Resources', grid.includes('app.showClassResources('));

// Add Students is a teacher action; it must not have landed in a shared path.
const studentsFooter = students.slice(students.indexOf("closeModal('manage-students')"));
ok('Add Students sits in the Students footer', studentsFooter.includes('app.showAddStudentsToClass('));

// ---- the grading pair sits behind the teacher gate ---------------------
console.log('\n== grading tools stay teacher-only ==\n');

const teacherBlock = assignments.slice(assignments.indexOf('${isTeacher ? `'));
ok('Gradebook is inside the isTeacher branch', teacherBlock.includes('gradebook.showGradebook('));
ok('Manage Grades is inside it too', teacherBlock.includes('teacherGrades.showGradeManagementModal('));
ok('Create New Assignment is still there', teacherBlock.includes('app.createAssignment('));
ok('  and all three share one row', /<div style="display: flex; gap: 8px; flex-wrap: wrap;">/.test(teacherBlock));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
