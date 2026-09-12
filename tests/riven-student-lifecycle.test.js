// Withdrawing, reinstating, credentials and the parent link.
//
// These are the heaviest things an admin does to a student record, and the ones
// where a wrong target is worst:
//
//   * WITHDRAWING archives their classes, clears their attending days and ends
//     their activities in one statement. Nothing is deleted - that is the point
//     of "past" - but they come off every register at once.
//   * A NEW PIN invalidates the old one the moment it runs, and a student who
//     cannot get into games has no way to tell anyone but a teacher.
//   * A NEW PARENT CODE does NOT unlink anyone. "New code" sounds like it
//     should, so the confirmation says otherwise.
//   * UNLINKING cuts a family off a child's grades, attendance and medical
//     notes. Doing it to the wrong family is the failure that matters.
//
// THE TWO-NAME PROBLEM
//
// "unlink sarah jones from noah" names two people. The fuzzy matcher answers
// with whichever scores best, which is usually the FIRST - the parent. Used
// directly, that unlinks the wrong person, or tries to unlink a child from
// themselves. The preposition settles it: the student is the one after "from"
// (or "to", when linking). That is the sharpest assertion in this file.
//
// Run: node tests/riven-student-lifecycle.test.js

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

const NOAH = { id: 'noah', full_name: 'Noah Williams' };
const SARAH_STUDENT = { id: 'sarah-s', full_name: 'Sarah Jones' };

