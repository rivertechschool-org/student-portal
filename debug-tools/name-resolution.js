#!/usr/bin/env node
// WHICH ONE DID YOU MEAN?
//
// The roster has four students sharing one first name, and their last initials
// are B, T and W — three initials for four people, so one of those initials is
// worn by two of them. Three other first names are shared by a pair who cannot
// be told apart by initial at all, and one of those pairs differs only in the
// LETTER CASE of the stored surname.
//
// So "Clementine" must ask. "Clementine T" must still ask, because there are two.
// "Clementine B" must not ask, because there is only one. And none of it may
// ever quietly pick the first row and act on it — least of all for a write.
//
// This is the same lesson as debug-tools/attendance-matrix.js: the failures are
// a cross product (name form × sentence it sits in), so the test is a grid, not
// a handful of examples.
//
// THE ROSTER HERE IS INVENTED, AND HAS TO BE.
//
// This repo is public and GitHub Pages serves every file in it. Real student
// names are exactly what CLAUDE.md forbids committing, so the fixtures below
// reproduce the SHAPES measured on the real roster and none of the names:
//
//   four sharers, three distinct initials, one initial doubled
//   two sharers with the same initial
//   two sharers whose initials differ only by case
//   a name nobody else has
//
// Run: node debug-tools/name-resolution.js

const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(__dirname, '..', '..', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('name-resolution: could not locate portal/index.html'); process.exit(2); }
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
  return new Function(...args.split(',').map(s => s.trim()).filter(Boolean), src.slice(start + 1, i - 1));
}

const methods = ['_normalizeInput', '_resolvePronouns', '_isFollowUpCommand',
  '_extractEntities', '_parseTimeframe', '_rivenPastDate', '_rivenMonthIndex',
  '_rivenPointsForward', '_rivenForwardWindow', '_rivenMonthDayDates',
  '_rivenAttendanceQuestion',
  '_fuzzyFindStudent', '_rivenIsMyStudent', '_rivenOwnRank', '_calculateSimilarity',
  '_levenshteinDistance', '_matchIntent', '_matchSmalltalk', '_isAggregateQuery',
  '_rivenMatchClass', '_rivenBandFromText', '_rivenBandLabel', '_rivenClassIsOpen',
  '_rivenCanManageClass', '_preferOwnedClasses', '_isoDaysAgo',
  '_hasCommandVerb', '_hasCommandSignal', '_isCommonWordTypo', '_commonWords',
  '_segmentClauses', '_classifyClauseShape', '_rivenQuantifiesClasses',
  '_rivenFindExcluded', '_rivenGroupCanon', '_rivenMatchGroup','_rivenMatchGroupPair', '_rivenIgnoresAttendance',
  '_rivenParseClassSpec', '_rivenParseNewClassName', '_rivenParseClassRosterRef',
  '_rivenResolvedStudent', '_rivenNamesEachClass', '_rivenClassNamedBeyondCohort'];

const app = { _nlpContext: {} };
for (const name of methods) { const fn = extract(name); app[name] = function (...a) { return fn.apply(app, a); }; }

// The shapes, with invented names. See the header.
const ROSTER = [
  ['Marlowe', 'Brook'],       // the only B
  ['Marlowe', 'Tenley'],      // one of two Ts
  ['Marlowe', 'Thorne'],      // the other T
  ['Marlowe', 'Whitlock'],    // the only W
  ['Rowan', 'Pike'],          // two sharers, same initial
  ['Rowan', 'Prosser'],
  ['Wren', 'ashby'],          // initials differ only by CASE
  ['Wren', 'Ashford'],
  ['Tobias', 'Finch'],        // nobody else has this name
];
app._terminalAllStudents = ROSTER.map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l,
  rtc_balance: 100 + i, email: `${f.toLowerCase()}.${l.toLowerCase()}@x.com`,
  status: 'active', id: 'id' + i,
}));
app.userInfo = { profile: { user_type: 'admin' }, user: { id: 't1' } };
app._terminalAllClasses = [{ id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true }];
app._terminalAllGroups = [];

function resolve(input) {
  app._nlpContext = {};
  const normalized = app._normalizeInput(input);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, input);
  const w = entities.student;
  if (!w) return { kind: 'none' };
  if (w.ambiguous) {
    return { kind: 'ask', names: (w.matches || []).map(s => s.full_name).sort() };
  }
  return { kind: 'one', name: (w.student || w).full_name, score: w.score };
}

