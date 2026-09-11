#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Riven PHRASEBOOK + COVERAGE-TELEMETRY harness.
//
// The phrasebook is the model-free replacement for the LLM tier's
// generalisation: when a teacher taps a recovery-ladder suggestion, the phrase
// SHAPE (entity names stripped) is recorded against the intent they chose, and
// after two confirmations it routes directly. It converges on one school's
// vocabulary using actual usage instead of embeddings.
//
// The load-bearing safety property asserted here: **only READ intents are ever
// learned.** A phrase that silently starts writing because it was tapped twice
// is not a tradeoff worth making, so ADD_NOTE and every mutation stay
// offered-and-tapped forever.
//
// Run:  node debug-tools/phrasebook.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = process.argv[2] || SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('phrasebook: could not locate portal/index.html'); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');

function bodyOf(name) {
  const re = new RegExp('\\n\\s+(?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src); if (!m) throw new Error('not found: ' + name);
  let p = src.indexOf('(', m.index), pd = 0;
  for (; p < src.length; p++) { if (src[p] === '(') pd++; else if (src[p] === ')') { pd--; if (!pd) { p++; break; } } }
  let i = src.indexOf('{', p), d = 0, s = i;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) { i++; break; } } }
  const sig = src.slice(m.index + 1, s).trim();
  return { args: sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')), body: src.slice(s + 1, i - 1) };
}
const mk = (n) => { const b = bodyOf(n); return new Function(...b.args.split(',').map(x => x.trim()).filter(Boolean), b.body); };

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const METHODS = ['_normalizeInput', '_resolvePronouns', '_extractEntities', '_parseTimeframe',
  '_fuzzyFindStudent', '_rivenIsMyStudent', '_rivenOwnRank', '_calculateSimilarity', '_levenshteinDistance', '_rivenMatchClass',
  // _extractEntities grew these after this harness was written, and a
  // missing one is a run-time death, not a failing assertion. The full
  // list is the transitive closure of its `this._x()` calls.
  '_rivenMatchGroup', '_rivenGroupCanon', '_rivenParseClassRosterRef', '_rivenParseNewClassName',
  '_preferOwnedClasses', '_isoDaysAgo', '_hasCommandVerb', '_hasCommandSignal', '_isCommonWordTypo',
  '_commonWords', '_segmentClauses', '_classifyClauseShape', '_semanticExampleBank',
  '_rivenContentTokens', '_rivenSuggestionTemplates', '_rivenStatsKey', '_rivenPhrasebookKey',
  '_rivenRecordOutcome', '_rivenPhraseShape', '_rivenLearnableIntent', '_rivenLearnPhrase',
  '_rivenPhrasebookLookup', '_rivenFlushPayload', '_isoDaysAgo'];
const app = { _nlpContext: {}, userInfo: { profile: { id: 'teacher-1', user_type: 'teacher' }, user: { id: 't1' } } };
for (const n of METHODS) { const f = mk(n); app[n] = function (...a) { return f.apply(app, a); }; }

app._terminalAllStudents = [['Jordan', 'Reed'], ['Mia', 'Wilson']].map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l, rtc_balance: 100 + i,
  email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i }));
app._terminalAllClasses = [{ id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true }];

const shapeOf = (input) => {
  const norm = app._normalizeInput(input);
  const resolved = app._resolvePronouns(norm);
  return app._rivenPhraseShape(resolved, app._extractEntities(resolved, input));
};

let pass = 0, fail = 0;
const check = (c, label) => { c ? (pass++, console.log('  ok   ' + label)) : (fail++, console.log('  FAIL ' + label)); };

console.log('\n== phrase SHAPE ignores which student it was about ==');
const a = shapeOf('has jordan been showing up lately');
const b = shapeOf('has mia been showing up lately');
check(a === b && a.length > 0, `same shape for two students (${JSON.stringify(a)})`);
check(shapeOf('what are jordans grades') !== a, 'a different question is a different shape');

console.log('\n== a read is learned after TWO confirmations, not one ==');
app._rivenLearnPhrase(a, 'VIEW_ATTENDANCE');
check(app._rivenPhrasebookLookup(a) === null, 'one tap does not yet route');
app._rivenLearnPhrase(a, 'VIEW_ATTENDANCE');
check(app._rivenPhrasebookLookup(a) === 'VIEW_ATTENDANCE', 'two taps routes directly');
check(app._rivenPhrasebookLookup(shapeOf('what are jordans grades')) === null, 'unrelated shape unaffected');

console.log('\n== WRITES are never learned, however many times they are tapped ==');
const obs = shapeOf('jordan keeps interrupting during lessons');
for (let i = 0; i < 5; i++) app._rivenLearnPhrase(obs, 'ADD_NOTE');
check(app._rivenPhrasebookLookup(obs) === null, 'ADD_NOTE never becomes automatic (tapped 5x)');
for (const w of ['ADD_RTC', 'SUBTRACT_RTC', 'MARK_ATTENDANCE', 'ANNOUNCE', 'CREATE_ASSIGNMENT', 'DELETE_CLASS']) {
  check(app._rivenLearnableIntent(w) === false, `${w} is not learnable`);
}
check(app._rivenLearnableIntent('VIEW_GRADES') === true, 'VIEW_GRADES is learnable');

