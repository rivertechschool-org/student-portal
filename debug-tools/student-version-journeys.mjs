// A student's own version of a class assignment, walked end to end in a
// browser: the teacher adjusts one student's copy, that student sees theirs,
// a classmate still sees the class's, a parent sees their child's, and the
// teacher puts it back.
//
// Run:  python -m http.server 8780 &   then   node debug-tools/student-version-journeys.mjs
//
// Same approach as worship-journeys.mjs: the real portal page, with the
// Supabase client swapped for a stub that holds tables in memory and records
// writes. Who may read or write a version is RLS, in the backend repo; this
// checks the page's half - what each person is shown and what gets written.
//
// PLAYWRIGHT is looked up, not assumed: a normal install, then playwright-core,
// or set PLAYWRIGHT_MODULE to a path. STUDENT_VERSION_CHROME picks the browser.
let chromium;
{
  const CANDIDATES = [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core',
    '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const spec of CANDIDATES) {
    try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
  }
  if (!chromium) {
    console.error('Needs Playwright: npm i -g playwright && npx playwright install chromium\nTried: ' + CANDIDATES.join(', '));
    process.exit(2);
  }
}
const { existsSync, readdirSync } = await import('node:fs');
const pwCache = process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '/ms-playwright' : null;
const cached = pwCache && existsSync(pwCache)
  ? readdirSync(pwCache).filter(d => /^chromium-\d+$/.test(d)).map(d => `${pwCache}/${d}/chrome-win64/chrome.exe`)
  : [];
const executablePath = [process.env.STUDENT_VERSION_CHROME, '/opt/pw-browsers/chromium', ...cached,
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(p => existsSync(p));
const BASE = process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the world ---------------------------------------------------------
// Invented people. The class assignment is due a week ago, out of 20.
const WEEK_AGO = new Date(Date.now() - 7 * 86400000).toISOString();
const NEXT_WEEK = new Date(Date.now() + 7 * 86400000);
const SEED = () => ({
  assignments: [{ id: 'a1', class_id: 'c1', title: 'Fractions sheet', description: '<p>Do problems 1-20.</p>',
    due_date: WEEK_AGO, max_points: 20, is_published: true, assigned_to_all: true, assignment_type: 'homework',
    graded_offline: false, created_at: WEEK_AGO, grading_type: 'points' }],
  class_enrollments: [
    { id: 'e1', class_id: 'c1', student_id: 'p-ivy', status: 'active' },
    { id: 'e2', class_id: 'c1', student_id: 'p-oren', status: 'active' }],
  user_profiles: [
    { id: 'p-ivy', auth_user_id: 'u-ivy', first_name: 'Ivy', last_name: 'Marsh', email: 'ivy@example.test', grade_level: 6 },
    { id: 'p-oren', auth_user_id: 'u-oren', first_name: 'Oren', last_name: 'Pike', email: 'oren@example.test', grade_level: 6 }],
  assignment_submissions: [],
  assignment_students: [],
  assignment_student_versions: [],
  grade_categories: [],
  classes: [{ id: 'c1', name: 'Math 6' }],
});

async function boot(page, me) {
  await page.evaluate(({ seed, me }) => {
    window.__writes = [];
    const T = JSON.parse(JSON.stringify(seed));
    window.__T = T;
    const copy = x => JSON.parse(JSON.stringify(x));
    const build = (tb) => {
      const st = { eq: {}, in: [], single: false, isNotNull: [], op: 'select', row: null };
      const rows = () => {
        let r = (T[tb] || []).slice();
        Object.entries(st.eq).forEach(([c, v]) => { r = r.filter(x => x[c] === v); });
        st.in.forEach(([c, vs]) => { r = r.filter(x => vs.includes(x[c])); });
        st.isNotNull.forEach(c => { r = r.filter(x => x[c] != null); });
        return r;
      };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; },
        gte() { return api; }, lte() { return api; }, lt() { return api; }, or() { return api; },
        eq(c, v) { st.eq[c] = v; return api; },
        in(c, vs) { st.in.push([c, vs]); return api; },
        not(c, op, v) { if (op === 'is' && v === null) st.isNotNull.push(c); return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        upsert(row) {
          window.__writes.push({ op: 'upsert', table: tb, row: copy(row) });
          const list = (T[tb] = T[tb] || []);
          const i = list.findIndex(x => x.assignment_id === row.assignment_id && x.student_id === row.student_id);
          if (i >= 0) list[i] = { ...list[i], ...row }; else list.push({ id: 'v' + list.length, ...row });
          return Promise.resolve({ data: null, error: null });
        },
        delete() { st.op = 'delete'; return api; },
        then(res, rej) {
          if (st.op === 'delete') {
            window.__writes.push({ op: 'delete', table: tb, where: copy(st.eq) });
            const gone = new Set(rows());
            T[tb] = (T[tb] || []).filter(x => !gone.has(x));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          }
          const r = rows();
          return Promise.resolve({ data: copy(st.single ? (r[0] || null) : r), error: null }).then(res, rej);
        },
      };
      return api;
    };
    const app = window.app;
    app.auth.supabase = {
      from: build,
      rpc: (name, args) => { window.__writes.push({ op: 'rpc', name, args }); return Promise.resolve({ data: null, error: null }); },
    };
    app.supabaseQuery = (fn) => Promise.resolve(fn());
    app.auth.userProfile = { id: me.id, auth_user_id: me.auth, user_type: me.type, first_name: me.first };
    app.auth.currentUser = { id: me.auth };
    app.auth.studentRecordId = () => me.id;
    app.userInfo = { user: { id: me.auth }, profile: app.auth.userProfile };
    app.children = me.children || [];
    app.classes = [{ id: 'c1', name: 'Math 6' }];
    app.showLoading = () => {};
    document.querySelectorAll('[id^="modal-"]').forEach(m => m.remove());
    app.modalStack = [];
  }, { seed: me.seed, me });
}
const modalText = page => page.evaluate(() =>
  [...document.querySelectorAll('[id^="modal-"]')].map(m => m.textContent).join('\n'));

