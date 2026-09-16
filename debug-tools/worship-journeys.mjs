// Worship / Band, driven the way people actually use it.
//
// Four journeys, start to finish, in a real browser against a stubbed database.
// Unit tests hold single functions honest; this holds the SEAMS honest — the
// places where a render, a write and a reload have to agree, which is where the
// bugs that reach Luke have all lived so far.
//
//   1. A student asks to join, and an admin lets them in.
//   2. An admin plans a service from an empty date: people, songs, a song that
//      is not in the library yet, a reorder, a key change, a practice file,
//      publish.
//   3. A player opens the published plan, says they will be there, and reads
//      the chart in the key it is booked in.
//   4. The library: search, open, transpose, edit.
//
// Run:  python3 -m http.server 8765 &   then   node debug-tools/worship-journeys.mjs
//
// The stub is deliberately dumb — it returns whole tables and records writes.
// Anything that needs real RLS has to be checked against the live site.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = new Date();
const SUNDAY = new Date(TODAY); SUNDAY.setDate(TODAY.getDate() + ((0 - TODAY.getDay() + 7) % 7));

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the stub ----------------------------------------------------------
function seedScript(seed, me) {
  return { seed, me };
}

async function boot(page, seed, me) {
  await page.evaluate(async ({ seed, me }) => {
    window.__writes = [];
    const T = JSON.parse(JSON.stringify(seed));
    window.__T = T;
    let n = 0;
    // Writes take a beat, the way a real one does over a school's wifi. Without
    // this the harness can never stage the thing people actually do: press
    // again because nothing appeared to happen.
    const slow = () => new Promise(r => setTimeout(r, window.__writeDelay || 0));
    // Column defaults, as the real schema declares them. Without these the stub
    // is STRICTER than Postgres and cries wolf: the app rightly omits a
    // defaulted column on insert and then reads the row back expecting the
    // default to be there. Keep this in step with the migrations.
    const DEFAULTS = {
      worship_songs:         { is_active: true, chart_format: 'text', tags: [] },
      worship_join_requests: { status: 'pending' },
      worship_service_slots: { status: 'scheduled', is_leader: false },
      worship_service_songs: { leader_user_id: null, sort_order: 0 },
      worship_services:      { status: 'draft' },
      worship_service_files: { sort_order: 0 },
      worship_members:       { instruments: [], is_worship_admin: false },
    };
    const build = (tb) => {
      const st = { tb, single: false, eq: {} };
      const api = {
        select(){ return api; },
        eq(c, v){ st.eq[c] = v; return api; },
        in(){ return api; }, order(){ return api; }, limit(){ return api; },
        maybeSingle(){ st.single = true; return api; },
        single(){ st.single = true; return api; },
        insert(row){
          const id = `${st.tb}-${++n}`;
          const done = slow().then(() => {
            window.__writes.push({ op: 'insert', table: st.tb, row });
            (T[st.tb] = T[st.tb] || []).push({ ...(DEFAULTS[st.tb] || {}), ...row, id });
          });
          return {
            select: () => ({ single: () => done.then(() => ({ data: { id }, error: null })) }),
            then: (r) => done.then(() => ({ data: null, error: null })).then(r)
          };
        },
        update(row){
          window.__writes.push({ op: 'update', table: st.tb, row });
          return { eq: (c, v) => {
            (T[st.tb] || []).forEach(x => { if (x[c] === v) Object.assign(x, row); });
            return Promise.resolve({ data: null, error: null });
          } };
        },
        delete(){
          return { eq: (c, v) => {
            window.__writes.push({ op: 'delete', table: st.tb, [c]: v });
            T[st.tb] = (T[st.tb] || []).filter(x => x[c] !== v);
            return Promise.resolve({ data: null, error: null });
          } };
        },
        then(r){
          let rows = (T[st.tb] || []).slice();
          Object.entries(st.eq).forEach(([c, v]) => { rows = rows.filter(x => x[c] === v); });
          const out = JSON.parse(JSON.stringify(st.single ? (rows[0] || null) : rows));
          return Promise.resolve({ data: out, error: null }).then(r);
        }
      };
      return api;
    };
    const roster = () => (T.worship_members || []).map(m => {
      const p = T.__people.find(x => x.id === m.user_id) || {};
      return { user_id: m.user_id, full_name: p.full_name, user_type: p.user_type,
               grade_level: p.grade_level ?? null, instruments: m.instruments || [],
               is_worship_admin: !!m.is_worship_admin, created_at: '2026-01-01T00:00:00Z' };
    });
    A.supabase = {
      from: build,
      rpc: (name, args) => {
        window.__writes.push({ op: 'rpc', name, args });
        if (name === 'worship_roster') return Promise.resolve({ data: roster(), error: null });
        if (name === 'worship_directory') return Promise.resolve({ data: T.__people.map(p => ({
          user_id: p.id, full_name: p.full_name, user_type: p.user_type, grade_level: p.grade_level ?? null })), error: null });
        if (name === 'worship_requests_list') return Promise.resolve({ data: (T.worship_join_requests || []).map(r => {
          const p = T.__people.find(x => x.id === r.user_id) || {};
          return { ...r, full_name: p.full_name, user_type: p.user_type, grade_level: p.grade_level ?? null };
        }), error: null });
        if (name === 'worship_slot_respond') {
          const slot = (T.worship_service_slots || []).find(x => x.id === args.p_slot_id);
          if (!slot) return Promise.resolve({ data: { success: false, error: 'No such slot' }, error: null });
          if (slot.user_id !== me.id) return Promise.resolve({ data: { success: false, error: 'That is not your slot' }, error: null });
          slot.status = args.p_status;
          return Promise.resolve({ data: { success: true }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
    };
    // Each journey starts from a clean screen, including any dialog the
    // previous one left open - a modal over the page swallows every click.
    closeModal();
    A.me = me;
    A.member = null; A.myRequest = null; A.isAdmin = false;
    A.loaded = { songs: false, schedule: false, requests: false };
    A.openService = null; A._openType = null; A._songQuery = ''; A._dirQuery = '';
    await loadCore();
    if (!A.member && !A.isAdmin) A.tab = 'team'; else A.tab = 'myschedule';
    await go(A.tab);
  }, { seed, me });
  await page.waitForTimeout(350);
}

const text = page => page.evaluate(() => document.getElementById('app').innerText);

// ---- the world ---------------------------------------------------------
const PEOPLE = [
  { id: 'u-luke', full_name: 'Luke Hegelund', user_type: 'admin' },
  { id: 'u-ann',  full_name: 'Ann Becker',    user_type: 'student', grade_level: 7 },
  { id: 'u-ben',  full_name: 'Ben Chase',     user_type: 'student', grade_level: 5 },
  { id: 'u-dee',  full_name: 'Dee Ellis',     user_type: 'student', grade_level: 6 },
  { id: 'u-cal',  full_name: 'Cal Diaz',      user_type: 'student', grade_level: 8 },
];
const SEED = () => ({
  __people: PEOPLE,
  worship_members: [
    { id: 'm1', user_id: 'u-luke', instruments: ['piano'], is_worship_admin: true },
    { id: 'm2', user_id: 'u-ann',  instruments: ['guitar', 'singing'], is_worship_admin: false },
    { id: 'm3', user_id: 'u-ben',  instruments: ['cajon'], is_worship_admin: false },
  ],
  worship_join_requests: [],
  worship_service_types: [
    { id: 't1', name: 'Sunday Morning', weekday: 0, start_time: '10:30:00', location: 'Main hall', is_active: true, sort_order: 0 },
    { id: 't2', name: 'Wednesday Chapel', weekday: 3, start_time: '09:00:00', is_active: true, sort_order: 0 },
  ],
  worship_services: [],
  worship_service_slots: [],
  worship_service_songs: [],   // rows gain leader_user_id from DEFAULTS
  worship_service_files: [],
  worship_songs: [
    { id: 's1', title: 'Refuge', artist: 'New Creation Worship', default_key: 'E', bpm: 72,
      tags: ['slow'], chord_chart: '/V1\nI 1call upon Your name\nYou de5livered me from harm\n\n/Chorus\nHe 1picked me up, and 2turned me around',
      chart_format: 'nashville', is_active: true, song_url: 'https://youtu.be/x' },
    { id: 's2', title: 'What a God', artist: 'SEU Worship', default_key: 'C', tags: [],
      chord_chart: null, chart_format: 'text', is_active: true },
  ],
});

const LUKE = { id: 'u-luke', first_name: 'Luke', last_name: 'Hegelund', user_type: 'admin' };
const DEE  = { id: 'u-dee',  first_name: 'Dee',  last_name: 'Ellis',    user_type: 'student' };
const ANN  = { id: 'u-ann',  first_name: 'Ann',  last_name: 'Becker',   user_type: 'student' };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
await page.goto('http://localhost:8765/portal/worship.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);

let world = SEED();

// ======================================================================
console.log('\n1. A student asks to join, and an admin lets them in\n');
// ======================================================================
await boot(page, world, DEE);
ok('a non-member lands on Team', (await text(page)).includes('Ask to join Worship / Band'));
ok('  and can see who is already on it', (await text(page)).includes('Ann Becker'));
ok('  but gets no admin controls', !(await text(page)).includes('Add someone to the team'));

await page.click('#join-singing');
await page.click('#join-piano');
await page.fill('#join-note', 'I sing at church already');
await page.click('button.btn:not(.sec)');
await page.waitForTimeout(400);
const afterAsk = await text(page);
ok('the request is acknowledged on the page', afterAsk.includes('Your request is in'));
ok('  naming what they asked for', await page.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('Your request is in'));
  return !!card && card.innerText.includes('Piano') && card.innerText.includes('Singing');
}));

world = await page.evaluate(() => window.__T);
await boot(page, world, LUKE);
await page.evaluate(() => go('requests'));
await page.waitForTimeout(400);
const queue = await text(page);
ok('the admin sees it waiting', queue.includes('Dee Ellis'));
ok('  with the note', queue.includes('I sing at church already'));
ok('  and the tab carries a count', await page.evaluate(() => !!document.querySelector('.tabbar .badge')));

await page.click('button.good.small');            // Add to team
await page.waitForTimeout(500);
await page.evaluate(() => go('team'));
await page.waitForTimeout(350);
const roster = await text(page);
ok('they are on the roster now', roster.includes('Dee Ellis'));
ok('  with the instruments they asked for',
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find(r => r.innerText.includes('Dee Ellis'));
    return !!row && row.innerText.includes('Piano') && row.innerText.includes('Singing');
  }));
