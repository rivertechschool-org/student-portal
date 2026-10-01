// How the portal files a student's progress, and how game assignments count.
//
// An audit (2026-10-01) found the portal wrote progress under the LOGIN id
// (refused for roster-created students, so their practice vanished), saved
// every belt-test skill as mastered/100, accepted "mastered" on two questions,
// and never completed a game assignment. Each rule below is one of those.
//
// Run: node tests/progress-plumbing.test.js

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Lift a class method out of the page (same approach as emergency-drill.test.js).
function extract(name, { sync = false } = {}) {
  const re = new RegExp('\\n      (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', closeParen);
  let depth = 0; const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const Ctor = sync ? Function : Object.getPrototypeOf(async function () {}).constructor;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// A recording Supabase client: every write is kept, reads answer from `rows`.
function makeClient(rows = {}) {
  const writes = [];
  const from = (table) => {
    const q = { table, filters: {} };
    const api = {
      select() { return api; }, in() { return api; }, order() { return api; }, not() { return api; },
      gte() { return api; }, single() { return api; }, maybeSingle() { return api; },
      eq(c, v) { q.filters[c] = v; return api; },
      upsert(row, opts) { writes.push({ op: 'upsert', table, row, opts }); return Promise.resolve({ error: null }); },
      update(row) { writes.push({ op: 'update', table, row }); return api; },
      then(r) { return Promise.resolve({ data: rows[table] || [], error: null }).then(r); },
    };
    return api;
  };
  return { writes, client: { from } };
}

function makeApp({ profileId = 'p-profile', loginId = 'u-login', type = 'student', rows = {}, rpc } = {}) {
  const { writes, client } = makeClient(rows);
  const app = {
    writes, notices: [], rpcCalls: [],
    userInfo: { user: { id: loginId }, profile: { id: profileId, user_type: type } },
    auth: { supabase: client },
    supabaseQuery: (fn) => fn(),
    showNotification(m, k) { app.notices.push(`${k}:${m}`); },
    escapeHtml: (t) => String(t),
    async _pickupRpc(fn, args) { app.rpcCalls.push({ fn, args }); return rpc ? rpc(fn, args) : { success: true }; },
  };
  for (const m of ['upsertSkillProgress', 'handleBackfillSkills', 'incrementPracticeCount',
                   'checkSkillMasteryHomework', '_noteHomeworkSession', '_flushHomework',
                   'sendSkillDataForDojo']) app[m] = extract(m);
  for (const m of ['_progressStudentId', '_sessionScore', '_renderHomeworkProgress']) app[m] = extract(m, { sync: true });
  return app;
}

global.document = { getElementById: () => null, visibilityState: 'visible' };
global.window = { location: { origin: 'https://rivertech.test' } };
const upserts = (app) => app.writes.filter(w => w.op === 'upsert' && w.table === 'skill_progress');

(async () => {
  console.log('\n== filed under the profile id ==\n');
  {
    const app = makeApp();
    await app.upsertSkillProgress('Fractions', 'Math', 50, 'in_progress');
    check('a skill is written under the PROFILE id, not the login id', upserts(app)[0].row.user_id, 'p-profile');
    let posted;
    await app.sendSkillDataForDojo({ postMessage: (m) => { posted = m; } }, 'Math');
    check('  and read back under it', posted.owner, 'p-profile');
    check('  as the reply the games expect', posted.type, 'SKILL_DATA_FOR_DOGO');
  }

  console.log('\n== mastered has to be earned ==\n');
  {
    const app = makeApp();
    await app.upsertSkillProgress('A', 'Reading', 60, 'activated');
    check('60% claimed as activated is saved as in progress', upserts(app)[0].row.state, 'in_progress');
    await app.upsertSkillProgress('B', 'Math', 85, 'mastered');
    check('85% claimed as mastered is mastered', upserts(app)[1].row.state, 'mastered');
    await app.upsertSkillProgress('C', 'Math', 95, 'mastered', 0.7, null);
    check('a probability under 0.85 overrides a high score claim', upserts(app)[2].row.state, 'in_progress');
    await app.upsertSkillProgress('D', 'Math', 90, 'mastered', 0.9, null, 'game');
    check('a probability of 0.9 is mastered', upserts(app)[3].row.state, 'mastered');
    check('  and the source is recorded', upserts(app)[3].row.source, 'game');
    ok('the page no longer stamps its own mastered date', !('mastered_at' in upserts(app)[1].row));
    await app.upsertSkillProgress('E', 'Math', 250, 'needs_review');
    check('an out-of-range score is clamped', upserts(app)[4].row.mastery_score, 100);
    check('  and an unknown state is not sent to a check that refuses it', upserts(app)[4].row.state, 'in_progress');
  }

  console.log('\n== the belt-test backfill ==\n');
  {
    const app = makeApp();
    await app.handleBackfillSkills({ subject: 'Math', skills: [
      { skillName: 'Counting', state: 'mastered', mastery_score: 100 },
      { skillName: 'Fractions', state: 'in_progress', mastery_score: 40 },
      { skillName: 'Decimals', state: 'available' },
    ] });
    const [m, other] = upserts(app);
    check('mastered skills are saved as mastered', m.row.map(r => [r.skill_name, r.state]), [['Counting', 'mastered']]);
    check('  labelled as a belt test', m.row[0].source, 'belt_test');
    check('everything else keeps its own state', other.row.map(r => [r.skill_name, r.state]), [['Fractions', 'in_progress'], ['Decimals', 'available']]);
    check('  and is insert-only, so it can never overwrite or downgrade', other.opts.ignoreDuplicates, true);
    check('nothing is written as mastered that was not sent as mastered',
          upserts(app).flatMap(w => w.row).filter(r => r.state === 'mastered').length, 1);
  }
  {
    const app = makeApp({ type: 'teacher' });
    await app.handleBackfillSkills({ subject: 'Math', skills: [{ skillName: 'X', state: 'mastered' }] });
    check('a teacher previewing a game writes nothing', upserts(app).length, 0);
  }

  console.log('\n== a game session counts toward its assignment ==\n');
  {
    const app = makeApp();
    check('score from an explicit score', app._sessionScore({ score: 87.4 }), 87);
    check('score from correct/total', app._sessionScore({ correct: 3, total: 4 }), 75);
    check('score from a Dojo session', app._sessionScore({ skillProgress: [{ correct: 2, total: 4 }, { correct: 4, total: 4 }] }), 75);
    check('no score when there is nothing to score', app._sessionScore({}), null);
  }
  {
    const app = makeApp({ rpc: () => ({ success: true, status: 'in_progress', best_score: 80, play_seconds: 300 }) });
    app._activeHomework = { id: 'hw1', gameId: 'mathspire', minScore: 70, minMinutes: 10, best: null, played: 0, pending: 45, sinceFlush: 45, sawSummary: false, status: 'in_progress' };
    await app._noteHomeworkSession({ type: 'GAME_SESSION_SUMMARY', homeworkId: 'hw1', score: 80 }, 'summary');
    await new Promise(r => setTimeout(r, 10));
    check('a summary reports its score and the time measured here', app.rpcCalls[0],
          { fn: 'rt_homework_record_session', args: { p_homework_id: 'hw1', p_score: 80, p_seconds: 45, p_source: 'mathspire' } });
    check('  and the banked time is cleared', app._activeHomework.pending, 0);

    app._noteHomeworkSession({ type: 'GAME_SESSION_COMPLETE', score: 80 }, 'legacy');
    await new Promise(r => setTimeout(r, 2200));
    check('an older message from a game that also sent a summary is not counted twice', app.rpcCalls.length, 1);

    await app._noteHomeworkSession({ type: 'GAME_SESSION_SUMMARY', homeworkId: 'other-hw', score: 99 }, 'summary');
    check('a session from another assignment is ignored', app.rpcCalls.length, 1);
  }
  {
    const app = makeApp({ rpc: () => ({ success: true, status: 'completed', best_score: 90, play_seconds: 660 }) });
    app._activeHomework = { id: 'hw2', gameId: 'mathletics', title: 'Times tables', minScore: 70, minMinutes: 10, best: 60, played: 600, pending: 60, sinceFlush: 60, sawSummary: false, status: 'in_progress' };
    await app._flushHomework(90);
    ok('completing it tells the student', app.notices.some(n => /Assignment complete/.test(n)));
    await app._flushHomework(95);
    check('  and nothing more is reported once complete', app.rpcCalls.length, 1);
  }
  {
    const app = makeApp({ rpc: () => { throw new Error('offline'); } });
    app._activeHomework = { id: 'hw3', minScore: 70, minMinutes: 10, best: null, played: 0, pending: 30, sinceFlush: 30, sawSummary: false, status: 'in_progress' };
    await app._flushHomework(null);
    check('time that failed to save is kept for the next try', app._activeHomework.pending, 30);
  }

  console.log('\n== the wiring ==\n');
  ok('the launch URL carries the student, for per-student game storage', /&userId=\$\{encodeURIComponent\(this\._progressStudentId\(\)/.test(html));
  ok('the launch starts the clock', /this\._startHomeworkTracking\(hw\);/.test(html));
  ok('the listener handles GAME_SESSION_SUMMARY', /case 'GAME_SESSION_SUMMARY':/.test(html));
  ok('assignments created together share a batch id', /batch_id: batchId,/.test(html));
  ok('no progress handler reads the login id any more',
     !/userInfo\?\.user\?\.id/.test(html.slice(html.indexOf('setupGameMessageListener() {'), html.indexOf('// ==================== SKILL TREE VALIDATION'))));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
