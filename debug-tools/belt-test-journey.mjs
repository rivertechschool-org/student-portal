// Belt Test journey through the real buttons, with the Dojo framed the way
// the portal frames it. An invented student who knows Tier 4 and below,
// never saw anything from Tier 6 up, and guesses at Tier 5.
//
// Run:  python3 -m http.server 8765 &   then   node debug-tools/belt-test-journey.mjs
// Same Playwright lookup and env knobs as debug-tools/belt-test-sim.mjs.
let chromium;
{
  const CANDIDATES = ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright/index.mjs'];
  if (process.env.PLAYWRIGHT_MODULE) CANDIDATES.unshift(process.env.PLAYWRIGHT_MODULE);
  for (const spec of CANDIDATES) {
    try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
  }
  if (!chromium) { console.error('belt-test-journey needs Playwright: npm i -g playwright && npx playwright install chromium'); process.exit(2); }
}
const BASE = process.env.BELT_SIM_BASE || 'http://localhost:8765';
const b = await chromium.launch(process.env.BELT_SIM_CHROME ? { executablePath: process.env.BELT_SIM_CHROME } : {});
const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/portal/');   // same-origin host page
await page.setContent('<html><body><iframe id="f" src="' + BASE + '/games/math-dojo.html" style="width:1180px;height:880px"></iframe><script>window.got=[];addEventListener("message",e=>{if(e.data&&e.data.type)window.got.push(e.data)});</script></body></html>');
const frameEl = await page.waitForSelector('#f');
const f = await frameEl.contentFrame();
f.on && 0;
page.on('framenavigated', () => {});
await f.waitForFunction(() => typeof startPlacementTest === 'function', null, { timeout: 30000 });
f.page().on('pageerror', e => errs.push(e.message));

// No recent Belt Test: the Hole Check sends the student to take one.
await f.evaluate(() => { localStorage.clear(); skillTreeData.skills = {}; selectMode('holecheck'); });
const noTest = await f.evaluate(() => ({ text: document.getElementById('holecheck-setup-body').innerText, disabled: document.getElementById('start-holecheck-btn').disabled }));
await f.evaluate(() => goToModeSelect());

await f.evaluate(() => selectMode('placement'));
await f.click('.level-card:has-text("Middle School")');
await f.click('#start-placement-btn');
const KNOWS = 4;
const log = [];
// Answer until the results screen: right at or below Tier 4, "never seen" two
// tiers up, wrong in between. Interactive visuals are left alone (a miss).
async function answerUntilResults(label) {
  let asked = 0;
  for (; asked < 60; asked++) {
    const onResults = await f.evaluate(() => document.getElementById('results-screen').classList.contains('active'));
    if (onResults) break;
    const info = await f.evaluate(() => ({ tier: state.currentQuestion.tier, title: state.currentQuestion.skillTags && state.currentQuestion.skillTags.primary_skill,
      typed: !!state.isTypedAnswer, answer: String(state.currentQuestion.answer), idx: state.currentQuestion.answerIndex,
      interactive: !!(state.currentQuestion.visual && state.currentQuestion.visual.mode === 'interactive') }));
    const node = await f.evaluate(t => MATH_GRAPH_V2.nodes[MATH_GRAPH_V2.titleToId[t]], info.title);
    const dt = node ? node.dt : info.tier;
    // A real student takes a few seconds; an instant answer reads as a guess.
    await f.evaluate(() => { state.startTime -= 6000; }); await f.waitForTimeout(150);
    let action;
    if (dt >= KNOWS + 2) action = 'never';
    else if (dt <= KNOWS && !info.interactive) action = 'right';
    else action = 'wrong';
    if (action === 'never') {
      await f.click('#idk-never-btn');
    } else if (info.typed) {
      await f.fill('#typed-answer-input', action === 'right' ? info.answer : '987654321');
      await f.click('#submit-btn');
    } else if (info.interactive) {
      await f.evaluate(() => { document.getElementById('submit-btn').disabled = false; });
      await f.click('#submit-btn');
    } else {
      const opts = await f.$$('.answer-option');
      const pick = action === 'right' ? info.idx : (info.idx + 1) % opts.length;
      await opts[pick].click();
      await f.click('#submit-btn');
    }
    log.push(`${label} T${dt} ${info.title} ${action}${info.typed ? ' (typed)' : ''}`);
    await f.click('#next-btn');
  }
  return asked;
}
const asked = await answerUntilResults('belt');
const res = await f.evaluate(() => ({
  title: document.getElementById('results-title').textContent,
  belt: document.getElementById('result-tier-number').textContent,
  summary: document.getElementById('recommendations').innerText.slice(0, 1200),
  gaps: document.getElementById('gap-log').innerText.slice(0, 900),
  tree: (document.getElementById('tree-sync-results') || {}).innerText?.slice(0, 600),
  ceiling: state.diag.ceiling,
  toCheck: diagStillToCheck().length,
}));
const got = await page.evaluate(() => window.got.filter(m => m.type === 'BACKFILL_SKILLS').map(m => m.skills));
console.log('questions', asked); console.log(log.join(String.fromCharCode(10)));
console.log('--- belt', res.belt, 'level', res.ceiling); console.log(res.summary); console.log('--- holes'); console.log(res.gaps); console.log('--- tree'); console.log(res.tree);
const sk = (got[0] || []);
const byState = {}; sk.forEach(s => byState[s.state] = (byState[s.state] || 0) + 1);
console.log('--- BACKFILL', JSON.stringify(byState));
const nodes = await f.evaluate(() => Object.fromEntries(Object.values(MATH_GRAPH_V2.nodes).map(n => [n.t, n.dt])));
const wrongMastered = sk.filter(s => s.state === 'mastered' && nodes[s.skillName] > KNOWS);
console.log('mastered above what the student knows:', wrongMastered.map(s => s.skillName + ' T' + nodes[s.skillName]));

