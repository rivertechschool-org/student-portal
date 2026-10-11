// Journey: a teacher gives gold to the students who are in class today.
//
// Opens the class "Award RTC" screen in a real browser with Supabase stubbed,
// and walks it three ways: class register taken, only the daily register
// taken, and nothing taken yet. Each time: type an amount, press Apply to All,
// then Apply to Present, submit, and check who was actually paid.
//
// Invented names only. Run with the repo served on 8765:
//   python3 -m http.server 8765 &
//   node debug-tools/rtc-award-journey.mjs

let chromium;
for (const spec of ['playwright', 'playwright-core',
  '/opt/node22/lib/node_modules/playwright/index.mjs',
  '/opt/node22/lib/node_modules/playwright-core/index.mjs']) {
  try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
}
if (!chromium) { console.error('needs Playwright: npm i -g playwright'); process.exit(2); }

const { existsSync } = await import('node:fs');
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

let pass = 0, fail = 0;
const check = (label, a, e) => {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  if (A === E) { pass++; console.log('pass  ' + label); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${E}\n        got      ${A}`); }
};

const STUDENTS = [
  { id: 's1', first_name: 'Wren', last_name: 'Abbot', rtc_balance: 4 },
  { id: 's2', first_name: 'Otto', last_name: 'Birch', rtc_balance: 0 },
  { id: 's3', first_name: 'Juno', last_name: 'Crane', rtc_balance: 12 },
  { id: 's4', first_name: 'Pim', last_name: 'Dale', rtc_balance: 1 },
];

async function journey(name, classRows, dailyRows) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8765/portal/index.html');
  await page.waitForFunction(() => window.app && typeof window.app.showClassRTCAward === 'function', null, { timeout: 20000 });

  await page.evaluate(({ STUDENTS, classRows, dailyRows }) => {
    const tables = {
      class_enrollments: STUDENTS.map(s => ({ student_id: s.id, class_id: 'c1', status: 'active' })),
      user_profiles: STUDENTS,
      class_attendance: classRows,
    };
    // A chainable builder that ignores filters: the stub holds one class, one day.
    const q = (t) => {
      const rows = () => JSON.parse(JSON.stringify(tables[t] || []));
      const b = { select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b,
        then: (ok, bad) => Promise.resolve({ data: rows(), error: null }).then(ok, bad) };
      return b;
    };
    window.__paid = [];
    app.classes = [{ id: 'c1', name: 'Test Class' }];
    app.userInfo = { user: { id: 't1' } };
    app.auth = app.auth || {};
    app.auth.supabase = {
      from: q,
      rpc: async (fn, args) => { if (fn === 'process_rtc_transaction') window.__paid.push([args.p_user_id, args.p_amount]); return { data: { success: true }, error: null }; },
    };
    app.supabaseQuery = (f) => f();
    app._pickupRpc = async (fn) => fn === 'rt_daily_attendance_for' ? JSON.parse(JSON.stringify(dailyRows)) : [];
  }, { STUDENTS, classRows, dailyRows });

  await page.evaluate(() => app.showClassRTCAward('c1'));
  await page.waitForSelector('#rtc-bulk-students tr');
  const label = await page.textContent('#rtc-bulk-presence');
  const disabled = await page.$eval('button[onclick="app.setPresentRTCAmounts()"]', b => b.disabled);
  await page.fill('#rtc-bulk-set-all', '3');
  await page.click('button[onclick="app.setAllRTCAmounts()"]');
  if (!disabled) await page.click('button[onclick="app.setPresentRTCAmounts()"]');
  await page.fill('#rtc-class-bulk-reason', 'Good class');
  await page.click('#modal-class-rtc-award .btn-primary');
  await page.waitForTimeout(300);
  const paid = await page.evaluate(() => window.__paid.map(p => p[0] + ':' + p[1]));
  await page.close();
  return { label: label.trim(), disabled, paid, errors };
}

{
  const r = await journey('class taken',
    [{ student_id: 's1', period: 2, status: 'present' }, { student_id: 's2', period: 2, status: 'absent' },
     { student_id: 's3', period: 2, status: 'late' }],
    [{ student_id: 's2', status: 'present' }, { student_id: 's4', status: 'present' }]);
  console.log('   ' + r.label);
  check('class taken: button on', r.disabled, false);
  check('class taken: class register decides, s4 falls back to the day', r.paid, ['s1:3', 's3:3', 's4:3']);
  check('class taken: no page errors', r.errors, []);
}
{
  const r = await journey('daily only', [],
    [{ student_id: 's1', status: 'present' }, { student_id: 's2', status: 'absent' }, { student_id: 's4', status: 'left_early' }]);
  console.log('   ' + r.label);
  check('daily only: label names the fallback', /Class attendance not taken yet/.test(r.label), true);
  check('daily only: present per the day', r.paid, ['s1:3', 's4:3']);
  check('daily only: no page errors', r.errors, []);
}
{
  const r = await journey('nothing taken', [], []);
  console.log('   ' + r.label);
  check('nothing taken: button off', r.disabled, true);
  check('nothing taken: Apply to All still pays everyone', r.paid, ['s1:3', 's2:3', 's3:3', 's4:3']);
  check('nothing taken: no page errors', r.errors, []);
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
