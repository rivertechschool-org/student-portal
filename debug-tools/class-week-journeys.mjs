// The teacher's Classes page and its registers, driven the way a teacher uses it.
//
// Two journeys, in a real browser against a stubbed database:
//
//   1. Hover a class in the week grid, press 📋, and the register that opens
//      is that cell's day and period - not the class details dialog.
//   2. Take the register and save it. The cell behind the dialog turns green
//      straight away. It used to stay red until the page was reloaded, because
//      the week grid kept the sessions it read on arrival.
//
// Run:  python3 -m http.server 8765 &   then   node debug-tools/class-week-journeys.mjs
//
// Playwright is found the same way worship-journeys.mjs finds it; set
// CLASS_WEEK_CHROME to point at a browser you already have.
//
// Every name below is invented. The stub is dumb on purpose: whole tables,
// eq/is/in/gte/lte filters, and copies of rows handed back, never the rows.

let chromium;
{
  const CANDIDATES = [
    'playwright', 'playwright-core',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/opt/node22/lib/node_modules/playwright-core/index.mjs',
  ];
  for (const spec of CANDIDATES) {
    try { ({ chromium } = await import(spec)); break; } catch (_) { /* try the next */ }
  }
  if (!chromium) {
    console.error('class-week-journeys needs Playwright and could not find it.\n' +
      '  npm i -g playwright && npx playwright install chromium');
    process.exit(2);
  }
}
const fs = await import('fs');
const CHROME = process.env.CLASS_WEEK_CHROME
  || ['/opt/pw-browsers/chromium'].find(p => fs.existsSync(p));
const URL = process.env.PORTAL_URL || 'http://localhost:8765/portal/index.html';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};

const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date();
const TODAY = ds(NOW), DOW = NOW.getDay();

// One class that meets every day in period 2, so today always has a cell,
// period 2 ends at 00:01 so today's cell is already "over" (red until taken).
const SEED = {
  classes: [{ id: 'c-art', name: 'Invented Art', subject: 'Art', grade_band: null,
              status: 'active', max_students: 10, class_code: 'ART1', teacher_id: 'u-t' }],
  class_schedule: [0, 1, 2, 3, 4, 5, 6].map(d => ({ class_id: 'c-art', day_of_week: d, period: 2 })),
  schedule_blocks: [{ period: 2, label: 'Period 2', starts_at: '00:00:00', ends_at: '00:01:00',
                      day_of_week: null, block_key: 'p2', sort_order: 2 }],
  class_enrollments: [
    { class_id: 'c-art', student_id: 'u-a', status: 'active' },
    { class_id: 'c-art', student_id: 'u-b', status: 'active' },
  ],
  user_profiles: [
    { id: 'u-a', first_name: 'Wren', last_name: 'Oakhollow', grade_level: 6 },
    { id: 'u-b', first_name: 'Pim',  last_name: 'Starling',  grade_level: 6 },
  ],
  class_attendance: [],
  class_attendance_sessions: [],
};

