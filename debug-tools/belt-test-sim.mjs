// Belt Test simulator: invented students with a known true skill set take
// the real diagnostic in the real page, and the result is scored against the
// truth. This is how the Belt Test was tuned (2026-10-14); re-run it after
// any change to the diagnostic in games/math-dojo.html.
//
// Run:  python3 -m http.server 8765 &   then   node debug-tools/belt-test-sim.mjs [trials]
//
// Each student knows every skill up to a level, minus planted holes:
//   * a ROOTED hole has things built on it, and the student knows none of
//     those either (that is what a prerequisite means);
//   * a LEAF hole has nothing built on it, so nothing can reveal it but
//     asking it. These are the hardest holes to find in 45 questions.
// Answers: a known skill is right 92% of the time (slips); an unknown one is
// "never seen" when it is two or more tiers above the student, otherwise a
// guess, which lands one time in four on multiple choice and 3% typed.
//
// What it reports, per student type, averaged over the trials:
//   items         questions asked
//   falseCredit   skills saved as mastered that the student does not know
//   holes         planted holes found / wrongly credited / planted
//   belt          the belt awarded, beside the true belt by the same rule
//   fate          what happened to each planted hole (asked or not, status)
//
// It fails (exit 1) on the things that must not happen: a planted hole
// credited as mastered more than rarely, skills credited that the student
// does not know, or a belt above what the student clearly holds (every tier
// up to it at least 75% known; between 75% and 80% is on the line).

let chromium;
{
  const CANDIDATES = ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright/index.mjs'];
  if (process.env.PLAYWRIGHT_MODULE) CANDIDATES.unshift(process.env.PLAYWRIGHT_MODULE);
  for (const spec of CANDIDATES) {
    try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
  }
  if (!chromium) {
    console.error('belt-test-sim needs Playwright.\n  npm i -g playwright && npx playwright install chromium\n'
      + 'or set PLAYWRIGHT_MODULE to its index.mjs. Tried: ' + CANDIDATES.join(', '));
    process.exit(2);
  }
}

const TRIALS = +(process.argv[2] || 10);
const BASE = process.env.BELT_SIM_BASE || 'http://localhost:8765';
const launch = process.env.BELT_SIM_CHROME ? { executablePath: process.env.BELT_SIM_CHROME } : {};
const browser = await chromium.launch(launch);
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + '/games/math-dojo.html');
await page.waitForFunction(() => typeof initDiagnostic === 'function', null, { timeout: 30000 });

