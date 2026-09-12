// Riven can change the student record, and only an admin can.
//
// Riven was a rich reader of student records and a narrow writer: contact
// details were the only part of a profile it could change. Everything else on
// the record - the days a child attends, their year group, their enrolment
// type, the spelling of their name, who their parents are - could be read in
// some places and changed in none.
//
// THE SPLIT THIS FILE ENFORCES
//
// Reads stay with teachers. A teacher needs to know which days a child comes
// in and who to ring, and asks constantly.
//
// Writes are admin-only, because each one is a fact other screens depend on:
//
//   * attending days decide whose name appears on the morning register and,
//     since the register started following the timetable, on every class
//     register too;
//   * enrolment type is a fee arrangement;
//   * a name is how every other screen, search and report finds the child;
//   * a parent link opens that child's grades, attendance and medical notes to
//     whoever is on the other end.
//
// The client gate is an affordance, not the control - a teacher gets told
// plainly instead of being walked through a confirmation the database was
// always going to reject. The control is a BEFORE UPDATE trigger in the
// backend repo, verified against the live database: as a teacher, changing a
// student's name or enrolment type raises 42501, while changing their phone
// number still works.
//
// Run: node tests/riven-student-record.test.js

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
  const isAsync = /^\s*async\b/.test(m[0].slice(1));
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STUDENT = { id: 's1', full_name: 'Jonathan Smith' };

