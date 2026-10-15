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

function freshEngine({ stored = {} } = {}) {
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
  const _rawStoredP = t => (skillTreeData.skills[t] && skillTreeData.skills[t].p_mastered) || 0;
  const state = {};
  const sessionData = {};
  const writes = {};
  const setMasteryProbability = (t, p) => { writes[t] = p; };
  // Typed from tier 5 up, as the page decides.
  const shouldTypeAnswer = (q, tier) => tier >= 5;
  const api = new Function('MATH_GRAPH_V2', 'generators', 'Q_MATRIX', 'BKT_PARAMS', 'bktUpdate', '_rawStoredP',
    'state', 'sessionData', 'setMasteryProbability', 'shouldTypeAnswer', 'skillTreeData',
    engineSrc + '\nreturn { initDiagnostic, diagProcessAnswer, pickDiagnosticCandidate, shouldStopDiagnostic, diagClassify, diagDerivedBelt, diagHoleReport, diagCommitBeliefs, DIAG };')
    (MATH_GRAPH_V2, generators, Q_MATRIX, BKT_PARAMS, bktUpdate, _rawStoredP, state, sessionData, setMasteryProbability, shouldTypeAnswer, skillTreeData);
  const N = MATH_GRAPH_V2.nodes;
  const answer = (id, outcome, time = 8) => api.diagProcessAnswer(
    { skillTags: { primary_skill: N[id].t }, tier: N[id].dt, timeExpected: 20 }, outcome, time);
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
