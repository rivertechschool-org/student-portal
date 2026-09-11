// Whose classes Riven is talking about.
//
// `_rivenMyClassRows()` used to carry a branch that read, in full:
//
//     // Admins watch over the whole school; teachers see their own classes
//     if (user_type === 'admin') return this._terminalAllClasses || [];
//
// which is a reasonable sentence and the wrong rule. An admin does have
// permission over every class in the school, but permission is not relevance.
// On a real account it meant the morning briefing opened with "Attendance not
// yet taken today (37 classes)" — Spanish · Jordan Ezell, Guitar · Luke
// Hegelund, and so on down — burying the two registers that were actually the
// asker's to take.
//
// The rule now: A READ WITH NO NAMED TARGET IS ABOUT YOUR OWN CLASSES, whoever
// you are. School-wide is still reachable, but you have to ask for it, and only
// an admin is given it. That applies to the briefing, to "who has bad
// attendance", and to "who is failing" — the three reads that scan rather than
// look something up.
//
// Two failure modes this guards:
//
//   * SCOPE CREEPING BACK VIA ROLE. Any `user_type === 'admin'` test that
//     widens a *default* is the bug returning. Admin may only widen what was
//     explicitly asked for.
//   * THE FLAG BECOMING THE PERMISSION. `{ school: true }` is a request, not a
//     grant. Passing it as a teacher must still return only that teacher's
//     classes, because the caller is not always the one who typed the sentence.
//
// Run: node tests/riven-scope.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the real methods, brace-walked out of the file ---------------------
function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  // Walk the parameter list first: `({ school = false } = {})` has braces of
  // its own, so looking for the body's `{` from the name would find those.
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const parEnd = i;
  i = html.indexOf('{', parEnd);
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, parEnd).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const Ctor = /^async\b/.test(sig)
    ? Object.getPrototypeOf(async function () {}).constructor
    : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// ---- a school ------------------------------------------------------------
const ME = 'auth-me';
const CLASSES = [
  { id: 'c1', name: 'Coding/AI',        teacher_id: ME,        secondary_teacher_id: null },
  { id: 'c2', name: 'Leadership',       teacher_id: 'auth-x',  secondary_teacher_id: ME   },
  { id: 'c3', name: 'Spanish',          teacher_id: 'auth-je', secondary_teacher_id: null },
  { id: 'c4', name: 'Guitar',           teacher_id: 'auth-lh', secondary_teacher_id: null },
  { id: 'c5', name: 'Jr High Filmmaking', teacher_id: 'auth-lh', secondary_teacher_id: null },
];
const ENROLLMENTS = [
  { class_id: 'c1', student_id: 's1' }, { class_id: 'c1', student_id: 's2' },
  { class_id: 'c2', student_id: 's2' }, { class_id: 'c2', student_id: 's3' },
  { class_id: 'c3', student_id: 's9' }, { class_id: 'c4', student_id: 's8' },
];

// Enough Supabase to answer the one query _rivenMyStudentIds makes, and to
// record what it was asked for.
function supabaseStub(sink) {
  const q = {
    select() { return q; },
    in(col, vals) { sink.in = { col, vals }; return q; },
    eq(col, val) {
      sink.eq = { col, val };
      const ids = new Set(sink.in?.vals || []);
      return Promise.resolve({ data: ENROLLMENTS.filter(e => ids.has(e.class_id)) });
    },
  };
  return { from(t) { sink.table = t; return q; } };
}

function makeApp(userType, classes = CLASSES) {
  const sink = {};
  return {
    _sink: sink,
    userInfo: { user: { id: ME }, profile: { id: 'p1', user_type: userType } },
    auth: { supabase: supabaseStub(sink) },
    _terminalAllClasses: classes,
    _rivenMyClassRows: extract('_rivenMyClassRows'),
    _rivenSchoolScope: extract('_rivenSchoolScope'),
    _rivenSaidEveryTeacher: extract('_rivenSaidEveryTeacher'),
    _rivenMyStudentIds: extract('_rivenMyStudentIds'),
  };
}

const names = (rows) => rows.map(r => r.name).sort();

// ---- the default is yours, whoever you are ------------------------------
console.log('\n== a default scope is your own classes ==\n');

