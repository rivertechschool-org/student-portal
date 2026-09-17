#!/usr/bin/env node
// THE ATTENDANCE QUESTION GRID.
//
// Five separate bug reports in one afternoon were all the same question asked
// a slightly different way:
//
//   "who was missing September 14th"        -> answered about the last 30 days
//   "who was missing?"                      -> answered about the last 30 days
//   "was Elizabeth Beck present September 9" -> answered with her account card
//   "who is missing next week"              -> answered about today
//   "will Meadow be missing the next couple days" -> asked what I meant
//
// Each was fixed by hand, one regex at a time, and the next phrasing broke
// anyway. That is what this file is for: enumerate the grid instead of waiting
// for someone to walk into a hole in it.
//
// THE GRID IS THREE AXES
//
//   WHO    everyone / one student / a class
//   WHEN   a past day, a past window, today, a future day, a future window
//   HOW    was/were, is/are, will be, going to be, did, has been, a bare noun
//
// AND THE RULE IS TWO LINES
//
//   Looking BACK or at TODAY -> the register.  Everyone = ATTENDANCE_ISSUES,
//                                              one person = VIEW_ATTENDANCE.
//   Looking FORWARD          -> the plan.      VIEW_PLANNED_ABSENCES, either way.
//
// The register only knows days that have happened; the plan only knows days
// that have not. Every one of the five failures above was a question crossing
// that line and being answered by the wrong side of it.
//
// Run: node debug-tools/attendance-matrix.js

const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(__dirname, '..', '..', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('attendance-matrix: could not locate portal/index.html'); process.exit(2); }
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

// The same call graph nlp-stress uses, so this harness and that one cannot
// disagree about what the page does.
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
  '_rivenFindExcluded', '_rivenGroupCanon', '_rivenMatchGroup', '_rivenIgnoresAttendance',
  '_rivenParseClassSpec', '_rivenParseNewClassName', '_rivenParseClassRosterRef',
  '_rivenResolvedStudent', '_rivenNamesEachClass', '_rivenClassNamedBeyondCohort'];

const app = { _nlpContext: {} };
for (const name of methods) { const fn = extract(name); app[name] = function (...a) { return fn.apply(app, a); }; }

