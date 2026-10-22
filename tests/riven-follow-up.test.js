// "and <name>" follow-ups and several students, for EVERY action about a student.
//
// Asked for 2026-10-22, after "<two siblings> will be picked up at 11:15" and
// "And <name>" worked for the late/early plan: "these should be usable for any
// action, if we name multiple students and do a follow up."
//
//   * Follow-ups: right after a command about students, a line that is only a
//     lead-in plus names ("and Noah", "Noah too", "same for Noah", "what
//     about Noah") runs that command again for them, with everything else the
//     first sentence settled (amount, class, time, day, note text).
//   * Several students: an action about one student, said about several, runs
//     once for each - with one confirmation and one undo for the sentence.
//
// Routing runs the real parser and matcher on invented students; the batch is
// the real _rivenForEachStudent / _requestConfirmation / _pushUndo with a stub
// executor in place of the database.
//
// Run: node tests/riven-follow-up.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

const FIXED = new Date('2026-10-01T10:00:00');
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED.getTime()); else super(...a); }
  static now() { return FIXED.getTime(); }
};

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
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
  const Ctor = /^async\s/.test(sig) ? (async () => {}).constructor : Function;
  return new Ctor(...args.split(',').map(s => s.trim()).filter(Boolean), src.slice(start + 1, i - 1));
}
// absence-command-matrix's call graph, plus the follow-up and batch helpers.
const methods = ['_normalizeInput', '_resolvePronouns', '_isFollowUpCommand',
  '_extractEntities', '_parseTimeframe', '_rivenPastDate', '_rivenMonthIndex',
  '_rivenPointsForward', '_rivenForwardWindow', '_rivenMonthDayDates',
  '_rivenAttendanceQuestion',
  '_fuzzyFindStudent', '_rivenIsMyStudent', '_rivenOwnRank', '_calculateSimilarity',
  '_levenshteinDistance', '_matchIntent', '_rivenIsFutureAbsenceCommand',
  '_rivenIsLateEarlyCommand', '_rivenLateEarlyPlan', '_rivenClockTime', '_rivenLateEarlyDate',
  '_matchSmalltalk', '_isAggregateQuery',
  '_rivenMatchClass', '_rivenBandFromText', '_rivenBandLabel', '_rivenClassIsOpen',
  '_rivenCanManageClass', '_preferOwnedClasses', '_isoDaysAgo',
  '_hasCommandVerb', '_hasCommandSignal', '_isCommonWordTypo', '_commonWords',
  '_segmentClauses', '_classifyClauseShape', '_rivenQuantifiesClasses', '_rivenFindExcluded',
  '_rivenGroupCanon', '_rivenMatchGroup', '_rivenMatchGroupPair', '_rivenIgnoresAttendance',
  '_rivenParseClassSpec', '_rivenParseNewClassName', '_rivenParseClassRosterRef',
  '_rivenResolvedStudent', '_rivenNamesEachClass', '_rivenClassNamedBeyondCohort',
  '_rivenResolveAbsenceSpans', '_rivenPhraseToDate', '_rivenAbsenceDayNumbers',
  '_rivenDayCodes', '_rivenCollapseSpans', '_rivenParseWeekdays',
  '_rivenNamedPeople', '_rivenFollowUpPeople', '_rivenTakeFollowUp',
  '_rivenNoteLastCommand', '_rivenPerStudentIntents', '_rivenManyStudentIntents',
  '_rivenForEachStudent', '_rivenPushUndoGroup', '_requestConfirmation', '_pushUndo'];
const app = { _nlpContext: {} };
for (const name of methods) {
  let fn;
  try { fn = extract(name); } catch (e) { continue; }
  app[name] = function (...a) { return fn.apply(app, a); };
}
// Invented students. Hazel Quint sorts ahead of Hazel Brennick on purpose:
// "Hazel and Otto Brennick" must still mean Otto's sister.
const roster = [['Willow', 'Fenmore'], ['Clementine', 'Vasquez'], ['Noah', 'Williams'], ['Josephine', 'Wexler'],
  ['Hazel', 'Quint'], ['Hazel', 'Brennick'], ['Otto', 'Brennick']];
app._terminalAllStudents = roster.map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l,
  rtc_balance: 100 + i, email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i,
}));
app.userInfo = { profile: { user_type: 'admin' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
];
app._terminalAllGroups = [{ id: 'g1', name: 'Lower Middle School', studentIds: ['id0', 'id1'] }];
app._showRivenMessage = () => {};
app.terminalPrint = () => {};
app._persistRivenUndo = () => {};

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};
// The main flow's order: a follow-up of the last command first, else the
// matcher; then the command is remembered for the next line.
function say(input) {
  app._nlpContext = {};
  const normalized = app._normalizeInput(input);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, input);
  entities._rawInput = input;
  const intent = app._rivenTakeFollowUp(entities) || app._matchIntent(resolved, entities);
  app._rivenNoteLastCommand(intent, entities);
  return { intent: intent && (intent.intent || intent), entities,
           people: app._rivenNamedPeople(entities).map(p => p.full_name) };
}
const fresh = () => { app._rivenLastCommand = null; app._pendingAction = null; };
const same = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());

