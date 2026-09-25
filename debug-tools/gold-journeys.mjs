// Gold & Shop, driven the way staff actually use it.
//
// The page opens on one card: pick a student, then Withdraw Gold or Add Gold.
// Everything else (totals, interest, bank, catalogue, ledger) is folded under
// "More options". These journeys hold the seams between the card, the database
// calls it makes, and the screens folded below it that show the same numbers.
//
//   1. A teacher serves a child at the shop: type, Enter, tap an item, done.
//   2. The same teacher takes gold for something not in the catalogue, then
//      adds gold, and cannot take more than the child has.
//   3. A double tap on a slow connection pays once.
//   4. An admin opens More options and the balances there agree with the card.
//   5. Old routes ("irl-purchases", Riven's "open the store") still land on
//      the Store tab, unfolded, without changing anyone's saved preference.
//
// Run:  python3 -m http.server 8765 &   then   node debug-tools/gold-journeys.mjs
//
// The stub is deliberately dumb. The two money functions mirror the rules the
// real ones enforce (teacher-or-admin, no balance below zero, a spend is logged
// as a purchase) so the page is tested against the behaviour it relies on.
// Everything else returns whole tables. Names are invented.

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
  if (!chromium) {
    console.error('gold-journeys needs Playwright.\n  npm i -g playwright && npx playwright install chromium');
    process.exit(2);
  }
}

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the world ---------------------------------------------------------
// Two children share a first-name prefix so "lil" has to be narrowed.
const SEED = () => ({
  user_profiles: [
    { id: 'st-1', first_name: 'Lila',    last_name: 'Brennock', grade_level: 4, rtc_balance: 12, user_type: 'student' },
    { id: 'st-2', first_name: 'Lilibet', last_name: 'Oarsman',  grade_level: 6, rtc_balance: 40, user_type: 'student' },
    { id: 'st-3', first_name: 'Tomas',   last_name: 'Quill',    grade_level: 2, rtc_balance: 0,  user_type: 'student' },
  ],
  irl_store_items: [
    { id: 'it-snack', name: 'Snack',  price: 3, icon: '🍪', is_active: true, sort_order: 1 },
    { id: 'it-pen',   name: 'Gel pen', price: 5, icon: '🖊', is_active: true, sort_order: 2 },
    { id: 'it-old',   name: 'Retired', price: 1, icon: '🗑', is_active: false, sort_order: 3 },
  ],
  irl_purchases: [],
  rtc_transactions: [],
  rtc_spend_categories: [], rtc_privileges: [], rtc_cosmetics: [],
  student_groups: [], student_group_members: [],
  school_settings: [{ key: 'bank_interest_rate', value: '10' }],
});

const TEACHER = { id: 'staff-t', user_type: 'teacher' };
const ADMIN   = { id: 'staff-a', user_type: 'admin' };

