// The Belt Test's rules, on a small invented skill graph.
//
// The diagnostic in games/math-dojo.html decides what a student knows from
// their answers. These are the rules Jordan set for it (2026-10-14), each
// pinned here so a later tuning pass cannot quietly undo one:
//
//   * NEVER SEEN CUTS OFF. "Never seen this" rules out everything built on
//     the skill; none of it is asked or credited.
//   * A HARDER SKILL PROVES WHAT IS BENEATH IT, close by. A right typed answer
//     proves the skill one and two steps down. Five steps down it does not:
//     that could be a gap, so it stays to be checked.
//   * A MISS IS NOT OVERRULED. A skill the student missed is not credited
//     because a harder one went right; it is asked again.
//   * ONE LUCKY GUESS DOES NOT PROVE A HOLE AWAY. A skill with something
//     built on it missed is not credited by proof from another.
//   * ONE MISS IS ASKED AGAIN before anything above it is ruled out.
//   * MULTIPLE CHOICE IS WEAKER THAN TYPED. One right multiple-choice answer
//     is "likely", not mastered.
//   * NOTHING IS KNOWN FROM THE STARTING TIER ALONE.
//   * THE BELT IS CUMULATIVE: a weak lower tier holds the belt down.
//
// The engine is extracted from the page and run against stubs; the graph and
// every name in it are invented.
//
// Run: node tests/belt-test-diagnostic.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const start = html.indexOf('const DIAG = {');
const end = html.indexOf('function renderDiagnosticReport()');
if (start < 0 || end < 0) throw new Error('diagnostic engine not found in math-dojo.html');
const engineSrc = html.slice(start, end);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

// A chain A1 -> A2 -> A3 -> A4 -> A5 -> A6 (each builds on the one before),
// side branches B3 on A2 and D5 on A4, and a separate strand C1..C2. Tiers rise along the
// chain. Every skill has a generator so it can be asked.
function makeGraph() {
  const spec = {
    A1: { dt: 1, hp: [] }, A2: { dt: 2, hp: ['A1'] }, A3: { dt: 3, hp: ['A2'] },
    A4: { dt: 4, hp: ['A3'] }, A5: { dt: 5, hp: ['A4'] }, A6: { dt: 6, hp: ['A5'] },
    B3: { dt: 3, hp: ['A2'] }, C1: { dt: 1, hp: [] }, C2: { dt: 2, hp: ['C1'] },
    D5: { dt: 5, hp: ['A4'] },
  };
  const nodes = {}, titleToId = {};
  for (const [id, n] of Object.entries(spec)) {
    nodes[id] = { t: 'Skill ' + id, dt: n.dt, st: 'Foundations', hp: n.hp, dep: [] };
    titleToId['Skill ' + id] = id;
  }
  for (const [id, n] of Object.entries(nodes)) for (const h of n.hp) nodes[h].dep.push(id);
  return { nodes, titleToId };
}

