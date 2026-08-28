#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Account email change — validation gate + profile-mirror sync.
//
// Changing the sign-in email touches two stores that can silently disagree:
// Supabase Auth (what you log in with) and user_profiles.email (the mirror the
// rest of the app actually reads — notification recipients, enrollment RLS,
// directory lookups). The failure this guards against is a half-applied change:
// Auth moves, the mirror doesn't, and the user's notifications keep going to an
// address they no longer own.
//
// Two things are checked against the SHIPPED code (brace-matched out of
// portal/index.html and shared/config.js, same technique as the other
// harnesses, so neither can drift from what deploys):
//
//   A. changeEmail()        — the client gate. Must refuse empty / malformed /
//                             mismatched / unchanged / reserved addresses, and
//                             must NOT write the mirror itself (the new address
//                             isn't proven until the links are clicked).
//   B. _syncProfileEmail()  — the mirror. Must copy a confirmed auth email onto
//                             the profile, and must hold its fire for the three
//                             cases where writing would be wrong.
//
// Run:  node debug-tools/email-change.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOTS = [
  path.join(__dirname, '..'),
  path.join(__dirname, '..', 'student-portal'),
  process.cwd(),
];
const root = ROOTS.find(r => fs.existsSync(path.join(r, 'portal', 'index.html')));
if (!root) { console.error('email-change: could not locate portal/index.html'); process.exit(2); }

const PORTAL = fs.readFileSync(path.join(root, 'portal', 'index.html'), 'utf8');
const CONFIG = fs.readFileSync(path.join(root, 'shared', 'config.js'), 'utf8');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function bodyOf(src, name) {
  const re = new RegExp('\\n\\s+(?:async\\s+)?(?:get\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src); if (!m) throw new Error('not found: ' + name);
  let p = src.indexOf('(', m.index), pd = 0;
  for (; p < src.length; p++) { if (src[p] === '(') pd++; else if (src[p] === ')') { pd--; if (!pd) { p++; break; } } }
  let i = src.indexOf('{', p), d = 0, start = i;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) { i++; break; } } }
  const sig = src.slice(m.index + 1, start).trim();
  return {
    args: sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')),
    body: src.slice(start + 1, i - 1),
    isAsync: /^async\b/.test(sig),
  };
}
const fn = (src, n) => {
  const b = bodyOf(src, n);
  const Ctor = b.isAsync ? AsyncFunction : Function;
  return new Ctor(...b.args.split(',').map(s => s.trim()).filter(Boolean), b.body);
};

const changeEmail         = fn(PORTAL, 'changeEmail');
const isPlaceholderEmail  = fn(PORTAL, '_isPlaceholderEmail');
const syncProfileEmail    = fn(CONFIG, '_syncProfileEmail');

// ── minimal DOM / globals ────────────────────────────────────────────────────
global.window = { location: { origin: 'https://rivertech.me' } };
let els = {};
const mkEl = () => ({ value: '', textContent: '', innerHTML: '', style: {} });
global.document = { getElementById: (id) => els[id] || null };
// Capture the real logger for reporting BEFORE muting the code under test,
// which chats to console.log/warn on every sync.
const say = console.log.bind(console);
global.console = { ...console, log: () => {}, warn: () => {}, error: () => {} };

function freshDom() {
  els = {};
  for (const id of ['new-email', 'confirm-new-email', 'email-error', 'change-email-btn',
                    'current-email-display', 'email-pending-notice', 'change-email-card']) {
    els[id] = mkEl();
  }
}

// ── harness state ────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// ── A. changeEmail() validation gate ─────────────────────────────────────────
async function runChange({ current = 'old@example.com', next, confirm }) {
  freshDom();
  els['new-email'].value = next;
  els['confirm-new-email'].value = confirm === undefined ? next : confirm;

  const calls = [];
  const ctx = {
    userInfo: { user: { email: current, id: 'u1' } },
    auth: {
      supabase: {
        auth: {
          updateUser: async (attrs, opts) => { calls.push({ attrs, opts }); return { error: null }; },
          getUser: async () => ({ data: { user: { email: current, new_email: next, id: 'u1' } } }),
        },
      },
    },
    showNotification: () => {},
    _escapeHtml: (s) => String(s == null ? '' : s),
    _isPlaceholderEmail: isPlaceholderEmail,
    _renderEmailSettings: () => {},
  };

  await changeEmail.call(ctx);
  return { calls, error: els['email-error'].style.display === 'block' ? els['email-error'].textContent : null };
}

const REJECT = [
  ['empty address',      { next: '' }],
  ['whitespace only',    { next: '   ' }],
  ['no @',               { next: 'notanemail' }],
  ['no domain dot',      { next: 'a@b' }],
  ['trailing space typo',{ next: 'new @example.com' }],
  ['mismatched confirm', { next: 'new@example.com', confirm: 'niw@example.com' }],
  ['same as current',    { next: 'old@example.com' }],
  ['same, different case',{ next: 'OLD@Example.com' }],
  ['reserved pin domain',{ next: 'pin-abc@pin.rivertech.me' }],
];