// ---- Hole Check: from the results page, one sitting ------------------------
const sentBefore = new Set(sk.map(s => s.skillName));
const hasButton = await f.evaluate(() => !!document.querySelector('#recommendations button[onclick="startHoleCheck()"]'));
let hc = null, hcSent = [], hcAsked = 0;
if (hasButton) {
  await f.click('#recommendations button[onclick="startHoleCheck()"]');
  hcAsked = await answerUntilResults('hole');
  hc = await f.evaluate(() => ({ title: document.getElementById('results-title').textContent,
    summary: document.getElementById('recommendations').innerText.slice(0, 600), toCheck: diagStillToCheck().length }));
  const all = await page.evaluate(() => window.got.filter(m => m.type === 'BACKFILL_SKILLS').map(m => m.skills));
  hcSent = all[1] || [];
  console.log('--- hole check', hcAsked, 'questions'); console.log(log.filter(l => l.startsWith('hole')).join(String.fromCharCode(10))); console.log(hc.summary);
  console.log('still to check: before', res.toCheck, 'after', hc.toCheck, '| sent', hcSent.length, 'skills');
}
console.log('errors', errs);
const problems = [];
if (errs.length) problems.push('page errors');
if (!sk.length) problems.push('no skills sent to the portal');
if (wrongMastered.length) problems.push('skills above what the student knows saved as mastered');
if (!(+res.belt >= KNOWS - 1 && +res.belt <= KNOWS)) problems.push('belt ' + res.belt + ' for a student who knows Tier ' + KNOWS);
if (!/What the test found/.test(res.summary)) problems.push('results summary missing');
if (!noTest.disabled || !/Belt Test/.test(noTest.text)) problems.push('Hole Check without a Belt Test did not point to the Belt Test');
if (res.toCheck && !hasButton) problems.push('no Hole Check button with skills still to check');
if (hc) {
  if (hc.title !== 'Hole Check Results') problems.push('Hole Check results title: ' + hc.title);
  if (hcAsked < 1 || hcAsked > 15) problems.push('Hole Check sitting asked ' + hcAsked);
  if (!(hc.toCheck < res.toCheck)) problems.push('Hole Check did not reduce what is left to check');
  if (hcSent.some(s => s.state === 'mastered' && nodes[s.skillName] > KNOWS)) problems.push('Hole Check saved mastery above what the student knows');
}
console.log(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'ok');
await b.close();
process.exit(problems.length ? 1 : 0);
