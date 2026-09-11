// Two profiles, one child.
//
// Students were pre-added by staff; some then signed themselves up, which made
// a second profile — a working login carrying none of the history. The records
// are on one row and the login is on the other.
//
// The dangerous part is not the merge, it is the CHOICE. The keeper is not
// always the older row: a self-made profile can hold a month of Dojo progress
// while the pre-added row holds the enrolments. So the screen has to put the
// record counts in front of the person before they pick, and again in the
// confirmation — "merge" on its own hides the only thing worth checking, which
// is whether the row about to be removed is the one with the history on it.
//
// Run: node tests/merge-duplicate-students.test.js

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
  const Ctor = /async\s/.test(m[0])
    ? Object.getPrototypeOf(async function () {}).constructor
    : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// The real shape: the self-made row has the login and the Dojo progress, the
// pre-added row has the enrolments and a year of attendance.
const GROUP = {
  name: 'Ruthie Argon',
  profiles: [
    { id: 'old', first_name: 'Ruthie', last_name: 'Argon', email: null, account_status: 'inactive',
      has_login: false, created_at: '2026-09-02T00:00:00Z', records: 6 },
    { id: 'new', first_name: 'ruthie', last_name: 'argon', email: 'r@x.com', account_status: 'activated',
      has_login: true, created_at: '2026-09-05T00:00:00Z', records: 32 },
  ],
};