// ---- the journeys ------------------------------------------------------
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.app && typeof window.app.editStudentVersion === 'function', null, { timeout: 30000 });

const seed = SEED();
const TEACHER = { id: 'p-teach', auth: 'u-teach', type: 'teacher', first: 'Tess', seed };

console.log('\nTeacher adjusts one student');
await boot(page, TEACHER);
await page.evaluate(() => app.viewSubmissions('a1'));
await page.waitForTimeout(300);
let txt = await modalText(page);
ok('each student row offers "Adjust"', (txt.match(/Adjust/g) || []).length >= 2);
await page.evaluate(() => app.editStudentVersion('a1', 'p-ivy'));
await page.waitForSelector('#student-version-due');
await page.waitForTimeout(250);
txt = await modalText(page);
ok('the editor names the student', /Adjust for Ivy Marsh/.test(txt));
ok('and starts at the class points', await page.inputValue('#student-version-points') === '20');
const p2 = n => String(n).padStart(2, '0');
const nw = NEXT_WEEK;
const local = `${nw.getFullYear()}-${p2(nw.getMonth() + 1)}-${p2(nw.getDate())}T${p2(nw.getHours())}:${p2(nw.getMinutes())}`;
await page.fill('#student-version-due', local);
await page.fill('#student-version-points', '10');
await page.evaluate(() => { app.studentVersionEditor.root.innerHTML = '<p>Do problems 1-10.</p>'; });
await page.evaluate(() => app.saveStudentVersion(false));
await page.waitForTimeout(300);
let writes = await page.evaluate(() => window.__writes);
const up = writes.find(w => w.op === 'upsert');
ok('saving writes one version row', !!up);
check('  for Ivy on this assignment', up && [up.row.assignment_id, up.row.student_id], ['a1', 'p-ivy']);
check('  with her points', up?.row.points_possible, 10);
ok('  her due date', up?.row.due_date && Math.abs(new Date(up.row.due_date) - nw) < 60000);
ok('  and her instructions', /1-10/.test(up?.row.description || ''));
ok('her grade is recalculated', writes.some(w => w.op === 'rpc' && w.name === 'update_enrollment_grades'));
const savedVersions = await page.evaluate(() => window.__T.assignment_student_versions);
txt = await modalText(page);
ok('the roster marks Ivy as adjusted', /Adjusted for Ivy/.test(txt));
ok('and shows her total', /Out of 10/.test(txt));

