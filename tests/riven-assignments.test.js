// Changing and removing an assignment.
//
// Riven could set an assignment and list them, and could not touch one
// afterwards. These are the teacher's, not an admin's - _rivenCanManageClass
// decides, the same as it does for the register.
//
// DELETING TAKES THE GRADES WITH IT
//
// assignment_submissions hang off the assignment, so every mark every student
// has for it goes at the same moment. "Delete the assignment" does not sound
// like "delete twenty grades", which is often exactly what it is, so the count
// is in the confirmation and there is no undo afterwards - an undo that
// restored the assignment without the submissions would be lying about what it
// put back.
//
// FINDING THE ONE THEY MEAN
//
// The structured layer already has _rtResolveAssignment, which insists on an
// exact title. That is right for a scripted call and useless for "get rid of
// the chapter 4 problems". This matches the way people actually refer to
// them - part of the title, in a class they teach - takes the longest title
// that fits, and refuses when two are equally good, because the next step
// deletes something.
//
// Run: node tests/riven-assignments.test.js

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

const MINE = { id: 'c1', name: 'Math', teacher_id: 'me', secondary_teacher_id: null, is_active: true };
const THEIRS = { id: 'c2', name: 'Art', teacher_id: 'someone', secondary_teacher_id: null, is_active: true };

const ASSIGNMENTS = [
  { id: 'a1', title: 'Chapter 4 problems', class_id: 'c1', due_date: '2026-09-18T23:59:00Z', max_points: 20, is_published: true },
  { id: 'a2', title: 'Vocabulary quiz', class_id: 'c1', due_date: '2026-09-20T23:59:00Z', max_points: 10, is_published: true },
];

