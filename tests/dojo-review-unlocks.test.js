// A skill due for review still counts as learned for what comes after it.
//
// Reported 2026-10-21: T3 Advanced Fractions and Decimals "don't open, I
// can't click to open the lesson at all". Their prerequisites (Fraction
// Operations and Mixed Numbers; Place Value and Fractions) had been mastered
// and then faded to "needs review". isSkillUnlocked only accepted mastered
// or activated, so the lessons locked again, while the lock message counted
// needs_review as mastered and showed every prerequisite ticked.
//
// This runs the real page script.
//
// Run: node tests/dojo-review-unlocks.test.js
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
const probe = '\n;globalThis.__dojo = { generators, lessons, TIERS, Q_MATRIX, MATH_GRAPH_V2, getTreeSkillName, isSkillUnlocked, skillTreeData, triggerDependentUnlocks };';
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
const set = states => { D.skillTreeData.skills = {}; for (const [d, st] of Object.entries(states)) D.skillTreeData.skills[D.getTreeSkillName(d)] = { state: st, mastery_score: 85 }; };

console.log('\n== faded prerequisites still open the next lesson ==\n');
set({ 'Fraction Operations': 'needs_review', 'Mixed Numbers': 'needs_review' });
ok('Advanced Fractions opens when both prerequisites need review', D.isSkillUnlocked('Advanced Fractions'));
set({ 'Place Value': 'needs_review', 'Fractions (Concepts)': 'mastered' });
ok('Decimals opens with one mastered and one due for review', D.isSkillUnlocked('Decimals'));

console.log('\n== an unlearned prerequisite still locks ==\n');
set({ 'Fraction Operations': 'needs_review', 'Mixed Numbers': 'in_progress' });
ok('Advanced Fractions stays locked while Mixed Numbers is in progress', !D.isSkillUnlocked('Advanced Fractions'));
set({});
ok('and locked for a new student', !D.isSkillUnlocked('Advanced Fractions'));

console.log('\n== the unlock pass agrees ==\n');
set({ 'Fraction Operations': 'needs_review', 'Mixed Numbers': 'mastered' });
D.skillTreeData.skills[D.getTreeSkillName('Advanced Fractions')] = { state: 'locked' };
try { D.triggerDependentUnlocks(D.getTreeSkillName('Mixed Numbers')); } catch (e) {}
const st = D.skillTreeData.skills[D.getTreeSkillName('Advanced Fractions')].state;
ok('mastering the last prerequisite opens it even if another has faded', st !== 'locked', st);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
