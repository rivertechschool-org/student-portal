// Staff can see their duties.
//
// The rota, the "My duties" tab and a backend gated on is_teacher_or_admin()
// were all already built. The single caller of showSection('staff-duties') in
// the whole file sat inside renderAdminDashboard() -- so a tab written for
// teachers could only be opened by somebody who is not one, while six people
// sat on the rota unable to see it.
//
// Two things are held here, and they are different in kind:
//
//   1. A WAY IN exists from the staff dashboard, and does not depend on being
//      an admin.
//   2. TODAY'S duty is on the dashboard itself. The rota screen answers "what
//      am I on this week", which is the wrong question at 8am. This answers
//      the one actually being asked, on the page already open.
//
// And one thing it must NOT do: say anything on a day with no duty. An empty
// "no duties today" card every morning is how people learn to stop reading a
// card, and then miss the morning it matters.
//
// Run: node tests/staff-duties-visible.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// These live at 4 spaces, unlike the pickup/drill methods at 6.
function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', closeParen);
  let depth = 0; const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const Ctor = Object.getPrototypeOf(async function () {}).constructor;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One row per (duty x position x assignment), which is how the RPC returns it.
// Invented staff and duties.
const ROTA = [
  { duty_id: 'd1', duty_name: 'Gate', group_id: null, group_name: null,
    block_key: null, starts_at: '12:30:00', ends_at: '13:00:00', notes: null, duty_sort: 1,
    position_id: 'p1', position_name: 'Front gate', position_sort: 1,
    day_of_week: 1, user_id: 'me', full_name: 'A Teacher' },
  { duty_id: 'd1', duty_name: 'Gate', group_id: null, group_name: null,
    block_key: null, starts_at: '12:30:00', ends_at: '13:00:00', notes: null, duty_sort: 1,
    position_id: 'p1', position_name: 'Front gate', position_sort: 1,
    day_of_week: 1, user_id: 'other', full_name: 'B Teacher' },
  { duty_id: 'd2', duty_name: 'Lunch', group_id: 'g1', group_name: 'Full Young Middle',
    block_key: 'LUNCH', starts_at: null, ends_at: null, notes: null, duty_sort: 2,
    position_id: 'p2', position_name: 'Hall', position_sort: 1,
    day_of_week: 3, user_id: 'me', full_name: 'A Teacher' },
];

function makeApp({ rota = ROTA, rotaError = null, throws = false } = {}) {
  const app = {
    calls: [],
    userInfo: { profile: { id: 'me', user_type: 'teacher' }, user: { id: 'me' } },
    escapeHtml: esc,
    _bellRows: [
      { block_key: 'LUNCH', label: 'Lunch', day_of_week: null, starts_at: '12:00:00', ends_at: '12:40:00' },
    ],
    async supabaseQuery(fn) { return fn(); },
    auth: { supabase: { rpc(fn) {
      app.calls.push(fn);
      if (throws) return Promise.reject(new Error('Query timeout'));
      return Promise.resolve({ data: rota, error: rotaError });
    } } },
    async loadBellRows() { app.bellsAsked = true; return app._bellRows; },
  };
  app.card = { innerHTML: 'SENTINEL' };
  global.document = { getElementById: (id) => id === 'today-duty-card' ? app.card : null };
  for (const m of ['_dutyDays', '_dutyTree', '_myDuties', '_dutyWhen',
                   '_loadTodaysDuties', '_renderTodaysDutyCard']) {
    app[m] = extract(m);
  }
  return app;
}

