// Students do not open their own accounts.
//
// THE BUG THIS CLOSES
//
// Every pupil is entered on the roster before they ever see the site, and that
// profile is where the records live: attendance, grades, skill progress, RTC.
// The sign-in page offered two self-service routes anyway - Register and
// Activate - and neither could find that profile, because neither asked for
// anything a stranger would not also know. So a student who used one ended up
// with a SECOND profile: same child, same school, none of the history, and the
// new one is the one they then signed in to. Three such pairs had to be merged
// by hand before this was written, and one of them (Ruthie's) had 28 skill
// records stranded on the self-made row, so an automatic rule would have
// destroyed data either way it chose.
//
// Activate was worse than useless: it called student_username_unclaimed(),
// which does not exist on this database, so it could only ever fail - and the
// usernames it asked for ("ruthie.argon", a misspelt "Malea", "Samantha H.")
// were not typeable by the students who had them. That is what pushed them to
// Register, which is what made the duplicates.
//
// WHAT REPLACES THEM
//
// Someone who already knows the child sends an address:
//
//   * a teacher or an admin, from the roster; or
//   * a PARENT, for a child linked to them - which costs either the code the
//     school printed for that child or a request an admin approved by hand.
//
// Both call the same edge function, which opens the login on the EXISTING
// profile. So the tests below care about two things: that the self-service
// doors are shut, and that the parent's door leads to the same place the
// office's does.
//
// Run: node tests/no-student-self-signup.test.js

const fs = require('fs');
const path = require('path');

