#!/usr/bin/env node
// AN ORDINARY WORD IS NOT A PERSON.
//
// "Who is missing the next few days" came back offering a choice of four
// students. The word was "days". On the live roster it is one edit from a
// surname (similarity 0.78, over the 0.7 bar) AND a subsequence of a first name
// sharing its first two letters, so it matched by two routes at once — and
// because an ambiguous name is resolved BEFORE the intent is, the question was
// never answered at all. Riven just asked which child "days" was.
//
// This had happened before with "quarter", which collided with a surname on the
// roll, and the fix then was to add that one word to a list. Same shape, new
// word, a year of vocabulary still unguarded. So this file is the grid: every
// ordinary word this school actually says, asserted against a roster built to
// be as collidable as possible.
//
// THE RULE IT ENFORCES
//
//   A word that is ordinary English may match a name EXACTLY, and no other way.
//
// Exactness still works — a student really called Mark is found by "mark". What
// is refused is the fuzzy pass, the prefix pass and the compressed-nickname
// pass, each of which turns a word that merely LOOKS like a name into one.
//
// THE ROSTER IS INVENTED, and deliberately nasty: every surname here sits one
// edit from a word in the corpus below, and every first name has one hiding
// inside it as a subsequence. If the guard weakens, this roster notices.
//
// Run: node debug-tools/word-vs-name.js

const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(__dirname, '..', '..', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('word-vs-name: could not locate portal/index.html'); process.exit(2); }
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

