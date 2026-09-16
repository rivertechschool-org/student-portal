// A held-back email is queued, not failed, and the teacher is told.
//
// WHAT WENT WRONG
//
// 2026-09-15: 312 notification emails were attempted in one day. 199 landed
// and 113 came back refused because the provider's daily allowance was spent.
// Every one of those 113 was written to email_log with status 'failed' and
// then forgotten - that table is a log, nothing drains it - so 17 families
// never heard about 8 assignments, and the only reason anybody noticed was
// that somebody happened to look.
//
// Two things had to become true, and this file holds both to their word:
//
//   * A refusal that will clear later is a THIRD outcome. Not a success (it
//     has not been delivered) and not a failure (nothing is wrong with it and
//     the queue will retry it). Calling it either is wrong in a way people act
//     on: 'failed' raises an alert nobody can act on, 'success' tells a
//     teacher the parents were told when they were not.
//
//   * The teacher finds out. A fan-out that sends 25 and holds 15 looks
//     exactly like one that sent all 40 from where they are sitting - they
//     posted the work, the screen said "Assignment created", and the first
//     they hear of it is a parent asking why they weren't told.
//
// The reporting runs in a `finally` on purpose. sendNewAssignmentNotifications
// returns early in several places, and a report written after the last
// statement would be skipped in exactly the runs that sent the most email.
//
// Run: node tests/email-deferral.test.js

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

// These live at 6-space indent inside ClassesPortalApp.
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
  const isAsync = /^\s*async\b/.test(m[0].slice(1));
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// `reply` is what the edge function hands back for one send.
function makeApp(reply) {
  const app = {
    logged: [],
    alerts: [],
    notices: [],
    escapeHtml: (t) => String(t == null ? '' : t),
    getEmailSubjectForType: () => 'A subject',
    showNotification(message, kind) { app.notices.push({ message, kind }); },
    async sendSystemAlert(type, title, message) { app.alerts.push({ type, title, message }); },
    auth: {
      supabase: {
        functions: { invoke: async () => reply },
        from() {
          return { insert: async (row) => { app.logged.push(row); return { error: null }; } };
        },
      },
    },
  };
  for (const m of ['sendEmailWithTracking', '_startEmailTally', '_tallyEmail', '_reportEmailTally']) {
    app[m] = extract(m);
  }
  return app;
}

const RESET = '2026-09-16T07:00:00.000Z';   // midnight Pacific

(async () => {

  console.log('\n== a held email is neither sent nor failed ==\n');

  {
    const app = makeApp({ data: { deferred: true, queued: true, retryAfter: RESET,
                                  message: 'Daily send limit reached' }, error: null });
    const r = await app.sendEmailWithTracking.call(app, 'a@b.com', 'assignment_posted', {}, { assignmentId: 'x' });

    check('the caller is not told it failed', r.success, true);
    check('  and not told it was delivered either', r.deferred, true);
    check('  it says when it will go', r.retryAfter, RESET);
    check('the log records it as queued', app.logged[0].status, 'queued');
    // THE ONE THAT MATTERS. 'failed' is what made 113 emails disappear: an
    // admin alert nobody could act on, and no retry anywhere.
    ok('  never as failed', app.logged.every(l => l.status !== 'failed'));
    check('no admin is alerted about a working system', app.alerts, []);
    ok('  and the reset time is kept with it', app.logged[0].metadata.retryAfter === RESET);
  }

  {
    // A real failure still behaves as it always did: logged, and an admin told.
    const app = makeApp({ data: null, error: { message: 'Invalid recipient' } });
    const r = await app.sendEmailWithTracking.call(app, 'nope@', 'assignment_posted', {}, {});
    check('a genuine failure is still a failure', r.success, false);
    check('  logged as failed', app.logged[0].status, 'failed');
    check('  and an admin hears about it', app.alerts.length, 1);
  }

  {
    const app = makeApp({ data: { id: 'resend-id' }, error: null });
    const r = await app.sendEmailWithTracking.call(app, 'a@b.com', 'assignment_posted', {}, {});
    check('a normal send is still a plain success', r.success, true);
    check('  with nothing deferred', r.deferred, undefined);
    check('  logged as success', app.logged[0].status, 'success');
  }

  console.log('\n== what the teacher is told ==\n');

  {
    // 40 recipients, the allowance runs out at 25.
    const app = makeApp(null);
    app._startEmailTally.call(app);
    for (let i = 0; i < 25; i++) app._tallyEmail.call(app, 'sent');
    for (let i = 0; i < 15; i++) app._tallyEmail.call(app, 'queued', RESET);
    app._reportEmailTally.call(app, app._emailTally);

    check('the teacher is told once', app.notices.length, 1);
    const said = app.notices[0].message;
    ok('  how many went', /25 emails sent/.test(said));
    ok('  how many are waiting', /15 queued/.test(said));
    // "going out at 8:00 AM" beats "some emails were deferred" - the second
    // leaves them wondering whether to chase it.
    ok('  and when they go', /going out/.test(said));
    check('  as information, not a warning', app.notices[0].kind, 'info');
  }

  {
    const app = makeApp(null);
    app._startEmailTally.call(app);
    for (let i = 0; i < 3; i++) app._tallyEmail.call(app, 'sent');
    app._reportEmailTally.call(app, app._emailTally);
    // A message on every single assignment is a message nobody reads by
    // Wednesday, and then the one that matters is invisible too.
    check('a clean run says nothing at all', app.notices, []);
  }

  {
    const app = makeApp(null);
    app._startEmailTally.call(app);
    app._tallyEmail.call(app, 'sent');
    app._tallyEmail.call(app, 'failed');
    app._reportEmailTally.call(app, app._emailTally);
    check('a real failure is a warning, not a note', app.notices[0].kind, 'warning');
    ok('  and says so plainly', /could not be sent/.test(app.notices[0].message));
  }

  {
    // Tallying outside a run must not throw - sendEmailWithTracking is called
    // from a dozen places and only the fan-out opens a tally.
    const app = makeApp({ data: { id: 'x' }, error: null });
    app._emailTally = null;
    const r = await app.sendEmailWithTracking.call(app, 'a@b.com', 'system_alert', {}, {});
    check('a send outside a counted run is fine', r.success, true);
  }

  console.log('\n== the fan-out reports however it ends ==\n');

  {
    // Read off the source rather than run the whole fan-out: the point is
    // structural. sendNewAssignmentNotifications has four early returns, and
    // three of them are on the paths that sent the most email.
    const src = html.slice(html.indexOf('async sendNewAssignmentNotifications'));
    const body = src.slice(0, src.indexOf('async sendSubmissionNotification'));
    ok('the fan-out opens a tally', /_startEmailTally\(\)/.test(body));
    ok('  and reports it in a finally', /finally\s*\{[\s\S]*_reportEmailTally/.test(body));
    // Guard clauses on one line ("if (students.length === 0) return;"), so
    // match the statement rather than the start of a line.
    check('  which it needs, because it returns early', (body.match(/\breturn;/g) || []).length, 3);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
