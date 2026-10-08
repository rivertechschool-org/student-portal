// Sub cover, driven the way the three people who use it actually use it.
//
// Jordan asked for it on 2026-10-06/07: a teacher flags the days they will be
// away, an admin assigns a sub, and on the day the class turns up in the sub's
// Classes page for the register, the assignments and the teacher's notes.
//
//   1. The teacher opens their class, presses 🙋 Sub Days, flags a few days
//      (only the days the class meets) and leaves notes for one of them.
//   2. The admin opens Sub Cover, sees what needs a sub, and picks one.
//   3. The sub opens Classes: the class is there under "Covering today". They
//      take the register, read the teacher's notes, leave one back, and look
//      at the assignments - with nothing on that screen that edits or grades.
//   4. Tomorrow, it has gone from the sub's page.
//   5. The teacher reopens Sub Days and sees who covered and what they wrote.
//
// Run:  python3 -m http.server 8765 &   then   node debug-tools/sub-cover-journeys.mjs
//
// Every name below is invented. The stub hands back copies of rows, never the
// rows, and its rt_cover_* functions follow the same rules as the real ones in
// the backend repo's migration (a_substitute_covers_a_class_for_the_day), so a
// write the server would refuse is refused here too. Those rules themselves are
// tested against a real Postgres in that repo.

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
    console.error('sub-cover-journeys needs Playwright and could not find it.\n' +
      '  npm i -g playwright && npx playwright install chromium');
    process.exit(2);
  }
}
const fs = await import('fs');
const CHROME = process.env.SUB_COVER_CHROME
  || ['/opt/pw-browsers/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const URL = process.env.PORTAL_URL || 'http://localhost:8765/portal/index.html';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date();
const TODAY = ds(NOW), DOW = NOW.getDay();
const plus = n => { const d = new Date(NOW); d.setDate(d.getDate() + n); return ds(d); };

// The class meets every day except the one two days from now, so flagging
// today..today+3 must add exactly three days, whatever today is.
const SKIP = (DOW + 2) % 7;
const SEED = {
  classes: [
    { id: 'c-art', name: 'Invented Art', subject: 'Art', status: 'active', is_active: true,
      max_students: 10, class_code: 'ART1', teacher_id: 'u-t' },
    { id: 'c-own', name: 'Sub Own Class', subject: 'Math', status: 'active', is_active: true,
      max_students: 10, class_code: 'OWN1', teacher_id: 'u-s' },
  ],
  class_schedule: [0, 1, 2, 3, 4, 5, 6].filter(d => d !== SKIP)
    .map(d => ({ class_id: 'c-art', day_of_week: d, period: 2 })),
  schedule_blocks: [{ period: 2, label: 'Period 2', starts_at: '00:00:00', ends_at: '00:01:00',
                      day_of_week: null, block_key: 'p2', sort_order: 2 }],
  class_enrollments: [
    { class_id: 'c-art', student_id: 'u-a', status: 'active' },
    { class_id: 'c-art', student_id: 'u-b', status: 'active' },
  ],
  user_profiles: [
    { id: 'u-a', first_name: 'Wren', last_name: 'Oakhollow', grade_level: 6, user_type: 'student' },
    { id: 'u-b', first_name: 'Pim', last_name: 'Starling', grade_level: 6, user_type: 'student' },
    { id: 'u-t', first_name: 'Tess', last_name: 'Quill', user_type: 'teacher' },
    { id: 'u-s', first_name: 'Sam', last_name: 'Basalt', user_type: 'teacher' },
    { id: 'u-admin', first_name: 'Ada', last_name: 'Ashgrove', user_type: 'admin' },
  ],
  assignments: [
    { id: 'as-1', class_id: 'c-art', title: 'Colour wheel', description: 'Paint the wheel.',
      due_date: plus(2) + 'T23:59:00', max_points: 20, is_published: true, assignment_type: 'regular' },
  ],
  class_attendance: [],
  class_attendance_sessions: [],
  class_cover_days: [],
};

const PEOPLE = {
  'u-t': { id: 'u-t', user_type: 'teacher', first_name: 'Tess', last_name: 'Quill' },
  'u-s': { id: 'u-s', user_type: 'teacher', first_name: 'Sam', last_name: 'Basalt' },
  'u-admin': { id: 'u-admin', user_type: 'admin', first_name: 'Ada', last_name: 'Ashgrove' },
};

// Installs the stub once; signIn() switches who is using the page.
async function install(page) {
  await page.evaluate(async ({ seed, today }) => {
    const T = JSON.parse(JSON.stringify(seed));
    window.__T = T;
    window.__today = today;
    let n = 0;
    const copy = v => JSON.parse(JSON.stringify(v));
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
          const out = copy(one ? (rows[0] || null) : rows);
          return new Promise(r => setTimeout(r, 20)).then(() => ({ data: out, error: null })).then(res, rej);
        },
      };
      return api;
    };

    // ---- the rt_cover_* functions, by the server's rules ----
    const me = () => window.__me;
    const prof = id => T.user_profiles.find(p => p.id === id) || {};
    const name = id => { const p = prof(id); return p.id ? `${p.first_name} ${p.last_name}` : null; };
    const cls = id => T.classes.find(c => c.id === id) || {};
    const isAdmin = () => prof(me()).user_type === 'admin';
    const teaches = (who, classId) => cls(classId).teacher_id === who || cls(classId).secondary_teacher_id === who;
    const mayManage = classId => isAdmin() || teaches(me(), classId);
    const no = error => ({ success: false, error });
    const view = d => ({ id: d.id, class_id: d.class_id, class_name: cls(d.class_id).name, date: d.cover_date,
      teacher_name: name(cls(d.class_id).teacher_id), notes_for_sub: d.notes_for_sub,
      sub_id: d.sub_teacher_id, sub_name: d.sub_teacher_id ? name(d.sub_teacher_id) : null, sub_notes: d.sub_notes });
    const sorted = rows => rows.slice().sort((a, b) => a.cover_date < b.cover_date ? -1 : a.cover_date > b.cover_date ? 1 : 0);
    const RPC = {
      rt_cover_request({ p_class_id, p_dates, p_note }) {
        if (!mayManage(p_class_id)) return no('Only this class\'s teacher or an admin can ask for a sub.');
        if (!p_dates?.length) return no('Pick at least one day.');
        if (p_dates.some(d => d < window.__today)) return no('A day in the past cannot be covered.');
        let added = 0;
        [...new Set(p_dates)].forEach(d => {
          if (T.class_cover_days.some(x => x.class_id === p_class_id && x.cover_date === d)) return;
          T.class_cover_days.push({ id: 'cov-' + (++n), class_id: p_class_id, cover_date: d,
            notes_for_sub: (p_note || '').trim() || null, sub_teacher_id: null, sub_notes: [] });
          added++;
        });
        return { success: true, added };
      },
      rt_cover_set_note({ p_id, p_note }) {
        const d = T.class_cover_days.find(x => x.id === p_id);
        if (!d) return no('That day is no longer on the list.');
        if (!mayManage(d.class_id)) return no('Only this class\'s teacher or an admin can change these notes.');
        d.notes_for_sub = (p_note || '').trim() || null;
        return { success: true };
      },
      rt_cover_remove({ p_id }) {
        const d = T.class_cover_days.find(x => x.id === p_id);
        if (!d) return { success: true };
        if (!mayManage(d.class_id)) return no('Only this class\'s teacher or an admin can remove a day.');
        if (d.cover_date < window.__today) return no('A day that has passed stays on the record.');
        T.class_cover_days = T.class_cover_days.filter(x => x !== d);
        return { success: true };
      },
      rt_cover_assign({ p_id, p_sub }) {
        if (!isAdmin()) return no('Only an admin can assign a sub.');
        const d = T.class_cover_days.find(x => x.id === p_id);
        if (!d) return no('That day is no longer on the list.');
        if (p_sub && !['teacher', 'admin'].includes(prof(p_sub).user_type)) return no('A sub has to be a teacher or an admin.');
        if (p_sub && teaches(p_sub, d.class_id)) return no('That person already teaches this class.');
        d.sub_teacher_id = p_sub || null;
        return { success: true };
      },
      rt_cover_add_note_for_teacher({ p_id, p_note }) {
        const d = T.class_cover_days.find(x => x.id === p_id);
        if (!d || d.sub_teacher_id !== me()) return no('Only the sub covering this day can leave a note here.');
        if (!(p_note || '').trim()) return no('The note is empty.');
        d.sub_notes = d.sub_notes.concat([{ at: new Date().toISOString(), by: me(), name: name(me()), note: p_note.trim() }]);
        return { success: true };
      },
      rt_cover_list({ p_class_id, p_since }) {
        if (!p_class_id && !isAdmin()) return no('Admins only.');
        if (p_class_id && !mayManage(p_class_id)) return no('Only this class\'s teacher or an admin can see its sub days.');
        const since = p_since || '0000';
        return { success: true, today: window.__today,
          days: sorted(T.class_cover_days.filter(d => d.cover_date >= since && (!p_class_id || d.class_id === p_class_id))).map(view) };
      },
      rt_cover_mine_today() {
        return { success: true, today: window.__today,
          days: T.class_cover_days.filter(d => d.cover_date === window.__today && d.sub_teacher_id === me()).map(view) };
      },
    };
    window.__rpcLog = [];
    app.auth.supabase = {
      from: build,
      rpc: (fn, args = {}) => {
        window.__rpcLog.push({ fn, args: copy(args), as: me() });
        const out = RPC[fn] ? RPC[fn](copy(args)) : null;
        return new Promise(r => setTimeout(r, 20)).then(() => ({ data: out == null ? null : copy(out), error: null }));
      },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    };
    window.__notes = [];
    app.showNotification = (msg, type) => window.__notes.push({ msg, type });
    app.sendAttendanceAlertNotifications = () => {};
    window.confirm = () => true;
    document.getElementById('loading-screen')?.classList.add('hidden');
    document.getElementById('auth-required')?.classList.add('hidden');
    document.getElementById('main-app')?.classList.remove('hidden');
  }, { seed: SEED, today: TODAY });
}