// evidence: { A3: { p: 0.9, source: 'dojo', daysAgo: 7 } } - a saved record as
// the sites save it. `at` (an ISO time) overrides daysAgo.
function freshEngine({ stored = {}, evidence = {} } = {}) {
  const MATH_GRAPH_V2 = makeGraph();
  const generators = {}, Q_MATRIX = {};
  for (const [id, n] of Object.entries(MATH_GRAPH_V2.nodes)) {
    generators[n.dt] = generators[n.dt] || {};
    generators[n.dt]['Dom ' + id] = () => ({});
    Q_MATRIX[`T${n.dt}::Dom ${id}`] = { primary_skill: n.t, secondary_skills: [] };
  }
  const BKT_PARAMS = { SLIP: 0.10, GUESS: 0.20 };
  const bktUpdate = (p, correct) => correct
    ? p * 0.9 / (p * 0.9 + (1 - p) * 0.2)
    : p * 0.1 / (p * 0.1 + (1 - p) * 0.8);
  const skillTreeData = { skills: {} };
  for (const [id, p] of Object.entries(stored)) skillTreeData.skills['Skill ' + id] = { p_mastered: p };
  for (const [id, ev] of Object.entries(evidence)) {
    skillTreeData.skills['Skill ' + id] = { p_mastered: ev.p, source: ev.source,
      last_evidence_at: ev.at || new Date(Date.now() - (ev.daysAgo ?? 1) * 864e5).toISOString() };
  }
  const _rawStoredP = t => (skillTreeData.skills[t] && skillTreeData.skills[t].p_mastered) || 0;
  const state = {};
  const sessionData = {};
  const writes = {};
  const setMasteryProbability = (t, p, at, source) => { writes[t] = p; (writes._source = writes._source || {})[t] = source; };
  // Typed from tier 5 up, as the page decides.
  const shouldTypeAnswer = (q, tier) => tier >= 5;
  const api = new Function('MATH_GRAPH_V2', 'generators', 'Q_MATRIX', 'BKT_PARAMS', 'bktUpdate', '_rawStoredP',
    'state', 'sessionData', 'setMasteryProbability', 'shouldTypeAnswer', 'skillTreeData',
    engineSrc + '\nreturn { initDiagnostic, diagProcessAnswer, pickDiagnosticCandidate, shouldStopDiagnostic, diagClassify, diagDerivedBelt, diagHoleReport, diagCommitBeliefs, diagStillToCheck, diagStoredEvidence, DIAG };')
    (MATH_GRAPH_V2, generators, Q_MATRIX, BKT_PARAMS, bktUpdate, _rawStoredP, state, sessionData, setMasteryProbability, shouldTypeAnswer, skillTreeData);
  const N = MATH_GRAPH_V2.nodes;
  const answer = (id, outcome, time = 8, options) => api.diagProcessAnswer(
    { skillTags: { primary_skill: N[id].t }, tier: N[id].dt, timeExpected: 20, options }, outcome, time);
  return { api, state, N, answer, writes, sessionData };
}

console.log('\nBelt Test diagnostic rules');

{
  const e = freshEngine();
  e.api.initDiagnostic(3);
  const st = e.state.diag.status;
  check('nothing is known from the starting tier alone',
    !Object.values(st).includes('known') && !Object.values(st).includes('likely'),
    JSON.stringify(st));
}

{
  const e = freshEngine();
  e.api.initDiagnostic(3);
  e.answer('A3', 'never');
  const st = e.state.diag.status;
  check('never seen: everything built on it is ruled out',
    ['A4', 'A5', 'A6'].every(id => st[id] === 'blocked'), JSON.stringify(st));
  check('never seen: the skill itself is a gap', st.A3 === 'gap');
  check('never seen: what it builds on is not ruled out', st.A2 !== 'blocked' && st.A1 !== 'blocked');
  let askedAbove = false;
  for (let i = 0; i < 20 && !e.api.shouldStopDiagnostic(); i++) {
    const c = e.api.pickDiagnosticCandidate();
    if (!c) break;
    if (['A4', 'A5', 'A6'].includes(c.nodeId)) askedAbove = true;
    e.answer(c.nodeId, 'correct');
  }
  check('never seen: nothing built on it is asked afterwards', !askedAbove);
}

{
  // At the student's level. A right answer above their level is a surprise
  // and is trusted a little less, so its proof reaches one step, not two.
  const e = freshEngine();
  e.api.initDiagnostic(6);
  e.answer('A6', 'correct');            // typed, tier 6
  const d = e.state.diag;
  check('a right typed answer proves one step down', d.status.A5 === 'known' && d.how.A5 === 'proven', JSON.stringify({ s: d.status.A5, p: d.eff.A5 }));
  check('and two steps down', d.status.A4 === 'known', JSON.stringify({ s: d.status.A4, p: d.eff.A4 }));
  check('but not five steps down: that could be a gap', d.status.A1 !== 'known', JSON.stringify({ s: d.status.A1, p: d.eff.A1 }));
  check('proof names the skill that proved it', d.provenBy.A5 === 'A6');
}

{
  const e = freshEngine();
  e.api.initDiagnostic(5);
  e.answer('A5', 'wrong');
  e.answer('A6', 'correct');
  const d = e.state.diag;
  check('a miss is not overruled by a harder skill going right', d.status.A5 !== 'known', JSON.stringify({ s: d.status.A5, p: d.eff.A5 }));
  const next = e.api.pickDiagnosticCandidate();
  check('the missed skill is asked again', next && next.nodeId === 'A5', next && next.nodeId);
}