function makeApp({ role = 'admin', rpc = {}, links = [], parents = [], roster = [NOAH, SARAH_STUDENT] } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    calls: [],
    deletes: [],
    inserts: [],
    undos: [],
    reloaded: 0,
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    escapeHtml: esc,
    _localDateStr: () => '2026-09-12',
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _rivenResolvedStudent: (e) => e?.student?.student || e?.student || null,
    _pushUndo(desc, fn) { app.undos.push({ desc, fn }); },
    async _loadTerminalStudents() { app.reloaded++; },
    // Deliberately simple: exact-ish name containment, which is enough to show
    // the preposition doing the work.
    _fuzzyFindStudent(text) {
      const t = (text || '').toLowerCase().trim();
      const hits = roster.filter(r => r.full_name.toLowerCase().includes(t)
        || t.includes(r.full_name.split(' ')[0].toLowerCase()));
      if (hits.length === 1) return { student: hits[0], ambiguous: false, score: 1 };
      return null;
    },
    _requestConfirmation(summary, run) {
      app.confirmed = summary;
      app._pending = (async () => run())();
    },
    auth: {
      supabase: {
        rpc(fn, args) {
          app.calls.push({ fn, args });
          return Promise.resolve({ data: rpc[fn] ?? { success: true }, error: null });
        },
        from(table) {
          const q = {
            select() { return q; },
            eq(col, val) { q._eq = q._eq || {}; q._eq[col] = val; return q; },
            or() { return q; },
            delete() { q._op = 'delete'; return q; },
            insert(row) { app.inserts.push({ table, row }); return Promise.resolve({ error: null }); },
            then(res, rej) {
              if (q._op === 'delete') {
                app.deletes.push({ table, where: q._eq });
                return Promise.resolve({ error: null }).then(res, rej);
              }
              const data = table === 'parent_child_links' ? links : parents;
              return Promise.resolve({ data, error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  for (const m of ['_rivenRequireAdmin', '_rivenPolicyError', '_rivenStudentAfterPreposition']) {
    app[m] = extract(m);
  }
  for (const m of ['terminalWithdrawStudent', 'terminalReinstateStudent', 'terminalRegeneratePin',
                   'terminalReissueParentCode', 'terminalUnlinkParent']) {
    const fn = extract(m);
    app[m] = async function (...a) {
      const r = await fn.apply(app, a);
      if (app._pending) { const p = app._pending; app._pending = null; await p; }
      return r;
    };
  }
  return app;
}

const said = (text, who = NOAH) => ({ student: { student: who }, original: text, _rawInput: text });

(async () => {

  console.log('\n== only an admin ==\n');

  {
    const app = makeApp({ role: 'teacher' });
    for (const m of ['terminalWithdrawStudent', 'terminalReinstateStudent', 'terminalRegeneratePin',
                     'terminalReissueParentCode', 'terminalUnlinkParent']) {
      await app[m].call(app, said('do the thing to noah'));
    }
    check('a teacher changes nothing', app.calls.concat(app.deletes, app.inserts), []);
    check('  and is refused every time', app.errors.length, 5);
    ok('  by name', app.errors.every(e => /Only an admin/.test(e)));
  }

  console.log('\n== withdrawing ==\n');

  {
    const app = makeApp({
      rpc: { mark_student_as_past: { success: true, classes_archived: 3, days_removed: 5, activities_ended: 1 } },
    });
    await app.terminalWithdrawStudent.call(app, said('mark noah as a past student'));

    // All three consequences, before anything happens.
    ok('the confirmation names the classes', /classes are archived/.test(app.confirmed));
    ok('  the attending days', /attending days cleared/.test(app.confirmed));
    ok('  and the activities', /activities ended/.test(app.confirmed));
    ok('  while saying what is kept', /Grades, attendance and notes are kept/.test(app.confirmed));

    const call = app.calls.find(c => c.fn === 'mark_student_as_past');
    check('it withdraws the right student', call.args.p_student_id, 'noah');
    check('  dated today', call.args.p_left_date, '2026-09-12');

    const out = app.ok[0];
    ok('the answer reports what actually moved', /3 classes archived/.test(out));
    ok('  every part of it', /5 attending days cleared/.test(out) && /1 activity ended/.test(out));
    // No undo: reinstating is its own decision and would not put classes back.
    check('nothing claims to be undoable', app.undos.length, 0);
    ok('  and the way back is named instead', /reinstate Noah/.test(out));
    check('the roster Riven matches against is refreshed', app.reloaded, 1);
  }

  {
    const app = makeApp({ rpc: { mark_student_as_past: { success: true } } });
    await app.terminalWithdrawStudent.call(app, said('mark noah as past because they moved away'));
    check('a reason given is passed on',
      app.calls[0].args.p_left_reason, 'they moved away');
  }

  {
    const app = makeApp({ rpc: { mark_student_as_past: { success: true } } });
    await app.terminalWithdrawStudent.call(app, said('mark noah as a past student'));
    // Never invented - an empty reason is better than a guessed one.
    check('no reason means no reason', app.calls[0].args.p_left_reason, null);
  }

  console.log('\n== reinstating ==\n');

  {
    const app = makeApp({ rpc: { reactivate_student: { success: true } } });
    await app.terminalReinstateStudent.call(app, said('reinstate noah'));
    check('it reinstates the right student', app.calls[0].args.p_student_id, 'noah');
    // The asymmetry people get wrong: coming back is not the reverse of leaving.
    ok('the confirmation says classes are NOT restored', /NOT restored/.test(app.confirmed));
    ok('  and the answer repeats it', /no classes or attending days/.test(app.ok[0]));
  }

  console.log('\n== credentials ==\n');

  {
    const app = makeApp({ rpc: { staff_regenerate_student_pin: { success: true, pin: 'QZ4K' } } });
    await app.terminalRegeneratePin.call(app, said('give noah a new pin'));
    ok('it warns the old PIN dies first', /stops working straight away/.test(app.confirmed));
    ok('the new PIN is shown', /QZ4K/.test(app.said[0]));
    ok('  and it says the old one is dead', /old one no longer works/.test(app.said[0]));
  }

  {
    const app = makeApp({ rpc: { rt_reissue_parent_link_code: { success: true, code: 'BXTR7K2M' } } });
    await app.terminalReissueParentCode.call(app, said('new parent link code for noah'));
    // "New code" sounds like it should cut existing parents off. It does not.
    ok('it says linked parents stay linked', /already linked stay linked/.test(app.confirmed));
    ok('  and that the old code dies', /stops working/.test(app.confirmed));
    ok('the new code is shown', /BXTR7K2M/.test(app.said[0]));
  }

  {
    const app = makeApp({ rpc: { staff_regenerate_student_pin: { success: false, error: 'refused' } } });
    let threw = false;
    try { await app.terminalRegeneratePin.call(app, said('give noah a new pin')); }
    catch (e) { threw = true; }
    ok('a refusal is not reported as a new PIN', threw || !app.said.some(x => /QZ4K/.test(x)));
  }

  console.log('\n== which of the two names is the student ==\n');

  {
    // The whole reason _rivenStudentAfterPreposition exists. The matcher hands
    // over Sarah Jones - there is a student by that name - and the parent being
    // unlinked is also Sarah Jones. Taking the matcher's answer would try to
    // unlink Noah's link from Sarah's record.
    const app = makeApp({
      links: [{ parent_id: 'auth-sarah' }],
      parents: [{ id: 'p1', first_name: 'Sarah', last_name: 'Jones', email: 's@x.com', auth_user_id: 'auth-sarah' }],
    });
    await app.terminalUnlinkParent.call(app, said('unlink sarah jones from noah', SARAH_STUDENT));

    ok('the child is the one after "from"', /Noah Williams/.test(app.confirmed));
    ok('  and the parent is the other name', /Sarah Jones/.test(app.confirmed));
    check('the link removed is the right one', app.deletes[0].where,
      { parent_id: 'auth-sarah', child_id: 'noah' });
    ok('the confirmation says what they lose',
      /grades/.test(app.confirmed) && /medical/.test(app.confirmed));
    check('  and it can be put back', app.undos.length, 1);
  }

  {
    const app = makeApp({ links: [], parents: [] });
    await app.terminalUnlinkParent.call(app, said('unlink sarah jones from noah', SARAH_STUDENT));
    check('with nobody linked, nothing is removed', app.deletes, []);
    ok('  and it says so', /No parent is linked/.test(app.said[0]));
  }

  {
    // Two linked parents and no name that matches: guessing removes the wrong
    // family's access.
    const app = makeApp({
      links: [{ parent_id: 'a1' }, { parent_id: 'a2' }],
      parents: [
        { id: 'p1', first_name: 'Ann', last_name: 'Brown', auth_user_id: 'a1' },
        { id: 'p2', first_name: 'Bob', last_name: 'Brown', auth_user_id: 'a2' },
      ],
    });
    await app.terminalUnlinkParent.call(app, said('unlink the parent from noah'));
    check('two linked parents and no name removes neither', app.deletes, []);
    ok('  and it lists who they are', /Ann Brown, Bob Brown/.test(app.errors[0]));
  }

  {
    // One linked parent and no name is unambiguous.
    const app = makeApp({
      links: [{ parent_id: 'a1' }],
      parents: [{ id: 'p1', first_name: 'Ann', last_name: 'Brown', auth_user_id: 'a1' }],
    });
    await app.terminalUnlinkParent.call(app, said('unlink the parent from noah'));
    check('one linked parent needs no name', app.deletes[0].where,
      { parent_id: 'a1', child_id: 'noah' });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