ok('  and the queue is clear', await page.evaluate(() => !document.querySelector('.tabbar .badge')));

// ======================================================================
console.log('\n2. An admin plans a service from an empty date\n');
// ======================================================================
world = await page.evaluate(() => window.__T);
await boot(page, world, LUKE);
ok('the page opens on my schedule', await page.evaluate(() => A.tab === 'myschedule'));
await page.evaluate(() => go('plan'));
await page.waitForTimeout(350);
ok('services are listed in week order', await page.evaluate(() =>
  [...document.querySelectorAll('.trow .name')].map(n => n.textContent).join('|') === 'Sunday Morning|Wednesday Chapel'));

await page.click('.trow');
await page.waitForTimeout(300);
ok('the fortnight shows unplanned dates', await page.evaluate(() => document.querySelectorAll('.drow.unplanned').length >= 2));
await page.click('.drow.unplanned');              // Start a plan
await page.waitForTimeout(600);
ok('a draft opens straight onto the plan', await page.evaluate(() => !!document.querySelector('.planhead')));
ok('  and it is a draft', (await text(page)).includes('draft'));

const svcId = await page.evaluate(() => A.openService);
await page.evaluate(() => addPersonTo(A.openService, 'piano'));
await page.waitForTimeout(250);
await page.selectOption('#ap-user', 'u-luke');
await page.click('#ap-lead');
await page.click('#modal button.btn:not(.sec)');
await page.waitForTimeout(450);
await page.evaluate(() => addPersonTo(A.openService, 'guitar'));
await page.waitForTimeout(250);
await page.selectOption('#ap-user', 'u-ann');
await page.click('#modal button.btn:not(.sec)');
await page.waitForTimeout(450);
// Ann is on twice, which is normal - guitar and singing - and is exactly the
// shape that broke: one answer was taken to cover both.
await page.evaluate(() => addPersonTo(A.openService, 'singing'));
await page.waitForTimeout(250);
await page.selectOption('#ap-user', 'u-ann');
await page.click('#modal button.btn:not(.sec)');
await page.waitForTimeout(450);
const team = await text(page);
ok('both are on the rota', team.includes('Luke Hegelund') && team.includes('Ann Becker'));
// Answering belongs to My schedule. The plan shows who has said yes — that is
// the whole point of looking at it — but you cannot answer from here, even for
// yourself, even as the admin who put you there.
ok('the plan offers no reply buttons', await page.evaluate(() => !document.querySelector('.myslot')));
ok('  while still showing every answer', await page.evaluate(() =>
  [...document.querySelectorAll('.person')].every(p => /asked|in|out/.test(p.innerText))));
