// Duplicate Math Dojo skills were merged (Jordan, 2026-10-21): "merge them and
// the progress can get merged into the new one where possible".
//
// Fifteen skills were retired into one that already teaches what they asked.
// Seven saved progress under the same title as their survivor (T6 Area and T2
// Area are both "Area") and needed nothing. Eight saved under a title of
// their own; foldRetiredSkills carries that progress into the survivor
// wherever saved progress comes in (this browser, the server, the 2D tree).
// The backend migration merge_duplicate_math_skills does the same to the
// stored rows.
//
// This runs the real page script.
//
// Run: node tests/dojo-merged-skills.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

function anything() {
  const fn = function () { return anything(); };
  return new Proxy(fn, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'length') return 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      return anything();
    },
    set: () => true, apply: () => anything(), construct: () => anything(),
  });
}
const storage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }; };
const sandbox = {
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  document: anything(), navigator: { userAgent: 'node', language: 'en' },
  location: { href: 'http://localhost/games/math-dojo.html', search: '', hash: '', pathname: '/games/math-dojo.html', reload() {} },
  localStorage: storage(), sessionStorage: storage(),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  fetch: () => new Promise(() => {}), Image: function () { return anything(); },
  Audio: function () { return anything(); }, AudioContext: function () { return anything(); },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  getComputedStyle: () => anything(), performance: { now: () => 0 },
  speechSynthesis: anything(), SpeechSynthesisUtterance: function () { return anything(); },
  supabase: anything(), Quill: function () { return anything(); },
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const probe = '\n;globalThis.__dojo = { generators, lessons, TIERS, Q_MATRIX, MATH_GRAPH_V2, getTreeSkillName, foldRetiredSkills, pruneRetiredSubSkills, RETIRED_SKILL_TITLES };';
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); } catch (e) {}
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) {} }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script'); process.exit(2); }
const D = sandbox.__dojo;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// [retired tier, name] -> [survivor tier, name]
const MERGED = [
  [[4, 'Equations'], [3, 'One-Step Equations']], [[6, 'Area'], [2, 'Area']], [[6, 'Volume'], [3, 'Volume']],
  [[6, 'Transformations'], [4, 'Transformations']], [[7, 'Polynomials'], [7, 'Advanced Polynomials']],
  [[8, 'Complex Numbers'], [7, 'Complex Numbers']], [[8, 'Advanced Functions'], [7, 'Composition of Functions']],
  [[10, 'Matrices'], [7, 'Determinants and Matrix Inverse']], [[3, 'Mean Median Mode'], [3, 'Statistics Basics']],
  [[7, 'Quadratics'], [5, 'Quadratics']], [[7, 'Probability'], [3, 'Simple Probability']],
  [[4, 'Probability Basics'], [3, 'Simple Probability']], [[10, 'Probability Theory'], [3, 'Simple Probability']],
  [[10, 'Series'], [8, 'Series Convergence']], [[10, 'Investments & Growth'], [7, 'Investments & Growth']],
];

console.log('\n== the retired skills are gone; their survivors are there ==\n');
for (const [[t, d], [st, sd]] of MERGED) {
  const gone = !D.generators[t][d] && !D.lessons[t][d] && !(D.TIERS[t].domains || []).includes(d)
    && !Object.keys(D.Q_MATRIX).some(k => k === `T${t}::${d}` || k.startsWith(`T${t}::${d}::`));
  const there = typeof D.generators[st][sd] === 'function' && typeof D.lessons[st][sd] === 'function' && D.TIERS[st].domains.includes(sd);
  ok(`T${t} ${d} -> T${st} ${sd}`, gone && there, `gone=${gone} survivor=${there}`);
}

console.log('\n== nothing still points at a retired title ==\n');
const titles = new Set(Object.values(D.MATH_GRAPH_V2.nodes).map(n => n.t));
const retiredTitles = Object.keys(D.RETIRED_SKILL_TITLES);
ok('no curriculum node has a retired title', retiredTitles.every(t => !titles.has(t)), retiredTitles.filter(t => titles.has(t)).join(', '));
const qmTitles = Object.values(D.Q_MATRIX).flatMap(e => [e.primary_skill, ...(e.secondary_skills || [])]);
ok('no question is tagged with a retired title', !qmTitles.some(t => retiredTitles.includes(t)), qmTitles.filter(t => retiredTitles.includes(t)).join(', '));
ok('every survivor of a fold is a curriculum node', Object.values(D.RETIRED_SKILL_TITLES).every(r => titles.has(r.to)));
for (const [, [st, sd]] of MERGED) {
  const title = D.getTreeSkillName(sd);
  if (!titles.has(title)) ok(`T${st} ${sd} saves under a curriculum title`, false, title);
}
ok('every survivor saves under a curriculum title', true);

