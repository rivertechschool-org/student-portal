// Grading journeys: the letter follows the points, and category rubrics.
//
// Run:  python -m http.server 8780 &   then   node debug-tools/grading-rubric-journeys.mjs
//       (GRADING_JOURNEYS_URL overrides http://localhost:8780/portal/index.html,
//        GRADING_JOURNEYS_CHROME points at a browser you already have)
//
// Walks the real page in Chromium against a dumb in-page database stub that
// returns rows and records writes. What it holds:
//
//   POINTS GRADING
//   * typing 9 of 10 fills in A-; the teacher's own letter survives later
//     changes to the points; "Use <letter>" hands it back to the points
//   * the missing/in-class modal's dropdown has every letter the scale gives
//   * half points save (the column used to be an integer)
//   * the Gradebook grid writes the letter with the points
//
//   CATEGORY RUBRICS
//   * Create Rubric starts on categories, four levels worth 4..1; a new
//     category copies the previous one's levels; six of them is "out of 24"
//   * picking a level in each category adds up and scales to the assignment:
//     18 of 24 on a 10-point assignment is 7.5 points, C
//   * points and letter can both be overridden, and the save says so
//   * the picks are saved and regrading opens on them
//   * a part-picked rubric is refused, not saved as a low grade
//   * editing a category rubric opens on its categories and saves them
//
// The stub knows nothing about RLS. Anything about who may write what is
// checked against the live database, not here.

let chromium;
{
  const CANDIDATES = [
    'playwright', 'playwright-core',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/opt/node22/lib/node_modules/playwright-core/index.mjs',
  ];
  for (const spec of CANDIDATES) {
    try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
  }
  if (!chromium && process.env.GRADING_JOURNEYS_PW) {
    ({ chromium } = await import(process.env.GRADING_JOURNEYS_PW));
  }
  if (!chromium) {
    console.error('grading-rubric-journeys needs Playwright:\n  npm i -g playwright && npx playwright install chromium\n'
      + 'or set GRADING_JOURNEYS_PW to its index.mjs.');
    process.exit(2);
  }
}

const URL = process.env.GRADING_JOURNEYS_URL || 'http://localhost:8780/portal/index.html';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the world (invented) ----------------------------------------------
const LEVELS = [{ label: 'Exceeds', points: 4 }, { label: 'Meets', points: 3 },
                { label: 'Approaching', points: 2 }, { label: 'Beginning', points: 1 }];
const SIX = ['Thesis', 'Evidence', 'Organization', 'Voice', 'Grammar', 'Citations']
  .map(name => ({ name, levels: LEVELS }));

const SEED = () => ({
  user_profiles: [{ id: 'stu-1', first_name: 'Robin', last_name: 'Example', email: 'robin@example.test' }],
  rubrics: [
    { id: 'rub-cat', name: 'Essay', description: 'Six categories', is_default: false, created_by: 't-1',
      created_at: '2026-10-01T00:00:00Z', categories: SIX },
  ],
  rubric_criteria: [],
  assignments: [
    { id: 'a-pts', title: 'Quiz 3', max_points: 10, grading_type: 'points', rubric_id: null, graded_offline: false },
    { id: 'a-rub', title: 'Essay 1', max_points: 10, grading_type: 'rubric', rubric_id: 'rub-cat', graded_offline: false },
  ],
  assignment_submissions: [
    { id: 'sub-pts', assignment_id: 'a-pts', student_id: 'stu-1', content: 'my answers', status: 'submitted',
      submitted_at: '2026-10-10T16:00:00Z', grade: null, points_earned: null, feedback: null },
    { id: 'sub-rub', assignment_id: 'a-rub', student_id: 'stu-1', content: 'my essay', status: 'submitted',
      submitted_at: '2026-10-10T16:00:00Z', grade: null, points_earned: null, feedback: null, rubric_scores: null },
  ],
});