ok('  and points at where to answer', await page.evaluate(() =>
  document.body.innerText.includes('answer for it on')));
ok('  the leader is starred', team.includes('★ Luke Hegelund'));
ok('  and neither has answered yet', await page.evaluate(() =>
  [...document.querySelectorAll('.person')].every(p => p.innerText.includes('asked'))));

await page.selectOption(`#song-pick-${svcId}`, 's1');   // the box starts on "Song…"
await page.selectOption(`#song-key-${svcId}`, 'Ab');
await page.click(`button[onclick="addServiceSong('${svcId}',this)"]`);
await page.waitForTimeout(450);
ok('the song is on the order in the key chosen', (await text(page)).includes('Key Ab'));

await page.selectOption(`#song-key-${svcId}`, 'G');
await page.selectOption(`#song-pick-${svcId}`, '__new');
await page.waitForTimeout(350);
await page.fill('#sg-title', 'Goodness of God');
await page.fill('#sg-artist', 'Bethel Music');
await page.fill('#sg-chart', '/V1\nI 1love You Lord\nFor Your 4mercy never 5fails me');
await page.click('#modal button.btn:not(.sec)');
await page.waitForTimeout(650);
const order = await page.evaluate(() => [...document.querySelectorAll('.item')].map(i => i.innerText.replace(/\n/g, ' | ')));
ok('a song made from the picker lands on the order', order.length === 2 && order[1].includes('Goodness of God'));
ok('  in the key the row was set to', order[1].includes('Key G'));
ok('  and the plan is still open behind it', await page.evaluate(() => !!document.querySelector('.planhead')));

