#!/usr/bin/env node
// THE "PUT THEM DOWN AS AWAY" GRID.
//
// attendance-matrix.js is the grid for QUESTIONS about attendance. This is the
// grid for COMMANDS - a teacher telling Riven a student will be away, or is
// away today. It exists because "set Willow missing 5-8", "set Willow missing
// the 5th-8th" and "set Willow missing the 5th through the 8th" all failed
// (reported 2026-10-01): the sentence either did not reach the planned-absence
// intent at all, or reached it and lost its dates.
//
// TWO AXES, AND ONE RULE
//
//   HOW   the ways people say it: set / mark / put down / will be / is out /
//         won't be in / has an appointment / record / log / excuse ...
//   WHEN  the ways people write the days: 5-8, the 5th-8th, the 5th through
//         the 8th, oct 5-8, 10/5-10/8, monday to thursday, a list ...
//
//   A day AFTER today      -> PLAN_ABSENCE, with exactly those days.
//   TODAY (or no day)      -> MARK_ATTENDANCE: the register, now.
//
// Every expected date is computed from a fixed "today" (Thursday 1 October
// 2026), so a failure names the exact span that came back.
//
// Run: node debug-tools/absence-command-matrix.js        (exit 1 on any failure)
//      VERBOSE=1 node debug-tools/absence-command-matrix.js   (every line)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

// ---- a fixed today ---------------------------------------------------------
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
// attendance-matrix's call graph, plus the absence-date readers.
const methods = ['_normalizeInput', '_resolvePronouns', '_isFollowUpCommand',
  '_extractEntities', '_parseTimeframe', '_rivenPastDate', '_rivenMonthIndex',
  '_rivenPointsForward', '_rivenForwardWindow', '_rivenMonthDayDates',
  '_rivenAttendanceQuestion',
  '_fuzzyFindStudent', '_rivenIsMyStudent', '_rivenOwnRank', '_calculateSimilarity',
  '_levenshteinDistance', '_matchIntent', '_rivenIsFutureAbsenceCommand', '_matchSmalltalk', '_isAggregateQuery',
  '_rivenMatchClass', '_rivenBandFromText', '_rivenBandLabel', '_rivenClassIsOpen',
  '_rivenCanManageClass', '_preferOwnedClasses', '_isoDaysAgo',
  '_hasCommandVerb', '_hasCommandSignal', '_isCommonWordTypo', '_commonWords',
  '_segmentClauses', '_classifyClauseShape', '_rivenQuantifiesClasses', '_rivenFindExcluded',
  '_rivenGroupCanon', '_rivenMatchGroup', '_rivenMatchGroupPair', '_rivenIgnoresAttendance',
  '_rivenParseClassSpec', '_rivenParseNewClassName', '_rivenParseClassRosterRef',
  '_rivenResolvedStudent', '_rivenNamesEachClass', '_rivenClassNamedBeyondCohort',
  '_rivenResolveAbsenceSpans', '_rivenPhraseToDate', '_rivenAbsenceDayNumbers',
  '_rivenDayCodes', '_rivenCollapseSpans', '_rivenParseWeekdays'];
const app = { _nlpContext: {} };
for (const name of methods) {
  let fn;
  try { fn = extract(name); } catch (e) { continue; }   // optional helpers
  app[name] = function (...a) { return fn.apply(app, a); };
}
const roster = [['Willow', 'Fenmore'], ['Clementine', 'Vasquez'], ['Noah', 'Williams'], ['Josephine', 'Wexler']];
app._terminalAllStudents = roster.map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l,
  rtc_balance: 100 + i, email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i,
}));
app.userInfo = { profile: { user_type: 'admin' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
];
app._terminalAllGroups = [{ id: 'g1', name: 'Lower Middle School', studentIds: ['id0', 'id1'] }];

function route(input) {
  app._nlpContext = {};
  const normalized = app._normalizeInput(input);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, input);
  entities._rawInput = input;
  const intent = app._matchIntent(resolved, entities);
  const stu = entities.student?.student || entities.student;
  let spans = null;
  try { spans = app._rivenResolveAbsenceSpans(input); } catch (e) { spans = 'THROW ' + e.message; }
  return { intent: (intent && (intent.intent || intent)) || 'NONE', student: stu?.full_name || null, spans };
}

