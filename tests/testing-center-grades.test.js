// Grading a test in the Testing Center, and where that grade goes.
//
// Four things, each one a teacher report:
//
//   * THE POINTS ON EACH QUESTION COUNT. A test is scored as points earned over
//     points possible. It used to average multiple choice and written answers
//     by how MANY questions each had, so a 10-point essay weighed the same as a
//     1-point multiple-choice question.
//   * A TYPED SCORE STAYS INSIDE THE QUESTION. 90 typed into a "/ 10" box is 10,
//     not 900%.
//   * THE GRADE REACHES THE CLASS. Grading writes the class assignment's grade,
//     converted to that assignment's points, or to the student's own version's
//     points when the teacher gave them one. A test that never got its class
//     assignment (assigned from the Testing Center opened on its own) gets one
//     at grading, instead of the grade going nowhere.
//   * WHEN IT DOES NOT, THE TEACHER IS TOLD.
//
// The real functions are pulled out of extensions/testing-center.html and run
// against an in-memory database.
//
// Run: node tests/testing-center-grades.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'extensions', 'testing-center.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};

// Top-level functions in that page sit at 8 spaces.
function extract(name) {
  const re = new RegExp('\\n        (?:async\\s+)?function ' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', m.index + m[0].length);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(m.index + 1, i);
}

// ---- an in-memory database ------------------------------------------------
function makeDb(tables) {
  let nextId = 1;
  const rowsOf = t => (tables[t] = tables[t] || []);
  const from = (table) => {
    const filters = [];
    let op = 'select', payload = null, conflict = null, lim = null;
    const match = r => filters.every(f => f(r));
    const run = () => {
      const rows = rowsOf(table);
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: 'n' + nextId++, ...p }));
        rows.push(...list);
        return list.map(r => ({ ...r }));
      }
      if (op === 'upsert') {
        const keys = conflict.split(',');
        let row = rows.find(r => keys.every(k => r[k] === payload[k]));
        if (row) Object.assign(row, payload); else { row = { id: 'n' + nextId++, ...payload }; rows.push(row); }
        return [{ ...row }];
      }
      if (op === 'update') {
        const hit = rows.filter(match); hit.forEach(r => Object.assign(r, payload));
        return hit.map(r => ({ ...r }));
      }
      let out = rows.filter(match).map(r => ({ ...r }));
      if (lim != null) out = out.slice(0, lim);
      return out;
    };
    const q = {
      select() { return q; },
      insert(p) { op = 'insert'; payload = p; return q; },
      update(p) { op = 'update'; payload = p; return q; },
      upsert(p, o) { op = 'upsert'; payload = p; conflict = o.onConflict; return q; },
      eq(c, v) { filters.push(r => r[c] === v); return q; },
      not(c, _is, v) { filters.push(r => r[c] !== v && r[c] !== undefined); return q; },
      limit(n) { lim = n; return q; },
      order() { return q; },
      single() { const d = run(); return Promise.resolve(d.length === 1 ? { data: d[0], error: null } : { data: null, error: { message: 'not one row' } }); },
      maybeSingle() { const d = run(); return Promise.resolve({ data: d[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    return q;
  };
  return { from };
}

// ---- the page, around the functions under test ---------------------------
function makePage({ test, submission, tables, inputs }) {
  const toasts = [];
  const ctx = {
    console: { log() {}, error() {} },
    supabaseClient: makeDb(tables),
    authReady: true,
    isEmbedded: false,
    currentUser: { id: 'teacher1' },
    testsDatabase: [test],
    submissionsDatabase: { k: submission },
    gradingSubmissionKey: 'k',
    currentViewTestId: null,
    document: { getElementById: id => (id in inputs ? { value: inputs[id] } : null) },
    closeModal() {}, renderTests() {}, viewSubmissions() {},
    showToast: m => toasts.push(m),
  };
  vm.createContext(ctx);
  for (const n of ['testTotalPoints', 'gradebookPointsFor', 'ensureGradebookAssignment', 'saveGradesToDatabase', 'saveGrades']) {
    vm.runInContext(extract(n), ctx);
  }
  return { ctx, toasts };
}

// A test: four 1-point multiple-choice questions and one 10-point essay.
const TEST = {
  id: 'test1', title: 'Unit 3',
  questions: [
    { id: 1, type: 'multiple-choice', maxPoints: 1, correctAnswer: 0 },
    { id: 2, type: 'multiple-choice', maxPoints: 1, correctAnswer: 0 },
    { id: 3, type: 'multiple-choice', maxPoints: 1, correctAnswer: 0 },
    { id: 4, type: 'multiple-choice', maxPoints: 1, correctAnswer: 0 },
    { id: 5, type: 'write-in', maxPoints: 10 },
  ],
};

function world({ linked = true, version = null, assignmentPoints = 14 } = {}) {
  const tables = {
    test_submissions: [{ id: 'ts1', test_id: 'test1', student_id: 'stu1', test_assignment_id: 'ta1',
      max_possible_score: 14, linked_submission_id: linked ? 'as1' : null }],
    test_assignments: [{ id: 'ta1', test_id: 'test1', class_id: 'class1', student_id: null,
      due_date: '2026-10-20', linked_assignment_id: linked ? 'a1' : null }],
    assignments: linked ? [{ id: 'a1', class_id: 'class1', max_points: assignmentPoints }] : [],
    assignment_submissions: linked ? [{ id: 'as1', assignment_id: 'a1', student_id: 'stu1', status: 'submitted', points_earned: null }] : [],
    assignment_student_versions: version ? [{ assignment_id: 'a1', student_id: 'stu1', points_possible: version }] : [],
    test_question_grades: [],
    assignment_students: [],
  };
  return tables;
}
const sub = (autoScore) => ({ id: 'ts1', testId: 'test1', studentId: 'stu1', autoScore, gradedAnswers: {}, status: 'pending_review' });

(async () => {
  console.log('\n== the points on each question count ==\n');

  // All four multiple choice right (4 of 4 points), essay 0 of 10:
  // 4 / 14 = 29%. Averaged by question count it came out 80%.
  {
    const tables = world();
    const { ctx } = makePage({ test: TEST, submission: sub(100), tables, inputs: { 'grade-5': '0' } });
    await ctx.saveGrades();
    check('4 one-point questions right, 10-point essay zero: 29%', ctx.submissionsDatabase.k.finalScore, 29);
  }
  // Multiple choice all wrong, essay full marks: 10 / 14 = 71%.
  {
    const tables = world();
    const { ctx } = makePage({ test: TEST, submission: sub(0), tables, inputs: { 'grade-5': '10' } });
    await ctx.saveGrades();
    check('essay full marks, multiple choice zero: 71%', ctx.submissionsDatabase.k.finalScore, 71);
  }
  // A 9 out of 10 on a test that is only the essay is 90%, never 900%.
  {
    const essayOnly = { id: 'test1', title: 'Essay', questions: [{ id: 1, type: 'write-in', maxPoints: 10 }] };
    const tables = world({ assignmentPoints: 10 });
    const { ctx } = makePage({ test: essayOnly, submission: sub(0), tables, inputs: { 'grade-1': '9' } });
    await ctx.saveGrades();
    check('9 of 10 is 90%', ctx.submissionsDatabase.k.finalScore, 90);
    check('  and 9 points in a 10-point gradebook entry', tables.assignment_submissions[0].points_earned, 9);
    check('  marked graded there', tables.assignment_submissions[0].status, 'graded');
  }

  console.log('\n== a typed score stays inside the question ==\n');
  {
    const essayOnly = { id: 'test1', title: 'Essay', questions: [{ id: 1, type: 'write-in', maxPoints: 10 }] };
    const tables = world({ assignmentPoints: 10 });
    const { ctx } = makePage({ test: essayOnly, submission: sub(0), tables, inputs: { 'grade-1': '90' } });
    await ctx.saveGrades();
    check('90 typed into a "/ 10" box counts as 10', ctx.submissionsDatabase.k.finalScore, 100);
  }
  {
    const essayOnly = { id: 'test1', title: 'Essay', questions: [{ id: 1, type: 'write-in', maxPoints: 10 }] };
    const tables = world({ assignmentPoints: 10 });
    const { ctx } = makePage({ test: essayOnly, submission: sub(0), tables, inputs: { 'grade-1': '7.5' } });
    await ctx.saveGrades();
    check('half points are kept: 7.5 of 10 is 75%', ctx.submissionsDatabase.k.finalScore, 75);
  }

  console.log('\n== the grade reaches the class ==\n');
  {
    // 100% on a test whose class assignment is out of 50.
    const tables = world({ assignmentPoints: 50 });
    const { ctx, toasts } = makePage({ test: TEST, submission: sub(100), tables, inputs: { 'grade-5': '10' } });
    await ctx.saveGrades();
    check('converted to the class assignment\'s points', tables.assignment_submissions[0].points_earned, 50);
    check('  and the teacher is told it saved', toasts[0], 'Grades saved successfully!');
  }
  {
    // The student has their own version, out of 20.
    const tables = world({ assignmentPoints: 50, version: 20 });
    const { ctx } = makePage({ test: TEST, submission: sub(100), tables, inputs: { 'grade-5': '10' } });
    await ctx.saveGrades();
    check('a student\'s own version sets the points it is out of', tables.assignment_submissions[0].points_earned, 20);
  }
  {
    // Assigned from the Testing Center opened on its own: no class assignment yet.
    const tables = world({ linked: false });
    const { ctx, toasts } = makePage({ test: TEST, submission: sub(100), tables, inputs: { 'grade-5': '10' } });
    await ctx.saveGrades();
    const made = tables.assignments[0];
    check('a test with no class assignment gets one when graded', !!made, true);
    check('  titled as a test', made && made.title, '[Test] Unit 3');
    check('  in the right class', made && made.class_id, 'class1');
    check('  out of the test\'s points', made && made.max_points, 14);
    check('  and linked, so it is not made twice', tables.test_assignments[0].linked_assignment_id, made && made.id);
    check('  with this student\'s grade in it', tables.assignment_submissions[0] && tables.assignment_submissions[0].points_earned, 14);
    check('  and no warning', toasts[0], 'Grades saved successfully!');
  }

  console.log('\n== when it does not, the teacher is told ==\n');
  {
    // A test with no class at all (nothing to link to).
    const tables = world({ linked: false });
    tables.test_assignments[0].class_id = null;
    const { ctx, toasts } = makePage({ test: TEST, submission: sub(100), tables, inputs: { 'grade-5': '10' } });
    await ctx.saveGrades();
    check('the toast says it did not reach the gradebook', /not in the class gradebook/.test(toasts[0] || ''), true);
  }

  console.log('\n== multiple choice is scored by points when handed in ==\n');
  {
    const body = extract('submitTest');
    check('counts each question\'s points', /mcEarned \+= q\.maxPoints \|\| 1/.test(body), true);
    check('  and divides by the points possible', /Math\.round\(\(mcEarned \/ mcPoints\) \* 100\)/.test(body), true);
  }

  console.log('\n== the class assignment is made here, not by asking the portal ==\n');
  {
    const body = extract('saveAssignmentsToDatabase');
    check('assigning a class makes its gradebook entry directly', /ensureGradebookAssignment\(data, test\)/.test(body), true);
    check('  and no longer depends on the embedding page', /TEST_ASSIGNMENT_CREATED/.test(body), false);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