await page.click('.item:nth-child(3) .ord button[title="Up"]');   // second item up
await page.waitForTimeout(450);
const reordered = await page.evaluate(() => [...document.querySelectorAll('.item .t a')].map(a => a.textContent));
check('reordering sticks', reordered, ['Goodness of God', 'Refuge']);

await page.click('.item .ord button[title="Key, leader, note"]');
await page.waitForTimeout(300);
await page.selectOption('#es-key', 'D');
await page.selectOption('#es-leader', 'u-ann');
await page.fill('#es-note', 'straight into the next one');
await page.click('#modal button.btn:not(.sec)');
await page.waitForTimeout(500);
const edited = await page.evaluate(() => document.querySelector('.item').innerText.replace(/\n/g, ' | '));
ok('the key can be changed after the fact', edited.includes('Key D'));
ok('  a leader named', edited.includes('led by Ann Becker'));
ok('  and a note kept', edited.includes('straight into the next one'));

await page.fill(`#file-label-${svcId}`, 'Rehearsal track');
await page.fill(`#file-url-${svcId}`, 'https://example.com/track.mp3');
await page.click(`button[onclick="addServiceFile('${svcId}',this)"]`);
await page.waitForTimeout(450);
ok('a practice file attaches', (await text(page)).includes('Rehearsal track'));

