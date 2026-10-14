// English Lyceum: what the audit fixed stays fixed.
//
// Loads the page's real script with a minimal DOM and checks the things the
// 2026-10-13 audit found wrong:
//
//   * run-on questions: each has its own wrong fixes (a comma splice, a
//     misplaced comma...), never the other items' sentences, and the answer
//     is the one real fix
//   * vocabulary: a "wrong" option is never a word related to the question
//     word (enormous for "same as big"), and options never repeat
//   * typed answers: "not glad" and a list of guesses don't pass
//   * Text Features sits at stage 3, with the curriculum graph
//   * a session's thin evidence never demotes a stored skill
//
// Run: node tests/lyceum-content.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'english-lyceum.html'), 'utf8');
let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// The page's inline script, with a DOM that swallows everything.
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, code = '';
while ((m = re.exec(html))) code += m[1] + '\n';
const el = () => new Proxy({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {} },
  { get(t, k) { if (k in t) return t[k]; return (t[k] = ''); } });
const els = {};
const posted = [];
const win = { addEventListener() {}, scrollTo() {}, postMessage: (m) => posted.push(m) };
win.parent = { postMessage: (m) => posted.push(m) };
const sandbox = `
  const window = __win; const document = { getElementById: id => __els[id] || (__els[id] = __el()), querySelectorAll: () => [], querySelector: () => __el() };
  const location = { search: '?userId=test', origin: 'http://x' }; const localStorage = { getItem(){ return null; }, setItem(){} };
  const alert = () => {};
  ${code}
  return { CONTENT, GENERATORS, STAGE_SKILLS, stageOfSkill, checkTyped, State, sendSessionResults };`;
const L = new Function('__win', '__els', '__el', sandbox)(win, els, el);

console.log('\n== run-on sentences ==\n');
const runons = L.CONTENT.runons;
ok('at least 8 run-on items', runons.length >= 8);
runons.forEach(r => {
  ok(`"${r.bad}": three wrong fixes of its own`, Array.isArray(r.wrong) && r.wrong.length === 3);
  ok(`  none of them is the fix`, !r.wrong.includes(r.good));
  ok(`  none is another item's sentence`, r.wrong.every(w => !runons.some(o => o !== r && (o.bad === w || o.good === w))));
  ok(`  every wrong fix is about the same sentence`, r.wrong.every(w => w.toLowerCase().replace(/[^a-z]/g, '') === r.good.toLowerCase().replace(/[^a-z]/g, '').replace(/(and|so)(?=i|she|we|the|my)/, '') || w.toLowerCase().replace(/[^a-z]/g, '').length >= r.bad.replace(/[^a-z]/gi, '').length));
});
let sawRunOn = 0;
for (let i = 0; i < 400; i++) {
  const q = (L.GENERATORS['Sentence Structure'])(2, 'Sentence Structure');
  if (q.type !== 'run-on') continue;
  sawRunOn++;
  const ro = runons.find(r => q.prompt.includes(r.bad));
  check(`generated run-on: options are its fix + its own wrong fixes`, [...q.options].sort(), [ro.good, ...ro.wrong].sort());
  ok(`  the explanation names both thoughts`, q.explanation.includes(ro.a) && q.explanation.includes(ro.b));
  if (sawRunOn >= 3) break;
}
ok('the generator does ask run-on questions', sawRunOn > 0);

console.log('\n== vocabulary options ==\n');
let dup = 0, relatedWrong = 0, n = 0;
for (let i = 0; i < 4000; i++) {
  const stage = 1 + (i % 5);
  const q = L.GENERATORS['Vocabulary'](stage, 'Vocabulary');
  if (!q.options) continue;
  n++;
  if (new Set(q.options).size !== q.options.length) dup++;
  if (q.type === 'synonym' || q.type === 'antonym') {
    const v = L.CONTENT.vocab[stage].find(x => q.prompt.includes(`<b>${x.w}</b>`));
    const rightList = q.type === 'synonym' ? v.syn : v.ant;
    // a wrong option that is in the word's own synonym or antonym list, or in
    // the lists of a word linked to it, would be a second right answer
    const rel = new Set([v.w, ...v.syn, ...v.ant]);
    const linked = L.CONTENT.vocab[stage].filter(o => o !== v && [o.w, ...o.syn, ...o.ant].some(x => rel.has(x)));
    const linkedWords = new Set(linked.flatMap(o => [...o.syn, ...o.ant]));
    q.options.forEach((o, j) => { if (j !== q.correct && (rightList.includes(o) || linkedWords.has(o))) relatedWrong++; });
  }
}
check(`no repeated options in ${n} vocabulary questions`, dup, 0);
check('no wrong option comes from a related word', relatedWrong, 0);

console.log('\n== typed answers ==\n');
const q = { typed: true, match: 'word', accept: ['glad', 'cheerful', 'joyful'] };
check('"glad" passes', L.checkTyped('glad', q), true);
check('"so glad" passes', L.checkTyped('so glad', q), true);
check('"not glad" does not', L.checkTyped('not glad', q), false);
check('"isn\'t glad" does not', L.checkTyped("isn't glad", q), false);
check('a list of guesses does not', L.checkTyped('sad angry glad tired', q), false);

console.log('\n== stages ==\n');
check('Text Features is a stage-3 skill', L.stageOfSkill('Text Features'), 3);
check('Critical Thinking is stage 4', L.stageOfSkill('Critical Thinking'), 4);

console.log('\n== thin evidence never demotes ==\n');
posted.length = 0;
Object.assign(L.State, { mode: 'desk', scores: { 'Vocabulary': { correct: 1, total: 1, stage: 2 } }, bkt: { 'Vocabulary': 0.96 },
  knownSkills: { 'Vocabulary': { state: 'mastered', p_mastered: 0.95 } } });
L.sendSessionResults();
const sent = posted.find(m => m.type === 'DOGO_SESSION_COMPLETE');
check('one right answer keeps a mastered skill mastered', sent && sent.bktUpdates.map(u => u.derivedState), ['mastered']);
posted.length = 0;
Object.assign(L.State, { scores: { 'Vocabulary': { correct: 0, total: 1, stage: 2 } }, bkt: { 'Vocabulary': 0.5 },
  knownSkills: { 'Vocabulary': { state: 'mastered', p_mastered: 0.95 } } });
L.sendSessionResults();
const sent2 = posted.find(m => m.type === 'DOGO_SESSION_COMPLETE');
check('one wrong answer does not lower it either', sent2 ? sent2.bktUpdates.length : 0, 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