async function boot(page) {
  await page.evaluate((seed) => {
    window.__writes = [];
    const T = JSON.parse(JSON.stringify(seed));
    window.__T = T;
    let n = 0;
    const copy = (x) => JSON.parse(JSON.stringify(x));
    const build = (tb) => {
      const st = { eq: {}, single: false };
      const rows = () => {
        let r = (T[tb] || []).slice();
        Object.entries(st.eq).forEach(([c, v]) => { r = r.filter(x => x[c] === v); });
        if (tb === 'assignment_submissions') {
          r = r.map(x => ({ ...x, assignments: (T.assignments || []).find(a => a.id === x.assignment_id) }));
        }
        return r;
      };
      const api = {
        select() { return api; }, or() { return api; }, in() { return api; },
        order() { return api; }, limit() { return api; },
        eq(c, v) { st.eq[c] = v; return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        insert(row) {
          const list = [].concat(row).map(r => ({ ...r, id: `${tb}-${++n}` }));
          window.__writes.push({ op: 'insert', table: tb, row: copy(row) });
          (T[tb] = T[tb] || []).push(...copy(list));
          const res = { data: copy(Array.isArray(row) ? list : list[0]), error: null };
          return { select: () => ({ single: () => Promise.resolve(res) }), then: (r) => Promise.resolve(res).then(r) };
        },
        upsert(row) {
          window.__writes.push({ op: 'upsert', table: tb, row: copy(row) });
          return { select: () => Promise.resolve({ data: [copy(row)], error: null }),
                   then: (r) => Promise.resolve({ data: null, error: null }).then(r) };
        },
        update(row) {
          return { eq: (c, v) => {
            window.__writes.push({ op: 'update', table: tb, where: { [c]: v }, row: copy(row) });
            (T[tb] || []).forEach(x => { if (x[c] === v) Object.assign(x, copy(row)); });
            return Promise.resolve({ data: null, error: null });
          } };
        },
        delete() {
          return { eq: (c, v) => {
            window.__writes.push({ op: 'delete', table: tb, where: { [c]: v } });
            T[tb] = (T[tb] || []).filter(x => x[c] !== v);
            return Promise.resolve({ data: null, error: null });
          } };
        },
        then(r) {
          const out = rows();
          return Promise.resolve({ data: copy(st.single ? (out[0] || null) : out), error: null }).then(r);
        },
      };
      return api;
    };
    app.auth = app.auth || {};
    app.auth.supabase = { from: build, rpc: () => Promise.resolve({ data: null, error: null }) };
    app.userInfo = { user: { id: 't-1' }, profile: { id: 't-1', user_type: 'teacher' } };
    // Not under test: the per-student version lookup, notifications, and the
    // list each save reopens.
    app.withVersionFor = async (a) => a;
    app.sendGradeNotifications = async () => {};
    app.viewSubmissions = () => {};
    app.__notes = [];
    const note = app.showNotification.bind(app);
    app.showNotification = (m, k) => { app.__notes.push(`${k}:${m}`); try { note(m, k); } catch (_) {} };
    document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
    app.modalStack = [];
  }, SEED());
}

const val = (page, sel) => page.$eval(sel, el => el.value);
const txt = (page, sel) => page.$eval(sel, el => el.textContent.replace(/\s+/g, ' ').trim());
const writes = (page) => page.evaluate(() => window.__writes);
const notes = (page) => page.evaluate(() => app.__notes);
const type = async (page, sel, v) => { await page.fill(sel, ''); await page.type(sel, String(v)); };

const browser = await chromium.launch(process.env.GRADING_JOURNEYS_CHROME
  ? { executablePath: process.env.GRADING_JOURNEYS_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/supabase\.co/, r => r.abort());
await page.goto(URL);
await page.waitForFunction(() => window.app && typeof app.gradeSubmission === 'function', null, { timeout: 30000 });

// ---------------------------------------------------------------------------
console.log('\n== points: the letter follows the points ==\n');
await boot(page);
await page.evaluate(() => app.gradeSubmission('sub-pts', 'a-pts'));
await page.waitForSelector('#points-earned');
check('an ungraded submission opens with no letter', await val(page, '#letter-grade'), '');
await type(page, '#points-earned', 9);
check('9 of 10 fills in A-', await val(page, '#letter-grade'), 'A-');
ok('  and says it was worked out', /Worked out from the points: 90%/.test(await txt(page, '#letter-grade-auto-hint')));
await type(page, '#letter-grade', 'B+');
ok('typing B+ makes it the teacher\'s', /Your choice\. The points work out to A-/.test(await txt(page, '#letter-grade-auto-hint')));
await type(page, '#points-earned', 7);
check('  and it survives a change to the points', await val(page, '#letter-grade'), 'B+');
ok('  while the hint follows them', /work out to C-/.test(await txt(page, '#letter-grade-auto-hint')));
await page.click('#letter-grade-auto-hint button');
check('"Use C-" hands it back to the points', await val(page, '#letter-grade'), 'C-');
await type(page, '#points-earned', 8.5);
check('  which now follow again (8.5 -> B)', await val(page, '#letter-grade'), 'B');
await page.click('#modal-grade-submission button[type="submit"]');
await page.waitForTimeout(150);
const ptsSave = (await writes(page)).find(w => w.op === 'update' && w.table === 'assignment_submissions');
check('the save writes 8.5 and B', ptsSave && [ptsSave.row.points_earned, ptsSave.row.grade], [8.5, 'B']);

console.log('\n== points: reopening a graded one ==\n');
await page.evaluate(() => app.gradeSubmission('sub-pts', 'a-pts'));
await page.waitForSelector('#points-earned');
check('opens on the saved points', await val(page, '#points-earned'), '8.5');
ok('  and the letter is still the points\' one', /Worked out/.test(await txt(page, '#letter-grade-auto-hint')));
await page.evaluate(() => { const s = window.__T.assignment_submissions.find(x => x.id === 'sub-pts'); s.grade = 'A'; });
await page.evaluate(() => app.gradeSubmission('sub-pts', 'a-pts'));
await page.waitForSelector('#points-earned');
check('a saved letter the points would not give stays put', await val(page, '#letter-grade'), 'A');
ok('  shown as the teacher\'s choice', /Your choice/.test(await txt(page, '#letter-grade-auto-hint')));

console.log('\n== points: missing / in-class modal ==\n');
await boot(page);
await page.evaluate(() => app.gradeNonSubmitted('stu-1', 'a-pts'));
await page.waitForSelector('#grade-score');
const opts = await page.$$eval('#grade-letter option', os => os.map(o => o.value).filter(Boolean));
ok('the dropdown has every letter the scale gives', ['D-', 'D', 'D+', 'A+', 'F'].every(l => opts.includes(l)));
check('0 points opens on F', await val(page, '#grade-letter'), 'F');
await type(page, '#grade-score', 6.7);
check('6.7 of 10 picks D+', await val(page, '#grade-letter'), 'D+');
await page.selectOption('#grade-letter', 'C');
await type(page, '#grade-score', 9);
check('a letter the teacher picked survives', await val(page, '#grade-letter'), 'C');
await page.evaluate(() => app.submitGradeNonSubmitted('stu-1', 'a-pts', false));
await page.waitForTimeout(150);
const nsSave = (await writes(page)).find(w => w.op === 'insert' && w.table === 'assignment_submissions');
check('the save writes 9 and C', nsSave && [nsSave.row.points_earned, nsSave.row.grade], [9, 'C']);

console.log('\n== points: the Gradebook grid ==\n');
await boot(page);
const gb = await page.evaluate(async () => {
  const input = document.createElement('input');
  input.dataset.maxPoints = '20';
  gradebook.submissions = {};
  gradebook.pendingChanges = {};
  gradebook.showGradebook = async () => {};
  gradebook.currentClassId = 'c-1';
  gradebook.updateChangesIndicator = () => {};
  gradebook.handleCellEdit('stu-1', 'a-pts', '17', input);
  await gradebook.saveGradebook();
  return window.__writes.find(w => w.op === 'upsert')?.row;
});
check('17 of 20 saves with B', gb && [gb.points_earned, gb.grade], [17, 'B']);

// ---------------------------------------------------------------------------
console.log('\n== building a category rubric ==\n');
await boot(page);
await page.evaluate(() => app.showCreateRubricForm());
await page.waitForSelector('#categories-container .rcat-field');
check('a new rubric starts on categories', await page.$eval('input[name="rubric-kind"]:checked', r => r.value), 'categories');
check('  with one category of four levels, 4 down to 1',
  await page.$$eval('.rcat-level-points', ps => ps.map(p => p.value)), ['4', '3', '2', '1']);
ok('  and says it is out of 4', /Out of 4 points \(1 category\)/.test(await txt(page, '#rubric-builder-total')));
ok('the hidden letter levels do not block the form',
  await page.$$eval('#levels-card input[required]', is => is.every(i => i.disabled)));
for (let i = 0; i < 5; i++) await page.click('#categories-card button:has-text("Add Category")');
ok('six categories copying the first is out of 24', /Out of 24 points \(6 categories\)/.test(await txt(page, '#rubric-builder-total')));
await page.fill('#rubric-name', 'Lab report');
await page.click('#create-rubric-form button[type="submit"]');
await page.waitForTimeout(150);
check('a category with no name is refused', (await writes(page)).filter(w => w.table === 'rubrics').length, 0);
// The browser's own required-field check stops it before the save runs.
ok('  the browser points at the empty name', await page.$eval('.rcat-name', n => n.validity.valueMissing));
const names = ['Question', 'Method', 'Data', 'Analysis', 'Conclusion', 'Presentation'];
const nameInputs = await page.$$('.rcat-name');
for (let i = 0; i < 6; i++) await nameInputs[i].fill(names[i]);
// One category on a 5-point scale: the total follows its top level.
await page.$$eval('.rcat-field', fs => { const p = fs[5].querySelector('.rcat-level-points'); p.value = '5'; p.dispatchEvent(new Event('input')); });
ok('raising one top level to 5 makes it out of 25', /Out of 25 points/.test(await txt(page, '#rubric-builder-total')));
await page.click('#create-rubric-form button[type="submit"]');
await page.waitForTimeout(200);
const made = (await writes(page)).find(w => w.op === 'insert' && w.table === 'rubrics');
check('it saves six categories on the rubric', made?.row?.categories?.map(c => c.name), names);
check('  each with its levels and points', made?.row?.categories?.[0]?.levels, LEVELS);
check('  and writes no letter-level rows', (await writes(page)).filter(w => w.table === 'rubric_criteria').length, 0);

console.log('\n== grading with it ==\n');
await boot(page);
await page.evaluate(() => app.gradeSubmission('sub-rub', 'a-rub'));
await page.waitForSelector('#category-rubric');
check('one row of levels per category', await page.$$eval('.crub-cat', cs => cs.length), 6);
ok('nothing picked: points wait for every category', /Fills in once every category is picked/.test(await txt(page, '#crub-points-hint')));
const pick = async (labels) => {
  for (let i = 0; i < labels.length; i++) {
    await page.click(`.crub-cat:nth-of-type(${i + 1}) .crub-level:has-text("${labels[i]}")`);
  }
};
await pick(['Exceeds', 'Exceeds', 'Meets', 'Meets', 'Approaching']);
ok('five of six picked says one is left', /16 \/ 24.*1 category still to pick/.test(await txt(page, '#crub-total')));
check('  and fills no points yet', await val(page, '#crub-points'), '');
await page.click('#modal-grade-submission button[type="submit"]');
await page.waitForTimeout(150);
check('saving part-picked is refused', (await writes(page)).filter(w => w.op === 'update').length, 0);
ok('  saying how many are left', (await notes(page)).some(m => /Pick a level in every category \(1 left\)/.test(m)));
await pick(['Exceeds', 'Exceeds', 'Meets', 'Meets', 'Approaching', 'Approaching']);
ok('18 of 24 is 75%', /18 \/ 24 \(75%\)/.test(await txt(page, '#crub-total')));
check('  scaled to the 10-point assignment: 7.5', await val(page, '#crub-points'), '7.5');
check('  which is a C', await val(page, '#crub-letter'), 'C');
await type(page, '#crub-letter', 'B-');
ok('the letter can be overridden', /Your choice\. The points work out to C/.test(await txt(page, '#crub-letter-auto-hint')));
await page.click('#modal-grade-submission button[type="submit"]');
await page.waitForTimeout(200);
const rubSave = (await writes(page)).find(w => w.op === 'update' && w.table === 'assignment_submissions');
check('the save writes 7.5, B- and marks it overridden',
  rubSave && [rubSave.row.points_earned, rubSave.row.grade, rubSave.row.grade_override], [7.5, 'B-', true]);
check('  with every pick', rubSave?.row?.rubric_scores?.map(s => `${s.category}:${s.level}:${s.points}/${s.max}`),
  ['Thesis:Exceeds:4/4', 'Evidence:Exceeds:4/4', 'Organization:Meets:3/4', 'Voice:Meets:3/4',
   'Grammar:Approaching:2/4', 'Citations:Approaching:2/4']);

console.log('\n== regrading opens on the picks ==\n');
await page.evaluate(() => app.gradeSubmission('sub-rub', 'a-rub'));
await page.waitForSelector('#category-rubric');
check('all six picks are back', await page.$$eval('.crub-level input:checked', is => is.map(i => i.dataset.label)),
  ['Exceeds', 'Exceeds', 'Meets', 'Meets', 'Approaching', 'Approaching']);
check('  the points are the rubric\'s', await val(page, '#crub-points'), '7.5');
check('  the overridden letter is kept', await val(page, '#crub-letter'), 'B-');
await page.click('.crub-cat:nth-of-type(6) .crub-level:has-text("Exceeds")');
check('a new pick moves the points (20/24 -> 8.33)', await val(page, '#crub-points'), '8.33');
check('  and the kept letter stays the teacher\'s', await val(page, '#crub-letter'), 'B-');
await type(page, '#crub-points', 9);
ok('the points can be overridden too', /Your number\. The rubric works out to 8\.33/.test(await txt(page, '#crub-points-hint')));
await page.click('#crub-points-hint button');
check('  and handed back', await val(page, '#crub-points'), '8.33');

console.log('\n== missing / in-class, with a category rubric ==\n');
await boot(page);
await page.evaluate(() => app.gradeNonSubmitted('stu-1', 'a-rub'));
await page.waitForSelector('#category-rubric');
await pick(['Meets', 'Meets', 'Meets', 'Meets', 'Meets', 'Meets']);
check('all Meets is 18/24 -> 7.5, C', [await val(page, '#crub-points'), await val(page, '#crub-letter')], ['7.5', 'C']);
await page.evaluate(() => app.submitGradeNonSubmitted('stu-1', 'a-rub', true));
await page.waitForTimeout(150);
const nsRub = (await writes(page)).find(w => w.op === 'insert' && w.table === 'assignment_submissions');
check('it saves the grade, not overridden', nsRub && [nsRub.row.points_earned, nsRub.row.grade, nsRub.row.grade_override], [7.5, 'C', false]);
check('  with the six picks', nsRub?.row?.rubric_scores?.length, 6);

console.log('\n== editing and viewing ==\n');
await boot(page);
await page.evaluate(() => app.editRubric('rub-cat'));
await page.waitForSelector('#categories-container .rcat-field');
check('edit opens on the rubric\'s categories', await page.$$eval('.rcat-name', ns => ns.map(n => n.value)), SIX.map(c => c.name));
await page.$eval('.rcat-name', n => { n.value = 'Claim'; });
await page.click('#edit-rubric-form button[type="submit"]');
await page.waitForTimeout(150);
const ed = (await writes(page)).find(w => w.op === 'update' && w.table === 'rubrics');
check('saving writes the categories back', ed?.row?.categories?.[0]?.name, 'Claim');
check('  and does not touch letter-level rows', (await writes(page)).filter(w => w.table === 'rubric_criteria').length, 0);

await boot(page);
await page.evaluate(() => app.viewAssignmentRubric('rub-cat', 10));
await page.waitForSelector('#modal-view-rubric');
const view = await txt(page, '#modal-view-rubric');
ok('a student sees the categories and what each level is worth',
  /6 categories, out of 24 rubric points \(scaled to the assignment's 10\)/.test(view) && /Thesis/.test(view) && /Exceeds\s*4/.test(view));

await boot(page);
await page.evaluate(() => app.manageRubrics());
await page.waitForSelector('#modal-manage-rubrics');
ok('Manage Rubrics says what kind it is', /6 categories, out of 24 points/.test(await txt(page, '#modal-manage-rubrics')));

check('no page errors', errors, []);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