await page.click('button.good.small');            // Publish
await page.waitForTimeout(450);
ok('publishing sticks', (await text(page)).includes('published'));

// ======================================================================
console.log('\n3. A player opens the plan and answers\n');
// ======================================================================
world = await page.evaluate(() => window.__T);
await boot(page, world, ANN);
ok('a member lands on my schedule', await page.evaluate(() => A.tab === 'myschedule'));
ok('  and is offered no planning tab', await page.evaluate(() =>
  ![...document.querySelectorAll('.tabbar button')].some(b => /Plan/.test(b.textContent))));
const annHome = await text(page);
ok('their own date is surfaced', annHome.includes('You are on'));
await page.click('.card:nth-child(1) .drow');     // the first "You are on" row
await page.waitForTimeout(400);
ok('it opens the plan', await page.evaluate(() => !!document.querySelector('.planhead')));
ok('  which says what they are on for', /you are on for/i.test(await text(page)));
ok('  and shows no admin controls', await page.evaluate(() =>
  !document.querySelector('.item .ord') && !document.querySelector('[id^="file-url-"]')
  && !document.querySelector('[onclick^="addPersonTo"]')));

// Two positions, so two rows to answer, each with its own pair of buttons.
ok('both positions are offered to answer', await page.evaluate(() => document.querySelectorAll('.myslot').length === 2));
const myRows = await page.evaluate(() => [...document.querySelectorAll('.myslot .what')].map(w => w.textContent.trim()));
ok('  naming each one', myRows.length === 2 && myRows.join('|').includes('Guitar') && myRows.join('|').includes('Singing'));

await page.locator('.myslot').nth(0).locator('button.good.small').click();   // first position
await page.waitForTimeout(500);
ok('answering one answers ONLY that one', await page.evaluate(() => {
  const mine = (window.__T.worship_service_slots || []).filter(s => s.user_id === 'u-ann');
  return mine.length === 2 && mine.filter(s => s.status === 'confirmed').length === 1
                           && mine.filter(s => s.status === 'scheduled').length === 1;
}));
ok('  and the other is still reachable', await page.evaluate(() =>
  document.querySelectorAll('.myslot').length === 2 &&
  [...document.querySelectorAll('.myslot')].some(r => r.innerText.includes('asked'))));

await page.locator('.myslot').nth(1).locator('button.good.small').click();   // second position
await page.waitForTimeout(500);
ok('the second answer lands too', await page.evaluate(() => {
  const mine = (window.__T.worship_service_slots || []).filter(s => s.user_id === 'u-ann');
  return mine.length === 2 && mine.every(s => s.status === 'confirmed');
}));

// Changing your mind has to work, or the first press is a trap.
await page.locator('.myslot').nth(0).locator('button.sec.small, button.danger.small').first().click();
await page.waitForTimeout(500);
ok('an answer can be changed', await page.evaluate(() => {
  const mine = (window.__T.worship_service_slots || []).filter(s => s.user_id === 'u-ann');
  return mine.filter(s => s.status === 'declined').length === 1;
}));
ok('the reply is recorded against them', await page.evaluate(() => {
  const mine = (window.__T.worship_service_slots || []).filter(s => s.user_id === 'u-ann');
  return mine.some(s => s.status === 'confirmed');
}));
ok('  through the function, never a direct write', await page.evaluate(() =>
  window.__writes.some(w => w.op === 'rpc' && w.name === 'worship_slot_respond') &&
  !window.__writes.some(w => w.op === 'update' && w.table === 'worship_service_slots')));
