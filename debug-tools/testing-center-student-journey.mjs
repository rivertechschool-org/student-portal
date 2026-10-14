// Testing Center, as a student: the answer key stays on the server until the
// test is submitted.
//
// Run:  python -m http.server 8780 &   then   node debug-tools/testing-center-student-journey.mjs
//       (TC_JOURNEY_URL overrides the page URL, TC_JOURNEY_PW the Playwright
//        module, TC_JOURNEY_CHROME the browser)
//
// Drives the real page in Chromium against a stub database that records each
// call. What it holds:
//   * the student's tests come from rt_my_assigned_tests, and while the test
//     is being taken the page has no correct answer for any question
//   * Submit saves once (a double click does not make a second attempt) and
//     the score shown is the one the database returned
//   * the results screen marks the right answers from the key the database
//     sends back after submitting
//   * reopening "View Results" later fetches the key with rt_test_answer_key
//   * a test already submitted is reused, not submitted again

let chromium;
for (const spec of [process.env.TC_JOURNEY_PW, 'playwright', 'playwright-core'].filter(Boolean)) {
  try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
}
if (!chromium) {
  console.error('Needs Playwright: npm i -g playwright && npx playwright install chromium (or set TC_JOURNEY_PW).');
  process.exit(2);
}
const URL = process.env.TC_JOURNEY_URL || 'http://localhost:8780/extensions/testing-center.html';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

const browser = await chromium.launch(process.env.TC_JOURNEY_CHROME ? { executablePath: process.env.TC_JOURNEY_CHROME } : {});
const top = await browser.newPage();
const errors = [];
top.on('pageerror', e => errors.push(e.message));
await top.route(/supabase\.co/, r => r.abort());
// The Testing Center only runs inside the portal's frame; opened on its own
// it replaces itself with "Authentication Required". So it is framed here,
// and the journey drives the frame.
await top.setContent(`<iframe id="tc" src="${URL}" style="width:1100px;height:900px"></iframe>`);
let page = null;
for (let i = 0; i < 100 && !page; i++) {
  page = top.frames().find(f => f.url().includes('testing-center')) || null;
  if (!page) await top.waitForTimeout(100);
}
await page.waitForFunction(() => typeof submitTest === 'function' && typeof loadTests === 'function');

