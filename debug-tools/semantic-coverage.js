#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Riven SEMANTIC-COVERAGE harness.
//
// The MiniLM example bank (`_semanticExampleBank`) is a written-down list of the
// phrasings the regex tier was missing — the whole reason the model tier exists.
// This measures how many of them the DETERMINISTIC tier now handles on its own.
//
// That number is the cost of dropping the LLM layers, and the progress bar for
// Phase 1 of doing so. Baseline when this harness was written: 152/279 (54.5%).
//
// Neither model tier can produce anything the regex tier can't already execute —
// tier 2 picks from the same intent set, and tier 3's output is re-parsed through
// _matchIntent and discarded unless it lands at >= 0.5 confidence. So closing
// this gap costs the LLM layers nothing in capability, only in phrasing reach.
//
// Run:  node debug-tools/semantic-coverage.js [--gaps]
// Exit: 0 always unless RIVEN_COVERAGE_MIN is set (then it gates on that %).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const ARG = process.argv.find(a => a.endsWith('.html'));
const SRC = ARG || SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('semantic-coverage: could not locate portal/index.html'); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');


function bodyOf(name) {
  const re = new RegExp('\\n\\s+(?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src); if (!m) throw new Error(name);
  let p = src.indexOf('(', m.index), pd = 0;
  for (; p < src.length; p++) { if (src[p] === '(') pd++; else if (src[p] === ')') { pd--; if (!pd) { p++; break; } } }
  let i = src.indexOf('{', p), d = 0, s = i;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) { i++; break; } } }
  const sig = src.slice(m.index + 1, s).trim();
  return { args: sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')), body: src.slice(s + 1, i - 1) };
}
const mk = (n) => { const b = bodyOf(n); return new Function(...b.args.split(',').map(x => x.trim()).filter(Boolean), b.body); };

const METHODS = ['_normalizeInput', '_resolvePronouns', '_isFollowUpCommand', '_extractEntities',
  '_parseTimeframe', '_fuzzyFindStudent', '_calculateSimilarity', '_levenshteinDistance',
  '_matchIntent', '_matchSmalltalk', '_isAggregateQuery', '_rivenMatchClass', '_rivenCanManageClass',
  '_rivenMatchGroup', '_rivenGroupCanon',
  '_preferOwnedClasses', '_isoDaysAgo', '_hasCommandVerb', '_hasCommandSignal', '_isCommonWordTypo',
  '_commonWords', '_segmentClauses', '_classifyClauseShape', '_semanticExampleBank'];
const app = { _nlpContext: {} };
for (const n of METHODS) { const f = mk(n); app[n] = function (...a) { return f.apply(app, a); }; }

// The bank's examples use these names; make them real students.
const roster = [['Jordan', 'Reed'], ['Charlotte', 'Tebow'], ['Eli', 'Morris'], ['Dylan', 'Price'],
  ['Evelyn', 'Hegelund'], ['Phoenix', 'Gray'], ['Noah', 'Williams'], ['Olivia', 'Brown'],
  ['Mia', 'Wilson'], ['Sam', 'Carter']];
app._terminalAllStudents = roster.map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l, rtc_balance: 100 + i,
  email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i }));
app.userInfo = { profile: { user_type: 'admin' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  { id: 'c2', name: 'Robotics', subject: 'Science', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  { id: 'c3', name: 'Chess', subject: 'Club', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
];

function route(input) {
  app._nlpContext = {};
  const small = app._matchSmalltalk(input);
  if (small && !small.remainder) return 'SMALLTALK';
  const text = small?.remainder || input;
  const norm = app._normalizeInput(text);
  const resolved = app._resolvePronouns(norm);
  const ent = app._extractEntities(resolved, text);
  const it = app._matchIntent(resolved, ent);
  if (!it) return null;
  const conf = it.confidence ?? it.conf ?? 0;
  if (conf < 0.5) return null;
  return it.lastResort ? it.intent + ' (lastResort)' : it.intent;
}

const bank = app._semanticExampleBank();
let total = 0, exact = 0;
const gaps = {};
for (const [intent, examples] of Object.entries(bank)) {
  for (const ex of examples) {
    total++;
    let got;
    try { got = route(ex); } catch (e) { got = 'ERROR:' + e.message; }
    if (got === intent) exact++;
    else (gaps[intent] = gaps[intent] || []).push([ex, got || 'no match']);
  }
}

console.log(`Semantic example bank: ${Object.keys(bank).length} intents, ${total} phrasings\n`);
console.log(`  already routed correctly by the REGEX tier : ${exact}  (${(exact / total * 100).toFixed(1)}%)`);
console.log(`  still needing the semantic tier            : ${total - exact}  (${((total - exact) / total * 100).toFixed(1)}%)\n`);

const ordered = Object.entries(gaps).sort((a, b) => b[1].length - a[1].length);
if (!process.argv.includes('--gaps')) {
  console.log('GAPS BY INTENT (pass --gaps for the individual phrasings):');
  for (const [intent, misses] of ordered) console.log(`  ${String(misses.length).padStart(3)}/${String(bank[intent].length).padEnd(3)}  ${intent}`);
  const min = parseFloat(process.env.RIVEN_COVERAGE_MIN || '0');
  const pct = exact / total * 100;
  if (min && pct < min) { console.log(`
FAIL — coverage ${pct.toFixed(1)}% is below RIVEN_COVERAGE_MIN=${min}`); process.exit(1); }
  process.exit(0);
}
console.log('GAPS BY INTENT (what a pure-parse Riven would have to absorb):');
for (const [intent, misses] of ordered) {
  const n = bank[intent].length;
  console.log(`\n  ${intent}  — ${misses.length}/${n} missed`);
  for (const [ex, got] of misses) console.log(`      ${JSON.stringify(ex)}\n         -> ${got}`);
}
