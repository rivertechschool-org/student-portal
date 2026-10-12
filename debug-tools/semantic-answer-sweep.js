// Semantic answer sweep for games/math-dojo.html.
//
// A right answer written another right way must stay right. Two families of
// rewriting, applied to EVERY generated question's own answer:
//
//   FLIP   any accepted answer with "=" in it is also accepted with each
//          equation's sides swapped: "y = 9" -> "9 = y", "x = 1 or x = 5" ->
//          "1 = x or 5 = x".
//   ROOTS  an answer that is a set of solutions ("x = 1 or x = 5", "x = 1, 5",
//          "x = ±3", "{-2, 4}") is accepted in every spelling of the same set,
//          in either order: "x = 5 or x = 1", "x = 1, x = 5", "x = 1 and x = 5",
//          "x = 1 or 5", "1 = x or 5 = x", "x = ±3" when the roots are ±c.
//
// And the wrong ones stay wrong (MUSTFAIL): one root of two, a sign-flipped
// root, an extra root.
//
// Usage: node debug-tools/semantic-answer-sweep.js      (RUNS=40 by default)
// Exits non-zero on any rejected rewrite or accepted wrong answer.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const __dirname2 = path.join(__dirname, '..', 'tests');
const html = fs.readFileSync(path.join(__dirname2, '..', 'games', 'math-dojo.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const RUNS = Number(process.env.RUNS || 60);

// Same accept-anything page as dojo-step-hints.js: the script touches the DOM
// while loading and none of it matters to the generators.
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

const probe = '\n;globalThis.__dojo = { AnswerInterpreter, generators, typedAnswerIsCorrect, shouldTypeAnswer };';
const loadErrors = [];
scripts.forEach((code, i) => {
  try { vm.runInContext(code + (i === scripts.length - 1 ? probe : ''), sandbox, { filename: `math-dojo#${i}` }); }
  catch (e) { loadErrors.push(`script ${i}: ${e.message}`); }
});
if (!sandbox.__dojo) { try { vm.runInContext(probe, sandbox); } catch (e) { loadErrors.push('probe: ' + e.message); } }
if (!sandbox.__dojo) { console.error('Could not load the Math Dojo script:\n  ' + loadErrors.join('\n  ')); process.exit(2); }
const AI = sandbox.__dojo.AnswerInterpreter;

const { generators, typedAnswerIsCorrect } = sandbox.__dojo;
const RUNS_ = Number(process.env.RUNS || 40);

// ---- reading an answer as a set of solutions -------------------------------
const MINUS = /[−–]/g;
const clean = s => String(s).replace(MINUS, '-').trim();
// "x = 1 or x = 5" / "x = 1, 5" / "x = ±3" / "{-2, 4}" / "-1 and 1" -> { v, roots }
function asRootSet(ans) {
  let t = clean(ans);
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return null;   // 1,350 is a number
  if (/[<>≤≥≠]|\(.*,.*\)|\[|\]|[a-z]{3,}/i.test(t.replace(/\b(or|and)\b/g, ''))) return null;
  let braced = false;
  if (/^\{.*\}$/.test(t)) { t = t.slice(1, -1); braced = true; }
  const parts = t.split(/\s*(?:,|;|\bor\b|\band\b)\s*/).filter(Boolean);
  let v = null; const roots = [];
  for (const p of parts) {
    const m = p.match(/^([a-z])\s*=\s*(.+)$/i);
    let val = p;
    if (m) { if (v && v !== m[1]) return null; v = m[1]; val = m[2]; }
    if (/=/.test(val)) return null;
    const pm = val.match(/^±\s*(.+)$/);
    if (pm) { roots.push(pm[1], '-' + pm[1]); continue; }
    if (!/^-?[\d./√π()+\-\s]+$/.test(val) && !/^-?\d/.test(val)) return null;
    roots.push(val.replace(/\s+/g, ''));
  }
  if (roots.length < 2 && !(roots.length === 1 && v)) return null;
  if (roots.length < 2) return null;
  return { v: v || 'x', roots, braced };
}
const neg = r => r.startsWith('-') ? r.slice(1) : '-' + r;
function spellings({ v, roots }) {
  const out = new Set();
  const orders = [roots, [...roots].reverse()];
  for (const rs of orders) {
    out.add(rs.map(r => `${v} = ${r}`).join(' or '));
    out.add(rs.map(r => `${v} = ${r}`).join(', '));
    out.add(rs.map(r => `${v} = ${r}`).join(' and '));
    out.add(`${v} = ` + rs.join(' or '));
    out.add(`${v} = ` + rs.join(', '));
    out.add(rs.map(r => `${r} = ${v}`).join(' or '));
    out.add(rs.map(r => `${r} = ${v}`).join(', '));
    out.add('{' + rs.join(', ') + '}');
  }
  if (roots.length === 2 && neg(roots[0]) === roots[1]) {
    const c = roots[0].replace(/^-/, '');
    out.add(`${v} = ±${c}`); out.add(`±${c} = ${v}`); out.add(`${v} = +/-${c}`);
  }
  return [...out];
}
// Swap the sides of every "a = b" item in an answer.
// Prose is left alone: "split into two integrals at x = c" is a sentence, not
// an equation to swap. Function names and subscripts are not prose.
const prose = t => /[A-Za-z]{3,}/.test(t.replace(/\b(sin|cos|tan|sqrt|ln|log|lim|abs|or|and)\b/gi, ''));
function flip(ans) {
  const t = clean(ans);
  if (prose(t)) return null;
  const items = sandbox.__dojo.AnswerInterpreter.splitItems(t);   // brackets respected: hf(xₙ, yₙ) is one item
  let flipped = 0;
  const res = items.map(it => {
    const m = it.match(/^\s*([^=]+?)\s*=\s*([^=]+?)\s*$/);
    if (!m) return it;
    flipped++;
    return `${m[2]} = ${m[1]}`;
  }).join('');
  return flipped ? res : null;
}

const problems = new Map();   // key -> example
const note = (kind, skill, q, typed) => {
  const k = kind + ' | ' + skill;
  if (!problems.has(k)) problems.set(k, { n: 0, ex: `"${typed}" for "${q.answer}"   Q: ${String(q.question).slice(0, 90)}` });
  problems.get(k).n++;
};
let checked = 0, questions = 0; const tally = { flip: 0, restated: 0, roots: 0, mustfail: 0 };
for (const [tier, skills] of Object.entries(generators)) {
  for (const [skill, gen] of Object.entries(skills)) {
    if (typeof gen !== 'function') continue;
    for (let i = 0; i < RUNS_; i++) {
      let q; try { q = gen(); } catch (e) { break; }
      if (!q || q.answer == null || typeof q.validate === 'function') continue;
      questions++;
      const accepted = [String(q.answer), ...(q.acceptableAnswers || []).map(String)];
      // FLIP: every accepted form, sides swapped.
      for (const a of accepted) {
        if (!/=/.test(a) || /[<>≤≥≠]|==/.test(a)) continue;
        const f = flip(a); if (!f || f === a) continue;
        checked++; tally.flip++;
        if (!typedAnswerIsCorrect(f, q)) note('FLIP rejected', `T${tier} ${skill}`, q, f);
      }
      // A bare-number answer restated with the letter the question solves for.
      const num = clean(q.answer);
      const letter = (String(q.question).match(/\b(?:solve for|find|value of|what is)\s+([a-z])\b/i) || [])[1];
      if (letter && /^-?\d+(\.\d+)?$/.test(num) && typedAnswerIsCorrect(`${letter} = ${num}`, q)) {
        checked++; tally.restated++;
        if (!typedAnswerIsCorrect(`${num} = ${letter}`, q)) note('FLIP of restated number rejected', `T${tier} ${skill}`, q, `${num} = ${letter}`);
      }
      // ROOTS.
      // Only solution sets: "between 5 and 6", an ordering, or a set in set
      // theory is not a list of roots, and spelling it "x = 5 or x = 6" is wrong.
      const solving = /\b(solve|roots?|zeros?|solutions?|x-intercepts?)\b/i.test(String(q.question))
        && !/\bwhich\b|formula/i.test(String(q.question));
      const rs = solving ? asRootSet(q.answer) : null;
      if (rs) {
        for (const s of spellings(rs)) {
          checked++; tally.roots++;
          if (!typedAnswerIsCorrect(s, q)) note('ROOTS spelling rejected', `T${tier} ${skill} :: ${s.replace(/-?[\d.]+(\/\d+)?|[√π]\S*/g, 'N')}`, q, s);
        }
        // MUSTFAIL
        const wrongs = [`${rs.v} = ${rs.roots[0]}`,
                        rs.roots.map((r, j) => `${rs.v} = ${j ? r : (/^-?0$/.test(r) || neg(r) === rs.roots[1] ? r + '1' : neg(r))}`).join(' or '),
                        [...rs.roots, '99'].map(r => `${rs.v} = ${r}`).join(' or ')];
        for (const w of wrongs) {
          if (new Set(rs.roots).size === 1) continue;
          checked++; tally.mustfail++;
          if (typedAnswerIsCorrect(w, q)) note('MUSTFAIL accepted', `T${tier} ${skill}`, q, w);
        }
      }
    }
  }
}
const rows = [...problems.entries()].sort((a, b) => b[1].n - a[1].n);
for (const [k, v] of rows) console.log(`${String(v.n).padStart(5)}  ${k}\n        ${v.ex}`);
console.log(`
${questions} questions, ${checked} rewrites checked (${Object.entries(tally).map(([k, v]) => k + " " + v).join(", ")}), ${rows.length} problem groups`);
process.exit(rows.length ? 1 : 0);
