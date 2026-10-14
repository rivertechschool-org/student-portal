// Word Lab journeys: English Lyceum's vocabulary system, walked in Chromium.
//
// Run:  python -m http.server 8780 &   then   node debug-tools/wordlab-journey.mjs
//       (WORDLAB_PW = Playwright module, WORDLAB_CHROME = a browser you already have,
//        WORDLAB_URL = the host page, default http://localhost:8780/debug-tools/wordlab-host.html)
//
// The host page (debug-tools/wordlab-host.html) loads the REAL shared/vocab-bridge.js
// with a stub database, so every journey goes game -> postMessage -> bridge -> RPC,
// the way it does on the student site. What it holds:
//
//   * opening Word Lab loads the student's saved state
//   * the Assessment climbs while the student passes and places them at the first
//     grade they don't pass, and saves it
//   * Learning lists the level's twelve words with meaning, example and respelling
//   * every Practice answer is recorded; a right answer moves a word up only when
//     it is due, a wrong one brings it back for review
//   * passing an Evaluation (80%) saves the pass and moves the student up a level;
//     failing one saves nothing and names the words to practise
//   * flashcards record what the student says they knew
//   * reloading the page brings the progress back from the database

let chromium;
for (const spec of [process.env.WORDLAB_PW, 'playwright', 'playwright-core'].filter(Boolean)) {
  try { ({ chromium } = await import(spec)); break; } catch (_) { /* next */ }
}
if (!chromium) { console.error('Needs Playwright (npm i -g playwright), or set WORDLAB_PW.'); process.exit(2); }
const URL = process.env.WORDLAB_URL || 'http://localhost:8780/debug-tools/wordlab-host.html';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`  FAIL   ${label}\n         expected ${e}\n         got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

const browser = await chromium.launch(process.env.WORDLAB_CHROME ? { executablePath: process.env.WORDLAB_CHROME } : {});
const top = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
top.on('pageerror', e => errors.push(e.message));
await top.goto(URL);
const frame = async () => {
  for (let i = 0; i < 100; i++) {
    const f = top.frames().find(x => x.url().includes('english-lyceum'));
    if (f) { try { await f.waitForFunction(() => window.WordLab, null, { timeout: 200 }); return f; } catch (_) {} }
    await top.waitForTimeout(100);
  }
  throw new Error('Lyceum did not load');
};
let g = await frame();
const rpc = () => top.evaluate(() => window.__rpc);
const db = () => top.evaluate(() => JSON.parse(JSON.stringify(window.__db)));
const wait = (ms) => top.waitForTimeout(ms);

// Answers the question on screen, right or wrong, the way a student would.
async function answer(right) {
  return g.evaluate((right) => {
    const Q = WordLab._q();
    const q = Q.items[Q.i];
    if (q.kind === 'match') {
      q.words.forEach(e => {
        WordLab.matchTap(document.querySelector(`#wl-q-body .ans[data-side="w"][data-k="${e.k}"]`));
        WordLab.matchTap(document.querySelector(`#wl-q-body .ans[data-side="d"][data-k="${e.k}"]`));
      });
    } else if (q.options) {
      WordLab.choose(q.options.findIndex(o => right ? o.ok : !o.ok));
    } else {
      document.getElementById('wl-typed').value = right ? q.typed : 'qqqq';
      WordLab.submitTyped();
    }
    return q.kind;
  }, right);
}
// Plays the session through. `rightFor(item)` decides each answer.
async function playSession(rightFor) {
  const kinds = [];
  for (let n = 0; n < 60; n++) {
    const state = await g.evaluate(() => { const Q = WordLab._q(); return Q && !Q.over ? { i: Q.i, grade: Q.items[Q.i].e.grade, mode: Q.mode } : null; });
    if (!state) break;
    kinds.push(await answer(rightFor(state)));
    await g.evaluate(() => { const Q = WordLab._q(); if (Q && !Q.over && Q.answered) WordLab.next(); });
    await wait(380);   // past the double-tap lock
  }
  await wait(300);
  return kinds;
}

console.log('\n== opening ==\n');
ok('Lyceum shows the Word Lab card', await g.isVisible('.mode.wordlab'));
await g.evaluate(() => WordLab.open());
await wait(600);
ok('opening asks for the saved state', (await rpc()).some(c => c.fn === 'rt_vocab_state'));
ok('a new student is told to start with the Assessment', /Start with the Assessment/.test(await g.textContent('#wl-where')));

console.log('\n== assessment ==\n');
await g.evaluate(() => WordLab.startAssessment());
await g.selectOption('#wl-my-grade', '4');
await g.evaluate(() => WordLab._beginAssessment());
await wait(500);
// Knows everything up to grade 5, nothing from grade 6 on.
const easy = new Set(['K', '1', '2', '3', '4', '5']);
await playSession(s => easy.has(s.grade));
const placed = (await rpc()).find(c => c.fn === 'rt_vocab_set_placement');
check('placed at the first grade not passed (grade 6)', placed && placed.args.p_grade, '6');
check('  having tested grades 3, 4, 5 and 6', placed && Object.keys(placed.args.p_detail).sort(), ['3', '4', '5', '6']);
ok('  and the result screen says so', /Grade 6, Level 1/.test(await g.textContent('#wl-results')));
check('the assessment does not count as practice', (await rpc()).filter(c => c.fn === 'rt_vocab_record').length, 0);

