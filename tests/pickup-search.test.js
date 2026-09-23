// Pickup search: filtering as it is typed, over the people who are here.
//
// Two screens, two different mechanisms, and the difference is the point.
//
// THE DISMISSAL SEARCH asks the server. A family number is not something the
// client is holding, so every search is a round trip. Filtering as typed
// therefore means SCHEDULING a lookup, not making one -- which brings two
// problems the attendance roster never has to think about: a lookup per
// keystroke would be brutal on a database that stalls for seconds, and
// answers can come back OUT OF ORDER, so a slow reply for "12" can land after
// a fast one for "127" and put the wrong family on screen under the right
// number.
//
// THE HERE-TODAY LIST is already loaded, so it filters in memory exactly like
// the attendance roster. It is scoped to today's register by the server
// (present or late only), and the filter narrows that -- it must never widen
// it back out to the whole school.
//
// AND THE ONE THAT IS NOT A UI DECISION: a family card must never come back
// empty. Showing only the children who are in today is right at the gate, but
// the register may not have been taken, it may be wrong, and a child can be
// in the building without a row in it. A card with nobody on it, with a
// parent waiting, is worse than one extra name.
//
// Run: node tests/pickup-search.test.js

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

function methodSource(name) {
  const re = new RegExp(`\\n {6}(?:async )?${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(name + ' not found');
  let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(m.index, i);
}
function lift(name) {
  const src = methodSource(name);
  const isAsync = /^\s*async\b/.test(src);
  const body = src.replace(/^\s*(async\s+)?[A-Za-z_$][\w$]*\s*\(/, (isAsync ? 'async function f(' : 'function f('));
  return new Function('return ' + body)();
}

const esc = (t) => String(t == null ? '' : t)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- invented people, invented numbers -----------------------------------
const member = (first, last, over = {}) => ({
  student_id: 'stu-' + first.toLowerCase(), first_name: first, last_name: last,
  grade_level: 5, dismissed: false, dismissed_at: null,
  in_today: true, attendance_status: 'present', notes: [], pickup_list: [], ...over,
});

function makeApp(over = {}) {
  const app = {
    rpcs: [], notices: [], _pickupShowAway: {}, _pickupHereFilter: '',
    userInfo: { profile: { user_type: 'admin' }, user: { id: 'a1' } },
    escapeHtml: esc,
    jsAttr: (v) => String(v == null ? '' : v).replace(/'/g, '&#39;'),
    _formatDateOnly: (d) => String(d),
    showNotification(m, k) { app.notices.push(`${k}:${m}`); },
    _refreshPickupResults() { app.refreshed = (app.refreshed || 0) + 1; },
    _refreshPickupHereList() { app.hereRefreshed = (app.hereRefreshed || 0) + 1; },
    async _pickupRpc(fn, args) { app.rpcs.push({ fn, args }); return []; },
    ...over,
  };
  app.pickupSearchTyping = lift('pickupSearchTyping');
  app.pickupSearch = lift('pickupSearch');
  app.showPickupAway = lift('showPickupAway');
  app._renderPickupResults = lift('_renderPickupResults');
  return app;
}

const withInput = (value) => {
  global.document = { getElementById: (id) => (id === 'pickup-search' || id === 'pickup-here-search')
    ? { value } : null };
};
const tick = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {

  console.log('\n== typing schedules a lookup, it does not make one ==\n');

  {
    const app = makeApp();
    withInput('1');
    app.pickupSearchTyping.call(app);
    check('one keystroke asks the server nothing yet', app.rpcs.length, 0);
    ok('  but it says it is searching', app._pickupSearching === true);
    await tick(400);
    check('  and the lookup follows', app.rpcs.length, 1);
  }

  {
    // Four digits typed quickly is ONE lookup. On a database that stalls for
    // seconds, four would be four chances to stall.
    const app = makeApp();
    for (const v of ['1', '12', '127', '1274']) { withInput(v); app.pickupSearchTyping.call(app); }
    check('four fast keystrokes queue one lookup', app.rpcs.length, 0);
    await tick(400);
    check('  and only the last one runs', app.rpcs.length, 1);
    check('  with what was actually typed', app.rpcs[0].args.p_query, '1274');
  }

  {
    const app = makeApp();
    withInput('127');
    app.pickupSearchTyping.call(app);
    withInput('');
    app.pickupSearchTyping.call(app);
    await tick(400);
    check('clearing the box cancels the pending lookup', app.rpcs.length, 0);
    check('  and empties the results at once', app._pickupResults, []);
    ok('  and stops claiming to search', app._pickupSearching === false);
  }

  console.log('\n== a slow answer cannot overwrite a newer one ==\n');

  {
    // "12" is slow, "127" is fast. The reply for "12" lands last. Without a
    // sequence guard it wins, and the screen shows family 12 with 127 typed
    // above it -- which at a pickup gate is the wrong children.
    const app = makeApp();
    const replies = { '12': { delay: 60, rows: [{ family_number: 12 }] },
                      '127': { delay: 5, rows: [{ family_number: 127 }] } };
    app._pickupRpc = async (fn, args) => {
      const r = replies[args.p_query];
      await tick(r.delay);
      return r.rows;
    };
    withInput('12');
    const slow = app.pickupSearch.call(app);
    withInput('127');
    const fast = app.pickupSearch.call(app);
    await Promise.all([slow, fast]);
    check('the newest query owns the results', app._pickupResults, [{ family_number: 127 }]);
  }

  {
    // The same guard has to hold for a FAILURE, or a stale error wipes good
    // results off the screen.
    const app = makeApp();
    app._pickupRpc = async (fn, args) => {
      if (args.p_query === '12') { await tick(60); throw new Error('timeout'); }
      await tick(5); return [{ family_number: 127 }];
    };
    withInput('12');
    const slow = app.pickupSearch.call(app);
    withInput('127');
    const fast = app.pickupSearch.call(app);
    await Promise.all([slow, fast]);
    check('a stale failure does not clear newer results', app._pickupResults, [{ family_number: 127 }]);
    check('  and does not shout about it', app.notices, []);
  }

  console.log('\n== the search is about who is here ==\n');

  const fam = (members, over = {}) => ({
    id: 'fam-1', family_number: 127, label: null, note: null, members, ...over });

  {
    const app = makeApp();
    app._pickupSearch = '127';
    app._pickupResults = [fam([
      member('Marisol', 'Vance'),
      member('Teodor', 'Vance', { in_today: false, attendance_status: 'absent' }),
    ])];
    const out = app._renderPickupResults.call(app);
    ok('the child who is in today is shown', /Marisol/.test(out));
    ok('  the one who is not is left out', !/Teodor/.test(out));
    ok('  and the screen says so, with a way back', /1 not in today/.test(out));
  }

  {
    // Expanded: both, and the absent one is marked rather than silently mixed in.
    const app = makeApp();
    app._pickupSearch = '127';
    app._pickupResults = [fam([
      member('Marisol', 'Vance'),
      member('Teodor', 'Vance', { in_today: false }),
    ])];
    app.showPickupAway.call(app, 'fam-1');
    const out = app._renderPickupResults.call(app);
    ok('showing them brings the rest back', /Teodor/.test(out));
    ok('  and marks them', /not in today/.test(out));
    ok('  and stops offering the button', !/not in today — show/.test(out));
  }

  {
    // THE ONE THAT MATTERS. Register not taken, or wrong: nobody is marked in.
    // Hiding everybody would leave an adult at the gate with an empty card and
    // no way to release a child standing in front of them.
    const app = makeApp();
    app._pickupSearch = '127';
    app._pickupResults = [fam([
      member('Marisol', 'Vance', { in_today: false }),
      member('Teodor', 'Vance', { in_today: false }),
    ])];
    const out = app._renderPickupResults.call(app);
    ok('nobody in today shows everyone', /Marisol/.test(out) && /Teodor/.test(out));
    ok('  and explains why', /Nobody on this family is on today's register/.test(out));
    ok('  without offering a button that would do nothing', !/not in today — show/.test(out));
  }

  {
    const app = makeApp();
    app._pickupSearch = '127';
    app._pickupResults = [fam([member('Marisol', 'Vance'), member('Teodor', 'Vance')])];
    const out = app._renderPickupResults.call(app);
    ok('a family all present says nothing extra', !/not in today/.test(out));
  }

  {
    const app = makeApp();
    app._pickupSearch = '127';
    app._pickupResults = [fam([])];
    const out = app._renderPickupResults.call(app);
    ok('a family with no students still says so', /No students on this number yet/.test(out));
  }

  console.log('\n== mid-flight is not "no match" ==\n');

  {
    const app = makeApp();
    app._pickupSearch = '127';
    app._pickupResults = [];
    app._pickupSearching = true;
    ok('a search in flight says it is searching', /Searching/.test(app._renderPickupResults.call(app)));
    app._pickupSearching = false;
    ok('  and only then says no match', /No match/.test(app._renderPickupResults.call(app)));
  }

  console.log('\n== a fresh search starts from "who is here" again ==\n');

  {
    const app = makeApp();
    app._pickupShowAway = { 'fam-1': true };
    withInput('55');
    await app.pickupSearch.call(app);
    check('expanding one family does not stick to the next', app._pickupShowAway, {});
  }

  console.log('\n== the wiring ==\n');

  ok('the dismissal box filters as typed', /oninput="app\.pickupSearchTyping\(\)"/.test(html));
  ok('  and Enter still searches at once', /app\.pickupSearch\(\)/.test(html));
  ok('  and the Find button is gone', !/>Find<\/button>/.test(html));
  ok('here-today has a box of its own', /id="pickup-here-search"/.test(html));
  ok('  filtering as typed', /oninput="app\.filterPickupHere\(\)"/.test(html));
  ok('the server reports who is in today', /'in_today'/.test(html) || /in_today/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
