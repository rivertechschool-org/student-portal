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
          window.__writes.push({ op: 'insert', table: st.tb, row });
          (T[st.tb] = T[st.tb] || []).push({ ...(DEFAULTS[st.tb] || {}), ...row, id });
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }),
            then: (r) => Promise.resolve({ data: null, error: null }).then(r)
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
    A.me = me;
    A.member = null; A.myRequest = null; A.isAdmin = false;
    A.loaded = { songs: false, schedule: false, requests: false };
    A.openService = null; A._openType = null; A._songQuery = ''; A._dirQuery = '';
    await loadCore();
    if (!A.member && !A.isAdmin) A.tab = 'team'; else A.tab = 'schedule';
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
];
const SEED = () => ({
  __people: PEOPLE,
  worship_members: [
    { id: 'm1', user_id: 'u-luke', instruments: ['piano'], is_worship_admin: true },
    { id: 'm2', user_id: 'u-ann',  instruments: ['guitar', 'singing'], is_worship_admin: false },
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
ok('the page opens on the schedule', await page.evaluate(() => A.tab === 'schedule'));
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
const team = await text(page);
ok('both are on the rota', team.includes('Luke Hegelund') && team.includes('Ann Becker'));
ok('  the leader is starred', team.includes('★ Luke Hegelund'));
ok('  and neither has answered yet', await page.evaluate(() =>
  [...document.querySelectorAll('.person')].every(p => p.innerText.includes('asked'))));

await page.selectOption(`#song-pick-${svcId}`, 's1');
await page.selectOption(`#song-key-${svcId}`, 'Ab');
await page.click(`button[onclick="addServiceSong('${svcId}')"]`);
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
await page.click(`button[onclick="addServiceFile('${svcId}')"]`);
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
ok('a member lands on the schedule', await page.evaluate(() => A.tab === 'schedule'));
const annHome = await text(page);
ok('their own date is surfaced', annHome.includes('You are on'));
await page.click('.card:nth-child(2) .drow');     // the "You are on" row
await page.waitForTimeout(400);
ok('it opens the plan', await page.evaluate(() => !!document.querySelector('.planhead')));
ok('  which says what they are on for', (await text(page)).includes('You are on for'));
ok('  and shows no admin controls', await page.evaluate(() =>
  !document.querySelector('.item .ord') && !document.querySelector('[id^="file-url-"]')));

await page.click('button.good.small');            // I'll be there
await page.waitForTimeout(500);
ok('the reply is recorded against them', await page.evaluate(() => {
  const mine = (window.__T.worship_service_slots || []).find(s => s.user_id === 'u-ann');
  return mine && mine.status === 'confirmed';
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
await page.evaluate(() => setChartKey('Bb'));
await page.waitForTimeout(250);
ok('  and transposes on demand', await page.evaluate(() =>
  document.querySelector('.chart-box').innerText.includes('Bb')));

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:', errors);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
