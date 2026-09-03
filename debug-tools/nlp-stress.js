#!/usr/bin/env node
// High-fidelity NLP stress test for Riven.
// Extracts the REAL methods from portal/index.html (brace-matched) and runs
// them, so there is no drift between this harness and shipped code.
const fs = require('fs');
const path = require('path');

// Resolve portal/index.html across layouts: committed inside the repo
// (<repo>/debug-tools/nlp-stress.js) or the original Mac layout where
// debug-tools/ sits as a sibling of the student-portal/ clone.
const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),                    // inside repo: <repo>/debug-tools -> <repo>/portal
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),  // Mac layout: debug-tools sibling of student-portal
  path.join(__dirname, '..', '..', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('nlp-stress: could not locate portal/index.html. Tried:\n  ' + SRC_CANDIDATES.join('\n  ')); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');

// Pull a method body out of the class by name using brace matching.
function extract(name) {
  const re = new RegExp('\\n    ' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  // find the opening brace of the body
  let i = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0, start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = src.slice(m.index + 1, start).trim(); // e.g. "_matchIntent(normalized, entities) "
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const body = src.slice(start + 1, i - 1);
  // eslint-disable-next-line no-new-func
  return new Function(...args.split(',').map(s => s.trim()).filter(Boolean), body);
}

const methods = ['_normalizeInput','_resolvePronouns','_isFollowUpCommand',
  '_extractEntities','_parseTimeframe','_fuzzyFindStudent','_calculateSimilarity',
  '_levenshteinDistance','_matchIntent','_matchSmalltalk','_isAggregateQuery','_rivenMatchClass','_rivenCanManageClass','_preferOwnedClasses','_isoDaysAgo',
  '_hasCommandVerb','_hasCommandSignal','_isCommonWordTypo','_commonWords','_segmentClauses','_classifyClauseShape',
  '_rivenQuantifiesClasses','_rivenFindExcluded'];
const app = { _nlpContext: {} };
for (const name of methods) app[name] = extract(name).bind ? extract(name) : extract(name);
// rebind so `this` works
for (const name of methods) { const fn = extract(name); app[name] = function (...a) { return fn.apply(app, a); }; }

// Realistic roster (real students seen in transcripts + stress cases)
const roster = [
  ['Charlotte','Tebow'], ['Eli','Morris'], ['Elijah','Douglas'], ['Elijah','Killackey'],
  ['Evelyn','Hegelund'], ['John','Smith'], ['Johnny','Appleseed'],
  ['Sarah','Jones'], ['Sam','Carter'], ['Samuel','Brooks'],
  ['Sophia','Nguyen'], ['Sofia','Martinez'], ['Liam','Jones'],
  ['Olivia','Brown'], ['Noah','Williams'], ['Ava','Davis'],
  ['Mia','Wilson'], ['Lucas','Anderson'], ['Mason','Thomas'],
];
app._terminalAllStudents = roster.map(([f,l],i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l,
  rtc_balance: 100 + i, email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id'+i
}));

app.userInfo = { profile: { user_type: 'teacher' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  { id: 'c2', name: 'Robotics', subject: 'Science', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  { id: 'c3', name: 'Filmmaking - Freshman', subject: 'Art', teacher_id: 't2', secondary_teacher_id: null, is_active: true },
  { id: 'c4', name: 'World History', subject: 'History', teacher_id: 't2', secondary_teacher_id: null, is_active: true },
];

// Run the front of the pipeline exactly like _executeNaturalLanguage
function run(input) {
  // Phase 5 conversational layer, mirrored from _executeNaturalLanguage
  const small = app._matchSmalltalk(input);
  if (small) {
    if (small.remainder) return run(small.remainder);
    return { intent: 'SMALLTALK:' + small.key, student: null, amount: null };
  }
  const normalized = app._normalizeInput(input);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, input);
  const grpCtx = app._nlpContext?.lastGroup;
  const groupPronoun = grpCtx && grpCtx.timestamp >= (app._nlpContext.timestamp || 0) && /\b(they|them|these|those)\b/.test(resolved);
  const firstPerson = /\bmy\b|\bdo i\b|\bam i\b/.test(resolved);
  if (!entities.student && app._nlpContext?.lastStudent && !app._isAggregateQuery(normalized) && !groupPronoun && !firstPerson && app._isFollowUpCommand(normalized)) {
    entities.student = { student: app._nlpContext.lastStudent, score: 0.95, ambiguous: false, fromContext: true };
  }
  if ((!entities.students || entities.students.length < 2) && /\bboth\b/.test(normalized) && app._nlpContext?.lastPair?.length >= 2) {
    entities.students = app._nlpContext.lastPair.slice(0, 2).map(st => ({ student: st, score: 0.95 }));
  }
  const hasPair = (entities.studentFrom && entities.studentTo) || (entities.students && entities.students.length >= 2);
  if (entities.student && entities.student.ambiguous && !hasPair) {
    return { intent: 'AMBIGUOUS', student: '(' + entities.student.matches.map(s=>s.full_name).join(' | ') + ')', amount: entities.amount };
  }
  const intent = app._matchIntent(resolved, entities);
  const stu = entities.student?.student || entities.student;
  // update context like the real flow
  if (intent && stu && !entities.student?.fromContext) app._nlpContext.lastStudent = stu;
  return { intent: intent ? intent.intent : 'NONE', conf: intent?.conf ?? intent?.confidence,
           student: stu?.full_name || null, amount: entities.amount, subject: entities.subject,
           since: entities.sinceDate, sinceLabel: entities.sinceLabel,
           capability: intent?.capability || null,
           from: entities.studentFrom?.student?.full_name || null,
           to: entities.studentTo?.student?.full_name || null,
           pair: entities.students ? entities.students.map(s => s.student.full_name) : null,
           hedge: !!(entities.student && !entities.student.fromContext && entities.student.score < 0.85) };
}

// ── Test battery ───────────────────────────────────────────────
// [input, expectedIntent, expectedStudent(optional substring), resetContext?]
const T = [
  // the reported bug + neighbours
  ['Eli', 'VIEW_STUDENT', 'Eli Morris', true],
  ['Eli d', 'VIEW_STUDENT', 'Elijah Douglas', true],     // D initial -> Douglas, not Eli Morris
  ['Eli K', 'VIEW_STUDENT', 'Elijah Killackey', true],   // K initial -> Killackey
  ['Elijah k', 'VIEW_STUDENT', 'Elijah Killackey', true],
  ['Eli douglas', 'VIEW_STUDENT', 'Elijah Douglas', true],
  ['elijah', 'AMBIGUOUS', null, true],                   // Douglas vs Killackey, no initial -> ask
  ['eli morris', 'VIEW_STUDENT', 'Eli Morris', true],
  ['give eli k 5', 'ADD_RTC', 'Elijah Killackey', true],
  ['eli morris', 'VIEW_STUDENT', 'Eli Morris', true],
  ['charlott', 'VIEW_STUDENT', 'Charlotte Tebow', true],
  ['char', 'VIEW_STUDENT', 'Charlotte Tebow', true],
  // bare names / view
  ['Charlotte', 'VIEW_STUDENT', 'Charlotte Tebow', true],
  ['show me evelyn', 'VIEW_STUDENT', 'Evelyn Hegelund', true],
  ['how much gold does charlotte have', 'VIEW_STUDENT', 'Charlotte Tebow', true],
  ["what's evelyn's balance", 'VIEW_STUDENT', 'Evelyn Hegelund', true],
  ['read evelyn to me', 'VIEW_STUDENT', 'Evelyn Hegelund', true],
  ['tell me about sam carter', 'VIEW_STUDENT', 'Sam Carter', true],
  ['look up olivia', 'VIEW_STUDENT', 'Olivia Brown', true],
  ['pull up mia', 'VIEW_STUDENT', 'Mia Wilson', true],
  // add
  ['give charlotte 2 rtc', 'ADD_RTC', 'Charlotte Tebow', true],
  ['+5 gold to evelyn', 'ADD_RTC', 'Evelyn Hegelund', true],
  ['award sam 10 for great work', 'ADD_RTC', 'Sam Carter', true],
  ['add 3 to olivia', 'ADD_RTC', 'Olivia Brown', true],
  ['7 rtc to noah', 'ADD_RTC', 'Noah Williams', true],
  ['give evelyn hegelund 50', 'ADD_RTC', 'Evelyn Hegelund', true],
  ['plus 4 for mia', 'ADD_RTC', 'Mia Wilson', true],
  // subtract
  ['remove 5 from evelyn', 'SUBTRACT_RTC', 'Evelyn Hegelund', true],
  ['take 3 rtc from sam carter', 'SUBTRACT_RTC', 'Sam Carter', true],
  ['-2 from olivia', 'SUBTRACT_RTC', 'Olivia Brown', true],
  ['subtract 10 from noah', 'SUBTRACT_RTC', 'Noah Williams', true],
  ['minus 4 from mia', 'SUBTRACT_RTC', 'Mia Wilson', true],
  ['deduct 6 from lucas', 'SUBTRACT_RTC', 'Lucas Anderson', true],
  // lists / stats / top (no student)
  ['list all students', 'LIST_STUDENTS', null, true],
  ['show stats', 'VIEW_STATS', null, true],
  ['who has the most rtc', 'VIEW_TOP', null, true],
  ['top 5', 'VIEW_TOP', null, true],
  ['leaderboard', 'VIEW_TOP', null, true],
  ['who has rtc', 'LIST_STUDENTS', null, true],
  // history
  ["show charlotte's history", 'VIEW_HISTORY', 'Charlotte Tebow', true],
  ['evelyn transactions', 'VIEW_HISTORY', 'Evelyn Hegelund', true],
  // no-student action -> still the action intent (so it prompts)
  ['add 2 rtc', 'ADD_RTC', null, true],
  ['remove 5', 'SUBTRACT_RTC', null, true],
  // genuinely ambiguous (two Jones) -> should ask
  ['jones', 'AMBIGUOUS', null, true],
  // typos in names
  ['evlyn', 'VIEW_STUDENT', 'Evelyn Hegelund', true],
  ['give sara 5', 'ADD_RTC', 'Sarah Jones', true],
  ['sophia', 'VIEW_STUDENT', null, true],  // Sophia vs Sofia — ambiguous acceptable; checked loosely below
];

// Aggressive / messy natural language (round 2)
const T2 = [
  ['can you give charlotte 5 rtc please', 'ADD_RTC', 'Charlotte Tebow', true],
  ['please add 10 to evelyn', 'ADD_RTC', 'Evelyn Hegelund', true],
  ['could you show me sam carter', 'VIEW_STUDENT', 'Sam Carter', true],
  ['i want to give olivia 3 coins', 'ADD_RTC', 'Olivia Brown', true],
  ['give 5 to charlotte', 'ADD_RTC', 'Charlotte Tebow', true],
  ['charlotte gets 5 rtc', 'ADD_RTC', 'Charlotte Tebow', true],
  ['bump evelyn by 5', 'ADD_RTC', 'Evelyn Hegelund', true],
  ['dock olivia 5', 'SUBTRACT_RTC', 'Olivia Brown', true],
  ['how many points does noah have', 'VIEW_STUDENT', 'Noah Williams', true],
  ['whats charlottes balance', 'VIEW_STUDENT', 'Charlotte Tebow', true],
  ['check on mia', 'VIEW_STUDENT', 'Mia Wilson', true],
  ['lookup lucas anderson', 'VIEW_STUDENT', 'Lucas Anderson', true],
  ['give sam carter 20 rtc for helping', 'ADD_RTC', 'Sam Carter', true],
  ['take away 5 from olivia', 'SUBTRACT_RTC', 'Olivia Brown', true],
  ['evelyn +10', 'ADD_RTC', 'Evelyn Hegelund', true],
  ['evelyn -10', 'SUBTRACT_RTC', 'Evelyn Hegelund', true],
  ['show top 3', 'VIEW_TOP', null, true],
  ['list students', 'LIST_STUDENTS', null, true],
  ['stats', 'VIEW_STATS', null, true],
  ['mason', 'VIEW_STUDENT', 'Mason Thomas', true],
  ['give noah williams 100 rtc', 'ADD_RTC', 'Noah Williams', true],
  ['reward ava 5', 'ADD_RTC', 'Ava Davis', true],
  ['how much does ava have', 'VIEW_STUDENT', 'Ava Davis', true],
];

// Context follow-up chain (no reset between these)
const CHAIN = [
  ['how much gold does charlotte have', 'VIEW_STUDENT', 'Charlotte Tebow'],
  ['give her 5 gold', 'ADD_RTC', 'Charlotte Tebow'],
  ['read her to me again', 'VIEW_STUDENT', 'Charlotte Tebow'],
  ['remove 5 gold from her', 'SUBTRACT_RTC', 'Charlotte Tebow'],
  ['her history', 'VIEW_HISTORY', 'Charlotte Tebow'],
];

let pass = 0, fail = 0; const fails = [];
function check(input, expIntent, expStu, r) {
  if (r) app._nlpContext = {};
  const got = run(input);
  let ok = got.intent === expIntent;
  if (ok && expStu) ok = got.student === expStu;       // exact full name when specified
  if (got.intent === 'AMBIGUOUS' && expIntent === 'AMBIGUOUS') ok = true;
  if (ok) pass++; else { fail++; fails.push({input, expIntent, expStu, got}); }
  return { got, ok };
}

console.log('== single-shot battery ==');
for (const [inp, ei, es, r] of T) {
  const { got, ok } = check(inp, ei, es, r);
  console.log(`  ${ok?' ok ':'FAIL'} ${JSON.stringify(inp).padEnd(36)} -> ${String(got.intent).padEnd(13)} ${got.student||''}${got.hedge?'  [hedge]':''}`);
}

console.log('\n== round 2: messy natural language ==');
for (const [inp, ei, es, r] of T2) {
  const { got, ok } = check(inp, ei, es, r);
  console.log(`  ${ok?' ok ':'FAIL'} ${JSON.stringify(inp).padEnd(40)} -> ${String(got.intent).padEnd(13)} ${got.student||''}${got.hedge?'  [hedge]':''}`);
}

// Round 3: safety + attendance + undo
const T3 = [
  // 🚨 SAFETY: info-questions must never mutate RTC
  ["give eli's attendance in math over the last 5 weeks", 'VIEW_ATTENDANCE', 'Eli Morris', true],
  ["what's his recent attendance like", 'NONE', null, true],   // no context -> 'his' unresolved -> safe NONE (contextual case in follow-up test)
  ['show me charlotte attendance', 'VIEW_ATTENDANCE', 'Charlotte Tebow', true],
  ['how many days has noah been absent', 'VIEW_ATTENDANCE', 'Noah Williams', true],
  ['evelyn tardies this month', 'VIEW_ATTENDANCE', 'Evelyn Hegelund', true],
  ['give me sam carter grade in math', 'VIEW_GRADES', 'Sam Carter', true],  // grade query: must NOT add RTC; routes to grades reader
  // legit award with attendance as the REASON still works (has rtc) ...
  ['give charlotte 5 rtc for good attendance', 'ADD_RTC', 'Charlotte Tebow', true],
  // ... but without a currency word, an attendance mention blocks the mutation (safe)
  ['give charlotte 5 for good attendance', 'VIEW_ATTENDANCE', 'Charlotte Tebow', true],
  // normal awards unaffected
  ['give charlotte 5 rtc', 'ADD_RTC', 'Charlotte Tebow', true],
  ['give charlotte 5', 'ADD_RTC', 'Charlotte Tebow', true],
  // UNDO
  ['undo that', 'UNDO_RTC', null, true],
  ['undo', 'UNDO_RTC', null, true],
  ['revert that', 'UNDO_RTC', null, true],
  ['take that back', 'UNDO_RTC', null, true],
  ['never mind', 'SMALLTALK:dismiss', null, true],  // never-mind must NOT undo database changes
];
console.log('\n== round 3: safety + attendance + undo ==');
for (const [inp, ei, es, r] of T3) {
  const { got, ok } = check(inp, ei, es, r);
  const extra = got.subject ? ` subj=${got.subject}` : '';
  console.log(`  ${ok?' ok ':'FAIL'} ${JSON.stringify(inp).padEnd(50)} -> ${String(got.intent).padEnd(15)} ${got.student||''}${extra}`);
}

// Entity-extraction spot checks (subject + timeframe parsing)
console.log('\n== entity extraction (subject / timeframe) ==');
function ent(input){ app._nlpContext={}; const n=app._normalizeInput(input); return app._extractEntities(app._resolvePronouns(n), input); }
const E = [
  ["eli's attendance in math over the last 5 weeks", {subject:'math', amount:null, sinceNotNull:true}],
  ['noah attendance past 3 days', {subject:null, amount:null, sinceNotNull:true}],
  ['give charlotte 5 rtc', {amount:5}],
  ['top 5 students', {amount:5}],
];
for (const [inp, exp] of E){
  const e = ent(inp);
  let ok = true;
  if ('subject' in exp) ok = ok && e.subject === exp.subject;
  if ('amount' in exp) ok = ok && e.amount === exp.amount;
  if (exp.sinceNotNull) ok = ok && !!e.sinceDate;
  ok?pass++:(fail++, fails.push({input:inp, expIntent:JSON.stringify(exp), expStu:'', got:{intent:`amt=${e.amount} subj=${e.subject} since=${e.sinceDate}`, student:''}}));
  console.log(`  ${ok?' ok ':'FAIL'} ${JSON.stringify(inp).padEnd(50)} -> amount=${e.amount} subject=${e.subject} since=${e.sinceDate||'-'}`);
}

console.log('\n== pronoun attendance follow-up ==');
app._nlpContext = {};
{
  let g = run('show me eli');                          // sets context to Eli Morris
  let g2 = run("what's his recent attendance like");   // 'his' -> Eli Morris, attendance
  const ok = g2.intent === 'VIEW_ATTENDANCE' && g2.student === 'Eli Morris';
  ok?pass++:(fail++, fails.push({input:"his recent attendance (after 'show me eli')", expIntent:'VIEW_ATTENDANCE', expStu:'Eli Morris', got:g2}));
  console.log(`  ${ok?' ok ':'FAIL'} "show me eli" then "what's his recent attendance" -> ${g2.intent} ${g2.student||''}`);
}

console.log('\n== context follow-up chain ==');
app._nlpContext = {};
for (const [inp, ei, es] of CHAIN) {
  const g = run(inp);
  const stu = g.student;
  const ok = g.intent===ei && stu===es;
  ok?pass++:(fail++, fails.push({input:inp, expIntent:ei, expStu:es, got:g}));
  console.log(`  ${ok?' ok ':'FAIL'} ${JSON.stringify(inp).padEnd(34)} -> ${String(g.intent).padEnd(13)} ${stu||''}`);
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fails.length) { console.log('\nFAILURES:'); for (const f of fails) console.log('  ', JSON.stringify(f.input), 'expected', f.expIntent, f.expStu||'', '=> got', f.got.intent, f.got.student||''); }

// ── Guard / negative battery (run standalone) ──
console.log('\n== guard / no-false-match ==');
const G = [
  ['does sarah jones have rtc', 'VIEW_STUDENT', 'Sarah Jones'],   // 'does' must not match 'Jones'
  ["sarah's balance", 'VIEW_STUDENT', 'Sarah Jones'],
  ['what are the RIVER values', 'SMALLTALK:schoolvalues', null],
  ['what are our school values', 'SMALLTALK:schoolvalues', null],
  ['what does RIVER stand for', 'SMALLTALK:schoolvalues', null],
  ['remind me of the River Tech values', 'SMALLTALK:schoolvalues', null],
  ['spell out the RIVER acronym', 'SMALLTALK:schoolvalues', null],
  ['how are you today', 'SMALLTALK:howareyou', null],
  ['thanks riven', 'SMALLTALK:thanks', null],
  ['hello', 'SMALLTALK:greeting', null],
  ['the students', 'LIST_STUDENTS', null],
  ['give 5', 'ADD_RTC', null],                 // no student -> still add intent (prompts)
];
let gp=0,gf=0;
for (const [inp,ei,es] of G){
  app._nlpContext={}; const g=run(inp);
  let ok=g.intent===ei; if(ok&&es) ok=g.student===es;
  ok?gp++:gf++;
  console.log(`  ${ok?' ok ':'FAIL'} ${JSON.stringify(inp).padEnd(30)} -> ${String(g.intent).padEnd(13)} ${g.student||''}`);
}
console.log(`\nguard: ${gp} pass, ${gf} fail`);


// ── Round 6: live-transcript stress (2026-06-10 conversation) ──────────────
// Every failure from the real teacher conversation, locked in as regressions.
console.log('\n== round 6: transcript stress ==');
const T6 = [
  // conversational layer
  ['Hey hows it going?', 'SMALLTALK:howareyou', null, true],
  ['hello', 'SMALLTALK:greeting', null, true],
  ['thanks riven', 'SMALLTALK:thanks', null, true],
  ['what can you do', 'SMALLTALK:capabilities', null, true],
  ['hi, give charlotte 5 rtc', 'ADD_RTC', 'Charlotte Tebow', true],   // greeting peeled off
  ['history for charlotte', 'VIEW_HISTORY', 'Charlotte Tebow', true], // "hi" must NOT match inside "history"
  // corrections
  ['No not what I meant', 'CORRECTION', null, true],
  ['no, undo that', 'UNDO_RTC', null, true],   // explicit undo wins over correction
  // historical balance
  ['How much RTC did charlotte have yesterday?', 'BALANCE_AT', 'Charlotte Tebow', true],
  ['how much gold did sam have last week', 'BALANCE_AT', 'Sam Carter', true],
  ['how much gold does sam have', 'VIEW_STUDENT', 'Sam Carter', true], // no timeframe -> current
  // unsupported actions: honest decline, never a student card / never RTC
  ['Mark charlotte as present for all classes yesterday.', 'MARK_ATTENDANCE', 'Charlotte Tebow', true],
  ['mark noah absent today', 'MARK_ATTENDANCE', 'Noah Williams', true],
  ['Put 30 gold in the bank', 'CAPABILITY', null, true],
  ['Give charlotte 30 gold in the bank', 'CAPABILITY', null, true],
  ["Let's add charlotte to a math class.", 'ENROLL_STUDENT', 'Charlotte Tebow', true],
  ['enroll noah in filmmaking', 'ENROLL_STUDENT', 'Noah Williams', true],
  ['email her parents about it', 'UNKNOWN_ACTION', null, true],
  // aggregates must not reuse the context student
  ['Ok what students have had spotty attendance recently', 'ATTENDANCE_ISSUES', null, true],
  ['Which students have had recent bad attendance?', 'ATTENDANCE_ISSUES', null, true],
  ['anyone absent this week?', 'ATTENDANCE_ISSUES', null, true],
  // classes
  ['What classes is charlotte in?', 'VIEW_ENROLLMENTS', 'Charlotte Tebow', true],
  ['What math classes do we have in the system?', 'LIST_CLASSES', null, true],
  ['list all classes', 'LIST_CLASSES', null, true],
  // tenure
  ['How long has charlotte been at River Tech?', 'STUDENT_TENURE', 'Charlotte Tebow', true],
  // compare + transfer (multi-student)
  ['Compare how much gold evelyn and charlotte have', 'COMPARE_STUDENTS', null, true],
  ['compare sam and noah', 'COMPARE_STUDENTS', null, true],
  ['Give 2 gold from evelyn to charlotte', 'TRANSFER_RTC', null, true],
  ['transfer 10 rtc from sam to noah', 'TRANSFER_RTC', null, true],
  ['move 5 from olivia to mia', 'TRANSFER_RTC', null, true],
  // notes with quoted content / give-phrasing
  ['Give charlotte a note in math class "Working on pre-calc"', 'ADD_NOTE', null, true],
  // plain mutations still work
  ['give charlotte 5 rtc', 'ADD_RTC', 'Charlotte Tebow', true],
  ['remove 3 from noah', 'SUBTRACT_RTC', 'Noah Williams', true],
];
let p6 = 0, f6 = 0;
for (const [inp, ei, es, r] of T6) {
  if (r) app._nlpContext = {};
  const got = run(inp);
  let ok = got.intent === ei;
  if (ok && es) ok = got.student === es;
  ok ? p6++ : f6++;
  const extra = got.from ? ` ${got.from} -> ${got.to}` : got.pair ? ` [${got.pair.join(', ')}]` : (got.student ? ' ' + got.student : '');
  console.log(`  ${ok ? ' ok ' : 'FAIL'} ${JSON.stringify(inp).padEnd(56)} -> ${String(got.intent).padEnd(18)}${extra}${ok ? '' : '  (expected ' + ei + ')'}`);
}
console.log(`round 6: ${p6} pass, ${f6} fail`);
if (f6) process.exitCode = 1;

// context follow-up regression: aggregate after a single-student query
app._nlpContext = {};
run('show me charlotte');
const agg = run('which students have bad attendance');
const aggOk = agg.intent === 'ATTENDANCE_ISSUES' && !agg.student;
console.log(`  ${aggOk ? ' ok ' : 'FAIL'} context student NOT reused for aggregate -> ${agg.intent} ${agg.student || '(no student)'}`)
if (!aggOk) process.exitCode = 1;


// context-poisoning regression: ambiguous pair then pronoun follow-up
app._nlpContext = {};
run('Compare how much gold evel and charlot have');   // ambiguous fragments, pair bypasses dialog
let poisonOk = true;
try { const r2 = run('give him 5 rtc'); poisonOk = true; } catch (e) { poisonOk = false; console.log('  poison error:', e.message); }
console.log(`  ${poisonOk ? ' ok ' : 'FAIL'} pronoun follow-up after ambiguous compare does not crash`);
if (!poisonOk) process.exitCode = 1;


// ── Round 7: write-capability intents (classes, attendance, grades, contact) ─
console.log('\n== round 7: write capabilities ==');
const T7 = [
  // attendance writes
  ['mark charlotte present in math today', 'MARK_ATTENDANCE', 'Charlotte Tebow', true],
  ['mark noah absent in robotics yesterday', 'MARK_ATTENDANCE', 'Noah Williams', true],
  ['mark sam as late for math', 'MARK_ATTENDANCE', 'Sam Carter', true],
  ['mark charlotte as present for all classes yesterday', 'MARK_ATTENDANCE', 'Charlotte Tebow', true],
  // enrollment
  ['add charlotte to robotics', 'ENROLL_STUDENT', 'Charlotte Tebow', true],
  ['enroll noah in math', 'ENROLL_STUDENT', 'Noah Williams', true],
  ["let's add charlotte to the math class", 'ENROLL_STUDENT', 'Charlotte Tebow', true],
  ['remove charlotte from robotics', 'UNENROLL_STUDENT', 'Charlotte Tebow', true],
  ['drop noah from math', 'UNENROLL_STUDENT', 'Noah Williams', true],
  // these must STAY RTC despite to/from + class words
  ['add 5 rtc to charlotte in math class', 'ADD_RTC', 'Charlotte Tebow', true],
  ['take 3 rtc from sam', 'SUBTRACT_RTC', 'Sam Carter', true],
  ['give 2 rtc from evelyn to charlotte', 'TRANSFER_RTC', null, true],
  // classes
  ['create a class called Chess Club', 'CREATE_CLASS', null, true],
  ['make a new class named Pottery subject Art', 'CREATE_CLASS', null, true],
  ['archive the robotics class', 'DELETE_CLASS', null, true],
  // grades
  ["set charlotte's final grade in math to 95", 'SET_GRADE', 'Charlotte Tebow', true],
  ['give noah a b+ participation grade in robotics', 'SET_GRADE', 'Noah Williams', true],
  ["change sam's academic grade in math to 88", 'SET_GRADE', 'Sam Carter', true],
  ["what are charlotte's grades", 'VIEW_GRADES', 'Charlotte Tebow', true],
  ['grades for the math class', 'VIEW_GRADES', null, true],
  // STUDENT_BRIEFING — the whole picture for one student. These used to land on
  // VIEW_STUDENT, which prints an ACCOUNT card (email, RTC, join date): a
  // confident answer with nothing academic in it.
  ['how is charlotte doing', 'STUDENT_BRIEFING', 'Charlotte Tebow', true],
  ["how's charlotte doing?", 'STUDENT_BRIEFING', 'Charlotte Tebow', true],
  ['what does charlotte need to be working on', 'STUDENT_BRIEFING', 'Charlotte Tebow', true],
  ['what should eli morris be working on', 'STUDENT_BRIEFING', 'Eli Morris', true],
  ['is charlotte struggling', 'STUDENT_BRIEFING', 'Charlotte Tebow', true],
  ['what is charlotte behind on', 'STUDENT_BRIEFING', 'Charlotte Tebow', true],
  ['catch me up on charlotte', 'STUDENT_BRIEFING', 'Charlotte Tebow', true],
  ['how is charlotte coming along', 'STUDENT_BRIEFING', 'Charlotte Tebow', true],
  // ...and the boundaries it must NOT cross. A named subject stays with the
  // grades reader (VIEW_GRADES carries a w:7 sub-pattern for "...doing in X"),
  // and with no student named these stay aggregate/teacher-wide.
  ['how is charlotte doing in math', 'VIEW_GRADES', 'Charlotte Tebow', true],
  ['catch me up', 'BRIEFING', null, true],
  ['charlotte', 'VIEW_STUDENT', 'Charlotte Tebow', true],
  ['compare charlotte and noah grades', 'COMPARE_STUDENTS', null, true],
  // roster
  ["who's in robotics?", 'VIEW_ROSTER', null, true],
  ['show me the math roster', 'VIEW_ROSTER', null, true],
  // contact
  ["change charlotte's phone to 555-123-4567", 'UPDATE_CONTACT', 'Charlotte Tebow', true],
  ["update noah's email to noah@new.com", 'UPDATE_CONTACT', 'Noah Williams', true],
  ["what's charlotte's phone number", 'VIEW_CONTACT', 'Charlotte Tebow', true],
  // unchanged behaviors
  ['show me charlotte attendance', 'VIEW_ATTENDANCE', 'Charlotte Tebow', true],
  ['which students have bad attendance', 'ATTENDANCE_ISSUES', null, true],
  ['what classes is charlotte in', 'VIEW_ENROLLMENTS', 'Charlotte Tebow', true],
  ['note for charlotte: did great today', 'ADD_NOTE', 'Charlotte Tebow', true],
  ['put 30 rtc in the bank', 'CAPABILITY', null, true],
];
let p7 = 0, f7 = 0;
for (const [inp, ei, es, r] of T7) {
  if (r) app._nlpContext = {};
  const got = run(inp);
  let ok = got.intent === ei;
  if (ok && es) ok = got.student === es;
  ok ? p7++ : f7++;
  console.log(`  ${ok ? ' ok ' : 'FAIL'} ${JSON.stringify(inp).padEnd(58)} -> ${String(got.intent).padEnd(17)}${got.student ? ' ' + got.student : ''}${ok ? '' : '  (expected ' + ei + ')'}`);
}
console.log(`round 7: ${p7} pass, ${f7} fail`);
if (f7) process.exitCode = 1;


// ── Round 8: conversation-smoothness transcript (2026-06-11) ────────────────
console.log('\n== round 8: conversation smoothness ==');
// fake group context helper
const T8 = [
  // class follow-ups & rosters
  ['Who is in my math class?', 'VIEW_ROSTER', null, true],
  ["Who is in jordan's math class", 'VIEW_ROSTER', null, true],   // jordan not in fake roster, but intent must hold
  ['the high school math class', 'VIEW_ROSTER', null, true],      // bare class mention -> roster
  // "what about X" reuse is pipeline-level (not in run()), checked live
  // grades without the word "grade"
  ['Give charlotte a b in participation and a c in skill', 'SET_GRADE', 'Charlotte Tebow', true],
  ['give noah a c in skill grade in math', 'SET_GRADE', 'Noah Williams', true],
  ['give charlotte a b in part', 'SET_GRADE', 'Charlotte Tebow', true],
  ['give charlotte a b in participation for math', 'SET_GRADE', 'Charlotte Tebow', true],  // was hijacked by ENROLL
  // reads stay reads
  ['give me sam carter grade in math', 'VIEW_GRADES', 'Sam Carter', true],
  ['what are charlotte grades in math?', 'VIEW_GRADES', 'Charlotte Tebow', true],
  // enrollment still works
  ['add charlotte to robotics', 'ENROLL_STUDENT', 'Charlotte Tebow', true],
  ['remove noah from math', 'UNENROLL_STUDENT', 'Noah Williams', true],
];
let p8 = 0, f8 = 0;
for (const [inp, ei, es, r] of T8) {
  if (r) app._nlpContext = {};
  const got = run(inp);
  let ok = got.intent === ei;
  if (ok && es) ok = got.student === es;
  ok ? p8++ : f8++;
  console.log(`  ${ok ? ' ok ' : 'FAIL'} ${JSON.stringify(inp).padEnd(58)} -> ${String(got.intent).padEnd(17)}${got.student ? ' ' + got.student : ''}${ok ? '' : '  (expected ' + ei + ')'}`);
}
// group context cases
app._nlpContext = { lastGroup: { label: 'Chess', studentIds: ['id1','id2'], timestamp: Date.now() } };
const g1 = run('How much gold do each of them have?');
const g1ok = g1.intent === 'GROUP_BALANCES';
console.log(`  ${g1ok ? ' ok ' : 'FAIL'} "How much gold do each of them have?" (group ctx)   -> ${g1.intent}`);
g1ok ? p8++ : f8++;
app._nlpContext = {};
const g2 = run('how much gold does everyone in math class have?');
const g2ok = g2.intent === 'GROUP_BALANCES';
console.log(`  ${g2ok ? ' ok ' : 'FAIL'} "how much gold does everyone in math class have?"   -> ${g2.intent}`);
g2ok ? p8++ : f8++;
app._nlpContext = {};
const g3 = run('Give everyone in math class 2 rtc');
const g3ok = g3.intent === 'GROUP_RTC';
console.log(`  ${g3ok ? ' ok ' : 'FAIL'} "Give everyone in math class 2 rtc"                 -> ${g3.intent}`);
g3ok ? p8++ : f8++;
console.log(`round 8: ${p8} pass, ${f8} fail`);
if (f8) process.exitCode = 1;


// ── Round 9: adversarial probe regressions ──────────────────────────────────
console.log('\n== round 9: adversarial probes ==');
const T9 = [
  ['who teaches math?', 'CLASS_INFO', null, true],
  ['tell me about the robotics class', 'CLASS_INFO', null, true],
  ['mark everyone in math present today', 'MARK_ATTENDANCE_GROUP', null, true],
  ['take attendance for robotics', 'MARK_ATTENDANCE_GROUP', null, true],
  ['mark charlotte present in math', 'MARK_ATTENDANCE', 'Charlotte Tebow', true],   // per-student unaffected
  ['what did charlotte get on her last test?', 'CAPABILITY', null, true],
  ['show me noah test scores', 'CAPABILITY', null, true],
  ['yes', 'SMALLTALK:stray_yes', null, true],
];
let p9 = 0, f9 = 0;
for (const [inp, ei, es, r] of T9) {
  if (r) app._nlpContext = {};
  const got = run(inp);
  let ok = got.intent === ei;
  if (ok && es) ok = got.student === es;
  ok ? p9++ : f9++;
  console.log(`  ${ok ? ' ok ' : 'FAIL'} ${JSON.stringify(inp).padEnd(52)} -> ${String(got.intent).padEnd(20)}${ok ? '' : ' (expected ' + ei + ')'}`);
}
// multi-award pair detection
app._nlpContext = {};
const ma = run('give 5 rtc to charlotte and noah');
const maOk = ma.intent === 'ADD_RTC' && ma.pair && ma.pair.length === 2;
console.log(`  ${maOk ? ' ok ' : 'FAIL'} "give 5 rtc to charlotte and noah" -> ${ma.intent} pair=${JSON.stringify(ma.pair)}`);
maOk ? p9++ : f9++;
console.log(`round 9: ${p9} pass, ${f9} fail`);
if (f9) process.exitCode = 1;


// ── Round 10: picker-loop transcript + briefing ─────────────────────────────
console.log('\n== round 10: picker loop + briefing ==');
let p10 = 0, f10 = 0;
const t10 = (label, ok) => { ok ? p10++ : f10++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); };
// pinned class must not re-expand to siblings (the infinite picker loop)
app._nlpContext = {};
app._terminalPinnedClass = 'c1';
const pinned = app._rivenMatchClass('who teaches that math class');
t10('pinned class returns single non-ambiguous match', !!(pinned && pinned.pinned && !pinned.ambiguous && pinned.id === 'c1'));
app._terminalPinnedClass = null;
// teacher-name narrowing without "with" (possessive)
app._terminalAllClasses.push(
  { id: 'c5', name: 'English', subject: 'English', teacher_id: 't9', secondary_teacher_id: null, is_active: true, teacher_name: 'Caitlin Relvas' },
  { id: 'c6', name: 'English', subject: 'English', teacher_id: 't1', secondary_teacher_id: null, is_active: true, teacher_name: 'MS Teacher' },
  { id: 'c7', name: 'English', subject: 'English', teacher_id: 't1', secondary_teacher_id: null, is_active: true, teacher_name: 'MS Teacher' }
);
const caitlin = app._rivenMatchClass('pull up caitlins english class');
t10('"caitlins english" narrows to Caitlin Relvas', !!(caitlin && !caitlin.ambiguous && caitlin.id === 'c5'));
// intents
app._nlpContext = {};
const ci1 = run('which math class is that?');
t10(`"which math class is that?" -> CLASS_INFO (got ${ci1.intent})`, ci1.intent === 'CLASS_INFO');
const ci2 = run('which math class is charlotte in?');
t10(`"which math class is charlotte in?" -> CLASS_INFO (got ${ci2.intent})`, ci2.intent === 'CLASS_INFO');
const ve = run('what classes is charlotte in?');
t10(`"what classes is charlotte in?" still VIEW_ENROLLMENTS (got ${ve.intent})`, ve.intent === 'VIEW_ENROLLMENTS');
const br = run('anything I should know?');
t10(`"anything I should know?" -> BRIEFING (got ${br.intent})`, br.intent === 'BRIEFING');
const br2 = run('catch me up');
t10(`"catch me up" -> BRIEFING (got ${br2.intent})`, br2.intent === 'BRIEFING');
const mr = run('mark them all as read');
t10(`"mark them all as read" -> MARK_READ (got ${mr.intent})`, mr.intent === 'MARK_READ');
const bug = run("Hmm that's a bug.");
t10(`"that's a bug" -> SMALLTALK:bugreport (got ${bug.intent})`, bug.intent === 'SMALLTALK:bugreport');
console.log(`round 10: ${p10} pass, ${f10} fail`);
if (f10) process.exitCode = 1;


// context-pollution regression: pronouns never fuzzy-match, non-student
// intents never set lastStudent
app._nlpContext = {};
const mk = run('mark them all as read');
const mkOk = mk.intent === 'MARK_READ' && !app._nlpContext.lastStudent;
console.log(`  ${mkOk ? ' ok ' : 'FAIL'} "mark them all as read" leaves no context student (got ${mk.intent}, lastStudent=${app._nlpContext.lastStudent?.full_name || 'null'})`);
if (!mkOk) process.exitCode = 1;


// ── Round 11: context accuracy (2026-06-11 second transcript) ───────────────
console.log('\n== round 11: context accuracy ==');
let p11 = 0, f11 = 0;
const t11 = (label, ok) => { ok ? p11++ : f11++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const gm = run('give me the chess class');   // chess not in fake roster -> use math
const gm2 = run('give me the math class');
t11(`"give me the math class" -> CLASS_INFO (got ${gm2.intent})`, gm2.intent === 'CLASS_INFO');
const sa = run('show all classes');
t11(`"show all classes" still LIST_CLASSES (got ${sa.intent})`, sa.intent === 'LIST_CLASSES');
// group context: "all those students"
app._nlpContext = { lastGroup: { label: 'Math', classId: 'c1', studentIds: ['a','b'], timestamp: Date.now() } };
const gt = run('give all those students 5 rtc');
t11(`"give all those students 5 rtc" -> GROUP_RTC (got ${gt.intent})`, gt.intent === 'GROUP_RTC');
const gn = run('everyone in the math class needs 5 rtc');
t11(`"everyone in math needs 5 rtc" -> GROUP_RTC (got ${gn.intent})`, gn.intent === 'GROUP_RTC');
// "that class" context reference
app._nlpContext = { lastClass: { id: 'c2', name: 'Robotics', timestamp: Date.now() } };
const tc = run('add charlotte to that class');
t11(`"add charlotte to that class" -> ENROLL_STUDENT (got ${tc.intent})`, tc.intent === 'ENROLL_STUDENT');
console.log(`round 11: ${p11} pass, ${f11} fail`);


// ── Round 12: wrong-target group awards + class typos ───────────────────────
console.log('\n== round 12: group context safety ==');
let p12 = 0, f12 = 0;
const t12 = (label, ok) => { ok ? p12++ : f12++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
// THE bug: roster then "give them all 2 gold" must be a GROUP award and must
// NOT inject the stale single student from before
app._nlpContext = { lastStudent: { id: 'idX', full_name: 'Chev Moen', first_name: 'Chev', last_name: 'Moen' }, timestamp: Date.now() - 5000,
                    lastGroup: { label: 'Math', classId: 'c1', studentIds: ['a','b'], timestamp: Date.now() } };
const r12a = run('give them all 2 gold');
t12(`"give them all 2 gold" -> GROUP_RTC, no student (got ${r12a.intent}, student=${r12a.student || 'null'})`, r12a.intent === 'GROUP_RTC' && !r12a.student);
const r12b = run('no give all math class 2 gold');
t12(`"give all math class 2 gold" -> GROUP_RTC (got ${r12b.intent})`, r12b.intent === 'GROUP_RTC');
const r12c = run('give the class 2 rtc');
t12(`"give the class 2 rtc" -> GROUP_RTC (got ${r12c.intent})`, r12c.intent === 'GROUP_RTC');
// single award still works with group context present
const r12d = run('give charlotte 2 rtc');
t12(`"give charlotte 2 rtc" stays ADD_RTC (got ${r12d.intent} ${r12d.student})`, r12d.intent === 'ADD_RTC' && r12d.student === 'Charlotte Tebow');
// class typo beats weak student match
app._nlpContext = {};
const ty = run('robotcs');
t12(`"robotcs" (typo) -> VIEW_ROSTER for Robotics (got ${ty.intent})`, ty.intent === 'VIEW_ROSTER');
const ty2 = run('charlote');
t12(`"charlote" (typo) still VIEW_STUDENT Charlotte (got ${ty2.intent} ${ty2.student})`, ty2.intent === 'VIEW_STUDENT' && ty2.student === 'Charlotte Tebow');
console.log(`round 12: ${p12} pass, ${f12} fail`);


// ── Round 13: nickname matching, repeat, removal phrasing ───────────────────
console.log('\n== round 13: nickname + repeat ==');
let p13 = 0, f13 = 0;
const t13 = (label, ok) => { ok ? p13++ : f13++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._terminalAllStudents.push({ id: 'idD', first_name: 'Daenerys', last_name: 'Hegelund', full_name: 'Daenerys Hegelund', rtc_balance: 374, email: 'd@x.com' });
app._nlpContext = {};
const nick = run('how much gold does daeny have');
t13(`"daeny" -> Daenerys (got ${nick.intent} ${nick.student || 'null'})`, nick.intent === 'VIEW_STUDENT' && nick.student === 'Daenerys Hegelund');
const nick2 = run('hey how much gold does daeny have');
t13(`greeting + "daeny" works (got ${nick2.intent} ${nick2.student || 'null'})`, nick2.intent === 'VIEW_STUDENT' && nick2.student === 'Daenerys Hegelund');
const rm = run('remove 4 gold from daenerys');
t13(`"remove 4 gold from daenerys" -> SUBTRACT_RTC (got ${rm.intent})`, rm.intent === 'SUBTRACT_RTC' && rm.student === 'Daenerys Hegelund');
const rep = run('do it again');
t13(`"do it again" -> REPEAT (got ${rep.intent})`, rep.intent === 'REPEAT');
const rep2 = run('again');
t13(`"again" -> REPEAT (got ${rep2.intent})`, rep2.intent === 'REPEAT');
console.log(`round 13: ${p13} pass, ${f13} fail`);


// ── Round 14: cycle-1 comprehensive fixes ───────────────────────────────────
console.log('\n== round 14: cycle-1 fixes ==');
let p14 = 0, f14 = 0;
const t14 = (label, ok) => { ok ? p14++ : f14++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const w1 = run('give charlotte five rtc');
t14(`word numbers: "five rtc" -> ADD_RTC amount 5 (got ${w1.intent} amt=${w1.amount})`, w1.intent === 'ADD_RTC' && w1.amount === 5);
const w2 = run('one more time');
t14(`"one more time" still REPEAT (got ${w2.intent})`, w2.intent === 'REPEAT');
const nm = run('never mind');
t14(`"never mind" -> dismiss, never undo (got ${nm.intent})`, nm.intent === 'SMALLTALK:dismiss');
const ih = run('is charlotte here today?');
t14(`"is charlotte here today?" -> VIEW_ATTENDANCE (got ${ih.intent})`, ih.intent === 'VIEW_ATTENDANCE' && ih.student === 'Charlotte Tebow');
const mv = run('move charlotte from math to robotics');
t14(`"move X from math to robotics" -> MOVE_STUDENT (got ${mv.intent})`, mv.intent === 'MOVE_STUDENT');
const al = run('what did you just do?');
t14(`"what did you just do?" -> ACTIVITY_LOG (got ${al.intent})`, al.intent === 'ACTIVITY_LOG');
const dn = run('remove that note');
t14(`"remove that note" -> DELETE_NOTE (got ${dn.intent})`, dn.intent === 'DELETE_NOTE');
const cv = run('average grade in math vs robotics');
t14(`"math vs robotics" -> CLASS_VS (got ${cv.intent})`, cv.intent === 'CLASS_VS');
const tp = run('top 5 in math');
t14(`"top 5 in math" -> VIEW_TOP w/ class (got ${tp.intent})`, tp.intent === 'VIEW_TOP');
// weekday timeframe
const ents = app._extractEntities(app._normalizeInput('what was charlotte attendance on monday'), 'what was charlotte attendance on monday');
t14(`weekday parse: sinceDate === untilDate (${ents.sinceDate} / ${ents.untilDate})`, !!ents.sinceDate && ents.sinceDate === ents.untilDate);
// transfer still wins for money
app._nlpContext = {};
const tr = run('move 5 rtc from charlotte to noah');
t14(`"move 5 rtc from A to B" still TRANSFER_RTC (got ${tr.intent})`, tr.intent === 'TRANSFER_RTC');
console.log(`round 14: ${p14} pass, ${f14} fail`);


// specific-name-wins regression
app._terminalAllClasses.push({ id: 'c8', name: 'College Dual Math', subject: 'Mathematics', teacher_id: 't2', secondary_teacher_id: null, is_active: true, teacher_name: 'Jordan Ezell' });
const cdm = app._rivenMatchClass('move charlotte from math to college dual math'.split(' to ')[1]);
const cdmOk = cdm && !cdm.ambiguous && cdm.id === 'c8';
console.log(`  ${cdmOk ? ' ok ' : 'FAIL'} "college dual math" resolves to the specific class, not plain Math`);
if (!cdmOk) process.exitCode = 1;


// ── Round 15: confidence-scoring matcher (idea #1) ──────────────────────────
console.log('\n== round 15: scored intent matcher ==');
let p15 = 0, f15 = 0;
const t15 = (label, ok) => { ok ? p15++ : f15++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
// note-command guard: an explicit note command never mutates anything else
const n1 = run('note that charlotte was absent today');
t15(`"note that X was absent" -> ADD_NOTE, never MARK_ATTENDANCE (got ${n1.intent})`, n1.intent === 'ADD_NOTE');
const n2 = run('take a note: charlotte owes 5 problems');
t15(`"take a note: X owes 5" -> ADD_NOTE, never SUBTRACT_RTC (got ${n2.intent})`, n2.intent === 'ADD_NOTE');
const n3 = run('log a note that charlotte got a b in participation');
t15(`note command beats SET_GRADE (got ${n3.intent})`, n3.intent === 'ADD_NOTE');
// bank guard: "bank" makes RTC phrasing a banking request
const b1 = run('give charlotte 30 gold in the bank');
t15(`"give X 30 gold in the bank" -> bank capability, not ADD_RTC (got ${b1.intent})`, b1.intent === 'CAPABILITY');
// from-to structure belongs to MOVE, never half-enroll
const m1 = run('move charlotte from math to robotics');
t15(`from..to -> MOVE_STUDENT, not ENROLL/UNENROLL (got ${m1.intent})`, m1.intent === 'MOVE_STUDENT');
// topical noun beats generic catch-all regardless of position
const g1x = run('show me charlottes grades');
t15(`"show X's grades" -> VIEW_GRADES, not VIEW_STUDENT (got ${g1x.intent})`, g1x.intent === 'VIEW_GRADES');
const g2x = run('show me charlottes notes about attendance');
t15(`"notes about attendance" -> VIEW_NOTES, not VIEW_ATTENDANCE (got ${g2x.intent})`, g2x.intent === 'VIEW_NOTES');
const g3x = run('delete the note about charlotte');
t15(`"delete the note about X" -> DELETE_NOTE (got ${g3x.intent})`, g3x.intent === 'DELETE_NOTE');
// RTC phrasing still subtracts even when "notes" appears as plain noun
const g4x = run('remove 5 rtc from charlotte for not taking notes');
t15(`"remove 5 rtc ... for not taking notes" still SUBTRACT_RTC (got ${g4x.intent})`, g4x.intent === 'SUBTRACT_RTC');
// margin/score surfaced for the embedding fallback hook
const sc = app._matchIntent('show me charlottes grades', { student: { student: { full_name: 'Charlotte Tebow' } } });
t15(`matcher exposes score+margin (score=${sc && sc.score}, margin=${sc && sc.margin})`, !!sc && typeof sc.score === 'number' && typeof sc.margin === 'number');
console.log(`round 15: ${p15} pass, ${f15} fail`);


// ── Round 16: attendance question forms + lastResort tagging ────────────────
console.log('\n== round 16: attendance questions + semantic hooks ==');
let p16 = 0, f16 = 0;
const t16 = (label, ok) => { ok ? p16++ : f16++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const q1 = run('was charlotte late today?');
t16(`"was X late today?" -> VIEW_ATTENDANCE read (got ${q1.intent})`, q1.intent === 'VIEW_ATTENDANCE');
const q2 = run('is charlotte usually on time?');
t16(`"is X usually on time?" -> VIEW_ATTENDANCE (got ${q2.intent})`, q2.intent === 'VIEW_ATTENDANCE');
const q3 = run('charlotte was late today');
t16(`statement "X was late" still MARK_ATTENDANCE write (got ${q3.intent})`, q3.intent === 'MARK_ATTENDANCE');
const q4 = run('mark charlotte late in math');
t16(`"mark X late in math" still MARK_ATTENDANCE (got ${q4.intent})`, q4.intent === 'MARK_ATTENDANCE');
// lastResort flags exist so the semantic layer can pre-empt the guess
const lr1 = app._matchIntent('blarghle flurp charlotte zoop', { student: { student: { full_name: 'Charlotte Tebow' } } });
t16(`generic student-card fallback is tagged lastResort (got ${lr1 && lr1.intent}/${lr1 && lr1.lastResort})`, !!lr1 && lr1.intent === 'VIEW_STUDENT' && lr1.lastResort === true);
// UNKNOWN_ACTION no longer tagged lastResort — removing that flag was the
// Phase 1 fix so "remind me to call X's parents" doesn't mis-route via semantic
const lr2 = app._matchIntent('please excuse charlotte for tomorrow', { student: { student: { full_name: 'Charlotte Tebow' } } });
t16(`UNKNOWN_ACTION is NOT tagged lastResort (got ${lr2 && lr2.intent}/${lr2 && lr2.lastResort})`, !!lr2 && lr2.intent === 'UNKNOWN_ACTION' && lr2.lastResort !== true);
console.log(`round 16: ${p16} pass, ${f16} fail`);


// ── Round 17: bare possessives + rtc-fallback lastResort ────────────────────
console.log('\n== round 17: possessives + rtc fallback ==');
let p17 = 0, f17 = 0;
const t17 = (label, ok) => { ok ? p17++ : f17++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const ps1 = run('show me charlottes grades');
t17(`"charlottes" (no apostrophe) -> exact-score match, no hedge (got ${ps1.intent} ${ps1.student} score path)`, ps1.intent === 'VIEW_GRADES' && ps1.student === 'Charlotte Tebow');
const ps2 = app._fuzzyFindStudent('charlottes grades', 'charlottes grades');
t17(`bare possessive scores >= 0.95 (got ${ps2 && ps2.score})`, !!ps2 && ps2.score >= 0.95);
const rf1 = app._matchIntent('hook charlotte up with some rtc', { student: { student: { full_name: 'Charlotte Tebow' } } });
t17(`"hook X up with some rtc" is a weak win (score<=15) the semantic layer may pre-empt (got ${rf1 && rf1.intent} score=${rf1 && rf1.score})`, !!rf1 && rf1.intent === 'VIEW_STUDENT' && rf1.score <= 15);
const rf2 = run('give charlotte 5 rtc');
t17(`writes always score above the pre-empt band (ADD_RTC executes) (got ${rf2.intent})`, rf2.intent === 'ADD_RTC');
console.log(`round 17: ${p17} pass, ${f17} fail`);


// ── Round 18: fresh group owns plural pronouns ──────────────────────────────
console.log("\n== round 18: group pronoun vs stale student ==");
let p18 = 0, f18 = 0;
const t18 = (label, ok) => { ok ? p18++ : f18++; console.log(`  ${ok ? " ok " : "FAIL"} ${label}`); if (!ok) process.exitCode = 1; };
// simulate: looked at a student, then pulled a roster (group is fresher)
app._nlpContext = { lastStudent: app._terminalAllStudents[0], timestamp: 1000,
  lastGroup: { students: app._terminalAllStudents.slice(0,3), timestamp: 2000 } };
const gp1 = run("how much gold do they have");
t18(`roster then "how much gold do they have" -> GROUP_BALANCES, no injected student (got ${gp1.intent} stu=${gp1.student})`, gp1.intent === "GROUP_BALANCES" && !gp1.student);
const gp2 = run("how much rtc do they all have");
t18(`"how much rtc do they all have" -> GROUP_BALANCES (got ${gp2.intent})`, gp2.intent === "GROUP_BALANCES");
// student fresher than group: "they" resolves to the student as before
app._nlpContext = { lastStudent: app._terminalAllStudents[0], timestamp: 3000,
  lastGroup: { students: app._terminalAllStudents.slice(0,3), timestamp: 2000 } };
const gp3 = run("how much gold do they have");
t18(`student fresher: pronoun still resolves to the student (got ${gp3.intent} ${gp3.student})`, gp3.student === app._terminalAllStudents[0].full_name);
console.log(`round 18: ${p18} pass, ${f18} fail`);


// ── Round 19: class pronoun "it" + multi-student enroll routing ─────────────
console.log('\n== round 19: class pronoun + pair enroll ==');
let p19 = 0, f19 = 0;
const t19 = (label, ok) => { ok ? p19++ : f19++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = { lastClass: { id: 'c1', name: 'Math', timestamp: 2000 } };
const cp1 = run('add charlotte to it');
t19(`"add charlotte to it" -> ENROLL_STUDENT via lastClass (got ${cp1.intent})`, cp1.intent === 'ENROLL_STUDENT');
const cp2 = run('who is in it');
t19(`"who is in it" -> VIEW_ROSTER via lastClass (got ${cp2.intent})`, cp2.intent === 'VIEW_ROSTER');
app._nlpContext = { lastClass: { id: 'c1', name: 'Math', timestamp: 2000 } };
const cp3 = run('add charlotte and noah to it');
t19(`"add charlotte and noah to it" -> ENROLL_STUDENT with pair (got ${cp3.intent} pair=${JSON.stringify(cp3.pair)})`, cp3.intent === 'ENROLL_STUDENT' && Array.isArray(cp3.pair) && cp3.pair.length === 2);
app._nlpContext = {};
const cp4 = run('do it again');
t19(`"do it again" still REPEAT, not class pronoun (got ${cp4.intent})`, cp4.intent === 'REPEAT');
const cp5 = run('remove 4 rtc from charlotte');
t19(`"remove 4 rtc from X" unaffected (got ${cp5.intent})`, cp5.intent === 'SUBTRACT_RTC');
console.log(`round 19: ${p19} pass, ${f19} fail`);


// ── Round 20: numbers inside class names ────────────────────────────────────
console.log('\n== round 20: word-number class names ==');
let p20 = 0, f20 = 0;
const t20 = (label, ok) => { ok ? p20++ : f20++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._terminalAllClasses.push({ id: 'c9', name: 'Cycle Three Test', subject: 'science', teacher_id: 't1', secondary_teacher_id: null, is_active: true, teacher_name: 'Test Teacher' });
app._nlpContext = {};
const wn1 = run('add charlotte and noah to cycle three test');
t20(`"add X and Y to cycle three test" -> ENROLL, no phantom amount (got ${wn1.intent} amt=${wn1.amount})`, wn1.intent === 'ENROLL_STUDENT' && wn1.amount == null);
const wn2 = run('add charlotte to cycle three test');
t20(`single enroll into number-named class (got ${wn2.intent} amt=${wn2.amount})`, wn2.intent === 'ENROLL_STUDENT' && wn2.amount == null);
const wn3 = run('give charlotte 5 rtc in cycle three test');
t20(`real amount survives next to number-named class (got ${wn3.intent} amt=${wn3.amount})`, wn3.intent === 'ADD_RTC' && wn3.amount === 5);
const cm = app._rivenMatchClass('add charlotte to cycle 3 test');
t20(`_rivenMatchClass resolves "cycle 3 test" as a FULL match (got ${cm && cm.name}, ambiguous=${cm && !!cm.ambiguous})`, !!cm && !cm.ambiguous && cm.id === 'c9');
console.log(`round 20: ${p20} pass, ${f20} fail`);


// ── Round 21: my classes, rename, help, owned-class preference ──────────────
console.log('\n== round 21: my classes + rename + help ==');
let p21 = 0, f21 = 0;
const t21 = (label, ok) => { ok ? p21++ : f21++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const mc1 = run('show me my classes');
t21(`"show me my classes" -> LIST_CLASSES (got ${mc1.intent})`, mc1.intent === 'LIST_CLASSES');
const mc2 = run('my classes');
t21(`bare "my classes" -> LIST_CLASSES (got ${mc2.intent})`, mc2.intent === 'LIST_CLASSES');
const mc3 = run('what do i teach');
t21(`"what do i teach" -> LIST_CLASSES (got ${mc3.intent})`, mc3.intent === 'LIST_CLASSES');
const rn1 = run('rename the math class to Math Test');
t21(`"rename the math class to X" -> RENAME_CLASS (got ${rn1.intent})`, rn1.intent === 'RENAME_CLASS');
app._nlpContext = { lastClass: { id: 'c1', name: 'Math', timestamp: 2000 } };
const rn2 = run('rename it to Math Test');
t21(`"rename it to X" -> RENAME_CLASS via lastClass (got ${rn2.intent})`, rn2.intent === 'RENAME_CLASS');
app._nlpContext = {};
const rn3 = run('rename jordan');
t21(`"rename jordan" (no class) -> honest UNKNOWN_ACTION, never a card (got ${rn3.intent})`, rn3.intent === 'UNKNOWN_ACTION');
const h1 = run('i would like to test how this works. what can i do?');
t21(`"test how this works, what can i do" -> HELP, not tests capability (got ${h1.intent})`, h1.intent === 'HELP');
const h2 = run('what can you do');
t21(`"what can you do" -> help or capabilities smalltalk (got ${h2.intent})`, h2.intent === 'HELP' || h2.intent === 'SMALLTALK:capabilities');
const cap1 = run('what did charlotte get on her test');
t21(`"what did X get on her test" still tests capability (got ${cap1.intent}/${cap1.capability})`, cap1.intent === 'CAPABILITY' && cap1.capability === 'tests');
// owned-class preference: teacher t1 owns c1 (Math); plain "math" ambiguity prefers t1's
const ownedRows = [
  { id: 'cA', name: 'English', teacher_id: 't9', secondary_teacher_id: null },
  { id: 'cB', name: 'English', teacher_id: 't1', secondary_teacher_id: null },
  { id: 'cC', name: 'English', teacher_id: 't1', secondary_teacher_id: null }
];
const pref = app._preferOwnedClasses(ownedRows, { qualified: false });
t21(`_preferOwnedClasses narrows 3 -> own 2 (got ${pref.length})`, pref.length === 2 && pref.every(c => c.teacher_id === 't1'));
const prefQ = app._preferOwnedClasses(ownedRows, { qualified: true });
t21(`qualifier present -> no ownership narrowing (got ${prefQ.length})`, prefQ.length === 3);
console.log(`round 21: ${p21} pass, ${f21} fail`);


// ── Round 22: first-person never injects the last student; primary-over-secondary ──
console.log("\n== round 22: first person + primary teacher preference ==");
let p22 = 0, f22 = 0;
const t22 = (label, ok) => { ok ? p22++ : f22++; console.log(`  ${ok ? " ok " : "FAIL"} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = { lastStudent: app._terminalAllStudents[0], timestamp: 1000 };
const fp1 = run("show me my classes");
t22(`"show me my classes" with stale lastStudent -> LIST_CLASSES, no injection (got ${fp1.intent} stu=${fp1.student})`, fp1.intent === "LIST_CLASSES" && !fp1.student);
app._nlpContext = { lastStudent: app._terminalAllStudents[0], timestamp: 1000 };
const fp2 = run("show their grades");
t22(`"show their grades" still uses the last student (got ${fp2.intent} ${fp2.student})`, fp2.intent === "VIEW_GRADES" && fp2.student === app._terminalAllStudents[0].full_name);
const mix = [
  { id: "x1", name: "English", teacher_id: "OTHER", secondary_teacher_id: "ME" },
  { id: "x2", name: "English", teacher_id: "ME", secondary_teacher_id: null },
  { id: "x3", name: "English", teacher_id: "ME", secondary_teacher_id: null }
];
const saveUI = app.userInfo; app.userInfo = { user: { id: "ME" } };
const pr = app._preferOwnedClasses(mix, { qualified: false });
t22(`secondary role never beats primary: 3 -> 2 primary (got ${pr.length})`, pr.length === 2 && pr.every(c => c.teacher_id === "ME"));
const onlySec = app._preferOwnedClasses(mix.slice(0,1).concat([{ id:"x4", name:"English", teacher_id:"OTHER2", secondary_teacher_id:null }]), { qualified: false });
t22(`secondary-only ownership still narrows (got ${onlySec.length})`, onlySec.length === 1 && onlySec[0].id === "x1");
app.userInfo = saveUI;
console.log(`round 22: ${p22} pass, ${f22} fail`);


// ── Round 23: topical wins are never second-guessed by the semantic layer ───
console.log('\n== round 23: weak-win band is pattern weight, not score ==');
let p23 = 0, f23 = 0;
const t23 = (label, ok) => { ok ? p23++ : f23++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const wv1 = run('show me all my classes');
t23(`"show me all my classes" -> LIST_CLASSES (got ${wv1.intent})`, wv1.intent === 'LIST_CLASSES');
const wv1i = app._matchIntent('show me all my classes', {});
t23(`...with topical weight w=5, OUTSIDE the semantic pre-empt band (got w=${wv1i && wv1i.w})`, !!wv1i && wv1i.w >= 4);
const wv2 = app._matchIntent('hook charlotte up with some rtc', { student: { student: { full_name: 'Charlotte Tebow' } } });
t23(`generic catch-all match stays IN the band (got ${wv2 && wv2.intent} w=${wv2 && wv2.w})`, !!wv2 && wv2.intent === 'VIEW_STUDENT' && wv2.w <= 3);
const wv3 = run('can you understand me?');
t23(`"can you understand me?" -> HELP (got ${wv3.intent})`, wv3.intent === 'HELP');
const wv4 = run('show me my classes');
t23(`"show me my classes" still LIST_CLASSES (got ${wv4.intent})`, wv4.intent === 'LIST_CLASSES');
console.log(`round 23: ${p23} pass, ${f23} fail`);


// ── Round 24: contact/email, membership question, no regressions ────────────
console.log('\n== round 24: email + membership + neighbours ==');
let p24 = 0, f24 = 0;
const t24 = (label, ok) => { ok ? p24++ : f24++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const e1 = run('whats charlottes email?');
t24(`"whats X's email" -> VIEW_CONTACT (got ${e1.intent})`, e1.intent === 'VIEW_CONTACT');
const e2 = run('is charlotte in math?');
t24(`"is X in math?" -> VIEW_ENROLLMENTS (got ${e2.intent})`, e2.intent === 'VIEW_ENROLLMENTS');
const e3 = run('is charlotte in school today?');
t24(`"is X in school today?" still VIEW_ATTENDANCE (got ${e3.intent})`, e3.intent === 'VIEW_ATTENDANCE');
const e4 = run('update charlottes email to a@b.com');
t24(`"update X's email to..." still UPDATE_CONTACT write (got ${e4.intent})`, e4.intent === 'UPDATE_CONTACT');
console.log(`round 24: ${p24} pass, ${f24} fail`);


// ── Round 25: writes never pre-empted; topic-noun typos ─────────────────────
console.log("\n== round 25: write protection + noun typos ==");
let p25 = 0, f25 = 0;
const t25 = (label, ok) => { ok ? p25++ : f25++; console.log(`  ${ok ? " ok " : "FAIL"} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const tn1 = run("show me charlottes attendnace");
t25(`"attendnace" typo -> VIEW_ATTENDANCE (got ${tn1.intent})`, tn1.intent === "VIEW_ATTENDANCE");
const tn2 = run("what are charlottes grdes");
t25(`"grdes" typo -> VIEW_GRADES (got ${tn2.intent})`, tn2.intent === "VIEW_GRADES");
const tn3 = run("give charlotte 3 gold for helping");
t25(`plain award still ADD_RTC with w<=3 (got ${tn3.intent})`, tn3.intent === "ADD_RTC");
const tn4 = run("how much gold does noah have");
t25(`names untouched by the noun typo pass (got ${tn4.intent} ${tn4.student})`, tn4.intent === "VIEW_STUDENT" && tn4.student === "Noah Williams");
console.log(`round 25: ${p25} pass, ${f25} fail`);

// round 25b: real words survive the typo corrector
const tn5 = run("set charlotte's final grade in math to 95");
const tn5ok = tn5.intent === 'SET_GRADE';
console.log(`  ${tn5ok ? ' ok ' : 'FAIL'} "set X's final grade to 95" stays SET_GRADE after noun-typo pass (got ${tn5.intent})`);
if (!tn5ok) process.exitCode = 1;


// ── Round 26: transcript fixes — Games/game, both-of-them, purchases, dany ──
console.log('\n== round 26: surname-vs-class, both, purchases ==');
let p26 = 0, f26 = 0;
const t26 = (label, ok) => { ok ? p26++ : f26++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
// surname must not typo-match a class word
app._terminalAllStudents.push({ id: 'idG', first_name: 'Jordan', last_name: 'Games', full_name: 'Jordan Games', rtc_balance: 175, email: 'j@x.com' });
app._terminalAllClasses.push({ id: 'cAI', name: 'AI Game Design', subject: 'Computer Science', teacher_id: 't2', secondary_teacher_id: null, is_active: true, teacher_name: 'Jordan Ezell' });
app._nlpContext = {};
const sg1 = run('what are jordan games grades');
t26(`"jordan games grades" -> VIEW_GRADES for the STUDENT, no class hijack (got ${sg1.intent} ${sg1.student})`, sg1.intent === 'VIEW_GRADES' && sg1.student === 'Jordan Games');
const cmG = app._rivenMatchClass('show all jordan games classes');
t26(`"games" never typo-matches "AI Game Design" (got ${cmG ? cmG.name : 'null'})`, !cmG || cmG.name !== 'AI Game Design');
// "both of them" targets the last pair
app._nlpContext = { lastStudent: app._terminalAllStudents[0], timestamp: 2000,
  lastPair: [app._terminalAllStudents[0], app._terminalAllStudents[1]] };
const bo1 = run('remove 5 gold from both of them for a spoon');
t26(`"remove 5 from both of them" -> SUBTRACT pair (got ${bo1.intent} pair=${JSON.stringify(bo1.pair)})`, bo1.intent === 'SUBTRACT_RTC' && Array.isArray(bo1.pair) && bo1.pair.length === 2);
// purchases are deductions
app._nlpContext = {};
const pu1 = run('charlotte and noah are buying a privilege for 2 gold');
t26(`"X and Y are buying ... for 2 gold" -> SUBTRACT pair (got ${pu1.intent} pair=${JSON.stringify(pu1.pair)})`, pu1.intent === 'SUBTRACT_RTC' && Array.isArray(pu1.pair) && pu1.pair.length === 2);
const pu2 = run('charlotte bought a snack for 3');
t26(`"X bought a snack for 3" -> SUBTRACT (got ${pu2.intent})`, pu2.intent === 'SUBTRACT_RTC');
const pu3 = run('give charlotte 5 for buying supplies');
t26(`"give X 5 for buying supplies" stays ADD (buy-verb after amount) (got ${pu3.intent})`, pu3.intent === 'ADD_RTC');
// compressed nickname
const dn1 = app._fuzzyFindStudent('how much gold does dany have', 'how much gold does dany have');
t26(`"dany" -> Daenerys via subsequence nickname (got ${dn1 && dn1.student && dn1.student.full_name})`, !!dn1 && dn1.student && dn1.student.full_name === 'Daenerys Hegelund');
console.log(`round 26: ${p26} pass, ${f26} fail`);

// round 26b: quantifier words never become subject filters
app._nlpContext = {};
const lc1 = run('list all classes');
const lc1ok = lc1.intent === 'LIST_CLASSES';
console.log(`  ${lc1ok ? ' ok ' : 'FAIL'} "list all classes" -> LIST_CLASSES (executor-side 'all' filter covered by code change) (got ${lc1.intent})`);
if (!lc1ok) process.exitCode = 1;


// ── Round 27: shop transcript — N-chains, reason digits, charge weight ──────
console.log('\n== round 27: shop round ==');
let p27 = 0, f27 = 0;
const t27 = (label, ok) => { ok ? p27++ : f27++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
app._nlpContext = {};
const ch1 = run('how much gold does charlotte and noah and olivia and mia have');
t27(`4-student chain -> all four found (got ${ch1.intent} pair=${JSON.stringify(ch1.pair)})`, ch1.intent === 'VIEW_STUDENT' && Array.isArray(ch1.pair) && ch1.pair.length === 4);
const ch2 = run('give charlotte, noah and mia 5 rtc each');
t27(`comma chain award -> ADD with 3 students (got ${ch2.intent} pair=${JSON.stringify(ch2.pair)})`, ch2.intent === 'ADD_RTC' && Array.isArray(ch2.pair) && ch2.pair.length === 3);
const ch3 = run('charge charlotte 5 rtc for buying a treat');
t27(`"charge X 5 for buying a treat" -> SUBTRACT, no clarify (got ${ch3.intent})`, ch3.intent === 'SUBTRACT_RTC');
const ch4 = run('compare charlotte and noah');
t27(`plain compare still works with chain extractor (got ${ch4.intent} pair=${JSON.stringify(ch4.pair)})`, ch4.intent === 'COMPARE_STUDENTS' && ch4.pair && ch4.pair.length === 2);
const ch5 = app._matchSmalltalk('im about to run shop now');
t27(`"im about to run shop now" -> fyi smalltalk ack (got ${ch5 && ch5.key})`, !!ch5 && ch5.key === 'fyi');
const ch6 = run('transfer 5 rtc from charlotte to noah');
t27(`transfers unaffected by chain extractor (got ${ch6.intent} from=${ch6.from} to=${ch6.to})`, ch6.intent === 'TRANSFER_RTC' && ch6.from === 'Charlotte Tebow' && ch6.to === 'Noah Williams');
console.log(`round 27: ${p27} pass, ${f27} fail`);

// ── Round 28: Phase 1 fixes — pronoun guard, relay, attendance quick-phrases ─
console.log('\n== round 28: Phase 1 — pronoun guard, relay, attendance, slang, 3-compare ==');
let p28 = 0, f28 = 0;
const t28 = (label, ok) => { ok ? p28++ : f28++; console.log(`  ${ok ? ' ok ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };

// add students used in round 28 tests
app._terminalAllStudents.push({ id: 'idDy', first_name: 'Dylan', last_name: 'Gilmore', full_name: 'Dylan Gilmore', rtc_balance: 1489, email: 'dylan@x.com' });
app._terminalAllStudents.push({ id: 'idPh', first_name: 'Phoenix', last_name: 'Foss', full_name: 'Phoenix Foss', rtc_balance: 2880, email: 'phoenix@x.com' });

// 1A: Pronoun guard — named student in input overrides pronoun injection
app._nlpContext = { lastStudent: { full_name: 'Charlotte Tebow', first_name: 'Charlotte', last_name: 'Tebow', id: 's1' }, timestamp: Date.now() };
const pg1 = run('dock eli 5 for his phone being out');
t28(`"dock eli 5 for his phone" -> SUBTRACT_RTC student=Eli (not Charlotte) (got ${pg1.intent}/${pg1.student})`,
  pg1.intent === 'SUBTRACT_RTC' && pg1.student && pg1.student.includes('Eli'));

const pg2 = run('give noah 10 for her presentation');
t28(`"give noah 10 for her presentation" -> ADD Noah (pronoun 'her' ignored when 'noah' is named) (got ${pg2.intent}/${pg2.student})`,
  pg2.intent === 'ADD_RTC' && pg2.student && pg2.student.includes('Noah'));

// 1B: Attendance quick-phrases
app._nlpContext = {};
const att1 = run('eli just walked in late');
t28(`"eli just walked in late" -> MARK_ATTENDANCE (got ${att1.intent})`, att1.intent === 'MARK_ATTENDANCE');

const att2 = run('jordan is out today');
t28(`"jordan is out today" -> MARK_ATTENDANCE (got ${att2.intent})`, att2.intent === 'MARK_ATTENDANCE');

const att3 = run('noah is here');
t28(`"noah is here" -> MARK_ATTENDANCE (got ${att3.intent}/${att3.student})`, att3.intent === 'MARK_ATTENDANCE');

// question form must still be a READ, not a write
const att4 = run('is charlotte here today?');
t28(`"is charlotte here today?" stays VIEW_ATTENDANCE read (got ${att4.intent})`, att4.intent === 'VIEW_ATTENDANCE');

// 1B: "walked in late" variant
const att5 = run('sam walked in late');
t28(`"sam walked in late" -> MARK_ATTENDANCE (got ${att5.intent})`, att5.intent === 'MARK_ATTENDANCE');

// 1D: "how much does X have" -> VIEW_STUDENT (not REVOKE_PRIVILEGE)
app._nlpContext = {};
const hm1 = run('how much does charlotte have');
t28(`"how much does charlotte have" -> VIEW_STUDENT (got ${hm1.intent})`, hm1.intent === 'VIEW_STUDENT');

const hm2 = run('how much did noah have last week');
t28(`"how much did noah have last week" -> VIEW_STUDENT or BALANCE_AT (got ${hm2.intent})`,
  hm2.intent === 'VIEW_STUDENT' || hm2.intent === 'BALANCE_AT');

// 1D: Slang award verbs
const sl1 = run('bless jordan 15');
t28(`"bless jordan 15" -> ADD_RTC (got ${sl1.intent})`, sl1.intent === 'ADD_RTC');

const sl2 = run('spot noah 5 for helping');
t28(`"spot noah 5" -> ADD_RTC (got ${sl2.intent})`, sl2.intent === 'ADD_RTC');

// 1C: RELAY_ACTION intent fires for "same for X" (no amount)
app._nlpContext = {};
const rl1 = run('same for dylan');
t28(`"same for dylan" -> RELAY_ACTION (got ${rl1.intent})`, rl1.intent === 'RELAY_ACTION');

const rl2 = run('do it for charlotte too');
t28(`"do it for charlotte too" -> RELAY_ACTION (got ${rl2.intent})`, rl2.intent === 'RELAY_ACTION');

// RELAY with amount must NOT override an explicit "give X N too"
const rl3 = run('give noah 5 too');
t28(`"give noah 5 too" stays ADD_RTC (not RELAY) (got ${rl3.intent})`, rl3.intent === 'ADD_RTC');

// 1D: VIEW_HISTORY spending query
app._nlpContext = {};
const sp1 = run('is dylan spending or saving his rtc');
t28(`"is dylan spending his rtc" -> VIEW_HISTORY (got ${sp1.intent})`, sp1.intent === 'VIEW_HISTORY');

// 1E: at-risk / struggling -> ATTENDANCE_ISSUES
const ar1 = run('who is struggling right now');
t28(`"who is struggling" -> ATTENDANCE_ISSUES (got ${ar1.intent})`, ar1.intent === 'ATTENDANCE_ISSUES');

const ar2 = run('which students are falling behind');
t28(`"which students are falling behind" -> ATTENDANCE_ISSUES (got ${ar2.intent})`, ar2.intent === 'ATTENDANCE_ISSUES');

// 1E: 3-student compare routes to COMPARE_STUDENTS (intent check only — executor handles list)
const cmp3 = run('compare charlotte and noah and olivia');
t28(`"compare charlotte noah olivia" -> COMPARE_STUDENTS with 3 (got ${cmp3.intent} pair=${JSON.stringify(cmp3.pair)})`,
  cmp3.intent === 'COMPARE_STUDENTS' && cmp3.pair && cmp3.pair.length >= 3);

// UNKNOWN_ACTION no longer tagged lastResort (verified in round 16 now)
const ua1 = app._matchIntent('remind me to call dylans parents', { student: { student: { full_name: 'Dylan Gilmore' } } });
t28(`"remind me..." -> UNKNOWN_ACTION without lastResort (got ${ua1?.intent}/${ua1?.lastResort})`,
  ua1?.intent === 'UNKNOWN_ACTION' && !ua1.lastResort);

console.log(`round 28: ${p28} pass, ${f28} fail`);

// =========================================================
// Round 29: multi-student context, undo atomicity, nav & homework
// =========================================================
let p29 = 0, f29 = 0;
const t29 = (msg, ok) => { ok ? p29++ : f29++; if (!ok) console.log(`  FAIL ${msg}`); else console.log(`   ok  ${msg}`); };

// 29A: After multi-award, lastStudent should be set to the last student
app._nlpContext = {};
const maw1 = run('add 5 rtc to charlotte and noah for group work');
// Simulate _updateContext being called (it's called by _executeIntent, not just _matchIntent)
// Just check that the intent routes correctly to ADD_RTC with a pair
t29(`"add 5 rtc to charlotte and noah" -> ADD_RTC with pair (got ${maw1.intent} pair=${JSON.stringify(maw1.pair?.map(p=>p.student?.full_name||p.full_name))})`,
  maw1.intent === 'ADD_RTC' && maw1.pair?.length >= 2);

// 29B: Homework queries route to VIEW_HOMEWORK
app._nlpContext = {};
const hw1 = run('what homework does eli have coming up');
t29(`"what homework does eli have coming up" -> VIEW_HOMEWORK (got ${hw1.intent})`, hw1.intent === 'VIEW_HOMEWORK');

const hw2 = run('any overdue homework in math class');
t29(`"any overdue homework in math class" -> VIEW_HOMEWORK (got ${hw2.intent})`, hw2.intent === 'VIEW_HOMEWORK');

const hw3 = run('does jordan have any assignments due');
t29(`"does jordan have any assignments due" -> VIEW_HOMEWORK (got ${hw3.intent})`, hw3.intent === 'VIEW_HOMEWORK');

const hw4 = run('show me pending hw for charlotte');
t29(`"show me pending hw for charlotte" -> VIEW_HOMEWORK (got ${hw4.intent})`, hw4.intent === 'VIEW_HOMEWORK');

const hw5 = run('what hw is due this week');
t29(`"what hw is due this week" -> VIEW_HOMEWORK (got ${hw5.intent})`, hw5.intent === 'VIEW_HOMEWORK');

// 29C: "let's run shop" navigation (apostrophe stripped → "let run shop")
app._nlpContext = {};
const nav1 = run("let run shop"); // normalized form (let's → let)
t29(`"let run shop" (from "let's run shop") -> NAVIGATE (got ${nav1.intent})`, nav1.intent === 'NAVIGATE');

const nav2 = run("let run attendance");
t29(`"let run attendance" -> NAVIGATE (got ${nav2.intent})`, nav2.intent === 'NAVIGATE');

const nav3 = run("run the store");
t29(`"run the store" -> NAVIGATE (got ${nav3.intent})`, nav3.intent === 'NAVIGATE');

const nav4 = run("let do attendance");
t29(`"let do attendance" -> NAVIGATE (got ${nav4.intent})`, nav4.intent === 'NAVIGATE');

// 29D: "both of them" still routes pair to VIEW_NOTES / VIEW_ENROLLMENTS
// (entities.students is set via the "both" check — intent check only here)
app._nlpContext = { lastPair: [app._fuzzyFindStudent('charlotte')?.student, app._fuzzyFindStudent('noah')?.student].filter(Boolean) };
const ni1 = run('notes on both of them');
t29(`"notes on both of them" -> VIEW_NOTES (got ${ni1.intent})`, ni1.intent === 'VIEW_NOTES');

const ni2 = run('what classes are both of them in');
t29(`"what classes are both of them in" -> VIEW_ENROLLMENTS (got ${ni2.intent})`, ni2.intent === 'VIEW_ENROLLMENTS');

console.log(`round 29: ${p29} pass, ${f29} fail`);

// Round 30: SEND_MESSAGE now works for teachers and without requiresStudent
let p30 = 0, f30 = 0;
const t30 = (label, ok) => { ok ? p30++ : f30++; if (!ok) console.log('  FAIL', label); };
app._nlpContext = {};

// Teacher-to-teacher: no student entity
const sm1 = run('message Ms. Johnson');
t30(`"message Ms. Johnson" -> SEND_MESSAGE (got ${sm1.intent})`, sm1.intent === 'SEND_MESSAGE');

const sm2 = run('reach out to Coach Davis');
t30(`"reach out to Coach Davis" -> SEND_MESSAGE (got ${sm2.intent})`, sm2.intent === 'SEND_MESSAGE');

const sm3 = run('email the other teachers');
t30(`"email the other teachers" -> SEND_MESSAGE (got ${sm3.intent})`, sm3.intent === 'SEND_MESSAGE');

// Student-focused still works
app._nlpContext = {};
const sm4 = run('message Jordan\'s parents');
t30(`"message Jordan's parents" -> SEND_MESSAGE (got ${sm4.intent})`, sm4.intent === 'SEND_MESSAGE');

const sm5 = run('contact Charlotte\'s family');
t30(`"contact Charlotte's family" -> SEND_MESSAGE (got ${sm5.intent})`, sm5.intent === 'SEND_MESSAGE');

// Send/compose forms
const sm6 = run('send a message to Dylan');
t30(`"send a message to Dylan" -> SEND_MESSAGE (got ${sm6.intent})`, sm6.intent === 'SEND_MESSAGE');

const sm7 = run('reach out to Noah');
t30(`"reach out to Noah" -> SEND_MESSAGE (got ${sm7.intent})`, sm7.intent === 'SEND_MESSAGE');

console.log(`round 30: ${p30} pass, ${f30} fail`);

// Round 31: shape-aware layer — a greeting/common-word typo no longer resolves
// to a student, but the SAME typo inside a real command still does. General
// fix (whole bug class), not a one-off patch of "hey ther".
let p31 = 0, f31 = 0;
const t31 = (label, ok) => { ok ? p31++ : f31++; if (!ok) console.log('  FAIL', label); };
console.log('\n== round 31: shape-aware typo/greeting gating ==');
app._nlpContext = {};
const _savedRoster = app._terminalAllStudents;
app._terminalAllStudents = [
  { full_name: 'Theo Martin', first_name: 'Theo', last_name: 'Martin', rtc_balance: 50, status: 'active', id: 'theo1' },
];

// greeting typo must NOT be mined for a name
const s_hey = app._matchSmalltalk('hey ther');
t31(`"hey ther" -> greeting (got ${JSON.stringify(s_hey)})`, !!(s_hey && s_hey.key === 'greeting' && !s_hey.remainder));
const ff_hey = app._fuzzyFindStudent('ther', 'hey ther');
t31(`"hey ther": no student (got ${ff_hey && ff_hey.student ? ff_hey.student.full_name : 'null'})`, !(ff_hey && ff_hey.student));

// the SAME typo inside a real command still resolves the student
const ff_cmd = app._fuzzyFindStudent(app._normalizeInput("check ther's gold"), "check ther's gold");
t31(`"check ther's gold" -> Theo (got ${ff_cmd && ff_cmd.student ? ff_cmd.student.full_name : 'null'})`, !!(ff_cmd && ff_cmd.student && ff_cmd.student.full_name === 'Theo Martin'));

// a greeting that DOES carry a command is still forwarded, not swallowed
const s_cmd = app._matchSmalltalk('hi, give theo 5 rtc');
t31(`"hi, give theo 5 rtc" -> forwarded (got ${JSON.stringify(s_cmd)})`, !!(s_cmd && s_cmd.remainder));

// exact name with no command context still works
const ff_exact = app._fuzzyFindStudent('theo', 'theo');
t31(`"theo" -> Theo (got ${ff_exact && ff_exact.student ? ff_exact.student.full_name : 'null'})`, !!(ff_exact && ff_exact.student && ff_exact.student.full_name === 'Theo Martin'));

// shape classifier
t31('shape "hey ther" == greeting', app._classifyClauseShape('hey ther').shape === 'greeting');
t31('shape "give theo 5 rtc" == command', app._classifyClauseShape('give theo 5 rtc').shape === 'command');
t31('shape "the kids were wonderful" == observation', app._classifyClauseShape('the kids were wonderful').shape === 'observation');

// common-word typo detector
t31('_isCommonWordTypo("ther") == true', app._isCommonWordTypo('ther') === true);
t31('_isCommonWordTypo("daenerys") == false', app._isCommonWordTypo('daenerys') === false);

// segmentation splits a compound message into pieces
const segs = app._segmentClauses('hi there! how are you? give theo 5 rtc and also mark him late');
t31(`segments >= 3 (got ${segs.length})`, segs.length >= 3);

app._terminalAllStudents = _savedRoster;
console.log(`round 31: ${p31} pass, ${f31} fail`);

// ── round 32: a last initial survives trailing punctuation ────────────────
// "note for eli d: making noise" tokenized the initial as "d:", which failed
// the /^[a-z]$/ initial test — so the disambiguating initial was dropped and
// the note filed itself on whichever Eli scored higher. Silent, and wrong on
// exactly the commands (notes, grades) where being wrong matters most.
console.log('\n== round 32: last initial survives trailing punctuation ==');
let p32 = 0, f32 = 0;
const t32 = (label, ok) => { ok ? p32++ : f32++; if (!ok) console.log('  FAIL', label); };
app._nlpContext = {};
const _roster32 = app._terminalAllStudents;
app._terminalAllStudents = [
  { full_name: 'Elijah Douglas', first_name: 'Elijah', last_name: 'Douglas', rtc_balance: 10, status: 'active', id: 'ed1' },
  { full_name: 'Eli Morris', first_name: 'Eli', last_name: 'Morris', rtc_balance: 10, status: 'active', id: 'em1' },
];
const who32 = (text) => {
  const ff = app._fuzzyFindStudent(app._normalizeInput(text), text);
  return ff && ff.student ? ff.student.full_name : (ff && ff.ambiguous ? 'AMBIGUOUS' : 'null');
};
[
  ['note for eli d: making noise during class', 'Elijah Douglas'],
  ['add behavior note for eli d, negative: making noise', 'Elijah Douglas'],
  ['note for eli d. making noise', 'Elijah Douglas'],
  ['set eli d’s participation grade to b', 'Elijah Douglas'],
  // the plain forms that already worked must keep working
  ['give eli d 5 gold', 'Elijah Douglas'],
  ['eli d', 'Elijah Douglas'],
  // and a bare "eli" with no initial must still reach Eli Morris exactly
  ['give eli morris 5 gold', 'Eli Morris'],
].forEach(([text, want]) => {
  const got = who32(text);
  t32(`"${text}" -> ${want} (got ${got})`, got === want);
});
app._terminalAllStudents = _roster32;
console.log(`round 32: ${p32} pass, ${f32} fail`);

// ── round 33: group commands that name the group instead of one class ─────
// Three messages a teacher actually typed, and three wrong answers:
//   "5 gold to all lower middle school"  -> "Which student should get 5 RTC?"
//   "All lower middle school students"   -> a pick-one-class dialog
//   "Mark all lower MS classes present   -> the same pick-one dialog
//    for today, except <name> wasn't here"
// All three quantify over the CLASSES ("all lower ms ...") and mean every
// match at once. The picker was answering a question he had not asked.
console.log('\n== round 33: "all <group>" spans every matching class ==');
let p33 = 0, f33 = 0;
const t33 = (label, ok) => { ok ? p33++ : f33++; if (!ok) console.log('  FAIL', label); };
app._nlpContext = {};
const _roster33 = app._terminalAllStudents;
const _classes33 = app._terminalAllClasses;
app._terminalAllClasses = [
  { id: 'lme', name: 'Lower MS English', subject: 'English', teacher_id: 't1', secondary_teacher_id: null, is_active: true, teacher_name: 'MS Teacher' },
  { id: 'lmm', name: 'Lower MS Math', subject: 'Math', teacher_id: 't1', secondary_teacher_id: null, is_active: true, teacher_name: 'MS Teacher' },
  { id: 'ume', name: 'Upper MS English', subject: 'English', teacher_id: 't1', secondary_teacher_id: null, is_active: true, teacher_name: 'MS Teacher' },
];
app._terminalAllStudents = [
  { full_name: 'Marigold Vance', first_name: 'Marigold', last_name: 'Vance', rtc_balance: 10, status: 'active', id: 'mm1' },
  { full_name: 'Rowan Petrie', first_name: 'Rowan', last_name: 'Petrie', rtc_balance: 10, status: 'active', id: 'ef1' },
  { full_name: 'Baxter Hollis', first_name: 'Baxter', last_name: 'Hollis', rtc_balance: 10, status: 'active', id: 'tb1' },
];

// the class matcher still finds BOTH lower MS classes (that part always worked)
const cm33 = app._rivenMatchClass('all lower middle school students');
t33(`"all lower middle school students" matches 2 classes (got ${cm33 && cm33.candidates ? cm33.candidates.length : 'none'})`,
  !!(cm33 && cm33.ambiguous && cm33.candidates.length === 2));

// ...and the quantifier test now says "use them all" instead of asking
const q = (text) => {
  const cm = app._rivenMatchClass(app._normalizeInput(text));
  return app._rivenQuantifiesClasses(app._normalizeInput(text), cm ? cm.consumed : []);
};
[
  ['all lower middle school students', true],
  ['5 gold to all lower middle school', true],
  ['mark all lower ms classes present for today', true],
  ['give everyone in lower ms 2 rtc', true],
  ['mark all my classes present', true],
  ['both lower ms classes', true],
  // "all" bound to the STUDENTS of one class is not a fan-out — still asks
  ['list all students in lower ms english', false],
  ['who is in lower ms math', false],
].forEach(([text, want]) => {
  const got = q(text);
  t33(`quantifiesClasses("${text}") == ${want} (got ${got})`, got === want);
});

// the award now routes to the group executor rather than asking for a name
[
  ['5 gold to all lower middle school', 'GROUP_RTC'],
  ['give 5 rtc to all lower ms', 'GROUP_RTC'],
  ['take 2 from every lower ms class', 'GROUP_RTC'],
  // a single named student is untouched by any of this
  ['give marigold 5 gold', 'ADD_RTC'],
].forEach(([text, want]) => {
  const got = run(text).intent;
  t33(`"${text}" -> ${want} (got ${got})`, got === want);
});

// An "all" inside a REASON is not a group target. "give charlotte 5 rtc for
// all her hard work" must stay a plain award — the first cut of this fix
// turned it (and "set her grade to 5 for all assignments") into a clarify
// prompt, which is worse than the bug it was fixing.
[
  ['give marigold 5 rtc for all her hard work', 'ADD_RTC'],
  ['give marigold 5 for all the help', 'ADD_RTC'],
  ['give marigold 5 rtc for all of her hard work', 'ADD_RTC'],
].forEach(([text, want]) => {
  const got = run(text).intent;
  t33(`"${text}" -> ${want} (got ${got})`, got === want);
});

// "except Marigold wasn't here" — the name heads the phrase, a clause trails
// it. The old parser fuzzy-matched the whole string and found nobody, so
// Marigold was quietly marked present with everyone else.
const ex = (piece) => { const st = app._rivenFindExcluded(piece); return st ? st.full_name : 'null'; };
[
  ["marigold wasnt here", 'Marigold Vance'],
  ["marigold", 'Marigold Vance'],
  ["marigold mays was absent", 'Marigold Vance'],
  ["rowan petrie", 'Rowan Petrie'],
].forEach(([piece, want]) => {
  const got = ex(piece);
  t33(`findExcluded("${piece}") -> ${want} (got ${got})`, got === want);
});
t33('findExcluded("the") -> null', app._rivenFindExcluded('the') === null);

// the whole sentence still reads as a group attendance write
const att = run("mark all lower ms classes present for today, except marigold wasnt here");
t33(`full sentence -> MARK_ATTENDANCE_GROUP (got ${att.intent})`, att.intent === 'MARK_ATTENDANCE_GROUP');

app._terminalAllStudents = _roster33;
app._terminalAllClasses = _classes33;
console.log(`round 33: ${p33} pass, ${f33} fail`);