async function boot(page, seed, me, { clearPref = true } = {}) {
  await page.evaluate(({ seed, me, clearPref }) => {
    if (clearPref) { try { localStorage.removeItem('rtc-more-open'); } catch (e) {} }
    const T = JSON.parse(JSON.stringify(seed));
    window.__T = T;
    window.__calls = [];
    const slow = () => new Promise(r => setTimeout(r, window.__writeDelay || 0));
    const build = (tb) => {
      const st = { eq: {}, single: false };
      const api = {
        select() { return api; }, or() { return api; }, order() { return api; },
        limit() { return api; }, in() { return api; },
        eq(c, v) { st.eq[c] = v; return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        then(r, j) {
          window.__calls.push({ op: 'select', table: tb });
          let rows = (T[tb] || []).slice();
          Object.entries(st.eq).forEach(([c, v]) => { rows = rows.filter(x => x[c] === v); });
          // Hand back copies: a real client cannot reach into the page's state.
          const out = JSON.parse(JSON.stringify(st.single ? (rows[0] || null) : rows));
          return Promise.resolve({ data: out, error: null }).then(r, j);
        }
      };
      return api;
    };
    const student = (id) => T.user_profiles.find(s => s.id === id);
    const staff = () => ['teacher', 'admin'].includes(me.user_type);
    const txn = (id, amount, type, description) => {
      const s = student(id);
      if (!s) return { success: false, error: 'User not found' };
      const next = s.rtc_balance + amount;
      if (next < 0) return { success: false, error: 'Insufficient balance' };
      s.rtc_balance = next;
      T.rtc_transactions.push({ user_id: id, amount, transaction_type: type, description, created_by: me.id });
      return { success: true, new_balance: next };
    };
    window.app.auth.supabase = {
      from: build,
      rpc: (name, args) => {
        window.__calls.push({ op: 'rpc', name, args });
        return slow().then(() => {
          if (name === 'process_rtc_transaction') {
            if (args.p_transaction_type === 'earn_manual' && !staff())
              return { data: { success: false, error: 'Only teachers/admins can award manual RTC' }, error: null };
            if (args.p_transaction_type.startsWith('earn_') && args.p_amount <= 0)
              return { data: { success: false, error: 'Earn transactions require a positive amount' }, error: null };
            return { data: txn(args.p_user_id, args.p_amount, args.p_transaction_type, args.p_description), error: null };
          }
          if (name === 'process_irl_purchase') {
            if (!staff()) return { data: { success: false, error: 'Only teachers and admins can process IRL purchases' }, error: null };
            let itemName, price;
            if (args.p_item_id) {
              const it = T.irl_store_items.find(i => i.id === args.p_item_id && i.is_active);
              if (!it) return { data: { success: false, error: 'Item not found or inactive' }, error: null };
              itemName = it.name; price = it.price;
            } else {
              if (!args.p_custom_name) return { data: { success: false, error: 'Custom item name is required' }, error: null };
              if (!(args.p_custom_price >= 1)) return { data: { success: false, error: 'Custom item price must be at least 1' }, error: null };
              itemName = args.p_custom_name; price = args.p_custom_price;
            }
            const total = price * (args.p_quantity || 1);
            const r = txn(args.p_student_id, -total, 'spend_reward', 'IRL Purchase: ' + itemName);
            if (!r.success) return { data: r, error: null };
            T.irl_purchases.push({ student_id: args.p_student_id, item_id: args.p_item_id, item_name: itemName, total_deducted: total, processed_by: me.id });
            return { data: { success: true, new_balance: r.new_balance, total_deducted: total }, error: null };
          }
          if (name === 'admin_bank_list_students') {
            return { data: { success: true, students: T.user_profiles.map(s => ({
              id: s.id, first_name: s.first_name, last_name: s.last_name, grade_level: s.grade_level,
              wallet_balance: s.rtc_balance, bank_balance: 0, student_status: 'active', has_pin: false })) }, error: null };
          }
          if (name === 'rtc_admin_list_student_privileges') return { data: { success: true, grants: [] }, error: null };
          return { data: null, error: null };
        });
      }
    };
    window.app.userInfo = { user: { id: me.id }, profile: { id: me.id, user_type: me.user_type, first_name: 'Staff' } };
    window.app._rtcCurrentTab = null;
    window.app._rtcMoreOpen = undefined;
    window.app._rtcPendingTab = null;
    document.querySelectorAll('.modal, .modal-overlay').forEach(m => m.remove());
  }, { seed, me, clearPref });
}

async function open(page, section = 'admin-rtc-management') {
  await page.evaluate((section) => {
    document.querySelectorAll('main section, section[id$="-section"]').forEach(s => s.classList.add('hidden'));
    // Signed out, the whole app wrapper is hidden (and a sign-in screen sits
    // over it). Show the one section, the way showSection would.
    document.getElementById('main-app')?.classList.remove('hidden');
    const el = document.getElementById('admin-rtc-management-section');
    el.classList.remove('hidden');
    if (section === 'irl-purchases') window.app._rtcPendingTab = 'store';
    return window.app.renderAdminRTCManagement();
  }, section);
  await page.waitForTimeout(250);
}

const cardText = (page) => page.evaluate(() => document.getElementById('rtc-quick-gold')?.innerText || '');
const rpcs = (page, name) => page.evaluate((name) => window.__calls.filter(c => c.op === 'rpc' && c.name === name), name);
const balanceOf = (page, id) => page.evaluate((id) => window.__T.user_profiles.find(s => s.id === id).rtc_balance, id);

// ---- the browser -------------------------------------------------------
const CHROME = [process.env.GOLD_JOURNEYS_CHROME, '/opt/pw-browsers/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
const { existsSync } = await import('node:fs');
const executablePath = CHROME.find(p => existsSync(p));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
// Phone-sized, because that is where this screen gets used.
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
await page.goto('http://localhost:8765/portal/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.app, null, { timeout: 15000 });
await page.waitForTimeout(800);

// ======================================================================
console.log('\n1. A teacher serves a child at the shop\n');
// ======================================================================
await boot(page, SEED(), TEACHER);
await open(page);
ok('the page is called Gold & Shop', (await page.innerText('#admin-rtc-management-section')).includes('Gold & Shop'));
ok('the Gold card asks for a student first', (await cardText(page)).includes('Student'));
check('More options is folded', await page.evaluate(() => document.getElementById('rtc-more').open), false);
check('  and nothing below was fetched for nobody', (await rpcs(page, 'admin_bank_list_students')).length, 0);
ok('  interest and totals are out of sight', !(await page.isVisible('#bank-interest-rate-input')));
check('no horizontal scroll on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

await page.fill('#qg-search', 'lil');
await page.waitForTimeout(100);
check('"lil" offers both Lilas', await page.evaluate(() =>
  [...document.querySelectorAll('[data-qg-opt]')].map(e => e.innerText.split('\n')[0].trim())), ['Lila Brennock', 'Lilibet Oarsman']);
await page.keyboard.press('ArrowDown');
await page.fill('#qg-search', 'lila');
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
ok('typing again resets the highlight, so Enter picks Lila, not row 2', (await cardText(page)).includes('Lila Brennock'));
ok('  her gold is shown', (await cardText(page)).includes('12 gold'));
ok('  with exactly two choices', await page.isVisible('#qg-take') && await page.isVisible('#qg-add'));

await page.click('#qg-take');
ok('Withdraw shows the shop items', (await cardText(page)).includes('Snack'));
ok('  but not an inactive one', !(await cardText(page)).includes('Retired'));
await page.click('text=Snack');
check('tapping Snack fills the amount', await page.inputValue('#qg-amount'), '3');
check('  and the button says what will happen', await page.innerText('#qg-go'), 'Withdraw 3 gold from Lila');
await page.click('#qg-go');
await page.waitForTimeout(200);
const buy = (await rpcs(page, 'process_irl_purchase'))[0];
check('it went through the shop function, as a catalogue item', [buy?.args.p_item_id, buy?.args.p_custom_name], ['it-snack', null]);
check('  the database took 3', await balanceOf(page, 'st-1'), 9);
check('  and it is in Purchase History', await page.evaluate(() => window.__T.irl_purchases.map(p => p.item_name)), ['Snack']);
ok('the card says it is done, with the new balance', (await cardText(page)).includes('Lila now has 9 gold'));
ok('  the balance at the top moved too', (await page.innerText('#qg-balance')).includes('9 gold'));
ok('  and the form closed, ready for the next thing', !(await page.isVisible('#qg-go')));

// ======================================================================
console.log('\n2. Something off-catalogue, then adding gold, then too much\n');
// ======================================================================
await page.click('#qg-take');
await page.click('text=Gel pen');
await page.fill('#qg-amount', '4');
await page.fill('#qg-reason', 'pencil');
check('editing a tapped item makes it custom', await page.innerText('#qg-go'), 'Withdraw 4 gold from Lila');
await page.click('#qg-go');
await page.waitForTimeout(200);
const custom = (await rpcs(page, 'process_irl_purchase'))[1];
check('  sent as a custom item named by the reason', [custom?.args.p_item_id, custom?.args.p_custom_name, custom?.args.p_custom_price], [null, 'pencil', 4]);
check('  5 left', await balanceOf(page, 'st-1'), 5);

await page.click('#qg-take');
await page.fill('#qg-amount', '6');
check('more than she has: the button will not go', await page.isDisabled('#qg-go'), true);
ok('  and says why, in words', (await cardText(page)).includes('Lila only has 5 gold'));

await page.click('#qg-add');
ok('switching to Add clears the amount', (await page.inputValue('#qg-amount')) === '');
await page.click('#qg-add >> xpath=../..//button[text()="10"]');
check('a quick amount fills in', await page.innerText('#qg-go'), 'Add 10 gold to Lila');
await page.click('#qg-go');
await page.waitForTimeout(200);
const add = (await rpcs(page, 'process_rtc_transaction'))[0];
check('Add is a manual award', [add?.args.p_transaction_type, add?.args.p_amount, add?.args.p_description], ['earn_manual', 10, 'Gold added']);
check('  15 now', await balanceOf(page, 'st-1'), 15);

await page.click('text=Change student');
ok('Change student starts clean', await page.isVisible('#qg-search') && (await page.inputValue('#qg-search')) === '');

// ======================================================================
console.log('\n3. A double tap on a slow connection pays once\n');
// ======================================================================
await boot(page, SEED(), TEACHER);
await open(page);
await page.fill('#qg-search', 'tomas');
await page.keyboard.press('Enter');
await page.click('#qg-add');
await page.fill('#qg-amount', '2');
await page.evaluate(() => { window.__writeDelay = 400; });
await page.evaluate(() => { document.getElementById('qg-go').click(); window.app._qgSubmit(); });
await page.waitForTimeout(700);
await page.evaluate(() => { window.__writeDelay = 0; });
check('one award, not two', (await rpcs(page, 'process_rtc_transaction')).length, 1);
check('  Tomas has 2', await balanceOf(page, 'st-3'), 2);

// ======================================================================
console.log('\n4. An admin opens More options\n');
// ======================================================================
await boot(page, SEED(), ADMIN);
await open(page);
await page.fill('#qg-search', 'lilibet');
await page.keyboard.press('Enter');
await page.click('#qg-add');
await page.fill('#qg-amount', '5');
await page.click('#qg-go');
await page.waitForTimeout(200);
await page.click('#rtc-more > summary');
await page.waitForTimeout(250);
ok('unfolding shows the admin tabs', await page.isVisible('#rtc-tab-balances'));
ok('  and the interest controls', await page.isVisible('#bank-interest-rate-input'));
check('the Balances table agrees with the card', await page.evaluate(() => document.getElementById('rtc-bal-st-2')?.textContent), '45');
check('the choice is remembered', await page.evaluate(() => localStorage.getItem('rtc-more-open')), '1');
ok('  the Gold card is still on top, still on Lilibet', (await cardText(page)).includes('Lilibet'));
await page.click('#rtc-tab-bank');
await page.waitForTimeout(250);
check('the bank tab shows the same wallet', await page.evaluate(() => document.getElementById('bh-wallet-st-2')?.textContent), '45');

// Reopening the section with the remembered choice.
await boot(page, SEED(), ADMIN, { clearPref: false });
await open(page);
check('next visit opens unfolded', await page.evaluate(() => document.getElementById('rtc-more').open), true);
ok('  with the tab content loaded', await page.isVisible('#rtc-tab-balances'));

// ======================================================================
console.log('\n5. Old routes still land on the shop\n');
// ======================================================================
await boot(page, SEED(), TEACHER);
await open(page, 'irl-purchases');
check('irl-purchases unfolds More options', await page.evaluate(() => document.getElementById('rtc-more').open), true);
ok('  on the Store tab', await page.evaluate(() => !!document.getElementById('irl-tab-new-purchase')));
await page.waitForTimeout(300);
check('  without saving that as a preference', await page.evaluate(() => localStorage.getItem('rtc-more-open')), null);
ok('  and a teacher still gets no admin tabs', !(await page.isVisible('#rtc-tab-balances')));

// ----------------------------------------------------------------------
check('no page errors', errors, []);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