// Records every write the executor attempts, and runs the confirmation body
// straight away so the test sees what would actually reach the database.
function makeApp({ role = 'admin', profile = {}, schedule = [], links = [], parents = [], failInsert = false } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    writes: [],
    undos: [],
    reloaded: 0,
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    escapeHtml: esc,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _rivenResolvedStudent: (e) => e?.student?.student || e?.student || null,
    _pushUndo(desc, fn) { app.undos.push({ desc, fn }); },
    async _loadTerminalStudents() { app.reloaded++; },
    // The executors fire this and return without awaiting it, the way the real
    // page does - the confirmation is a dialog, not a step. The promise is kept
    // so the wrapper below can wait for the write before the test looks.
    _requestConfirmation(summary, run) {
      app.confirmed = summary;
      app._pending = (async () => run())();
    },
    auth: {
      supabase: {
        from(table) {
          const q = {
            _table: table,
            select() { return q; },
            eq() { return q; },
            or() { return q; },
            maybeSingle() { return Promise.resolve({ data: links.length ? { child_id: 's1' } : null, error: null }); },
            single() { return Promise.resolve({ data: profile, error: null }); },
            update(patch) { app.writes.push({ table, op: 'update', patch }); return q; },
            insert(rows) {
              app.writes.push({ table, op: 'insert', rows });
              if (failInsert && table === 'student_schedule' && app.writes.filter(w => w.op === 'insert').length === 1) {
                return Promise.resolve({ error: new Error('insert blew up') });
              }
              return Promise.resolve({ error: null });
            },
            delete() { app.writes.push({ table, op: 'delete' }); return q; },
            then(res, rej) {
              const data = table === 'student_schedule' ? schedule
                : table === 'parent_child_links' ? links
                : table === 'user_profiles' ? parents : [];
              return Promise.resolve({ data, error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  for (const m of ['_rivenRequireAdmin', '_rivenPolicyError', '_rivenParseWeekdays', '_rivenDayList',
                   '_rivenDayPhrase', '_rivenDayNames', 'terminalShowSchedule', 'terminalShowParents']) {
    app[m] = extract(m);
  }
  // Awaiting the confirmation body too, so an assertion never reads the state
  // half way through a write.
  for (const m of ['terminalSetEnrollmentType', 'terminalSetSchedule', 'terminalSetGradeLevel',
                   'terminalRenameStudent', 'terminalLinkParent']) {
    const fn = extract(m);
    app[m] = async function (...a) {
      const r = await fn.apply(app, a);
      if (app._pending) { const p = app._pending; app._pending = null; await p; }
      return r;
    };
  }
  return app;
}

const said = (e) => ({ student: { student: STUDENT }, original: e, _rawInput: e });

(async () => {

  console.log('\n== a teacher may look, not change ==\n');

  {
    const app = makeApp({ role: 'teacher' });
    for (const [fn, sentence] of [
      ['terminalSetEnrollmentType', 'make jonathan homeschool'],
      ['terminalSetSchedule', 'jonathan attends monday and wednesday'],
      ['terminalSetGradeLevel', 'move jonathan to 8th grade'],
      ['terminalRenameStudent', "change jonathan's last name to Smithe"],
      ['terminalLinkParent', 'link sarah jones to jonathan as his parent'],
    ]) {
      await app[fn].call(app, said(sentence));
    }
    check('nothing a teacher says reaches the database', app.writes, []);
    check('  and nothing is even put up for confirmation', app.confirmed, null);
    check('  every one of them is refused', app.errors.length, 5);
    ok('the refusal says who can', app.errors.every(e => /Only an admin/.test(e)));
    // The point of the split: they are not being told to go away.
    ok('  and that looking it up is still theirs',
      app.errors.every(e => /look it up here any time/.test(e)));
  }

  {
    const app = makeApp({ role: 'teacher', schedule: [{ day_of_week: 2 }, { day_of_week: 4 }] });
    await app.terminalShowSchedule.call(app, said('what days does jonathan attend'));
    ok('a teacher can read the attending days', /Tuesday, Thursday/.test(app.said[0]));
    check('  with no error', app.errors, []);
  }

  {
    const app = makeApp({
      role: 'teacher',
      links: [{ parent_id: 'auth-mary' }],
      parents: [{ id: 'p1', first_name: 'Mary', last_name: 'Smith', email: 'mary@x.com', phone: '555' }],
    });
    await app.terminalShowParents.call(app, said("who are jonathan's parents"));
    ok('and read the parents', /Mary Smith/.test(app.said[0]));
    ok('  with the contact details they would ring', /mary@x\.com/.test(app.said[0]));
  }

  console.log('\n== enrolment type ==\n');

  {
    const app = makeApp({ profile: { enrollment_type: 'full-time' } });
    await app.terminalSetEnrollmentType.call(app, said('make jonathan homeschool'));
    ok('the confirmation shows what it is changing from', /full-time/.test(app.confirmed));
    ok('  and to', /<b>homeschool<\/b>/.test(app.confirmed));
    // The two are constantly confused, and one is a bill.
    ok('  and separates it from the attending days', /not the days they attend/.test(app.confirmed));
    check('the write is the one field', app.writes[0].patch, { enrollment_type: 'homeschool' });
    check('  and it is undoable back to what it was', app.undos.length, 1);
  }

  {
    const app = makeApp({ profile: { enrollment_type: 'homeschool' } });
    await app.terminalSetEnrollmentType.call(app, said('make jonathan homeschool'));
    check('setting it to what it already is writes nothing', app.writes, []);
    ok('  and says so', /already homeschool/.test(app.said[0]));
  }

  {
    const app = makeApp({ profile: { enrollment_type: 'full-time' } });
    await app.terminalSetEnrollmentType.call(app, said('change jonathan'));
    check('a sentence with no type in it writes nothing', app.writes, []);
    ok('  and asks which', /Full-time or homeschool/.test(app.errors[0]));
  }

  console.log('\n== attending days ==\n');

  {
    const app = makeApp({ schedule: [{ day_of_week: 2 }] });
    await app.terminalSetSchedule.call(app, said('jonathan attends monday wednesday friday'));

    ok('the confirmation names the days now', /Tuesday/.test(app.confirmed));
    ok('  and the days after', /Monday, Wednesday, Friday/.test(app.confirmed));
    // The obvious fear when a day is removed.
    ok('  and promises marks already taken are untouched',
      /Attendance already taken is not changed/.test(app.confirmed));
    ok('  while saying registers change from now on', /which registers they appear on/.test(app.confirmed));

    const ins = app.writes.find(w => w.op === 'insert');
    check('the days written are the days said', ins.rows.map(r => r.day_of_week), [1, 3, 5]);
    ok('the old rows go first', app.writes[0].op === 'delete');
    check('  and it is undoable', app.undos.length, 1);
  }

  {
    const app = makeApp({ schedule: [{ day_of_week: 1 }] });
    await app.terminalSetSchedule.call(app, said('jonathan comes in every weekday'));
    const ins = app.writes.find(w => w.op === 'insert');
    check('"every weekday" is Monday to Friday', ins.rows.map(r => r.day_of_week), [1, 2, 3, 4, 5]);
    ok('  and reads back as a phrase, not five words', /every weekday/.test(app.confirmed));
  }

  {
    // The delete has already happened by the time an insert can fail, and a
    // child on no register at all is silent - it lasts until somebody notices.
    const app = makeApp({ schedule: [{ day_of_week: 2 }, { day_of_week: 4 }], failInsert: true });
    let threw = false;
    try { await app.terminalSetSchedule.call(app, said('jonathan attends monday')); }
    catch (e) { threw = true; }
    const inserts = app.writes.filter(w => w.op === 'insert');
    ok('a failed write puts the old days back', inserts.length === 2);
    check('  exactly the ones that were there', inserts[1].rows.map(r => r.day_of_week), [2, 4]);
    ok('  and the failure is not swallowed', threw);
  }

  {
    const app = makeApp({ schedule: [{ day_of_week: 1 }, { day_of_week: 3 }] });
    await app.terminalSetSchedule.call(app, said('jonathan attends monday and wednesday'));
    check('setting the days they already have writes nothing', app.writes, []);
    ok('  and says so', /already down for Monday, Wednesday/.test(app.said[0]));
  }

  {
    const app = makeApp({});
    await app.terminalSetSchedule.call(app, said('change jonathans days'));
    check('no day named, nothing written', app.writes, []);
    ok('  and it asks which days', /Which days/.test(app.errors[0]));
  }

  console.log('\n== grade level ==\n');

  {
    const app = makeApp({ profile: { grade_level: '7' } });
    await app.terminalSetGradeLevel.call(app, said('move jonathan to 8th grade'));
    check('the year group is written', app.writes[0].patch, { grade_level: '8' });
    // SET_GRADE is a mark; this is a year group. They share a word.
    ok('  and the confirmation says which it is', /not a mark/.test(app.confirmed));
  }

  {
    const app = makeApp({ profile: { grade_level: '1' } });
    await app.terminalSetGradeLevel.call(app, said('move jonathan to kindergarten'));
    check('kindergarten is K', app.writes[0].patch, { grade_level: 'K' });
  }

  {
    const app = makeApp({ profile: { grade_level: '7' } });
    await app.terminalSetGradeLevel.call(app, said('move jonathan to 19th grade'));
    check('a year group that does not exist is refused', app.writes, []);
    ok('  saying the range', /K through 12/.test(app.errors[0]));
  }

  console.log('\n== the name ==\n');

  {
    const app = makeApp({ profile: { first_name: 'Jonathon', last_name: 'Smith' } });
    await app.terminalRenameStudent.call(app, said("change jonathan's last name to Smithe"));
    check('only the half that was named changes', app.writes[0].patch, { last_name: 'Smithe' });
    ok('  shown against what it was', /Smith/.test(app.confirmed));
    // Every later sentence resolves names against the cached roster; without
    // this, Riven keeps matching the old spelling and the change looks lost.
    check('the roster Riven matches against is reloaded', app.reloaded, 1);
  }

  {
    const app = makeApp({ profile: { first_name: 'Jon', last_name: 'Smith' } });
    await app.terminalRenameStudent.call(app, said("jonathan's first name to Jonathan"));
    check('a first name alone works too', app.writes[0].patch, { first_name: 'Jonathan' });
  }

  {
    const app = makeApp({ profile: { first_name: 'Jon', last_name: 'Smith' } });
    await app.terminalRenameStudent.call(app, said('fix jonathans name'));
    check('with nothing to change it to, nothing is written', app.writes, []);
    ok('  and it asks', /What should the name be/.test(app.errors[0]));
  }

  console.log('\n== linking a parent ==\n');

  {
    const app = makeApp({
      parents: [{ id: 'p1', first_name: 'Sarah', last_name: 'Jones', email: 'sarah@x.com', auth_user_id: 'auth-sarah' }],
    });
    await app.terminalLinkParent.call(app, said('link sarah jones to jonathan as his parent'));
    // The FK is on auth.users, and the audit found this exact mistake writing a
    // profile id into it.
    check('the link is keyed by the login, not the profile',
      app.writes[0].rows, { parent_id: 'auth-sarah', child_id: 's1' });
    ok('the confirmation says what it opens up',
      /grades, attendance/.test(app.confirmed) && /medical/.test(app.confirmed));
    check('  and it is undoable', app.undos.length, 1);
  }

  {
    // A parent created by approving an enrolment has no login, and a link keyed
    // to a login that does not exist fails on the foreign key.
    const app = makeApp({
      parents: [{ id: 'p1', first_name: 'Sarah', last_name: 'Jones', email: 'sarah@x.com', auth_user_id: null }],
    });
    await app.terminalLinkParent.call(app, said('link sarah jones to jonathan as his parent'));
    check('a parent with no sign-in is not linked', app.writes, []);
    ok('  and is told to open the account first', /Open their account first/.test(app.said[0]));
  }

  {
    const app = makeApp({
      parents: [
        { id: 'p1', first_name: 'Sarah', last_name: 'Jones', email: 'sarah@x.com', auth_user_id: 'a1' },
        { id: 'p2', first_name: 'Sarah', last_name: 'Jones', email: 'other@x.com', auth_user_id: 'a2' },
      ],
    });
    await app.terminalLinkParent.call(app, said('link sarah jones to jonathan as his parent'));
    check('two parents of the same name link neither', app.writes, []);
    ok('  and it asks for the address instead', /email address/.test(app.errors[0]));
  }

  {
    const app = makeApp({
      parents: [{ id: 'p1', first_name: 'Sarah', last_name: 'Jones', email: 'sarah@x.com', auth_user_id: 'a1' }],
    });
    await app.terminalLinkParent.call(app, said('link sarah to jonathan as his parent'));
    check('a first name alone is not enough', app.writes, []);
    ok('  and says why that matters', /not enough to open a child's records/.test(app.errors[0]));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