// ---- the axes --------------------------------------------------------------
const N = 'Willow';
const HOW = [
  (t) => `set ${N} missing ${t}`,
  (t) => `set ${N} as missing ${t}`,
  (t) => `set ${N} absent ${t}`,
  (t) => `set ${N} as absent ${t}`,
  (t) => `mark ${N} absent ${t}`,
  (t) => `mark ${N} as absent ${t}`,
  (t) => `mark ${N} missing ${t}`,
  (t) => `mark ${N} out ${t}`,
  (t) => `mark ${N} away ${t}`,
  (t) => `put ${N} down as absent ${t}`,
  (t) => `put ${N} down as away ${t}`,
  (t) => `put ${N} as absent ${t}`,
  (t) => `record ${N} as absent ${t}`,
  (t) => `log ${N} absent ${t}`,
  (t) => `add an absence for ${N} ${t}`,
  (t) => `${N} will be absent ${t}`,
  (t) => `${N} will be out ${t}`,
  (t) => `${N} will be missing ${t}`,
  (t) => `${N} will be away ${t}`,
  (t) => `${N} is going to be gone ${t}`,
  (t) => `${N} is out ${t}`,
  (t) => `${N} is away ${t}`,
  (t) => `${N} is absent ${t}`,
  (t) => `${N} wont be here ${t}`,
  (t) => `${N} won't be in ${t}`,
  (t) => `${N} is missing school ${t}`,
  (t) => `${N} will miss school ${t}`,
  (t) => `${N} absent ${t}`,
  (t) => `${N} out ${t}`,
  (t) => `${N} has a dentist appointment ${t}`,
  (t) => `excuse ${N} ${t}`,
  (t) => `${N} is excused ${t}`,
  (t) => `please set ${N} missing ${t}`,
  (t) => `can you mark ${N} absent ${t}`,
];

// Thursday 1 Oct 2026. Every WHEN carries the spans it must produce.
const WHEN = [
  ['5-8', [['2026-10-05', '2026-10-08']]],
  ['the 5-8', [['2026-10-05', '2026-10-08']]],
  ['5th-8th', [['2026-10-05', '2026-10-08']]],
  ['the 5th-8th', [['2026-10-05', '2026-10-08']]],
  ['the 5th - 8th', [['2026-10-05', '2026-10-08']]],
  ['the 5th to the 8th', [['2026-10-05', '2026-10-08']]],
  ['the 5th through the 8th', [['2026-10-05', '2026-10-08']]],
  ['5th through 8th', [['2026-10-05', '2026-10-08']]],
  ['the 5th thru 8th', [['2026-10-05', '2026-10-08']]],
  ['5 thru 8', [['2026-10-05', '2026-10-08']]],
  ['from the 5th to the 8th', [['2026-10-05', '2026-10-08']]],
  ['from 5 to 8', [['2026-10-05', '2026-10-08']]],
  ['from the 5th until the 8th', [['2026-10-05', '2026-10-08']]],
  ['between the 5th and the 8th', [['2026-10-05', '2026-10-08']]],
  ['on the 5th-8th', [['2026-10-05', '2026-10-08']]],
  ['oct 5-8', [['2026-10-05', '2026-10-08']]],
  ['october 5-8', [['2026-10-05', '2026-10-08']]],
  ['oct 5th-8th', [['2026-10-05', '2026-10-08']]],
  ['october 5th through the 8th', [['2026-10-05', '2026-10-08']]],
  ['oct 5 to oct 8', [['2026-10-05', '2026-10-08']]],
  ['5-8 oct', [['2026-10-05', '2026-10-08']]],
  ['the 5th to the 8th of october', [['2026-10-05', '2026-10-08']]],
  ['10/5-10/8', [['2026-10-05', '2026-10-08']]],
  ['10/5 to 10/8', [['2026-10-05', '2026-10-08']]],
  ['10/5 - 10/8', [['2026-10-05', '2026-10-08']]],
  ['monday-thursday', [['2026-10-05', '2026-10-08']]],
  ['monday through thursday', [['2026-10-05', '2026-10-08']]],
  ['mon-thu', [['2026-10-05', '2026-10-08']]],
  ['next monday to thursday', [['2026-10-05', '2026-10-08']]],
  ['from monday until thursday', [['2026-10-05', '2026-10-08']]],
  ['the 5th, 6th, 7th and 8th', [['2026-10-05', '2026-10-08']]],
  ['the 5th and the 7th', [['2026-10-05', '2026-10-05'], ['2026-10-07', '2026-10-07']]],
  ['5th & 6th', [['2026-10-05', '2026-10-06']]],
  ['the 5th', [['2026-10-05', '2026-10-05']]],
  ['on the 5th', [['2026-10-05', '2026-10-05']]],
  ['oct 5', [['2026-10-05', '2026-10-05']]],
  ['tomorrow', [['2026-10-02', '2026-10-02']]],
  ['friday', [['2026-10-02', '2026-10-02']]],
  ['next tuesday', [['2026-10-06', '2026-10-06']]],
  ['next week', [['2026-10-05', '2026-10-09']]],
  ['all next week', [['2026-10-05', '2026-10-09']]],
  ['tomorrow through monday', [['2026-10-02', '2026-10-05']]],
  ['nov 2-4', [['2026-11-02', '2026-11-04']]],
  ['oct 30 - nov 2', [['2026-10-30', '2026-11-02']]],
  ['the 30th-2nd', [['2026-10-30', '2026-11-02']]],
];

// Today: the register now, not a plan.
const TODAY = ['today', 'right now', 'this morning', ''];

let pass = 0, fail = 0;
const fails = [], byKind = {};
const verbose = !!process.env.VERBOSE;
const same = (got, want) => Array.isArray(got) && got.length === want.length &&
  got.every((s, i) => s.start === want[i][0] && s.end === want[i][1]);