const ACCEPT = [
  ['plain address',      { next: 'new@example.com' }],
  ['case-insensitive confirm', { next: 'New@Example.com', confirm: 'new@example.com' }],
  ['plus addressing',    { next: 'parent+school@example.com' }],
  ['subdomain',          { next: 'a@mail.example.co.uk' }],
];

async function sectionA() {
  say('A. changeEmail() — client validation gate');

  for (const [label, args] of REJECT) {
    const { calls, error } = await runChange(args);
    check(`A/reject: ${label}`, calls.length === 0 && !!error,
          calls.length ? 'sent to Supabase anyway' : 'no error message shown');
  }

  for (const [label, args] of ACCEPT) {
    const { calls, error } = await runChange(args);
    check(`A/accept: ${label}`, calls.length === 1 && !error,
          error ? `blocked with "${error}"` : 'never reached Supabase');
  }

  // Shape of the call that does go out.
  const { calls } = await runChange({ next: 'new@example.com' });
  const c = calls[0] || {};
  check('A/call: sends email attribute', c.attrs && c.attrs.email === 'new@example.com');
  check('A/call: sends no other auth attribute', c.attrs && Object.keys(c.attrs).length === 1,
        'extra attributes: ' + Object.keys(c.attrs || {}).join(','));
  check('A/call: redirects to confirm.html', /\/confirm\.html/.test(c.opts?.emailRedirectTo || ''),
        'emailRedirectTo=' + (c.opts?.emailRedirectTo || 'MISSING'));

  // The mirror must NOT be written here — the address isn't proven yet.
  const body = bodyOf(PORTAL, 'changeEmail').body;
  check('A/safety: does not write user_profiles', !/user_profiles/.test(body),
        'changeEmail() touches user_profiles directly');

  // Clearing the inputs matters: a stale value + a later click would re-send.
  freshDom();
  els['new-email'].value = 'new@example.com';
  els['confirm-new-email'].value = 'new@example.com';
  const ctx = {
    userInfo: { user: { email: 'old@example.com', id: 'u1' } },
    auth: { supabase: { auth: {
      updateUser: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { email: 'old@example.com', new_email: 'new@example.com' } } }),
    } } },
    showNotification: () => {}, _escapeHtml: (s) => String(s ?? ''),
    _isPlaceholderEmail: isPlaceholderEmail, _renderEmailSettings: () => {},
  };
  await changeEmail.call(ctx);
  check('A/state: clears both inputs on success',
        els['new-email'].value === '' && els['confirm-new-email'].value === '');

  // Supabase errors must surface, not silently no-op.
  for (const [label, message, expect] of [
    ['duplicate', 'A user with this email address has already been registered', /already in use/i],
    ['ratelimit', 'For security purposes, you can only request this after 47 seconds', /too many|wait/i],
    ['invalid',   'Unable to validate email address: invalid format',              /reject|double-check/i],
  ]) {
    freshDom();
    els['new-email'].value = 'new@example.com';
    els['confirm-new-email'].value = 'new@example.com';
    const c2 = {
      userInfo: { user: { email: 'old@example.com', id: 'u1' } },
      auth: { supabase: { auth: { updateUser: async () => ({ error: new Error(message) }) } } },
      showNotification: () => {}, _escapeHtml: (s) => String(s ?? ''),
      _isPlaceholderEmail: isPlaceholderEmail, _renderEmailSettings: () => {},
    };
    await changeEmail.call(c2);
    const shown = els['email-error'].style.display === 'block' ? els['email-error'].textContent : '';
    check(`A/error: ${label} is explained`, expect.test(shown), `showed "${shown}"`);
    check(`A/error: ${label} re-enables the button`, els['change-email-btn'].disabled === false);
  }
}

// ── B. _syncProfileEmail() — the mirror ──────────────────────────────────────
function mkAuth(updateResult = { error: null }) {
  const writes = [];
  return {
    writes,
    userProfile: null,
    supabase: {
      from: (table) => ({
        update: (patch) => ({
          eq: async (col, val) => { writes.push({ table, patch, col, val }); return updateResult; },
        }),
      }),
    },
    _syncProfileEmail: syncProfileEmail,
  };
}

