// The ways an account comes into existence, and the ways they used to fail.
//
// This covers the paths an audit of student and parent account creation turned
// up. Three of them were broken in the same way, so they are tested together.
//
// THE SHARED MISTAKE: A FLAG IS NOT A LOGIN
//
// user_profiles.can_login and account_status are claims. auth_user_id is the
// fact. Rows exist where the claims say yes and the fact says no - the old
// Activate button set account_status and created nothing, and approving an
// enrolment set can_login = true on a profile whose auth user "the admin will
// create separately", which no caller ever did. Every screen that asked the
// flag showed those students as finished and hid the button that would fix
// them, which is the definition of a dead end: visibly fine, permanently stuck.
// isActivated() (portal) and childHasLogin() (sign-in page) are the one rule.
//
// THE SECOND MISTAKE: TWO KINDS OF ID IN ONE COLUMN
//
// parent_child_links.parent_id REFERENCES auth.users, and every policy on the
// table compares it against auth.uid(). A parent who signed themselves up has
// profile.id = their auth id, so passing either worked and nobody noticed. A
// parent created by approving an enrolment gets a fresh uuid and no auth user
// at all, so the same code raised a foreign key violation - which, inside
// create_enrollment_profile's exception handler, rolled back the entire
// approval: no student, no medical record, no waivers, and a message about
// constraint names. Every genuinely new family hit it.
//
// Run: node tests/account-paths-audit.test.js

const fs = require('fs');
const path = require('path');