// Every surname below is one edit from a word in the corpus; every first name
// contains one as a subsequence starting with the same two letters. This is the
// worst case, on purpose.
const ROSTER = [
  ['Daenys', 'Mays'],       // "days": one edit from Mays, subsequence of Daenys
  ['Weston', 'Weeks'],      // "weeks"
  ['Gracyn', 'Grady'],      // "grade" / "grades"
  ['Teodor', 'Tesla'],      // "test"
  ['Periwinkle', 'Perrin'], // "period"
  ['Charmaine', 'Chapton'], // "chapter"
  ['Morgana', 'Monro'],     // "morning" / "month"
  ['Absalom', 'Abney'],     // "absent"
  ['Latimer', 'Layne'],     // "late"
  ['Quinlan', 'Quarles'],   // "quarter"
  ['Homer', 'Homewood'],    // "homework"
  ['Rosalind', 'Ashgrove'], // an ordinary name, to prove matching still works
];
app._terminalAllStudents = ROSTER.map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l,
  rtc_balance: 10 + i, email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i,
}));
app.userInfo = { profile: { user_type: 'admin' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  { id: 'c2', name: 'Chess', subject: 'Enrichment', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
];
app._terminalAllGroups = [];

let pass = 0, fail = 0;
const fails = [];

function resolved(sentence) {
  app._nlpContext = {};
  const normalized = app._normalizeInput(sentence);
  const r = app._resolvePronouns(normalized);
  const e = app._extractEntities(r, sentence);
  const w = e.student;
  if (!w) return null;
  if (w.ambiguous) return 'ask(' + (w.matches || []).map(s => s.full_name).join(' | ') + ')';
  return (w.student || w).full_name;
}

function nobody(sentence, why) {
  const got = resolved(sentence);
  if (got === null) { pass++; return; }
  fail++; fails.push({ sentence, why, got });
}
function somebody(sentence, who) {
  const got = resolved(sentence);
  if (got === who) { pass++; return; }
  fail++; fails.push({ sentence, why: 'must still resolve', got: got === null ? '(nobody)' : got });
}

// The words a school says all day. None of them is a child.
const TIME = ['day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'today', 'tomorrow', 'yesterday', 'morning', 'afternoon', 'evening', 'night',
  'weekend', 'next', 'past', 'few', 'couple', 'several', 'upcoming', 'later'];
const SCHOOL = ['quarter', 'semester', 'term', 'grade', 'grades', 'class', 'classes',
  'roster', 'register', 'report', 'schedule', 'period', 'chapter', 'assignment',
  'homework', 'lesson', 'unit', 'quiz', 'test', 'exam', 'page', 'points'];
const ATTEND = ['attendance', 'absent', 'absence', 'absences', 'present', 'missing',
  'away', 'gone', 'tardy', 'late', 'early', 'excused', 'here'];
// The rest of the school's vocabulary. These were found by running the corpus
// against the LIVE roster rather than waiting for a report: "math" came back
// asking which of two children it meant, and "store" silently picked one.
const DOMAIN = ['math', 'science', 'reading', 'writing', 'history', 'bible', 'art',
  'music', 'robotics', 'chess', 'worship', 'band', 'chapel', 'english',
  'lunch', 'recess', 'break', 'bus', 'pickup', 'field', 'trip', 'library', 'gym',
  'office', 'room', 'parent', 'parents', 'teacher', 'staff', 'student', 'students',
  'credit', 'credits', 'balance', 'reward', 'snack', 'store', 'privilege',
  'strike', 'strikes', 'note', 'notes', 'message', 'behavior', 'progress',
  'goal', 'goals', 'skill', 'skills', 'level', 'score', 'scores', 'average',
  'percent', 'total', 'list'];

// The shapes those words arrive in.
const FRAMES = [
  (w) => w,
  (w) => `who is ${w}`,
  (w) => `show me the ${w}`,
  (w) => `what about the ${w}`,
  (w) => `how many ${w} are left`,
];

// A word that IS somebody's name is the deliberate exception, and it has to be
// taken out of the corpus rather than asserted away: "Weeks" is this roster's
// surname, and a student whose name is an ordinary word must stay findable.
// That case gets its own assertions further down.
const IS_A_NAME = new Set();
for (const s of app._terminalAllStudents) {
  IS_A_NAME.add(s.first_name.toLowerCase());
  IS_A_NAME.add(s.last_name.toLowerCase());
}
const CORPUS = [...TIME, ...SCHOOL, ...ATTEND, ...DOMAIN].filter(w => !IS_A_NAME.has(w));
const CLASHES = [...TIME, ...SCHOOL, ...ATTEND, ...DOMAIN].filter(w => IS_A_NAME.has(w));

console.log(`== a bare word is nobody ==  (${CORPUS.length} words)`);
for (const w of CORPUS) nobody(w, 'a bare ordinary word');

console.log('== and it is still nobody inside a sentence ==');
for (const w of CORPUS) {
  for (const f of FRAMES) nobody(f(w), 'an ordinary word in a sentence');
}

console.log(`== except when it really is their name ==  (${CLASHES.join(', ')})`);
// The half that is easy to break while fixing the other one. If this roster
// ever stops containing a name that is also an ordinary word, the exception
// stops being tested - so fail loudly rather than quietly passing zero checks.
if (!CLASHES.length) {
  fail++;
  fails.push({ sentence: '(the roster)', why: 'no name collides with the corpus, so the exception is untested', got: 'nothing to check' });
}
for (const w of CLASHES) {
  const got = resolved(w);
  if (got && got.toLowerCase().includes(w)) pass++;
  else { fail++; fails.push({ sentence: w, why: 'is a real surname and must match exactly', got: got === null ? '(nobody)' : got }); }
}

console.log('== the sentence that was reported ==');
nobody('who is missing the next few days', 'THE REPORTED ONE');
nobody('/admin who is missing the next few days', 'the same, with the admin prefix');
nobody('who is out the next couple days', 'its neighbour');
nobody('anyone away over the weekend', 'and its neighbour');
nobody('what quarter are we in', 'the one that taught this lesson the first time');
nobody('delete the chapter 4 assignment', 'the other one it taught');

console.log('== real names still resolve ==');
somebody('rosalind', 'Rosalind Ashgrove');
somebody('show me rosalind', 'Rosalind Ashgrove');
somebody('rosalind ashgrove', 'Rosalind Ashgrove');
somebody('give rosalind 5 rtc', 'Rosalind Ashgrove');
somebody('was rosalind here yesterday', 'Rosalind Ashgrove');
// A name that IS an ordinary word still matches EXACTLY - that is the whole
// point of the rule, and the half that is easy to break while fixing the other.
somebody('homer', 'Homer Homewood');
somebody('give homer 5 rtc', 'Homer Homewood');
somebody('latimer', 'Latimer Layne');
somebody('teodor', 'Teodor Tesla');
somebody('weston', 'Weston Weeks');

console.log('== a name next to its own vocabulary still works ==');
// The hard case: the word and the person in one sentence.
somebody('was weston absent today', 'Weston Weeks');
somebody('how many days has weston missed', 'Weston Weeks');
somebody('rosalinds attendance this quarter', 'Rosalind Ashgrove');
somebody('give teodor 5 rtc for the test', 'Teodor Tesla');
somebody('homers homework', 'Homer Homewood');

console.log('\n' + '-'.repeat(72));
if (fails.length) {
  console.log(`\n${fails.length} FAILING:\n`);
  for (const f of fails) console.log(`   "${f.sentence}"\n        ${f.why}\n        got ${f.got}`);
  console.log('');
}
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
