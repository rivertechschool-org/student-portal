// Math Dojo: questions a student can read two ways.
//
// 2026-10-22: after the Calculator Fluency "4 + 3 x² =" report, a sweep of every
// generator and lesson turned up the same kind of problem elsewhere. Each check below is
// one CLASS of it, run over every generator, so the next one is caught, not just the
// examples that were fixed:
//   - a second option equal to the answer in value ("9.420" beside "9.42"), unless the
//     question asks for a form ("simplest form", "lowest terms", "precision" ...)
//   - a definite integral whose lower limit is a plain digit: "∫3^5 3x²" reads as 3⁵
//   - a fraction coefficient without brackets: "7/2x^2" reads as 7/(2x²)
//   - d/dx(...)^n: the derivative closes before the power
//   - "x − 4/(x + 4)": read as (x − 4)/(x + 4)
//   - log bases in brackets, "log₍5₎(25)", which read as log(5) times 25
//   - floating-point junk such as 0.8699999999999999 in what the student sees
// Runs the real page script.
//
// Run: node tests/dojo-ambiguity.test.js
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
const probe = '\n;globalThis.__dojo = { generators };';
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

const qs = [];
for (const tier of Object.keys(D.generators)) for (const [skill, gen] of Object.entries(D.generators[tier] || {})) {
  if (typeof gen !== 'function') continue;
  for (let i = 0; i < 150; i++) { let q; try { q = gen(); } catch (e) { continue; } if (q && q.question) qs.push({ skill, q }); }
}
ok('the generators ran', qs.length > 20000, String(qs.length));
const seen = q => [q.question, ...(Array.isArray(q.options) ? q.options : [])].map(String).join(' | ');
const first = (list, f) => { const h = list.find(f); return h ? `[${h.skill}] ${seen(h.q).slice(0, 200)} => ${h.q.answer}` : ''; };

const num = s => { s = String(s).trim().replace(/,/g, '').replace(/−/g, '-'); let m;
  if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
  if ((m = s.match(/^(-?\d+)\s+(\d+)\/(\d+)$/))) return (+m[1] < 0 ? -1 : 1) * (Math.abs(+m[1]) + m[2] / m[3]);
  if ((m = s.match(/^(-?\d+)\/(\d+)$/))) return m[1] / m[2];
  return null; };
const FORM = /simplest|lowest|simplif|precision|sig|form|reduce|exact|decimal|fraction|mixed|improper|written|write/i;
const twoRight = h => { const q = h.q; if (!Array.isArray(q.options) || FORM.test(q.question)) return false;
  const a = num(q.answer); if (a === null) return false;
  return q.options.some(o => String(o) !== String(q.answer) && num(o) !== null && Math.abs(num(o) - a) < 1e-9); };
ok('no second option equals the answer in value', !qs.some(twoRight), first(qs, twoRight));

const checks = [
  ['no definite integral with a plain-digit lower limit', /∫\d+\^/],
  ['no unbracketed fraction coefficient (7/2x^2)', /(^|[^\d(\/])\d+\/\d+x/],
  ['no d/dx(...)^n', /d\/dx\([^()]*\)\^/],
  ['no "x − 4/(x + 4)" (a fraction after x ±)', /\bx [−+-] \d+\/\(?x/],
  ['no bracketed log base', /₍|₎/],
];
for (const [label, re] of checks) { const bad = h => re.test(seen(h.q)); ok(label, !qs.some(bad), first(qs, bad)); }
// Float junk: in the options, and in the question unless it quotes a calculator display
// ("Her calculator shows 10.77777778" is the point of that question).
// 0.8699999999999999 has 16 decimals; 0.0000000015 is a real answer, and "0.123456789101112..." means to go on
const junk = /\.\d{13,}(?![\d.…])/;
const floaty = h => (Array.isArray(h.q.options) ? h.q.options : []).some(o => junk.test(String(o)))
  || (!/calculator/i.test(h.q.question) && junk.test(h.q.question));
ok('no floating-point junk', !qs.some(floaty), first(qs, floaty));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
