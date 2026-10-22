#!/usr/bin/env node
// THE "ARRIVING LATE / PICKED UP EARLY" GRID.
//
// A teacher telling Riven a student will arrive late or leave early:
// "Alex is going to be picked up at 1:45 Thursday", "Alex is arriving late at
// 9:05 today". Every one must reach PLAN_LATE_EARLY with the right kind, time
// and day - and must NOT reach MARK_PICKED_UP, which dismisses the child on
// the spot, or MARK_ATTENDANCE, which marks them now.
//
// Three axes: HOW (late and early phrasings) x TIME (how a clock time is
// written) x DAY (how the day is written). Then the MUST-NOT list: reports of
// what already happened, questions, cancellations and plain absences, each
// pinned to where it goes today.
//
// "Today" is fixed: Thursday 1 October 2026, 10:00. A weekday that is today
// means today while the time is still ahead, else next week.
//
// Run: node debug-tools/late-early-commands.js        (exit 1 on any failure)
//      VERBOSE=1 node debug-tools/late-early-commands.js
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
// absence-command-matrix's call graph.
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
  '_rivenPlanFollowUp', '_rivenPlanTargets', '_rivenPlanInput', '_rivenRememberPlan'];
const app = { _nlpContext: {} };
for (const name of methods) {
  let fn;
  try { fn = extract(name); } catch (e) { continue; }
  app[name] = function (...a) { return fn.apply(app, a); };
}
// Hazel Quint sorts ahead of Hazel Brennick on purpose: "Hazel and Otto
// Brennick" must still mean Otto's sister.
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

function route(input, keepPlan) {
  app._nlpContext = {};
  if (!keepPlan) app._rivenLastPlan = null;
  const normalized = app._normalizeInput(input);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, input);
  entities._rawInput = input;
  const intent = app._matchIntent(resolved, entities);
  const plan = app._rivenLateEarlyPlan(input);
  const day = plan ? app._rivenLateEarlyDate(input, plan.time) : null;
  const people = app._rivenPlanTargets(entities).map(p => p.full_name);
  return { intent: (intent && (intent.intent || intent)) || 'NONE', plan, day: day && day.iso, people, entities };
}

const N = 'Willow';
const EARLY = [
  (t, d) => `${N} is going to be picked up at ${t} ${d}`,
  (t, d) => `${N} is being picked up at ${t} ${d}`,
  (t, d) => `${N} will be picked up at ${t} ${d}`,
  (t, d) => `${N} gets picked up at ${t} ${d}`,
  (t, d) => `${N} is getting picked up ${d} at ${t} for the dentist`,
  (t, d) => `${N} is leaving at ${t} ${d}`,
  (t, d) => `${N} is leaving early at ${t} ${d}`,
  (t, d) => `${N} has to leave at ${t} ${d}`,
  (t, d) => `${N} will be leaving early ${d} at ${t}`,
  (t, d) => `${N}'s mom is picking her up at ${t} ${d}`,
  (t, d) => `${N} is going home early at ${t} ${d}`,
  (t, d) => `${N} is being signed out at ${t} ${d}`,
  (t, d) => `early pickup for ${N} at ${t} ${d}`,
  (t, d) => `set ${N} leaving early at ${t} ${d}`,
];
const LATE = [
  (t, d) => `${N} is arriving late at ${t} ${d}`,
  (t, d) => `${N} is arriving at ${t} ${d}`,
  (t, d) => `${N} will be in at ${t} ${d}`,
  (t, d) => `${N} is coming in at ${t} ${d}`,
  (t, d) => `${N} is coming in late ${d} at ${t}`,
  (t, d) => `${N} will be late ${d}, arriving around ${t}`,
  (t, d) => `${N} is getting dropped off at ${t} ${d}`,
  (t, d) => `${N} won't be in until ${t} ${d}`,
  (t, d) => `${N} wont be here till ${t} ${d}`,
  (t, d) => `late arrival for ${N} at ${t} ${d}`,
];
// [written, expected HH:MM] - afternoon times for pickups, morning for arrivals.
const EARLY_TIMES = [['1:45', '13:45'], ['1:45pm', '13:45'], ['1:45 pm', '13:45'], ['2pm', '14:00'],
  ['2 p.m.', '14:00'], ['noon', '12:00'], ['quarter to 2', '13:45'], ['half past 1', '13:30'], ['12:30', '12:30']];
const LATE_TIMES = [['9:05', '09:05'], ['9:05am', '09:05'], ['9:05 a.m.', '09:05'], ['10:30', '10:30'],
  ['10am', '10:00'], ['quarter past 9', '09:15'], ['11:15', '11:15']];
