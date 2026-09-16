// Calling off a whole teaching day, minus the exception.
//
// "Cancel all my classes for the day except P1" printed a list of all 21 of
// the teacher's classes back at them. No intent covered it: CANCEL_CLASS needs
// a class named, and "classes" is not one, so the sentence fell to
// LIST_CLASSES — which matched, answered, and looked like a refusal.
//
// A teacher going home sick cancels their day, not one lesson at a time.
//
// THE PART THAT IS EASY TO GET BACKWARDS
//
// "cancel all my classes except Math" DOES name a class. CANCEL_CLASS bids on
// it and, with requiresClass, out-scores a modest weight — and the class it
// would cancel is the one the teacher asked to KEEP. That is why CANCEL_DAY
// sits well above it, and why "all/every/the rest of" is required: without
// that, "cancel my math class" matches this instead, which is the same mistake
// pointed the other way. Both directions are asserted in
// debug-tools/frontdoor-precision.js.
//
// A cancelled session has no register, so cancelling deletes the marks already
// taken. That is right, and it is not undoable, so the confirmation has to say
// how many are going.
//
// Run: node tests/riven-cancel-day.test.js

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

const ME = 'me';
// A real-ish Wednesday: four of mine meet, one is somebody else's, one is
// closed for the year, and one of mine does not meet today at all.
const CLASSES = [
  { id: 'c1', name: 'Math',       teacher_id: ME,      teacher_name: 'Jordan Ezell',  status: 'active' },
  { id: 'c2', name: 'Chemistry',  teacher_id: ME,      teacher_name: 'Jordan Ezell',  status: 'active' },
  { id: 'c3', name: 'Coding',     teacher_id: ME,      teacher_name: 'Jordan Ezell',  status: 'active' },
  { id: 'c4', name: 'Physics',    teacher_id: ME,      teacher_name: 'Jordan Ezell',  status: 'active' },
  { id: 'c5', name: 'Bible',      teacher_id: 'other', teacher_name: 'Caitlin Pennock', status: 'active' },
  { id: 'c6', name: 'Old Chess',  teacher_id: ME,      teacher_name: 'Jordan Ezell',  status: 'closed' },
  { id: 'c7', name: 'Yearbook',   teacher_id: ME,      teacher_name: 'Jordan Ezell',  status: 'active' },  // meets Friday
];
const PERIODS = { c1: [1], c2: [2], c3: [3], c4: [1, 5], c5: [4], c6: [2] };  // c7 absent = not today

