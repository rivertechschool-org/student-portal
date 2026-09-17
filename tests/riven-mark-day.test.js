// "Luke and Evan will be absent today" is two people and a whole day.
//
// Riven answered that with "Which class? Say it like 'mark Evan absent in
// Math'." Two things were wrong with it.
//
// 1. IT ASKED FOR SOMETHING THE SENTENCE HAD ALREADY ANSWERED. A child who is
//    off school is not off one lesson. This school keeps two registers for
//    exactly that distinction — daily_attendance is whether they came in at
//    all, class_attendance is whether they came to the lesson — and marking
//    only ever wrote the second. So the rule is the one people already speak
//    by:
//
//      a class named       -> that lesson's register
//      "all their classes" -> every lesson they are in
//      nothing named       -> the morning register, the whole day
//
// 2. IT ONLY EVER READ ONE NAME. "Luke and Evan" is one thought, not two, and
//    the entity reader had already resolved both.
//
// Run: node tests/riven-mark-day.test.js

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

const isoDaysAgo = extract('_isoDaysAgo');
const TODAY = isoDaysAgo.call({}, 0);
const YESTERDAY = isoDaysAgo.call({}, 1);

const DARA = { id: 'u1', full_name: 'Dara Winslow' };
const EVAN = { id: 'u2', full_name: 'Evan Fenn' };

