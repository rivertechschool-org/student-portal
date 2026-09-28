// The teacher's Classes page must open straight onto the week.
//
// It used to flash the OLD card grid for a split second first: the week view
// needs class_schedule to lay itself out, that was fetched only when Classes
// was opened, and until it landed renderClassWeek() drew the plain grid as a
// stand-in. Luke saw it as the page switching layouts on open.
//
// This drives the real page against a deliberately slow stubbed database and
// watches #classes-content with a MutationObserver, so a layout that is on
// screen for one frame is still caught. Three journeys:
//
//   1. A teacher clicks Classes the instant sign-in finishes, before the
//      timetable has arrived: a spinner, then the week. Never the old grid.
//   2. A teacher opens Classes a moment later: the week on the first paint,
//      because the timetable was fetched at sign-in.
//   3. Today mode opened early: never a false "No Classes Today".
//
// Run:  python3 -m http.server 8765 &   then   node debug-tools/classes-week-flash.mjs
//
// Class names are invented. No real roster is involved or needed.

let chromium;
for (const spec of ['playwright', 'playwright-core',
  '/opt/node22/lib/node_modules/playwright/index.mjs',
  '/opt/node22/lib/node_modules/playwright-core/index.mjs']) {
  try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
}
if (!chromium) { console.error('Needs Playwright: npm i -g playwright'); process.exit(2); }

const { existsSync } = await import('node:fs');
const executablePath = [process.env.WORSHIP_JOURNEYS_CHROME, '/opt/pw-browsers/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(p => existsSync(p));

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`    ok   ${label}`); }
                              else { fail++; console.log(`  FAIL   ${label}`); } };

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [];

// Boot a fresh page as a teacher. `delay` is how long every read takes.
async function boot(delay) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('http://localhost:8765/portal/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.app, null, { timeout: 15000 });
  await page.evaluate((delay) => {
    // Every weekday has something on it, and every class is timetabled, so
    // the ONLY way a card grid can appear is the loading stand-in.
    const T = {
      grade_bands: [{ code: 'g7', label: 'Grade 7', sort_order: 1 }],
      classes: [
        { id: 'c1', name: 'Tidepools', subject: 'Science', grade_band: 'g7', teacher_id: 't1', status: 'active' },
        { id: 'c2', name: 'Fractions Lab', subject: 'Math', grade_band: 'g7', teacher_id: 't1', status: 'active' },
      ],
      class_enrollments: [],
      class_schedule: [0, 1, 2, 3, 4, 5, 6].flatMap(d => [
        { class_id: 'c1', day_of_week: d, period: 1 },
        { class_id: 'c2', day_of_week: d, period: 2 },
      ]),
      schedule_blocks: [
        { block_key: 'p1', label: 'Period 1', period: 1, day_of_week: null, starts_at: '08:30', ends_at: '09:15', omitted: false, sort_order: 1 },
        { block_key: 'p2', label: 'Period 2', period: 2, day_of_week: null, starts_at: '09:20', ends_at: '10:05', omitted: false, sort_order: 2 },
      ],
      class_attendance_sessions: [],
    };
    const q = (tb) => {
      const api = new Proxy({}, { get: (_, k) => {
        if (k === 'then') return (res, rej) => new Promise(r => setTimeout(r, delay))
          .then(() => ({ data: JSON.parse(JSON.stringify(T[tb] || [])), error: null })).then(res, rej);
        return () => api;                     // every filter/order/range chains
      } });
      return api;
    };
    const A = window.app;
    A.auth = A.auth || {};
    A.auth.supabase = { from: q, rpc: () => Promise.resolve({ data: null, error: null }) };
    A.userInfo = { user: { id: 't1' }, profile: { id: 't1', user_type: 'teacher', first_name: 'Test' } };

    // Watch the classes pane for every layout it ever shows.
    window.__seen = { grid: false, noToday: false, spinner: false, week: false };
    const el = document.getElementById('classes-content');
    new MutationObserver(() => {
      const h = el.innerHTML;
      if (el.querySelector('.grid.grid-3')) window.__seen.grid = true;
      if (h.includes('No Classes Today')) window.__seen.noToday = true;
      if (el.querySelector('.loading-spinner')) window.__seen.spinner = true;
      if (h.includes('Tidepools') && !el.querySelector('.grid.grid-3')) window.__seen.week = true;
    }).observe(el, { childList: true, subtree: true, characterData: true });
  }, delay);
  return page;
}

// What the classes pane looks like right now, in the terms above.
const settle = (page, ms) => page.waitForTimeout(ms);
const seen = page => page.evaluate(() => ({ ...window.__seen }));

// ======================================================================
console.log('\n1. Classes opened the instant sign-in finishes\n');
// ======================================================================
{
  const page = await boot(400);
  await page.evaluate(async () => {
    app.classFilterDay = 'all';
    await app.loadTeacherData();        // kicks off the timetable, not awaited
    app.showSection('classes');         // before it has landed
  });
  await settle(page, 2000);
  const s = await seen(page);
  ok('the old card grid never appears', !s.grid);
  ok('  a spinner holds the space meanwhile', s.spinner);
  ok('  and the week arrives', s.week);
  await page.close();
}

// ======================================================================
console.log('\n2. Classes opened a moment after sign-in\n');
// ======================================================================
{
  const page = await boot(300);
  await page.evaluate(async () => {
    app.classFilterDay = 'all';
    await app.loadTeacherData();
  });
  await settle(page, 1500);             // timetable prefetched meanwhile
  await page.evaluate(() => app.showSection('classes'));
  await settle(page, 1000);
  const s = await seen(page);
  ok('the week is the first thing drawn', s.week && !s.spinner);
  ok('  with no card grid on the way', !s.grid);
  await page.close();
}

// ======================================================================
console.log('\n3. Today mode opened before the timetable lands\n');
// ======================================================================
{
  const page = await boot(400);
  await page.evaluate(async () => {
    app.classFilterDay = 'today';
    await app.loadTeacherData();
    app.showSection('classes');
  });
  await settle(page, 2000);
  const s = await seen(page);
  ok('never says "No Classes Today" when there are some', !s.noToday);
  ok('  and today\'s classes arrive', s.week);
  await page.close();
}

await browser.close();
const ours = errors.filter(e => !/supabase|fetch|network|Failed to/i.test(e));
ok('no page errors', ours.length === 0);
if (ours.length) console.log(ours.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
