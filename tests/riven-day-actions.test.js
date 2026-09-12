// The things a teacher does while the day is running.
//
// Excusing an absence, ticking a child off at pickup, calling off a session,
// and pulling a report. Teacher commands, not admin ones - they happen where
// the child is, by whoever is standing there.
//
// THE THREE THAT CAN GO WRONG QUIETLY
//
//   * EXCUSING is a flag ON an absence, not a status of its own. The register
//     still says the child was not here; the excuse is what stops it counting
//     against them. So excusing a day with nothing recorded must not create
//     the absence - that would be marking a child absent by implication, from
//     a sentence that was trying to be kind to them.
//
//   * CANCELLING DELETES. A session that did not happen has no register, so
//     cancelling removes the marks already taken for that class and date. That
//     is correct and it is not obvious, so the count is in the confirmation
//     before anyone agrees to it, and no undo is offered afterwards - an undo
//     that restored the session without the marks would be lying about what it
//     put back.
//
//   * PICKUP IS THE ONE WRITE WITH NO CONFIRMATION. Somebody is holding a car
//     door open. It goes through the same rt_set_dismissed the pickup board
//     uses, so a child ticked off here is ticked off there, and saying the
//     opposite puts them back.
//
// Run: node tests/riven-day-actions.test.js

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

const NOAH = { id: 'noah', full_name: 'Noah Williams' };
const CLASS = { id: 'c1', name: 'Chess', teacher_id: 'me', secondary_teacher_id: null };