// Records every write, so the test can say WHICH register was touched — which
// is the whole point of the change.
function makeApp({ enrolled = ['u1', 'u2'], prevDaily = [] } = {}) {
  const app = {
    said: [], errors: [], asked: [], writes: [], undo: [],
    userInfo: { user: { id: 'me' }, profile: { id: 'me', user_type: 'admin' } },
    escapeHtml: (t) => String(t == null ? '' : t),
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    terminalPrint(m) { app.said.push(m); },
    _naturalSuccess(list) { app.said.push(list[0]); },
    _pushUndo(label, fn) { app.undo.push({ label, fn }); },
    // A confirmation the test can answer, so a two-person write can be walked
    // all the way through rather than stopping at the prompt.
    _requestConfirmation(msg, fn) { app.asked.push(msg); app._pending = fn; },
    _isoDaysAgo: isoDaysAgo,
    _rivenClassIsOpen: () => true,
    _rivenCanManageClass: () => true,
    _rivenRefuseIfClosed: () => false,
    _terminalAllClasses: [{ id: 'c1', name: 'Math', is_active: true, status: 'active' }],
    async _rivenRequireClass() { return { asked: false, row: app._terminalAllClasses[0] }; },
    auth: { supabase: { from(table) {
      const rec = { table, filters: {} };
      const q = {
        select: () => q, order: () => q, limit: () => q, is: () => q,
        eq: (c, v) => { rec.filters[c] = v; return q; },
        in: (c, v) => { rec.filters[c] = v; return q; },
        insert: (rows) => { app.writes.push({ table, op: 'insert', rows }); return Promise.resolve({ error: null }); },
        upsert: (rows, opts) => { app.writes.push({ table, op: 'upsert', rows, opts }); return Promise.resolve({ error: null }); },
        delete: () => { const d = { table, op: 'delete', filters: rec.filters };
                        app.writes.push(d);
                        const dq = { eq: (c, v) => { d.filters[c] = v; return dq; }, is: () => dq,
                                     then: (res) => Promise.resolve({ error: null }).then(res) };
                        return dq; },
        then: (res, rej) => {
          let data = [];
          if (table === 'class_enrollments') {
            data = enrolled.map(id => ({ student_id: id, class_id: 'c1', status: 'active' }));
          } else if (table === 'daily_attendance') {
            data = prevDaily;
          }
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return q;
    } } },
  };
  app.terminalMarkAttendance = extract('terminalMarkAttendance');
  return app;
}
const ents = (over) => Object.assign({ original: '', _rawInput: '', normalized: '' }, over);
const wrote = (app, table) => app.writes.filter(w => w.table === table && w.op !== 'delete');

(async () => {

  console.log('\n== the sentence that was reported ==\n');

  {
    const app = makeApp();
    await app.terminalMarkAttendance.call(app, ents({
      normalized: 'dara and evan fenn will be absent today',
      students: [{ student: DARA }, { student: EVAN }],
    }));
    // Two people, so it asks first — then the test says yes.
    check('it asks once before writing for two people', app.asked.length, 1);
    ok('  and names them both', /Dara Winslow and Evan Fenn/.test(app.asked[0]));
    ok('  saying it is the whole day', /whole day/.test(app.asked[0]));
    await app._pending();

    // THE ONE THAT WAS WRONG. It used to ask which class instead.
    check('nothing asked which class', app.errors.concat(app.said).filter(s => /which class/i.test(s)), []);
    const daily = wrote(app, 'daily_attendance');
    check('the DAY register was written', daily.length, 1);
    check('  for both of them', daily[0].rows.map(r => r.student_id).sort(), ['u1', 'u2']);
    check('  absent', [...new Set(daily[0].rows.map(r => r.status))], ['absent']);
    check('  today', [...new Set(daily[0].rows.map(r => r.date))], [TODAY]);
    // Marking twice has to correct, not duplicate.
    check('  upserted on the student and the day', daily[0].opts, { onConflict: 'student_id,date' });
    check('and no lesson register was touched', wrote(app, 'class_attendance').length, 0);
    ok('the answer says which register it was', /day register|whole of/.test(app.said.join(' ')));
  }

  console.log('\n== naming a class still means that lesson ==\n');

  {
    const app = makeApp();
    await app.terminalMarkAttendance.call(app, ents({
      normalized: 'mark dara absent in math',
      student: { student: DARA },
      classMatch: { id: 'c1', row: { id: 'c1', name: 'Math' } },
    }));
    check('the lesson register was written', wrote(app, 'class_attendance').length, 1);
    check('  and the day register was not', wrote(app, 'daily_attendance').length, 0);
    check('  one person, so no confirmation', app.asked.length, 0);
  }

  console.log('\n== one person, no class ==\n');

  {
    const app = makeApp();
    await app.terminalMarkAttendance.call(app, ents({
      normalized: 'mark dara absent', student: { student: DARA },
    }));
    check('goes straight to the day register', wrote(app, 'daily_attendance').length, 1);
    check('  without asking', app.asked.length, 0);
    check('  for that one person', wrote(app, 'daily_attendance')[0].rows.length, 1);
  }

  console.log('\n== the status and the day are read from the sentence ==\n');

  for (const [text, status] of [['mark dara absent', 'absent'], ['mark dara late', 'late'],
                                ['mark dara present', 'present'], ['dara left early', 'left_early']]) {
    const app = makeApp();
    await app.terminalMarkAttendance.call(app, ents({ normalized: text, student: { student: DARA } }));
    check(`"${text}"`, wrote(app, 'daily_attendance')[0].rows[0].status, status);
  }
  {
    const app = makeApp();
    await app.terminalMarkAttendance.call(app, ents({ normalized: 'dara was absent yesterday', student: { student: DARA } }));
    check('yesterday is yesterday', wrote(app, 'daily_attendance')[0].rows[0].date, YESTERDAY);
  }
  {
    const app = makeApp();
    await app.terminalMarkAttendance.call(app, ents({ normalized: 'dara was here', student: { student: DARA } }));
    check('no status in the sentence is refused', wrote(app, 'daily_attendance').length, 1);
  }
  {
    const app = makeApp();
    await app.terminalMarkAttendance.call(app, ents({ normalized: 'do something with dara', student: { student: DARA } }));
    check('a sentence with no status at all writes nothing', app.writes.length, 0);
    ok('  and says what is missing', /present, absent, late/.test(app.errors.join(' ')));
  }

  console.log('\n== undo puts back what was there ==\n');

  {
    // Somebody already marked present today; marking them absent has to be
    // reversible to PRESENT, not to nothing.
    const app = makeApp({ prevDaily: [{ id: 'r1', student_id: 'u1', date: TODAY, status: 'present', marked_by: 'x' }] });
    await app.terminalMarkAttendance.call(app, ents({ normalized: 'mark dara absent', student: { student: DARA } }));
    check('one undo step was recorded', app.undo.length, 1);
    ok('  described in words', /Dara Winslow/.test(app.undo[0].label));
    app.writes.length = 0;
    await app.undo[0].fn();
    const back = wrote(app, 'daily_attendance');
    check('undo restores the previous row', back.length, 1);
    check('  to what it was', back[0].rows.status, 'present');
    ok('  without its old id', back[0].rows.id === undefined);
  }
  {
    // Nothing there before: undo has to REMOVE the row, not write a blank one.
    const app = makeApp({ prevDaily: [] });
    await app.terminalMarkAttendance.call(app, ents({ normalized: 'mark dara absent', student: { student: DARA } }));
    app.writes.length = 0;
    await app.undo[0].fn();
    const del = app.writes.filter(w => w.op === 'delete' && w.table === 'daily_attendance');
    check('undo deletes a row that was not there before', del.length, 1);
    check('  for that student and day', [del[0].filters.student_id, del[0].filters.date], ['u1', TODAY]);
  }

  console.log('\n== somebody not in the class is named, not silently dropped ==\n');

  {
    const app = makeApp({ enrolled: ['u1'] });   // Evan is not in Math
    await app.terminalMarkAttendance.call(app, ents({
      normalized: 'mark dara and evan absent in math',
      students: [{ student: DARA }, { student: EVAN }],
      classMatch: { id: 'c1', row: { id: 'c1', name: 'Math' } },
    }));
    // One class and one person actually being marked, so there is nothing to
    // confirm - the skipped name belongs in the answer instead.
    check('no confirmation needed for a single write', app.asked.length, 0);
    const rows = wrote(app, 'class_attendance');
    check('only the one who is in it is marked', rows.map(r => r.rows.student_id), ['u1']);
    const answer = app.said.join(' ');
    ok('and the answer names who was left out', /Evan Fenn/.test(answer));
    ok('  saying why', /not enrolled/.test(answer));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