console.log('\nUnchanged fields stay linked to the class');
await page.evaluate(() => app.editStudentVersion('a1', 'p-oren'));
await page.waitForSelector('#student-version-points');
await page.waitForTimeout(250);
await page.fill('#student-version-points', '15');
await page.evaluate(() => { window.__writes = []; return app.saveStudentVersion(false); });
await page.waitForTimeout(200);
writes = await page.evaluate(() => window.__writes);
const up2 = writes.find(w => w.op === 'upsert');
check('only the points are stored for Oren', up2 && [up2.row.description, up2.row.due_date, up2.row.points_possible], [null, null, 15]);
await page.evaluate(() => app.editStudentVersion('a1', 'p-oren'));
await page.waitForSelector('#student-version-points');
await page.waitForTimeout(250);
await page.fill('#student-version-points', '20');
await page.evaluate(() => { window.__writes = []; return app.saveStudentVersion(false); });
await page.waitForTimeout(200);
writes = await page.evaluate(() => window.__writes);
ok('setting everything back to the class removes his row', writes.some(w => w.op === 'delete' && w.where.student_id === 'p-oren') && !writes.some(w => w.op === 'upsert'));

console.log('\nIvy sees her version');
const seedWith = { ...SEED(), assignment_student_versions: savedVersions };
await boot(page, { id: 'p-ivy', auth: 'u-ivy', type: 'student', first: 'Ivy', seed: seedWith });
await page.evaluate(() => app.submitAssignment('a1'));
await page.waitForTimeout(300);
txt = await modalText(page);
ok('her instructions', /1-10/.test(txt) && !/1-20/.test(txt));
ok('her due date', txt.includes(nw.toLocaleDateString()));
ok('the "adjusted for you" tag', /Adjusted for you/.test(txt));
const ivyDue = await page.evaluate(async () => (await app.loadDueComingUp()).map(a => a.id));
check('it is in her "due soon", not missing', ivyDue, ['a1']);
const ivyMissing = await page.evaluate(async () => (await app.loadMissingAssignments()).map(a => a.id));
check('  and not in her missing list', ivyMissing, []);

console.log('\nOren still has the class version');
await boot(page, { id: 'p-oren', auth: 'u-oren', type: 'student', first: 'Oren', seed: seedWith });
await page.evaluate(() => app.submitAssignment('a1'));
await page.waitForTimeout(300);
txt = await modalText(page);
ok('the class instructions', /1-20/.test(txt));
ok('no "adjusted" tag', !/Adjusted for/.test(txt));
const orenMissing = await page.evaluate(async () => (await app.loadMissingAssignments()).map(a => a.id));
check('it is missing for him', orenMissing, ['a1']);

console.log('\nIvy\'s parent sees her version');
await boot(page, { id: 'p-par', auth: 'u-par', type: 'parent', first: 'Pat', seed: seedWith,
  children: [{ id: 'p-ivy', first_name: 'Ivy', last_name: 'Marsh', classes: [{ id: 'c1', name: 'Math 6' }] }] });
await page.evaluate(() => app.viewAssignmentAsParent('a1'));
await page.waitForTimeout(300);
txt = await modalText(page);
ok('her instructions and points', /1-10/.test(txt) && /\b10\b/.test(txt));
ok('says the teacher changed it for her', /changed this assignment for them/.test(txt));

console.log('\nTeacher puts Ivy back on the class version');
await boot(page, { ...TEACHER, seed: seedWith });
await page.evaluate(() => app.editStudentVersion('a1', 'p-ivy'));
await page.waitForSelector('#student-version-points');
await page.waitForTimeout(250);
txt = await modalText(page);
ok('the editor starts at her version', await page.inputValue('#student-version-points') === '10');
ok('and offers the class version back', /Use the class version/.test(txt));
await page.evaluate(() => { window.__writes = []; return app.saveStudentVersion(true); });
await page.waitForTimeout(200);
writes = await page.evaluate(() => window.__writes);
ok('her row is removed', writes.some(w => w.op === 'delete' && w.where.student_id === 'p-ivy'));

check('no page errors', pageErrors, []);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