const teacher = makeApp('teacher');
const admin = makeApp('admin');

check('a teacher gets the two classes they are on', names(teacher._rivenMyClassRows()), ['Coding/AI', 'Leadership']);
// The regression. This returned all five.
check('AN ADMIN GETS THE SAME TWO BY DEFAULT', names(admin._rivenMyClassRows()), ['Coding/AI', 'Leadership']);
check('  not the whole school', admin._rivenMyClassRows().length, 2);

check('an admin who asks gets all five', names(admin._rivenMyClassRows({ school: true })),
  ['Coding/AI', 'Guitar', 'Jr High Filmmaking', 'Leadership', 'Spanish']);
// The flag is a request, not a grant.
check('a teacher passing the same flag still gets only theirs',
  names(teacher._rivenMyClassRows({ school: true })), ['Coding/AI', 'Leadership']);

check('secondary teacher counts as yours',
  teacher._rivenMyClassRows().some(c => c.id === 'c2'), true);
check('an admin who teaches nothing has nothing of their own',
  makeApp('admin', [CLASSES[2], CLASSES[3]])._rivenMyClassRows().length, 0);

// ---- asking for the whole school ---------------------------------------
console.log('\n== asking for school-wide, and being told no ==\n');

const SCHOOL_PHRASES = [
  'school-wide briefing', 'school wide briefing', 'schoolwide briefing',
  'briefing for the whole school', 'brief me on the entire school',
  'attendance issues across the school', 'every teacher', 'all teachers',
];
for (const p of SCHOOL_PHRASES) {
  check(`admin: "${p}"`, admin._rivenSchoolScope({ normalized: p }), { school: true, refused: false });
}
for (const p of ['anything i should know', 'brief me', 'who is failing', 'what needs attention']) {
  check(`admin: "${p}" stays personal`, admin._rivenSchoolScope({ normalized: p }), { school: false, refused: false });
}
check('a teacher asking school-wide is refused, not silently narrowed',
  teacher._rivenSchoolScope({ normalized: 'school-wide briefing' }), { school: false, refused: true });
check('  and a teacher asking nothing special is not refused anything',
  teacher._rivenSchoolScope({ normalized: 'brief me' }), { school: false, refused: false });
check('the raw sentence counts too, not just the normalized one',
  admin._rivenSchoolScope({ normalized: '', original: 'give me the whole school briefing' }),
  { school: true, refused: false });
check('no entities at all is not a crash', admin._rivenSchoolScope(undefined), { school: false, refused: false });

// ---- which students a scan covers ---------------------------------------
console.log('\n== the students a scan covers ==\n');

