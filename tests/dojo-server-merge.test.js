// The Dojo's merge of the server's skill states (SKILL_DATA_FOR_DOGO), and
// when answers take a mastered skill back to in progress.
// Extracts the real message handler from games/math-dojo.html and runs it
// against stubs. Invented skills only.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const start = src.indexOf("window.addEventListener('message', (event) => {\n    if (event.data.type === 'SKILL_DATA_FOR_DOGO')")
  >= 0 ? src.indexOf("window.addEventListener('message', (event) => {\n    if (event.data.type === 'SKILL_DATA_FOR_DOGO')")
  : src.indexOf("window.addEventListener('message', (event) => {\r\n    if (event.data.type === 'SKILL_DATA_FOR_DOGO')");
if (start < 0) { console.log('FAIL could not find the handler'); process.exit(1); }
const end = src.indexOf('\n});', start);
const handlerSrc = src.slice(start, end + 4);
const orderLine = src.match(/const SKILL_STATE_ORDER = \[[^\]]*\];/)[0];

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('pass  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + JSON.stringify(detail) : '')); }
}

function run(local, server) {
  let listener = null;
  const env = {
    window: { addEventListener: (t, fn) => { listener = fn; } },
    skillTreeData: { skills: JSON.parse(JSON.stringify(local)), lastSync: 0 },
    foldRetiredSkills: () => false,
    saveSkillTreeData: () => {},
    console: { log: () => {} }
  };
  const fn = new Function('window', 'skillTreeData', 'foldRetiredSkills', 'saveSkillTreeData', 'console',
    orderLine + '\n' + handlerSrc + '\nreturn skillTreeData;');
  const data = fn(env.window, env.skillTreeData, env.foldRetiredSkills, env.saveSkillTreeData, env.console);
  listener({ data: { type: 'SKILL_DATA_FOR_DOGO', skills: server } });
  return data.skills;
}

const t = '2026-10-29T16:49:00Z';

// The repaired skill: the device holds the demoted copy with the same date.
let s = run({ 'zz Long Division': { state: 'in_progress', last_practiced: t } },
            { 'zz Long Division': { state: 'mastered', last_practiced: t, mastery_score: 100 } });
ok('a skill restored on the server shows as mastered though the dates are equal', s['zz Long Division'].state === 'mastered', s);

// Mastered on another device, practised later here.
s = run({ 'zz Perimeter': { state: 'in_progress', last_practiced: '2026-11-01T00:00:00Z' } },
        { 'zz Perimeter': { state: 'mastered', last_practiced: '2026-10-30T00:00:00Z' } });
ok('  and when this device practised it later', s['zz Perimeter'].state === 'mastered', s);

// A newer server copy still applies as before.
s = run({ 'zz Area': { state: 'available', last_practiced: '2026-10-01T00:00:00Z' } },
        { 'zz Area': { state: 'in_progress', last_practiced: '2026-10-02T00:00:00Z', mastery_score: 40 } });
ok('a newer server copy still replaces the local one', s['zz Area'].state === 'in_progress' && s['zz Area'].mastery_score === 40, s);

// A lower, older server state does not pull a mastered skill down.
s = run({ 'zz Volume': { state: 'mastered', last_practiced: '2026-11-01T00:00:00Z' } },
        { 'zz Volume': { state: 'in_progress', last_practiced: '2026-10-01T00:00:00Z' } });
ok('an older, lower server copy leaves a mastered skill alone', s['zz Volume'].state === 'mastered', s);

// New on the server.
s = run({}, { 'zz Ratios': { state: 'mastered', last_practiced: t } });
ok('a skill only the server has is taken', s['zz Ratios'] && s['zz Ratios'].state === 'mastered', s);

// ---- answers that show a skill needs practice (setMasteryProbability) ----
function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  let k = src.indexOf('{', i), depth = 0;
  for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) break; }
  return src.slice(i, k + 1);
}
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' = ');
  return src.slice(i, src.indexOf('\n};', i) + 3);
}
const bkt = new Function('skillTreeData', [grabConst('BKT_PARAMS'), grabFn('bktUpdate'), grabFn('stateFromP'), grabFn('setMasteryProbability'),
  'return { BKT_PARAMS, bktUpdate, setMasteryProbability };'].join('\n'));
function answer(start, answers) {
  const data = { skills: { 'zz Ratios': { state: 'mastered', p_mastered: start } } };
  const b = bkt(data);
  let p = start;
  for (const right of answers) { p = b.bktUpdate(p, right); b.setMasteryProbability('zz Ratios', p, '2026-11-02T00:00:00Z', 'dojo'); }
  return { state: data.skills['zz Ratios'].state, p };
}
let r = answer(0.95, [false]);
ok('one miss on a mastered skill keeps it mastered', r.state === 'mastered', r);
r = answer(0.95, [false, false]);
ok('  two misses in a row take it back to in progress', r.state === 'in_progress' && r.p < 0.30, r);
r = answer(0.61, [false]);
ok('  one miss on a skill left for months does too', r.state === 'in_progress', r);
r = answer(0.95, [false, false, true, true, true]);
ok('  and three right answers earn it back', r.state === 'mastered', r);
r = answer(0.95, [false, true, false]);
ok('  a miss, a hit, a miss: still mastered', r.state === 'mastered', r);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