// Thu 1 Oct 2026, 10:00. [written, iso for an afternoon time, iso for 9:05].
const DAYS = [['today', '2026-10-01', '2026-10-01'], ['tomorrow', '2026-10-02', '2026-10-02'],
  ['thursday', '2026-10-01', '2026-10-08'], ['on friday', '2026-10-02', '2026-10-02'],
  ['monday', '2026-10-05', '2026-10-05'], ['next tuesday', '2026-10-06', '2026-10-06'],
  ['oct 7', '2026-10-07', '2026-10-07'], ['10/7', '2026-10-07', '2026-10-07'], ['', '2026-10-01', '2026-10-01']];

let pass = 0, fail = 0;
const failures = [];
const expect = (input, want) => {
  const got = route(input);
  const bad = [];
  if (got.intent !== want.intent) bad.push(`intent ${got.intent}`);
  if (want.kind && got.plan?.kind !== want.kind) bad.push(`kind ${got.plan?.kind}`);
  if (want.time && got.plan?.time !== want.time) bad.push(`time ${got.plan?.time}`);
  if (want.day && got.day !== want.day) bad.push(`day ${got.day}`);
  if (bad.length) { fail++; failures.push(`  FAIL  "${input}"  wanted ${JSON.stringify(want)}  got: ${bad.join(', ')}`); }
  else { pass++; if (process.env.VERBOSE) console.log(`  ok    "${input}"`); }
};
const clean = s => s.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();

// HOW x TIME, said for today.
for (const how of EARLY) for (const [t, hm] of EARLY_TIMES) {
  expect(clean(how(t, 'today')), { intent: 'PLAN_LATE_EARLY', kind: 'early', time: hm, day: '2026-10-01' });
}
for (const how of LATE) for (const [t, hm] of LATE_TIMES) {
  expect(clean(how(t, 'tomorrow')), { intent: 'PLAN_LATE_EARLY', kind: 'late', time: hm, day: '2026-10-02' });
}
// HOW x DAY.
for (const how of EARLY) for (const [d, iso] of DAYS) {
  expect(clean(how('1:45', d)), { intent: 'PLAN_LATE_EARLY', kind: 'early', time: '13:45', day: iso });
}
for (const how of LATE) for (const [d, , iso] of DAYS) {
  expect(clean(how('9:05', d)), { intent: 'PLAN_LATE_EARLY', kind: 'late', time: '09:05', day: iso });
}

// MUST NOT: these keep going where they went before.
const NOT_PLAN = [
  ['Willow has been picked up', 'MARK_PICKED_UP'],
  ['Willow was picked up at 1:45', null],
  ['Willow got picked up at 2', null],
  ['Willow arrived at 9:05', null],
  ['Willow left early at 1:45', null],
  ['when is Willow being picked up?', null],
  ['is Willow leaving early today?', null],
  ['what time is Willow arriving tomorrow?', null],
  ["Willow won't be picked up at 1:45 after all", null],
  ['Willow is not leaving early at 2 anymore', null],
  ['mark Willow leaving early at 1:45', null],
  ['mark Willow late', 'MARK_ATTENDANCE'],
  ['Willow is out monday', 'PLAN_ABSENCE'],
  ['Willow has a dentist appointment monday', 'PLAN_ABSENCE'],
  ['give Willow 5 rtc', 'ADD_RTC'],
  ['Willow scored 8 out of 10', null],
];
for (const [input, intent] of NOT_PLAN) {
  const got = route(input);
  if (got.intent === 'PLAN_LATE_EARLY' || (intent && got.intent !== intent)) {
    fail++; failures.push(`  FAIL  "${input}"  wanted ${intent || 'not PLAN_LATE_EARLY'}  got ${got.intent}`);
  } else { pass++; if (process.env.VERBOSE) console.log(`  ok    "${input}" -> ${got.intent}`); }
}

// SEVERAL STUDENTS IN ONE SENTENCE: every one of them is in the plan, and a
// lone first name takes the surname of the student it is paired with.
const MANY = [
  ['Hazel and Otto Brennick will be picked up at 11:15 today', ['Hazel Brennick', 'Otto Brennick'], 'PLAN_LATE_EARLY'],
  ['Hazel Brennick and Otto Brennick are leaving at 1:45 friday', ['Hazel Brennick', 'Otto Brennick'], 'PLAN_LATE_EARLY'],
  ['Otto and Hazel Brennick are arriving at 10:30 tomorrow', ['Otto Brennick', 'Hazel Brennick'], 'PLAN_LATE_EARLY'],
  ['Willow and Noah are out monday', ['Willow Fenmore', 'Noah Williams'], 'PLAN_ABSENCE'],
];
for (const [input, want, intent] of MANY) {
  const got = route(input);
  const ok = got.intent === intent && JSON.stringify(got.people.slice().sort()) === JSON.stringify(want.slice().sort());
  if (ok) { pass++; if (process.env.VERBOSE) console.log(`  ok    "${input}" -> ${got.people.join(', ')}`); }
  else { fail++; failures.push(`  FAIL  "${input}"  wanted ${intent} for ${want.join(', ')}  got ${got.intent} for ${got.people.join(', ')}`); }
}

