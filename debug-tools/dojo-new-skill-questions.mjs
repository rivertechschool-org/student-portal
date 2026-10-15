// The questions written 2026-10-15 for four skills nothing used to test
// (Factoring Trinomials, Classifying Triangles, Trigonometric Ratios,
// Applications of Derivatives): draws 400 from each area in a Belt Test and in
// practice and checks each answer from the numbers in the question, that no
// wrong option is also right, that typed answers are accepted (and an
// unfactored one refused), and that each question credits the skill it tests.
//
// Run:  python3 -m http.server 8765 &   then   node debug-tools/dojo-new-skill-questions.mjs
// Same Playwright lookup and env knobs as debug-tools/belt-test-sim.mjs.
let chromium;
{
  const CANDIDATES = ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright/index.mjs'];
  if (process.env.PLAYWRIGHT_MODULE) CANDIDATES.unshift(process.env.PLAYWRIGHT_MODULE);
  for (const spec of CANDIDATES) {
    try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
  }
  if (!chromium) { console.error('needs Playwright: npm i -g playwright && npx playwright install chromium'); process.exit(2); }
}
const BASE = process.env.BELT_SIM_BASE || 'http://localhost:8765';
const b = await chromium.launch(process.env.BELT_SIM_CHROME ? { executablePath: process.env.BELT_SIM_CHROME } : {});
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/games/math-dojo.html');
await p.waitForFunction(() => typeof initDiagnostic === 'function');
const out = await p.evaluate(() => {
  const problems = [], counts = {};
  const bad = (q, why) => { if (problems.length < 40) problems.push(`[${q.generatorKey}] ${why} :: ${q.question} => ${q.answer}`); };
  const node = q => q.skillTags && q.skillTags.primary_skill;
  // Polynomial value of "(kx+r)(kx+r)" or "ax² + bx + c" at x.
  const evalFactored = (s, x) => { const m = String(s).match(/^\((\d*)x([+-]\d+)\)\((\d*)x([+-]\d+)\)$/); if (!m) return NaN; return ((+(m[1] || 1)) * x + (+m[2])) * ((+(m[3] || 1)) * x + (+m[4])); };
  const parsePoly = s => { const m = s.match(/Factor: (\d*)x²(?: ([+-]) (\d*)x)? ([+-]) (\d+)$/); if (!m) return null; return { a: +(m[1] || 1), b: m[2] ? (m[2] === '-' ? -1 : 1) * +(m[3] || 1) : 0, c: (m[4] === '-' ? -1 : 1) * +m[5] }; };
  const want = { 'T5::Factoring': ['Factoring Trinomials', 'Difference of Squares'], 'T6::Triangles': ['Classifying Triangles'], 'T6::Trigonometry': ['Trigonometric Ratios'], 'T9::Applications': ['Applications of Derivatives'] };
  for (const mode of ['placement', 'testing']) {
    state.mode = mode; state.testedDomains = {}; state.completedSubSkills = {};
    for (const [tier, dom] of [[5, 'Factoring'], [6, 'Triangles'], [6, 'Trigonometry'], [9, 'Applications']]) {
      for (let i = 0; i < 400; i++) {
        const q = generateQuestion(tier, dom);
        const key = `${mode} ${q.generatorKey}`; counts[key] = (counts[key] || 0) + 1;
        if (!want[`T${tier}::${dom}`].includes(node(q))) bad(q, 'credits ' + node(q));
        if (!MATH_GRAPH_V2.titleToId[node(q)]) bad(q, 'not a graph skill: ' + node(q));
        if (q.options && !q.options.map(String).includes(String(q.answer))) bad(q, 'answer not in options ' + JSON.stringify(q.options));
        if (q.options && new Set(q.options.map(String)).size !== q.options.length) bad(q, 'duplicate options');
        if (shouldTypeAnswer(q, tier)) {
          if (!typedAnswerIsCorrect(String(q.answer), q)) bad(q, 'own answer marked wrong when typed');
          for (const alt of (q.acceptableAnswers || [])) if (!typedAnswerIsCorrect(String(alt), q)) bad(q, 'acceptable answer refused: ' + alt);
        }
        // Factoring: the answer multiplies back to the question; no distractor does.
        if (dom === 'Factoring' && /trinomial/.test(q.subType || '')) {
          const P = parsePoly(q.question);
          if (!P) { bad(q, 'unparsed polynomial'); continue; }
          for (const x of [-3, -1, 0, 2, 5]) if (evalFactored(q.answer, x) !== P.a * x * x + P.b * x + P.c) { bad(q, 'answer does not expand to the question at x=' + x); break; }
          for (const o of (q.options || [])) if (String(o) !== String(q.answer) && [-3, -1, 0, 2, 5, 7].every(x => evalFactored(o, x) === P.a * x * x + P.b * x + P.c)) bad(q, 'distractor also right: ' + o);
          const expanded = q.question.replace('Factor: ', '').replace(/²/g, '^2');
          if (typedAnswerIsCorrect(expanded, q)) bad(q, 'unfactored answer accepted: ' + expanded);
        }
        if (dom === 'Factoring' && q.subType === 'difference' && typedAnswerIsCorrect(q.question.replace('Factor: ', '').replace(/²/g, '^2'), q)) bad(q, 'unfactored difference accepted');
        if (dom === 'Triangles') {
          const nums = (q.question.match(/\d+/g) || []).map(Number);
          if (q.subType === 'type_by_angle') {
            const ang = nums.length === 2 ? [...nums, 180 - nums[0] - nums[1]] : nums;
            if (ang.reduce((s, x) => s + x, 0) !== 180 || ang.some(x => x <= 0)) bad(q, 'angles do not make a triangle');
            const k = ang.includes(90) ? 'right' : ang.some(x => x > 90) ? 'obtuse' : 'acute';
            if (k !== q.answer) bad(q, 'should be ' + k);
          }
          if (q.subType === 'type_by_side') {
            const [x, y, z] = nums;
            if (x + y <= z || x + z <= y || y + z <= x) bad(q, 'sides do not make a triangle');
            const eq = new Set(nums).size, k = eq === 1 ? 'equilateral' : eq === 2 ? 'isosceles' : 'scalene';
            if (k !== q.answer) bad(q, 'should be ' + k);
          }
          if (q.subType === 'classify_both') {
            if (nums.reduce((s, x) => s + x, 0) !== 180 || nums.some(x => x <= 0)) bad(q, 'angles do not make a triangle');
            const byA = nums.includes(90) ? 'right' : nums.some(x => x > 90) ? 'obtuse' : 'acute';
            const eq = new Set(nums).size, byS = eq === 1 ? 'equilateral' : eq === 2 ? 'isosceles' : 'scalene';
            if (`${byA} ${byS}` !== q.answer) bad(q, 'should be ' + byA + ' ' + byS);
          }
        }
        if (dom === 'Trigonometry') {
          const nums = (q.question.match(/\d+/g) || []).map(Number);
          if (q.subType === 'find_side') {
            // ratio a/b, then a length L that is the ratio's denominator side, scaled
            const [r1, r2, L] = nums;
            if (Math.abs(L * r1 / r2 - q.answer) > 1e-9 || !Number.isInteger(q.answer)) bad(q, 'side should be ' + (L * r1 / r2));
          }
          if (q.subType === 'find_angle') {
            const both = /both/.test(q.question);
            const [s1, s2] = both ? [nums[0], nums[0]] : nums;
            const exp = both ? 45 : /opposite/.test(q.question) ? 30 : 60;
            if (!both && s2 !== 2 * s1) bad(q, 'sides not special');
            if (q.answer !== exp) bad(q, 'angle should be ' + exp);
          }
          if (q.subType === 'applied') {
            const nm = q.question.match(/(\d+) (?:ft|m)[^]*?= (\d+)\/(\d+)|= (\d+)\/(\d+)[^]*?runs (\d+)/);
            let expv = null;
            const r = q.question.match(/= (\d+)\/(\d+)/); const len = q.question.match(/A (\d+) ft ladder|string (\d+) m|runs (\d+) m/);
            if (r && len) { const L = +(len[1] || len[2] || len[3]); expv = L * (+r[1]) / (+r[2]); }
            if (expv === null || Math.abs(expv - q.answer) > 1e-9) bad(q, 'applied should be ' + expv);
          }
          if (['sin', 'cos', 'tan'].includes(q.subType)) { /* existing, unchanged */ } else if (!['find_side', 'find_angle', 'applied'].includes(q.subType)) bad(q, 'untagged trig question');
        }
      }
    }
  }
  // Reachable by the diagnostic now?
  state.mode = 'placement';
  const { byNode } = buildDiagCandidates();
  const N = MATH_GRAPH_V2.nodes;
  const untestable = Object.keys(N).filter(i => !byNode[i]).map(i => N[i].t);
  return { problems, counts, untestable };
});
console.log(JSON.stringify(out.counts, null, 1));
console.log('untestable:', out.untestable);
console.log(out.problems.length ? 'PROBLEMS\n' + out.problems.join('\n') : 'no problems');
console.log('errors', errs);
await b.close();
process.exit(out.problems.length || errs.length || out.untestable.length ? 1 : 0);
