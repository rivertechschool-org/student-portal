// Deciding an enrolment application.
//
// A family applies; an admin decides. Approving is the one that CREATES things
// - the student record, the medical details, the waivers, the parent profile -
// so it is treated as a write of that size rather than as ticking a queue item,
// and it reports what it could not finish.
//
// THE SIBLING PROBLEM
//
// The first draft refused to act whenever a student resolved from the
// sentence, reasoning that an applicant is not on the roster yet so any match
// must be somebody else. Siblings share surnames: "approve the application for
// the smith family" resolved an existing Smith and knocked the command out
// entirely. The applicant is found by the name on the FORM, whoever the roster
// happened to match, and the confirmation names them before anything happens.
//
// A DENIAL NEEDS A REASON
//
// The page will not deny without one, and a denial with no reason on the
// record is one nobody can explain to the family three months later. Riven
// asks rather than writing a blank.
//
// Run: node tests/riven-enrolment-applications.test.js

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

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const APP = (over = {}) => ({
  id: 'app1', application_number: 'RT-2027-004', status: 'submitted', school_year: '2026-2027',
  student_first_name: 'Probe', student_last_name: 'Smith', student_grade_applying: '6',
  parent1_first_name: 'Pat', parent1_last_name: 'Smith', parent1_email: 'pat@x.com',
  created_at: '2026-09-01', ...over,
});