function makeApp({ role = 'teacher', assignments = ASSIGNMENTS, submissions = [], classes = [MINE, THEIRS] } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    updates: [],
    deletes: [],
    undos: [],
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    _terminalAllClasses: classes,
    escapeHtml: esc,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _pushUndo(desc, fn) { app.undos.push({ desc, fn }); },
    // Friday, for "due friday".
    _rivenParseDueDate: (raw) => (/friday/i.test(raw) ? { iso: '2026-09-18', label: 'Friday' } : null),
    async _rivenRequireClass() { return { row: null, asked: false }; },
    _requestConfirmation(summary, run) {
      app.confirmed = summary;
      app._pending = (async () => run())();
    },
    auth: {
      supabase: {
        from(table) {
          const q = {
            select() { return q; },
            eq(c, v) { q._eq = q._eq || {}; q._eq[c] = v; return q; },
            // Honoured, not ignored: the whole point of the class filter is
            // that a teacher cannot reach another teacher's assignments, and a
            // stub that drops it would pass that test without testing it.
            in(col, vals) { q._in = { col, vals }; return q; },
            update(patch) { q._patch = patch; return q; },
            delete() { q._op = 'delete'; return q; },
            then(res, rej) {
              if (q._op === 'delete') { app.deletes.push({ table, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              if (q._patch) { app.updates.push({ table, patch: q._patch, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              let data = table === 'assignments' ? assignments
                : table === 'assignment_submissions' ? submissions : [];
              if (q._in) data = data.filter(r => q._in.vals.includes(r[q._in.col]));
              if (q._eq) data = data.filter(r => Object.entries(q._eq).every(([k, v]) => r[k] === v));
              return Promise.resolve({ data, error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  app._rivenCanManageClass = extract('_rivenCanManageClass');
  app._rivenPolicyError = extract('_rivenPolicyError');
  app._rivenFindAssignment = extract('_rivenFindAssignment');
  app._rivenAssignmentError = extract('_rivenAssignmentError');
  for (const m of ['terminalDeleteAssignment', 'terminalEditAssignment']) {
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

  console.log('\n== finding the one they mean ==\n');

  {
    const app = makeApp({});
    const r = await app._rivenFindAssignment.call(app, said('delete the chapter 4 problems assignment'));
    check('a full title matches', r.row.id, 'a1');
  }

  {
    const app = makeApp({});
    // Nobody says the whole title. Distinctive words are enough when only one
    // assignment carries them.
    const r = await app._rivenFindAssignment.call(app, said('delete the vocabulary assignment'));
    check('a partial reference still finds it', r.row.id, 'a2');
  }

  {
    const app = makeApp({
      assignments: [
        { id: 'a1', title: 'Chapter 4', class_id: 'c1' },
        { id: 'a2', title: 'Chapter 4 problems', class_id: 'c1' },
      ],
    });
    const r = await app._rivenFindAssignment.call(app, said('delete chapter 4 problems'));
    // Both titles appear in the sentence; the fuller one is what was meant.
    check('the longest matching title wins', r.row.id, 'a2');
  }

  {
    const app = makeApp({
      assignments: [
        { id: 'a1', title: 'Unit review', class_id: 'c1' },
        { id: 'a2', title: 'Unit test', class_id: 'c1' },
      ],
    });
    const r = await app._rivenFindAssignment.call(app, said('delete the unit thing'));
    check('two equally good matches refuse to choose', r.error, 'ambiguous');
  }

  {
    // A teacher must not reach into a class they do not teach.
    const app = makeApp({
      assignments: [{ id: 'x', title: 'Still life', class_id: 'c2' }],
    });
    const r = await app._rivenFindAssignment.call(app, said('delete still life'));
    check("another teacher's assignment is not found", r.error, 'not_found');
  }

  {
    const app = makeApp({ role: 'admin', assignments: [{ id: 'x', title: 'Still life', class_id: 'c2' }] });
    const r = await app._rivenFindAssignment.call(app, said('delete still life'));
    check('an admin can reach any class', r.row.id, 'x');
  }

  console.log('\n== deleting ==\n');

  {
    const app = makeApp({ submissions: [
      { id: 's1', assignment_id: 'a1', grade: 18 },
      { id: 's2', assignment_id: 'a1', grade: null },
      { id: 's3', assignment_id: 'a1', grade: 9 },
    ] });
    await app.terminalDeleteAssignment.call(app, said('delete the chapter 4 problems assignment'));

    // The part that does not sound like what it is.
    ok('the confirmation counts the submissions', /3 submissions/.test(app.confirmed));
    ok('  and how many were graded', /2 of them graded/.test(app.confirmed));
    ok('  and that it cannot be undone', /cannot be undone/.test(app.confirmed));

    ok('the submissions go first', app.deletes[0].table === 'assignment_submissions');
    ok('  then the assignment', app.deletes[1].table === 'assignments');
    check('  the right one', app.deletes[1].where.id, 'a1');
    // An undo could not put the submissions back.
    check('nothing claims to be undoable', app.undos.length, 0);
    ok('the answer says what went with it', /3 submissions/.test(app.ok[0]));
  }

  {
    const app = makeApp({ submissions: [] });
    await app.terminalDeleteAssignment.call(app, said('delete the vocabulary quiz'));
    ok('with no submissions it says so', /Nobody has submitted/.test(app.confirmed));
  }

  {
    const app = makeApp({ assignments: [] });
    await app.terminalDeleteAssignment.call(app, said('delete the chapter 4 assignment'));
    check('nothing found, nothing deleted', app.deletes, []);
    ok('  and it asks for the title', /could not find that assignment/i.test(app.errors[0]));
  }

  console.log('\n== editing ==\n');

  {
    const app = makeApp({});
    await app.terminalEditAssignment.call(app, said('make chapter 4 problems due friday'));
    ok('the due date is written', /due_date/.test(JSON.stringify(app.updates[0].patch)));
    ok('  and shown against the old one', /2026-09-18/.test(app.confirmed));
    check('  and it can be put back', app.undos.length, 1);
  }

  {
    const app = makeApp({});
    await app.terminalEditAssignment.call(app, said('chapter 4 problems is worth 50 points'));
    check('points are written', app.updates[0].patch, { max_points: 50 });
    ok('  shown against the old value', /20/.test(app.confirmed) && /50/.test(app.confirmed));
  }

  {
    const app = makeApp({});
    await app.terminalEditAssignment.call(app, said('unpublish the chapter 4 problems assignment'));
    check('hiding it from students is a change of one field', app.updates[0].patch, { is_published: false });
    ok('  said in words, not a column name', /hidden from students/.test(app.confirmed));
  }

  {
    const app = makeApp({});
    await app.terminalEditAssignment.call(app, said('change the chapter 4 problems assignment'));
    check('with nothing to change, nothing is written', app.updates, []);
    ok('  and it lists what it can change', /due date, the points/.test(app.errors[0]));
  }

  {
    const app = makeApp({
      assignments: [{ id: 'x', title: 'Still life', class_id: 'c2', max_points: 10 }],
    });
    // Found via the admin path would be one thing; as a teacher it is not
    // theirs at all.
    await app.terminalEditAssignment.call(app, said('still life is worth 50 points'));
    check("another teacher's assignment is not edited", app.updates, []);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