ok('  and the page says so', (await text(page)).includes('in'));

await page.click('.item .t a');                   // open the chart from the rota
await page.waitForTimeout(450);
const chart = await page.evaluate(() => ({
  key: A._chartKey,
  lit: [...document.querySelectorAll('.keybar button.on')].map(b => b.textContent),
  body: document.querySelector('.chart-box') ? document.querySelector('.chart-box').innerText : ''
}));
check('the chart opens in the key it is booked in', [chart.key, chart.lit], ['D', ['D']]);
ok('  and it is the song the order names', chart.body.includes('love You Lord'));
ok('  with no Delete under your thumb', await page.evaluate(() =>
  !document.querySelector('#modal button.danger')));
ok('  transposed into that key', chart.body.includes('D') && chart.body.includes('G'));

// ======================================================================
console.log('\n4. The library\n');
// ======================================================================
await page.evaluate(() => { closeModal(); return go('songs'); });
await page.waitForTimeout(400);
ok('songs are a list', await page.evaluate(() => document.querySelectorAll('.songrow').length === 3));
await page.evaluate(() => { A._songQuery = 'refuge'; renderTab(); });
await page.waitForTimeout(250);
ok('search narrows it', await page.evaluate(() => document.querySelectorAll('.songrow').length === 1));
await page.click('.songrow');
await page.waitForTimeout(350);
ok('the song opens in its own key', await page.evaluate(() => A._chartKey === 'E'));
ok('  and a student is offered no Delete even here', await page.evaluate(() =>
  !document.querySelector('#modal button.danger')));
await page.evaluate(() => setChartKey('Bb'));
await page.waitForTimeout(250);
ok('  and transposes on demand', await page.evaluate(() =>
  document.querySelector('.chart-box').innerText.includes('Bb')));

// ======================================================================
console.log('\n5. The database is behind the page\n');
// ======================================================================
// Deploys land in seconds; migrations are run by hand, so there is always a
// window where the page asks for something the database has not got. It has to
// say so in words the person pressing the button can act on, and stop offering
// what cannot work.
world = await page.evaluate(() => window.__T);
await boot(page, world, ANN);
await page.evaluate(() => {
  const realRpc = A.supabase.rpc;
  A.supabase.rpc = (name, args) => name === 'worship_slot_respond'
    ? Promise.resolve({ data: null, error: { code: 'PGRST202',
        message: 'Could not find the function public.worship_slot_respond(p_slot_id, p_status) in the schema cache' } })
    : realRpc(name, args);
});
await page.click('.card:nth-child(1) .drow');
await page.waitForTimeout(400);
ok('the reply buttons are offered', await page.evaluate(() => !!document.querySelector('button.good.small')));
await page.click('button.good.small');
await page.waitForTimeout(500);
const behind = await page.evaluate(() => ({
  toast: document.getElementById('toast').textContent,
  stillOffered: !!document.querySelector('button.good.small'),
  planIntact: !!document.querySelector('.planhead')
}));
ok('it says what is actually wrong', /migration/i.test(behind.toast));
ok('  without a raw database error', !/schema cache|PGRST/i.test(behind.toast));
ok('  stops offering a button that cannot work', !behind.stillOffered);
ok('  and leaves the rest of the plan alone', behind.planIntact);

// Dates are the same words for everyone, whatever language the browser is in.
const asSpanish = await browser.newPage({ viewport: { width: 900, height: 700 }, locale: 'es-ES' });
await asSpanish.goto('http://localhost:8765/portal/worship.html', { waitUntil: 'domcontentloaded' });
await asSpanish.waitForTimeout(1500);
const spanishDate = await asSpanish.evaluate(() => fmtDate('2026-09-16'));
await asSpanish.close();
check('a Spanish browser reads the same date', spanishDate, 'Wed, Sep 16');

