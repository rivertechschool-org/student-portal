// The emergency drill roll call.
//
// This screen has one job: say how many children are not accounted for. Every
// rule below exists because the wrong answer means somebody stops looking.
//
// THE DENOMINATOR IS THE WHOLE PROBLEM. "Everyone marked present today" is the
// obvious answer and it is dangerous on its own: a cohort whose register was
// not taken has no attendance row at all, so those children would simply not
// appear, and an empty screen reads as "all clear". Checked against the live
// database while building this, at the time of day a drill would actually
// happen, the board was in=0 unknown=139 -- the naive version would have shown
// nobody and declared the school safe. So there are three buckets, and
// "unknown" never folds into the safe total.
//
// A TICK THAT DID NOT SAVE MUST NOT LOOK LIKE ONE. Ticks paint immediately,
// because the drill does not pause while the network does - and the database
// this runs on stalls for seconds at a time. But a refused write puts the row
// back and says so, loudly, by name.
//
// A REFRESH MUST NOT EAT A TICK. Several staff tick the same list, so the
// board reloads every few seconds. A reload landing mid-write must not drop
// your tick off the screen: the teacher would either tick again or, worse,
// assume it took.
//
// Run: node tests/emergency-drill.test.js

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
  i = html.indexOf('{', closeParen);
  let depth = 0; const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  // Everything is lifted async: half of these are, and a caller that awaits a
  // plain value is harmless while the reverse is a silent pending promise.
  const Ctor = Object.getPrototypeOf(async function () {}).constructor;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Invented children. Three buckets, which is the point.
const BOARD = () => ({
  drill: { id: 'd1', kind: 'fire', started_at: '2026-09-24T15:00:00Z', started_by: 'A Admin' },
  today: '2026-09-24',
  students: [
    { student_id: 's1', first_name: 'Marisol', last_name: 'Vance', grade_level: 4,
      bucket: 'in', register: 'present', group_name: 'Full Young Middle', state: null },
    { student_id: 's2', first_name: 'Teodor', last_name: 'Ilic', grade_level: 6,
      bucket: 'in', register: 'late', group_name: 'Full Young Middle', state: null },
    { student_id: 's3', first_name: 'Winnow', last_name: 'Ash', grade_level: 2,
      bucket: 'unknown', register: null, group_name: 'Full Old Elementary', state: null },
    { student_id: 's4', first_name: 'Bram', last_name: 'Oyelaran', grade_level: 9,
      bucket: 'out', register: 'absent', group_name: 'Full High', state: null },
  ],
});

