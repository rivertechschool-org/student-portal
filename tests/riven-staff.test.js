// Who is an admin, and who still works here.
//
// Promoting is the only command in Riven that changes what somebody ELSE is
// allowed to do, so it says what it grants in full before doing it: an admin
// sees and changes every student's record, every class and every account, not
// only their own.
//
// TWO WAYS TO LOCK YOURSELF OUT
//
// Both are refused, because both are irreversible from where the person is
// standing:
//
//   * taking your own admin rights away leaves you unable to reach the screen
//     that would put them back;
//   * closing your own account signs you out of the school.
//
// A FIRST NAME IS NOT ENOUGH FOR THE KEYS
//
// "make sam an admin" with two Sams on staff stops rather than picks. A first
// name alone is accepted only when exactly one person on staff answers to it.
//
// Run: node tests/riven-staff.test.js

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

const STAFF = [
  { id: 'dan', first_name: 'Dan', last_name: 'Pike', email: 'dan@x.com', user_type: 'teacher', account_status: 'activated' },
  { id: 'cait', first_name: 'Caitlin', last_name: 'Pennock', email: 'cait@x.com', user_type: 'admin', account_status: 'activated' },
];

function makeApp({ role = 'admin', staff = STAFF, meId = 'me' } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    updates: [],
    undos: [],
    userInfo: { profile: { user_type: role, id: meId }, user: { id: meId } },
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
        from() {
          const q = {
            select() { return q; },
            in() { return q; },
            eq(c, v) { q._eq = q._eq || {}; q._eq[c] = v; return q; },
            update(patch) { q._patch = patch; return q; },
            then(res, rej) {
              if (q._patch) { app.updates.push({ patch: q._patch, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              return Promise.resolve({ data: staff, error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  app._rivenRequireAdmin = extract('_rivenRequireAdmin');
  app._rivenPolicyError = extract('_rivenPolicyError');
  app._rivenFindStaff = extract('_rivenFindStaff');
  app._rivenStaffError = extract('_rivenStaffError');
  for (const m of ['terminalChangeStaffRole', 'terminalSetStaffActive']) {
    const fn = extract(m);
    app[m] = async function (...a) {
      const r = await fn.apply(app, a);
      if (app._pending) { const p = app._pending; app._pending = null; await p; }
      return r;
    };
  }
  return app;
}

const said = (text) => ({ original: text, _rawInput: text });

(async () => {

  console.log('\n== only an admin ==\n');

  {
    const app = makeApp({ role: 'teacher' });
    await app.terminalChangeStaffRole.call(app, said('make dan pike an admin'), 'admin');
    await app.terminalSetStaffActive.call(app, said('deactivate dan pike'), false);
    check('a teacher changes nothing', app.updates, []);
    check('  refused both times', app.errors.length, 2);
  }

  console.log('\n== finding the colleague ==\n');

  {
    const app = makeApp({});
    const r = await app._rivenFindStaff.call(app, said('make dan pike an admin'));
    check('a full name finds them', r.row.id, 'dan');
  }

  {
    const app = makeApp({});
    const r = await app._rivenFindStaff.call(app, said('make dan@x.com an admin'));
    check('an email does too', r.row.id, 'dan');
  }

  {
    const app = makeApp({});
    // Only one Dan on staff, so the first name is enough.
    const r = await app._rivenFindStaff.call(app, said('make dan an admin'));
    check('a unique first name is enough', r.row.id, 'dan');
  }

  {
    const app = makeApp({
      staff: [
        { id: 'a', first_name: 'Sam', last_name: 'One', user_type: 'teacher', account_status: 'activated' },
        { id: 'b', first_name: 'Sam', last_name: 'Two', user_type: 'teacher', account_status: 'activated' },
      ],
    });
    const r = await app._rivenFindStaff.call(app, said('make sam an admin'));
    // The keys to the school are not handed over on a coin flip.
    check('two Sams stop it', r.error, 'ambiguous');
  }

  console.log('\n== admin rights ==\n');

  {
    const app = makeApp({});
    await app.terminalChangeStaffRole.call(app, said('make dan pike an admin'), 'admin');
    check('the role is written', app.updates[0].patch, { user_type: 'admin' });
    // What it actually grants, not "promote to admin".
    ok('the confirmation spells out the reach',
      /every student's record, every class and every account/.test(app.confirmed));
    check('  and it can be undone', app.undos.length, 1);
  }

  {
    const app = makeApp({});
    await app.terminalChangeStaffRole.call(app, said('make caitlin pennock an admin'), 'admin');
    check('somebody already an admin is left alone', app.updates, []);
    ok('  and told so', /already an admin/.test(app.said[0]));
  }

  {
    const app = makeApp({});
    await app.terminalChangeStaffRole.call(app, said('demote caitlin pennock'), 'teacher');
    check('demoting writes the teacher role', app.updates[0].patch, { user_type: 'teacher' });
    ok('  and says what they keep', /keep their own classes/.test(app.confirmed));
  }

  {
    // Locking yourself out of the screen that would undo it.
    const app = makeApp({ meId: 'cait' });
    await app.terminalChangeStaffRole.call(app, said('demote caitlin pennock'), 'teacher');
    check('you cannot demote yourself', app.updates, []);
    ok('  and it explains why', /will not be able to undo it/.test(app.errors[0]));
  }

  console.log('\n== accounts ==\n');

  {
    const app = makeApp({});
    await app.terminalSetStaffActive.call(app, said('deactivate dan pikes account'), false);
    check('the account is closed', app.updates[0].patch, { account_status: 'inactive' });
    // The fear that stops people closing a leaver's account.
    ok('the confirmation says nothing is deleted',
      /classes, marks and history stay/.test(app.confirmed));
    ok('  and the answer repeats it', /untouched/.test(app.ok[0]));
  }

  {
    const app = makeApp({
      staff: [{ id: 'dan', first_name: 'Dan', last_name: 'Pike', user_type: 'teacher', account_status: 'inactive' }],
    });
    await app.terminalSetStaffActive.call(app, said('reactivate dan pikes account'), true);
    check('reopening writes activated', app.updates[0].patch, { account_status: 'activated' });
    ok('  and says they can sign in', /can sign in again/.test(app.ok[0]));
  }

  {
    const app = makeApp({});
    await app.terminalSetStaffActive.call(app, said('reactivate dan pikes account'), true);
    check('an open account is left alone', app.updates, []);
    ok('  and says so', /already open/.test(app.said[0]));
  }

  {
    const app = makeApp({ meId: 'dan' });
    await app.terminalSetStaffActive.call(app, said('deactivate dan pikes account'), false);
    check('you cannot close your own account', app.updates, []);
    ok('  and it says what that would do', /sign you out of the school/.test(app.errors[0]));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