const rows = await page.evaluate(({ TRIALS }) => {
  const N = MATH_GRAPH_V2.nodes, ids = Object.keys(N), byTitle = MATH_GRAPH_V2.titleToId;
  const dependents = id => { const o = new Set(), st = [...(N[id].dep || [])]; while (st.length) { const x = st.pop(); if (o.has(x) || !N[x]) continue; o.add(x); st.push(...(N[x].dep || [])); } return o; };
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pickR = a => a[Math.floor(rnd() * a.length)];
  const leaf = t => ids.filter(i => N[i].dt === t && !(N[i].dep || []).length);
  const rooted = t => ids.filter(i => N[i].dt === t && dependents(i).size >= 3);
  const PROFILES = [
    { name: 'solid T5, start 5', level: 5, start: 5, holes: () => [] },
    { name: 'T5, 3 holes, start 5', level: 5, start: 5, holes: () => [pickR(leaf(2)), pickR(leaf(3)), pickR(rooted(3))] },
    { name: 'knows T3, starts at 6', level: 3, start: 6, holes: () => [] },
    { name: 'T8, 2 holes, start 8', level: 8, start: 8, holes: () => [pickR(leaf(4)), pickR(rooted(5))] },
    { name: 'T6, 4 holes, start 6', level: 6, start: 6, holes: () => [pickR(leaf(1)), pickR(leaf(3)), pickR(rooted(4)), pickR(leaf(5))] },
  ];
  const realRandom = Math.random;
  const avg = a => +(a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)).toFixed(2);
  const out = [];
  for (const [pi, prof] of PROFILES.entries()) {
    const A = { items: [], falseCredit: [], belt: [], trueBelt: [], found: 0, credited: 0, planted: 0, fate: {} };
    for (let trial = 0; trial < TRIALS; trial++) {
      seed = 1000 * (pi + 1) + trial;
      Math.random = rnd;
      const holes = prof.holes().filter(Boolean);
      const known = new Set(ids.filter(i => N[i].dt <= prof.level));
      for (const h of holes) { known.delete(h); if (dependents(h).size >= 3) for (const x of dependents(h)) known.delete(x); }
      skillTreeData.skills = {};
      state.mode = 'placement'; state.placementPhase = 'initial'; state.testedDomains = {};
      initScores(); state.currentTier = prof.start;
      initDiagnostic(prof.start);
      let n = 0;
      while (n < 120 && !shouldStopDiagnostic()) {
        const cand = pickDiagnosticCandidate(); if (!cand) break;
        const q = generateQuestion(cand.tier, cand.domain); if (!q || !q.skillTags) break;
        const node = byTitle[q.skillTags.primary_skill];
        let outcome;
        if (known.has(node)) outcome = rnd() < 0.92 ? 'correct' : 'wrong';
        else if (N[node].dt >= prof.level + 2 && rnd() < 0.7) outcome = 'never';
        else outcome = rnd() < (shouldTypeAnswer(q, q.tier) ? 0.03 : 0.25) ? 'correct' : 'wrong';
        diagProcessAnswer(q, outcome, 8 + rnd() * 8);
        n++;
      }
      Math.random = realRandom;
      const d = state.diag;
      const credited = ids.filter(i => d.status[i] === 'known');
      A.items.push(n);
      A.falseCredit.push(credited.filter(i => !known.has(i)).length);
      A.belt.push(diagDerivedBelt());
      // The true belt by the same 80% rule, and the highest belt that is not
      // clearly wrong: a tier the student knows 75-80% of sits on the line,
      // and landing either side of it is not an error.
      const trueBelt = cut => { let tb = 0; for (let t = 1; t <= 10; t++) { const tier = ids.filter(i => N[i].dt === t); if (tier.filter(i => known.has(i)).length / tier.length >= cut) tb = t; else break; } return Math.max(1, tb); };
      A.trueBelt.push(trueBelt(0.8));
      (A.ceilingOk = A.ceilingOk || []).push(trueBelt(0.75));
      const report = diagHoleReport();
      for (const h of holes) {
        A.planted++;
        if (d.status[h] === 'known') A.credited++;
        else if (report.some(r => r.id === h) || d.status[h] === 'blocked') A.found++;
        const k = (d.tested[h] ? 'asked:' : 'unasked:') + d.status[h];
        A.fate[k] = (A.fate[k] || 0) + 1;
      }
    }
    out.push({ student: prof.name, items: avg(A.items), falseCredit: avg(A.falseCredit),
      holes: `${A.found} found / ${A.credited} credited / ${A.planted}`, credited: A.credited, planted: A.planted,
      belt: avg(A.belt), trueBelt: avg(A.trueBelt), beltOver: Math.max(...A.belt.map((b, i) => b - A.ceilingOk[i])),
      fate: JSON.stringify(A.fate) });
  }
  return out;
}, { TRIALS });

console.table(rows.map(({ credited, planted, beltOver, ...r }) => r));
const problems = [];
for (const r of rows) {
  if (r.planted && r.credited / r.planted > 0.1) problems.push(`${r.student}: ${r.credited}/${r.planted} planted holes credited as mastered`);
  if (r.falseCredit > 1) problems.push(`${r.student}: on average ${r.falseCredit} unknown skills credited as mastered`);
  if (r.beltOver > 0) problems.push(`${r.student}: a belt ${r.beltOver} above any tier the student clearly holds`);
}
if (errors.length) problems.push('page errors: ' + errors.slice(0, 3).join(' | '));
console.log(problems.length ? 'PROBLEMS\n  ' + problems.join('\n  ') : 'ok: planted holes credited under 10%, no belt above what the student clearly holds');
await browser.close();
process.exit(problems.length ? 1 : 0);