function makeApp({ role = 'teacher', rpc = null } = {}) {
  const app = {
    calls: [], notices: [], modals: [], _drillPending: new Set(),
    _drillFilter: 'todo', _drillSearch: '',
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    escapeHtml: esc,
    jsAttr: (t) => String(t == null ? '' : t).replace(/'/g, '&#39;'),
    showNotification(m, k) { app.notices.push(`${k}:${m}`); },
    showModal(id, title, body) { app.modals.push({ id, title, body }); app.body = body; },
    closeModal(id) { app.closed = id; },
    async _pickupRpc(fn, args) {
      app.calls.push({ fn, args });
      if (rpc) return rpc(fn, args);
      return { success: true };
    },
    _startDrillPoll() { app.polling = true; },
    _stopDrillPoll() { app.polling = false; },
  };
  app.list = { innerHTML: '' };
  app.searchBox = { value: '' };
  app.endPanel = { innerHTML: '' };
  app.bar = null;
  app.modalOpen = true;
  global.document = {
    getElementById: (id) =>
        id === 'drill-list'       ? app.list
      : id === 'drill-search'     ? app.searchBox
      : id === 'drill-end-panel'  ? app.endPanel
      : id === 'drill-bar'        ? app.bar
      : id === 'modal-drill'      ? (app.modalOpen ? {} : null) : null,
    createElement: () => ({ style: {}, remove() { app.bar = null; } }),
    body: { appendChild: (el) => { app.bar = el; } },
  };
  for (const m of ['renderDrillModal', '_renderDrillList', 'drillAccount', '_mergeDrill',
                   'setDrillFilter', 'filterDrill', 'closeDrill', 'endDrill', 'startDrill',
                   '_drillElapsed', '_checkDrillActive', '_renderDrillBar', 'leaveDrillView',
                   'confirmEndDrill', '_startDrillClock', '_startDrillWatch']) {
    app[m] = extract(m);
  }
  app.showDrillBoard = async () => { app.opened = (app.opened || 0) + 1; app.modalOpen = true; };
  app._startDrillPoll = () => { app.polling = true; };
  app._stopDrillPoll  = () => { app.polling = false; };
  app._drill = BOARD();
  return app;
}

const seen = (app) => `${app.body || ''} ${app.list.innerHTML || ''}`;

(async () => {

  console.log('\n== the number that matters ==\n');

  {
    const app = makeApp();
    await app.renderDrillModal.call(app);
    const out = app.body;
    ok('unaccounted is counted from the register, not from everyone', /unaccounted for/.test(out));
    // 2 'in' students, neither ticked.
    ok('  and it is 2', />\s*2\s*</.test(out));
    ok('the unknown child is counted separately', /unknown — no register/.test(out));
    ok('  and never folded into the safe total', !/>\s*3\s*<[\s\S]{0,80}unaccounted/.test(out));
    ok('  with a line saying what unknown means',
       /due in today with no register entry/.test(out));
    ok('the child the register marks absent is not demanded of anybody',
       !/Bram/.test(seen(app)));
  }

  {
    // THE case this screen exists for: registers not taken, so nobody is
    // "present". The naive board shows an empty list and reads as all-clear.
    const app = makeApp();
    app._drill.students = app._drill.students.map(s =>
      s.bucket === 'in' ? { ...s, bucket: 'unknown', register: null } : s);
    await app.renderDrillModal.call(app);
    ok('no registers taken still shows every child', /Marisol/.test(seen(app)) && /Teodor/.test(seen(app)));
    ok('  and says nobody knows where they are', /no register entry/.test(app.body));
    ok('  and does NOT report everyone accounted for', !/Everyone is accounted for/.test(seen(app)));
  }

  console.log('\n== ticking ==\n');

  {
    const app = makeApp();
    await app.renderDrillModal.call(app);
    await app.drillAccount.call(app, 's1', 'safe');
    check('it writes through the drill RPC', app.calls.map(c => c.fn), ['rt_drill_account']);
    check('  for that child', app.calls[0].args.p_student_ids, ['s1']);
    check('  as safe', app.calls[0].args.p_state, 'safe');
    check('  and the row is marked', app._drill.students[0].state, 'safe');
    ok('the count drops', />\s*1\s*</.test(app.body));
  }

  {
    const app = makeApp();
    await app.renderDrillModal.call(app);
    await app.drillAccount.call(app, 's3', 'offsite');
    check('an unknown child can be marked off-site', app.calls[0].args.p_state, 'offsite');
    check('  which accounts for them', app._drill.students[2].state, 'offsite');
  }

  {
    const app = makeApp();
    app._drill.students[0].state = 'safe';
    await app.renderDrillModal.call(app);
    await app.drillAccount.call(app, 's1', null);
    check('tapping an accounted child undoes it', app.calls[0].args.p_state, null);
    check('  and they go back to unaccounted', app._drill.students[0].state, null);
  }

  console.log('\n== a tick that did not save ==\n');

  {
    // The one outcome this screen must never produce.
    const app = makeApp({ rpc: async () => { throw new Error('Query timeout'); } });
    await app.renderDrillModal.call(app);
    await app.drillAccount.call(app, 's1', 'safe');
    check('a failed write puts the child back', app._drill.students[0].state, null);
    ok('  and says so', app.notices.some(n => /NOT SAVED/.test(n)));
    ok('  by name, because a number is not enough to act on',
       app.notices.some(n => /Marisol/.test(n)));
    ok('  as an error, not a success', app.notices.every(n => /^error:/.test(n)));
  }

  {
    const app = makeApp({ rpc: async () => ({ success: false, error: 'No drill is running' }) });
    await app.renderDrillModal.call(app);
    await app.drillAccount.call(app, 's1', 'safe');
    check('a refusal is also put back', app._drill.students[0].state, null);
    ok('  and reported', app.notices.some(n => /NOT SAVED/.test(n)));
  }

  console.log('\n== a refresh must not eat a tick ==\n');

  {
    // Somebody else's refresh lands while your write is still in flight.
    const app = makeApp();
    app._drill.students[0].state = 'safe';
    app._drill.students[0].accounted_by_name = 'you';
    app._drillPending = new Set(['s1']);

    const fresh = BOARD();                       // server has not seen it yet
    fresh.students[1].state = 'safe';            // ...but has somebody else's
    fresh.students[1].accounted_by_name = 'B Teacher';
    await app._mergeDrill.call(app, fresh);

    check('your in-flight tick survives the refresh', app._drill.students[0].state, 'safe');
    check('  and the other teacher\'s tick arrives', app._drill.students[1].state, 'safe');
    check('  named', app._drill.students[1].accounted_by_name, 'B Teacher');
  }

  {
    const app = makeApp();
    app._drill.students[0].state = 'safe';
    app._drillPending = new Set();               // nothing in flight
    const fresh = BOARD();                       // server says not ticked
    await app._mergeDrill.call(app, fresh);
    check('once the write has landed the server wins', app._drill.students[0].state, null);
  }

  console.log('\n== who can do what ==\n');

  {
    const app = makeApp({ role: 'teacher' });
    await app.renderDrillModal.call(app);
    ok('a teacher can tick', /drillAccount/.test(seen(app)));
    ok('  but cannot turn the drill off', !/app\.endDrill\(\)/.test(app.body));
    ok('  and is not offered a Close that implies it is over',
       !/>Close</.test(app.body) && /I need something else/.test(app.body));
  }

  {
    const app = makeApp({ role: 'admin' });
    await app.renderDrillModal.call(app);
    ok('an admin can end it', /app\.endDrill\(\)/.test(app.body));
  }

  {
    const app = makeApp({ role: 'admin' });
    await app.renderDrillModal.call(app);
    await app.endDrill.call(app);
    const panel = app.endPanel.innerHTML;
    ok('turning it off warns how many are still open', /2 still unaccounted for/.test(panel));
    ok('  and names the unknown too', /1 unknown/.test(panel));
    check('  and asking is not ending', app.calls, []);
    ok('  it offers both verdicts', /confirmEndDrill\('test'\)/.test(panel)
       && /confirmEndDrill\('complete'\)/.test(panel));
    ok('  and a way to back out', /Keep it running/.test(panel));
  }

  {
    const app = makeApp({ role: 'admin' });
    app._drill.students.forEach(s => { if (s.bucket !== 'out') s.state = 'safe'; });
    await app.renderDrillModal.call(app);
    await app.endDrill.call(app);
    ok('all clear says so rather than a scary zero', /Everyone is accounted for/.test(app.endPanel.innerHTML));
  }

  console.log('\n== the verdict ==\n');

  {
    const app = makeApp({ role: 'admin',
      rpc: async (fn) => fn === 'rt_drill_end'
        ? { success: true, outcome: 'test', unaccounted_at_end: 0 }
        : { drill: null, students: [] } });
    await app.confirmEndDrill.call(app, 'test');
    check('it sends the verdict', app.calls[0], { fn: 'rt_drill_end', args: { p_outcome: 'test' } });
    ok('  and says which it was', app.notices.some(n => /as a test/.test(n)));
  }

  {
    const app = makeApp({ role: 'admin',
      rpc: async (fn) => fn === 'rt_drill_end'
        ? { success: true, outcome: 'complete', unaccounted_at_end: 2 }
        : { drill: null, students: [] } });
    await app.confirmEndDrill.call(app, 'complete');
    check('complete is its own verdict', app.calls[0].args.p_outcome, 'complete');
    ok('  and ending with people open is reported as an error, not a success',
       app.notices.some(n => /^error:.*2 were unaccounted/.test(n)));
  }

  {
    // The server is the one that insists on a verdict; the screen must not
    // paper over a refusal.
    const app = makeApp({ role: 'admin',
      rpc: async () => ({ success: false, error: 'Say whether it was a test or complete' }) });
    await app.confirmEndDrill.call(app, 'test');
    ok('a refused end is reported', app.notices.some(n => /^error:/.test(n)));
    ok('  and the drill is not treated as over', !app.notices.some(n => /Turned off/.test(n)));
  }

  console.log('\n== while one is running it is the only thing ==\n');

  {
    // Somebody already working in the portal when a drill starts.
    const app = makeApp({ role: 'teacher',
      rpc: async () => ({ id: 'd1', kind: 'fire', started_at: '2026-09-24T15:00:00Z' }) });
    app.modalOpen = false;
    await app._checkDrillActive.call(app);
    check('a running drill opens the roll call', app.opened, 1);
    check('  and no red bar while it is open', app.bar, null);
  }

  {
    const app = makeApp({ role: 'teacher',
      rpc: async () => ({ id: 'd1', kind: 'fire', started_at: '2026-09-24T15:00:00Z' }) });
    app.modalOpen = true;
    await app._checkDrillActive.call(app);
    check('it does not reopen over itself', app.opened, undefined);
  }

  {
    // Stepping out to look something up. A teacher may genuinely need the
    // emergency contacts that live elsewhere in this portal.
    const app = makeApp({ role: 'teacher',
      rpc: async () => ({ id: 'd1', kind: 'fire', started_at: '2026-09-24T15:00:00Z' }) });
    app._drillActive = { id: 'd1', kind: 'fire' };
    await app.leaveDrillView.call(app);
    ok('leaving leaves a bar that says it is still running', !!app.bar);
    ok('  and says how to get back', /tap to account/.test(app.bar.textContent));
    ok('  and tells them the drill has not ended', app.notices.some(n => /still running/.test(n)));

    // ...and the watcher must not drag them straight back in.
    app.modalOpen = false;
    app.opened = undefined;
    await app._checkDrillActive.call(app);
    check('the watcher respects that they stepped out', app.opened, undefined);
    ok('  but the bar stays', !!app.bar);
  }

  {
    // A NEW drill overrides having stepped out of the previous one.
    const app = makeApp({ role: 'teacher',
      rpc: async () => ({ id: 'd2', kind: 'lockdown', started_at: '2026-09-24T16:00:00Z' }) });
    app._drillActive = { id: 'd1', kind: 'fire' };
    app._drillLeftId = 'd1';
    app.modalOpen = false;
    await app._checkDrillActive.call(app);
    check('a new drill pulls everyone back in', app.opened, 1);
  }

  {
    const app = makeApp({ role: 'teacher', rpc: async () => null });
    app._drillActive = { id: 'd1', kind: 'fire' };
    app._drillLeftId = 'd1';
    await app._renderDrillBar.call(app);
    ok('the bar exists while one runs', !!app.bar);
    await app._checkDrillActive.call(app);
    check('and goes when the drill ends', app.bar, null);
  }

  {
    // A refusal from a stalling database must not look like "no drill".
    const app = makeApp({ role: 'teacher', rpc: async () => { throw new Error('Query timeout'); } });
    app._drillActive = { id: 'd1', kind: 'fire' };
    app._drillLeftId = 'd1';
    await app._renderDrillBar.call(app);
    await app._checkDrillActive.call(app);
    ok('a failed check leaves the drill alone', !!app.bar);
    check('  and says nothing', app.notices, []);
  }

  console.log('\n== the clock ==\n');

  {
    const app = makeApp();
    app._drill.drill.started_at = new Date(Date.now() - 95 * 1000).toISOString();
    check('minutes and seconds under an hour', (await app._drillElapsed.call(app)), '1:35');
    app._drill.drill.started_at = new Date(Date.now() - 3 * 3600 * 1000 - 4 * 60 * 1000).toISOString();
    check('hours and minutes past one', (await app._drillElapsed.call(app)), '3h 04m');
    app._drill.drill.started_at = null;
    check('nothing to count from is blank', (await app._drillElapsed.call(app)), '');
  }

  {
    const app = makeApp();
    app._drill.drill.started_at = new Date(Date.now() - 30 * 1000).toISOString();
    // extract() in this file always builds an AsyncFunction, so the real
    // _drillElapsed would hand the template a promise. The class's own is
    // sync; stub it so this asserts the WIRING, which is what is left to check.
    app._drillElapsed = () => '0:30';
    await app.renderDrillModal.call(app);
    ok('the elapsed time is on the screen', /id="drill-elapsed"/.test(app.body));
    ok('  showing it', /0:30/.test(app.body));
  }

  console.log('\n== no drill running ==\n');

  {
    const app = makeApp();
    app._drill = { drill: null, students: [] };
    await app.renderDrillModal.call(app);
    ok('it offers to start one', /app\.startDrill\('fire'\)/.test(app.body));
    ok('  with the kinds that matter', /Lockdown/.test(app.body) && /Earthquake/.test(app.body));
    ok('  and says what starting it does', /every member of staff/i.test(app.body));
  }

  console.log('\n== finding one child ==\n');

  {
    const app = makeApp();
    await app.renderDrillModal.call(app);
    app.searchBox.value = 'teo';
    await app.filterDrill.call(app);
    ok('search narrows to that child', /Teodor/.test(app.list.innerHTML) && !/Marisol/.test(app.list.innerHTML));
    app.searchBox.value = '';
    await app.filterDrill.call(app);
    ok('  and clearing brings the rest back', /Marisol/.test(app.list.innerHTML));
  }

  {
    const app = makeApp();
    app._drill.students.forEach(s => { if (s.bucket !== 'out') s.state = 'safe'; });
    await app.renderDrillModal.call(app);
    ok('everyone accounted for says so', /Everyone is accounted for/.test(app.list.innerHTML));
  }

  console.log('\n== the wiring ==\n');

  ok('teachers reach it from their dashboard',
     /onclick="app\.showDrillBoard\(\)"[\s\S]{0,80}Emergency drill/.test(html));
  ok('  and staff reach it from the attendance screen',
     (html.match(/app\.showDrillBoard\(\)/g) || []).length >= 2);
  ok('closing it stops the refresh loop', /closeDrill\(\)\s*{\s*this\._stopDrillPoll\(\);/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
