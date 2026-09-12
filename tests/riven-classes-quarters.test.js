// Who teaches a class, and which quarter the school is in.
//
// Both are school-wide facts rather than facts about one child, and both are
// admin-only: the teacher of a class decides whose register it is and who may
// mark it, and the current quarter decides where every grade written from now
// on lands.
//
// THE SHAPE PROBLEM
//
// "give chess to caitlin" is, after normalisation, "add chess to caitlin" -
// _normalizeInput rewrites give to add before any pattern sees it. That is
// character-for-character the same shape as "add eli to chess", which enrols a
// student. Three things keep them apart, and all three are asserted here:
// a student being named knocks this out, a cohort being named knocks it out,
// and the person's name has to be the last thing in the sentence.
//
// THE NAME PROBLEM
//
// "quarter" is one edit from "Carter", and this school has a Carter on the
// roll. The typo gate that would normally stop that only applies to sentences
// with no command verb, so quarter commands resolve a student incidentally.
// They must not care: no quarter command is ever about one student.
//
// Changing quarter hands to the page's own switcher rather than repeating it,
// because switching snapshots the outgoing quarter's grades and a second copy
// of that would eventually disagree with the first about what got saved.
//
// Run: node tests/riven-classes-quarters.test.js

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

// Frozen, and cloned per app below: the executor writes the new teacher back
// onto the row it was given, so a shared fixture leaks the first test's
// result into the second and the "already teaches it" case never fires.
const CHESS = Object.freeze({ id: 'c1', name: 'Chess', teacher_id: 'dan', is_active: true });
const STAFF = [
  { id: 'dan', first_name: 'Dan', last_name: 'Pike', email: 'dan@x.com', user_type: 'teacher' },
  { id: 'cait', first_name: 'Caitlin', last_name: 'Pennock', email: 'cait@x.com', user_type: 'teacher' },
];
const QUARTERS = [
  { id: 'q1', name: 'Quarter 1', is_current: true, is_archived: false, start_date: '2026-08-24', end_date: '2026-10-30' },
  { id: 'q2', name: 'Quarter 2', is_current: false, is_archived: false, start_date: '2026-11-02', end_date: '2027-01-15' },
];