function makeApp({ picked = null, confirms = true, rpcError = null } = {}) {
  const app = {
    calls: [], notices: [], modal: '', confirmed: '',
    _dupGroups: [GROUP],
    escapeHtml: (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    showNotification(m, k) { this.notices.push(`${k}:${m}`); },
    showModal(id, title, content) { this.modal = content; },
    closeModal() {},
    async renderAdminStudentRecords() {},
    async supabaseQuery(fn) { return fn(); },
    auth: {
      supabase: {
        rpc: (fn, args) => {
          app.calls.push({ fn, args });
          if (rpcError) return Promise.resolve({ data: null, error: new Error(rpcError) });
          if (fn === 'rt_duplicate_students') return Promise.resolve({ data: [GROUP], error: null });
          return Promise.resolve({
            data: { success: true, rows_moved: 31, rows_dropped: 1, took_login: true, orphan_auth_user: null },
            error: null,
          });
        },
      },
    },
  };
  global.document = { querySelector: () => (picked ? { value: picked } : null) };
  global.confirm = (msg) => { app.confirmed = msg; return confirms; };
  app.showDuplicateStudents = extract('showDuplicateStudents');
  app._renderDuplicateStudents = extract('_renderDuplicateStudents');
  app.mergeDuplicateStudents = extract('mergeDuplicateStudents');
  return app;
}

(async () => {
  console.log('\n== what the screen shows before you choose ==\n');

  {
    const app = makeApp();
    await app.showDuplicateStudents.call(app);
    check('it asks the database for the groups', app.calls[0].fn, 'rt_duplicate_students');
    const out = app.modal;
    ok('both profiles are listed', /Ruthie/.test(out) && /ruthie/.test(out));
    // The number that decides it.
    ok('each says how much it is carrying', /32 records/.test(out) && /6 records/.test(out));
    ok('and which one can sign in', /has login/.test(out));
    ok('the keeper is a choice, not an assumption', /type="radio"/.test(out));
    ok('  with nothing pre-selected', !/type="radio"[^>]*checked/.test(out));
    ok('it says what merging will do', /moves across/.test(out));
  }

  {
    const app = makeApp();
    app._dupGroups = [];
    app._renderDuplicateStudents.call(app);
    ok('no duplicates says so plainly', /No duplicates/.test(app.modal));
  }

  console.log('\n== choosing, and being asked to confirm ==\n');

  {
    const app = makeApp({ picked: null });
    await app.mergeDuplicateStudents.call(app, 0);
    check('nothing happens without a choice', app.calls, []);
    ok('  and it says to choose', app.notices.some(n => /choose which profile to keep/i.test(n)));
  }

  {
    const app = makeApp({ picked: 'old', confirms: false });
    await app.mergeDuplicateStudents.call(app, 0);
    // The confirmation is the last place to notice you are about to delete the
    // row with the history on it.
    ok('the prompt names the keeper\'s record count', /Keep the profile with 6 records/.test(app.confirmed));
    ok('  and what the removed row is carrying', /removing a profile with 32 records/.test(app.confirmed));
    ok('  and that it cannot be undone', /cannot be undone/.test(app.confirmed));
    check('declining writes nothing', app.calls, []);
  }

  console.log('\n== merging ==\n');

  {
    const app = makeApp({ picked: 'old' });
    await app.mergeDuplicateStudents.call(app, 0);
    check('it merges into the chosen row', app.calls[0].args, { p_keep: 'old', p_drop: 'new' });
    check('  once per other profile', app.calls.filter(c => c.fn === 'rt_merge_student').length, 1);
    const said = app.notices.join(' ');
    ok('it reports what moved', /31 records moved/.test(said));
    ok('  including what was dropped as duplicate', /1 duplicate dropped/.test(said));
    ok('  and that the login came across', /login carried over/.test(said));
  }

  {
    // Keeping the self-made row is a legitimate choice too, and the direction
    // has to follow the choice rather than the dates.
    const app = makeApp({ picked: 'new' });
    await app.mergeDuplicateStudents.call(app, 0);
    check('the other direction works the same', app.calls[0].args, { p_keep: 'new', p_drop: 'old' });
  }

  {
    const app = makeApp({ picked: 'old', rpcError: 'boom' });
    await app.mergeDuplicateStudents.call(app, 0);
    ok('a failure says nothing was changed',
      app.notices.some(n => /nothing was changed/i.test(n)));
  }

  console.log('\n== and the rules the function has to keep ==\n');

  const sqlPath = path.join(__dirname, '..', '..', 'student-portal-backend', 'supabase', 'migrations',
    'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_merge_duplicate_students.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const body = sql.replace(/^\s*--.*$/gm, '');
    // 35 of the 68 student-identity columns in this schema carry NO foreign
    // key, including daily_attendance and student_schedule. Walking the foreign
    // keys — the obvious way to write this — would have left a year of
    // attendance pointing at a profile that no longer exists.
    ok('the columns are discovered, not written down',
      /information_schema\.columns/.test(body) && /'student_id','user_id','child_id'/.test(body));
    check('  it does not walk the foreign keys instead', /confrelid/.test(body), false);
    ok('a collision drops one row, not the table',
      /WHEN unique_violation OR foreign_key_violation THEN/.test(body)
      && /DELETE FROM public\.%I WHERE id = \$1/.test(body));
    ok('the loser goes before the keeper takes its email',
      body.indexOf('DELETE FROM public.user_profiles WHERE id = p_drop')
        < body.indexOf("account_status = 'activated'"));
    ok('the login only moves when the keeper has none',
      /v_keep\.auth_user_id IS NULL AND v_lose\.auth_user_id IS NOT NULL/.test(body));
    ok('it is admin only', /<> 'admin' THEN\s*\n\s*RAISE EXCEPTION 'Admins only'/.test(body));
    ok('merging a profile into itself is refused', /p_keep = p_drop THEN/.test(body));
    ok('the leftover sign-in is reported rather than hidden', /orphan_auth_user/.test(body));
  } else {
    console.log('skip  the backend repo is not checked out beside this one');
  }

  console.log('\n== who is offered it ==\n');

  // The screen is reachable by a teacher through the section hash, and the
  // database refuses the merge to anyone but an admin. A button that answers
  // "Admins only" is worse than no button at all.
  ok('the button is admin-only',
    /\$\{isAdmin \? `<button class="btn btn-secondary" onclick="app\.showDuplicateStudents\(\)">/.test(html));
  ok('  with isAdmin read from the profile',
    /const isAdmin = this\.userInfo\.profile\?\.user_type === 'admin';/.test(html));
  ok('it sits on the Student Records screen',
    html.indexOf('showDuplicateStudents()') > html.indexOf('async renderAdminStudentRecords()'));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
