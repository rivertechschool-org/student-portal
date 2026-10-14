// Recall Trials from the portal: English Lyceum launched as homework, walked in Chromium.
//
// Run:  python -m http.server 8780 &   then   node debug-tools/recall-journey.mjs
//       (RECALL_PW = Playwright module, RECALL_CHROME = a browser you already have,
//        RECALL_URL = the host page, default http://localhost:8780/debug-tools/recall-host.html)
//
// The host (debug-tools/recall-host.html) loads the REAL shared/recall-bridge.js the way
// the portal does. Before it, the portal never answered Recall, so the run waited five
// seconds and told the student to go to the Games page. What it holds now:
//
//   * Recall gets a line-up from the host: the student's own skills, no "use the Games page"
//   * a defended skill keeps its mastery (score raised), a missed one drops to activated
//   * RTC is asked for the clear and the result reaches the game's results screen
//   * the run is logged, so a second run inside 24 hours pays nothing for the same clear

let chromium;
for (const spec of [process.env.RECALL_PW, 'playwright', 'playwright-core'].filter(Boolean)) {
  try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
}
if (!chromium) { console.error('Needs Playwright (npm i -g playwright), or set RECALL_PW.'); process.exit(2); }
const URL = process.env.RECALL_URL || 'http://localhost:8780/debug-tools/recall-host.html';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

const browser = await chromium.launch(process.env.RECALL_CHROME ? { executablePath: process.env.RECALL_CHROME } : {});
const top = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
top.on('pageerror', e => errors.push(e.message));
await top.goto(URL);
let g;
for (let i = 0; i < 100 && !g; i++) {
  const f = top.frames().find(x => x.url().includes('english-lyceum'));
  if (f) { try { await f.waitForFunction(() => typeof Game !== 'undefined', null, { timeout: 200 }); g = f; } catch (_) {} }
  if (!g) await top.waitForTimeout(100);
}
if (!g) throw new Error('Lyceum did not load');
const writes = () => top.evaluate(() => JSON.parse(JSON.stringify(window.__writes)));
const db = () => top.evaluate(() => JSON.parse(JSON.stringify(window.__db)));

// Plays a whole run: `missSkill` gets one wrong answer, everything else is right.
async function playRecall(missSkill) {
  await g.evaluate(() => Game.startRecall());
  await g.waitForFunction(() => State.queue && State.queue.length > 0, null, { timeout: 3000 });
  for (let n = 0; n < 200; n++) {
    const done = await g.evaluate(() => document.getElementById('screen-results').classList.contains('active') ||
      !document.getElementById('screen-results').classList.contains('hidden') && State.recallIdx >= State.queue.length);
    if (done) break;
    await g.evaluate((missSkill) => {
      const q = State.current;
      const wrong = q.skill === missSkill;
      if (q.typed) {
        const i = document.getElementById('typed-input');
        i.value = wrong ? 'zzzz' : (Array.isArray(q.accept) && typeof q.accept[0] === 'string' ? q.accept[0] : (q.accept[0].all || []).join(' '));
        submitTyped();
      } else choose(wrong ? (q.correct + 1) % q.options.length : q.correct);
      nextRecallQuestion();
    }, missSkill);
    if (await g.evaluate(() => State.recallIdx >= State.queue.length)) break;
  }
  await top.waitForTimeout(600);
}

console.log('\n  Recall from the portal\n');
await playRecall('Main Ideas');
const lineup = await g.evaluate(() => State.queue.map(s => s.skill));
check('the line-up is the student\'s own skills', [...new Set(lineup)].sort(), ['Main Ideas', 'Vocabulary']);
const sub = await g.evaluate(() => document.getElementById('res-sub').textContent);
ok('no "works from the Games page" message', !/Games page/.test(sub));

let w = await writes();
const saved = Object.fromEntries(w.upserts.flatMap(u => u.rows).map(r => [r.skill_name, r]));
check('defended skill stays mastered, score raised to 90', saved.Vocabulary && [saved.Vocabulary.state, saved.Vocabulary.mastery_score], ['mastered', 90]);
check('missed skill drops to activated, capped at 70', saved['Main Ideas'] && [saved['Main Ideas'].state, saved['Main Ideas'].mastery_score], ['activated', 70]);
check('RTC is asked for one clear', w.rpcs.map(r => [r.fn, r.args.p_skill_count]), [['award_skill_gauntlet_rtc', 1]]);
const rtc = await g.evaluate(() => document.getElementById('res-rtc').textContent);
check('the result reaches the results screen', rtc, '🪙 +3 RTC earned');
check('the run is logged', (await db()).math_dojo_sessions.length, 1);

console.log('\n  A second run the same day\n');
await playRecall(null);
w = await writes();
// Vocabulary cleared an hour ago: no pay. Main Ideas was missed then and is
// cleared now - a fresh clear, so it pays.
check('only the fresh clear pays; the repeat is on its 24h cooldown', w.rpcs.map(r => r.args.p_skill_count), [1, 1]);
const rtc2 = await g.evaluate(() => document.getElementById('res-rtc').textContent);
check('the student is told about the cooldown', rtc2, '🪙 +3 RTC earned · 1 on 24h cooldown');

check('no page errors', errors, []);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
