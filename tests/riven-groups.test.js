// Student groups.
//
// At this school the cohort IS the morning register: the daily roster is taken
// per group, against the students in it who attend that weekday. So Riven read
// groups constantly and could change none of them, which is the wrong way
// round for the thing the day starts with.
//
// All of it is admin-only. Which days a cohort meets decides whose name is on
// which morning list; membership decides who a teacher is handed at 8am.
//
// ONE WRITE, BOTH DIRECTIONS
//
// set_student_group_members takes the WHOLE membership list and replaces it in
// one statement, so adding and removing are the same write with a different
// list. Doing it as two calls - delete then insert - would leave a window
// where a child is on no register at all, which at 8am is a child nobody is
// looking for.
//
// WHAT DELETING A GROUP DOES NOT DO
//
// It does not touch anyone's classes, grades or records. People assume it
// does, so the confirmation says so explicitly - the fear otherwise stops
// somebody tidying up a cohort that should have gone at Christmas.
//
// Run: node tests/riven-groups.test.js

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
const group = (over = {}) => ({ id: 'g1', name: 'Thursday Lab', studentIds: ['alice'], meets_days: [4], ...over });

function makeApp({ role = 'admin', groups = [], rpc = {} } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    inserts: [],
    updates: [],
    deletes: [],
    rpcs: [],
    undos: [],
    reloaded: 0,
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    _terminalAllGroups: groups,
    escapeHtml: esc,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _pushUndo(desc, fn) { app.undos.push({ desc, fn }); },
    _rivenResolvedStudent: (e) => e?.student?.student || e?.student || null,
    async _loadTerminalGroups() { app.reloaded++; },
    _requestConfirmation(summary, run) {
      app.confirmed = summary;
      app._pending = (async () => run())();
    },
    auth: {
      supabase: {
        rpc(fn, args) {
          app.rpcs.push({ fn, args });
          return Promise.resolve({ data: rpc[fn] ?? { success: true }, error: null });
        },
        from(table) {
          const q = {
            select() { return q; },
            eq(c, v) { q._eq = q._eq || {}; q._eq[c] = v; return q; },
            insert(row) { app.inserts.push({ table, row }); return Promise.resolve({ error: null }); },
            update(patch) { q._patch = patch; return q; },
            delete() { q._op = 'delete'; return q; },
            then(res, rej) {
              if (q._op === 'delete') { app.deletes.push({ table, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              if (q._patch) { app.updates.push({ table, patch: q._patch, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              return Promise.resolve({ data: [], error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  for (const m of ['_rivenRequireAdmin', '_rivenPolicyError', '_rivenParseWeekdays', '_rivenDayList',
                   '_rivenDayPhrase', '_rivenDayNames']) {
    app[m] = extract(m);
  }
  for (const m of ['terminalCreateGroup', 'terminalDeleteGroup', 'terminalSetGroupDays',
                   'terminalChangeGroupMembership']) {
    const fn = extract(m);
    app[m] = async function (...a) {
      const r = await fn.apply(app, a);
      if (app._pending) { const p = app._pending; app._pending = null; await p; }
      return r;
    };
  }
  return app;
}

const said = (text, extra = {}) => ({ original: text, _rawInput: text, ...extra });

(async () => {

  console.log('\n== only an admin ==\n');

  {
    const app = makeApp({ role: 'teacher' });
    await app.terminalCreateGroup.call(app, said('create a group called thursday lab'));
    await app.terminalDeleteGroup.call(app, said('delete the thursday lab group', { groupMatch: group() }));
    await app.terminalSetGroupDays.call(app, said('thursday lab meets friday', { groupMatch: group() }));
    await app.terminalChangeGroupMembership.call(app,
      said('add noah to thursday lab', { groupMatch: group(), student: { student: NOAH } }), true);
    check('a teacher changes nothing', app.inserts.concat(app.updates, app.deletes, app.rpcs), []);
    check('  refused every time', app.errors.length, 4);
  }

  console.log('\n== creating ==\n');

  {
    const app = makeApp({});
    await app.terminalCreateGroup.call(app, said('create a group called "Thursday Lab"'));
    check('the name in quotes is the name', app.inserts[0].row.name, 'Thursday Lab');
    // Nobody expects a new group to already have people or days in it, but
    // saying so stops the next question.
    ok('the confirmation says it starts empty', /starts empty/.test(app.confirmed));
    check('  and the group list is refreshed', app.reloaded, 1);
  }

  {
    const app = makeApp({});
    await app.terminalCreateGroup.call(app, said('create a group called Thursday Lab'));
    check('no quotes needed', app.inserts[0].row.name, 'Thursday Lab');
  }

  {
    const app = makeApp({ groups: [group()] });
    await app.terminalCreateGroup.call(app, said('create a group called Thursday Lab'));
    check('a duplicate name creates nothing', app.inserts, []);
    ok('  and says it exists', /already exists/.test(app.said[0]));
  }

  {
    const app = makeApp({});
    await app.terminalCreateGroup.call(app, said('create a new group'));
    check('with no name, nothing is created', app.inserts, []);
    ok('  and it asks for one', /What should it be called/.test(app.errors[0]));
  }

  console.log('\n== deleting ==\n');

  {
    const app = makeApp({});
    await app.terminalDeleteGroup.call(app,
      said('delete the thursday lab group', { groupMatch: group({ studentIds: ['a', 'b', 'c'] }) }));
    ok('the confirmation counts who is in it', /3 students are in it/.test(app.confirmed));
    // The fear that stops people tidying up.
    ok('  and says what they keep', /keep their classes and records/.test(app.confirmed));
    check('the group is deleted', app.deletes[0].where.id, 'g1');
    ok('  and the answer repeats the reassurance', /Nobody lost a class or a record/.test(app.ok[0]));
  }

  {
    const app = makeApp({});
    await app.terminalDeleteGroup.call(app, said('delete the thursday lab group', { groupMatch: group({ studentIds: [] }) }));
    ok('an empty group says so', /It is empty/.test(app.confirmed));
  }

  console.log('\n== which days it meets ==\n');

  {
    const app = makeApp({});
    await app.terminalSetGroupDays.call(app,
      said('thursday lab meets tuesday and thursday', { groupMatch: group({ meets_days: [4] }) }));
    check('the days are written', app.updates[0].patch, { meets_days: [2, 4] });
    ok('the confirmation shows the change', /Thursday →/.test(app.confirmed));
    // The two are constantly confused.
    ok('  and separates it from a student own days',
      /does not change any student's own attending days/.test(app.confirmed));
    check('  and it can be put back', app.undos.length, 1);
  }

  {
    const app = makeApp({});
    await app.terminalSetGroupDays.call(app, said('thursday lab meets', { groupMatch: group() }));
    check('no day named, nothing written', app.updates, []);
    ok('  and it asks which', /Which days/.test(app.errors[0]));
  }

  {
    // The group is CALLED Thursday Lab, and its name is part of every sentence
    // about it. Parsing the whole sentence made the name a meeting day, so
    // there was no way to say "meets friday" about it at all.
    const app = makeApp({});
    await app.terminalSetGroupDays.call(app,
      said('thursday lab meets friday', { groupMatch: group({ meets_days: [4] }) }));
    check('the name is not read as a day', app.updates[0].patch, { meets_days: [5] });
  }

  console.log('\n== membership ==\n');

  {
    const app = makeApp({});
    const g = group({ studentIds: ['alice'] });
    await app.terminalChangeGroupMembership.call(app,
      said('add noah to the thursday lab group', { groupMatch: g, student: { student: NOAH } }), true);

    // One statement, whole list - never delete-then-insert.
    check('the whole membership goes in one call', app.rpcs[0],
      { fn: 'set_student_group_members', args: { p_group_id: 'g1', p_student_ids: ['alice', 'noah'] } });
    ok('the confirmation says when they appear', /from the next morning it meets/.test(app.confirmed));
    check('  and it can be put back', app.undos.length, 1);
  }

  {
    const app = makeApp({});
    const g = group({ studentIds: ['alice', 'noah'] });
    await app.terminalChangeGroupMembership.call(app,
      said('take noah out of the thursday lab group', { groupMatch: g, student: { student: NOAH } }), false);
    check('removing sends the list without them', app.rpcs[0].args.p_student_ids, ['alice']);
    ok('  and says what is untouched', /classes[\s\S]{0,40}untouched/.test(app.confirmed));
  }

  {
    const app = makeApp({});
    await app.terminalChangeGroupMembership.call(app,
      said('add noah to thursday lab', { groupMatch: group({ studentIds: ['noah'] }), student: { student: NOAH } }), true);
    check('adding somebody already in it writes nothing', app.rpcs, []);
    ok('  and says so', /already in/.test(app.said[0]));
  }

  {
    const app = makeApp({});
    await app.terminalChangeGroupMembership.call(app,
      said('take noah out of thursday lab', { groupMatch: group({ studentIds: ['alice'] }), student: { student: NOAH } }), false);
    check('removing somebody who is not in it writes nothing', app.rpcs, []);
    ok('  and says so', /is not in/.test(app.said[0]));
  }

  {
    const app = makeApp({ rpc: { set_student_group_members: { success: false, error: 'refused' } } });
    let threw = false;
    try {
      await app.terminalChangeGroupMembership.call(app,
        said('add noah to thursday lab', { groupMatch: group(), student: { student: NOAH } }), true);
    } catch (e) { threw = true; }
    ok('a refused change is not reported as done', threw || !app.ok.length);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