async function boot(page) {
  await page.evaluate(async ({ seed, me }) => {
    const T = JSON.parse(JSON.stringify(seed));
    window.__T = T;
    const build = tb => {
      const f = []; let op = 'select', payload = null, one = false;
      const match = r => f.every(([k, v, how]) =>
        how === 'in' ? v.includes(r[k]) : how === 'gte' ? r[k] >= v : how === 'lte' ? r[k] <= v
        : (r[k] ?? null) === v);
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; }, or() { return api; },
        neq() { return api; }, not() { return api; },
        eq(k, v) { f.push([k, v]); return api; }, is(k, v) { f.push([k, v]); return api; },
        in(k, v) { f.push([k, v, 'in']); return api; },
        gte(k, v) { f.push([k, v, 'gte']); return api; }, lte(k, v) { f.push([k, v, 'lte']); return api; },
        single() { one = true; return api; }, maybeSingle() { one = true; return api; },
        insert(p) { op = 'insert'; payload = p; return api; },
        upsert(p) { op = 'insert'; payload = p; return api; },
        update(p) { op = 'update'; payload = p; return api; },
        delete() { op = 'delete'; return api; },
        then(res, rej) {
          const all = T[tb] || (T[tb] = []);
          let rows;
          if (op === 'insert') { rows = [].concat(payload).map(r => ({ ...r })); all.push(...rows); }
          else if (op === 'update') { rows = all.filter(match); rows.forEach(r => Object.assign(r, payload)); }
          else if (op === 'delete') { rows = all.filter(match); T[tb] = all.filter(r => !match(r)); }
          else rows = all.filter(match);
          const out = JSON.parse(JSON.stringify(one ? (rows[0] || null) : rows));
          return new Promise(r => setTimeout(r, 20)).then(() => ({ data: out, error: null })).then(res, rej);
        },
      };
      return api;
    };
    app.auth.supabase = { from: build, rpc: () => Promise.resolve({ data: null, error: null }),
                          channel: () => ({ on() { return this; }, subscribe() { return this; } }) };
    app.userInfo = { user: { id: me }, profile: { id: me, user_type: 'teacher', first_name: 'Test' } };
    app.showNotification = () => {};
    app.sendAttendanceAlertNotifications = () => {};
    app.classes = JSON.parse(JSON.stringify(T.classes));
    // Signed in, as far as the page's chrome is concerned.
    document.getElementById('loading-screen')?.classList.add('hidden');
    document.getElementById('auth-required')?.classList.add('hidden');
    document.getElementById('main-app')?.classList.remove('hidden');
    app.showSection('classes');
  }, { seed: SEED, me: 'u-t' });
  await page.waitForTimeout(600);
}

// The week grid's cell for today: the class card, and the status line under it.
const todayCell = page => page.evaluate(() => {
  const btn = [...document.querySelectorAll('#classes-content button[title="Take attendance"]')]
    .find(b => b.getAttribute('onclick').includes(app._localDateStr(new Date())));
  if (!btn) return null;
  const card = btn.closest('.class-card');
  const status = card.nextElementSibling?.textContent.trim() || '';
  return { status, hovered: getComputedStyle(btn.parentElement).opacity };
});

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => window.app && window.app.auth, null, { timeout: 20000 });

console.log('1. 📋 on a week-grid cell opens that cell\'s register');
await boot(page);
check('today\'s cell starts red', (await todayCell(page))?.status, 'Attendance not taken');
const btn = page.locator(`#classes-content button[title="Take attendance"][onclick*="${TODAY}"]`);
const card = btn.locator('xpath=ancestor::div[contains(@class,"class-card")][1]');
await card.hover();
await page.waitForTimeout(250);
check('button shows on hover', (await todayCell(page))?.hovered, '1');
await btn.click();
await page.waitForTimeout(600);
const opened = await page.evaluate(() => ({
  register: !!document.querySelector('tr[data-student-id]'),
  details: !!document.getElementById('class-details-modal') && getComputedStyle(document.getElementById('class-details-modal')).display !== 'none',
  rows: document.querySelectorAll('tr[data-student-id]').length,
}));
check('the register opened, with both students', [opened.register, opened.rows], [true, 2]);
check('class details did not open underneath', opened.details, false);

console.log('2. saving the register turns the cell green without a reload');
await page.evaluate(() => document.querySelectorAll('.class-attendance-status').forEach(s => { s.value = 'present'; }));
await page.evaluate(({ d }) => app.saveClassAttendance('c-art', d, 2), { d: TODAY });
await page.waitForTimeout(800);
check('a completed session was written', await page.evaluate(() =>
  __T.class_attendance_sessions.map(s => [s.date === app._localDateStr(new Date()), s.period, s.status])), [[true, 2, 'completed']]);
check('today\'s cell says taken', (await todayCell(page))?.status, 'Attendance taken');

console.log('   canceling it instead shows canceled, restoring shows red again');
await page.evaluate(({ d }) => app.cancelClass('c-art', d, 2), { d: TODAY });
await page.waitForTimeout(800);
check('today\'s cell says canceled', (await todayCell(page))?.status, 'Class canceled');
await page.evaluate(({ d }) => app.uncancelClass('c-art', d, 2), { d: TODAY });
await page.waitForTimeout(800);
check('today\'s cell is back to not taken', (await todayCell(page))?.status, 'Attendance not taken');

const real = errors.filter(e => !/supabase|fetch|network|google|quill/i.test(e));
check('no page errors', real, []);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