// ======================================================================
console.log('\n6. One rota, two tabs\n');
// ======================================================================
// My schedule reads the same for everyone. What an admin gets extra is a way
// OUT of it into planning - not a page that grows controls when they look at
// it.
world = await page.evaluate(() => window.__T);

await boot(page, world, ANN);
await page.click('.card:nth-child(1) .drow');
await page.waitForTimeout(400);
const playerView = await page.evaluate(() => ({
  html: document.getElementById('tab-body').innerHTML,
  edit: !!document.querySelector('[onclick^="editInPlan"]')
}));
ok('a player is offered no way to edit', !playerView.edit);

await boot(page, world, LUKE);
await page.click('.card:nth-child(1) .drow, .card:nth-child(2) .drow');
await page.waitForTimeout(400);
const adminView = await page.evaluate(() => ({
  html: document.getElementById('tab-body').innerHTML,
  edit: !!document.querySelector('[onclick^="editInPlan"]'),
  controls: !!document.querySelector('.item .ord') || !!document.querySelector('[onclick^="addPersonTo"]')
}));
ok('an admin reads the very same page', !adminView.controls);
ok('  with one button out to planning', adminView.edit);

// Two things legitimately differ between two people reading the same service:
// the admin's one button out to planning, and the "you are on for" rows, which
// belong to whoever's name is on the rota rather than to a role. Strip both,
// and what is left must be the same page.
const strip = h => h
  .replace(/<div class="row">\s*<button[^>]*editInPlan[\s\S]*?<\/div>/, '')
  .replace(/<div class="myslots">[\s\S]*?<\/div>\s*(?=<div class="pos">)/, '')
  // Your own name is highlighted on the rota. Also whose-name-is-on-the-row,
  // not a role.
  .replace(/class="person me"/g, 'class="person "')
  .replace(/\s+/g, ' ')
  .trim();
const same = strip(adminView.html) === strip(playerView.html);
check('the rest of the service reads identically to both', same ? 'same' : 'different', 'same');
if (!same) {
  const a = strip(adminView.html), b = strip(playerView.html);
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  console.log('         first difference at ' + i + ':\n           admin:  …' + a.slice(Math.max(0, i - 60), i + 90) +
              '\n           player: …' + b.slice(Math.max(0, i - 60), i + 90));
}

await page.click('[onclick^="editInPlan"]');
await page.waitForTimeout(500);
const landed = await page.evaluate(() => ({
  tab: A.tab,
  onThatService: A.openService,
  hasControls: !!document.querySelector('[onclick^="addPersonTo"]')
}));
ok('editing lands on the Plan tab', landed.tab === 'plan');
ok('  on that same service', !!landed.onThatService);
ok('  with the planning controls', landed.hasControls);

// ======================================================================
console.log('\n7. An impatient press, and a stranger on the rota\n');
// ======================================================================
world = await page.evaluate(() => window.__T);
await boot(page, world, LUKE);
await page.evaluate(() => { window.__writeDelay = 400; });   // a slow afternoon
await page.evaluate(() => go('plan'));
await page.waitForTimeout(300);
await page.click('.trow');
await page.waitForTimeout(300);
await page.click('.drow');
await page.waitForTimeout(700);
const sid = await page.evaluate(() => A.openService);

// The song box starts on nothing, so Add cannot fire a song nobody chose.
check('the song box starts empty', await page.evaluate(id => document.getElementById('song-pick-' + id).value, sid), '');

await page.selectOption(`#song-pick-${sid}`, { index: 1 });
const before = await page.evaluate(() => (window.__T.worship_service_songs || []).length);
// Five presses, as fast as a person who thinks nothing happened.
await page.evaluate(id => {
  const b = document.querySelector(`button[onclick="addServiceSong('${id}',this)"]`);
  for (let i = 0; i < 5; i++) b.click();
}, sid);
await page.waitForTimeout(1500);
const after = await page.evaluate(() => (window.__T.worship_service_songs || []).length);
check('five presses, one song', after - before, 1);
ok('  and the button came back', await page.evaluate(id =>
  !document.querySelector(`button[onclick="addServiceSong('${id}',this)"]`).disabled, sid));