function makeApp({ role = 'admin', classRow = { ...CHESS }, staff = STAFF, quarters = QUARTERS } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    updates: [],
    switched: [],
    undos: [],
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    escapeHtml: esc,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _pushUndo(desc, fn) { app.undos.push({ desc, fn }); },
    async _rivenRequireClass() { return { row: classRow, asked: false }; },
    setCurrentQuarter(id) { app.switched.push(id); return Promise.resolve(); },
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
            in() { return q; },
            order() { return q; },
            update(patch) { q._patch = patch; return q; },
            then(res, rej) {
              if (q._patch) { app.updates.push({ table, patch: q._patch, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              const data = table === 'quarters' ? quarters : staff;
              return Promise.resolve({ data, error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  app._rivenRequireAdmin = extract('_rivenRequireAdmin');
  app._rivenPolicyError = extract('_rivenPolicyError');
  app._rivenMatchQuarter = extract('_rivenMatchQuarter');
  for (const m of ['terminalSetClassTeacher', 'terminalReopenClass', 'terminalSetCurrentQuarter']) {
    const fn = extract(m);
    app[m] = async function (...a) {
      const r = await fn.apply(app, a);
      if (app._pending) { const p = app._pending; app._pending = null; await p; }
      return r;
    };
  }
  app.terminalViewQuarters = extract('terminalViewQuarters');
  return app;
}

const said = (text) => ({ original: text, _rawInput: text });

(async () => {

  console.log('\n== only an admin ==\n');

  {
    const app = makeApp({ role: 'teacher' });
    await app.terminalSetClassTeacher.call(app, said('give chess to caitlin'));
    await app.terminalReopenClass.call(app, said('reopen chess'));
    await app.terminalSetCurrentQuarter.call(app, said('set the quarter to quarter 2'));
    check('a teacher changes none of it', app.updates.concat(app.switched), []);
    check('  refused each time', app.errors.length, 3);
  }

  {
    // Reading stays open: a teacher needs to know which quarter they are
    // grading into.
    const app = makeApp({ role: 'teacher' });
    await app.terminalViewQuarters.call(app, said('what quarter are we in'));
    ok('a teacher can still ask which quarter it is', /Quarter 1/.test(app.said[0]));
    check('  with no refusal', app.errors, []);
  }

  console.log('\n== handing a class over ==\n');

  {
    const app = makeApp({});
    await app.terminalSetClassTeacher.call(app, said('give chess to caitlin'));
    check('the class gets the new teacher', app.updates[0].patch, { teacher_id: 'cait' });
    ok('the confirmation names both', /Caitlin Pennock/.test(app.confirmed) && /Chess/.test(app.confirmed));
    // The outgoing teacher loses three things at once and is not told by the app.
    ok('  and says what the outgoing teacher loses',
      /Dan Pike/.test(app.confirmed) && /register/.test(app.confirmed));
    check('  and it can be put back', app.undos.length, 1);
  }

  {
    const app = makeApp({});
    await app.terminalSetClassTeacher.call(app, said('give chess to dan'));
    check('handing it to whoever already has it writes nothing', app.updates, []);
    ok('  and says so', /already teaches/.test(app.said[0]));
  }

  {
    // "Chess" is in the sentence; a teacher whose first name is a word of the
    // class name must not be matched off the class name itself.
    const app = makeApp({
      staff: [{ id: 'x', first_name: 'Chess', last_name: 'Someone', user_type: 'teacher' }],
    });
    await app.terminalSetClassTeacher.call(app, said('give chess to caitlin'));
    check('the class name is not read as a teacher name', app.updates, []);
    ok('  and it asks who', /Which teacher/.test(app.errors[0]));
  }

  {
    const app = makeApp({
      staff: [
        { id: 'a', first_name: 'Sam', last_name: 'One', user_type: 'teacher' },
        { id: 'b', first_name: 'Sam', last_name: 'Two', user_type: 'teacher' },
      ],
    });
    await app.terminalSetClassTeacher.call(app, said('give chess to sam'));
    check('two teachers of one name change nothing', app.updates, []);
    ok('  and it lists them', /Sam One, Sam Two/.test(app.errors[0]));
  }

  console.log('\n== reopening ==\n');

  {
    const app = makeApp({ classRow: { ...CHESS, is_active: false } });
    await app.terminalReopenClass.call(app, said('reopen chess'));
    check('the class is reopened', app.updates[0].patch, { is_active: true });
    // The asymmetry: closing archived the enrolments, reopening does not undo that.
    ok('the confirmation says enrolments are not restored', /NOT restored/.test(app.confirmed));
    ok('  and the answer repeats it', /still archived/.test(app.ok[0]));
  }

  {
    const app = makeApp({ classRow: { ...CHESS, is_active: true } });
    await app.terminalReopenClass.call(app, said('reopen chess'));
    check('an open class is left alone', app.updates, []);
    ok('  and says so', /already open/.test(app.said[0]));
  }

  console.log('\n== the quarter ==\n');

  {
    const app = makeApp({});
    await app.terminalSetCurrentQuarter.call(app, said('set the current quarter to quarter 2'));
    // Handed over, not reimplemented: switching saves the outgoing quarter's
    // grades and one copy of that is enough.
    check('it uses the page own switcher', app.switched, ['q2']);
    ok('the confirmation says the outgoing grades are saved', /grades are saved off first/.test(app.confirmed));
    ok('  and where new grades will land', /lands in Quarter 2/.test(app.confirmed));
  }

  {
    const app = makeApp({});
    await app.terminalSetCurrentQuarter.call(app, said('we are now in quarter 1'));
    check('switching to the current quarter does nothing', app.switched, []);
    ok('  and says so', /already in/.test(app.said[0]));
  }

  {
    const app = makeApp({});
    await app.terminalSetCurrentQuarter.call(app, said('set the quarter'));
    check('with no quarter named nothing switches', app.switched, []);
    ok('  and it lists what there is', /Quarter 1, Quarter 2/.test(app.errors[0]));
  }

  {
    const app = makeApp({});
    // Position in the year, not a number inside the name.
    check('"second quarter" is the second one',
      app._rivenMatchQuarter.call(app, 'move to the second quarter', QUARTERS).id, 'q2');
    check('"q2" is too', app._rivenMatchQuarter.call(app, 'set q2', QUARTERS).id, 'q2');
    check('and the name as written', app._rivenMatchQuarter.call(app, 'go to quarter 1', QUARTERS).id, 'q1');
    check('nothing named is nothing matched',
      app._rivenMatchQuarter.call(app, 'set the quarter', QUARTERS), null);
  }

  {
    const app = makeApp({});
    await app.terminalViewQuarters.call(app, said('list the quarters'));
    const out = app.said[0];
    ok('both quarters are listed', /Quarter 1/.test(out) && /Quarter 2/.test(out));
    ok('  the current one is marked', /\(current\)/.test(out));
    ok('  and the dates are there', /2026-08-24/.test(out));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