(async () => {

  console.log('\n== there is a way in that does not require being an admin ==\n');

  {
    // The bug: the only caller lived inside renderAdminDashboard().
    const callers = (html.match(/app\.showSection\('staff-duties'\)/g) || []).length;
    ok('more than one way to reach the duty screen', callers > 1);
    ok('  one of them sits beside the other staff actions',
       /Emergency drill[\s\S]{0,400}showSection\('staff-duties'\)[\s\S]{0,120}Staff Duties/.test(html));
  }

  console.log('\n== today\'s duty is on the dashboard ==\n');

  {
    // _dutyWhen holds the clock logic; check it on its own, because extract()
    // in this file builds every method async and the card's template cannot
    // await. Stubbed below so the CARD's wiring is what gets asserted.
    const t = makeApp();
    check('a timed duty reads as a range',
          await t._dutyWhen.call(t, { starts_at: '12:30:00', ends_at: '13:00:00' }),
          '12:30 pm–1:00 pm');
    check('a bell-pinned duty borrows the bell',
          await t._dutyWhen.call(t, { block_key: 'LUNCH' }),
          'Lunch · 12:00 pm–12:40 pm');
    check('neither one is blank, not broken',
          await t._dutyWhen.call(t, { }), '');
  }

  {
    const app = makeApp();
    app._dutyWhen = (d) => d.block_key === 'LUNCH' ? 'Lunch · 12:00 pm–12:40 pm' : '12:30 pm–1:00 pm';
    // Monday: the gate duty, with the other adult named.
    const mine = await app._myDuties.call(app, await app._dutyTree.call(app, ROTA), 'me');
    const mon = mine.filter(m => m.dow === 1);
    await app._renderTodaysDutyCard.call(app, mon);
    const out = app.card.innerHTML;
    ok('the card says they are on today', /on duty today/i.test(out));
    ok('  names the duty', /Gate/.test(out));
    ok('  and the position', /Front gate/.test(out));
    ok('  with the time', /12:30/.test(out));
    ok('  and who they are on with', /B Teacher/.test(out));
    ok('  and does not name them to themselves', !/A Teacher/.test(out));
    ok('  and leads to the full rota', /showSection\('staff-duties'\)/.test(out));
  }

  {
    // A duty pinned to a bell block shows the block's time, not the raw key.
    const app = makeApp();
    app._dutyWhen = (d) => d.block_key === 'LUNCH' ? 'Lunch · 12:00 pm–12:40 pm' : '';
    const mine = await app._myDuties.call(app, await app._dutyTree.call(app, ROTA), 'me');
    const wed = mine.filter(m => m.dow === 3);
    await app._renderTodaysDutyCard.call(app, wed);
    const out = app.card.innerHTML;
    ok('a bell-pinned duty shows the bell time', /12:00/.test(out));
    ok('  and its label, not the raw block key', !/LUNCH/.test(out));
    ok('  with the cohort it belongs to', /Full Young Middle/.test(out));
  }

  {
    // THE one it must not do.
    const app = makeApp();
    await app._renderTodaysDutyCard.call(app, []);
    check('a day with no duty says nothing at all', app.card.innerHTML, '');
  }

  console.log('\n== loading it never costs the dashboard ==\n');

  {
    const app = makeApp({ throws: true });
    await app._loadTodaysDuties.call(app);
    check('a thrown load leaves the page alone', app.card.innerHTML, 'SENTINEL');
  }

  {
    const app = makeApp({ rotaError: { message: 'nope' } });
    await app._loadTodaysDuties.call(app);
    check('an errored rota leaves the page alone', app.card.innerHTML, 'SENTINEL');
  }

  {
    const app = makeApp();
    await app._loadTodaysDuties.call(app);
    check('it asks the rota RPC', app.calls, ['staff_duty_rota']);
    ok('  and the bell schedule, for block-pinned duties', app.bellsAsked);
  }

  {
    // Only my own duties, never the whole rota.
    const app = makeApp();
    const mine = await app._myDuties.call(app, await app._dutyTree.call(app, ROTA), 'other');
    check('somebody else sees only their own', mine.map(m => m.dow), [1]);
  }

  console.log('\n== the wiring ==\n');

  ok('the dashboard has somewhere to put it', /id="today-duty-card"/.test(html));
  ok('  and asks for it without blocking the render',
     /this\._loadTodaysDuties\(\);[\s\S]{0,200}const html = `/.test(html));
  ok('the weekday convention is written down', /1=Monday\.\.5=Friday/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
