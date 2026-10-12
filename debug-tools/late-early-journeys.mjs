// Planned late arrivals and early pickups, walked end to end in a browser:
// Riven takes "Ivy is being picked up at 1:45 tomorrow for the dentist" and
// "Ivy is arriving late at 9:05 tomorrow", the registers of the classes those
// times touch flag her, the ones they don't stay quiet, and the office panel
// lists and removes them.
//
// Run:  python -m http.server 8780 &   then   node debug-tools/late-early-journeys.mjs
//
// The real portal page with Supabase swapped for an in-memory stub (the
// worship-journeys.mjs approach). Who may read or write a plan is RLS, in the
// backend repo; this checks what the page writes and what each screen shows.
// PLAYWRIGHT_MODULE / LATE_EARLY_CHROME override how Playwright and the
// browser are found.
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
const executablePath = [process.env.LATE_EARLY_CHROME, '/opt/pw-browsers/chromium', ...cached,
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(p => existsSync(p));
const BASE = process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the world: tomorrow's timetable for Ivy ---------------------------
const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TOMORROW = new Date(); TOMORROW.setDate(TOMORROW.getDate() + 1);
const DATE = ds(TOMORROW), DOW = TOMORROW.getDay();
const IVY = { id: 'p-ivy', first_name: 'Ivy', last_name: 'Marsh', full_name: 'Ivy Marsh', grade_level: 6 };
const SEED = {
  user_profiles: [{ id: 'p-ivy', first_name: 'Ivy', last_name: 'Marsh', grade_level: 6, user_type: 'student' }],
  class_enrollments: [
    { id: 'e1', class_id: 'c-maths', student_id: 'p-ivy', status: 'active' },
    { id: 'e2', class_id: 'c-sci', student_id: 'p-ivy', status: 'active' },
    { id: 'e3', class_id: 'c-study', student_id: 'p-ivy', status: 'active' }],
  class_schedule: [
    { class_id: 'c-maths', day_of_week: DOW, period: 1 },
    { class_id: 'c-sci', day_of_week: DOW, period: 7 },
    { class_id: 'c-study', day_of_week: DOW, period: 8 }],
  student_schedule: [{ student_id: 'p-ivy', day_of_week: DOW }],
  schedule_blocks: [
    { block_key: 'p1', label: 'Period 1', period: 1, day_of_week: null, starts_at: '08:45:00', ends_at: '09:35:00', omitted: false, sort_order: 1 },
    { block_key: 'p2', label: 'Period 2', period: 2, day_of_week: null, starts_at: '09:35:00', ends_at: '10:25:00', omitted: false, sort_order: 2 },
    { block_key: 'p7', label: 'Period 7', period: 7, day_of_week: null, starts_at: '13:40:00', ends_at: '14:20:00', omitted: false, sort_order: 7 },
    { block_key: 'p8', label: 'End of Day', period: 8, day_of_week: null, starts_at: '14:20:00', ends_at: '14:45:00', omitted: false, sort_order: 8 }],
  class_attendance_sessions: [], class_attendance: [], planned_late_early: [],
};

async function boot(page) {
  await page.evaluate(({ seed }) => {
    window.__writes = []; window.__said = [];
    const T = JSON.parse(JSON.stringify(seed));
    window.__T = T;
    const copy = x => JSON.parse(JSON.stringify(x));
    let n = 0;
    const build = (tb) => {
      const st = { eq: {}, in: [], is: [], gte: [], single: false, op: 'select', row: null };
      const rows = () => {
        let r = (T[tb] || []).slice();
        Object.entries(st.eq).forEach(([c, v]) => { r = r.filter(x => x[c] === v); });
        st.in.forEach(([c, vs]) => { r = r.filter(x => vs.includes(x[c])); });
        st.is.forEach(([c, v]) => { r = r.filter(x => (x[c] ?? null) === v); });
        st.gte.forEach(([c, v]) => { r = r.filter(x => x[c] >= v); });
        return r;
      };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; }, or() { return api; },
        neq() { return api; }, lte() { return api; }, lt() { return api; }, not() { return api; },
        eq(c, v) { st.eq[c] = v; return api; },
        in(c, vs) { st.in.push([c, vs]); return api; },
        is(c, v) { st.is.push([c, v]); return api; },
        gte(c, v) { st.gte.push([c, v]); return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        upsert(row) {
          window.__writes.push({ op: 'upsert', table: tb, row: copy(row) });
          const list = (T[tb] = T[tb] || []);
          const i = list.findIndex(x => x.student_id === row.student_id && x.date === row.date && x.kind === row.kind);
          let saved;
          if (i >= 0) { list[i] = { ...list[i], ...row }; saved = list[i]; }
          // Column defaults as the schema declares them (source defaults to
          // 'staff'), or the stub is stricter than Postgres.
          else { saved = { id: 'le' + (++n), source: 'staff', ...row }; list.push(saved); }
          const res = { data: { id: saved.id }, error: null };
          const p = Promise.resolve(res);
          return { select: () => ({ single: () => p }), then: (a, b) => p.then(a, b) };
        },
        delete() { st.op = 'delete'; return api; },
        update(row) { st.op = 'update'; st.row = row; return api; },
        then(res, rej) {
          if (st.op === 'delete') {
            window.__writes.push({ op: 'delete', table: tb, where: copy(st.eq) });
            const gone = new Set(rows());
            T[tb] = (T[tb] || []).filter(x => !gone.has(x));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          }
          if (st.op === 'update') {
            window.__writes.push({ op: 'update', table: tb, row: copy(st.row), where: copy(st.eq) });
            rows().forEach(x => Object.assign(x, st.row));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          }
          const r = rows();
          return Promise.resolve({ data: copy(st.single ? (r[0] || null) : r), error: null }).then(res, rej);
        },
      };
      return api;
    };
    const app = window.app;
    // rt_submit_late_early as the database runs it: record (replacing the same
    // day and kind), mark who it came from, report how many staff were told.
    const rpc = (name, args) => {
      if (name !== 'rt_submit_late_early') return Promise.resolve({ data: [], error: null });
      window.__writes.push({ op: 'rpc', name, args: copy(args) });
      const me = app.userInfo.profile;
      const source = me.user_type === 'parent' ? 'parent' : 'staff';
      const list = (T.planned_late_early = T.planned_late_early || []);
      const i = list.findIndex(x => x.student_id === args.p_student_id && x.date === args.p_date && x.kind === args.p_kind);
      const row = { student_id: args.p_student_id, date: args.p_date, kind: args.p_kind, at_time: args.p_time,
                    reason: args.p_reason, source, created_by: app.userInfo.user.id };
      if (i >= 0) list[i] = { ...list[i], ...row }; else list.push({ id: 'le' + (++n), ...row });
      return Promise.resolve({ data: { student: 'Ivy Marsh', when: args.p_time, notified: source === 'parent' ? 3 : 0 }, error: null });
    };
    app.auth.supabase = { from: build, rpc };
    app.supabaseQuery = (fn) => Promise.resolve(fn());
    app.userInfo = { user: { id: 'u-office' }, profile: { id: 'p-office', user_type: 'admin', first_name: 'Ola' } };
    app.auth.userProfile = app.userInfo.profile;
    app.classes = [{ id: 'c-maths', name: 'Maths' }, { id: 'c-sci', name: 'Science' }, { id: 'c-study', name: 'Study Hall' }];
    app._terminalAllClasses = app.classes;
    app._bellRows = null; app._bellDefaults = null;
    app._rivenAutoConfirm = true;
    app._showRivenMessage = (h) => window.__said.push(h);
    app._naturalSuccess = (m) => window.__said.push(Array.isArray(m) ? m[0] : m);
    app.terminalPrintError = (m) => window.__said.push('ERROR ' + m);
    app.showLoading = () => {};
    document.querySelectorAll('[id^="modal-"]').forEach(m => m.remove());
    app.modalStack = [];
  }, { seed: SEED });
}
const modalText = page => page.evaluate(() =>
  [...document.querySelectorAll('[id^="modal-"]')].map(m => m.textContent).join('\n'));