console.log('\n== progress is folded into the survivor ==\n');
const day = n => new Date(Date.UTC(2026, 9, n)).toISOString();
{
  // Full cover, survivor already started: the stronger state wins, practice adds up.
  const skills = {
    'Probability Basics': { state: 'mastered', mastery_score: 95, p_mastered: 0.97, practice_count: 10, last_practiced: day(20), last_evidence_at: day(20), source: 'belt_test', mastered_at: day(15) },
    'Simple Probability': { state: 'in_progress', mastery_score: 50, p_mastered: 0.4, practice_count: 3, last_practiced: day(10), last_evidence_at: day(10), source: 'dojo' },
  };
  ok('a fold reports a change', D.foldRetiredSkills(skills) === true);
  const s = skills['Simple Probability'];
  ok('full cover: mastery carries over', s.state === 'mastered' && s.mastery_score === 95 && s.p_mastered === 0.97, JSON.stringify(s));
  ok('  practice adds up, latest dates and evidence win', s.practice_count === 13 && s.last_practiced === day(20) && s.last_evidence_at === day(20) && s.source === 'belt_test', JSON.stringify(s));
  ok('  and the mastery date comes with it', s.mastered_at === day(15));
  ok('  the retired key is gone, so it is never sent back', !('Probability Basics' in skills));
}
{
  // Survivor stronger than the retired record: nothing is lowered.
  const skills = {
    'Mean Median Mode': { state: 'in_progress', mastery_score: 30, practice_count: 2, last_practiced: day(1) },
    'Statistics Basics': { state: 'mastered', mastery_score: 92, p_mastered: 0.96, practice_count: 8, last_practiced: day(12), mastered_at: day(12) },
  };
  D.foldRetiredSkills(skills);
  const s = skills['Statistics Basics'];
  ok('a stronger survivor is not lowered', s.state === 'mastered' && s.mastery_score === 92 && s.p_mastered === 0.96 && s.last_practiced === day(12) && s.practice_count === 10, JSON.stringify(s));
}
{
  // Partial cover, no survivor yet: the work counts, mastery does not.
  const skills = { 'Series': { state: 'mastered', mastery_score: 98, p_mastered: 0.99, practice_count: 7, mastered_at: day(3) } };
  D.foldRetiredSkills(skills);
  const s = skills['Series Convergence'];
  ok('partial cover: in progress at most', s && s.state === 'in_progress' && s.mastery_score === 60 && s.p_mastered === 0.6 && !s.mastered_at && s.practice_count === 7, JSON.stringify(s));
  ok('  and the retired key is gone', !('Series' in skills));
}
{
  // Three retired titles into one survivor.
  const skills = {
    'Probability and Statistics': { state: 'in_progress', mastery_score: 40, practice_count: 1 },
    'Probability Theory': { state: 'activated', mastery_score: 70, practice_count: 2 },
    'Probability Basics': { state: 'available', mastery_score: 0, practice_count: 0 },
  };
  D.foldRetiredSkills(skills);
  const s = skills['Simple Probability'];
  ok('several retired titles fold into one survivor', s && s.state === 'activated' && s.mastery_score === 70 && s.practice_count === 3 && Object.keys(skills).length === 1, JSON.stringify(skills));
}
{
  const skills = { 'Area': { state: 'mastered' }, 'Fractions': { state: 'in_progress' } };
  ok('nothing to fold: no change reported, nothing touched', D.foldRetiredSkills(skills) === false && Object.keys(skills).length === 2);
}

console.log('\n== retired sub-skill progress is dropped ==\n');
{
  const completed = { '6_Area': ['rectangle'], '4_Equations': ['add'], '2_Area': ['square'], '3_Statistics Basics': ['vocab'] };
  D.pruneRetiredSubSkills(completed);
  ok('retired tier_name keys are removed, the rest stay', JSON.stringify(Object.keys(completed).sort()) === JSON.stringify(['2_Area', '3_Statistics Basics']), JSON.stringify(completed));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