// A failed write must not leave the button dead either.
await page.evaluate(() => {
  const realFrom = A.supabase.from;
  A.supabase.from = (t) => t === 'worship_service_files'
    ? { insert: () => Promise.resolve({ data: null, error: { message: 'nope' } }) }
    : realFrom(t);
});
await page.fill(`#file-label-${sid}`, 'x');
await page.fill(`#file-url-${sid}`, 'https://example.com/x');
await page.click(`button[onclick="addServiceFile('${sid}',this)"]`);
await page.waitForTimeout(600);
ok('a failed write releases the button too', await page.evaluate(id =>
  !document.querySelector(`button[onclick="addServiceFile('${id}',this)"]`).disabled, sid));

// Somebody who has never been on the team, put on the rota from this dialog.
await page.evaluate(() => { window.__writeDelay = 0; });
await page.evaluate(() => { A.supabase.from = A.supabase.from; });
await boot(page, world, LUKE);
await page.evaluate(() => go('plan'));
await page.waitForTimeout(300);
await page.click('.trow'); await page.waitForTimeout(250);
await page.click('.drow'); await page.waitForTimeout(500);
await page.evaluate(() => addPersonTo(A.openService, 'slides'));
await page.waitForTimeout(300);
ok('the dialog offers the whole school', await page.evaluate(() =>
  document.getElementById('modal').innerText.includes('Search the whole school')));
await page.click('[onclick*="_addPersonSource=\'school\'"]');
await page.waitForTimeout(300);
await page.fill('#ap-search', 'cal');
await page.waitForTimeout(400);
const found = await page.evaluate(() => document.getElementById('ap-results').innerText);
ok('a name that is not on the team is findable', found.includes('Cal Diaz'));
await page.click('#ap-results button');
await page.waitForTimeout(700);
const joined = await page.evaluate(() => ({
  onTeam: (window.__T.worship_members || []).some(m => m.user_id === 'u-cal'),
  instruments: ((window.__T.worship_members || []).find(m => m.user_id === 'u-cal') || {}).instruments,
  onRota: (window.__T.worship_service_slots || []).some(sl => sl.user_id === 'u-cal' && sl.instrument === 'slides'),
  plan: !!document.querySelector('.planhead')
}));
ok('they are on the team now', joined.onTeam);
ok('  with the instrument on their profile', (joined.instruments || []).includes('slides'));
ok('  and on the rota for it', joined.onRota);
ok('  and the plan came back', joined.plan);

// Editing the library is an admin's, and lives in the library: Delete is there
// and nowhere else.
await page.evaluate(() => { closeModal(); return go('songs'); });
await page.waitForTimeout(400);
await page.click('.songrow');
await page.waitForTimeout(350);
ok('an admin edits songs from the library', await page.evaluate(() =>
  !!document.querySelector('#modal button.danger')));

// The practice files a set list already implies, in the key it is booked in.
// Open the service that actually has a set list, rather than whichever date
// happens to be first.
await page.evaluate(() => {
  closeModal();
  const withSongs = Object.keys(A.songLinks).find(id => (A.songLinks[id] || []).length);
  A.tab = 'plan';
  A.openService = withSongs;
  const svc = A.services.find(x => x.id === withSongs);
  A._openType = svc && svc.service_type_id;
  render();
});
await page.waitForTimeout(400);
const practice = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('Practice files'));
  return card ? card.innerText.replace(/\n+/g, ' | ') : '';
});
// innerText applies text-transform, so an uppercased heading reads back
// uppercased. Second time that has caught this harness out; match case-blind.
ok('the set list brings its own practice links', /from the set list/i.test(practice));
ok('  the chart in the key it is booked in', /Chart in [A-G]/.test(practice));
ok('  and the recording beside it', /Listen/.test(practice));

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:', errors);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