const say = (page, text) => page.evaluate(async ({ text, ivy }) => {
  await app.terminalPlanLateEarly({ student: { student: ivy }, _rawInput: text, original: text });
  await app._rivenAutoPending;
  return window.__said.join('\n');
}, { text, ivy: IVY });
const register = async (page, classId, period) => {
  await page.evaluate(() => document.querySelectorAll('[id^="modal-"]').forEach(m => m.remove()));
  await page.evaluate(({ classId, date, period }) => app.showClassAttendance(classId, date, period),
    { classId, date: DATE, period });
  await page.waitForTimeout(250);
  return modalText(page);
};

// ---- the journeys ------------------------------------------------------
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.app && typeof window.app.terminalPlanLateEarly === 'function', null, { timeout: 30000 });
await boot(page);

console.log('\nRiven: "Ivy is being picked up at 1:45 tomorrow for the dentist"');
let said = await say(page, 'Ivy is being picked up at 1:45 tomorrow for the dentist');
let writes = await page.evaluate(() => window.__writes);
const up = writes.find(w => w.op === 'upsert');
check('one plan is written', up && [up.table, up.row.student_id, up.row.kind, up.row.at_time, up.row.date],
  ['planned_late_early', 'p-ivy', 'early', '13:45', DATE]);
check('  with the reason', up?.row.reason, 'dentist');
ok('the confirmation names the class she leaves during', /leaves during Science \(P7\)/.test(said));
ok('  and the one she misses', /misses Study Hall \(P8\)/.test(said));
ok('  and says nothing is marked', /Nothing is marked/.test(said));

console.log('\nRiven: "Ivy is arriving late at 9:05 tomorrow"');
await page.evaluate(() => { window.__writes = []; window.__said = []; });
said = await say(page, 'Ivy is arriving late at 9:05 tomorrow');
writes = await page.evaluate(() => window.__writes);
const up2 = writes.find(w => w.op === 'upsert');
check('a late plan is written', up2 && [up2.row.kind, up2.row.at_time, up2.row.date], ['late', '09:05', DATE]);
ok('the confirmation names period 1', /arrives during Maths \(P1\)/.test(said));