{
  const e = freshEngine();
  e.api.initDiagnostic(5);
  e.answer('A4', 'wrong'); e.answer('A4', 'wrong');   // confirmed hole at A4
  const d = e.state.diag;
  e.answer('B3', 'correct');
  // A6 sits on A4's hole; force a lucky typed right answer on it anyway.
  e.answer('A6', 'correct');
  check('a lucky answer above a confirmed hole does not credit the hole', d.status.A4 !== 'known');
  check('nor what lies between it and the lucky answer', d.status.A5 !== 'known', JSON.stringify({ s: d.status.A5, p: d.eff.A5 }));
}

{
  // Two harder skills built on A4: one missed, one right. The right one
  // could be the lucky guess, so A4 is not credited; it is asked.
  const e = freshEngine();
  e.api.initDiagnostic(5);
  e.answer('A5', 'wrong'); e.answer('A5', 'wrong');
  e.answer('D5', 'correct');
  const d = e.state.diag;
  check('a skill with something built on it missed is not credited by proof', d.status.A4 !== 'known', JSON.stringify({ s: d.status.A4, p: d.eff.A4 }));
  check('it is flagged as a possible gap to check', d.risk.A4 === true);
}

{
  const e = freshEngine();
  e.api.initDiagnostic(4);
  e.answer('A4', 'wrong');
  const d = e.state.diag;
  check('one miss does not rule out what is built on it', d.status.A5 !== 'blocked' && d.status.A6 !== 'blocked', JSON.stringify(d.status));
  const next = e.api.pickDiagnosticCandidate();
  check('one miss is asked again', next && next.nodeId === 'A4', next && next.nodeId);
  e.answer('A4', 'wrong');
  check('a second miss confirms it and rules out what is built on it', d.status.A5 === 'blocked');
  const holes = e.api.diagHoleReport();
  check('a confirmed hole is reported', holes.some(h => h.id === 'A4' && h.kind === 'confirmed'), JSON.stringify(holes));
  const root = e.api.pickDiagnosticCandidate();
  check('then the skill beneath it is asked, to find where it starts', root && root.nodeId === 'A3', root && root.nodeId);
}

{
  const e = freshEngine();
  e.api.initDiagnostic(3);
  e.answer('A3', 'correct');          // multiple choice (tier 3)
  const d = e.state.diag;
  check('one right multiple-choice answer is likely, not mastered', d.status.A3 === 'likely', JSON.stringify({ s: d.status.A3, p: d.own.A3 }));
  check('and proves nothing beneath it on its own', d.status.A2 !== 'known');
  const e2 = freshEngine();
  e2.api.initDiagnostic(5);
  e2.answer('A5', 'correct');         // typed (tier 5)
  check('one right typed answer is mastered', e2.state.diag.status.A5 === 'known');
}

{
  const e = freshEngine({ stored: { A1: 0.99, A2: 0.99, C1: 0.99 } });
  e.api.initDiagnostic(4);
  const st = e.state.diag.status;
  check('an earlier session does not make a skill known without asking', st.A1 !== 'known' && st.A2 !== 'known');
}

{
  const e = freshEngine();
  e.api.initDiagnostic(5);
  // Strong at the top of the chain, a confirmed hole low in the other strand.
  e.answer('A6', 'correct'); e.answer('A5', 'correct'); e.answer('A4', 'correct');
  e.answer('A3', 'correct'); e.answer('A2', 'correct'); e.answer('A1', 'correct');
  e.answer('B3', 'correct');
  e.answer('C1', 'never'); e.answer('C2', 'never');
  const belt = e.api.diagDerivedBelt();
  check('the belt is held down by a weak lower tier', belt === 0 || belt === 1 || belt < 2, 'belt ' + belt);
}

