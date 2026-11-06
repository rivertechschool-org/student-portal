// Offline teacher -> saved assignment -> organization -> student/parent journey.
// Serve the repository on localhost:8765, then run this with Node and Playwright.
// All external requests are blocked; every record below is invented.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
let chromium;
for (const spec of ['playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs']) {
  try { ({ chromium } = await import(spec)); break; } catch {}
}
if (!chromium) throw new Error('Install Playwright to run assignment-settings-journey.mjs');
const executablePath = [process.env.ASSIGNMENT_JOURNEY_CHROME, '/usr/bin/chromium', '/opt/pw-browsers/chromium'].find(p => p && existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
let checks = 0;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; console.log('ok  ' + label); };
try {
  const page = await browser.newPage({ timezoneId: 'America/Los_Angeles', viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Replace authentication bootstrap before it can run; no real sessions exist
  // in this harness and no request can leave the local server.
  await page.route('**/*', route => {
    const url = route.request().url();
    if (!url.startsWith('http://127.0.0.1:8765/')) return route.abort();
    if (new URL(url).pathname === '/shared/config.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.portalAuth = {};' });
    return route.continue();
  });
  await page.goto('http://127.0.0.1:8765/portal/index.html');
  await page.evaluate(() => {
    appInitialized = true;
    window.app = new ClassesPortalApp();
    window.__notices = [];
    app.showNotification = (message, type) => __notices.push({ message, type });
    // The rich-text editor is an external library, unrelated to this change.
    window.Quill = class { constructor(selector) { this.root = document.querySelector(selector); } };
    const today = app._localDateStr(new Date());
    const year = new Date().getFullYear();
    window.__tables = {
      quarters: [{ id: 'q', name: 'Test quarter', school_year: String(year), is_current: true, is_archived: false, start_date: `${year}-01-01`, end_date: `${year}-12-31` }],
      grade_categories: [{ id: 'cat', class_id: 'c', name: 'Classwork', is_default: true }],
      rubrics: [{ id: 'r', name: 'Default rubric', is_default: true }],
      class_enrollments: [{ id: 'e', class_id: 'c', student_id: 's', status: 'active' }],
      user_profiles: [{ id: 's', first_name: 'Quill', last_name: 'Marrow' }],
      assignments: [
        { id: 'a', title: 'Alpha', created_at: `${year}-01-03T12:00:00Z`, due_date: `${today}T16:00:00-08:00`, assigned_to_all: true, is_published: true },
        { id: 'b', title: 'Beta', created_at: `${year}-01-02T12:00:00Z`, due_date: `${today}T17:00:00-08:00`, assigned_to_all: true, is_published: true },
        { id: 'draft', title: 'Private draft', assigned_to_all: true, is_published: false },
        { id: 'selective', title: 'Someone else only', assigned_to_all: false, is_published: true }
      ].map(a => ({ ...a, class_id: 'c', category_id: 'cat', max_points: 100, grading_type: 'points', late_pass_allowed: true, due_date: a.due_date || `${today}T23:59:00-08:00` })),
      assignment_submissions: [], assignment_students: [], class_assignment_layouts: [], homework_assignments: []
    };
    app.classes = [{ id: 'c', name: 'Invented Class' }];
    app.userInfo = { profile: { id: 't', user_type: 'teacher' }, user: { id: 't' } };
    // This stub matches only the query operations used by this journey. It
    // returns copies and applies defaults rather than sharing live objects.
    const from = table => {
      const filters = []; let operation = 'read', payload, single = false, offset = 0, end = Infinity, head = false;
      const q = {
        select(_columns, options) { head = !!options?.head; return q; },
        eq(key, value) { filters.push(row => row[key] === value); return q; },
        in(key, values) { filters.push(row => values.includes(row[key])); return q; },
        gte(key, value) { filters.push(row => row[key] >= value); return q; },
        lte(key, value) { filters.push(row => row[key] <= value); return q; },
        or(value) { if (value.includes('assignment_type.is.null')) filters.push(row => row.assignment_type !== 'info'); return q; },
        order() { return q; }, range(a, b) { offset = a; end = b; return q; },
        insert(value) { operation = 'insert'; payload = value; return q; },
        update(value) { operation = 'update'; payload = value; return q; },
        delete() { operation = 'delete'; return q; },
        single() { single = true; return q; }, maybeSingle() { single = true; return q; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (table === 'class_assignment_layouts' && window.__layoutMissing) return { data: null, error: { message: 'missing layout table' } };
            const rows = __tables[table] ||= [];
            let matches = rows.filter(row => filters.every(f => f(row)));
            if (operation === 'insert') {
              if (table === 'class_assignment_layouts' && rows.some(row => row.class_id === payload.class_id)) return { data: null, error: { message: 'duplicate layout' } };
              matches = (Array.isArray(payload) ? payload : [payload]).map(value => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...structuredClone(value) }));
              rows.push(...matches);
            }
            if (operation === 'update') matches.forEach(row => Object.assign(row, structuredClone(payload)));
            if (operation === 'delete') __tables[table] = rows.filter(row => !matches.includes(row));
            matches = matches.slice(offset, end + 1);
            return { data: head ? null : structuredClone(single ? matches[0] || null : matches), count: matches.length, error: null };
          }).then(resolve, reject);
        }
      }; return q;
    };
    app.auth = { supabase: { from }, studentRecordId: () => 's' };
    app.supabaseQuery = callback => callback();
    app.sendNewAssignmentNotifications = async () => {};
    app.loadClassHomeworkResults = async () => {};
    app.withMyVersions = async rows => rows;
    app.loadStudentVersions = async () => [];
    app.children = [];
  });

  await page.evaluate(() => app.createAssignment('c'));
  await page.waitForTimeout(150);
  check('calendar starts on today in the teacher timezone', await page.inputValue('#assignment-due-day'), await page.evaluate(() => app._localDateStr(new Date())));
  check('default time is 11:59 PM', await page.inputValue('#assignment-due-time'), '23:59');
  check('advanced creation settings start collapsed', await page.locator('#assignment-more-settings').evaluate(el => !el.open));
  check('points and quarter are inside More settings', await page.evaluate(() => ['assignment-max-points', 'assignment-quarter'].every(id => document.getElementById('assignment-more-settings').contains(document.getElementById(id)))));
  await page.fill('#assignment-title', 'Calendar journey');
  await page.fill('#assignment-due-time', '18:30');
  await page.click('#assignment-more-settings summary');
  await page.selectOption('#grading-type', 'points');
  await page.fill('#assignment-max-points', '75');
  await page.click('button[onclick="app.submitCreateAssignment(\'c\')"]');
  await page.waitForSelector('#modal-view-assignments');
  const created = await page.evaluate(() => __tables.assignments.find(a => a.title === 'Calendar journey'));
  check('creation saved the teacher time and advanced points', await page.evaluate(a => ({ time: app._localDateTimeValue(a.due_date).slice(11), points: a.max_points }), created), { time: '18:30', points: 75 });
  await page.evaluate(id => app.editAssignment(id), created.id);
  await page.waitForTimeout(150);
  check('edit keeps saved time', await page.inputValue('#edit-assignment-due-time'), '18:30');
  check('advanced edit settings start collapsed', await page.locator('#edit-assignment-more-settings').evaluate(el => !el.open));
  await page.fill('#edit-assignment-due-time', '20:15');
  await page.click('#edit-assignment-more-settings summary');
  await page.fill('#edit-assignment-max-points', '80');
  await page.click('#modal-edit-assignment button.btn-primary:last-child');
  await page.waitForSelector('#modal-edit-assignment', { state: 'detached' });
  check('edit persists changed time and settings', await page.evaluate(id => { const a = __tables.assignments.find(a => a.id === id); return { time: app._localDateTimeValue(a.due_date).slice(11), points: a.max_points }; }, created.id), { time: '20:15', points: 80 });

  // The last day of a quarter at 23:59 is valid, including west of UTC.
  await page.evaluate(() => app.createAssignment('c'));
  await page.waitForTimeout(150);
  await page.fill('#assignment-title', 'Quarter end');
  await page.fill('#assignment-due-day', await page.evaluate(() => `${new Date().getFullYear()}-12-31`));
  await page.click('button[onclick="app.submitCreateAssignment(\'c\')"]');
  await page.waitForSelector('#modal-create-assignment', { state: 'detached' });
  await page.waitForFunction(() => document.getElementById('modal-view-assignments')?.innerText.includes('Quarter end'));
  check('last quarter day accepts the default 23:59', await page.evaluate(() => __tables.assignments.some(a => a.title === 'Quarter end')));

  await page.evaluate(() => app.organizeClassAssignments('c'));
  await page.fill('#assignment-new-group', 'Unit <1>');
  await page.click('button[onclick="app.addAssignmentLayoutGroup()"]');
  await page.fill('#assignment-new-group', 'Drafts');
  await page.click('button[onclick="app.addAssignmentLayoutGroup()"]');
  await page.evaluate(() => {
    const groups = app._assignmentLayoutEditor.layout.groups;
    app.setAssignmentLayoutGroup('a', groups[0].id);
    app.setAssignmentLayoutGroup('b', groups[0].id);
    app.setAssignmentLayoutGroup('draft', groups[1].id);
    app.setAssignmentLayoutGroup('selective', groups[1].id);
  });
  await page.selectOption('#assignment-layout-sort', 'custom');
  await page.click('button[onclick="app.moveAssignmentInLayout(\'b\', -1)"]');
  await page.click('#save-assignment-layout');
  await page.waitForSelector('#modal-organize-assignments', { state: 'detached' });
  check('custom order is saved and rendered for teachers', await page.evaluate(() => {
    const text = document.getElementById('modal-view-assignments').innerText;
    return text.indexOf('Beta') < text.indexOf('Alpha');
  }));
  check('group names render as text', await page.locator('#modal-view-assignments h4').allTextContents().then(names => names.includes('Unit <1>')));
  await page.evaluate(async () => {
    app.closeModal('view-assignments');
    app.userInfo.profile = { id: 's', user_type: 'student' };
    await app.viewAssignments('c');
  });
  const studentText = await page.locator('#modal-view-assignments').innerText();
  check('student reload uses the saved teacher order', studentText.indexOf('Beta') < studentText.indexOf('Alpha'));
  check('student sees teacher group headings', studentText.includes('Unit <1>'));
  check('student never sees drafts, unassigned work, empty hidden groups or organizer', !/Private draft|Someone else only|Drafts|Organize assignments/.test(studentText));
  await page.evaluate(async () => { app.userInfo.profile.user_type = 'parent'; await app.viewAssignments('c'); });
  const parentText = await page.locator('#modal-view-assignments').innerText();
  check('parents see the same group and order', parentText.includes('Unit <1>') && parentText.indexOf('Beta') < parentText.indexOf('Alpha'));

  await page.evaluate(async () => { app.userInfo.profile.user_type = 'teacher'; await app.organizeClassAssignments('c'); __tables.class_assignment_layouts[0].revision++; });
  await page.click('#save-assignment-layout');
  check('a concurrent edit does not overwrite saved organization', await page.locator('#modal-organize-assignments').isVisible());
  check('failed save releases the save button', await page.locator('#save-assignment-layout').isEnabled());
  await page.evaluate(async () => { app.closeModal('organize-assignments'); window.__layoutMissing = true; await app.viewAssignments('c'); });
  check('missing database update leaves assignments usable', (await page.locator('#modal-view-assignments').innerText()).includes('Alpha'));
  await page.evaluate(() => app.createAssignment('c'));
  await page.waitForTimeout(150);
  await page.setViewportSize({ width: 390, height: 844 });
  check('calendar and time fit a phone', await page.locator('#assignment-due-time').evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  for (const [type, id] of [['game', 'game-rtc-reward'], ['skill_mastery', 'skill-rtc-reward']]) {
    await page.selectOption('#assignment-type', type);
    check(type + ' reward is under More settings', await page.locator('#' + id).evaluate(el => el.closest('details')?.id), 'assignment-more-settings');
  }
  check('no browser script errors', errors, []);
  console.log(`\n${checks} journey checks passed; no live backend used.`);
} finally { await browser.close(); }
