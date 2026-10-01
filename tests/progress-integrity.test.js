// Recorded learning progress has to be evidence, and it has to be the right
// student's.
//
// These are the seams an audit found writing progress nobody earned:
//
// SHARED DEVICES. Math Dojo kept its skill map under keys that were the same
// for every student on a browser. The next student loaded the last one's
// skills, and the student site then saved that whole map under the NEW
// account. Local blobs are now keyed by and tagged with the student the host
// names (?userId=), and the host refuses a map whose owner is anyone else.
//
// BELT-TEST BACKFILL. The host saved every backfilled skill as mastered/100,
// whatever state it was sent with. Now: mastered -> mastered; anything else is
// only INSERTED when the student has no row (never overwrites, never lowers).
//
// SKILL-TREE CLICKS. "Activate" on a node was saved as mastered/100. A click is
// intent: an in_progress row when none exists, nothing otherwise.
//
// RECALL TRIALS. A clear wrote mastered >= 90 for any skill, existing or not,
// and a failure wrote 'activated' (shown as Mastered) even for a skill that
// was only in progress. Recall now only touches rows that already exist, a
// clear never creates mastery, and a failure never promotes.
//
// HOMEWORK SUMMARIES. Every assignable game reports one GAME_SESSION_SUMMARY
// per session, in one shape, with the homework id from its URL.
//
// The real methods are lifted out of the HTML and run against hand-built
// stubs; every student here is invented.
//
// Run: node tests/progress-integrity.test.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Lift a method (class method at any indent) or a top-level function out of a
// page. `kind: 'function'` matches `function name(`; otherwise a method
// definition at the start of a line.
function extract(html, name, { kind = 'method' } = {}) {
  const re = kind === 'function'
    ? new RegExp('\\n(?:async\\s+)?function\\s+' + name + '\\s*\\(')
    : new RegExp('\\n[ \\t]+(?:async\\s+)?' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('not found: ' + name);
  const isAsync = /async\s/.test(m[0]);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const args = html.slice(m.index + m[0].length, i - 1);
  i = html.indexOf('{', i);
  let depth = 0; const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return { args, body: html.slice(start + 1, i - 1), isAsync };
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const asMethod = (html, name) => {
  const { args, body, isAsync } = extract(html, name);
  return new (isAsync ? AsyncFunction : Function)(args, body);
};

// ---------------------------------------------------------------- stubs
// A Supabase stand-in that records writes and answers reads from `tables`.
// Rows come back as copies: a real client cannot reach into page state.
function makeSupabase(tables = {}, { failSelect = false } = {}) {
  const log = { upserts: [], inserts: [], rpcs: [] };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const from = (table) => {
    const filters = [];
    const q = {
      select() { return q; },
      eq(col, v) { filters.push(r => r[col] === v); return q; },
      in(col, vs) { filters.push(r => vs.includes(r[col])); return q; },
      gte(col, v) { filters.push(r => String(r[col]) >= String(v)); return q; },
      order() { return q; }, limit() { return q; },
      maybeSingle() { return q; }, single() { return q; },
      then(res, rej) {
        if (failSelect) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
        const rows = (tables[table] || []).filter(r => filters.every(f => f(r)));
        return Promise.resolve({ data: copy(rows), error: null }).then(res, rej);
      },
      upsert(rows, opts) {
        log.upserts.push({ table, rows: copy(Array.isArray(rows) ? rows : [rows]), opts: copy(opts || {}) });
        return Promise.resolve({ error: null });
      },
      insert(rows) {
        log.inserts.push({ table, rows: copy(Array.isArray(rows) ? rows : [rows]) });
        return Promise.resolve({ error: null });
      }
    };
    return q;
  };
  return { log, from, rpc: (fn, args) => { log.rpcs.push({ fn, args }); return Promise.resolve({ data: 0, error: null }); } };
}

// The student site's SkillTreeIntegration, as far as these handlers need it.
const indexHtml = read('index.html');
function makeIntegration({ profile, tables, failSelect } = {}) {
  const supabase = makeSupabase(tables, { failSelect });
  const self = {
    skillProgress: {},
    portal: {
      auth: {
        supabase,
        isAuthenticated: () => !!profile,
        getUserInfo: () => ({ profile, user: profile ? { id: 'auth-' + profile.id } : null })
      },
      loadRTCBalance() {}
    },
    updateSkillsCounter() {}
  };
  for (const name of ['isStaffSession', 'planBackfillRows', 'handleBackfillSkills',
    'filterDojoMapChanges', 'handleDojoSkillUpdate', 'bulkSaveSkillsToSupabase',
    'handleSkillUnlocked', 'getProgressSubject', 'dedupeGauntletLists',
    'planRecallRows', 'handleGauntletComplete']) {
    self[name] = asMethod(indexHtml, name).bind(self);
  }
  return { self, log: supabase.log };
}
global.document = { getElementById: () => null, querySelectorAll: () => [] };
global.window = { PortalUI: { showNotification() {} }, location: { origin: 'http://x' } };
global.SkillTreeIntegration = { LEGACY_SUBJECT_MAP: { Creative: 'Art', Language: 'Reading', Technology: 'Programming' } };
console.log = ((orig) => (...a) => { if (typeof a[0] === 'string' && /^(pass|  FAIL|\n\d)/.test(a[0])) orig(...a); })(console.log);
console.warn = () => {}; console.error = () => {};

const STUDENT = { id: 'prof-ines', user_type: 'student' };
const TEACHER = { id: 'prof-mr-oduya', user_type: 'teacher' };

(async () => {
  // ============================================================ backfill
  {
    const { self, log } = makeIntegration({ profile: STUDENT });
    await self.handleBackfillSkills({ subject: 'Math', skills: [
      { skillName: 'Counting to 20', state: 'mastered', mastery_score: 100 },
      { skillName: 'Place Value', state: 'activated', mastery_score: 85 },
      { skillName: 'Number Bonds', state: 'in_progress', mastery_score: 40 },
      { skillName: 'Skip Counting', state: 'available', mastery_score: 0 },
      { skillName: 'Fractions', state: 'locked', mastery_score: 0 },
      { skillName: 'Counting to 20', state: 'available', mastery_score: 0 }
    ] });
    const mastered = log.upserts.find(u => !u.opts.ignoreDuplicates);
    const insertOnly = log.upserts.find(u => u.opts.ignoreDuplicates);
    check('belt test: only the skill sent as mastered is upserted as mastered',
      mastered.rows.map(r => [r.skill_name, r.state, r.source]), [['Counting to 20', 'mastered', 'belt_test']]);
    check('belt test: everything else is insert-only (ON CONFLICT DO NOTHING) with its own state',
      insertOnly.rows.map(r => [r.skill_name, r.state, r.mastery_score]),
      [['Place Value', 'activated', 85], ['Number Bonds', 'in_progress', 40], ['Skip Counting', 'available', 0]]);
    ok('belt test: a locked skill is not written at all',
      !log.upserts.some(u => u.rows.some(r => r.skill_name === 'Fractions')));
    ok('belt test: no non-mastered row claims mastery_score 100 or mastered_at',
      insertOnly.rows.every(r => r.mastery_score < 100 && !('mastered_at' in r)));
    check('belt test: the user id is the profile id, never the message',
      [...new Set(log.upserts.flatMap(u => u.rows.map(r => r.user_id)))], ['prof-ines']);
  }
  {
    // An existing higher score is never lowered by a mastered re-send.
    const { self, log } = makeIntegration({ profile: STUDENT });
    self.skillProgress.Math = { 'Counting to 20': { state: 'mastered', mastery_score: 100 } };
    await self.handleBackfillSkills({ subject: 'Math', skills: [{ skillName: 'Counting to 20', state: 'mastered', mastery_score: 90 }] });
    check('belt test: re-mastering never lowers an existing score', log.upserts[0].rows[0].mastery_score, 100);
  }
  {
    const { self, log } = makeIntegration({ profile: STUDENT });
    await self.handleBackfillSkills({ subject: 'Math', reason: 'override',
      skills: [{ skillName: 'Place Value', state: 'mastered', mastery_score: 100 }] });
    check('override backfill from a student is refused', log.upserts.length, 0);
    const t = makeIntegration({ profile: TEACHER });
    await t.self.handleBackfillSkills({ subject: 'Math', reason: 'override',
      skills: [{ skillName: 'Place Value', state: 'mastered', mastery_score: 100 }] });
    check('override backfill from staff is saved and labelled teacher', t.log.upserts[0].rows[0].source, 'teacher');
  }

  // ============================================================ skill tree click
  {
    const { self, log } = makeIntegration({ profile: STUDENT });
    await self.handleSkillUnlocked({ subject: 'Science', skillName: 'States of Matter', state: 'activated' });
    const r = log.upserts[0];
    check('tree click (old "activated") records intent: in_progress, score 0, skill_tree',
      [r.rows[0].state, r.rows[0].mastery_score, r.rows[0].source, !!r.opts.ignoreDuplicates],
      ['in_progress', 0, 'skill_tree', true]);
    await self.handleSkillUnlocked({ subject: 'Science', skillName: 'Forces', state: 'mastered' });
    check('tree click claiming "mastered" still writes no mastery', log.upserts[1].rows[0].state, 'in_progress');
    self.skillProgress.Science.Forces = { state: 'mastered', mastery_score: 95 };
    await self.handleSkillUnlocked({ subject: 'Science', skillName: 'Forces', state: 'in_progress' });
    check('tree click on a skill the student already has writes nothing', log.upserts.length, 2);
    check('...and leaves the cached mastery alone', self.skillProgress.Science.Forces.state, 'mastered');
  }

  // ============================================================ dojo bulk map
  {
    const { self, log } = makeIntegration({ profile: STUDENT });
    self.skillProgress.Math = { 'Number Bonds': { state: 'in_progress', mastery_score: 40 } };
    self.handleDojoSkillUpdate({ owner: 'prof-somebody-else', skills: { 'Place Value': { state: 'mastered', mastery_score: 100 } } });
    self.handleDojoSkillUpdate({ owner: null, skills: { 'Place Value': { state: 'mastered', mastery_score: 100 } } });
    await new Promise(r => setTimeout(r, 0));
    check("Dojo map owned by another student / guest is never saved", log.upserts.length, 0);
    self.handleDojoSkillUpdate({ owner: 'prof-ines', skills: {
      'Place Value': { state: 'mastered', mastery_score: 100 },      // mastery claim from cache
      'Number Bonds': { state: 'in_progress', mastery_score: 40 },   // unchanged
      'Skip Counting': { state: 'in_progress', mastery_score: 20 }   // genuinely new
    } });
    await new Promise(r => setTimeout(r, 0));
    check("own Dojo map: only the real non-mastery change is written, labelled dojo",
      log.upserts.map(u => u.rows.map(r => [r.skill_name, r.state, r.source])), [[['Skip Counting', 'in_progress', 'dojo']]]);
  }

  // ============================================================ recall
  {
    const rows = [
      { user_id: 'prof-ines', subject: 'Reading', skill_name: 'Main Idea', state: 'mastered', mastery_score: 80, practice_count: 4 },
      { user_id: 'prof-ines', subject: 'Reading', skill_name: 'Synonyms', state: 'in_progress', mastery_score: 30, practice_count: 1 },
      { user_id: 'prof-ines', subject: 'Reading', skill_name: 'Prefixes', state: 'mastered', mastery_score: 92, practice_count: 6 },
      // a different student's row for a skill Ines does not have
      { user_id: 'prof-other', subject: 'Reading', skill_name: 'Similes', state: 'mastered', mastery_score: 100 }
    ];
    const { self, log } = makeIntegration({ profile: STUDENT, tables: { skill_progress: rows, math_dojo_sessions: [] } });
    await self.handleGauntletComplete({ subject: 'Reading',
      cleared: [{ skill: 'Main Idea', category: 'recent' }, { skill: 'Synonyms' }, { skill: 'Similes' }, { skill: 'Main Idea' }],
      failed: [{ skill: 'Prefixes' }, { skill: 'Main Idea' }, { skill: 'Prefixes' }],
      correctCount: 9, questionsAsked: 12 });
    const written = log.upserts.filter(u => u.table === 'skill_progress').flatMap(u => u.rows);
    check('recall writes one row per existing skill (deduped, cleared wins)',
      written.map(r => r.skill_name).sort(), ['Main Idea', 'Prefixes', 'Synonyms']);
    ok('recall never creates a row for a skill the student does not have (Similes)',
      !written.some(r => r.skill_name === 'Similes'));
    const by = Object.fromEntries(written.map(r => [r.skill_name, r]));
    check('cleared + mastered: stays mastered, score raised to 90', [by['Main Idea'].state, by['Main Idea'].mastery_score], ['mastered', 90]);
    check('cleared + in_progress: practice only, no mastery created', [by['Synonyms'].state, by['Synonyms'].mastery_score], ['in_progress', 30]);
    check('failed + mastered: demoted to activated, capped at 70', [by['Prefixes'].state, by['Prefixes'].mastery_score], ['activated', 70]);
    ok('every recall row is labelled recall', written.every(r => r.source === 'recall'));
    check('RTC only for clears of skills the student has', log.rpcs.map(r => r.args.p_skill_count), [2]);
    const sess = log.inserts.find(i => i.table === 'math_dojo_sessions').rows[0];
    check('session log lists each skill once', sess.skill_details.map(d => [d.skill, d.cleared]),
      [['Main Idea', true], ['Synonyms', true], ['Similes', true], ['Prefixes', false]]);
  }
  {
    const { self, log } = makeIntegration({ profile: STUDENT, tables: {
      skill_progress: [{ user_id: 'prof-ines', subject: 'Reading', skill_name: 'Synonyms', state: 'in_progress', mastery_score: 30 }] } });
    await self.handleGauntletComplete({ subject: 'Reading', cleared: [], failed: [{ skill: 'Synonyms' }] });
    const r = log.upserts[0].rows[0];
    check('failed + in_progress is never promoted (used to become activated)', [r.state, r.mastery_score], ['in_progress', 30]);
  }
  {
    const { self, log } = makeIntegration({ profile: STUDENT, failSelect: true });
    await self.handleGauntletComplete({ subject: 'Math', cleared: [{ skill: 'Place Value' }], failed: [] });
    check('existing rows unreadable: recall writes nothing and pays nothing',
      [log.upserts.length, log.rpcs.length], [0, 0]);
  }
  {
    // Cooldown: a skill cleared in a recall run within 24h does not pay again.
    const recent = new Date(Date.now() - 3600e3).toISOString();
    const { self, log } = makeIntegration({ profile: STUDENT, tables: {
      skill_progress: [
        { user_id: 'prof-ines', subject: 'Math', skill_name: 'Place Value', state: 'mastered', mastery_score: 90 },
        { user_id: 'prof-ines', subject: 'Math', skill_name: 'Number Bonds', state: 'mastered', mastery_score: 90 }],
      math_dojo_sessions: [{ user_id: 'prof-ines', subject: 'Math', mode: 'retention', created_at: recent,
        skill_details: [{ skill: 'Place Value', cleared: true }] }] } });
    await self.handleGauntletComplete({ subject: 'Math', cleared: [{ skill: 'Place Value' }, { skill: 'Number Bonds' }], failed: [] });
    check('cooldown reads the recall session log: only the fresh clear pays', log.rpcs.map(r => r.args.p_skill_count), [1]);
  }

  // ============================================================ Dojo storage owner
  {
    const dojo = read('games/math-dojo.html');
    const fns = ['getUserId', 'dojoStorageOwner', 'dojoOwnedKey', 'readOwnedBlob', 'writeOwnedBlob',
      'loadSkillTreeData', 'saveSkillTreeData'];
    const src = fns.map(n => { const f = extract(dojo, n, { kind: 'function' }); return `function ${n}(${f.args}){${f.body}}`; }).join('\n');
    // One browser profile, many page loads: the store outlives each Dojo.
    const store = new Map();
    const localStorage = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    };
    const loadDojo = (search, embedded = true) => {
      const posted = [];
      const win = { location: { search }, dojoUserId: undefined };
      win.parent = embedded ? { postMessage: (m) => posted.push(m) } : win;
      const skillTreeData = { skills: {}, lastSync: null };
      const api = new Function('window', 'localStorage', 'skillTreeData', 'URLSearchParams', 'console',
        src + '\nreturn { getUserId, dojoStorageOwner, loadSkillTreeData, saveSkillTreeData, skillTreeData };')(
        win, localStorage, skillTreeData, URLSearchParams, { log() {}, warn() {} });
      api.posted = posted;
      return api;
    };

    // The old build's leftovers on this device: someone else's mastery.
    store.set('math_skill_states', JSON.stringify({ skills: { 'Long Division': { state: 'mastered', mastery_score: 100 } } }));
    store.set('math_skill_progress_guest', JSON.stringify({ skills: { 'Ratios': { state: 'mastered' } }, lastSync: 9e15 }));

    const ines = loadDojo('?userId=prof-ines');
    ines.loadSkillTreeData();
    check('student A loads nothing from the legacy shared keys', Object.keys(ines.skillTreeData.skills), []);
    ines.skillTreeData.skills['Place Value'] = { state: 'mastered', mastery_score: 100 };
    ines.saveSkillTreeData();
    ok('student A saves under her own key, tagged with her id',
      JSON.parse(store.get('math_skill_states_prof-ines')).owner === 'prof-ines');
    check('student A\'s map goes to the host with owner = her id', ines.posted[0].owner, 'prof-ines');

    const tobi = loadDojo('?userId=prof-tobi');
    tobi.loadSkillTreeData();
    check('student B on the same browser does not see student A\'s progress', Object.keys(tobi.skillTreeData.skills), []);

    // A blob under B's key that claims to be A's (copied, or written by an old build) is ignored.
    store.set('math_skill_states_prof-tobi', JSON.stringify({ owner: 'prof-ines', skills: { 'Place Value': { state: 'mastered' } } }));
    const tobi2 = loadDojo('?userId=prof-tobi');
    tobi2.loadSkillTreeData();
    check('a blob whose owner does not match is never merged', Object.keys(tobi2.skillTreeData.skills), []);

    const again = loadDojo('?userId=prof-ines');
    again.loadSkillTreeData();
    check('student A gets her own progress back', Object.keys(again.skillTreeData.skills), ['Place Value']);

    const anon = loadDojo('');
    anon.loadSkillTreeData(); anon.saveSkillTreeData();
    check('embedded with no id: nothing read, nothing written locally', [anon.dojoStorageOwner(), Object.keys(anon.skillTreeData.skills).length, store.has('math_skill_states_null')], [null, 0, false]);
    check('embedded with no id: the host is told the map has no owner', anon.posted[0].owner, null);

    const solo = loadDojo('', false);
    check('standalone (no host) uses the guest owner', solo.dojoStorageOwner(), 'guest');
    store.set('current_user_id', 'prof-ines');
    check("the device-wide 'current_user_id' key no longer names the student", loadDojo('').getUserId(), null);
  }

  // ============================================================ summaries
  {
    const helper = require(path.join(ROOT, 'shared', 'game-session.js'));
    const GAMES = {
      'mathspire': 'games/mathspire.html', 'mathletics': 'games/mathletics.html',
      'math-dojo': 'games/math-dojo.html', 'english-lyceum': 'games/english-lyceum.html',
      'science-lab': 'games/science-lab.html', 'social-studies': 'games/social-studies.html',
      'art-studio': 'games/art-studio.html', 'life-skills': 'games/life-skills.html',
      'bible-study': 'games/bible-study.html', 'practice-pilot': 'games/practice-pilot.html',
      'clockwork-defense': 'games/clockwork-defense.html', 'dimension-shift': 'games/dimension-shift.html',
      'wasteland-adventure': 'games/wasteland_adventure.html'
    };
    for (const [id, file] of Object.entries(GAMES)) {
      const html = read(file);
      ok(`${id}: loads shared/game-session.js`, /<script src="\.\.\/shared\/game-session\.js"><\/script>/.test(html));
      // The gameId the page reports must be exactly the assignable id. Some
      // pages pass a constant (GAME = '<id>'); resolve it.
      const m = html.match(/GameSessionReporter\.create\(\s*(['"][^'"]+['"]|[A-Z_]+)/);
      let used = m && m[1];
      if (used && !/^['"]/.test(used)) {
        const c = html.match(new RegExp('const\\s+' + used + '\\s*=\\s*([\'"][^\'"]+[\'"])'));
        used = c && c[1];
      }
      check(`${id}: reports gameId '${id}'`, used && used.slice(1, -1), id);
      ok(`${id}: calls begin() and report()`, /\.begin\(\)/.test(html) && /\.report\(/.test(html));
    }

    // The message itself, through a fake window.
    const posted = [];
    let t = 1000;
    const listeners = {};
    const fakeWin = {
      location: { search: '?homework=hw-42&subject=Math', origin: 'http://localhost:8781' },
      document: { visibilityState: 'visible', addEventListener: (ev, fn) => { listeners[ev] = fn; } },
      parent: { postMessage: (m, origin) => posted.push({ m, origin }) }
    };
    const rep = helper.create('mathletics', { window: fakeWin, now: () => t, noTimer: true });
    rep.begin();
    // The page's 1s timer, driven by hand (activeSeconds() ticks the clock).
    for (let i = 0; i < 30; i++) { t += 1000; listeners.keydown(); rep.activeSeconds(); }
    const msg = rep.report({ score: 87.4, correct: 7, total: 8 });
    check('summary shape', Object.keys(msg), ['type', 'gameId', 'subject', 'homeworkId', 'score', 'correct', 'total', 'durationSeconds', 'endedAt']);
    check('summary values', [msg.type, msg.gameId, msg.subject, msg.homeworkId, msg.score, msg.correct, msg.total, msg.durationSeconds],
      ['GAME_SESSION_SUMMARY', 'mathletics', 'Math', 'hw-42', 87, 7, 8, 30]);
    ok('endedAt is an ISO timestamp', !isNaN(Date.parse(msg.endedAt)) && msg.endedAt.endsWith('Z'));
    check('posted once, to our own origin only', posted.map(p => p.origin), ['http://localhost:8781']);
    check('a second report for the same session is not sent', [rep.report({ score: 1 }), posted.length], [null, 1]);
    rep.begin(); t += 200000;   // idle for 200s: no input
    check('idle time is not active play', rep.report({ score: null }).durationSeconds, 0);
    check('no score -> null, not 0', helper.normaliseScore(undefined), null);
    check('score clamps to 0-100', [helper.normaliseScore(140), helper.normaliseScore(-3)], [100, 0]);
    const noHw = helper.buildSummary('practice-pilot', {}, new URLSearchParams(''), { score: 50, correct: 1, total: 2 }, 5);
    check('no ?homework= -> homeworkId null', noHw.homeworkId, null);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error = require('console').error; process.stdout.write('CRASH ' + e.stack + '\n'); process.exitCode = 1; });