{
  const e = freshEngine();
  e.api.initDiagnostic(5);
  e.answer('A6', 'correct');
  e.answer('C1', 'wrong'); e.answer('C1', 'wrong');
  e.api.diagCommitBeliefs();
  check('only skills with evidence are written back', !('Skill C2' in e.writes) && ('Skill A6' in e.writes) && ('Skill A5' in e.writes),
    Object.keys(e.writes).join(', '));
  check('a skill ruled out from below keeps whatever it had', !('Skill C2' in e.writes));
}

{
  // A Yes/No question is a coin toss: right once is not even "likely".
  const e = freshEngine();
  e.api.initDiagnostic(3);
  e.answer('A3', 'correct', 8, ['Yes', 'No']);
  e.answer('B3', 'correct', 8, ['a', 'b', 'c', 'd']);
  const d = e.state.diag;
  check('a right Yes/No answer counts for less than a right four-way choice', d.own.A3 < d.own.B3 && d.status.A3 !== 'likely' && d.status.B3 === 'likely',
    JSON.stringify({ yesNo: d.own.A3, four: d.own.B3, s: [d.status.A3, d.status.B3] }));
}

// ---- Saved evidence: practice counts, and the Hole Check carries on --------

console.log('\nSaved evidence and the Hole Check');

{
  const e = freshEngine({ evidence: { A3: { p: 0.92, source: 'dojo', daysAgo: 10 } } });
  e.api.initDiagnostic(4);
  const d = e.state.diag;
  check('a skill mastered in practice counts as known in the Belt Test', d.status.A3 === 'known' && d.how.A3 === 'practice', JSON.stringify({ s: d.status.A3, how: d.how.A3 }));
  let askedA3 = false;
  for (let i = 0; i < 30 && !e.api.shouldStopDiagnostic(); i++) {
    const c = e.api.pickDiagnosticCandidate(); if (!c) break;
    if (c.nodeId === 'A3') askedA3 = true;
    e.answer(c.nodeId, 'correct');
  }
  check('and is not asked again', !askedA3);
  const e2 = freshEngine({ evidence: { A6: { p: 0.95, source: 'dojo', daysAgo: 3 } } });
  e2.api.initDiagnostic(4);
  check('a saved answer does not go on to prove the skills beneath it', e2.state.diag.status.A5 !== 'known', e2.state.diag.status.A5);
}

{
  const e = freshEngine({ evidence: {
    A1: { p: 0.95, source: 'manual', daysAgo: 3 },                       // old Belt Tests saved as manual
    A2: { p: 0.95, source: 'belt_test', at: '2026-10-10T12:00:00Z' },    // before this engine
    B3: { p: 0.95, source: 'dojo', daysAgo: 400 },                       // too old
    C1: { p: 0.95, source: 'belt_test', daysAgo: 0 },                    // a Belt Test, not practice
  } });
  e.api.initDiagnostic(3);
  const st = e.state.diag.status;
  check('mastery saved as "manual" is not trusted', st.A1 !== 'known');
  check('a Belt Test from before this engine is not trusted', st.A2 !== 'known' && e.api.diagStoredEvidence('Skill A2') === null);
  check('practice older than the limit is not trusted', st.B3 !== 'known');
  check('a Belt Test does not seed the next Belt Test (it re-measures)', st.C1 !== 'known');
  const ev = e.api.diagStoredEvidence('Skill C1');
  check('but the Hole Check carries on from it', ev && ev.kind === 'test');
}

