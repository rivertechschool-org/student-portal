#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Riven front-door WRITE-PRECISION bench.
//
// Why this exists (portfolio lesson, not a Riven-specific hunch):
//   On 2026-06-24 two freshly-shipped deterministic front-doors in this
//   portfolio — PIE's non-LLM matcher and ulcagent's deterministic_frontdoor —
//   both looked fully green on their unit suites and each still had real false
//   positives, found only by a precision bench with an adversarial bucket.
//   PIE's `interest` matcher fired on "explain why simple interest ... is worse
//   than compound" and answered a bare "150.00"; ulcagent's rename fired on
//   "rename it to bar" and rewrote every .py in the tree. Neither hole was
//   visible to the tests that shipped alongside them.
//
//   `nlp-stress.js` is Riven's equivalent of those unit suites: it asserts that
//   in-scope phrasings reach the right intent. That is RECALL. It never measures
//   what fraction of the sentences Riven decides to WRITE on were genuinely
//   commands — which is the metric that matters, because Riven's front-door
//   mutates balances, grades, attendance and enrollment.
//
// FIVE buckets. A and D are the recall halves; B and C are the precision halves.
//   A  in-scope commands              → expect WRITE (and the right intent)
//   B  reads / out-of-scope           → expect SAFE
//   C  ADVERSARIAL look-alikes        → expect SAFE   ← finds over-firing
//   D  GUARD OVERREACH                → expect WRITE  ← finds over-blocking
//   E  context-carrying + compound    → mixed; the multi-turn surface
//
//   Bucket D is the one a naive bench omits, and omitting it is how a precision
//   fix quietly destroys recall. The first version of this bench shipped without
//   it, and the negative-cue guards it motivated blocked four REAL commands:
//     "don't forget to give eli 5 rtc"      ← idiom: means DO it
//     "give eli 5 rtc he never gives up"    ← "never" describing the student
//     "give noah 5 rtc instead of a warning"← comparison, not a refusal
//     "mark charlotte present she never misses"
//   None were visible until D existed. A guard bench needs both directions.
//
// THREE metrics, because a false positive's cost is not uniform:
//   write-precision            every write intent, flat.
//   IMMEDIATE-write precision  writes whose executor does NOT call
//                              _requestConfirmation — these hit the database
//                              with nothing in front of them. Derived from the
//                              source, not a hand-list, so it can't drift.
//   blast-radius precision     writes that touch a whole class or destroy a
//                              record. One of these is worth many ADD_NOTEs.
//   All three are gated at 1.0. Recall is reported and gated separately.
//
// SCOPE: the REGEX front-door only (`_matchIntent` + the parts of
// `_executeNaturalLanguage` that decide whether it is reached). That is the tier
// every teacher gets with no download. The MiniLM and Llama tiers sit behind it
// with their own guards (semantic writes always confirm; phi3 output is
// re-validated through this same matcher).
//
// Run:  node debug-tools/frontdoor-precision.js
// Exit: 0 only if all three precision metrics are 1.0 and recall is 1.0.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(__dirname, '..', '..', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) {
  console.error('frontdoor-precision: could not locate portal/index.html. Tried:\n  ' + SRC_CANDIDATES.join('\n  '));
  process.exit(2);
}
const src = fs.readFileSync(SRC, 'utf8');

// Brace-match a method body out of the class so the bench runs SHIPPED code.
function bodyOf(name, { anyIndent = false } = {}) {
  const re = anyIndent
    ? new RegExp('\\n\\s+(?:async\\s+)?' + name + '\\s*\\(', 'g')
    : new RegExp('\\n    ' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) return null;
  // Walk the PARAMETER LIST to its closing paren first. Jumping straight to the
  // next "{" lands inside a destructured parameter — e.g.
  //   async terminalAddRTC(args, { reason: fixedReason = null } = {}) {
  // — and brace-matches the destructuring instead of the body, which silently
  // truncates it. That mis-derived the confirmation map (ADD_RTC read as
  // unconfirmed when terminalAddRTC does gate) until this was fixed.
  let p = src.indexOf('(', m.index);
  let pd = 0;
  for (; p < src.length; p++) {
    if (src[p] === '(') pd++;
    else if (src[p] === ')') { pd--; if (pd === 0) { p++; break; } }
  }
  let i = src.indexOf('{', p);
  let depth = 0, start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = src.slice(m.index + 1, start).trim();
  return {
    args: sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')),
    body: src.slice(start + 1, i - 1),
  };
}
function extract(name) {
  const b = bodyOf(name);
  if (!b) throw new Error('method not found: ' + name);
  // eslint-disable-next-line no-new-func
  return new Function(...b.args.split(',').map(s => s.trim()).filter(Boolean), b.body);
}