console.log('\nThe registers');
let txt = await register(page, 'c-maths', 1);
ok('Maths P1 flags the late arrival', /Expected to arrive late, about 9:05 am/.test(txt));
ok('  and not the pickup', !/1:45/.test(txt));
txt = await register(page, 'c-sci', 7);
ok('Science P7 flags the early pickup', /Expected to leave early, at 1:45 pm/.test(txt));
txt = await register(page, 'c-study', 8);
ok('Study Hall P8 says she will miss it', /Leaving at 1:45 pm: expected to miss this class/.test(txt));

console.log('\nA new time replaces the old one');
await page.evaluate(() => { window.__writes = []; window.__said = []; });
await say(page, 'Ivy is being picked up at 2:15 tomorrow');
const plans = await page.evaluate(() => window.__T.planned_late_early.filter(p => p.kind === 'early'));
check('still one pickup, now at 2:15', plans.map(p => p.at_time), ['14:15']);
txt = await register(page, 'c-sci', 7);
ok('Science P7 now flags 2:15', /Expected to leave early, at 2:15 pm/.test(txt));

console.log('\nThe office panel');
await page.evaluate(() => {
  const div = document.createElement('div'); div.id = 'late-early-body'; document.body.appendChild(div);
});
await page.evaluate(() => app.renderLateEarlyPanel());
txt = await page.evaluate(() => document.getElementById('late-early-body').textContent);
ok('lists the pickup', /Leaves 2:15 pm/.test(txt));
ok('  and the late arrival', /Arrives 9:05 am/.test(txt));
const firstId = await page.evaluate(() => window.__T.planned_late_early[0].id);
await page.evaluate((id) => { window.__writes = []; return app.deleteLateEarly(id); }, firstId);
writes = await page.evaluate(() => window.__writes);
ok('Remove deletes that plan', writes.some(w => w.op === 'delete' && w.where.id === firstId));

console.log('\nA parent reports an early pickup');
await page.evaluate(() => {
  window.__writes = [];
  app.userInfo = { user: { id: 'u-pat' }, profile: { id: 'p-pat', user_type: 'parent', first_name: 'Pat' } };
  app.auth.userProfile = app.userInfo.profile; app.auth.currentUser = { id: 'u-pat' };
  app.children = [{ id: 'p-ivy', first_name: 'Ivy', last_name: 'Marsh' }];
  document.querySelectorAll('[id^="modal-"]').forEach(m => m.remove());
});
await page.evaluate(() => app.showParentLateEarlyModal());
await page.waitForSelector('#ple-time');
txt = await modalText(page);
ok('the form lists what the school already has', /Already reported/.test(txt) && /entered by the school/.test(txt));
ok('  with no Withdraw on the school\'s entries', !/Withdraw/.test(txt));
await page.selectOption('#ple-kind', 'early');
await page.fill('#ple-date', DATE);
await page.fill('#ple-time', '13:30');
await page.fill('#ple-reason', 'orthodontist');
await page.click('#ple-send');
await page.waitForTimeout(250);
writes = await page.evaluate(() => window.__writes);
const sent = writes.find(w => w.op === 'rpc');
check('it goes through rt_submit_late_early', sent && [sent.args.p_student_id, sent.args.p_kind, sent.args.p_time, sent.args.p_date, sent.args.p_reason],
  ['p-ivy', 'early', '13:30', DATE, 'orthodontist']);
const notice = await page.evaluate(() => [...document.querySelectorAll('.notification, [class*="notification"]')].map(n => n.textContent).join(' '));
ok('the parent is told staff were notified', /3 staff members told/.test(notice));
await page.evaluate(() => app.showParentLateEarlyModal());
await page.waitForSelector('#ple-existing');
txt = await modalText(page);
ok('their own entry can be withdrawn', /picked up 1:30 pm/.test(txt) && /Withdraw/.test(txt));
const ownId = await page.evaluate(() => window.__T.planned_late_early.find(p => p.source === 'parent').id);
await page.evaluate((id) => { window.__writes = []; return app.withdrawParentLateEarly(id); }, ownId);
writes = await page.evaluate(() => window.__writes);
ok('withdrawing deletes it', writes.some(w => w.op === 'delete' && w.where.id === ownId));

console.log('\nThe office sees who reported it');
await page.evaluate(() => app.submitParentLateEarly && null);
await page.evaluate(({ date }) => {
  window.__T.planned_late_early.push({ id: 'le-par', student_id: 'p-ivy', date, kind: 'early', at_time: '13:30:00', source: 'parent', created_by: 'u-pat' });
  app.userInfo = { user: { id: 'u-office' }, profile: { id: 'p-office', user_type: 'admin', first_name: 'Ola' } };
}, { date: DATE });
await page.evaluate(() => app.renderLateEarlyPanel());
txt = await page.evaluate(() => document.getElementById('late-early-body').textContent);
ok('the panel says "reported by a parent"', /reported by a parent/.test(txt));

check('no page errors', pageErrors, []);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
