// Math Dojo, skills from "Separable Differential Equations" to the end of the
// file (business, trades, CS & game-dev, STEM branches): practice must ask
// mathematics, not recall of a product's or an algorithm's name.
//
//   - 3D Coordinates, axis_convention: "In Unity / Godot / Minecraft / Unreal /
//     Blender, which axis points up?" was recall of a program's convention.
//     Removed; the textbook z-up convention, right/left-handedness, and the
//     computed "how high is the lamp in a y-up / z-up world" question stay.
//     The lesson no longer names the programs either.
//   - Algorithmic Complexity, loop_bigO: "merge sort a list", "binary search",
//     "read the item at position k of an array" named an algorithm with nothing
//     to reason from. Each now describes its steps, so the Big-O follows from
//     counting them.
//
// Run: node tests/dojo-nonmath-d.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// Accept-anything page (as in debug-tools/semantic-answer-sweep.js): the script
// touches the DOM while loading and none of it matters to the generators.
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
const probe = '\n;globalThis.__dojo = { generators, lessons };';
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); } catch (e) {}
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) {} }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script'); process.exit(2); }
const { generators, lessons } = sandbox.__dojo;

const find = (tbl, name) => { for (const t in tbl) if (tbl[t] && tbl[t][name]) return tbl[t][name]; return null; };
const sample = (name, n) => {
  const g = find(generators, name), out = [];
  for (let i = 0; i < n; i++) { const q = g(); if (q) out.push(q); }
  return out;
};
const lessonText = name => { const L = find(lessons, name); return JSON.stringify(typeof L === 'function' ? L() : L); };

const PRODUCTS = /\b(Unity|Godot|Minecraft|Unreal|Blender|OpenGL)\b/;

// ---- 3D Coordinates --------------------------------------------------------
{
  const qs = sample('3D Coordinates', 4000);
  const axis = qs.filter(q => q.subType === 'axis_convention');
  ok('axis_convention is still drawn', axis.length > 200, String(axis.length));
  ok('no question names a program or engine',
    qs.every(q => !PRODUCTS.test(q.question) && !PRODUCTS.test(String(q.explanation || ''))),
    (qs.find(q => PRODUCTS.test(q.question) || PRODUCTS.test(String(q.explanation || ''))) || {}).question);
  const shapes = new Set(axis.map(q => q.question.replace(/-?\d+/g, '#')));
  ok('axis_convention keeps at least 3 question shapes', shapes.size >= 3, [...shapes].join(' | '));
  ok('the computed y-up / z-up height question is still asked',
    axis.some(q => /How high above the ground/.test(q.question)));
  ok('the computed height answers are the up coordinate', axis.filter(q => /How high above the ground/.test(q.question)).every(q => {
    const m = /is (y|z)-up .*\((-?\d+), (-?\d+), (-?\d+)\)/.exec(q.question);
    return m && String(q.answer) === (m[1] === 'z' ? m[4] : m[3]);
  }));
  ok('the 3D Coordinates lesson names no program or engine', !PRODUCTS.test(lessonText('3D Coordinates')));
}

// ---- Algorithmic Complexity ------------------------------------------------
{
  const qs = sample('Algorithmic Complexity', 4000).filter(q => q.subType === 'loop_bigO');
  ok('loop_bigO is still drawn', qs.length > 200, String(qs.length));
  const bare = /merge sort a list|binary search for a value|read the item at position k of an array/;
  ok('no Big-O question just names an algorithm', qs.every(q => !bare.test(q.question)),
    (qs.find(q => bare.test(q.question)) || {}).question);
  const described = [
    [/throwing away the half/, 'O(log n)'],
    [/splitting the list in half, again and again/, 'O(n log n)'],
    [/jump straight to position k/, 'O(1)'],
  ];
  for (const [re, a] of described) {
    const hit = qs.filter(q => re.test(q.question));
    ok(`described algorithm ${re} is asked and answers ${a}`, hit.length > 0 && hit.every(q => q.answer === a),
      hit.length ? hit[0].answer : 'never drawn');
  }
  ok('the lesson teaches algorithms by their steps', /Reading a described algorithm/.test(lessonText('Algorithmic Complexity')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