function makeApp({ role = 'admin', applications = [APP()], rpc = {} } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    updates: [],
    rpcs: [],
    undos: [],
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    escapeHtml: esc,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _pushUndo(desc, fn) { app.undos.push({ desc, fn }); },
    _requestConfirmation(summary, run) {
      app.confirmed = summary;
      app._pending = (async () => run())();
    },
    auth: {
      supabase: {
        rpc(fn, args) {
          app.rpcs.push({ fn, args });
          return Promise.resolve({ data: rpc[fn] ?? { success: true }, error: null });
        },
        from() {
          const q = {
            select() { return q; },
            eq(c, v) { q._eq = q._eq || {}; q._eq[c] = v; return q; },
            order() { return q; },
            update(patch) { q._patch = patch; return q; },
            then(res, rej) {
              if (q._patch) { app.updates.push({ patch: q._patch, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              return Promise.resolve({ data: applications, error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  app._rivenRequireAdmin = extract('_rivenRequireAdmin');
  app._rivenPolicyError = extract('_rivenPolicyError');
  app._rivenFindApplication = extract('_rivenFindApplication');
  const decide = extract('terminalDecideApplication');
  app.terminalDecideApplication = async function (...a) {
    const r = await decide.apply(app, a);
    if (app._pending) { const p = app._pending; app._pending = null; await p; }
    return r;
  };
  app.terminalViewApplications = extract('terminalViewApplications');
  return app;
}

const said = (text) => ({ original: text, _rawInput: text });

(async () => {

  console.log('\n== only an admin ==\n');

  {
    const app = makeApp({ role: 'teacher' });
    await app.terminalDecideApplication.call(app, said('approve the smith application'), 'approve');
    check('a teacher decides nothing', app.rpcs.concat(app.updates), []);
    ok('  and is told who can', /Only an admin/.test(app.errors[0]));
  }

  console.log('\n== finding the application ==\n');

  {
    const app = makeApp({});
    const r = await app._rivenFindApplication.call(app, said('approve the application for probe smith'));
    check('a full name finds it', r.row.id, 'app1');
  }

  {
    const app = makeApp({});
    const r = await app._rivenFindApplication.call(app, said('approve RT-2027-004'));
    check('the application number finds it', r.row.id, 'app1');
  }

  {
    const app = makeApp({});
    // One waiting and nobody named: unambiguous, and the confirmation names it.
    const r = await app._rivenFindApplication.call(app, said('approve the application'));
    check('one waiting needs no name', r.row.id, 'app1');
  }

  {
    const app = makeApp({
      applications: [APP(), APP({ id: 'app2', student_first_name: 'Other', application_number: 'RT-2027-005' })],
    });
    const r = await app._rivenFindApplication.call(app, said('approve the application'));
    check('two waiting and no name refuses to choose', r.error, 'not_found');
  }

  {
    const app = makeApp({ applications: [APP({ status: 'approved' })] });
    const r = await app._rivenFindApplication.call(app, said('approve the application'));
    check('an already-decided application is not open', r.error, 'none_open');
  }

  console.log('\n== approving ==\n');

  {
    const app = makeApp({
      rpc: { create_enrollment_profile: { success: true, student_needs_login: true, parent_needs_login: true } },
    });
    await app.terminalDecideApplication.call(app, said('approve the probe smith application'), 'approve');

    ok('the confirmation names the applicant', /Probe Smith/.test(app.confirmed));
    ok('  and the year group', /grade 6/.test(app.confirmed));
    // It creates a family's whole record; that should not read as a tick-box.
    ok('  and says what it creates', /medical details, waivers/.test(app.confirmed));
    ok('  while being honest that nothing is emailed', /nothing is emailed yet/.test(app.confirmed));

    const call = app.rpcs.find(c => c.fn === 'create_enrollment_profile');
    check('it approves the right application', call.args.p_application_id, 'app1');
    // Logins are opened afterwards from the roster, deliberately.
    check('  and creates no login', call.args.p_create_auth_user, false);

    ok('the answer says what is left to do', /needs their account opened/.test(app.ok[0]));
    ok('  including the parent', /needs a login before they can be linked/.test(app.ok[0]));
  }

  {
    const app = makeApp({ rpc: { create_enrollment_profile: { success: true } } });
    await app.terminalDecideApplication.call(app, said('approve the probe smith application'), 'approve');
    ok('a clean approval invents no outstanding work', !/Still to do/.test(app.ok[0]));
  }

  console.log('\n== denying and waitlisting ==\n');

  {
    const app = makeApp({});
    await app.terminalDecideApplication.call(app, said('deny the probe smith application'), 'deny');
    check('a denial with no reason writes nothing', app.updates, []);
    ok('  and asks for one', /A denial needs a reason/.test(app.errors[0]));
  }

  {
    const app = makeApp({});
    await app.terminalDecideApplication.call(app,
      said('deny the probe smith application because no space in that year group'), 'deny');
    check('the status is written', app.updates[0].patch.status, 'denied');
    check('  with the reason on the record', app.updates[0].patch.denial_reason, 'no space in that year group');
    ok('  and who decided', !!app.updates[0].patch.reviewed_by);
    ok('the confirmation says no records are created', /No records are created/.test(app.confirmed));
    check('  and it can be undone', app.undos.length, 1);
  }

  {
    const app = makeApp({});
    // Waitlisting is not a refusal, so it needs no reason.
    await app.terminalDecideApplication.call(app, said('waitlist the probe smith application'), 'waitlist');
    check('waitlisting needs no reason', app.updates[0].patch.status, 'waitlisted');
    ok('  and says nothing is created', /No records are created/.test(app.confirmed));
  }

  console.log('\n== the queue ==\n');

  {
    const app = makeApp({
      applications: [APP(), APP({ id: 'a2', student_first_name: 'Second', status: 'waitlisted' }), APP({ id: 'a3', status: 'approved' })],
    });
    await app.terminalViewApplications.call(app, said('any applications waiting'));
    const out = app.said[0];
    ok('it counts the open ones', /2 applications waiting/.test(out));
    ok('  naming them', /Probe Smith/.test(out) && /Second Smith/.test(out));
    ok('  and an approved one is not waiting', !/3 applications/.test(out));
  }

  {
    const app = makeApp({ applications: [APP({ status: 'approved' })] });
    await app.terminalViewApplications.call(app, said('any applications waiting'));
    ok('an empty queue says so', /No applications are waiting/.test(app.said[0]));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