function makeApp({ marks = [] } = {}) {
  const app = {
    said: [], errors: [], ok: [], confirmed: null,
    deleted: [], inserted: [],
    userInfo: { user: { id: ME }, profile: { user_type: 'teacher' } },
    _terminalAllClasses: CLASSES,
    escapeHtml: (t) => String(t == null ? '' : t),
    _localDateStr: () => '2026-09-16',
    _rivenPhraseToDate: () => null,
    _rivenPolicyError: (e) => e,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m.join(' | ') : m); },
    _requestConfirmation(summary, run) { app.confirmed = summary; app._pending = (async () => run())(); },
    // Hits the database in production; the timetable is the input here.
    async _rivenPeriodsOn(ids) {
      const out = {};
      ids.forEach(id => { if (PERIODS[id]) out[id] = PERIODS[id]; });
      return out;
    },
    auth: { supabase: { from(table) {
      const q = {
        _eq: {}, _in: null,
        select() { return q; },
        eq(c, v) { q._eq[c] = v; return q; },
        in(c, v) { q._in = { col: c, vals: v }; return q; },
        delete() { q._op = 'delete'; return q; },
        insert(row) { app.inserted.push({ table, row }); return Promise.resolve({ error: null }); },
        then(res, rej) {
          if (q._op === 'delete') { app.deleted.push({ table, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
          const rows = table === 'class_attendance'
            ? marks.filter(m => !q._in || q._in.vals.includes(m.class_id)) : [];
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return q;
    } } },
  };
  app._rivenClassIsOpen = extract('_rivenClassIsOpen');
  app._rivenOwnsClass = extract('_rivenOwnsClass');
  app._rivenCanManageClass = extract('_rivenCanManageClass');
  app._rivenExceptClause = extract('_rivenExceptClause');
  app._rivenSchoolScope = extract('_rivenSchoolScope');
  app._rivenSaidEveryTeacher = extract('_rivenSaidEveryTeacher');
  const fn = extract('terminalCancelDay');
  app.terminalCancelDay = async function (...a) {
    const r = await fn.apply(app, a);
    if (app._pending) { const p = app._pending; app._pending = null; await p; }
    return r;
  };
  return app;
}
const said = (text) => ({ original: text, _rawInput: text, normalized: text });

(async () => {

  console.log('\n== what "except" means ==\n');

  {
    const app = makeApp();
    const ex = (t) => { const r = app._rivenExceptClause.call(app, t); return r ? [...r.periods].sort() : null; };
    check('except P1', ex('cancel all my classes except p1'), [1]);
    check('except period 1', ex('cancel everything except period 1'), [1]);
    check('1st period', ex('cancel all classes except 1st period'), [1]);
    check('two periods', ex('cancel all except p1 and 3'), [1, 3]);
    check('no exception clause', app._rivenExceptClause.call(app, 'cancel all my classes today'), null);
    // A class can be excepted by name as well as by period.
    ok('a named exception keeps its text',
       /math/i.test(app._rivenExceptClause.call(app, 'cancel all my classes except math').tail));
  }

  console.log('\n== the sentence from the screenshot ==\n');

  {
    const app = makeApp();
    await app.terminalCancelDay.call(app, said('cancel all my classes for the day except p1'));

    ok('it asks before doing anything', !!app.confirmed);
    // Math (P1) and Physics (P1 and P5) are both out - Physics because it
    // meets in the excepted period, and cancelling is per day, not per period.
    ok('  Chemistry is cancelled', /Chemistry/.test(app.confirmed));
    ok('  Coding is cancelled', /Coding/.test(app.confirmed));
    ok('  Math is not', !/• Math/.test(app.confirmed));
    ok('  and neither is Physics', !/• Physics/.test(app.confirmed));
    // The surprise has to be said out loud, or a teacher expecting P5 to go
    // finds out from a student.
    ok('  and it says Physics was kept whole', /kept whole/.test(app.confirmed));
    check('two classes cancelled', (app.confirmed.match(/•/g) || []).length, 2);
  }

  console.log('\n== whose classes, and which ones ==\n');

  {
    const app = makeApp();
    await app.terminalCancelDay.call(app, said('cancel all my classes today'));
    ok('someone else\'s class is never touched', !/Bible/.test(app.confirmed));
    ok('a class closed for the year is not cancelled', !/Old Chess/.test(app.confirmed));
    // Cancelling a session that was never going to happen writes a
    // cancellation nobody asked for.
    ok('a class that does not meet today is left out', !/Yearbook/.test(app.confirmed));
    check('four of mine meet today', (app.confirmed.match(/•/g) || []).length, 4);
  }

  console.log('\n== the register it throws away ==\n');

  {
    const app = makeApp({ marks: [
      { class_id: 'c2' }, { class_id: 'c2' }, { class_id: 'c2' }, { class_id: 'c3' },
    ] });
    await app.terminalCancelDay.call(app, said('cancel all my classes for the day except p1'));
    ok('the count of marks about to go is stated', /4 attendance marks/.test(app.confirmed));
    ok('  and that it cannot be undone', /no undo/i.test(app.confirmed));
    ok('  per class as well', /3 marks/.test(app.confirmed));
  }

  {
    const app = makeApp({ marks: [] });
    await app.terminalCancelDay.call(app, said('cancel all my classes today'));
    ok('a clean register says so instead of a scary zero',
       /No attendance has been taken/.test(app.confirmed));
  }

  console.log('\n== doing it ==\n');

  {
    const app = makeApp({ marks: [{ class_id: 'c2' }] });
    await app.terminalCancelDay.call(app, said('cancel all my classes for the day except p1'));

    const sessions = app.inserted.filter(i => i.table === 'class_attendance_sessions');
    check('one cancelled session per class', sessions.length, 2);
    ok('  marked cancelled', sessions.every(i => i.row.status === 'canceled'));
    ok('  on the right date', sessions.every(i => i.row.date === '2026-09-16'));
    // A cancelled session has no register.
    ok('the marks are deleted too',
       app.deleted.some(d => d.table === 'class_attendance'));
    ok('and it reports what it did', /2 classes cancelled/.test(app.ok[0]));
    ok('  naming what it left running', /Math|Physics/.test(app.ok[0]));
  }

  console.log('\n== the whole school ==\n');

  {
    // A snow day is not one teacher's day. An admin has to be able to mean the
    // building — but only by saying so.
    const app = makeApp();
    app.userInfo.profile.user_type = 'admin';
    await app.terminalCancelDay.call(app, said('cancel all classes school-wide except p1'));

    ok('another teacher\'s class is now included', /Bible/.test(app.confirmed));
    ok('  and it is flagged as school-wide', /School-wide/.test(app.confirmed));
    // A cancellation reaching other people's registers should name them first.
    ok('  naming whose days these are', /Caitlin Pennock/.test(app.confirmed));
    ok('  the exception still holds', !/• Math/.test(app.confirmed));
  }

  {
    // Scoping to the school on the strength of the word "all" would let an
    // ordinary tidy-up close every register in the building.
    const app = makeApp();
    app.userInfo.profile.user_type = 'admin';
    await app.terminalCancelDay.call(app, said('cancel all my classes today'));
    ok('an admin who did not ask for the school gets their own', !/Bible/.test(app.confirmed));
    ok('  and is told the wider option exists', /school-wide/.test(app.confirmed));
    ok('  with a count of what they are leaving', /1 other class/.test(app.confirmed));
  }

  {
    // A teacher asking for the school gets their own and an explanation, not
    // a silent narrowing.
    const app = makeApp();
    await app.terminalCancelDay.call(app, said('cancel all classes school-wide'));
    ok('a teacher is refused the wider reach', /admin-only/.test(app.said[0] || ''));
    ok('  but their own day still happens', /Chemistry/.test(app.confirmed));
    ok('  and no one else\'s is touched', !/Bible/.test(app.confirmed));
  }

  {
    // An admin who teaches nothing that day would otherwise be told they have
    // no classes, which is true and useless.
    const app = makeApp();
    app.userInfo.user.id = 'nobody';
    app.userInfo.profile.user_type = 'admin';
    await app.terminalCancelDay.call(app, said('cancel all my classes today'));
    check('nothing is cancelled', app.confirmed, null);
    ok('  and they are pointed at the school-wide form', /school-wide/.test(app.said[0] || ''));
  }

  console.log('\n== /admin widens a question, not a demolition ==\n');

  {
    // /admin skips the confirmation. If it also widened this, eight typed
    // words would clear every register in the building with nothing in
    // between. Cancelling keeps costing the words "school-wide".
    const app = makeApp();
    app.userInfo.profile.user_type = 'admin';
    app._rivenAutoConfirm = true;                       // as /admin sets it
    await app.terminalCancelDay.call(app, said('cancel all classes except p1'));
    ok('/admin does not widen a cancellation', !/Bible/.test(app.confirmed || ''));
    ok("  it is still the asker's own day", /Chemistry/.test(app.confirmed || ''));
  }

  {
    // But a question asked with the prefix does widen - that is the whole
    // point of the prefix, and a read costs nothing.
    const app = makeApp();
    app.userInfo.profile.user_type = 'admin';
    app._rivenAutoConfirm = true;
    check('/admin widens a read',
          app._rivenSchoolScope.call(app, said('who was missing today')).school, true);

    // "my" says whose, and the prefix must not overrule a sentence that does.
    check('  unless the sentence says "my"',
          app._rivenSchoolScope.call(app, said('who was missing in my classes')).school, false);

    // Without the prefix nothing changes.
    const plain = makeApp();
    plain.userInfo.profile.user_type = 'admin';
    check('  no prefix, no widening',
          plain._rivenSchoolScope.call(plain, said('who was missing today')).school, false);

    // A teacher is refused the prefix earlier, but belt and braces.
    const t = makeApp();
    t._rivenAutoConfirm = true;
    check('  and a teacher never widens',
          t._rivenSchoolScope.call(t, said('who was missing today')).school, false);
  }

  console.log('\n== nothing to do ==\n');

  {
    const app = makeApp();
    await app.terminalCancelDay.call(app, said('cancel all my classes except p1 and 2 and 3 and 5'));
    check('everything excepted cancels nothing', app.confirmed, null);
    ok('  and says so', /nothing to cancel/.test(app.said[0] || ''));
  }

  {
    const app = makeApp();
    app.userInfo.user.id = 'nobody';           // teaches none of them
    await app.terminalCancelDay.call(app, said('cancel all my classes today'));
    check('a teacher with no classes is told, not shown an empty list', app.confirmed, null);
    ok('  plainly', /aren't listed as the teacher/.test(app.errors[0] || ''));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