const roster = [['Meadow', 'Lawler'], ['Charlotte', 'Tebow'], ['Noah', 'Williams'], ['Elizabeth', 'Becker']];
app._terminalAllStudents = roster.map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l,
  rtc_balance: 100 + i, email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i,
}));
app.userInfo = { profile: { user_type: 'admin' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  { id: 'c2', name: 'Chemistry', subject: 'Science', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
];
// The cohorts. Without these _rivenMatchGroup returns null for everything, and
// "who's here in LOWER MS today" looks like a school-wide question - so the
// harness would wave through exactly the over-capture it exists to catch.
app._terminalAllGroups = [
  { id: 'g1', name: 'Lower Middle School', studentIds: ['id0', 'id1'] },
  { id: 'g2', name: 'Upper Elementary', studentIds: ['id2'] },
  { id: 'g3', name: 'High School', studentIds: ['id3'] },
];

function route(input) {
  app._nlpContext = {};
  const normalized = app._normalizeInput(input);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, input);
  const intent = app._matchIntent(resolved, entities);
  // entities.student is a WRAPPER - { student, score, ambiguous } - so the name
  // sits one level down. Reading it as entities.student.full_name gives
  // undefined for every sentence, which looks exactly like "the name never
  // resolved" and sent me hunting a bug in the resolver that was not there.
  const stu = entities.student?.student || entities.student;
  return {
    intent: (intent && (intent.intent || intent)) || 'NONE',
    student: stu?.full_name || null,
    ambiguous: !!entities.student?.ambiguous,
    forward: app._rivenPointsForward(resolved),
  };
}

// ---------------------------------------------------------------------------
// The axes.
// ---------------------------------------------------------------------------

// WHEN. `dir` is the only thing that decides which side answers.
const WHEN = [
  // Looking back, or at today.
  { t: '', dir: 'back' },
  { t: 'today', dir: 'back' },
  { t: 'yesterday', dir: 'back' },
  { t: 'last week', dir: 'back' },
  { t: 'on monday', dir: 'back' },
  { t: 'september 9', dir: 'back' },
  { t: 'sept 9th', dir: 'back' },
  { t: 'september 8-10', dir: 'back' },
  { t: 'this week', dir: 'back' },
  // Looking forward.
  { t: 'tomorrow', dir: 'fwd' },
  { t: 'next week', dir: 'fwd' },
  { t: 'next monday', dir: 'fwd' },
  { t: 'next month', dir: 'fwd' },
  { t: 'the next couple days', dir: 'fwd' },
  { t: 'the next few days', dir: 'fwd' },
  { t: 'in the next 3 days', dir: 'fwd' },
  { t: 'this coming week', dir: 'fwd' },
  { t: 'the rest of the week', dir: 'fwd' },
  { t: 'over the weekend', dir: 'fwd' },
];

// HOW. Each template says which directions it can sensibly carry: you cannot
// ask "was she absent next week", and "will she be out yesterday" is nonsense.
const EVERYONE = [
  { s: (t) => `who was missing ${t}`, dirs: ['back'] },
  { s: (t) => `who was absent ${t}`, dirs: ['back'] },
  { s: (t) => `who was out ${t}`, dirs: ['back'] },
  { s: (t) => `who wasnt here ${t}`, dirs: ['back'] },
  { s: (t) => `who missed school ${t}`, dirs: ['back'] },
  { s: (t) => `anyone absent ${t}`, dirs: ['back'] },
  { s: (t) => `any students absent ${t}`, dirs: ['back'] },
  { s: (t) => `who is missing ${t}`, dirs: ['back', 'fwd'] },
  { s: (t) => `whos out ${t}`, dirs: ['back', 'fwd'] },
  { s: (t) => `who will be out ${t}`, dirs: ['fwd'] },
  { s: (t) => `who will be missing ${t}`, dirs: ['fwd'] },
  { s: (t) => `who is going to be gone ${t}`, dirs: ['fwd'] },
  { s: (t) => `anyone missing ${t}`, dirs: ['back', 'fwd'] },
  { s: (t) => `anyone away ${t}`, dirs: ['back', 'fwd'] },
  { s: (t) => `is anyone out ${t}`, dirs: ['back', 'fwd'] },
];

const ONE = [
  { s: (n, t) => `was ${n} present ${t}`, dirs: ['back'] },
  { s: (n, t) => `was ${n} here ${t}`, dirs: ['back'] },
  { s: (n, t) => `was ${n} absent ${t}`, dirs: ['back'] },
  { s: (n, t) => `did ${n} miss school ${t}`, dirs: ['back'] },
  { s: (n, t) => `is ${n} here ${t}`, dirs: ['back'] },
  { s: (n, t) => `${n}s attendance ${t}`, dirs: ['back'] },
  { s: (n, t) => `will ${n} be missing ${t}`, dirs: ['fwd'] },
  { s: (n, t) => `will ${n} be out ${t}`, dirs: ['fwd'] },
  { s: (n, t) => `will ${n} be here ${t}`, dirs: ['fwd'] },
  { s: (n, t) => `is ${n} going to be out ${t}`, dirs: ['fwd'] },
  { s: (n, t) => `is ${n} away ${t}`, dirs: ['fwd'] },
  { s: (n, t) => `is ${n} out ${t}`, dirs: ['back', 'fwd'] },
];

const expected = (who, dir) =>
  dir === 'fwd' ? ['VIEW_PLANNED_ABSENCES']
    : who === 'one' ? ['VIEW_ATTENDANCE']
      : ['ATTENDANCE_ISSUES'];

let pass = 0, fail = 0;
const fails = [];
const byIntent = {};

function run(sentence, who, dir) {
  const r = route(sentence);
  byIntent[r.intent] = (byIntent[r.intent] || 0) + 1;
  const want = expected(who, dir);
  let good = want.includes(r.intent);
  // A question about one person has to find that person, or the answer is
  // about the whole school.
  if (good && who === 'one' && !r.student) good = false;
  if (good) pass++;
  else { fail++; fails.push({ sentence, want: want.join('/'), got: r.intent, student: r.student, dir, forward: r.forward }); }
}

console.log('== everyone ==');
for (const tpl of EVERYONE) {
  for (const w of WHEN) {
    if (!tpl.dirs.includes(w.dir)) continue;
    run(tpl.s(w.t).replace(/\s+/g, ' ').trim(), 'everyone', w.dir);
  }
}

console.log('== one student ==');
for (const tpl of ONE) {
  for (const w of WHEN) {
    if (!tpl.dirs.includes(w.dir)) continue;
    run(tpl.s('meadow', w.t).replace(/\s+/g, ' ').trim(), 'one', w.dir);
  }
}

console.log('== the five that were reported ==');
const REPORTED = [
  ['who was missing september 14th', 'everyone', 'back'],
  ['who was missing', 'everyone', 'back'],
  ['was elizabeth beck present september 9', 'one', 'back'],
  ['who is missing next week', 'everyone', 'fwd'],
  ['will meadow be missing within the next couple days', 'one', 'fwd'],
];
for (const [s, who, dir] of REPORTED) run(s, who, dir);

console.log('== what it must NOT take ==');
// Deciding an intent before anything else bids on it is a strong move, and the
// first version of this rule quietly took four things that are not attendance
// questions at all. Each line here is one of them, found by nlp-stress rather
// than imagined. They are why _rivenAttendanceQuestion has a bail-out list, and
// they are checked here so nobody deletes one of those lines to make some new
// phrasing work.
const NOT_OURS = [
  ['give charlotte 5 rtc for good attendance', 'an RTC award'],
  ['give charlotte 5 for good attendance', 'an RTC award without the unit'],
  ['notes about attendance', 'the notes list'],
  ['attendance for english and math: all here except malakai and magnolia', 'a register being TAKEN'],
  ['mark meadow absent', 'a register write'],
  ['mark everyone in math present', 'a group register write'],
  ['meadow is out monday to wednesday', 'planning an absence'],
  ['meadow will be absent sept 23', 'planning an absence, future tense'],
  ['whos here in lower ms today', 'that cohort roster'],
  ['who is absent in upper elementary', 'that cohort roster'],
];
for (const [sentence, why] of NOT_OURS) {
  app._nlpContext = {};
  const normalized = app._normalizeInput(sentence);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, sentence);
  const taken = app._rivenAttendanceQuestion(resolved, entities);
  if (!taken) pass++;
  else {
    fail++;
    fails.push({ sentence, want: 'left alone (' + why + ')', got: taken.intent, student: null, dir: '-', forward: false });
  }
}

console.log('\n' + '-'.repeat(72));
if (fails.length) {
  console.log(`\n${fails.length} FAILING:\n`);
  // Grouped by what it fell through to, because a run of misses almost always
  // shares one cause.
  const groups = {};
  for (const f of fails) (groups[f.got] = groups[f.got] || []).push(f);
  for (const [got, list] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  fell through to ${got}  (${list.length})`);
    for (const f of list) {
      console.log(`     "${f.sentence}"  want ${f.want}` +
        (f.dir === 'fwd' && !f.forward ? '   [not seen as forward-looking]' : '') +
        (f.want === 'VIEW_ATTENDANCE' && !f.student ? '   [student not resolved]' : ''));
    }
    console.log('');
  }
}
console.log(`landed on: ${Object.entries(byIntent).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`\n${pass} pass, ${fail} fail  (${pass + fail} phrasings)`);
process.exit(fail ? 1 : 0);
