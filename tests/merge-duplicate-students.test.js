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

// The pair the automatic list will never surface: same child, different name.
const ROSTER = [
  { id: 'eli',  first_name: 'Eli',    last_name: 'Killackey', grade_level: '6',
    email: null, account_status: 'inactive', has_login: false,
    date_of_birth: '2014-03-02', created_at: '2026-01-04T00:00:00Z', records: 88 },
  { id: 'elij', first_name: 'Elijah', last_name: 'Killackey', grade_level: '6',
    email: 'e@x.com', account_status: 'activated', has_login: true,
    date_of_birth: '2014-03-02', created_at: '2026-09-08T00:00:00Z', records: 3 },
  // Two different children who would score alike on any name-similarity test.
  { id: 'samh', first_name: 'Sam',      last_name: 'Hahn', grade_level: '4',
    email: null, account_status: 'inactive', has_login: false,
    date_of_birth: '2016-05-09', created_at: '2025-11-13T00:00:00Z', records: 40 },
  { id: 'sama', first_name: 'Samantha', last_name: 'Hahn', grade_level: '8',
    email: null, account_status: 'activated', has_login: true,
    date_of_birth: '2012-07-21', created_at: '2025-11-13T00:00:00Z', records: 227 },
];

// Two genuine conflicts, one field only the removed profile has, and a couple
// of tables of records.
const PREVIEW = {
  a: { id: 'eli', first_name: 'Eli', last_name: 'Killackey', login_email: null, records: 88 },
  b: { id: 'elij', first_name: 'Elijah', last_name: 'Killackey', login_email: 'eli@x.com', records: 3 },
  fields: [
    { column: 'email', a: 'office@x.com', b: 'eli@x.com', status: 'conflict',
      a_label: 'office@x.com', b_label: 'eli@x.com' },
    { column: 'first_name', a: 'Eli', b: 'Elijah', status: 'conflict',
      a_label: 'Eli', b_label: 'Elijah' },
    { column: 'auth_user_id', a: null, b: 'auth-2', status: 'only_b',
      a_label: null, b_label: 'eli@x.com' },
  ],
  tables: [
    { table: 'daily_attendance', column: 'student_id', a_rows: 76, b_rows: 2 },
    { table: 'skill_progress', column: 'user_id', a_rows: 0, b_rows: 28 },
  ],
};