// FOLLOW-UPS: straight after a plan, a line that only names students repeats
// the plan for them. Anything else is its own instruction.
const after = (first, people) => {
  route(first);
  app._rivenRememberPlan(first.match(/out|away|absent/) ? 'PLAN_ABSENCE' : 'PLAN_LATE_EARLY', first,
    app._terminalAllStudents.filter(s => people.includes(s.full_name)));
};
const FOLLOW = [
  ['Otto Brennick will be picked up at 11:15 today', ['Otto Brennick'], 'And Hazel Brennick', 'PLAN_LATE_EARLY', ['Hazel Brennick']],
  ['Otto Brennick will be picked up at 11:15 today', ['Otto Brennick'], 'and Hazel', 'PLAN_LATE_EARLY', ['Hazel Brennick']],
  ['Otto Brennick will be picked up at 11:15 today', ['Otto Brennick'], 'Hazel Brennick too', 'PLAN_LATE_EARLY', ['Hazel Brennick']],
  ['Otto Brennick will be picked up at 11:15 today', ['Otto Brennick'], 'same for Willow', 'PLAN_LATE_EARLY', ['Willow Fenmore']],
  ['Otto Brennick will be picked up at 11:15 today', ['Otto Brennick'], 'also Willow and Noah', 'PLAN_LATE_EARLY', ['Willow Fenmore', 'Noah Williams']],
  ['Willow is out monday', ['Willow Fenmore'], 'and Noah', 'PLAN_ABSENCE', ['Noah Williams']],
  ['Willow is out monday', ['Willow Fenmore'], 'Noah as well', 'PLAN_ABSENCE', ['Noah Williams']],
];
for (const [first, firstPeople, next, intent, want] of FOLLOW) {
  after(first, firstPeople);
  const got = route(next, true);
  const ok = got.intent === intent && JSON.stringify(got.people.slice().sort()) === JSON.stringify(want.slice().sort())
    && got.entities._planFollowUp && got.entities._planFollowUp.raw === first;
  if (ok) { pass++; if (process.env.VERBOSE) console.log(`  ok    "${first}" then "${next}"`); }
  else { fail++; failures.push(`  FAIL  "${first}" then "${next}"  wanted ${intent} for ${want.join(', ')}  got ${got.intent} for ${got.people.join(', ')}`); }
}
// Not follow-ups: a new instruction, or nothing to follow.
const NOT_FOLLOW = [
  ['Otto Brennick will be picked up at 11:15 today', 'and Hazel is leaving at 2', 'PLAN_LATE_EARLY'],
  ['Otto Brennick will be picked up at 11:15 today', 'and give Willow 5 rtc', null],
  ['Otto Brennick will be picked up at 11:15 today', 'and what about Willow?', null],
];
for (const [first, next, okIntent] of NOT_FOLLOW) {
  after(first, ['Otto Brennick']);
  const got = route(next, true);
  if (got.entities._planFollowUp) { fail++; failures.push(`  FAIL  "${first}" then "${next}" was taken as a follow-up`); }
  else pass++;
}
{
  const got = route('And Hazel Brennick');
  if (got.entities._planFollowUp || /^PLAN_/.test(got.intent)) { fail++; failures.push('  FAIL  "And Hazel Brennick" with no plan before it planned something'); }
  else pass++;
}
// Something else ran in between: the plan is forgotten (_executeIntent clears it).
{
  after('Otto Brennick will be picked up at 11:15 today', ['Otto Brennick']);
  app._rivenLastPlan = null;
  const got = route('and Hazel Brennick', true);
  if (got.entities._planFollowUp) { fail++; failures.push('  FAIL  a forgotten plan was still followed'); } else pass++;
}
// A plan still waiting for a yes, set aside by the follow-up: its student
// comes along, so the follow-up asks about both.
{
  after('Otto Brennick will be picked up at 11:15 today', ['Otto Brennick']);
  app._rivenLastPlan.setAside = true;
  const got = route('And Hazel Brennick', true);
  const both = app._rivenPlanInput(got.entities).people.map(p => p.full_name).sort();
  if (JSON.stringify(both) === JSON.stringify(['Hazel Brennick', 'Otto Brennick'])) pass++;
  else { fail++; failures.push(`  FAIL  set-aside plan: wanted Hazel and Otto, got ${both.join(', ')}`); }
  app._rivenLastPlan.setAside = false; app._rivenLastPlan.confirmed = true;
  const only = app._rivenPlanInput(got.entities).people.map(p => p.full_name);
  if (JSON.stringify(only) === JSON.stringify(['Hazel Brennick'])) pass++;
  else { fail++; failures.push(`  FAIL  confirmed plan: wanted only Hazel, got ${only.join(', ')}`); }
}

failures.forEach(f => console.log(f));
console.log(`\n${pass} pass, ${fail} fail  (${pass + fail} sentences)`);
process.exit(fail ? 1 : 0);
