#!/usr/bin/env node
// Routing probe for the teacher suggestion box.
//
// Two things have to hold at once and they pull against each other:
//   1. Feedback about the PORTAL reaches SUBMIT_SUGGESTION / VIEW_SUGGESTIONS.
//   2. Nothing else moves. "note that the gradebook helped Eli" is still a
//      note; "is the portal broken?" is still a question, not a filed ticket.
//
// Like nlp-stress.js, this extracts the REAL methods out of portal/index.html
// by brace matching, so the harness cannot drift from shipped code.
const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(__dirname, '..', '..', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('suggestion-routing: could not locate portal/index.html'); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');

function extract(name) {
  const re = new RegExp('\\n    ' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  let i = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0; const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = src.slice(m.index + 1, start).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  // eslint-disable-next-line no-new-func
  return new Function(...args.split(',').map(s => s.trim()).filter(Boolean), src.slice(start + 1, i - 1));
}

const methods = ['_normalizeInput', '_resolvePronouns', '_isFollowUpCommand',
  '_extractEntities', '_parseTimeframe', '_fuzzyFindStudent', '_calculateSimilarity',
  '_levenshteinDistance', '_matchIntent', '_matchSmalltalk', '_isAggregateQuery',
  '_rivenMatchClass', '_rivenCanManageClass', '_preferOwnedClasses', '_isoDaysAgo',
  '_hasCommandVerb', '_hasCommandSignal', '_isCommonWordTypo', '_commonWords',
  '_segmentClauses', '_classifyClauseShape',
  '_rivenExtractSuggestionText', '_rivenSuggestionType', '_rivenSuggestionPriority'];

const app = { _nlpContext: {} };
for (const name of methods) { const fn = extract(name); app[name] = function (...a) { return fn.apply(app, a); }; }

app._terminalAllStudents = [
  ['Charlotte', 'Tebow'], ['Eli', 'Morris'], ['Noah', 'Williams'], ['Olivia', 'Brown'],
].map(([f, l], i) => ({ full_name: `${f} ${l}`, first_name: f, last_name: l,
  rtc_balance: 100 + i, email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i }));
app.userInfo = { profile: { user_type: 'teacher' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
];

function route(input) {
  const small = app._matchSmalltalk(input);
  if (small) {
    if (small.remainder) return route(small.remainder);
    return 'SMALLTALK:' + small.key;
  }
  const normalized = app._normalizeInput(input);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, input);
  const intent = app._matchIntent(resolved, entities);
  return intent ? intent.intent : 'NONE';
}

let pass = 0, fail = 0;
const failures = [];
function check(label, actual, expected) {
  const ok = expected instanceof RegExp ? expected.test(actual) : actual === expected;
  if (ok) { pass++; console.log(`   ok  ${label}`); }
  else { fail++; failures.push(`${label}\n        got ${JSON.stringify(actual)}, expected ${expected}`); console.log(`   FAIL ${label} -> got ${JSON.stringify(actual)}`); }
}

console.log('\n== routes INTO the suggestion box ==');
[
  ['suggestion: let me sort the roster by grade', 'SUBMIT_SUGGESTION'],
  ['bug: attendance will not save after switching quarters', 'SUBMIT_SUGGESTION'],
  ['add a suggestion for the portal', 'SUBMIT_SUGGESTION'],
  ['submit a feature request to export grades as csv', 'SUBMIT_SUGGESTION'],
  ['file a bug report the transcript page renders blank', 'SUBMIT_SUGGESTION'],
  ['i have a suggestion, let me bulk mark attendance', 'SUBMIT_SUGGESTION'],
  ['report a bug the gradebook drops my last entry', 'SUBMIT_SUGGESTION'],
  ['the gradebook keeps freezing when i scroll', 'SUBMIT_SUGGESTION'],
].forEach(([q, want]) => check(`"${q}"`, route(q), want));

console.log('\n== routes to the suggestion LIST ==');
[
  ['show me my suggestions', 'VIEW_SUGGESTIONS'],
  ['list the suggestions', 'VIEW_SUGGESTIONS'],
  ['my suggestions', 'VIEW_SUGGESTIONS'],
  ['what suggestions are still open', 'VIEW_SUGGESTIONS'],
].forEach(([q, want]) => check(`"${q}"`, route(q), want));

console.log('\n== nothing else moves ==');
[
  // an explicit note command still wins outright
  ['note for eli: forgot homework again', 'ADD_NOTE'],
  ['add a note for charlotte: great presentation', 'ADD_NOTE'],
  ['log that noah was disruptive', 'ADD_NOTE'],
  // RTC, attendance, reads are untouched
  ['give charlotte 2 rtc', 'ADD_RTC'],
  ['noah is here', 'MARK_ATTENDANCE'],
  ['how much gold does charlotte have', 'VIEW_STUDENT'],
  ['show me the shop', 'VIEW_SHOP'],
  // a question about the portal is a question, not a filed ticket
  ['is the portal broken?', /^(?!SUBMIT_SUGGESTION$)/],
  ['what do you suggest i do about eli', /^(?!SUBMIT_SUGGESTION$)/],
  // Currency and amounts knock SUBMIT_SUGGESTION out of the bidding on
  // purpose — never risk swallowing an RTC command. The cost is that an
  // RTC-flavoured bug report falls through to a harmless READ, not a write.
  ['bug: charlotte rtc balance is wrong', /^(VIEW_|SMALLTALK|UNKNOWN_ACTION|NONE)/],
  ['give charlotte 5 rtc', 'ADD_RTC'],
].forEach(([q, want]) => check(`"${q}"`, route(q), want));

console.log('\n== body / type / priority extraction ==');
const body = [
  ['suggestion: let me sort the roster by grade', 'let me sort the roster by grade'],
  ['add a suggestion we should be able to export grades', 'we should be able to export grades'],
  ['file a bug report "the transcript page renders blank"', 'the transcript page renders blank'],
  ['the gradebook keeps freezing when i scroll', 'the gradebook keeps freezing when i scroll'],
];
body.forEach(([q, want]) => check(`body of "${q}"`, app._rivenExtractSuggestionText(q), want));

[
  ['bug: attendance will not save', 'bug'],
  ['suggestion: it would be great to have a filter', 'feature'],
  ['suggestion: the roster page is confusing and hard to read', 'improvement'],
  ['suggestion: the fractions lesson needs a new answer key', 'content'],
  ['suggestion: more purple', 'other'],
].forEach(([q, want]) => check(`type of "${q}"`, app._rivenSuggestionType(q), want));

[
  ['bug: this is blocking my class right now', 'urgent'],
  ['bug: this keeps happening every day', 'high'],
  ['suggestion: minor nitpick, whenever you get to it', 'low'],
  ['suggestion: let me sort the roster', 'normal'],
].forEach(([q, want]) => check(`priority of "${q}"`, app._rivenSuggestionPriority(q), want));

console.log(`\n${pass} pass, ${fail} fail`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ' + f)); }
process.exit(fail ? 1 : 0);