const portal = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

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
  const m = re.exec(portal);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < portal.length; i++) {
    const c = portal[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  i = portal.indexOf('{', i);
  let depth = 0;
  const start = i;
  for (; i < portal.length; i++) {
    const c = portal[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = portal.slice(m.index + 1, portal.indexOf('{', m.index)).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^\s*async\b/.test(m[0].slice(1));
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, portal.slice(start + 1, i - 1));
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const base = () => ({
  notices: [],
  isActivated: extract('isActivated'),
  isEnrolled: extract('isEnrolled'),
  escapeHtml: esc,
  jsAttr: (t) => String(t == null ? '' : t).replace(/'/g, "\\'"),
  showNotification(m, k) { this.notices.push(`${k}:${m}`); },
  supabaseQuery: (fn) => fn(),
});

(async () => {

  console.log('\n== approving an enrolment says what it actually did ==\n');

  function enrolmentApp(rpcResult) {
    const app = Object.assign(base(), {
      confirms: [],
      updates: [],
      rpcs: [],
      emails: [],
      userInfo: { user: { id: 'admin-auth' } },
      _enrollmentData: [{
        id: 'app1',
        student_first_name: 'Probe', student_last_name: 'Newfamily',
        student_email: 'probe.student@example.com',
        parent1_first_name: 'Pat', parent1_last_name: 'Newfamily',
        parent1_email: 'pat@example.com',
        student_grade_applying: '6', student_enrollment_type: 'full-time',
        school_year: '2026-2027',
      }],
      renderAdminEnrollment() {},
      auth: {
        supabase: {
          from: () => ({
            update(patch) { app.updates.push(patch); return this; },
            eq() { return Promise.resolve({ error: null }); },
          }),
          rpc: (fn, args) => {
            app.rpcs.push({ fn, args });
            return Promise.resolve({ data: rpcResult, error: null });
          },
          functions: {
            invoke: (name, opts) => {
              app.emails.push({ name, body: opts.body });
              return Promise.resolve({ data: null, error: null });
            },
          },
        },
      },
    });

    global.document = { getElementById: () => null };
    global.confirm = (text) => { app.confirms.push(text); return true; };
    global.window = {
      PortalUI: { showNotification: (m, k) => app.notices.push(`${k}:${m}`) },
    };
    app.approveEnrollment = extract('approveEnrollment');
    return app;
  }

  {
    const app = enrolmentApp({
      success: true, student_id: 's1', parent_id: 'p1',
      student_needs_login: true, parent_needs_login: true, parent_linked: false,
    });
    await app.approveEnrollment.call(app, 'app1');

    const asked = app.confirms[0];
    ok('the prompt no longer promises a login', !/login account will be created/i.test(asked));
    ok('  it says what approval does make', /school record, medical details, waivers/.test(asked));
    ok('  and that nothing is emailed to the family yet', /nothing is emailed to the family yet/.test(asked));

    const mail = app.emails.find(e => e.name === 'send-notification-email');
    check('the approval email stops claiming a login exists', mail.body.data.hasLogin, false);

    const said = app.notices.join(' ');
    ok('the admin is told the student still needs opening', /Probe needs their account opened/.test(said));
    ok('  and that the parent needs a login before linking', /Pat needs a parent login before they can be linked/.test(said));
  }

  {
    // A returning family whose parent already signs in: nothing outstanding,
    // and the message should not invent work.
    const app = enrolmentApp({
      success: true, student_id: 's1', parent_id: 'p1',
      student_needs_login: false, parent_needs_login: false, parent_linked: true,
    });
    await app.approveEnrollment.call(app, 'app1');
    const said = app.notices.join(' ');
    ok('a complete approval just says approved', /approved successfully/.test(said));
    ok('  with nothing outstanding', !/Still to do/.test(said));
  }

  {
    const app = enrolmentApp({ error: 'Application already approved' });
    await app.approveEnrollment.call(app, 'app1');
    ok('an error from the function is surfaced',
      app.notices.some(n => /Approval failed: Application already approved/.test(n)));
    check('  and no approval email goes out', app.emails, []);
  }

  console.log('\n== a link needs an id the column can hold ==\n');

  {
    const app = Object.assign(base(), {
      inserted: [],
      closeModal() {},
      renderAdminUsers() {},
      auth: { supabase: { from: () => ({ insert: (row) => { app.inserted.push(row); return Promise.resolve({ error: null }); } }) } },
    });
    app.linkChildToParent = extract('linkChildToParent');

    // parent_child_links.parent_id REFERENCES auth.users. A parent with no
    // login has nothing to put there, and the insert would fail on the
    // constraint - so it is refused before it is attempted, in words that say
    // what to do instead.
    await app.linkChildToParent.call(app, '', 'c1', 'Pat Newfamily', 'Probe');
    check('an unresolvable parent writes nothing', app.inserted, []);
    ok('  and is told to open the account first',
      app.notices.some(n => /no sign-in yet/.test(n) && /Open their account first/.test(n)));

    await app.linkChildToParent.call(app, 'auth-pat', 'c1', 'Pat Newfamily', 'Probe');
    check('a resolvable one is written', app.inserted, [{ parent_id: 'auth-pat', child_id: 'c1' }]);
  }

  console.log('\n== the parents table offers the step that is actually possible ==\n');

  async function adminUsers(users, links) {
    const section = { innerHTML: '' };
    const app = Object.assign(base(), {
      userInfo: { user: { id: 'admin-auth' } },
      auth: {
        supabase: {
          from: (table) => {
            const q = {
              select() { return q; },
              in() { return q; },
              order() { return q; },
              then(res, rej) {
                const data = table === 'parent_child_links' ? links : users;
                return Promise.resolve({ data, error: null }).then(res, rej);
              },
            };
            return q;
          },
        },
      },
    });
    global.document = { getElementById: (id) => (id === 'admin-users-section' ? section : null) };
    app.renderAdminUsers = extract('renderAdminUsers');
    await app.renderAdminUsers.call(app);
    return section.innerHTML;
  }

  const PARENT_SELF = {
    // Signed themselves up: create_signup_profile sets id = the auth user id.
    id: 'auth-mary', auth_user_id: 'auth-mary', user_type: 'parent',
    first_name: 'Mary', last_name: 'Argon', email: 'mary@example.com',
    username: 'mary', account_status: 'activated',
  };
  const PARENT_ENROLLED = {
    // Created by approving an enrolment: fresh uuid, no login.
    id: 'prof-pat', auth_user_id: null, user_type: 'parent',
    first_name: 'Pat', last_name: 'Newfamily', email: 'pat@example.com',
    username: 'pat.newfamily.1a2b', account_status: 'activated',
  };
  const CHILD = {
    id: 'c1', user_type: 'student', first_name: 'Ruthie', last_name: 'Argon',
    email: null, username: 'ruthie', account_status: 'inactive', auth_user_id: null,
  };

  {
    const html = await adminUsers([PARENT_SELF, PARENT_ENROLLED, CHILD],
      [{ parent_id: 'auth-mary', child_id: 'c1' }]);

    ok('a parent who signs in is offered Link Child', /showLinkChildToParentModal\('auth-mary'/.test(html));
    ok('  and their linked child is shown', /Ruthie Argon/.test(html));

    // The whole point: a link keyed on an auth user that does not exist cannot
    // be written, so offering the button would be offering a failure.
    ok('a parent with no login is not offered a link', !/showLinkChildToParentModal\('prof-pat'/.test(html));
    ok('  they are offered the account instead', /showActivationForm\('prof-pat'/.test(html));
    ok('  and the row says why', /No sign-in yet/.test(html));
  }

  {
    // The map is keyed on the auth id. Reading it with the profile id happened
    // to work for every parent on the database, which is exactly why it went
    // unnoticed - so the lookup is asserted on a parent whose ids differ.
    const splitParent = { ...PARENT_ENROLLED, auth_user_id: 'auth-pat' };
    const html = await adminUsers([splitParent, CHILD],
      [{ parent_id: 'auth-pat', child_id: 'c1' }]);
    ok('children are found when the two ids differ', /Ruthie Argon/.test(html));
    ok('  and unlink uses the id the row is keyed on',
      /unlinkChildFromParent\('auth-pat', 'c1'/.test(html));
  }

  console.log('\n== the inactive list finds who cannot sign in ==\n');

  async function inactiveList(students) {
    const modal = { innerHTML: '' };
    const listDiv = { innerHTML: '' };
    const app = Object.assign(base(), {
      auth: {
        supabase: {
          from: () => {
            const q = {
              select() { return q; },
              eq() { return q; },
              order() { return q; },
              then(res, rej) { return Promise.resolve({ data: students, error: null }).then(res, rej); },
            };
            return q;
          },
        },
      },
    });
    global.document = {
      getElementById: (id) => (id === 'student-management-modal' ? modal
        : id === 'inactive-students-list' ? listDiv : null),
    };
    app.showInactiveStudentsList = extract('showInactiveStudentsList');
    await app.showInactiveStudentsList.call(app);
    return listDiv.innerHTML;
  }

  {
    const html = await inactiveList([
      { id: 's1', first_name: 'Ruthie', last_name: 'Argon', username: 'ruthie', grade_level: '7',
        account_status: 'inactive', auth_user_id: null, student_status: 'active' },
      // Flagged activated, nothing behind it. The old query filtered on the
      // flag, so this student was invisible on the one screen meant to find her.
      { id: 's2', first_name: 'Kaitlyn', last_name: 'Erickson', username: 'kaitlyn', grade_level: '9',
        account_status: 'activated', auth_user_id: null, student_status: 'active' },
      // Genuinely done.
      { id: 's3', first_name: 'Eli', last_name: 'Killackey', username: 'eli', grade_level: '9',
        account_status: 'activated', auth_user_id: 'auth-eli', student_status: 'active' },
      // Left the school: not waiting to be activated, just gone.
      { id: 's4', first_name: 'Gone', last_name: 'Away', username: 'gone', grade_level: '8',
        account_status: 'inactive', auth_user_id: null, student_status: 'past' },
    ]);

    ok('a student with no login is listed', /Ruthie/.test(html));
    ok('a student flagged activated with no login is listed too', /Kaitlyn/.test(html));
    ok('a student who can sign in is not', !/Killackey/.test(html));
    ok('and a past student is not waiting for anything', !/Gone Away/.test(html));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
