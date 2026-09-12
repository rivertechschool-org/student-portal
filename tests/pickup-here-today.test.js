// Pickup, starting from who actually turned up.
//
// The board was search-only: type a family number, tick them off. Right when a
// car is at the kerb; wrong for "have we got everybody?", which had no list to
// answer it from.
//
// Three things this holds:
//
//   * THE LIST COMES FROM THE REGISTER, not the timetable. The timetable says
//     who was expected; at pickup the difference between expected and actually
//     here is the entire question.
//   * A TICK IS IMMEDIATE, AND REVERSIBLE IF IT FAILS. The queue does not pause
//     while the network does, so the row paints at once — and goes back if the
//     write is refused, because a child shown as collected who is still in the
//     building is the failure that matters.
//   * ONE ACTION, BOTH PLACES. It calls the same rt_set_dismissed the Dismissal
//     tab calls, so a child cannot be ticked in one tab and not the other.
//
// Run: node tests/pickup-here-today.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function extract(name) {
  const re = new RegExp('\\n      (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', i);
  let depth = 0;
  const start = i;
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

const HERE = [
  { student_id: 's1', first_name: 'Allie', last_name: 'T', grade_level: '7', status: 'present', family_number: 12, dismissed: false, picked_up_at: null },
  { student_id: 's2', first_name: 'Noah', last_name: 'W', grade_level: '8', status: 'late', family_number: 4, dismissed: false, picked_up_at: null },
  { student_id: 's3', first_name: 'Kaitlyn', last_name: 'E', grade_level: '9', status: 'present', family_number: null, dismissed: true, picked_up_at: '2026-09-11T22:05:00Z' },
];

function makeApp({ rpcFails = false } = {}) {
  const app = {
    calls: [],
    notices: [],
    host: { innerHTML: '' },
    _pickupHere: JSON.parse(JSON.stringify(HERE)),
    escapeHtml: (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    jsAttr: (t) => String(t == null ? '' : t).replace(/'/g, "\\'"),
    showNotification(m, k) { this.notices.push(`${k}:${m}`); },
    async _pickupRpc(fn, args) {
      this.calls.push({ fn, args });
      if (rpcFails) throw new Error('network');
      return fn === 'rt_pickup_here_today' ? JSON.parse(JSON.stringify(HERE)) : { success: true };
    },
  };
  global.document = { getElementById: (id) => (id === 'pickup-here' ? app.host : null) };
  app._renderPickupHere = extract('_renderPickupHere');
  app.loadPickupHereToday = extract('loadPickupHereToday');
  app.setPickedUp = extract('setPickedUp');
  return app;
}

(async () => {
  console.log('\n== the list ==\n');

  {
    const app = makeApp();
    await app.loadPickupHereToday.call(app);
    check('it asks the register, not the timetable', app.calls[0].fn, 'rt_pickup_here_today');

    const out = app.host.innerHTML;
    ok('everyone on the register is listed', /Allie/.test(out) && /Noah/.test(out) && /Kaitlyn/.test(out));
    ok('the counts are stated', /2 still here/.test(out) && /1 picked up/.test(out) && /3 on the register/.test(out));
    ok('a family number is shown where there is one', /#12/.test(out) && /#4/.test(out));
    ok('arriving late is flagged', />\s*late\s*</.test(out));
    ok('the ones still here are offered a Picked up button',
      (out.match(/Picked up<\/button>/g) || []).length === 2);
    ok('  and the one already collected is offered an undo',
      (out.match(/Undo<\/button>/g) || []).length === 1);
    ok('a collected child shows the time', /picked up/i.test(out));
    // Still-here first: the list exists to answer "who is left".
    ok('those still here are listed first',
      out.indexOf('Allie') < out.indexOf('Kaitlyn') && out.indexOf('Noah') < out.indexOf('Kaitlyn'));
  }

  {
    const app = makeApp();
    app._pickupHere = [];
    app._renderPickupHere.call(app);
    ok('an empty register says so, and why', /Nobody on the register yet/.test(app.host.innerHTML));
    ok('  and points at taking the register', /Take the register/.test(app.host.innerHTML));
  }

  console.log('\n== ticking one off ==\n');

  {
    const app = makeApp();
    await app.setPickedUp.call(app, 's1', true);
    check('it goes through the shared dismissal action', app.calls[0].fn, 'rt_set_dismissed');
    check('  for that student', app.calls[0].args, { p_student_ids: ['s1'], p_dismissed: true });
    const rec = app._pickupHere.find(r => r.student_id === 's1');
    check('  and the row is marked collected', rec.dismissed, true);
    ok('  with a time on it', !!rec.picked_up_at);
    ok('  repainted immediately', /Undo<\/button>/.test(app.host.innerHTML));
    check('  and nothing was reported as an error', app.notices, []);
  }

  {
    const app = makeApp();
    await app.setPickedUp.call(app, 's3', false);
    check('undo sends the opposite', app.calls[0].args.p_dismissed, false);
    const rec = app._pickupHere.find(r => r.student_id === 's3');
    check('  the row goes back to waiting', rec.dismissed, false);
    check('  and the time is cleared', rec.picked_up_at, null);
  }

  console.log('\n== when the write is refused ==\n');

  {
    // A child shown as collected who is still in the building is the failure
    // that matters, so an optimistic paint has to be taken back.
    const app = makeApp({ rpcFails: true });
    await app.setPickedUp.call(app, 's1', true);
    const rec = app._pickupHere.find(r => r.student_id === 's1');
    check('the row goes back to waiting', rec.dismissed, false);
    check('  with no departure time left on it', rec.picked_up_at, null);
    ok('  the screen shows them still here', /Picked up<\/button>/.test(app.host.innerHTML));
    ok('  and it says the save failed', app.notices.some(n => /^error:/.test(n)));
  }

  console.log('\n== how it opens ==\n');

  const board = html.slice(html.indexOf('      async showPickupBoard()'), html.indexOf('      renderPickupModal('));
  ok('the board opens on the register', /renderPickupModal\('here'\)/.test(board));
  ok('the tab exists', /tabBtn\('here', 'Here today'\)/.test(html));
  ok('  and loads when selected', /if \(tab === 'here'\) this\.loadPickupHereToday\(\);/.test(html));
  ok('the search tab is still there', /tabBtn\('dismiss', 'Dismissal'\)/.test(html));

  console.log('\n== and the rule the function has to keep ==\n');

  const sqlPath = path.join(__dirname, '..', '..', 'student-portal-backend', 'supabase', 'migrations',
    'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_pickup_from_todays_register.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const body = sql.replace(/^\s*--.*$/gm, '');
    ok('only present and late are listed', /status IN \('present', 'late'\)/.test(body));
    check('  the left_early statuses are not', /left_early'\)/.test(body), false);
    ok('the stamp lands on the attendance row', /UPDATE public\.daily_attendance\s*\n\s*SET picked_up_at = now\(\)/.test(body));
    ok('  only when it is not already set', /AND picked_up_at IS NULL/.test(body));
    ok('undo clears it', /SET picked_up_at = NULL/.test(body));
    ok('the board record is still written too', /INSERT INTO public\.pickup_dismissals/.test(body));
  } else {
    console.log('skip  the backend repo is not checked out beside this one');
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