const root = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const portal = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Pull a method out of one of the two giant HTML files by signature and indent.
// The root page indents methods twelve spaces, the portal six.
function extractor(html, indent) {
  const pad = ' '.repeat(indent);
  return function extract(name) {
    const re = new RegExp('\\n' + pad + '(?:async\\s+)?' + name + '\\s*\\(', 'g');
    const m = re.exec(html);
    if (!m) throw new Error('method not found: ' + name);
    let i = m.index + m[0].length - 1, pd = 0;
    for (; i < html.length; i++) {
      const c = html[i];
      if (c === '(') pd++;
      else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
    }
    i = html.indexOf('{', i);
    let depth = 0;
    const start = i;
    for (; i < html.length; i++) {
      const c = html[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const sig = html.slice(m.index + 1, html.indexOf('{', m.index)).trim();
    const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
    // Build with the async constructor only when the source says async, or a
    // synchronous helper comes back as a Promise and every assertion on its
    // return value silently passes.
    const isAsync = /^\s*async\b/.test(m[0].slice(1));
    const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
    return new Ctor(args, html.slice(start + 1, i - 1));
  };
}

const fromRoot = extractor(root, 12);
const fromPortal = extractor(portal, 6);

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A DOM stub that only has to answer getElementById. Each test declares the
// fields that exist on its screen; anything else comes back null, which is what
// the real page returns once a form has been removed.
function fakeDom(fields) {
  const nodes = {};
  for (const [id, value] of Object.entries(fields)) {
    nodes[id] = (value && typeof value === 'object')
      ? { style: {}, ...value }
      : { style: {}, value: value == null ? '' : String(value) };
  }
  global.document = { getElementById: (id) => nodes[id] || null };
  return nodes;
}

(async () => {
  console.log('\n== the self-service doors are shut ==\n');

  {
    // Markup facts, because that is exactly what these are: a control that is
    // absent from the page cannot be exercised by a stub.
    ok('the sign-in page has no Activate form', !/id="activate-form"/.test(root));
    ok('  and no link that would have opened it', !/activate-account-link/.test(root));
    ok('the register form has no account-type picker', !/id="reg-usertype"/.test(root));
    ok('  so no Student option to choose', !/<option value="student">/.test(root));
    ok('  and no grade or enrolment type to go with it',
      !/id="reg-grade"/.test(root) && !/id="reg-enrollment-type"/.test(root));
    ok('the register button names who it is for', /id="register-btn">Create a Parent Account</.test(root));
    ok('and the page tells a student who to ask instead',
      /your parent or your teacher opens[\s\S]{0,60}your account for you/.test(root));
  }

  {
    // The handlers behind the removed forms are gone too, so a cached page
    // cannot call one that half-works.
    ok('handleActivate is gone', !/handleActivate/.test(root));
    ok('showActivateForm is gone', !/showActivateForm\s*\(/.test(root));
    ok('the dead username check is gone with it', !/student_username_unclaimed/.test(root));
    ok('nothing carries claim_username any more', !/claim_username/.test(root));
  }

  {
    // Nowhere still sends someone to the link that no longer exists.
    ok('the portal does not point at Activate Account', !/Activate Account<\/strong>/.test(portal));
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'shared', 'config.js'), 'utf8');
    ok('nor does the shared nav', !/Activate Account/.test(cfg));
  }

  {
    // Signing in to an account that was never opened used to say "use the
    // Activate Account option", which is now advice to press a button that is
    // not there.
    ok('the refusal at sign-in names a person, not a button',
      /has not been opened yet[\s\S]{0,80}parent or a teacher/.test(root));
    ok('  and no longer names the removed option',
      !/Please use the "Activate Account" option/.test(root));
  }

  console.log('\n== registering makes a parent, whatever is sent ==\n');

  async function runRegister(fields) {
    const handleRegister = fromRoot('handleRegister');
    const nodes = fakeDom({
      'reg-email': fields.email ?? 'mum@example.com',
      'reg-password': fields.password ?? 'longenough1',
      'reg-password-confirm': fields.confirm ?? 'longenough1',
      'reg-username': fields.username ?? 'mum',
      'reg-firstname': fields.first ?? 'Mary',
      'reg-lastname': fields.last ?? 'Argon',
      'register-submit-btn': { disabled: false, textContent: 'Register' },
    });

    const app = {
      notices: [],
      rpcs: [],
      signups: [],
      shown: [],
      auth: {
        supabase: {
          auth: {
            signUp: async (args) => {
              app.signups.push(args);
              return { data: { user: { id: 'auth-new', identities: [{ id: 'i' }] } }, error: null };
            },
          },
          rpc: async (fn, args) => {
            app.rpcs.push({ fn, args });
            return { data: { success: true }, error: null };
          },
        },
      },
      notifyAdminsOfNewUser: async () => {},
      showLoginForm() { app.shown.push('login'); },
    };

    global.window = {
      PortalUI: { showNotification: (m, k) => app.notices.push(`${k}:${m}`) },
      location: { origin: 'https://rivertech.me' },
    };
    global.PortalUI = { friendlyAuthError: (e) => e.message };

    await handleRegister.call(app, { preventDefault() {} });
    return { app, nodes };
  }

  {
    const { app } = await runRegister({});
    const call = app.rpcs.find(r => r.fn === 'create_signup_profile');
    check('the profile is made as a parent', call.args.user_type, 'parent');
    check('  with no grade level', call.args.user_grade_level, null);
    check('  and no enrolment type', call.args.user_enrollment_type, null);
    ok('the sign-up itself still happens', app.signups.length === 1);
    ok('and it returns to the sign-in form', app.shown.includes('login'));
  }

  {
    // The page reads no account-type field, so a page left open from before the
    // change cannot smuggle one back in by having the element present.
    fakeDom({});
    ok('handleRegister never reads an account type', !/reg-usertype/.test(String(fromRoot('handleRegister'))));
    ok('  nor a grade', !/reg-grade/.test(String(fromRoot('handleRegister'))));
  }

  {
    const { app } = await runRegister({ confirm: 'different1' });
    ok('mismatched passwords are still refused', app.notices.some(n => /do not match/i.test(n)));
    check('  and nothing is created', app.signups, []);
  }

  {
    const { app } = await runRegister({ password: 'short', confirm: 'short' });
    ok('a short password is still refused', app.notices.some(n => /at least 8/.test(n)));
    check('  and nothing is created', app.signups, []);
  }

  {
    const { app } = await runRegister({ username: '' });
    ok('a missing field is still refused', app.notices.some(n => /fill in all required/i.test(n)));
    check('  and nothing is created', app.signups, []);
  }

  console.log('\n== a parent opens their own child\'s account ==\n');

  // "Needs their account opening" is decided by whether a LOGIN exists, which
  // is account_status together with auth_user_id - the same rule the office's
  // isActivated() applies. can_login on its own gets three of these four right
  // and the fourth badly wrong, which is why the rule is shared rather than
  // re-guessed on each screen.
  const CHILDREN = [
    // The real case: linked, on the roster, no login yet.
    { id: 'c1', first_name: 'Ruthie', last_name: 'Argon', email: null, grade_level: '7',
      account_status: 'inactive', can_login: false, auth_user_id: null },
    // Already signed in once - nothing to offer.
    { id: 'c2', first_name: 'Eli', last_name: 'Argon', email: 'eli@example.com', grade_level: '9',
      account_status: 'activated', can_login: true, auth_user_id: 'auth-eli' },
    // Signs in with a PIN: there IS an auth user, but account_status stays
    // 'inactive', so the portal itself is still shut to them.
    { id: 'c3', first_name: 'Mae', last_name: 'Argon', email: 'pin-abc@pin.rivertech.me',
      grade_level: '5', account_status: 'inactive', can_login: false, auth_user_id: 'auth-pin' },
  ];

  // What approving an enrolment produces: flagged active, carrying can_login,
  // and nothing to sign in with. Reading the flag shows this child as finished
  // and hides the one button that would fix it.
  const ENROLLED_NO_LOGIN = { id: 'c4', first_name: 'Probe', last_name: 'Newfamily',
    email: 'probe@example.com', grade_level: '6',
    account_status: 'activated', can_login: true, auth_user_id: null };

  function rootParent({ status = 200, body = { success: true, emailSent: true }, throws = null } = {}) {
    const app = {
      posts: [],
      notices: [],
      modals: [],
      reloads: [],
      closed: 0,
      childProfiles: JSON.parse(JSON.stringify(CHILDREN)),
      escapeHtml: esc,
      showModal(id, title, content) { app.modals.push({ id, title, content }); },
      closeModal() { app.closed++; },
      auth: {
        getUserInfo: () => ({ user: { id: 'p-auth' }, profile: { id: 'p1', first_name: 'Mary' } }),
        supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
      },
      loadParentDashboard: async (...a) => { app.reloads.push(a.length); },
    };

    app.showActivateChildModal = fromRoot('showActivateChildModal');
    app.confirmActivateChild = fromRoot('confirmActivateChild');

    global.window = {
      PortalUI: { showNotification: (m, k) => app.notices.push(`${k}:${m}`) },
      portalAuth: { config: { supabaseUrl: 'https://db.example' } },
    };
    global.fetch = async (url, opts) => {
      app.posts.push({ url, opts, body: JSON.parse(opts.body) });
      if (throws) throw new Error(throws);
      return { ok: status >= 200 && status < 300, json: async () => body };
    };
    return app;
  }

  {
    const app = rootParent();
    app.showActivateChildModal.call(app, 'c1');
    const out = app.modals[0];
    ok('the modal is named for the child', /Ruthie/.test(out.title));
    ok('  and says the record already exists', /existing school record/.test(out.content));
    ok('the address field starts empty when there is none on file',
      /id="activate-child-email" value=""/.test(out.content));
    ok('it warns the parent off their own address', /cannot be the one you sign in with/.test(out.content));
    ok('and the confirmation has to be ticked', /id="activate-child-confirm"/.test(out.content));
  }

  {
    const app = rootParent();
    app.showActivateChildModal.call(app, 'c3');
    // A pin-...@pin.rivertech.me address has no inbox behind it, so offering it
    // would send the one email that matters into nothing.
    ok('a PIN placeholder is never offered as the address',
      /id="activate-child-email" value=""/.test(app.modals[0].content));
    ok('  and the placeholder does not appear at all', !/pin\.rivertech\.me/.test(app.modals[0].content));
  }

  {
    const app = rootParent();
    app.showActivateChildModal.call(app, 'not-mine');
    check('a child who is not on the dashboard opens nothing', app.modals, []);
    ok('  and says so', app.notices.some(n => /not on your dashboard/.test(n)));
  }

  {
    const app = rootParent();
    fakeDom({
      'activate-child-email': '',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');
    check('no address sends nothing', app.posts, []);
    ok('  and says what is missing', /Enter the address/.test(document.getElementById('activate-child-error').textContent));
    check('  leaving the button usable', document.getElementById('activate-child-go').disabled, false);
  }

  {
    const app = rootParent();
    fakeDom({
      'activate-child-email': 'not-an-address',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');
    check('a malformed address sends nothing', app.posts, []);
    ok('  and says why', /valid email/.test(document.getElementById('activate-child-error').textContent));
  }

  {
    const app = rootParent();
    fakeDom({
      'activate-child-email': 'ruthie@example.com',
      'activate-child-confirm': { checked: false },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');
    check('an unticked confirmation sends nothing', app.posts, []);
    ok('  and asks for it', /confirm the address/i.test(document.getElementById('activate-child-error').textContent));
  }

  {
    const app = rootParent();
    fakeDom({
      'activate-child-email': '  Ruthie@Example.com ',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');

    const post = app.posts[0];
    ok('it calls the same function the office calls',
      /\/functions\/v1\/admin-activate-student$/.test(post.url));
    check('it names the child', post.body.studentId, 'c1');
    check('the address is trimmed', post.body.email, 'Ruthie@Example.com');
    // Sent twice on purpose: the server refuses if the two disagree, so a stale
    // screen cannot mail a link to an address nobody looked at.
    check('  and confirmed against itself', post.body.confirmedEmail, post.body.email);
    ok('the session is carried', /Bearer tok/.test(post.opts.headers.Authorization));
    check('the modal closes', app.closed, 1);
    ok('and it reports where the link went', app.notices.some(n => /success:.*Ruthie@Example\.com/.test(n)));
    check('the dashboard is rebuilt so the button disappears', app.reloads.length, 1);
  }

  {
    // The one the parent will actually hit: they typed their own address, and
    // one address is one login.
    const app = rootParent({
      status: 409,
      body: { error: 'That is the address you sign in with. Each account needs its own, so give your child an address of their own.' },
    });
    fakeDom({
      'activate-child-email': 'mum@example.com',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');
    ok('the server\'s own words are shown',
      /address you sign in with/.test(document.getElementById('activate-child-error').textContent));
    check('  nothing is closed behind a failure', app.closed, 0);
    check('  and the button comes back', document.getElementById('activate-child-go').disabled, false);
  }

  {
    const app = rootParent({ status: 403, body: { error: 'That child is not linked to your account. Link them first with the code the school gave you.' } });
    fakeDom({
      'activate-child-email': 'someone@example.com',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');
    ok('an unlinked child is refused in words a parent can act on',
      /Link them first with the code/.test(document.getElementById('activate-child-error').textContent));
  }

  {
    // The account opens even when the email does not go out - the school's
    // hourly quota is the usual reason - and saying "done" there would leave a
    // parent waiting for a link that is not coming.
    const app = rootParent({ body: { success: true, emailSent: false, warning: 'hourly limit reached' } });
    fakeDom({
      'activate-child-email': 'ruthie@example.com',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');
    ok('an unsent email is a warning, not a success',
      app.notices.some(n => /^warning:/.test(n) && /no email went out/.test(n)));
    ok('  and repeats the reason', app.notices.some(n => /hourly limit/.test(n)));
  }

  {
    const app = rootParent({ throws: 'network down' });
    fakeDom({
      'activate-child-email': 'ruthie@example.com',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');
    ok('a dropped connection is reported, not swallowed',
      /network down/.test(document.getElementById('activate-child-error').textContent));
    check('  and the dashboard is not rebuilt on a failure', app.reloads.length, 0);
  }

  console.log('\n== the dashboard only offers it where it is needed ==\n');

  async function runParentDashboard(children) {
    const loadParentDashboard = fromRoot('loadParentDashboard');
    const asked = [];

    const table = (name) => {
      const q = {
        _cols: '',
        select(cols) { q._cols = cols; asked.push({ table: name, cols }); return q; },
        eq() { return q; },
        in() { return q; },
        then(res, rej) {
          let data = [];
          if (name === 'parent_child_links') data = children.map(c => ({ child_id: c.id }));
          else if (name === 'user_profiles') {
            data = /enrollment_type/.test(q._cols) && !/first_name/.test(q._cols)
              ? children.map(c => ({ id: c.id, enrollment_type: 'full-time' }))
              : JSON.parse(JSON.stringify(children));
          } else if (name === 'class_enrollments') data = [];
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return q;
    };

    const section = { innerHTML: '' };
    const app = {
      auth: { supabase: { from: table } },
      initCalendar() {},
      childHasLogin: fromRoot('childHasLogin'),
    };
    global.document = { getElementById: () => null };
    await loadParentDashboard.call(app, section, { user: { id: 'p-auth' }, profile: { id: 'p1' } }, 'Mary');
    return { html: section.innerHTML, asked, app };
  }

  {
    const { html, asked } = await runParentDashboard(CHILDREN);
    const profileCols = asked.find(a => a.table === 'user_profiles' && /first_name/.test(a.cols)).cols;
    ok('the dashboard asks whether each child can sign in', /can_login/.test(profileCols));

    ok('a child with no login is offered one', /Open Ruthie's account/.test(html));
    ok('  and told plainly what is missing', /Ruthie has no sign-in yet/.test(html));
    ok('  with the games PIN named as what still works', /games work with their PIN/.test(html));
    ok('a child who already signs in is not', !/Open Eli's account/.test(html));
    check('one button per child who needs one',
      (html.match(/showActivateChildModal/g) || []).length, 2);
  }

  {
    const { html } = await runParentDashboard([CHILDREN[1]]);
    check('a family with nothing to do sees no activation at all',
      (html.match(/showActivateChildModal/g) || []).length, 0);
  }

  {
    // The regression the shared rule exists for.
    const { html } = await runParentDashboard([ENROLLED_NO_LOGIN]);
    ok('a child approved by enrolment is still offered an account',
      /Open Probe's account/.test(html));
    check('  exactly once', (html.match(/showActivateChildModal/g) || []).length, 1);
  }

  console.log('\n== the portal parent page does the same thing ==\n');

  function portalParent({ status = 200, body = { success: true, emailSent: true } } = {}) {
    const app = {
      posts: [],
      notices: [],
      modals: [],
      redraws: 0,
      closed: [],
      currentSection: 'home',
      children: JSON.parse(JSON.stringify(CHILDREN)),
      escapeHtml: esc,
      showModal(id, title, content) { app.modals.push({ id, title, content }); },
      closeModal(id) { app.closed.push(id); },
      showNotification(m, k) { app.notices.push(`${k}:${m}`); },
      setupHomeContent() { app.redraws++; },
      supabaseQuery: (fn) => fn(),
      auth: { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } },
    };
    app.showActivateChildModal = fromPortal('showActivateChildModal');
    app.confirmActivateChild = fromPortal('confirmActivateChild');

    global.fetch = async (url, opts) => {
      app.posts.push({ url, body: JSON.parse(opts.body) });
      return { ok: status >= 200 && status < 300, json: async () => body };
    };
    return app;
  }

  {
    const app = portalParent();
    app.showActivateChildModal.call(app, 'c1');
    ok('the portal modal is the same offer', /existing school record/.test(app.modals[0].content));
    ok('  named for the child', /Ruthie/.test(app.modals[0].title));
  }

  {
    const app = portalParent();
    fakeDom({
      'activate-child-email': 'ruthie@example.com',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');

    // Both copies have to send the same shape, or one of them is quietly a
    // different feature.
    check('the portal sends the same body', app.posts[0].body,
      { studentId: 'c1', email: 'ruthie@example.com', confirmedEmail: 'ruthie@example.com' });
    check('the modal closes by name', app.closed, ['activate-child']);
    check('the child is marked as able to sign in', app.children.find(c => c.id === 'c1').can_login, true);
    check('  and carries the address that was used', app.children.find(c => c.id === 'c1').email, 'ruthie@example.com');
    check('the home page is redrawn so the button goes', app.redraws, 1);
  }

  {
    const app = portalParent({ status: 409, body: { error: 'Eli Argon already uses that address.' } });
    fakeDom({
      'activate-child-email': 'eli@example.com',
      'activate-child-confirm': { checked: true },
      'activate-child-error': { textContent: '', style: {} },
      'activate-child-go': { disabled: false, textContent: 'Send the link' },
    });
    await app.confirmActivateChild.call(app, 'c1');
    ok('a clash is named', /already uses that address/.test(document.getElementById('activate-child-error').textContent));
    check('  and nothing is marked activated', app.children.find(c => c.id === 'c1').can_login, false);
    check('  nor redrawn', app.redraws, 0);
  }

  {
    const getParentHomeContent = fromPortal('getParentHomeContent');
    const app = {
      children: JSON.parse(JSON.stringify(CHILDREN)).map(c => ({ ...c, classes: [] })),
      messageThreads: [],
      supabaseQuery: () => Promise.resolve({ count: 0 }),
      _renderMoreSectionsCard: () => '',
      isActivated: fromPortal('isActivated'),
    };
    global.document = { getElementById: () => null };
    const html = getParentHomeContent.call(app);

    ok('the portal row flags a child with no sign-in', /No sign-in yet/.test(html));
    check('  once per child who needs it',
      (html.match(/showActivateChildModal/g) || []).length, 2);
    ok('the button does not also open the child\'s details',
      /event\.stopPropagation\(\); app\.showActivateChildModal/.test(html));
  }

  {
    const getParentHomeContent = fromPortal('getParentHomeContent');
    const app = {
      children: [{ ...ENROLLED_NO_LOGIN, classes: [] }],
      messageThreads: [],
      supabaseQuery: () => Promise.resolve({ count: 0 }),
      _renderMoreSectionsCard: () => '',
      isActivated: fromPortal('isActivated'),
    };
    global.document = { getElementById: () => null };
    check('the portal agrees about the enrolment case',
      (getParentHomeContent.call(app).match(/showActivateChildModal/g) || []).length, 1);
  }

  {
    const getParentHomeContent = fromPortal('getParentHomeContent');
    const app = {
      children: [{ ...CHILDREN[1], classes: [] }],
      messageThreads: [],
      supabaseQuery: () => Promise.resolve({ count: 0 }),
      _renderMoreSectionsCard: () => '',
      isActivated: fromPortal('isActivated'),
    };
    global.document = { getElementById: () => null };
    const html = getParentHomeContent.call(app);
    check('a child who signs in is left alone',
      (html.match(/showActivateChildModal/g) || []).length, 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