console.log('\n== learning ==\n');
await g.evaluate(() => WordLab.openLearning());
await wait(400);
check('Learning opens on their level: twelve words', await g.$$eval('#wl-learn-list .wl-word', x => x.length), 12);
const card = await g.textContent('#wl-learn-list .wl-word');
ok('  each with a part of speech, a respelling and an example', /say it:/.test(card) && /“.+”/.test(card));
check('  all new so far', await g.$$eval('#wl-learn-list .wl-tag', x => x.every(t => /New/.test(t.textContent))), true);

console.log('\n== practice ==\n');
await g.evaluate(() => WordLab.startPractice('mix'));
await wait(300);
const kinds = await playSession(() => true);
ok('a mixed session uses several kinds of question', new Set(kinds).size >= 3);
ok('  including a matching round', kinds.includes('match'));
await g.evaluate(() => WordLab.home());
await wait(400);
let d = await db();
const met = Object.keys(d.words).length;
check('all twelve words recorded', met, 12);
ok('  each moved to box 1 by a right answer', Object.values(d.words).every(w => w.box === 1));

await g.evaluate(() => WordLab.startPractice('mix'));
await wait(300);
await playSession(() => true);
await g.evaluate(() => WordLab.home());
await wait(400);
d = await db();
ok('right again in the same sitting: counted, but not moved up (not due yet)', Object.values(d.words).every(w => w.box === 1 && w.right >= 2));

await g.evaluate(() => WordLab.startPractice('mix'));
await wait(300);
let missed = 0;
await playSession(() => (missed++ < 2 ? false : true));
await g.evaluate(() => WordLab.home());
await wait(400);
d = await db();
const missedWords = Object.values(d.words).filter(w => w.wrong > 0);
ok('missed words come back in 10 minutes (not straight away)', missedWords.length >= 1
   && missedWords.every(w => w.box === 1 && w.due > Date.now() && w.due <= Date.now() + 11 * 60000));

console.log('\n== evaluation ==\n');
await g.evaluate(() => WordLab.startEvaluation());
await wait(400);
await answer(true);
await g.evaluate(() => WordLab.endSession());
await wait(300);
ok('quitting an Evaluation after one right answer passes nothing', !(await rpc()).some(c => c.fn === 'rt_vocab_pass_level'));

await g.evaluate(() => WordLab.startAssessment());
await g.selectOption('#wl-my-grade', '4');
await g.evaluate(() => WordLab._beginAssessment());
await wait(500);
const tap = await g.evaluate(() => { const before = WordLab._q().i; WordLab.choose(0); WordLab.choose(0); return [before, WordLab._q().i, WordLab._q().results.length]; });
check('a double-tap answers one question, not two', tap, [0, 1, 1]);
await g.evaluate(() => WordLab.endSession());
await wait(200);

await g.evaluate(() => WordLab.startEvaluation());
await wait(300);
await playSession(() => false);
ok('failing saves no pass', !(await rpc()).some(c => c.fn === 'rt_vocab_pass_level'));
ok('  and names words to practise', /Practise these/.test(await g.textContent('#wl-results')));

await g.evaluate(() => WordLab.startEvaluation());
await wait(300);
await playSession(() => true);
const passed = (await rpc()).find(c => c.fn === 'rt_vocab_pass_level');
check('passing saves the pass and the next level', passed && [passed.args.p_grade, passed.args.p_level, passed.args.p_next_grade, passed.args.p_next_level, passed.args.p_score], ['6', 1, '6', 2, 100]);
ok('  and says so', /Level passed/.test(await g.textContent('#wl-results')) && /Level 2/.test(await g.textContent('#wl-results')));

console.log('\n== flashcards ==\n');
const before = (await rpc()).filter(c => c.fn === 'rt_vocab_record').reduce((t, c) => t + c.args.p_results.length, 0);
await g.evaluate(() => WordLab.startFlashcards());
await wait(300);
for (let i = 0; i < 20; i++) {
  const more = await g.evaluate(() => { const Q = WordLab._q(); return Q && !Q.over; });
  if (!more) break;
  await g.evaluate(() => WordLab._flip());
  await g.evaluate(() => WordLab._flash(true));
  await wait(380);
}
await g.evaluate(() => WordLab.home());
await wait(400);
const after = (await rpc()).filter(c => c.fn === 'rt_vocab_record').reduce((t, c) => t + c.args.p_results.length, 0);
ok('flashcards record what the student knew', after > before);

console.log('\n== coming back ==\n');
await top.evaluate(() => { document.getElementById('game').src = document.getElementById('game').src; });
await wait(800);
g = await frame();
await g.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
await g.evaluate(() => WordLab.open());
await wait(800);
ok('progress comes back from the database, not this browser', /Level 2/.test(await g.textContent('#wl-where'))
   && /2[0-9]\s*words met/.test(await g.textContent('#wl-stats')));

check('no page errors', errors, []);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