{
  // A saved Belt Test: A1..A3 and B3 shown, A4 a confirmed hole, C1 missed once.
  const e = freshEngine({ evidence: {
    A1: { p: 0.97, source: 'belt_test', daysAgo: 0 }, A2: { p: 0.97, source: 'belt_test', daysAgo: 0 },
    A3: { p: 0.97, source: 'belt_test', daysAgo: 0 }, A4: { p: 0.04, source: 'belt_test', daysAgo: 0 },
    C1: { p: 0.30, source: 'belt_test', daysAgo: 0 }, B3: { p: 0.97, source: 'belt_test', daysAgo: 0 },
  } });
  e.api.initDiagnostic(1, { holeCheck: true });
  const d = e.state.diag;
  check('the Hole Check starts from the saved level', d.ceiling === 3, 'ceiling ' + d.ceiling);
  check('saved known skills stay known', d.status.A3 === 'known' && d.how.A3 === 'earlier');
  check('a saved confirmed hole still rules out what is built on it', d.status.A5 === 'blocked' && d.status.A6 === 'blocked', JSON.stringify(d.status));
  const asked = [];
  for (let i = 0; i < 40 && !e.api.shouldStopDiagnostic(); i++) {
    const c = e.api.pickDiagnosticCandidate(); if (!c) break;
    asked.push(c.nodeId);
    e.answer(c.nodeId, 'correct');
  }
  check('a skill missed once last time is asked again', asked.includes('C1'), asked.join(','));
  check('saved known skills are not asked again', !asked.includes('A3') && !asked.includes('A1'), asked.join(','));
  check('nothing above the level is asked', !asked.some(id => e.N[id].dt > 3), asked.join(','));
  e.api.diagCommitBeliefs();
  check('only what this sitting asked is written back', !('Skill A1' in e.writes) && ('Skill C1' in e.writes), Object.keys(e.writes).join(','));
  check('and it is labelled as a test', e.writes._source['Skill C1'] === 'belt_test');
}

{
  // Level 3 with A4 (tier 4) unsettled: the Hole Check stays at or below 3.
  const e = freshEngine({ evidence: {
    A1: { p: 0.97, source: 'belt_test', daysAgo: 0 }, A2: { p: 0.97, source: 'belt_test', daysAgo: 0 },
    A3: { p: 0.97, source: 'belt_test', daysAgo: 0 }, B3: { p: 0.97, source: 'belt_test', daysAgo: 0 },
  } });
  e.api.initDiagnostic(1, { holeCheck: true });
  const asked = [];
  for (let i = 0; i < 40 && !e.api.shouldStopDiagnostic(); i++) {
    const c = e.api.pickDiagnosticCandidate(); if (!c) break;
    asked.push(c.nodeId); e.answer(c.nodeId, 'correct');
  }
  check('the Hole Check does not climb above the level', !asked.includes('A4') && !asked.includes('A5'), asked.join(','));
  check('and asks what is left beneath it', asked.includes('C1') || asked.includes('C2'), asked.join(','));
}

{
  const e = freshEngine({ evidence: { A3: { p: 0.97, source: 'belt_test', daysAgo: 0 } } });
  e.api.DIAG.HOLE_CHECK_ITEMS = 3;
  e.api.initDiagnostic(1, { holeCheck: true });
  let n = 0;
  while (!e.api.shouldStopDiagnostic() && n < 50) { const c = e.api.pickDiagnosticCandidate(); if (!c) break; e.answer(c.nodeId, 'wrong'); n++; }
  check('a Hole Check sitting stops at its length', n === 3, 'asked ' + n);
  e.api.DIAG.HOLE_CHECK_ITEMS = 15;
}

{
  const e = freshEngine();
  e.api.initDiagnostic(5);
  e.answer('A5', 'correct');                 // typed, at the level: proves A4 and A3
  e.answer('A3', 'correct');                 // multiple choice
  e.api.diagCommitBeliefs();
  const d = e.state.diag;
  check('a skill that was asked is saved with its own answers, not the proof',
    Math.abs(e.writes['Skill A3'] - d.own.A3) < 1e-9 && d.eff.A3 > d.own.A3, JSON.stringify({ saved: e.writes['Skill A3'], own: d.own.A3, eff: d.eff.A3 }));
  check('a skill only proven is saved as proven', Math.abs(e.writes['Skill A4'] - d.eff.A4) < 1e-9, JSON.stringify({ saved: e.writes['Skill A4'], eff: d.eff.A4, st: d.status.A4, tested: d.tested.A4 }));
}

{
  // Termination: a student who answers everything right finishes, inside the cap.
  const e = freshEngine();
  e.api.initDiagnostic(3);
  let n = 0;
  while (!e.api.shouldStopDiagnostic() && n < 100) {
    const c = e.api.pickDiagnosticCandidate();
    if (!c) break;
    e.answer(c.nodeId, 'correct');
    n++;
  }
  check('the test ends on its own, inside the question cap', n <= e.api.DIAG.HARD_MAX, 'asked ' + n);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