console.log('\n== a follow-up repeats the last action, whatever it was ==\n');
const FOLLOW = [
  // [first command, follow-up, student(s) wanted, what must carry over]
  ['give Willow 5 rtc', 'and Noah', ['Noah Williams'], e => e.amount === 5],
  ['give Willow 5 rtc', 'Noah too', ['Noah Williams'], e => e.amount === 5],
  ['give Willow 5 rtc', 'same for Noah and Clementine', ['Noah Williams', 'Clementine Vasquez'], e => e.amount === 5],
  ['take 3 rtc from Willow', 'and Noah', ['Noah Williams'], e => e.amount === 3],
  ['mark Willow absent', 'Noah as well', ['Noah Williams'], () => true],
  ["show Willow's grades", 'what about Noah', ['Noah Williams'], () => true],
  ["what is Willow's attendance", 'and Noah?', ['Noah Williams'], () => true],
  ['show notes for Willow', 'also Clementine', ['Clementine Vasquez'], () => true],
  ["show Willow's schedule", 'how about Noah', ['Noah Williams'], () => true],
  ['Willow is out monday', 'and Noah', ['Noah Williams'], e => /monday/.test(e._rawInput)],
  ['Otto Brennick will be picked up at 11:15 today', 'And Hazel Brennick', ['Hazel Brennick'], e => /11:15/.test(e._rawInput)],
  ['Otto Brennick will be picked up at 11:15 today', 'and Hazel', ['Hazel Brennick'], () => true],
  ['Otto Brennick will be picked up at 11:15 today', 'do the same for Willow', ['Willow Fenmore'], () => true],
];
for (const [first, next, want, carry] of FOLLOW) {
  fresh();
  const a = say(first);
  if (!a.people.length) { ok(`"${first}" names a student`, false, String(a.intent)); continue; }
  const b = say(next);
  ok(`"${first}" then "${next}"  ->  ${a.intent} for ${want.join(', ')}`,
    b.intent === a.intent && b.entities._followUp && same(b.people, want) && carry(b.entities),
    `got ${b.intent} for ${b.people.join(', ')}`);
}

console.log('\n== a follow-up of a follow-up ==\n');
fresh(); say('give Willow 5 rtc'); say('and Noah');
{
  const c = say('and Clementine');
  ok('"and Clementine" after "and Noah" still gives 5',
    c.intent === 'ADD_RTC' && c.entities.amount === 5 && c.people[0] === 'Clementine Vasquez', `${c.intent} ${c.people}`);
}

console.log('\n== not follow-ups ==\n');
for (const [first, next] of [
  ['give Willow 5 rtc', 'and Noah gets 3'],
  ['give Willow 5 rtc', 'give Noah 2 rtc too'],
  ['Otto Brennick will be picked up at 11:15 today', 'and Hazel is leaving at 2'],
  ["what is Willow's attendance", "what about Noah's grades"],
  ['give Willow 5 rtc', 'and what about the math class'],
]) {
  fresh(); say(first);
  const b = say(next);
  ok(`"${next}" after "${first}" is its own sentence`, !b.entities._followUp, `took it as ${b.intent}`);
}
fresh();
ok('"and Noah" with nothing before it is not a follow-up', !say('and Noah').entities._followUp);
fresh(); say('list my classes');
ok('"and Noah" after a command about no student is not one', !say('and Noah').entities._followUp);
fresh(); say('give Willow 5 rtc'); say('list my classes');
ok('...nor once something else has been asked in between', !say('and Noah').entities._followUp);
fresh(); say('give Willow 5 rtc'); app._rivenLastCommand.at -= 16 * 60 * 1000;
ok('...nor after 15 minutes', !say('and Noah').entities._followUp);
fresh(); say('transfer 5 rtc from Willow to Noah');
ok('a transfer (two people in two roles) is not repeated', !say('and Clementine').entities._followUp);

console.log('\n== a follow-up that set an unconfirmed command aside brings it along ==\n');
fresh();
say('Otto Brennick will be picked up at 11:15 today');
app._rivenLastCommand.setAside = true;
{
  const b = say('And Hazel Brennick');
  ok('both siblings are in the follow-up', same(b.people, ['Hazel Brennick', 'Otto Brennick']), b.people.join(', '));
}