async function signIn(page, person) {
  await page.evaluate(p => {
    window.__me = p.id;
    window.__notes = [];
    app.userInfo = { user: { id: p.id }, profile: { ...p } };
    app.classes = JSON.parse(JSON.stringify(window.__T.classes.filter(c => c.teacher_id === p.id)));
    document.querySelectorAll('[id^="modal-"]').forEach(m => m.remove());
    app.modalStack = [];
  }, person);
}

const modalText = (page, id) => page.evaluate(i => document.getElementById('modal-' + i)?.innerText || '', id);
const lastNote = page => page.evaluate(() => window.__notes[window.__notes.length - 1] || null);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => window.app && window.app.auth, null, { timeout: 20000 });
await install(page);

// ======================================================================
console.log('\n1. The teacher flags the days they will be away');
// ======================================================================
await signIn(page, PEOPLE['u-t']);
await page.evaluate(() => app.openClass('c-art'));
await page.waitForTimeout(600);
const subBtn = page.locator('#modal-class-details button', { hasText: 'Sub Days' });
check('the class has a 🙋 Sub Days button', await subBtn.count(), 1);
await subBtn.click();
await page.waitForTimeout(500);
ok('Sub Days opens, with nothing flagged yet', (await modalText(page, 'cover-days')).includes('No days flagged'));
await page.fill('#cover-from', TODAY);
await page.fill('#cover-to', plus(3));
await page.fill('#cover-new-note', 'Sketchbooks are in the blue tub.');
await page.click('#modal-cover-days button:has-text("Add days")');
await page.waitForTimeout(700);
check('only the days the class meets were added (3 of 4)',
  await page.evaluate(() => __T.class_cover_days.map(d => d.cover_date).sort()),
  [TODAY, plus(1), plus(2), plus(3)].filter(d => new Date(d + 'T12:00:00').getDay() !== SKIP));