// An invented test: two multiple-choice questions (answers B and C, worth 1
// and 3) and nothing else. The server's key is only in the stub.
async function boot(existingSubmission = null) {
  await page.evaluate((existing) => {
    const KEY = { q1: 1, q2: 2 };
    window.__calls = [];
    window.__inserted = 0;
    const TEST = {
      id: 'test-1', title: 'Fractions quiz', subject: 'Math', description: '', time_limit_minutes: null,
      status: 'active', created_at: '2026-10-01T00:00:00Z',
      test_questions: [
        { id: 'q1', question_order: 1, question_type: 'multiple_choice', question_text: 'Half of 4?', options: ['1', '2'], max_points: 1 },
        { id: 'q2', question_order: 2, question_type: 'multiple_choice', question_text: 'Third of 9?', options: ['1', '2', '3'], max_points: 3 },
      ],
      test_assignments: [{ id: 'ta-1', test_id: 'test-1', class_id: 'c-1', student_id: null, is_active: true }],
    };
    const subs = existing ? [existing] : [];
    const slow = () => new Promise(r => setTimeout(r, 120));
    const q = (table) => {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; }, in() { return api; },
        limit() { return api; }, not() { return api; }, maybeSingle() { return api; }, single() { return api; },
        insert(row) {
          window.__calls.push('insert:' + table);
          if (table === 'test_submissions') window.__inserted++;
          const rec = { ...row, id: 'sub-' + window.__inserted };
          if (table === 'test_submissions') subs.push(rec);
          return { select: () => ({ single: () => slow().then(() => ({ data: rec, error: null })) }) };
        },
        update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
        then(r) {
          const data = table === 'test_submissions' ? subs.slice() : table === 'test_assignments' ? [{ id: 'ta-1' }] : [];
          return slow().then(() => ({ data, error: null })).then(r);
        },
      };
      return api;
    };
    supabaseClient = {
      from: q,
      rpc(name, args) {
        window.__calls.push('rpc:' + name);
        if (name === 'rt_my_assigned_tests') return Promise.resolve({ data: [JSON.parse(JSON.stringify(TEST))], error: null });
        if (name === 'rt_submit_test_scored') {
          const s = subs.find(x => x.id === args.p_test_submission_id);
          const a = s.answers || {};
          const earned = (a.q1 === KEY.q1 ? 1 : 0) + (a.q2 === KEY.q2 ? 3 : 0);
          return slow().then(() => ({ data: { success: true, status: 'graded', score: Math.round(earned / 4 * 100), answer_key: KEY }, error: null }));
        }
        if (name === 'rt_test_answer_key') return Promise.resolve({ data: KEY, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    authReady = true;
    currentRole = 'student';
    currentUser = { id: 'stu-1', userType: 'student', firstName: 'Robin', lastName: 'Example', email: '' };
    currentStudentId = 'stu-1';
    submissionsDatabase = {};
  }, existingSubmission);
  await page.evaluate(() => loadTests());
}

console.log('\n== taking the test ==\n');
await boot();
check('the tests come from the database\'s list', await page.evaluate(() => window.__calls[0]), 'rpc:rt_my_assigned_tests');
check('while taking it, the page has no correct answers',
  await page.evaluate(() => testsDatabase[0].questions.map(q => q.correctAnswer)), [null, null]);
await page.evaluate(() => { startTest('test-1'); selectAnswer('q1', 1); selectAnswer('q2', 0); });

console.log('\n== submitting (twice, quickly) ==\n');
await page.evaluate(() => Promise.all([submitTest(), submitTest()]));
check('a double click saves one attempt', await page.evaluate(() => window.__inserted), 1);
check('  and asks the database for the score once', await page.evaluate(() => window.__calls.filter(c => c === 'rpc:rt_submit_test_scored').length), 1);
check('the score shown is the database\'s (1 of 4 points = 25%)', await page.textContent('#finalScore'), '25%');
const results = await page.textContent('#resultsDetails');
ok('the results mark the right answers from the returned key',
  (results.match(/✓ Correct/g) || []).length === 2 && /✗ Your answer/.test(results));
ok('  and the subtitle counts 1 of 2 right', /You answered 1 out of 2/.test(await page.textContent('#resultsSubtitle')));

console.log('\n== coming back to View Results ==\n');
await boot({ id: 'sub-9', test_id: 'test-1', student_id: 'stu-1', answers: { q1: 1, q2: 2 }, status: 'graded', attempt_number: 1 });
await page.evaluate(() => {
  submissionsDatabase['test-1_stu-1'] = { id: 'sub-9', testId: 'test-1', studentId: 'stu-1', answers: { q1: 1, q2: 2 },
    finalScore: 100, gradedAnswers: {}, status: 'graded' };
});
check('a fresh load still has no key', await page.evaluate(() => testsDatabase[0].questions.map(q => q.correctAnswer)), [null, null]);
await page.evaluate(() => viewStudentResults('test-1'));
ok('View Results fetches the key', await page.evaluate(() => window.__calls.includes('rpc:rt_test_answer_key')));
ok('  and marks both answers right', ((await page.textContent('#resultsDetails')).match(/✓ Correct/g) || []).length === 2);

console.log('\n== an attempt already saved is reused ==\n');
await page.evaluate(() => { startTest('test-1'); selectAnswer('q1', 0); });
await page.evaluate(() => submitTest());
check('no second attempt is made', await page.evaluate(() => window.__inserted), 0);
check('  the saved one is scored instead', await page.evaluate(() => window.__calls.filter(c => c === 'rpc:rt_submit_test_scored').length), 1);
check('the Submit button is usable again for the next test',
  await page.evaluate(() => { startTest('test-1'); return document.getElementById('submitBtn').disabled; }), false);

check('no page errors', errors, []);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