const methods = ['_normalizeInput', '_resolvePronouns', '_isFollowUpCommand',
  '_extractEntities', '_parseTimeframe', '_fuzzyFindStudent', '_calculateSimilarity',
  '_levenshteinDistance', '_matchIntent', '_matchSmalltalk', '_isAggregateQuery',
  '_rivenMatchClass', '_rivenCanManageClass', '_preferOwnedClasses', '_isoDaysAgo',
  '_rivenMatchGroup', '_rivenGroupCanon',
  '_hasCommandVerb', '_hasCommandSignal', '_isCommonWordTypo', '_commonWords',
  '_segmentClauses', '_classifyClauseShape'];

const app = { _nlpContext: {} };
for (const name of methods) { const fn = extract(name); app[name] = function (...a) { return fn.apply(app, a); }; }

// ── Risk model, derived from the source so it cannot drift ───────────────────

// The production write list, lifted verbatim out of _matchIntent.
function productionWriteIntents() {
  const m = src.match(/const WRITE_INTENTS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('could not locate the WRITE_INTENTS array in _matchIntent');
  return m[1].match(/'([A-Z_]+)'/g).map(s => s.replace(/'/g, ''));
}
const WRITE_INTENTS = new Set(productionWriteIntents());

// Map each write intent to the executor(s) _executeIntent dispatches to, by
// walking the `case 'X':` blocks of the intent switch.
function intentExecutors() {
  const start = src.indexOf('async _executeIntent(');
  if (start < 0) throw new Error('could not locate _executeIntent');
  const region = src.slice(start, start + 120000);
  const map = {};
  let current = null;
  const tok = /case '([A-Z_]+)':|this\.(terminal[A-Za-z]+|_riven[A-Za-z]+)\s*\(/g;
  let m;
  while ((m = tok.exec(region))) {
    if (m[1]) { current = m[1]; map[current] = map[current] || new Set(); }
    else if (current && m[2] && !/^terminalPrint/.test(m[2])) map[current].add(m[2]);
  }
  return map;
}
const EXECUTORS = intentExecutors();

// A write is IMMEDIATE when no executor it can reach calls _requestConfirmation.
// Those are the ones that hit the database with nothing in front of the teacher.
function isImmediateWrite(intent) {
  const fns = EXECUTORS[intent];
  if (!fns || !fns.size) return true;               // unknown dispatch → assume worst
  for (const fn of fns) {
    const b = bodyOf(fn, { anyIndent: true });
    if (b && /_requestConfirmation\s*\(/.test(b.body)) return false;
  }
  return true;
}
const IMMEDIATE = new Set([...WRITE_INTENTS].filter(isImmediateWrite));

// Writes whose blast radius is a whole class, or which destroy a record.
// A false positive here is categorically worse than an over-eager ADD_NOTE.
const BLAST_RADIUS = new Set(['GROUP_RTC', 'MARK_ATTENDANCE_GROUP', 'CLOSE_ALL_CLASSES', 'ANNOUNCE',
  'DELETE_CLASS', 'DELETE_NOTE', 'UNENROLL_STUDENT', 'MOVE_STUDENT',
  'REMOVE_SHOP_ITEM', 'REMOVE_PRIVILEGE', 'REVOKE_PRIVILEGE', 'ACTIVITY_UNENROLL']);

// Same roster/classes as nlp-stress.js so findings are comparable across benches.
const roster = [
  ['Charlotte', 'Tebow'], ['Eli', 'Morris'], ['Elijah', 'Douglas'], ['Elijah', 'Killackey'],
  ['Evelyn', 'Hegelund'], ['John', 'Smith'], ['Johnny', 'Appleseed'],
  ['Sarah', 'Jones'], ['Sam', 'Carter'], ['Samuel', 'Brooks'],
  ['Sophia', 'Nguyen'], ['Sofia', 'Martinez'], ['Liam', 'Jones'],
  ['Olivia', 'Brown'], ['Noah', 'Williams'], ['Ava', 'Davis'],
  ['Mia', 'Wilson'], ['Lucas', 'Anderson'], ['Mason', 'Thomas'],
];
app._terminalAllStudents = roster.map(([f, l], i) => ({
  full_name: `${f} ${l}`, first_name: f, last_name: l,
  rtc_balance: 100 + i, email: `${f.toLowerCase()}@x.com`, status: 'active', id: 'id' + i
}));
app.userInfo = { profile: { user_type: 'teacher' }, user: { id: 't1' } };
app._terminalAllClasses = [
  { id: 'c1', name: 'Math', subject: 'Mathematics', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  { id: 'c2', name: 'Robotics', subject: 'Science', teacher_id: 't1', secondary_teacher_id: null, is_active: true },
  { id: 'c3', name: 'Filmmaking - Freshman', subject: 'Art', teacher_id: 't2', secondary_teacher_id: null, is_active: true },
  { id: 'c4', name: 'World History', subject: 'History', teacher_id: 't2', secondary_teacher_id: null, is_active: true },
];

// ── Production decision path (mirrors _executeNaturalLanguage) ───────────────
// Returns { verdict: 'WRITE'|'SAFE', intent, why }.
function decideOne(input) {
  const small = app._matchSmalltalk(input);
  if (small && !small.remainder) return { verdict: 'SAFE', intent: 'SMALLTALK:' + small.key, why: 'smalltalk' };
  let text = small?.remainder || input;

  // Correction / filler peeling, as in _executeNaturalLanguage
  const corrLead = text.match(/^\s*(?:no+[,!. ]+|i meant?[,: ]+|actually[,: ]+|i mean[,: ]+|sorry[,: ]+i meant?\s+)/i);
  if (corrLead) {
    const rest = text.slice(corrLead[0].length).trim();
    if (rest.split(/\s+/).length >= 3 && !/^not what/i.test(rest)) text = rest;
  }
  const filler = text.match(/^\s*(?:now|ok(?:ay)?|also|please|then|next)[,\s]+/i);
  if (filler && text.slice(filler[0].length).trim().split(/\s+/).length >= 2) text = text.slice(filler[0].length);

  const normalized = app._normalizeInput(text);
  const resolved = app._resolvePronouns(normalized);
  const entities = app._extractEntities(resolved, text);

  // Follow-up context, as in _executeNaturalLanguage
  const firstPerson = /\bmy\b|\bdo i\b|\bam i\b/.test(resolved);
  if (!entities.student && app._nlpContext?.lastStudent && !app._isAggregateQuery(normalized)
      && !entities.classMatch && !firstPerson && app._isFollowUpCommand(normalized)) {
    entities.student = { student: app._nlpContext.lastStudent, score: 0.95, ambiguous: false, fromContext: true };
  }

  // An unresolved pronoun with no context asks "Who do you mean?" in production.
  if (!entities.student && /\b(he|she|him|her|his|hers)\b/.test(resolved)) {
    return { verdict: 'SAFE', intent: 'ASK_WHO', why: 'unresolved pronoun' };
  }
  const hasPair = (entities.studentFrom && entities.studentTo) || (entities.students && entities.students.length >= 2);
  if (entities.student && entities.student.ambiguous && !hasPair) {
    return { verdict: 'SAFE', intent: 'AMBIGUOUS', why: 'ambiguity dialog' };
  }

  const intent = app._matchIntent(resolved, entities);
  const stu = entities.student?.student || entities.student;
  if (intent && stu && !entities.student?.fromContext) app._nlpContext.lastStudent = stu;

  if (!intent) return { verdict: 'SAFE', intent: 'NONE', why: 'no match' };
  const conf = intent.confidence ?? intent.conf ?? 0;
  if (conf < 0.5) return { verdict: 'SAFE', intent: intent.intent, why: 'below threshold, defers' };
  if (intent.intent === 'CLARIFY_INTENT') return { verdict: 'SAFE', intent: 'CLARIFY_INTENT', why: 'asks which write' };
  if (!WRITE_INTENTS.has(intent.intent)) return { verdict: 'SAFE', intent: intent.intent, why: 'read intent' };

  // A write intent whose target is missing does NOT write — the executor asks
  // for the missing piece. The matcher returns the intent anyway so the executor
  // can name what it needs, so grading on the intent alone over-counts writes.
  const NEEDS_TARGET = new Set(['ADD_RTC', 'SUBTRACT_RTC', 'TRANSFER_RTC', 'MARK_ATTENDANCE',
    'ENROLL_STUDENT', 'UNENROLL_STUDENT', 'MOVE_STUDENT', 'SET_GRADE', 'ADD_NOTE',
    'BUY_ITEM', 'BUY_PRIVILEGE', 'GRANT_PRIVILEGE', 'REVOKE_PRIVILEGE']);
  if (NEEDS_TARGET.has(intent.intent)) {
    const hasTarget = !!(entities.student || entities.students?.length || entities.studentFrom || entities.classMatch);
    if (!hasTarget) return { verdict: 'SAFE', intent: intent.intent, why: 'no target — executor asks' };
  }
  return { verdict: 'WRITE', intent: intent.intent, why: 'matched write intent' };
}

// Full path including the compound-command split. A false positive in the RIGHT
// half of "show me eli's grades and give him 5 rtc" is invisible to a bench that
// only ever hands _matchIntent the whole string.
function decide(input, { prior = [], keepContext = false } = {}) {
  if (!keepContext) app._nlpContext = {};
  for (const p of prior) decide(p, { keepContext: true });

  const seam = input.match(/\s+(?:and|then|,)\s+(?:then\s+)?(give|add|award|mark|set|remove|take|deduct|dock|save|log|record|note|enroll|unenroll|put|send|show|tell|check|what|how)\b/i);
  if (seam && seam.index > 5 && !/[:"]/i.test(input.slice(0, seam.index))) {
    const left = input.slice(0, seam.index).trim();
    const right = input.slice(seam.index).replace(/^\s*(?:and|then|,)\s*(?:then\s+)?/i, '').trim();
    if (left.split(/\s+/).length >= 3 && right.split(/\s+/).length >= 2) {
      const l = decideOne(left), r = decideOne(right);
      // Production runs both halves; either one writing is a write.
      if (l.verdict === 'WRITE') return { ...l, why: l.why + ' (compound: left)' };
      if (r.verdict === 'WRITE') return { ...r, why: r.why + ' (compound: right)' };
      return { verdict: 'SAFE', intent: `${l.intent}+${r.intent}`, why: 'compound: neither half writes' };
    }
  }
  return decideOne(input);
}

// ── The bench ────────────────────────────────────────────────────────────────
// item = [input, expectedVerdict, expectedIntent|null, note?, opts?]

const BUCKET_A = [ // in-scope commands — these SHOULD write
  ['give charlotte 5 rtc', 'WRITE', 'ADD_RTC'],
  ['award noah 10 rtc for great work', 'WRITE', 'ADD_RTC'],
  ['give eli 3 gold', 'WRITE', 'ADD_RTC'],
  ['+5 rtc for mia', 'WRITE', 'ADD_RTC'],
  ['dock eli 3 rtc', 'WRITE', 'SUBTRACT_RTC'],
  ['take 5 rtc from mia', 'WRITE', 'SUBTRACT_RTC'],
  ['remove 4 rtc from noah', 'WRITE', 'SUBTRACT_RTC'],
  ['fine charlotte 2 rtc for her phone', 'WRITE', 'SUBTRACT_RTC'],
  ['give 5 rtc from charlotte to noah', 'WRITE', 'TRANSFER_RTC'],
  ['mark charlotte present in math', 'WRITE', 'MARK_ATTENDANCE'],
  ['mark eli absent in robotics yesterday', 'WRITE', 'MARK_ATTENDANCE'],
  ['mark mia tardy in math', 'WRITE', 'MARK_ATTENDANCE'],
  ['add olivia to math', 'WRITE', 'ENROLL_STUDENT'],
  ['enroll lucas in robotics', 'WRITE', 'ENROLL_STUDENT'],
  ['remove noah from robotics', 'WRITE', 'UNENROLL_STUDENT', 'class, not the activity'],
  ['remove noah from robotics', 'WRITE', 'UNENROLL_STUDENT'],
  ['unenroll mason from math', 'WRITE', 'UNENROLL_STUDENT'],
  ['note for eli: forgot his homework again', 'WRITE', 'ADD_NOTE'],
  ['add a note for charlotte: great participation today', 'WRITE', 'ADD_NOTE'],
  ["set charlotte's grade in math to 92", 'WRITE', 'SET_GRADE'],
  ['create a class called Advanced Physics', 'WRITE', 'CREATE_CLASS'],
  ['move olivia from math to robotics', 'WRITE', 'MOVE_STUDENT'],
  // blast-radius + destructive writes must still be REACHABLE
  ['mark everyone in math present today', 'WRITE', 'MARK_ATTENDANCE_GROUP', 'blast radius'],
  // Naming the class must not weaken the intent — this regressed to
  // VIEW_ATTENDANCE because the class match fed a READ's entity bonus.
  ['take attendance for robotics', 'WRITE', 'MARK_ATTENDANCE_GROUP', 'blast radius'],
  ['take attendance', 'WRITE', 'MARK_ATTENDANCE_GROUP', 'blast radius'],
  ['give the whole math class 2 rtc', 'WRITE', null, 'blast radius'],
  ['rename math to Algebra I', 'WRITE', 'RENAME_CLASS'],
  ['grant charlotte the vip perk for 7 days', 'WRITE', 'GRANT_PRIVILEGE'],
  ["revoke eli's homework pass", 'WRITE', 'REVOKE_PRIVILEGE', 'destructive'],
  ['add granola bar to the shop for 4 rtc', 'WRITE', 'ADD_SHOP_ITEM'],
  // Catalog edits must name the shop/store/catalog to reach the REGEX tier —
  // every EDIT_SHOP_ITEM pattern anchors on that word. A bare "change the price
  // of granola bar to 6 rtc" is DELIBERATELY left to the semantic tier (it is in
  // the MiniLM example bank), so it is out of this bench's scope, not a bug.
  ['change the price of granola bar in the shop to 6 rtc', 'WRITE', 'EDIT_SHOP_ITEM'],
  ['remove granola bar from the shop', 'WRITE', 'REMOVE_SHOP_ITEM', 'destructive'],
  ["change charlotte's phone to 555-1234", 'WRITE', 'UPDATE_CONTACT'],
  // assignments — the vocabulary overlaps VIEW_HOMEWORK almost completely, so
  // both directions need holding down (see bucket B/C for the read side).
  ['assign chapter 4 problems to math due friday', 'WRITE', 'CREATE_ASSIGNMENT'],
  ['create a homework for robotics due tomorrow', 'WRITE', 'CREATE_ASSIGNMENT'],
  ['assign "Volcano poster" to math due in 3 days', 'WRITE', 'CREATE_ASSIGNMENT'],
  ['announce to math: no class on friday', 'WRITE', 'ANNOUNCE', 'blast radius'],
  ['tell the math class that there is no class friday', 'WRITE', 'ANNOUNCE', 'blast radius'],
  ['add eli to chess club', 'WRITE', 'ACTIVITY_ENROLL'],
  ['sign charlotte up for the robotics club', 'WRITE', 'ACTIVITY_ENROLL'],
  ['remove noah from chess club', 'WRITE', 'ACTIVITY_UNENROLL', 'destructive'],
  ['book the gym friday 2pm to 3pm', 'WRITE', 'BOOK_FACILITY'],
  ['reserve the library tomorrow 9am to 10am', 'WRITE', 'BOOK_FACILITY'],
];

const BUCKET_B = [ // reads and out-of-scope — must not write
  ['how much rtc does charlotte have', 'SAFE', null],
  ["what are noah's grades", 'SAFE', null],
  ['show me the roster for math', 'SAFE', null],
  ["who's been absent in robotics this month", 'SAFE', null],
  ['list all active students', 'SAFE', null],
  ['show me the top 10 students', 'SAFE', null],
  ["what's charlotte's attendance in math", 'SAFE', null],
  ['anything i should know', 'SAFE', null],
  ['what classes is eli in', 'SAFE', null],
  ['compare charlotte and noah', 'SAFE', null],
  ['show me the shop', 'SAFE', null],
  ['what privileges does mia have', 'SAFE', null],
  ['what homework does eli have coming up', 'SAFE', null],
  ['what hw is due this week', 'SAFE', null],
  ['does jordan have any assignments due', 'SAFE', null],
  ['any overdue homework in math class', 'SAFE', null],
  ['show me pending hw for charlotte', 'SAFE', null],
  ['how is the math class doing', 'SAFE', null],
  ['show me notes about charlotte from last month', 'SAFE', null],
  ['hello', 'SAFE', null],
  ['thanks riven', 'SAFE', null],
  ['what can you do', 'SAFE', null],
  ['how much rtc did charlotte have last week', 'SAFE', null],
  ["what's noah's contact info", 'SAFE', null],
  ['which of my classes has the best grades', 'SAFE', null],
  ['show me the privilege catalog', 'SAFE', null],
  ['who is in chess club', 'SAFE', null],
  ['show me the kids in robotics', 'SAFE', null],
  ['which students are on the basketball team', 'SAFE', null],
];

const BUCKET_C = [ // ADVERSARIAL: looks like a command, is not one
  // — hypothetical / deliberative —
  ['should i give charlotte 5 rtc for this', 'SAFE', 'SPECULATIVE_WRITE', 'hypothetical -> explains'],
  ['would it be fair to give noah 10 rtc', 'SAFE', null, 'hypothetical'],
  ['wondering whether to dock eli 3 rtc', 'SAFE', 'SPECULATIVE_WRITE', 'hypothetical -> explains'],
  ['not sure if i should mark eli absent in math', 'SAFE', null, 'hypothetical'],
  ['thinking about removing noah from robotics', 'SAFE', null, 'hypothetical'],
  ['debating whether to give mia 5 rtc', 'SAFE', null, 'hypothetical'],
  ['considering marking everyone in math absent today', 'SAFE', null, 'hypothetical + blast'],

  // — past tense / already happened / reported —
  ['i already gave charlotte 5 rtc yesterday', 'SAFE', null, 'past tense'],
  ['did i mark eli present in math', 'SAFE', null, 'past tense question'],
  ['have i given noah his 5 rtc yet', 'SAFE', null, 'past tense question'],
  ['charlotte says i gave her 5 rtc', 'SAFE', null, 'reported speech'],
  ['i think someone already enrolled olivia in math', 'SAFE', null, 'reported'],
  ['was eli marked absent in robotics', 'SAFE', null, 'past tense question'],

  // — negated —
  ["don't give charlotte any rtc", 'SAFE', null, 'negated'],
  ['do not mark eli absent', 'SAFE', 'SPECULATIVE_WRITE', 'negated -> explains'],
  ['no need to award noah rtc today', 'SAFE', null, 'negated'],
  ["i'm not going to dock mia 3 rtc", 'SAFE', null, 'negated'],
  ["don't remove noah from robotics", 'SAFE', null, 'negated + destructive'],
  ['never mark the whole class absent', 'SAFE', null, 'negated + blast'],

  // — command text quoted INSIDE note content —
  ['note for eli: i told him i would give him 5 rtc if he finishes', 'WRITE', 'ADD_NOTE', 'command inside note'],
  ['note for charlotte: asked to be marked present next time', 'WRITE', 'ADD_NOTE', 'command inside note'],
  ['note for noah: wants me to remove him from robotics', 'WRITE', 'ADD_NOTE', 'command inside note'],

  // — prose ABOUT the mechanism —
  ['the policy says teachers can give 5 rtc for participation', 'SAFE', null, 'prose about mechanism'],
  ['explain how awarding rtc works', 'SAFE', null, 'prose about mechanism'],
  ['what happens if i delete a class', 'SAFE', null, 'prose + destructive'],
  ['how do i mark a student absent', 'SAFE', null, 'how-to question'],
  ['remind me how transfers work', 'SAFE', null, 'how-to question'],
  ['is 5 rtc too much for finishing homework', 'SAFE', null, 'prose about amount'],
  ['what would happen if i closed all my classes', 'SAFE', null, 'prose + blast'],

  // — polite / interrogative command forms (the isQuestion guard) —
  ['can i give charlotte 5 rtc', 'SAFE', null, 'interrogative'],
  ['could you dock eli 3 rtc', 'SAFE', null, 'interrogative'],

  // — conditional —
  ['if eli finishes his work give him 5 rtc', 'SAFE', 'SPECULATIVE_WRITE', 'conditional -> offers a note'],
  ['give charlotte 5 rtc once she turns it in', 'SAFE', 'SPECULATIVE_WRITE', 'conditional -> offers a note'],

  // — no resolvable target —
  ['give them 5 rtc', 'SAFE', null, 'no referent'],
  ['mark him absent', 'SAFE', null, 'no referent'],
  ['remove the student from the class', 'SAFE', null, 'placeholder target'],

  // — info questions that name a mutation verb —
  ['what did charlotte get on her last test', 'SAFE', null, 'info + verb'],
  ["give me eli's attendance in math over the last 5 weeks", 'SAFE', null, 'give = show'],
  ['show me who i marked absent yesterday', 'SAFE', null, 'info + verb'],
  ['pull up the grades i set for math', 'SAFE', null, 'info + verb'],
  ['who did i give rtc to today', 'SAFE', null, 'info + verb'],
  ['should i assign chapter 4 to math due friday', 'SAFE', 'SPECULATIVE_WRITE', 'hypothetical assignment'],
  ["don't assign any homework to math this week", 'SAFE', 'SPECULATIVE_WRITE', 'negated assignment'],
  ['can i give charlotte 5 rtc please', 'SAFE', 'SPECULATIVE_WRITE', 'interrogative -> explains'],
  ["don't announce anything to math yet", 'SAFE', 'SPECULATIVE_WRITE', 'negated blast-radius write'],
  ['should i announce that to math', 'SAFE', 'SPECULATIVE_WRITE', 'hypothetical blast-radius write'],
  ["don't add eli to chess club", 'SAFE', 'SPECULATIVE_WRITE', 'negated activity write'],
  ['should i book the gym friday 2pm to 3pm', 'SAFE', 'SPECULATIVE_WRITE', 'hypothetical booking'],
];

const BUCKET_D = [ // GUARD OVERREACH: real commands that innocently contain cue words
  // — negation vocabulary describing the STUDENT, not refusing the action —
  ['give eli 5 rtc he never gives up', 'WRITE', 'ADD_RTC', "'never' describes the student"],
  ['give charlotte 3 rtc for not giving up today', 'WRITE', 'ADD_RTC', "bare 'not'"],
  ['mark mia present she never misses class', 'WRITE', 'MARK_ATTENDANCE', "'never' in a subclause"],
  ['give noah 5 rtc instead of a warning', 'WRITE', 'ADD_RTC', "'instead of' is a comparison"],
  ['note for eli: does not turn in homework', 'WRITE', 'ADD_NOTE', "'does not' inside note content"],

  // — idioms where the negation means DO IT —
  ["don't forget to give eli 5 rtc", 'WRITE', 'ADD_RTC', "'don't forget' means do it"],
  ["don't hesitate to dock mia 3 rtc", 'WRITE', 'SUBTRACT_RTC', "'don't hesitate' means do it"],

  // — deliberative vocabulary about something OTHER than the action —
  ['give charlotte 5 rtc she was wondering if she earned it', 'WRITE', 'ADD_RTC', "'wondering' is the student"],
  ['mark eli present he was thinking about staying home', 'WRITE', 'MARK_ATTENDANCE', "'thinking about' is the student"],

  // — time adverbials that share conditional vocabulary —
  ['mark charlotte present after lunch', 'WRITE', 'MARK_ATTENDANCE', "'after lunch' is a time, not a condition"],
  ['give noah 5 rtc when i see him', 'WRITE', 'ADD_RTC', 'colloquial, still an instruction'],

  // — the word "if"/"once" inside a note body —
  ['note for mia: asks if she can retake the quiz', 'WRITE', 'ADD_NOTE', "'if' inside note content"],
];

const BUCKET_E = [ // context-carrying + compound — the multi-turn write surface
  // a compound whose RIGHT half is the write
  ["show me eli's grades and give him 5 rtc", 'WRITE', 'ADD_RTC', 'compound right half',
    {}],
  // a compound whose right half is adversarial must not write
  ["show me eli's grades and tell me if i should give him 5 rtc", 'SAFE', null, 'compound + hypothetical', {}],
  // follow-up pronoun resolves from context → legitimate write
  ['give him 5 rtc', 'WRITE', 'ADD_RTC', 'pronoun from context', { prior: ['show me eli'] }],
  // ...but a HYPOTHETICAL follow-up on the same context must not
  ['should i give him 5 rtc', 'SAFE', null, 'hypothetical follow-up', { prior: ['show me eli'] }],
  // a negated follow-up on live context must not write
  ["don't give him any more rtc", 'SAFE', null, 'negated follow-up', { prior: ['show me eli'] }],
  // stale context + a bare read must not become a write
  ['what about charlotte', 'SAFE', null, 'read follow-up', { prior: ['show me eli'] }],
];

// ── Runner ───────────────────────────────────────────────────────────────────
const buckets = [
  ['A in-scope commands', BUCKET_A],
  ['B reads / out-of-scope', BUCKET_B],
  ['C ADVERSARIAL look-alikes', BUCKET_C],
  ['D GUARD OVERREACH (real commands w/ cue words)', BUCKET_D],
  ['E context-carrying + compound', BUCKET_E],
];

const stats = {
  all: { tp: 0, fp: 0 }, immediate: { tp: 0, fp: 0 }, blast: { tp: 0, fp: 0 },
};
let trueNeg = 0, falseNeg = 0;
const falsePositives = [], falseNegatives = [], wrongWrite = [];

for (const [label, items] of buckets) {
  console.log(`\n== ${label} (${items.length}) ==`);
  for (const [input, expectVerdict, expectIntent, note, opts] of items) {
    let got;
    try { got = decide(input, opts || {}); }
    catch (e) { got = { verdict: 'ERROR', intent: 'ERROR:' + e.message, why: 'threw' }; }

    const intentOk = !expectIntent || got.intent === expectIntent;
    const ok = got.verdict === expectVerdict && intentOk;

    if (expectVerdict === 'WRITE' && got.verdict === 'WRITE') {
      stats.all.tp++;
      if (IMMEDIATE.has(got.intent)) stats.immediate.tp++;
      if (BLAST_RADIUS.has(got.intent)) stats.blast.tp++;
      if (!intentOk) wrongWrite.push([input, expectIntent, got.intent]);
    } else if (expectVerdict === 'SAFE' && got.verdict === 'WRITE') {
      stats.all.fp++;
      if (IMMEDIATE.has(got.intent)) stats.immediate.fp++;
      if (BLAST_RADIUS.has(got.intent)) stats.blast.fp++;
      falsePositives.push([input, got.intent, note || '']);
    } else if (expectVerdict === 'WRITE' && got.verdict !== 'WRITE') {
      falseNeg++; falseNegatives.push([input, expectIntent, got.intent + ' (' + got.why + ')', note || '']);
    } else {
      trueNeg++;
    }

    let mark = ' ok ';
    if (!ok) mark = (got.verdict === 'WRITE' && expectVerdict === 'SAFE') ? 'FIRE'
      : (expectVerdict === 'WRITE' && got.verdict !== 'WRITE') ? 'BLOK' : 'miss';
    const risk = BLAST_RADIUS.has(got.intent) ? ' ‼' : (IMMEDIATE.has(got.intent) ? ' !' : '');
    console.log(`  ${mark} ${JSON.stringify(input).padEnd(64)} -> ${got.verdict}/${got.intent}${risk}${note ? '  [' + note + ']' : ''}`);
  }
}

const pct = (s) => (s.tp + s.fp) ? (s.tp / (s.tp + s.fp)) : 1;
const recall = (stats.all.tp + falseNeg) ? stats.all.tp / (stats.all.tp + falseNeg) : 1;

console.log('\n' + '─'.repeat(74));
console.log('RISK MODEL (derived from portal/index.html, not hand-maintained)');
console.log(`  write intents          : ${WRITE_INTENTS.size}`);
console.log(`  IMMEDIATE (no confirm) : ${[...IMMEDIATE].sort().join(', ') || '(none)'}`);
console.log(`  blast radius           : ${[...BLAST_RADIUS].sort().join(', ')}`);

console.log('\nCONFUSION MATRIX (write vs safe)');
console.log(`  true  write : ${stats.all.tp}`);
console.log(`  FALSE write : ${stats.all.fp}   <-- over-firing`);
console.log(`  true  safe  : ${trueNeg}`);
console.log(`  BLOCKED     : ${falseNeg}   <-- over-blocking (bucket D catches these)`);

console.log('\nPRECISION (all three gated at 100%)');
console.log(`  write-precision            : ${(pct(stats.all) * 100).toFixed(1)}%   (${stats.all.tp}/${stats.all.tp + stats.all.fp})`);
console.log(`  IMMEDIATE-write precision  : ${(pct(stats.immediate) * 100).toFixed(1)}%   (${stats.immediate.tp}/${stats.immediate.tp + stats.immediate.fp})  writes with no confirm dialog`);
console.log(`  blast-radius precision     : ${(pct(stats.blast) * 100).toFixed(1)}%   (${stats.blast.tp}/${stats.blast.tp + stats.blast.fp})  whole-class / destructive`);
console.log(`  write-recall               : ${(recall * 100).toFixed(1)}%   (${stats.all.tp}/${stats.all.tp + falseNeg})`);

if (falsePositives.length) {
  console.log('\nOVER-FIRING — Riven would have written on these:');
  for (const [input, intent, note] of falsePositives) {
    const tag = BLAST_RADIUS.has(intent) ? '  ** BLAST RADIUS **' : (IMMEDIATE.has(intent) ? '  ** NO CONFIRM **' : '');
    console.log(`  ${JSON.stringify(input)}\n       fired: ${intent}${tag}${note ? '   [' + note + ']' : ''}`);
  }
}
if (falseNegatives.length) {
  console.log('\nOVER-BLOCKING — real commands Riven refused:');
  for (const [input, want, got, note] of falseNegatives) {
    console.log(`  ${JSON.stringify(input)}\n       want ${want}, got ${got}${note ? '   [' + note + ']' : ''}`);
  }
}
if (wrongWrite.length) {
  console.log('\nWROTE, WRONG INTENT:');
  for (const [input, want, got] of wrongWrite) console.log(`  ${JSON.stringify(input)}  want ${want}, got ${got}`);
}

const pass = stats.all.fp === 0 && falseNeg === 0 && wrongWrite.length === 0;
console.log('\n' + (pass
  ? `PASS — ${stats.all.tp} writes, 0 over-fired, 0 over-blocked. All precision metrics 1.0.`
  : `FAIL — ${stats.all.fp} over-fired, ${falseNeg} over-blocked, ${wrongWrite.length} misrouted.
  Over-firing  -> make the matcher ABSTAIN more (negative cues, tighter anchors).
  Over-blocking-> SCOPE a guard (bind the cue to the command verb; exempt note content
                  and idioms). Never fix over-blocking by deleting a guard outright.`));
process.exit(pass ? 0 : 1);