check('each says it needs a sub', await page.locator('#modal-cover-days .cover-day', { hasText: 'Needs a sub' }).count(), 3);
const firstNote = page.locator('#modal-cover-days .cover-day').first().locator('.cover-note');
check('the note was copied to each new day', await firstNote.inputValue(), 'Sketchbooks are in the blue tub.');
await firstNote.fill('Sketchbooks are in the blue tub. Wren needs the large brush.');
await page.locator('#modal-cover-days .cover-day').first().locator('button', { hasText: 'Save notes' }).click();
await page.waitForTimeout(400);
check('today\'s notes saved', await page.evaluate(d => __T.class_cover_days.find(x => x.cover_date === d).notes_for_sub, TODAY),
  'Sketchbooks are in the blue tub. Wren needs the large brush.');
check('the teacher was told', (await lastNote(page))?.msg, 'Notes saved.');
check('no notification or message was sent to anyone', await page.evaluate(() =>
  (__T.notifications || []).length + (__T.messages || []).length), 0);

// ======================================================================
console.log('\n2. The admin assigns a sub');
// ======================================================================
await signIn(page, PEOPLE['u-admin']);
await page.evaluate(() => app.showCoverBoard());
await page.waitForTimeout(600);
const board = await modalText(page, 'cover-board');
ok('the board shows the three days, each for Invented Art', (board.match(/Invented Art/g) || []).length >= 3);
ok('  and says three need a sub', board.includes('3 need a sub'));
ok('  and whose class it is', board.includes('Teacher: Tess Quill'));
const todayRow = page.locator('#modal-cover-board .cover-board-row').first();
await todayRow.locator('select.cover-sub-pick').selectOption('u-s');
await page.waitForTimeout(700);
check('Sam is assigned to today', await page.evaluate(d => __T.class_cover_days.find(x => x.cover_date === d).sub_teacher_id, TODAY), 'u-s');
check('the board redraws with Sam picked', await page.locator('#modal-cover-board .cover-board-row').first()
  .locator('select.cover-sub-pick').inputValue(), 'u-s');