console.log('\n== several students: a lone first name takes the sibling surname ==\n');
fresh();
{
  const a = say('Hazel and Otto Brennick will be picked up at 11:15 today');
  ok('Hazel is Hazel Brennick, not Hazel Quint', same(a.people, ['Hazel Brennick', 'Otto Brennick']), a.people.join(', '));
}

console.log('\n== a list of names first, then the action ==\n');
// Asked for 2026-10-22: "for Noah, Steve, James and Tina do x".
const FOUR = ['Willow Fenmore', 'Noah Williams', 'Clementine Vasquez', 'Josephine Wexler'];
for (const [line, intent, check] of [
  ['for Willow, Noah, Clementine and Josephine give 5 rtc', 'ADD_RTC', e => e.amount === 5],
  ['for Willow, Noah, Clementine and Josephine: give 5 rtc', 'ADD_RTC', e => e.amount === 5],
  ['Willow, Noah, Clementine and Josephine: 5 rtc each', 'ADD_RTC', e => e.amount === 5],
  ['give 5 rtc to Willow, Noah, Clementine and Josephine', 'ADD_RTC', e => e.amount === 5],
  ['for Willow, Noah, Clementine and Josephine mark absent', 'MARK_ATTENDANCE', () => true],
  ['for Willow, Noah, Clementine and Josephine do a strike for phones', 'ISSUE_STRIKE', () => true],
  ['for Willow, Noah, Clementine and Josephine: out monday', 'PLAN_ABSENCE', () => true],
  ['for Willow, Noah, Clementine, and Josephine: pickup at 1:45 today', 'PLAN_LATE_EARLY', () => true],
  // Not "they were picked up just now": a time ahead is a plan.
  ['Willow, Noah, Clementine, Josephine - picked up at 1:45 today', 'PLAN_LATE_EARLY', () => true],
]) {
  fresh();
  const r = say(line);
  ok(`"${line}"  ->  ${intent} for all four`, r.intent === intent && same(r.people, FOUR) && check(r.entities),
    `got ${r.intent} for ${r.people.join(', ')}`);
}
// Names and an amount with no verb is an award; saying what someone has is not.
for (const [line, intent] of [['Willow 5 rtc', 'ADD_RTC'], ['Willow: 5 rtc', 'ADD_RTC'], ['5 rtc each for Willow and Noah', 'ADD_RTC']]) {
  fresh(); const r = say(line);
  ok(`"${line}" is an award`, r.intent === intent && r.entities.amount === 5, String(r.intent));
}
for (const line of ['Willow has 5 rtc', 'does Willow have 5 rtc?', 'Willow needs 5 rtc', 'Willow only 5 rtc left']) {
  fresh(); const r = say(line);
  ok(`"${line}" is not an award`, r.intent !== 'ADD_RTC', String(r.intent));
}

console.log('\n== several students, an action about one: once each, one question, one undo ==\n');
(async () => {
  // A stand-in executor: asks to confirm, and leaves an undo when it writes.
  const wrote = [];
  app._rivenUndoStack = [];
  app._executeIntent = async (intent, e) => {
    const s = e.student.student;
    app._requestConfirmation(`strike for <b>${s.full_name}</b>`, async () => {
      wrote.push(s.id);
      app._pushUndo(`the strike for ${s.full_name}`, async () => { wrote.splice(wrote.indexOf(s.id), 1); }, { kind: 'strike', id: s.id });
    });
  };
  const people = app._terminalAllStudents.slice(0, 3);
  app._pendingAction = null;
  await app._rivenForEachStudent({ intent: 'ISSUE_STRIKE' }, { students: people.map(p => ({ student: p })) }, people);
  const pa = app._pendingAction;
  ok('one question naming all three', !!pa && people.every(p => pa.summary.includes(p.full_name)), pa && pa.summary);
  ok('nothing written before the yes', wrote.length === 0);
  await pa.execute();
  ok('a write for each after the yes', wrote.length === 3);
  ok('one undo entry for the sentence', app._rivenUndoStack.length === 1, String(app._rivenUndoStack.length));
  ok('  which survives a reload as a group', app._rivenUndoStack[0].spec?.kind === 'group' && app._rivenUndoStack[0].spec.specs.length === 3);
  await app._rivenUndoStack[0].fn();
  ok('  and takes all three back', wrote.length === 0);

  // An executor that asks nothing (a lookup, or a write that never confirms).
  let shown = 0;
  app._executeIntent = async () => { shown++; };
  app._pendingAction = null;
  await app._rivenForEachStudent({ intent: 'VIEW_GRADES' }, {}, people);
  ok('a read runs once per student and asks nothing', shown === 3 && !app._pendingAction);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