let pass = 0, fail = 0;
const fails = [];
const say = (r) => r.kind === 'one' ? r.name : r.kind === 'ask' ? `ask(${r.names.join(' | ')})` : '(nobody)';

// A name form, and what it must come back as.
function expectOne(sentence, who) {
  const r = resolve(sentence);
  if (r.kind === 'one' && r.name === who) { pass++; return; }
  fail++; fails.push({ sentence, want: who, got: say(r) });
}
function expectAsk(sentence, over) {
  const r = resolve(sentence);
  const want = [...over].sort();
  if (r.kind === 'ask' && JSON.stringify(r.names) === JSON.stringify(want)) { pass++; return; }
  fail++; fails.push({ sentence, want: `ask(${want.join(' | ')})`, got: say(r) });
}
// The safety property: never a silent pick.
function expectNotPicked(sentence) {
  const r = resolve(sentence);
  if (r.kind !== 'one') { pass++; return; }
  fail++; fails.push({ sentence, want: 'ask, or nobody — never a silent pick', got: say(r) });
}

const FOUR = ['Marlowe Brook', 'Marlowe Tenley', 'Marlowe Thorne', 'Marlowe Whitlock'];
const TWO_T = ['Marlowe Tenley', 'Marlowe Thorne'];
const ROWANS = ['Rowan Pike', 'Rowan Prosser'];
const WRENS = ['Wren Ashford', 'Wren ashby'];

// The sentence a name sits in must not change who it means. Every form below is
// run through all of these.
const CONTEXTS = [
  { c: (n) => n, what: 'bare' },
  { c: (n) => `show me ${n}`, what: 'a lookup' },
  { c: (n) => `was ${n} here yesterday`, what: 'an attendance question' },
  { c: (n) => `${n}s grades`, what: 'a possessive' },
  { c: (n) => `how is ${n} doing`, what: 'a briefing' },
];
// Writes get their own list, because the rule there is stricter: an ambiguous
// name must never reach the write at all.
const WRITES = [
  (n) => `give ${n} 5 rtc`,
  (n) => `mark ${n} absent`,
  (n) => `add a note about ${n} being late`,
];

console.log('== a shared first name always asks ==');
for (const { c, what } of CONTEXTS) expectAsk(c('marlowe'), FOUR);
console.log(`   (checked in ${CONTEXTS.length} contexts)`);

console.log('== a last initial narrows it ==');
for (const { c } of CONTEXTS) {
  expectOne(c('marlowe b'), 'Marlowe Brook');
  expectOne(c('marlowe w'), 'Marlowe Whitlock');
}

console.log('== an initial two of them share still asks ==');
for (const { c } of CONTEXTS) expectAsk(c('marlowe t'), TWO_T);

console.log('== more of the surname finishes the job ==');
expectOne('marlowe te', 'Marlowe Tenley');
expectOne('marlowe th', 'Marlowe Thorne');
expectOne('marlowe tenley', 'Marlowe Tenley');
expectOne('marlowe thorne', 'Marlowe Thorne');
expectOne('marlowe brook', 'Marlowe Brook');
expectOne('marlowe whitlock', 'Marlowe Whitlock');

console.log('== how people actually type an initial ==');
expectOne('marlowe B', 'Marlowe Brook');
expectOne('Marlowe B.', 'Marlowe Brook');
expectOne('MARLOWE B', 'Marlowe Brook');
expectOne('marlowe  b', 'Marlowe Brook');

console.log('== two sharers with the SAME initial ==');
for (const { c } of CONTEXTS) {
  expectAsk(c('rowan'), ROWANS);
  expectAsk(c('rowan p'), ROWANS);
}
expectOne('rowan pike', 'Rowan Pike');
expectOne('rowan prosser', 'Rowan Prosser');
expectOne('rowan pi', 'Rowan Pike');
expectOne('rowan pr', 'Rowan Prosser');

console.log('== an initial is an initial whatever its case in the database ==');
expectAsk('wren', WRENS);
expectAsk('wren a', WRENS);
expectAsk('wren A', WRENS);
expectOne('wren ashby', 'Wren ashby');
expectOne('wren ashford', 'Wren Ashford');