const show = (spans) => Array.isArray(spans) ? spans.map(s => s.start === s.end ? s.start : `${s.start}..${s.end}`).join(', ') : String(spans);

for (const how of HOW) {
  for (const [when, want] of WHEN) {
    const sentence = how(when);
    const r = route(sentence);
    const okIntent = r.intent === 'PLAN_ABSENCE';
    const okWho = r.student === 'Willow Fenmore';
    const okSpans = same(r.spans, want);
    const good = okIntent && okWho && okSpans;
    const kind = !okIntent ? `intent ${r.intent}` : !okWho ? 'no student' : 'dates';
    if (good) pass++; else { fail++; fails.push({ sentence, r, want, kind }); byKind[kind] = (byKind[kind] || 0) + 1; }
    if (verbose) console.log(`${good ? 'ok  ' : 'FAIL'}  ${sentence}  ->  ${r.intent} | ${show(r.spans)}`);
  }
  for (const when of TODAY) {
    const sentence = how(when).trim();
    // Only the forms that read as a register mark in the present tense.
    if (/\bwill\b|going to|won'?t|wont|appointment|add an absence|put .* down/.test(sentence)) continue;
    const r = route(sentence);
    // Excusing today is EXCUSE_ABSENCE's job. With no day at all, asking
    // "when is she away?" (PLAN_ABSENCE does) is as right as marking today.
    // A fragment with no verb and no day ("willow absent", "willow out") may
    // stay a lookup: turning verbless fragments into writes is how a stray
    // message changes a record. With "today" they mark.
    const verbless = when === '' && !/\b(mark|set|record|log|put|excuse|is|was|will)\b/.test(sentence)
      || sentence === `${N} is excused`;
    const good = r.intent === 'MARK_ATTENDANCE'
      || (verbless && /^VIEW_/.test(r.intent))
      || (/excuse/.test(sentence) && r.intent === 'EXCUSE_ABSENCE')
      || (when === '' && ['PLAN_ABSENCE', 'MARK_ATTENDANCE', 'EXCUSE_ABSENCE'].includes(r.intent));
    if (good) pass++; else {
      fail++; const kind = `today -> ${r.intent}`;
      fails.push({ sentence, r, want: 'MARK_ATTENDANCE', kind }); byKind[kind] = (byKind[kind] || 0) + 1;
    }
    if (verbose) console.log(`${good ? 'ok  ' : 'FAIL'}  ${sentence}  ->  ${r.intent}`);
  }
}

// ---- what must NOT become a planned absence --------------------------------
// The rule that routes these commands is broad on purpose, so its edges are
// pinned here: questions read the plan, refusals and musings write nothing,
// and sentences that only share the vocabulary go where they went before.
const NOT_PLAN = [
  [`who will be out 5-8`, ['VIEW_PLANNED_ABSENCES']],
  [`will ${N} be out 5-8`, ['VIEW_PLANNED_ABSENCES']],
  [`will ${N} be missing the 5th through the 8th?`, ['VIEW_PLANNED_ABSENCES']],
  [`is ${N} away next week`, ['VIEW_PLANNED_ABSENCES']],
  [`when will ${N} be away`, ['VIEW_PLANNED_ABSENCES']],
  [`dont mark ${N} absent 5-8`, null],
  [`do not set ${N} missing the 5th-8th`, null],
  [`should i mark ${N} absent oct 5`, null],
  [`${N} is missing assignments for the 5th-8th`, null],
  [`${N} has missing work from 10/5`, null],
  [`give ${N} 5 rtc on the 8th`, null],
  [`take 5 rtc off ${N} tomorrow`, null],
  [`${N} scored 8 out of 10 on 10/5`, null],
  [`${N} isnt going to be out on the 5th`, null],
  [`${N} is not absent tomorrow`, null],
  [`mark ${N} absent sept 28`, null],
  [`${N} was absent sept 28-30`, null],
];
for (const [sentence, wants] of NOT_PLAN) {
  const r = route(sentence);
  const good = wants ? wants.includes(r.intent) : r.intent !== 'PLAN_ABSENCE';
  if (good) pass++; else {
    fail++; const kind = `must not plan -> ${r.intent}`;
    fails.push({ sentence, r, want: wants ? wants.join('|') : 'anything but PLAN_ABSENCE', kind });
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  if (verbose) console.log(`${good ? 'ok  ' : 'FAIL'}  ${sentence}  ->  ${r.intent}`);
}

if (!verbose) {
  const seen = new Set();
  for (const f of fails) {
    const key = f.kind + '|' + f.sentence.replace(N, 'N');
    if (seen.size > 80 || seen.has(key)) continue;
    seen.add(key);
    console.log(`  FAIL [${f.kind}]  ${f.sentence}  ->  ${f.r.intent} | ${show(f.r.spans)}  (want ${Array.isArray(f.want) ? f.want.map(w => w.join('..')).join(', ') : f.want})`);
  }
}
console.log('\nby failure kind:', JSON.stringify(byKind));
console.log(`${pass} pass, ${fail} fail  (${pass + fail} sentences)`);
process.exit(fail ? 1 : 0);