async function sectionB() {
  say('B. _syncProfileEmail() — user_profiles mirror');

  // Writes when Auth and the mirror disagree.
  {
    const a = mkAuth();
    const profile = { email: 'old@example.com', auth_user_id: 'auth-1' };
    a.userProfile = profile;
    await a._syncProfileEmail.call(a, { id: 'auth-1', email: 'new@example.com' }, profile);
    check('B/write: syncs a changed address', a.writes.length === 1);
    check('B/write: targets user_profiles', a.writes[0]?.table === 'user_profiles');
    check('B/write: keys on auth_user_id (matches RLS)',
          a.writes[0]?.col === 'auth_user_id' && a.writes[0]?.val === 'auth-1',
          `keyed on ${a.writes[0]?.col}`);
    check('B/write: only touches email',
          Object.keys(a.writes[0]?.patch || {}).join(',') === 'email');
    check('B/write: updates the in-memory profile', profile.email === 'new@example.com',
          `profile.email still ${profile.email}`);
  }

  // The three cases where writing would be wrong.
  const HOLD = [
    ['already in step',            { id: 'a', email: 'same@example.com' }, { email: 'same@example.com', auth_user_id: 'a' }],
    ['in step, different case',    { id: 'a', email: 'Same@Example.com' }, { email: 'same@example.com', auth_user_id: 'a' }],
    ['PIN placeholder auth email', { id: 'a', email: 'pin-1234@pin.rivertech.me' }, { email: 'real@example.com', auth_user_id: 'a' }],
    ['legacy row, no auth_user_id',{ id: 'a', email: 'new@example.com' },  { email: 'old@example.com', auth_user_id: null }],
    ['no auth email at all',       { id: 'a', email: null },               { email: 'old@example.com', auth_user_id: 'a' }],
  ];
  for (const [label, user, profile] of HOLD) {
    const a = mkAuth();
    a.userProfile = profile;
    const before = profile.email;
    await a._syncProfileEmail.call(a, user, profile);
    check(`B/hold: ${label}`, a.writes.length === 0, 'wrote anyway');
    check(`B/hold: ${label} leaves the mirror alone`, profile.email === before);
  }

  // A PIN placeholder must never end up ON the profile.
  {
    const a = mkAuth();
    const profile = { email: 'real@example.com', auth_user_id: 'a' };
    a.userProfile = profile;
    await a._syncProfileEmail.call(a, { id: 'a', email: 'pin-9@pin.rivertech.me' }, profile);
    check('B/pin: real address survives a PIN sign-in', profile.email === 'real@example.com',
          `overwritten with ${profile.email}`);
  }

  // Never break sign-in: a failed or throwing update must be swallowed.
  {
    const a = mkAuth({ error: { message: 'RLS denied' } });
    const profile = { email: 'old@example.com', auth_user_id: 'a' };
    let threw = false;
    try { await a._syncProfileEmail.call(a, { id: 'a', email: 'new@example.com' }, profile); }
    catch (e) { threw = true; }
    check('B/resilience: RLS denial does not throw', !threw);
    check('B/resilience: mirror not falsely updated on failure', profile.email === 'old@example.com');
  }
  {
    const a = { supabase: { from: () => { throw new Error('network down'); } }, _syncProfileEmail: syncProfileEmail };
    let threw = false;
    try { await a._syncProfileEmail.call(a, { id: 'a', email: 'new@example.com' }, { email: 'x', auth_user_id: 'a' }); }
    catch (e) { threw = true; }
    check('B/resilience: transport error does not throw', !threw);
  }
}