console.log('== a name nobody shares never asks ==');
for (const { c } of CONTEXTS) expectOne(c('tobias'), 'Tobias Finch');
expectOne('tobias f', 'Tobias Finch');
expectOne('tobias finch', 'Tobias Finch');

console.log('== typed in a hurry ==');
expectOne('marlow b', 'Marlowe Brook');
expectOne('marlowe brooke', 'Marlowe Brook');
expectOne('tobais', 'Tobias Finch');
expectAsk('marlowe', FOUR);

console.log('== NO WRITE EVER LANDS ON A GUESS ==');
// The one that matters. A read on the wrong student is a wasted question; a
// write on the wrong student is somebody else's record changed.
for (const w of WRITES) {
  expectNotPicked(w('marlowe'));
  expectNotPicked(w('marlowe t'));
  expectNotPicked(w('rowan'));
  expectNotPicked(w('rowan p'));
  expectNotPicked(w('wren a'));
}

console.log('== the list you are shown can be told apart ==');
{
  // A prompt reading "1. Marlowe T  2. Marlowe T" is not a choice. Whatever is
  // offered has to differ.
  for (const [q, over] of [['marlowe', FOUR], ['marlowe t', TWO_T], ['rowan p', ROWANS], ['wren a', WRENS]]) {
    const r = resolve(q);
    const labels = r.kind === 'ask' ? r.names : [];
    const uniq = new Set(labels);
    if (labels.length >= 2 && uniq.size === labels.length) pass++;
    else { fail++; fails.push({ sentence: `the prompt for "${q}"`, want: 'distinguishable options', got: JSON.stringify(labels) }); }
  }
}

console.log('== two people, one identical name ==');
{
  // Three pairs on the real roster share an IDENTICAL full name - an old
  // record and its replacement, one activated and one inactive. A picker that
  // hands back the NAME cannot tell them apart, so both rows resolved to
  // whichever came first and the choice it offered was not a choice.
  const twins = [
    { id: 'tw1', first_name: 'Juniper', last_name: 'Vale', full_name: 'Juniper Vale',
      email: 'juniper.vale@x.com', rtc_balance: 10, account_status: 'activated', status: 'active' },
    { id: 'tw2', first_name: 'Juniper', last_name: 'Vale', full_name: 'Juniper Vale',
      email: 'jvale@x.com', rtc_balance: 0, account_status: 'inactive', status: 'active' },
  ];
  const saved = app._terminalAllStudents;
  app._terminalAllStudents = [...saved, ...twins];

  // The dialog writes into the transcript, so give it just enough DOM.
  let written = '';
  global.document = { getElementById: () => ({ set innerHTML(v) { written += v; }, get innerHTML() { return written; } }) };
  app.escapeHtml = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  app.terminalPrint = () => {};
  app.terminalPrintError = () => {};
  app._showAmbiguityDialog = extract('_showAmbiguityDialog');
  app._showAmbiguityDialog.call(app, twins, 'juniper vale');

  const ids = [...written.matchAll(/_resolveAmbiguity\('([^']+)'/g)].map(m => m[1]);
  if (ids.length === 2 && ids[0] !== ids[1] && ids[0] === 'tw1' && ids[1] === 'tw2') pass++;
  else { fail++; fails.push({ sentence: 'the picker for two identical names', want: "two different ids ['tw1','tw2']", got: JSON.stringify(ids) }); }

  // With the names identical, the status is the only thing on the row that
  // tells them apart.
  if (/inactive/.test(written)) pass++;
  else { fail++; fails.push({ sentence: 'the picker row for the dead record', want: 'says inactive', got: 'no status shown' }); }

  // And picking one actually pins THAT one.
  for (const want of twins) {
    app._terminalPinnedStudent = want.id;
    const got = app._fuzzyFindStudent('juniper vale', 'juniper vale');
    if (got && got.student && got.student.id === want.id) pass++;
    else { fail++; fails.push({ sentence: `pinning ${want.id}`, want: want.id, got: got?.student?.id || '(none)' }); }
  }
  app._terminalPinnedStudent = null;
  app._terminalAllStudents = saved;
  delete global.document;
}

console.log('\n' + '-'.repeat(72));
if (fails.length) {
  console.log(`\n${fails.length} FAILING:\n`);
  for (const f of fails) console.log(`   "${f.sentence}"\n        want ${f.want}\n        got  ${f.got}`);
  console.log('');
}
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