console.log('\n== coverage telemetry counts and keeps the phrasings ==');
app._rivenRecordOutcome('routed', 'give jordan 5 rtc');
app._rivenRecordOutcome('routed', 'show jordan');
app._rivenRecordOutcome('miss', 'is jordan vibing today');
app._rivenRecordOutcome('weak', 'whats up with jordan');
const st = JSON.parse(localStorage.getItem(app._rivenStatsKey()));
check(st.routed === 2 && st.miss === 1 && st.weak === 1, `counts (routed ${st.routed}, miss ${st.miss}, weak ${st.weak})`);
check(st.misses.length === 2, 'the actual phrasings are kept, not just the count');
check(st.misses.some(m => m.s.includes('vibing')), 'a miss records what was said');
check(!st.misses.some(m => m.s.includes('give jordan 5 rtc')), 'a success is not recorded as a miss');

console.log('\n== usage histogram answers "what do we use Riven for" ==');
app._rivenRecordOutcome('routed', 'give jordan 5 rtc', 'ADD_RTC');
app._rivenRecordOutcome('routed', 'give mia 3 rtc', 'ADD_RTC');
app._rivenRecordOutcome('routed', 'show jordan grades', 'VIEW_GRADES');
app._rivenRecordOutcome('learned', 'has jordan been showing up', 'VIEW_ATTENDANCE');
app._rivenRecordOutcome('miss', 'is jordan vibing', null);
const st2 = JSON.parse(localStorage.getItem(app._rivenStatsKey()));
check(st2.byIntent.ADD_RTC === 2, `most-used intent tallied (ADD_RTC ${st2.byIntent.ADD_RTC})`);
check(st2.byIntent.VIEW_ATTENDANCE === 1, 'a learned phrase counts toward its intent');
check(!('null' in st2.byIntent) && !('undefined' in st2.byIntent), 'a miss adds no intent tally');
check(Object.values(st2.byIntent).every(v => typeof v === 'number'),
  'the histogram stores COUNTS only, never the sentences');

console.log('\n== THE FLUSH CANNOT CARRY A STUDENT NAME ==');
// The load-bearing privacy property. A miss is a teacher's utterance about a
// named child; in localStorage that's a scratch buffer on their laptop, but in
// a Postgres table it would be a searchable, retained log of what staff said
// about which students. Only counts and entity-stripped shapes may leave.
{
  const norm = app._normalizeInput('is jordan vibing today');
  const resolved = app._resolvePronouns(norm);
  const ent = app._extractEntities(resolved, 'is jordan vibing today');
  const shape = app._rivenPhraseShape(resolved, ent);
  check(!/jordan/i.test(shape), `the shape drops the student name (${JSON.stringify(shape)})`);

  // A buffer holding the RAW text, exactly as _rivenRecordOutcome stores it.
  const st = {
    routed: 3, learned: 1, weak: 1, miss: 2,
    byIntent: { ADD_RTC: 3, VIEW_ATTENDANCE: 1 },
    misses: [
      { t: Date.now(), k: 'miss', s: 'is jordan vibing today', shape },
      { t: Date.now(), k: 'weak', s: 'whats up with charlotte tebow', shape: 'whats' },
      { t: Date.now(), k: 'miss', s: 'mia wilson seems off', shape: null }, // no shape -> not sent
    ],
    since: Date.now(),
  };
  const rows = app._rivenFlushPayload(st);
  const blob = JSON.stringify(rows).toLowerCase();

  for (const name of ['jordan', 'charlotte', 'tebow', 'mia', 'wilson']) {
    check(!blob.includes(name), `flush payload contains no "${name}"`);
  }
  check(!blob.includes('vibing today'), 'flush payload contains no raw sentence');
  check(rows.every(r => r.p_shape === null || /^[a-z0-9_]+( [a-z0-9_]+)*$/.test(r.p_shape)),
    'every shape sent matches the column CHECK constraint');
  check(rows.every(r => r.p_shape === null || ['weak', 'miss'].includes(r.p_outcome)),
    'a shape is only ever attached to a gap row');
  check(!rows.some(r => r.p_shape === null && r.p_intent === null && r.p_outcome === 'miss' && r.p_count === 0),
    'no empty rows');
  check(rows.some(r => r.p_intent === 'ADD_RTC' && r.p_count === 3), 'intent tallies are sent');
  const missRow = rows.find(r => r.p_outcome === 'miss' && r.p_shape);
  check(!!missRow, 'a gap row with a shape is sent so the parser can be taught');
  // the third miss had shape:null and must be silently dropped, not sent raw
  check(!blob.includes('seems off'), 'a miss with no computed shape is dropped, never sent raw');
}

console.log('\n== nothing leaves the device ==');
check(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(bodyOf('_rivenRecordOutcome').body),
  '_rivenRecordOutcome makes no network call');
check(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(bodyOf('_rivenLearnPhrase').body),
  '_rivenLearnPhrase makes no network call');

console.log('\n' + '-'.repeat(60));
console.log(`${fail ? 'FAIL' : 'PASS'} — ${pass} checks, ${fail} failed`);
process.exit(fail ? 1 : 0);
