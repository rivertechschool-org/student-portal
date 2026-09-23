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
// A MOVE IS TWO WRITES, NOT ONE
//
// Membership is many-to-many - a student can sit in several cohorts at once -
// so "move ari to upper ms" done as an add leaves them in lower ms as well, on
// two registers, with nothing on screen saying so. That is what used to
// happen: ADD_TO_GROUP's first pattern matched the word "move" and only added.
// The move joins first and leaves second, so a half-failure puts the student
// on two registers (visible, and where the old behaviour left them) rather
// than on none.
//
// A HALF-NAMED BAND IS A QUESTION, NOT A GUESS
//
// "the middle school group" matches two cohorts. Every command here read `.id`
// straight off the match - undefined on an ambiguous one - after showing a
// confirmation that named whichever candidate sorted first.
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
    asked: [],
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
    // The real one writes into #terminal-output. What matters here is only
    // that it ASKED, and with which candidates.
    _showGroupPicker(rows) { app.asked.push(rows.map(r => r.name)); },
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
  for (const m of ['_rivenRequireAdmin', '_rivenPolicyError', '_rivenParseWeekdays', '_rivenDayCodes', '_rivenDayList',
                   '_rivenDayPhrase', '_rivenDayNames', '_rivenRequireOneGroup',
                   '_rivenMatchGroup', '_rivenMatchGroupPair', '_rivenGroupCanon']) {
    app[m] = extract(m);
  }
  for (const m of ['terminalCreateGroup', 'terminalDeleteGroup', 'terminalSetGroupDays',
                   'terminalChangeGroupMembership', 'terminalMoveGroup']) {
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

  console.log('\n== a half-named band is asked about, not guessed ==\n');

  // "the middle school group" is two cohorts. Before this, each of these read
  // `.id` off the ambiguous match - undefined - and wrote with it, after a
  // confirmation naming whichever candidate happened to sort first.
  const AMBIG = { ambiguous: true, name: 'Full Junior High',
                  candidates: [{ id: 'g-jh', name: 'Full Junior High', studentIds: [] },
                               { id: 'g-ym', name: 'Full Young Middle', studentIds: ['noah'] }] };

  {
    const app = makeApp({});
    await app.terminalDeleteGroup.call(app, said('delete the middle school group', { groupMatch: AMBIG }));
    check('deleting asks which one', app.asked, [['Full Junior High', 'Full Young Middle']]);
    check('  and deletes nothing meanwhile', app.deletes, []);
    check('  and does not pretend to confirm', app.confirmed, null);
  }

  {
    const app = makeApp({});
    await app.terminalSetGroupDays.call(app,
      said('the middle school group meets tuesday', { groupMatch: AMBIG }));
    check('setting days asks which one', app.asked.length, 1);
    check('  and updates nothing meanwhile', app.updates, []);
  }

  {
    const app = makeApp({});
    await app.terminalChangeGroupMembership.call(app,
      said('add noah to the middle school group', { groupMatch: AMBIG, student: { student: NOAH } }), true);
    check('adding asks which one', app.asked.length, 1);
    check('  and writes nothing meanwhile', app.rpcs, []);
  }

  console.log('\n== moving between cohorts ==\n');

  // Invented students, and the school's own cohort structure - the same names
  // debug-tools/nlp-stress.js uses. ARI is in Young Middle and nowhere else.
  const ARI = { id: 'ari', full_name: 'Ari Mercer', first_name: 'Ari' };
  const cohorts = () => ([
    { id: 'g-ym', name: 'Full Young Middle', studentIds: ['ari', 'bo'] },
    { id: 'g-jh', name: 'Full Junior High', studentIds: ['cleo'] },
    { id: 'g-hs', name: 'Full High', studentIds: [] },
  ]);
  const one = (rows, id) => rows.find(r => r.id === id);
  const asG = (rows, id) => { const r = one(rows, id); return { id: r.id, name: r.name, row: r, studentIds: r.studentIds }; };
  const moving = (text, groups, extra = {}) =>
    said(text, { normalized: text, student: { student: ARI }, ...extra });

  {
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari from young middle to junior high', groups,
      { groupPair: { from: asG(groups, 'g-ym'), to: asG(groups, 'g-jh') } }));

    // The whole point: TWO writes. One of them is the removal the old
    // add-only path never made.
    check('two writes, one per cohort', app.rpcs.map(r => r.fn),
          ['set_student_group_members', 'set_student_group_members']);
    check('  joined first', app.rpcs[0].args, { p_group_id: 'g-jh', p_student_ids: ['cleo', 'ari'] });
    check('  then left', app.rpcs[1].args, { p_group_id: 'g-ym', p_student_ids: ['bo'] });
    ok('the confirmation names both ends',
       /out of <b>Full Young Middle<\/b> and into <b>Full Junior High<\/b>/.test(app.confirmed));
    ok('  and says what is untouched', /classes, records and RTC are untouched/.test(app.confirmed));
    check('one undo for the pair', app.undos.length, 1);
    check('said out of one and into the other', app.ok[0],
          'Ari Mercer is out of Full Young Middle and into Full Junior High.');
  }

  {
    // Nobody says where a student is leaving from - they say where they are
    // going. The source is read off the cohorts they are actually in.
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari to the junior high group', groups,
      { groupPair: { from: null, to: asG(groups, 'g-jh') } }));
    check('an unsaid source is read off where they are', app.rpcs.map(r => r.args.p_group_id), ['g-jh', 'g-ym']);
    ok('  and the confirmation names it anyway', /out of <b>Full Young Middle<\/b>/.test(app.confirmed));
  }

  {
    // In two cohorts and neither was named: guessing here takes a child off a
    // register nobody mentioned.
    const groups = cohorts();
    one(groups, 'g-hs').studentIds = ['ari'];
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari to the junior high group', groups,
      { groupPair: { from: null, to: asG(groups, 'g-jh') } }));
    check('two possible sources writes nothing', app.rpcs, []);
    ok('  and names them both', /Full Young Middle and Full High/.test(app.errors[0]));
    ok('  and shows how to say it', /out of Full Young Middle into Full Junior High/.test(app.errors[0]));
  }

  {
    // In no cohort at all: the move is an add, and says so rather than
    // reporting a removal that never happened.
    const groups = cohorts();
    one(groups, 'g-ym').studentIds = ['bo'];
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari to the junior high group', groups,
      { groupPair: { from: null, to: asG(groups, 'g-jh') } }));
    check('nothing to leave means one write', app.rpcs.length, 1);
    ok('  and the confirmation admits it', /only adds them/.test(app.confirmed));
    check('  and the success line does not claim a removal', app.ok[0], 'Ari Mercer is in Full Junior High.');
  }

  {
    // Named a source they are not in. Half right, and the confirmation says
    // which half.
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari from the high group to junior high', groups,
      { groupPair: { from: asG(groups, 'g-hs'), to: asG(groups, 'g-jh') } }));
    check('a source they are not in is not written to', app.rpcs.map(r => r.args.p_group_id), ['g-jh']);
    ok('  and it is said out loud', /is not in Full High, so this only adds them/.test(app.confirmed));
  }

  {
    // A half-named source settles itself when they are only in one of them.
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari out of middle school into the high group', groups,
      { groupPair: { from: { ambiguous: true, candidates: [one(groups, 'g-jh'), one(groups, 'g-ym')] },
                     to: asG(groups, 'g-hs') } }));
    check('the cohort they are in settles a half-named source',
          app.rpcs.map(r => r.args.p_group_id), ['g-hs', 'g-ym']);
  }

  {
    // ...and asks when it does not settle.
    const groups = cohorts();
    one(groups, 'g-jh').studentIds = ['cleo', 'ari'];
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari out of middle school into the high group', groups,
      { groupPair: { from: { ambiguous: true, candidates: [one(groups, 'g-jh'), one(groups, 'g-ym')] },
                     to: asG(groups, 'g-hs') } }));
    check('two live candidates writes nothing', app.rpcs, []);
    ok('  and asks', /Which group are they leaving/.test(app.errors[0]));
  }

  {
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari to the young middle group', groups,
      { groupPair: { from: null, to: asG(groups, 'g-ym') } }));
    check('moving somebody where they already are writes nothing', app.rpcs, []);
    ok('  and says so', /already in Full Young Middle/.test(app.said[0]));
  }

  {
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app,
      said('move ari to junior high', { normalized: 'move ari to junior high', student: { student: ARI } }));
    // groupPair absent: the handler re-reads the sentence rather than
    // assuming the caller filled it in.
    check('the destination is re-read when it was not passed in',
          app.rpcs.map(r => r.args.p_group_id), ['g-jh', 'g-ym']);
  }

  {
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app,
      said('move ari somewhere', { normalized: 'move ari somewhere', student: { student: ARI } }));
    check('no destination writes nothing', app.rpcs, []);
    ok('  and asks for one', /Which group are they moving into/.test(app.errors[0]));
  }

  {
    const app = makeApp({ role: 'teacher', groups: cohorts() });
    await app.terminalMoveGroup.call(app,
      said('move ari to junior high', { normalized: 'move ari to junior high', student: { student: ARI } }));
    check('a teacher cannot move anyone', app.rpcs, []);
    ok('  and is told who can', /Only an admin can move a student between groups/.test(app.errors[0]));
  }

  {
    // The half-failure. Joined, then the removal fails: they are on two
    // registers, and saying "moved" would be the same silent lie the
    // add-only behaviour told.
    const groups = cohorts();
    const app = makeApp({ groups });
    let n = 0;
    app.auth.supabase.rpc = (fn, args) => {
      app.rpcs.push({ fn, args });
      return Promise.resolve(++n === 1 ? { data: { success: true }, error: null }
                                       : { data: null, error: { message: 'row level security' } });
    };
    await app.terminalMoveGroup.call(app, moving('move ari from young middle to junior high', groups,
      { groupPair: { from: asG(groups, 'g-ym'), to: asG(groups, 'g-jh') } }));
    check('a failed removal is not reported as a move', app.ok, []);
    ok('  it says where they actually are', /now in Full Junior High, but taking them out of Full Young Middle failed/.test(app.errors[0]));
    ok('  and that both registers have them', /on both registers/.test(app.errors[0]));
    check('  and nothing is offered to undo', app.undos.length, 0);
  }

  {
    // Undo puts both ends back, not just the one that is easy to remember.
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari from young middle to junior high', groups,
      { groupPair: { from: asG(groups, 'g-ym'), to: asG(groups, 'g-jh') } }));
    app.rpcs.length = 0;
    await app.undos[0].fn();
    check('undo restores both lists', app.rpcs.map(r => r.args),
          [{ p_group_id: 'g-ym', p_student_ids: ['ari', 'bo'] },
           { p_group_id: 'g-jh', p_student_ids: ['cleo'] }]);
    check('  and the cached rows with them',
          [one(groups, 'g-ym').studentIds, one(groups, 'g-jh').studentIds],
          [['ari', 'bo'], ['cleo']]);
  }

  {
    // The cache the NEXT command reads. Without this the second move in a
    // session still sees the membership from before the first.
    const groups = cohorts();
    const app = makeApp({ groups });
    await app.terminalMoveGroup.call(app, moving('move ari from young middle to junior high', groups,
      { groupPair: { from: asG(groups, 'g-ym'), to: asG(groups, 'g-jh') } }));
    check('the cached rows move with the student',
          [one(groups, 'g-ym').studentIds, one(groups, 'g-jh').studentIds],
          [['bo'], ['cleo', 'ari']]);
  }

  {
    // Same cache, the add/remove path. It updated the throwaway match object
    // and left the row behind it stale.
    const app = makeApp({});
    const row = { id: 'g1', name: 'Thursday Lab', studentIds: ['alice'], meets_days: [4] };
    await app.terminalChangeGroupMembership.call(app,
      said('add noah to the thursday lab group',
           { groupMatch: { id: row.id, name: row.name, row, studentIds: row.studentIds }, student: { student: NOAH } }), true);
    check('adding updates the cached row too', row.studentIds, ['alice', 'noah']);
  }

  console.log('\n== the wires between the two ==\n');

  ok('MOVE_GROUP reaches the handler',
     /case 'MOVE_GROUP':\s*\n\s*return await this\.terminalMoveGroup\(entities\);/.test(html));
  {
    // Anchored to the list itself: the bare name also appears in the intent
    // table, so a loose match here passes with MOVE_GROUP missing from this
    // one - which is the whole thing being asserted.
    const writes = /const WRITE_INTENTS = \[([\s\S]*?)\];/.exec(html);
    ok('  and is known to be a write, so a question about it is answered not obeyed',
       writes && /'MOVE_GROUP'/.test(writes[1]));
  }
  ok('  and a non-admin is told what they were refused',
     /MOVE_GROUP: 'move a student between groups'/.test(html));
  ok('  and it is offered in /help beside the add and the remove',
     /"Move \[student\] from \[group\] to \[group\]"/.test(html));
  // It has to OUTRANK the add, whose first pattern still matches "move" - that
  // is the whole reason a move used to only add.
  {
    const move = /intent: 'MOVE_GROUP',\s*\n\s*w: (\d+)/.exec(html);
    const add = /intent: 'ADD_TO_GROUP',\s*\n\s*w: (\d+)/.exec(html);
    ok('a move outweighs an add', move && add && Number(move[1]) > Number(add[1]));
  }
  ok('the add still matches the word "move", which is why the weight matters',
     /\(add\|put\|move\)/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