ok('  and two still need a sub', (await modalText(page, 'cover-board')).includes('2 need a sub'));
await page.locator('#modal-cover-board .cover-board-row').first().locator('select.cover-sub-pick').selectOption('u-t');
await page.waitForTimeout(700);
ok('the class\'s own teacher cannot be its sub, and the admin is told why',
  (await lastNote(page))?.msg === 'That person already teaches this class.');
check('  and today keeps Sam', await page.evaluate(d => __T.class_cover_days.find(x => x.cover_date === d).sub_teacher_id, TODAY), 'u-s');

// ======================================================================
console.log('\n3. The sub covers the class today');
// ======================================================================
await signIn(page, PEOPLE['u-s']);
await page.evaluate(() => app.showSection('classes'));
await page.waitForTimeout(900);
const strip = await page.evaluate(() => { const b = document.getElementById('cover-today'); return { hidden: b.hidden, text: b.innerText }; });
ok('"Covering today" is on the sub\'s Classes page', !strip.hidden && strip.text.includes('Covering today'));
ok('  naming the class and whose it is', strip.text.includes('Invented Art') && strip.text.includes('For Tess Quill'));
ok('  above the sub\'s own week, which is still there', await page.evaluate(() =>
  document.getElementById('classes-content').innerText.includes('Sub Own Class')));

await page.click('#cover-today button:has-text("Attendance")');
await page.waitForTimeout(800);
check('the register opens on the class, with both students',
  await page.evaluate(() => [document.querySelector('#modal-class-attendance .modal-title, #modal-class-attendance h2, #modal-class-attendance h3')?.innerText.includes('Invented Art'),
                             document.querySelectorAll('#modal-class-attendance tr[data-student-id]').length]), [true, 2]);