// ── C. wiring ────────────────────────────────────────────────────────────────
function sectionC() {
  say('C. wiring');
  check('C: loadUserProfile() calls the sync', /_syncProfileEmail\(user, profiles\[0\]\)/.test(CONFIG));
  check('C: renderProfile() populates the card', /_renderEmailSettings\(\)/.test(PORTAL));
  check('C: the card is in the Profile section', /id="change-email-card"/.test(PORTAL));
  check('C: button is wired to changeEmail()', /onclick="app\.changeEmail\(\)"/.test(PORTAL));

  const confirmHtml = fs.readFileSync(path.join(root, 'confirm.html'), 'utf8');
  check('C: confirm.html handles email_change', /email_change/.test(confirmHtml));
  check('C: confirm.html syncs the mirror', /syncProfileEmail\(supabaseClient/.test(confirmHtml));
  check('C: confirm.html waits on the second link', /new_email/.test(confirmHtml));

  // config.js changed — every page that pins a version must bust its cache,
  // or browsers keep the old file and the mirror never syncs.
  const versioned = [];
  for (const f of ['confirm.html', 'index.html', 'pin-login.html', 'reset.html', path.join('portal', 'index.html')]) {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    const m = html.match(/shared\/config\.js\?v=(\d+)/);
    if (m) versioned.push([f, Number(m[1])]);
  }
  check('C: every versioned page pins config.js', versioned.length === 5, `found ${versioned.length}`);
  check('C: all on the same config.js version', new Set(versioned.map(v => v[1])).size === 1,
        versioned.map(v => `${v[0]}=${v[1]}`).join(' '));
  check('C: version bumped past v10 (the sync shipped in v11)',
        versioned.every(v => v[1] >= 11), versioned.map(v => v[1]).join(','));
}

// ── D. password-field ID collision ───────────────────────────────────────────
// Not the email feature, but the same page and the same failure mode, and it
// cost a teacher their account setup: showModal() appends to document.body, so
// the "Set Your Password" modal lands AFTER the Profile section's own Change
// Password inputs. Both used id="new-password" / id="confirm-password", so
// getElementById handed handlePasswordSetup the profile's empty fields and
// every attempt died on "Please fill in both password fields".
function sectionD() {
  say('D. password field IDs (setup modal vs profile card)');

  const setupBody = bodyOf(PORTAL, 'handlePasswordSetup').body;
  const ids = [...setupBody.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

  check('D: handlePasswordSetup reads two fields', ids.length >= 2, `found ${ids.length}`);

  for (const id of ids) {
    const occurrences = (PORTAL.match(new RegExp(`id="${id}"`, 'g')) || []).length;
    check(`D: id="${id}" is unique in the document`, occurrences === 1,
          `appears ${occurrences}x — getElementById will resolve to the first, not the modal`);
  }

  // And the fields the modal renders must be the ones the handler reads.
  const modalBody = bodyOf(PORTAL, 'showPasswordSetupModal').body;
  for (const id of ids) {
    check(`D: setup modal actually renders id="${id}"`, modalBody.includes(`id="${id}"`));
  }

  // The profile card's own fields must stay distinct from the modal's.
  const changeBody = bodyOf(PORTAL, 'changePassword').body;
  const profileIds = [...changeBody.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const overlap = profileIds.filter(id => ids.includes(id));
  check('D: profile Change Password reads different IDs than setup',
        overlap.length === 0, 'shared: ' + overlap.join(','));
}

// ── E. invite-link token hand-off ────────────────────────────────────────────
// supabase-js ends _getSessionFromURL() with a literal `window.location.hash = ""`
// as soon as it detects an implicit grant, and that runs inside createClient().
// confirm.html's redirects fire on a 1.5s timer, long after — so building the
// next URL from window.location.hash handed root index.html an empty fragment,
// its `needsPasswordSetup && accessToken` gate failed, and an invited teacher
// landed on the ordinary login screen instead of the password-setup modal.
function sectionE() {
  say('E. invite link → password setup hand-off');

  const confirmHtml = fs.readFileSync(path.join(root, 'confirm.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  // The library behaviour this all hinges on. If a supabase-js upgrade ever
  // stops clearing the hash, this check tells you the workaround is now moot.
  const lib = fs.readFileSync(path.join(root, 'shared', 'supabase.min.js'), 'utf8');
  check('E: supabase-js still clears the hash (the reason sessionHash exists)',
        /window\.location\.hash\s*=\s*""/.test(lib));

  // Redirects that must carry the session forward.
  const carriers = [
    ["/index.html?setup_password=true", 'teacher setup'],
    ["'/' + ", 'portal hand-off'],
  ];
  check('E: teacher-setup redirect uses the rebuilt fragment',
        /setup_password=true'\s*\+\s*sessionHash/.test(confirmHtml),
        'still concatenating window.location.hash');
  check('E: no session-carrying redirect reads window.location.hash',
        !/href\s*=\s*'\/index\.html\?setup_password=true'\s*\+\s*window\.location\.hash/.test(confirmHtml) &&
        !/href\s*=\s*'\/'\s*\+\s*window\.location\.hash/.test(confirmHtml));
  check('E: sessionHash is built from the captured tokens',
        /const sessionHash\s*=[\s\S]{0,240}access_token=/.test(confirmHtml));

  // Root must not require the fragment.
  check('E: root does not gate password setup on a URL token',
        !/needsPasswordSetup\s*&&\s*accessToken/.test(indexHtml),
        'still requires accessToken, so a cleared hash skips the modal');
  check('E: root falls back to the persisted session',
        /handleTeacherPasswordSetup[\s\S]{0,1600}auth\.getSession\(\)/.test(indexHtml));

  // A dead link should say so rather than dumping the user on a login screen.
  check('E: confirm.html reports expired/used links', /hashError/.test(confirmHtml));
}

// ── run ──────────────────────────────────────────────────────────────────────
(async () => {
  await sectionA();
  await sectionB();
  sectionC();
  sectionD();
  sectionE();

  say('');
  if (fail) {
    say('FAILURES:');
    failures.forEach(f => say('  ✗ ' + f));
  }
  say(`\n${pass}/${pass + fail} checks passed`);
  // exitCode, not process.exit(): on Windows stdout is an async pipe and
  // process.exit() discards whatever is still queued — which ate this very
  // summary line the first time round.
  process.exitCode = fail ? 1 : 0;
})();