function makeApp({ picked = null, confirms = true, rpcError = null, keep = '', drop = '' } = {}) {
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
          if (fn === 'rt_student_merge_candidates') return Promise.resolve({ data: ROSTER, error: null });
          if (fn === 'rt_merge_preview') return Promise.resolve({ data: PREVIEW, error: null });
          return Promise.resolve({
            data: { success: true, rows_moved: 31, rows_dropped: 1, took_login: true, orphan_auth_user: null },
            error: null,
          });
        },
      },
    },
  };
  const preview = { innerHTML: '' };
  app._preview = preview;
  app._mergeRoster = ROSTER;
  global.document = {
    querySelector: () => (picked ? { value: picked } : null),
    getElementById: (id) => id === 'merge-keep' ? { value: keep }
                          : id === 'merge-drop' ? { value: drop }
                          : id === 'merge-preview' ? preview : null,
  };
  global.confirm = (msg) => { app.confirmed = msg; return confirms; };
  app.showDuplicateStudents = extract('showDuplicateStudents');
  app._renderDuplicateStudents = extract('_renderDuplicateStudents');
  app.mergeDuplicateStudents = extract('mergeDuplicateStudents');
  app._renderMergePreview = extract('_renderMergePreview');
  app.mergePickedStudents = extract('mergePickedStudents');
  app._runStudentMerge = extract('_runStudentMerge');
  app.openMergeReview = extract('openMergeReview');
  app._renderMergeReview = extract('_renderMergeReview');
  app._mergeFieldLabel = extract('_mergeFieldLabel');
  app._setMergeChoice = extract('_setMergeChoice');
  app.submitReviewedMerge = extract('submitReviewedMerge');
  app.jsAttr = (t) => String(t == null ? '' : t).replace(/'/g, "\\'");
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
    ok('no exact-name duplicates says so plainly', /No exact-name duplicates/.test(app.modal));
    ok('  and points at the picker for the rest', /picker above/.test(app.modal));
  }

  console.log('\n== choosing, and being asked to confirm ==\n');

  {
    const app = makeApp({ picked: null });
    await app.mergeDuplicateStudents.call(app, 0);
    check('nothing happens without a choice', app.calls, []);
    ok('  and it says to choose', app.notices.some(n => /choose which profile to keep/i.test(n)));
  }

  {
    // The chosen keeper decides the DIRECTION of the review, and the review is
    // where the irreversible step now lives.
    const app = makeApp({ picked: 'old' });
    await app.mergeDuplicateStudents.call(app, 0);
    check('the choice sets which way round it is reviewed',
      app.calls[0].args, { p_a: 'old', p_b: 'new' });
  }

  {
    // Keeping the self-made row is a legitimate choice too, and the direction
    // has to follow the choice rather than the dates.
    const app = makeApp({ picked: 'new' });
    await app.mergeDuplicateStudents.call(app, 0);
    check('the other direction works the same', app.calls[0].args, { p_a: 'new', p_b: 'old' });
  }

  console.log('\n== merging ==\n');

  {
    const app = makeApp({ keep: 'eli', drop: 'elij' });
    await app.openMergeReview.call(app, 'eli', 'elij');
    await app.submitReviewedMerge.call(app);
    const call = app.calls.find(c => c.fn === 'rt_merge_student');
    check('it merges in the reviewed direction', [call.args.p_keep, call.args.p_drop], ['eli', 'elij']);
    const said = app.notices.join(' ');
    ok('it reports what moved', /31 records moved/.test(said));
    ok('  including what was dropped as duplicate', /1 duplicate dropped/.test(said));
    ok('  and that the login came across', /login carried over/.test(said));
  }

  {
    const app = makeApp({ keep: 'eli', drop: 'elij', rpcError: 'boom' });
    await app.openMergeReview.call(app, 'eli', 'elij');
    ok('a preview that fails says so', app.notices.some(n => /Couldn't compare them/.test(n)));
  }

  {
    const app = makeApp({ keep: 'eli', drop: 'elij' });
    await app.openMergeReview.call(app, 'eli', 'elij');
    // Fail only the merge, after the preview has already been fetched.
    app.auth.supabase.rpc = (fn, args) => {
      app.calls.push({ fn, args });
      return Promise.resolve({ data: null, error: new Error('boom') });
    };
    await app.submitReviewedMerge.call(app);
    ok('a failed merge says nothing was changed',
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

  console.log('\n== picking any two ==\n');

  {
    const app = makeApp();
    await app.showDuplicateStudents.call(app);
    const out = app.modal;
    ok('the picker is offered above the automatic list', /Merge any two profiles/.test(out));
    ok('  with every student in both lists',
      (out.match(/Killackey, Eli\b/g) || []).length === 2);
    // A name alone cannot answer "which one has the history".
    ok('  each option says what it carries', /88 records/.test(out) && /3 records/.test(out));
    ok('  and which can sign in', /has login/.test(out));
    ok('the picker says what it is for',
      /Eli and Elijah/.test(out) && /cannot spot/.test(out));
  }

  {
    // Eli / Elijah: same birthday, one row nearly empty. The case the automatic
    // finder cannot see.
    const app = makeApp({ keep: 'eli', drop: 'elij' });
    app._renderMergePreview.call(app);
    const p = app._preview.innerHTML;
    ok('the preview names both sides', /Keeping/.test(p) && /Removing/.test(p));
    ok('  with their record counts', /88 records/.test(p) && /3 records/.test(p));
    ok('  and their birthdays', /2014-03-02/.test(p));
    check('  no warning when the keeper has more', /more records than/.test(p), false);
    check('  and none about birthdays that agree', /different dates of birth/.test(p), false);
  }

  {
    // Removing the row with the history is a real mistake, so say so.
    const app = makeApp({ keep: 'elij', drop: 'eli' });
    app._renderMergePreview.call(app);
    ok('it warns when the removed row holds more',
      /more records than the one being kept/.test(app._preview.innerHTML));
  }

  {
    // Two siblings. Nothing in the names separates them; the birthdays do.
    const app = makeApp({ keep: 'samh', drop: 'sama' });
    app._renderMergePreview.call(app);
    ok('different birthdays are called out as two different children',
      /different dates of birth/.test(app._preview.innerHTML));
  }

  {
    const app = makeApp({ keep: 'eli', drop: 'eli' });
    app._renderMergePreview.call(app);
    ok('the same profile twice is refused in the preview',
      /same profile/.test(app._preview.innerHTML));
    await app.mergePickedStudents.call(app);
    check('  and writes nothing', app.calls.filter(c => c.fn === 'rt_merge_student'), []);
  }

  {
    const app = makeApp({ keep: '', drop: 'elij' });
    await app.mergePickedStudents.call(app);
    check('half a choice writes nothing', app.calls.filter(c => c.fn === 'rt_merge_student'), []);
    ok('  and asks for both', app.notices.some(n => /choose both/i.test(n)));
  }

  {
    // Picking no longer merges: it opens the review.
    const app = makeApp({ keep: 'eli', drop: 'elij' });
    await app.mergePickedStudents.call(app);
    check('picking two opens the review, it does not merge', app.calls.map(c => c.fn), ['rt_merge_preview']);
  }

  {
    // The automatic list goes through the same review, because a pair found by
    // name still has fields that disagree.
    const app = makeApp({ picked: 'old' });
    await app.mergeDuplicateStudents.call(app, 0);
    check('the automatic list reviews too', app.calls.map(c => c.fn), ['rt_merge_preview']);
  }

  console.log('\n== the review ==\n');

  {
    const app = makeApp({ keep: 'eli', drop: 'elij' });
    await app.openMergeReview.call(app, 'eli', 'elij');
    const out = app.modal;
    ok('both sides are named', /KEEPING/.test(out) && /REMOVING/.test(out));
    // Only the fields that actually disagree are questions.
    ok('it counts what needs deciding', /2 things to decide/.test(out));
    ok('  and shows each side of a conflict', /office@x\.com/.test(out) && /eli@x\.com/.test(out));
    ok('  labelling the sign-in by address, not by id', /Sign-in/.test(out));
    ok('the kept profile is the default', /value="keep" checked/.test(out));
    ok('fields only one side has are settled, not asked',
      /1 settled without asking/.test(out) && /from the removed profile/.test(out));
    ok('the records that just combine are counted', /Records that just combine/.test(out));
    ok('  with the collision rule stated', /kept profile's is the one that stays/.test(out));
    ok('  and each table listed', /daily_attendance/.test(out));
  }

  {
    const app = makeApp({ keep: 'eli', drop: 'elij' });
    await app.openMergeReview.call(app, 'eli', 'elij');
    // Nothing chosen: the survivor keeps everything it already has.
    await app.submitReviewedMerge.call(app);
    const call = app.calls.find(c => c.fn === 'rt_merge_student');
    check('submitting with no changes sends no field choices', call.args.p_fields, {});

    const app2 = makeApp({ keep: 'eli', drop: 'elij' });
    await app2.openMergeReview.call(app2, 'eli', 'elij');
    app2._setMergeChoice.call(app2, 'auth_user_id', 'drop');
    app2._setMergeChoice.call(app2, 'first_name', 'drop');
    await app2.submitReviewedMerge.call(app2);
    const call2 = app2.calls.find(c => c.fn === 'rt_merge_student');
    check('choosing the removed profile\'s values sends them',
      call2.args.p_fields, { auth_user_id: 'drop', first_name: 'drop' });

    // Switching back is a removal, not a 'keep' entry: the function only ever
    // receives the columns it should take from the removed row.
    const app3 = makeApp({ keep: 'eli', drop: 'elij' });
    await app3.openMergeReview.call(app3, 'eli', 'elij');
    app3._setMergeChoice.call(app3, 'first_name', 'drop');
    app3._setMergeChoice.call(app3, 'first_name', 'keep');
    await app3.submitReviewedMerge.call(app3);
    check('changing your mind removes the choice',
      app3.calls.find(c => c.fn === 'rt_merge_student').args.p_fields, {});
  }

  {
    const app = makeApp({ keep: 'eli', drop: 'elij', confirms: false });
    await app.openMergeReview.call(app, 'eli', 'elij');
    await app.submitReviewedMerge.call(app);
    check('declining at the last step writes nothing',
      app.calls.filter(c => c.fn === 'rt_merge_student'), []);
    ok('  and the prompt says it cannot be undone', /cannot be undone/.test(app.confirmed));
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