await page.evaluate(() => document.querySelectorAll('#modal-class-attendance .class-attendance-status').forEach(s => { s.value = 'present'; }));
const save = page.locator('#modal-class-attendance button[onclick*="saveClassAttendance"]');
check('the register can be saved', await save.count(), 1);
await save.click();
await page.waitForTimeout(900);
check('the register is written, marked by the sub, for today',
  await page.evaluate(() => __T.class_attendance.map(r => [r.class_id, r.date === __today, r.status, r.marked_by]).sort()),
  [['c-art', true, 'present', 'u-s'], ['c-art', true, 'present', 'u-s']]);
await page.evaluate(() => app.closeModal('class-attendance'));

await page.click('#cover-today button:has-text("Notes")');
await page.waitForTimeout(400);
ok('the sub reads the teacher\'s notes', (await modalText(page, 'cover-notes')).includes('Wren needs the large brush'));
check('  with no way to edit them', await page.locator('#modal-cover-notes textarea').count(), 1);
await page.fill('#cover-note-back', 'Pim left at lunch. Wheels are drying on the rack.');
await page.click('#modal-cover-notes button:has-text("Add note")');
await page.waitForTimeout(700);
check('the note is kept for the teacher', await page.evaluate(d =>
  __T.class_cover_days.find(x => x.cover_date === d).sub_notes.map(n => [n.note, n.name]), TODAY),
  [['Pim left at lunch. Wheels are drying on the rack.', 'Sam Basalt']]);
ok('  and shows under the notes straight away', (await modalText(page, 'cover-notes')).includes('Pim left at lunch'));
await page.evaluate(() => app.closeModal('cover-notes'));

await page.click('#cover-today button:has-text("Assignments")');
await page.waitForTimeout(600);
ok('the sub sees the assignments', (await modalText(page, 'cover-assignments')).includes('Colour wheel'));
check('  with nothing that grades or edits them', await page.evaluate(() =>
  [...document.querySelectorAll('#modal-cover-assignments [onclick]')]
    .map(b => b.getAttribute('onclick')).filter(o => /grade|edit|delete|viewSubmissions|Gradebook/i.test(o))), []);
await page.evaluate(() => app.closeModal('cover-assignments'));
check('the sub tried no write the server would refuse', await page.evaluate(() =>
  __notes.filter(n => n.type === 'error').map(n => n.msg)), []);

// ======================================================================
console.log('\n4. Tomorrow, the class has gone from the sub\'s page');
// ======================================================================
await page.evaluate(d => { window.__today = d; }, plus(1));
await page.evaluate(() => app.showSection('classes'));
await page.waitForTimeout(800);
check('"Covering today" is hidden', await page.evaluate(() => document.getElementById('cover-today').hidden), true);
await page.evaluate(d => { window.__today = d; }, TODAY);

// ======================================================================
console.log('\n5. The teacher sees who covered and what they wrote');
// ======================================================================
await signIn(page, PEOPLE['u-t']);
await page.evaluate(() => app.showCoverDays('c-art'));
await page.waitForTimeout(600);
const after = await modalText(page, 'cover-days');
ok('today says Sam is the sub', after.includes('Sub: Sam Basalt'));
ok('  and shows Sam\'s note', after.includes('Pim left at lunch'));
await page.locator('#modal-cover-days .cover-day').last().locator('button', { hasText: 'Remove day' }).click();
await page.waitForTimeout(700);
check('a day the teacher no longer needs can be taken off', await page.evaluate(() => __T.class_cover_days.length), 2);
await signIn(page, PEOPLE['u-s']);
check('the sub cannot use the teacher\'s Sub Days for this class', await page.evaluate(async () =>
  (await app.auth.supabase.rpc('rt_cover_list', { p_class_id: 'c-art', p_since: null })).data.success), false);

const real = errors.filter(e => !/supabase|fetch|network|google|quill/i.test(e));
check('no page errors', real, []);
await page.screenshot({ path: process.env.SUB_COVER_SHOT || '/dev/null' }).catch(() => {});
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