function makeApp({ role = 'teacher', daily = [], marks = [], sessions = [], classRow = CLASS, rpcFails = null } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    updates: [],
    deletes: [],
    inserts: [],
    rpcs: [],
    undos: [],
    reports: [],
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    escapeHtml: esc,
    _localDateStr: () => '2026-09-14',
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _rivenResolvedStudent: (e) => e?.student?.student || e?.student || null,
    _pushUndo(desc, fn) { app.undos.push({ desc, fn }); },
    _rivenPhraseToDate: () => null,
    async _rivenRequireClass() { return { row: classRow, asked: false }; },
    async _pickupRpc(fn, args) {
      app.rpcs.push({ fn, args });
      if (rpcFails) throw new Error(rpcFails);
      return { success: true };
    },
    generateReportCard(id) { app.reports.push({ kind: 'report', id }); },
    generateTranscript(id) { app.reports.push({ kind: 'transcript', id }); },
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
            update(patch) { q._patch = patch; return q; },
            insert(row) { app.inserts.push({ table, row }); return Promise.resolve({ error: null }); },
            delete() { q._op = 'delete'; return q; },
            then(res, rej) {
              if (q._op === 'delete') { app.deletes.push({ table, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              if (q._patch) { app.updates.push({ table, patch: q._patch, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              const data = table === 'daily_attendance' ? daily
                : table === 'class_attendance' ? marks
                : table === 'class_attendance_sessions' ? sessions : [];
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
  for (const m of ['terminalExcuseAbsence', 'terminalMarkPickedUp', 'terminalCancelClass',
                   'terminalUncancelClass', 'terminalReportCard', 'terminalTranscript']) {
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

  console.log('\n== excusing an absence ==\n');

  {
    const app = makeApp({ daily: [{ id: 'd1', status: 'absent', excused: false }] });
    await app.terminalExcuseAbsence.call(app, said('excuse noah today'));
    check('it flags the existing absence', app.updates[0].patch, { excused: true });
    check('  the right row', app.updates[0].where.id, 'd1');
    ok('the confirmation names the day', /2026-09-14/.test(app.confirmed));
    check('  and it can be taken back', app.undos.length, 1);
  }

  {
    const app = makeApp({ daily: [{ id: 'd1', status: 'absent', excused: false }] });
    await app.terminalExcuseAbsence.call(app, said('excuse noah today because dentist'));
    check('a reason given is written with it', app.updates[0].patch,
      { excused: true, excuse_note: 'dentist' });
  }

  {
    // The one that would be worst: inventing an absence out of a sentence
    // meant to be kind to the child.
    const app = makeApp({ daily: [] });
    await app.terminalExcuseAbsence.call(app, said('excuse noah today'));
    check('nothing recorded means nothing is written', app.updates.concat(app.inserts), []);
    ok('  and it says there is no absence to excuse', /no absence/.test(app.said[0]));
    ok('  pointing at the two things that would be right', /Mark them absent first/.test(app.said[0]));
  }

  {
    const app = makeApp({ daily: [{ id: 'd1', status: 'present', excused: false }] });
    await app.terminalExcuseAbsence.call(app, said('excuse noah today'));
    check('a present student is not quietly marked absent', app.updates, []);
    ok('  and the register is quoted back', /down as <b>present<\/b>/.test(app.said[0]));
  }

  {
    const app = makeApp({ daily: [{ id: 'd1', status: 'absent', excused: true }] });
    await app.terminalExcuseAbsence.call(app, said('excuse noah today'));
    check('an already-excused absence is left alone', app.updates, []);
    ok('  and says so', /already excused/.test(app.said[0]));
  }

  console.log('\n== pickup ==\n');

  {
    const app = makeApp({});
    await app.terminalMarkPickedUp.call(app, said('noah has been picked up'));
    check('it goes through the same call the board uses', app.rpcs[0],
      { fn: 'rt_set_dismissed', args: { p_student_ids: ['noah'], p_dismissed: true } });
    // No confirmation: somebody is holding a car door open.
    check('  with no confirmation in the way', app.confirmed, null);
    ok('  and it says so plainly', /ticked off/.test(app.ok[0]));
    check('  and can be put back', app.undos.length, 1);
  }

  {
    const app = makeApp({});
    await app.terminalMarkPickedUp.call(app, said('noah has not been picked up'));
    check('the negative form puts them back on the list', app.rpcs[0].args.p_dismissed, false);
    ok('  and says that', /back on the pickup list/.test(app.ok[0]));
  }

  {
    const app = makeApp({ rpcFails: 'network down' });
    await app.terminalMarkPickedUp.call(app, said('noah has been picked up'));
    check('a failed write claims nothing', app.ok, []);
    ok('  and reports it', /Not saved: network down/.test(app.errors[0]));
    check('  and leaves no undo behind', app.undos.length, 0);
  }

  console.log('\n== cancelling a session ==\n');

  {
    const app = makeApp({ marks: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] });
    await app.terminalCancelClass.call(app, said('cancel chess today'));

    // The part nobody expects.
    ok('the confirmation counts the marks it will delete', /deletes 3 attendance marks/.test(app.confirmed));
    ok('  and names the class and the day', /Chess/.test(app.confirmed) && /2026-09-14/.test(app.confirmed));

    ok('the cancelled session is recorded', app.inserts.some(i =>
      i.table === 'class_attendance_sessions' && i.row.status === 'canceled'));
    ok('  and the marks are removed', app.deletes.some(d => d.table === 'class_attendance'));
    // An undo could not put the marks back, so none is offered.
    check('nothing claims this is undoable', app.undos.length, 0);
    ok('the answer says how many went', /3 marks removed/.test(app.ok[0]));
  }

  {
    const app = makeApp({ marks: [] });
    await app.terminalCancelClass.call(app, said('cancel chess today'));
    ok('with no marks taken it says so instead', /No attendance has been taken/.test(app.confirmed));
  }

  {
    const app = makeApp({ marks: [], classRow: { id: 'c2', name: 'Art', teacher_id: 'someone-else', secondary_teacher_id: null } });
    await app.terminalCancelClass.call(app, said('cancel art today'));
    check("a teacher cannot cancel someone else's class", app.inserts, []);
    ok('  and is told why', /not the teacher for Art/.test(app.errors[0]));
  }

  {
    const app = makeApp({
      role: 'admin',
      marks: [],
      classRow: { id: 'c2', name: 'Art', teacher_id: 'someone-else', secondary_teacher_id: null },
    });
    await app.terminalCancelClass.call(app, said('cancel art today'));
    ok('an admin can cancel any class', app.inserts.length === 1);
  }

  console.log('\n== putting it back ==\n');

  {
    const app = makeApp({ sessions: [{ id: 's1', status: 'canceled' }] });
    await app.terminalUncancelClass.call(app, said('chess is back on today'));
    ok('the cancelled session is removed', app.deletes.some(d => d.table === 'class_attendance_sessions'));
    // Honest about what did not come back.
    ok('and it says the marks are still gone', /marks taken before it was cancelled are gone/.test(app.ok[0]));
  }

  {
    const app = makeApp({ sessions: [] });
    await app.terminalUncancelClass.call(app, said('chess is back on today'));
    check('a class that was not cancelled is left alone', app.deletes, []);
    ok('  and says so', /not cancelled/.test(app.said[0]));
  }

  console.log('\n== reports ==\n');

  {
    const app = makeApp({});
    await app.terminalReportCard.call(app, said('report card for noah'));
    // One implementation, whichever way it was asked for.
    check('it hands to the page own generator', app.reports[0], { kind: 'report', id: 'noah' });
  }

  {
    const app = makeApp({});
    await app.terminalTranscript.call(app, said('transcript for noah'));
    check('and the same for a transcript', app.reports[0], { kind: 'transcript', id: 'noah' });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