(async () => {
  const t = makeApp('teacher');
  const ids = await t._rivenMyStudentIds();
  check('a teacher scans their own rosters', [...ids].sort(), ['s1', 's2', 's3']);
  check('  asked for by class id', t._sink.in, { col: 'class_id', vals: ['c1', 'c2'] });
  check('  and only active enrollments', t._sink.eq, { col: 'status', val: 'active' });

  const a = makeApp('admin');
  check('an admin scans their own rosters too', [...(await a._rivenMyStudentIds())].sort(), ['s1', 's2', 's3']);
  check('null means do not filter, and only an admin gets it',
    await a._rivenMyStudentIds({ school: true }), null);
  check('a teacher asking for it still gets a filter',
    [...(await makeApp('teacher')._rivenMyStudentIds({ school: true }))].sort(), ['s1', 's2', 's3']);
  check('no classes is an empty set, not everyone',
    [...(await makeApp('teacher', [CLASSES[2]])._rivenMyStudentIds())], []);

  // ---- the three readers are wired to it --------------------------------
  console.log('\n== the scans that used to go school-wide ==\n');

  const slice = (from, to) => html.slice(html.indexOf(from), html.indexOf(to));

  const rows = slice('    _rivenMyClassRows(', '    _rivenSchoolScope(');
  check('no role test widens the default any more', /user_type === 'admin'\) return this\._terminalAllClasses/.test(rows), false);
  ok('  the only role test left is gated on an explicit ask',
    /if \(school && this\.userInfo\?\.profile\?\.user_type === 'admin'\) return all;/.test(rows));

  const briefing = slice('    async terminalBriefing(', '    async _rivenMarkAllRead(');
  ok('the briefing takes a scope', /async terminalBriefing\(\{ auto = false, school = false \} = \{\}\)/.test(briefing));
  ok('  and passes it down', /this\._rivenMyClassRows\(\{ school \}\)/.test(briefing));
  ok('  refuses a non-admin who asks for school-wide', /A school-wide briefing is admin-only/.test(briefing));
  ok('  falls back to school-wide only for an admin who teaches nothing',
    /isAdmin && !school && !this\._rivenMyClassRows\(\)\.length/.test(briefing));
  ok('  scopes the birthdays the same way', /myStudentIds\.has\(p\.id\)/.test(briefing));
  ok('  says which scope you are looking at', /school \? 'school-wide' : `across your \$\{classRows\.length\}/.test(briefing));
  ok('  and tells an admin how much they are not seeing',
    /Say <b>"school-wide briefing"<\/b> for the other \$\{others\}/.test(briefing));

  const dispatch = slice("        case 'BRIEFING': {", "        case 'MARK_READ':");
  ok('the BRIEFING intent reads the scope off the sentence', /this\._rivenSchoolScope\(entities\)/.test(dispatch));
  ok('  and hands it to the briefing', /terminalBriefing\(\{ school: scope\.school \}\)/.test(dispatch));

  const att = slice('    async terminalAttendanceIssues(', '    async terminalGradeIssues(');
  check('attendance no longer scans "all students" by default', /across all students/.test(att), false);
  ok('  it scans your rosters', /allowedIds = await this\._rivenMyStudentIds\(\)/.test(att));
  ok('  unless a class was named or school-wide was asked for', /if \(!classRow && !scope\.school\)/.test(att));
  ok('  and it says so in the heading', /' across your classes'/.test(att));

  const gr = slice('    async terminalGradeIssues(', '    async terminalBalanceAt(');
  ok('grades scan your classes by default', /myClassIds = this\._rivenMyClassRows\(\)\.map/.test(gr));
  ok('  narrowed in the query, not after the fact', /q\.in\('class_enrollments\.class_id', myClassIds\)/.test(gr));
  ok('  and it says so in the heading', /' in your classes'/.test(gr));

  for (const [what, body] of [['attendance', att], ['grades', gr]]) {
    ok(`${what} tells a teacher when it narrowed their school-wide ask`,
      /Scanning the whole school is admin-only/.test(body));
    ok(`${what} says so rather than reporting an empty school`,
      /You aren't listed as the teacher of any class/.test(body));
  }

  // ---- whose student did that name mean? --------------------------------
  console.log('\n== an ambiguous name leans toward your own students ==\n');

  // Three Charlottes, the way a school actually has them. Two belong to other
  // teachers; an admin can see all three, which is what made a bare first name
  // open a picker instead of doing the obvious thing.
  const CHARLOTTES = [
    { id: 'st-tebow',  first_name: 'Charlotte', last_name: 'Tebow',  full_name: 'Charlotte Tebow',  email: 'ct@x', rtc_balance: 10 },
    { id: 'st-innis',  first_name: 'Charlotte', last_name: 'Innis',  full_name: 'Charlotte Innis',  email: 'ci@x', rtc_balance: 20 },
    { id: 'st-vance',  first_name: 'Charlotte', last_name: 'Vance',  full_name: 'Charlotte Vance',  email: 'cv@x', rtc_balance: 30 },
    { id: 'st-dylan',  first_name: 'Dylan',     last_name: 'Reyes',  full_name: 'Dylan Reyes',      email: 'dr@x', rtc_balance: 40 },
  ];

  function matcher(mineIds) {
    const app = {
      _nlpContext: {},
      _terminalAllStudents: CHARLOTTES,
      _terminalPinnedStudent: null,
      _rivenMyStudentIdSet: mineIds === null ? null : new Set(mineIds),
    };
    for (const n of ['_fuzzyFindStudent', '_calculateSimilarity', '_levenshteinDistance',
                     '_isCommonWordTypo', '_commonWords', '_hasCommandSignal',
                     '_hasCommandVerb', '_rivenIsMyStudent', '_rivenOwnRank']) {
      const fn = extract(n);
      app[n] = function (...a) { return fn.apply(app, a); };
    }
    return app;
  }

  {
    const app = matcher(['st-tebow']);
    const r = app._fuzzyFindStudent('charlotte', 'charlotte');
    check('one of the three is yours, so that is who it means', r.ambiguous, false);
    check('  and it is the right one', r.student.full_name, 'Charlotte Tebow');
  }
  {
    // Two of yours is a real question, not a tie to break.
    const app = matcher(['st-tebow', 'st-innis']);
    const r = app._fuzzyFindStudent('charlotte', 'charlotte');
    check('two of yours still asks', r.ambiguous, true);
    check('  and yours are offered first', r.matches.slice(0, 2).map(m => m.full_name).sort(),
      ['Charlotte Innis', 'Charlotte Tebow']);
  }
  {
    // None of them yours: unchanged behaviour, the picker.
    const app = matcher(['st-dylan']);
    check('none of yours asks, as it always did', app._fuzzyFindStudent('charlotte', 'charlotte').ambiguous, true);
  }
  {
    // THE RULE THAT MATTERS: ownership breaks ties, it does not beat spelling.
    // The sentence named Vance; Vance is not yours; Vance is still who it means.
    const app = matcher(['st-tebow']);
    const r = app._fuzzyFindStudent('charlotte vance', 'charlotte vance');
    check('a name you actually said wins over a name you own', r.ambiguous, false);
    check('  even when the other one is yours', r.student.full_name, 'Charlotte Vance');
  }
  {
    // A failed roster lookup must leave matching exactly as it was, not turn
    // every student into a stranger.
    const app = matcher(null);
    check('no roster means no opinion', app._fuzzyFindStudent('charlotte', 'charlotte').ambiguous, true);
    check('  and nobody counts as yours', app._rivenIsMyStudent('st-tebow'), false);
  }
  {
    const app = matcher(['st-innis']);
    check('_rivenOwnRank sorts yours to the front', [
      app._rivenOwnRank(CHARLOTTES[0]), app._rivenOwnRank(CHARLOTTES[1]),
    ], [1, 0]);
    check('  and an unknown student is not a crash', app._rivenOwnRank(undefined), 1);
  }

  // ---- and the surfaces that show the names -----------------------------
  console.log('\n== the name lists say which are yours ==\n');

  const auto = slice('    _showAutocomplete(query) {', '    _hideAutocomplete() {');
  ok('autocomplete sorts your students first',
    /\.sort\(\(a, b\) => this\._rivenOwnRank\(a\) - this._rivenOwnRank\(b\)\)/.test(auto));
  ok('  before it takes the top five', auto.indexOf('_rivenOwnRank') < auto.indexOf('.slice(0, 5)'));
  ok('  and marks them', /_rivenIsMyStudent\(s\.id\) \? ' <span/.test(auto));

  const picker = slice('    _showAmbiguityDialog(matches, originalInput) {', '    async _resolveAmbiguity(');
  ok('the picker marks them too', /_rivenIsMyStudent\(student\.id\)/.test(picker));

  const nl = slice('      // Reached past your own classes.', '      // Execute the matched intent');
  ok('reaching outside your classes is said out loud', /isn't in your classes/.test(nl));
  ok('  named as the admin reach it is', /going ahead as admin/.test(nl));
  ok('  and only when a roster is actually known', /this\._rivenMyStudentIdSet && !this\._rivenIsMyStudent/.test(nl));

  const ready = slice('    _rivenReady() {', '    _rivenIntroHtml() {');
  ok('the roster is loaded after the classes it depends on',
    ready.indexOf('_loadTerminalClasses') < ready.indexOf('_loadMyStudentIds'));

  // Every harness that pulls the matcher out of the file must pull its new
  // dependency too, or it dies on `this._rivenOwnRank is not a function`.
  console.log('\n== the harnesses still extract a working matcher ==\n');
  for (const h of ['nlp-stress', 'frontdoor-precision', 'recovery-ladder',
                   'group-attendance', 'semantic-coverage']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'debug-tools', h + '.js'), 'utf8');
    const listsMatcher = /'_fuzzyFindStudent'/.test(src);
    ok(`${h} lists _rivenOwnRank beside the matcher`,
      !listsMatcher || /'_rivenOwnRank'/.test(src));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
