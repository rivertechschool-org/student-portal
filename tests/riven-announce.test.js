// Riven announcements to targeted groups.
//
// 2026-10-28: runs the real _rivenAnnounceAudience, terminalAnnounce,
// _sendAnnouncement, _parentIdsOf, _announceProfiles and _unsendAnnouncement
// over invented people and an in-memory stand-in for the database: who each
// phrasing reaches (a class's students or parents, both, a cohort, a grade,
// staff, the school), what a teacher may not do, the email option, and an
// undo that goes through the database rather than a delete the sender is not
// allowed to make. Class and cohort RESOLUTION is Riven's own and is tested by
// nlp-stress / frontdoor-precision; here it is stubbed to a fixed answer.
//
// Run: node tests/riven-announce.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

// Any indent: Riven's methods sit at 4 spaces, the app's at 6.
function method(name) {
  const m = new RegExp('\\n(\\s+)(?:async\\s+)?' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('not found: ' + name);
  const start = m.index;
  let p = html.indexOf('(', start), pd = 0;
  for (; p < html.length; p++) {
    if (html[p] === '(') pd++;
    else if (html[p] === ')' && --pd === 0) break;
  }
  let i = html.indexOf('{', p), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const names = ['_rivenAnnounceSplit', '_rivenAnnounceAudience', 'terminalAnnounce', '_sendAnnouncement', '_parentIdsOf',
  '_announceProfiles', '_unsendAnnouncement'];
const app = eval(`({ ${names.map(method).join(',\n')} })`);

// ---- where the audience ends and the message begins ----
{ const sp = app._rivenAnnounceSplit('tell my students that you can buy a late pass'); ok('split: "that"', sp?.head === 'tell my students' && sp?.body === 'you can buy a late pass', JSON.stringify(sp)); }
{ const sp = app._rivenAnnounceSplit('announce to everyone: math is cancelled'); ok('split: a class named in the message is not the audience', sp?.head === 'announce to everyone' && sp?.body === 'math is cancelled', JSON.stringify(sp)); }
{ const sp = app._rivenAnnounceSplit('tell my students that the bus leaves at 3:15'); ok('split: a colon inside the message', sp?.head === 'tell my students' && sp?.body === 'the bus leaves at 3:15', JSON.stringify(sp)); }
{ const sp = app._rivenAnnounceSplit('let the staff know that ari is out sick'); ok('split: "let … know"', sp?.head === 'let the staff' && sp?.body === 'ari is out sick', JSON.stringify(sp)); }
{ const sp = app._rivenAnnounceSplit('tell my students the test is friday'); ok('split: no separator', sp?.head === 'tell my students' && sp?.body === 'the test is friday', JSON.stringify(sp)); }
ok('not split: one family', app._rivenAnnounceSplit('tell ari parents that he did great') === null, JSON.stringify(app._rivenAnnounceSplit('tell ari parents that he did great')));
ok('not split: a read', app._rivenAnnounceSplit('tell all the kids names in math') === null, JSON.stringify(app._rivenAnnounceSplit('tell all the kids names in math')));
ok('not split: a student message', app._rivenAnnounceSplit('message ari: great work today') === null, JSON.stringify(app._rivenAnnounceSplit('message ari: great work today')));
ok('not split: the parents of one child', app._rivenAnnounceSplit('tell the parents of ari the trip is friday') === null, JSON.stringify(app._rivenAnnounceSplit('tell the parents of ari the trip is friday')));

// ---- reading the audience ----
const A = (raw, msg = '') => app._rivenAnnounceAudience(raw, msg);
ok('class students by default', A('announce to math: no class friday').who === null);
ok('parents', A('announce to math parents: no class friday').who === 'parents');
ok('families', A('announce to math families: trip').who === 'families'
  && A('announce to the students and their parents in math: trip').who === 'families');
ok('staff', A('announce to staff: meeting at 3').who === 'staff' && A('let the staff know the meeting moved').who === 'staff');
ok('teachers', A('announce to all teachers: meeting').who === 'teachers');
ok('everyone', A('announce to everyone: closed').who === 'everyone');
ok('the audience is read before the colon only', A('announce to math: parents night is friday').who === null);
ok('…or before "that"', A('tell my students that parents night is friday').who === 'students');
ok('7th grade', A('announce to 7th grade parents: x').grades.join() === '7');
ok('7th and 8th grade', A('announce to 7th and 8th grade: x').grades.join() === '7,8');
ok('grades 6-8', A('announce to grades 6-8: x').grades.join() === '6,7,8');
ok('grades 6 and 9', A('announce to grades 6 and 9: x').grades.join() === '6,9');
ok('no grade in "the 3:00 meeting"', A('announce to staff: the 3rd grade wing is closed').grades.length === 0);
ok('email in the audience', A('email all parents: closed tomorrow').email === true);
const tail = A('announce to everyone: school closed tomorrow and email it', 'school closed tomorrow and email it');
ok('"and email it" asks for email and is not part of the message', tail.email && tail.message === 'school closed tomorrow', JSON.stringify(tail));
const inner = A('announce to math: check your email for the slip', 'check your email for the slip');
ok('an email mentioned in the message is just text', !inner.email && inner.message === 'check your email for the slip');
ok('"my students"', A('remind my students that the test is friday').mine === true);

// ---- the stand-in database ----
// Two Math classes, a cohort, grade levels, parents (one linked to two
// children), staff, and one deactivated parent who must not be reached.
const P = (id, user_type, extra = {}) => ({ id, user_type, email: id + '@example.test', first_name: id, account_status: 'activated', ...extra });
const people = [
  P('s1', 'student', { grade_level: '7' }), P('s2', 'student', { grade_level: '7' }),
  P('s3', 'student', { grade_level: '8' }), P('s4', 'student', { grade_level: null }),
  P('p1', 'parent'), P('p2', 'parent'), P('p3', 'parent', { account_status: 'inactive' }),
  P('t1', 'teacher'), P('t2', 'teacher', { email: null }), P('a1', 'admin'),
];
const enrollments = [
  { class_id: 'math-a', student_id: 's1', status: 'active' }, { class_id: 'math-a', student_id: 's2', status: 'active' },
  { class_id: 'math-a', student_id: 's4', status: 'dropped' },
  { class_id: 'math-b', student_id: 's3', status: 'active' },
];
const links = [
  { parent_id: 'p1', child_id: 's1', status: 'active' }, { parent_id: 'p1', child_id: 's2', status: 'active' },
  { parent_id: 'p2', child_id: 's3', status: 'active' }, { parent_id: 'p3', child_id: 's3', status: 'active' },
];
const tables = { user_profiles: people, class_enrollments: enrollments, parent_child_links: links };
let inserted = [], rpcs = [], emails = [];

function query(table) {
  let rows = (tables[table] || []).map(r => ({ ...r }));
  const q = {
    select() { return q; },
    eq(k, v) { rows = rows.filter(r => r[k] === v); return q; },
    in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return q; },
    or(expr) {
      // Apply the page's own filter, so a wrong status value fails here. The
      // portal stores 'activated' and 'inactive'; there is no 'active'.
      if (/account_status/.test(expr)) {
        const parts = expr.split(',').map(x => x.split('.'));
        rows = rows.filter(r => parts.some(([, op, v]) => op === 'is' ? r.account_status == null
          : op === 'eq' ? r.account_status === v : op === 'neq' ? r.account_status != null && r.account_status !== v : false));
      }
      return q;
    },
    range() { return q; },
    // Like the database: a sender may insert other people's notifications
    // but not read them, so asking for the rows back fails the insert.
    insert(rs) {
      const rls = { data: null, error: { message: 'new row violates row-level security policy for table "notifications"' } };
      return {
        select: () => Promise.resolve(rls),
        then(res, rej) {
          inserted.push(...rs.map((r, i) => ({ ...r, id: r.id || 'n' + (inserted.length + i) })));
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
    },
    then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
  };
  return q;
}

const classes = {
  'math-a': { id: 'math-a', name: 'Math', teacher_id: 't1', secondary_teacher_id: null },
  'math-b': { id: 'math-b', name: 'Math', teacher_id: 't2', secondary_teacher_id: null },
};
let said = [], pending = null, undo = null;
Object.assign(app, {
  userInfo: { profile: { user_type: 'admin', first_name: 'Robin' }, user: { id: 'a1' } },
  auth: { supabase: { from: query, rpc: (name, args) => { rpcs.push([name, args]); return Promise.resolve({ data: (args.p_ids || []).length, error: null }); } } },
  supabaseQuery: fn => Promise.resolve(fn()),
  fetchAllRows: async build => (await build(0, 999)).data,
  sendEmailWithTracking: async (to) => { emails.push(to); return { success: true }; },
  escapeHtml: s => String(s),
  terminalPrintError: m => said.push(['error', m]),
  _naturalSuccess: m => said.push(['ok', m[0]]),
  _requestConfirmation: (summary, fn) => { pending = { summary, fn }; },
  _pushUndo: (desc, fn, spec) => { undo = { desc, fn, spec }; },
  _rivenResolveClassRow: cm => cm.row,
  _rivenClassNamedBeyondCohort: () => false,
  _rivenCanManageClass(row) { return this.userInfo.profile.user_type === 'admin' || row.teacher_id === this.userInfo.user.id; },
  _rivenClassIsOpen: () => true,
  _terminalAllClasses: Object.values(classes),
  _showClassPicker: () => said.push(['picker']),
  _rivenRequireClasses: async (entities) => ({ rows: entities.classMatch._rows, asked: false }),
  _rivenRequireOneGroup: (entities) => entities.groupMatch,
});

async function run(raw, entities = {}) {
  said = []; pending = null; undo = null; inserted = []; emails = []; rpcs = [];
  await app.terminalAnnounce({ original: raw, ...entities });
  if (pending) await pending.fn();
  return { to: inserted.map(n => n.user_id).sort().join(), said, pending, undo };
}
const mathA = { classMatch: { row: classes['math-a'], _rows: [classes['math-a']] } };
const bothMath = { classMatch: { row: classes['math-a'], _rows: [classes['math-a'], classes['math-b']] } };
const cohort = { groupMatch: { id: 'g1', name: 'Full Young Middle', studentIds: ['s2', 's3'] } };

(async () => {
  let r = await run('announce to math: no class friday', mathA);
  ok('a class: its active students', r.to === 's1,s2', r.to);
  ok('confirms first, with the count', /2 notifications/.test(r.pending?.summary || ''));
  ok('sent as an announcement', inserted.every(n => n.type === 'system' && n.metadata.broadcast && n.metadata.via === 'riven'));

  r = await run('announce to math parents: no class friday', mathA);
  ok('a class\'s parents, once each', r.to === 'p1', r.to);
  r = await run('announce to math families: trip friday', mathA);
  ok('families: students and parents', r.to === 'p1,s1,s2', r.to);
  r = await run('announce to all math classes: no class friday', bothMath);
  ok('every Math class', r.to === 's1,s2,s3', r.to);
  r = await run('announce to the math parents: picture day', bothMath);
  ok('a deactivated parent is skipped', r.to === 'p1,p2', r.to);
  r = await run('announce to the math teachers: meeting', bothMath);
  ok('the teachers of those classes', r.to === 't1,t2', r.to);

  r = await run('announce to young middle parents: picture day friday', cohort);
  ok('a cohort\'s parents', r.to === 'p1,p2', r.to);
  r = await run('announce to 7th grade: picture day friday');
  ok('a grade: students with that grade level', r.to === 's1,s2', r.to);
  r = await run('announce to 7th and 8th grade parents: picture day friday');
  ok('two grades\' parents', r.to === 'p1,p2', r.to);
  r = await run('announce to staff: meeting at 3');
  ok('staff: teachers and admins', r.to === 'a1,t1,t2', r.to);
  r = await run('announce to all teachers: meeting at 3');
  ok('teachers only', r.to === 't1,t2', r.to);
  r = await run('announce to all parents: closed tomorrow');
  ok('all parents (active)', r.to === 'p1,p2', r.to);
  r = await run('announce to everyone: closed tomorrow');
  ok('everyone (active)', r.to.split(',').length === 9, r.to);
  r = await run('announce to all students: closed tomorrow');
  ok('all students (active)', r.to === 's1,s2,s3,s4', r.to);
  r = await run('tell all students that school is closed tomorrow');
  ok('"tell all students that ..."', r.to === 's1,s2,s3,s4' && inserted[0]?.message === 'school is closed tomorrow', r.to);

  // Email
  r = await run('announce to math parents: field trip friday and email it', mathA);
  ok('email: sent to the people with an address', emails.join() === 'p1@example.test', emails.join());
  ok('email: the message loses "and email it"', inserted[0]?.message === 'field trip friday', inserted[0]?.message);
  ok('email: the confirmation says emails cannot be unsent', /can't be unsent/.test(r.pending?.summary || ''));
  r = await run('announce to math parents: field trip friday', mathA);
  ok('no email unless asked', emails.length === 0);

  // Undo goes through the database
  r = await run('announce to math: no class friday', mathA);
  await r.undo.fn();
  ok('undo unsends through the database', rpcs[0]?.[0] === 'rt_unsend_announcement' && rpcs[0][1].p_ids.length === 2, JSON.stringify(rpcs));
  ok('undo survives a reload', r.undo.spec.kind === 'notifications' && r.undo.spec.ids.length === 2);
  app.auth.supabase.rpc = () => Promise.resolve({ data: 0, error: null });
  let threw = null;
  try { await r.undo.fn(); } catch (e) { threw = e; }
  ok('an undo that removes nothing says so', /could not be pulled back/.test(threw?.message || ''));

  // A teacher
  app.userInfo = { profile: { user_type: 'teacher', first_name: 'Tam' }, user: { id: 't1' } };
  r = await run('announce to math parents: no class friday', mathA);
  ok('teacher: their own class\'s parents', r.to === 'p1', r.to);
  r = await run('remind my students that the test is friday');
  ok('teacher: "my students" is their classes', r.to === 's1,s2', r.to);
  r = await run('tell my students the test is friday');
  ok('teacher: "tell my students" without "that"', r.to === 's1,s2' && inserted[0]?.message === 'the test is friday', r.to + ' / ' + inserted[0]?.message);
  r = await run('tell my parents the trip is friday');
  ok('teacher: "tell my parents" without "that"', r.to === 'p1' && inserted[0]?.message === 'the trip is friday', r.to + ' / ' + inserted[0]?.message);
  r = await run('remind my students the 7th grade trip is friday');
  ok('teacher: a grade inside the message is not the audience', r.to === 's1,s2' && inserted[0]?.message === 'the 7th grade trip is friday', r.to + ' / ' + inserted[0]?.message);
  for (const [raw, ents, what] of [
    ['announce to staff: meeting', {}, 'staff'],
    ['announce to everyone: closed', {}, 'the whole school'],
    ['announce to 7th grade: picture day', {}, 'a grade'],
    ['announce to young middle: picture day', cohort, 'a year group'],
  ]) {
    r = await run(raw, ents);
    ok(`teacher: not ${what}`, !inserted.length && /Only an admin/.test(r.said[0]?.[1] || ''), JSON.stringify(r.said));
  }
  r = await run('announce to all math classes: no class friday', bothMath);
  ok('teacher: not someone else\'s class', !inserted.length && /not the teacher for Math/.test(r.said[0]?.[1] || ''), JSON.stringify(r.said));

  // Nobody to send to
  app.userInfo = { profile: { user_type: 'admin', first_name: 'Robin' }, user: { id: 'a1' } };
  r = await run('announce to 5th grade: picture day');
  ok('an empty grade says why', /grade level set/.test(r.said[0]?.[1] || ''), JSON.stringify(r.said));
  r = await run('announce to the class: picture day');
  ok('"the class" not recognised asks which, not the whole school', !inserted.length && /Which class/.test(r.said[0]?.[1] || ''), JSON.stringify(r.said));

  // The 📢 tool shares the sender and the parent lookup
  ok('the 📢 tool uses the shared sender', /await this\._sendAnnouncement\(\{ users, title, message, sendEmail \}\)/.test(html));
  ok('nothing reads the old table', !/from\('parent_student_links'\)/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
