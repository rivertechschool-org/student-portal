#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Riven RECOVERY-LADDER harness.
//
// Without a model tier, a sentence the parser can't route must not dead-end.
// _rivenRankIntents scores candidate intents by content-token overlap against
// the SAME example bank the MiniLM tier embeds — lexical instead of cosine, so
// there is no download and the ranking is inspectable.
//
// This asserts the ladder puts the right thing near the top for phrasings the
// parser deliberately does NOT handle (notably bare observations, which a
// catch-all "named student + no verb -> note" rule would otherwise guess at).
//
// Run:  node debug-tools/recovery-ladder.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = process.argv[2] || SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('recovery-ladder: could not locate portal/index.html'); process.exit(2); }
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

const METHODS = ['_normalizeInput', '_resolvePronouns', '_extractEntities', '_parseTimeframe',
  '_fuzzyFindStudent', '_calculateSimilarity', '_levenshteinDistance', '_rivenMatchClass',
  '_rivenMatchGroup', '_rivenGroupCanon',
  '_preferOwnedClasses', '_isoDaysAgo', '_hasCommandVerb', '_hasCommandSignal', '_isCommonWordTypo',
  '_commonWords', '_segmentClauses', '_classifyClauseShape', '_isFollowUpCommand', '_isAggregateQuery',
  '_rivenCanManageClass', '_semanticExampleBank', '_rivenContentTokens', '_rivenRankIntents',
  '_rivenSuggestionTemplates'];
const app = { _nlpContext: {} };
for (const n of METHODS) { const f = mk(n); app[n] = function (...a) { return f.apply(app, a); }; }

const roster = [['Jordan', 'Reed'], ['Charlotte', 'Tebow'], ['Eli', 'Morris'], ['Jackson', 'Lee'], ['Mia', 'Wilson']];
app._terminalAllStudents = roster.map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l, rtc_balance: 100 + i,
  email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i }));
app.userInfo = { profile: { user_type: 'admin' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
];

function rank(input) {
  app._nlpContext = {};
  const norm = app._normalizeInput(input);
  const resolved = app._resolvePronouns(norm);
  const ent = app._extractEntities(resolved, input);
  return { ranked: app._rivenRankIntents(resolved, ent), norm: resolved, ent };
}

let pass = 0, fail = 0;
const check = (c, label) => { c ? (pass++, console.log('  ok   ' + label)) : (fail++, console.log('  FAIL ' + label)); };

console.log('\n== ranking puts the plausible intent in the top 3 ==');
const CASES = [
  ['has jordan been showing up lately', 'VIEW_ATTENDANCE'],
  ['anything written down about jordan', 'VIEW_NOTES'],
  ['how do i reach jordans parents', 'VIEW_CONTACT'],
  ['what is jordan signed up for', 'VIEW_ENROLLMENTS'],
  ['how is jordan doing academically', 'VIEW_GRADES'],
  ['what happened with jordans rtc lately', 'VIEW_HISTORY'],
];
for (const [input, want] of CASES) {
  const { ranked } = rank(input);
  const top3 = ranked.slice(0, 3).map(r => r.intent);
  check(top3.includes(want), `${JSON.stringify(input)} -> [${top3.join(', ') || 'none'}] contains ${want}`);
}

console.log('\n== a bare OBSERVATION is offered as a note, never guessed ==');
// These are the 8 phrasings phase 1 deliberately left alone: a catch-all
// "named student + no command verb -> note" rule is the classic front-door trap.
const OBSERVED = [
  'jordan just helped a classmate without being asked',
  'jordan is really stepping up this week',
  'charlotte keeps interrupting during lessons',
  'jackson showed real leadership today',
];
for (const input of OBSERVED) {
  const { norm } = rank(input);
  const observed = !app._hasCommandVerb(norm) && norm.trim().split(/\s+/).length >= 4;
  check(observed, `${JSON.stringify(input)} reads as an observation (no command verb)`);
}

console.log('\n== a real COMMAND is never treated as an observation ==');
for (const input of ['give jordan 5 rtc', 'mark charlotte present in math', 'note for eli: late again']) {
  const { norm } = rank(input);
  check(app._hasCommandVerb(norm), `${JSON.stringify(input)} has a command verb`);
}

console.log('\n== every suggestion is issuable as a real command ==');
const templates = app._rivenSuggestionTemplates();
let bad = [];
for (const [intent, t] of Object.entries(templates)) {
  const cmd = t.cmd('Jordan Reed', 'Math', 'was great today');
  if (typeof cmd !== 'string' || cmd.length < 3 || /undefined|null/.test(cmd)) bad.push(intent + ' -> ' + cmd);
}
check(!bad.length, `all ${Object.keys(templates).length} templates render a command (${bad.join('; ') || 'none bad'})`);

console.log('\n' + '-'.repeat(60));
console.log(`${fail ? 'FAIL' : 'PASS'} — ${pass} checks, ${fail} failed`);
process.exit(fail ? 1 : 0);
