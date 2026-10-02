// A student's portal Home, and a parent's view of the same child.
//
// Every check below runs the REAL method, lifted out of portal/index.html,
// against invented data. Each one is a bug that reached a student or a parent:
//
//   1. Coming Up forced NOT-submitted work grey and skipped "DUE TODAY" - the
//      work still to do was the work that looked calm. And "days until due"
//      was ceil((due - midnight) / 1 day), so 11:59pm tonight was "tomorrow".
//   2. My Grades drew "0.0" when nothing had been graded.
//   3. The practice list said "Score 70%+" and hid the play-time half of the
//      goal and any progress.
//   4. Finished practice vanished from Home.
//   5. The skill-mastery modal said "practise in the Skill Tree" and had no way
//      to get there.
//   6. The GPA and strikes cards looked the pupil up by LOGIN id; their rows
//      are keyed by PROFILE id, which differs for roster-created pupils.
//   7. Turning off the new-assignment EMAIL also stopped the in-app notice.
//   8. Students never saw "late" - it was derived for staff only.
//   9. The heading said "Welcome to Classes & Messaging", not "your dashboard".
//  10. Deep links from the student site (?go=assignment|homework|grades).
//  11. "Do this next" + attendance, from rt_student_overview.
//  12. The parent's "Skills & practice" section.
//
// Run: node tests/student-overview.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond, detail) => {
  if (!cond && detail !== undefined) console.log('        ' + String(detail).slice(0, 400));
  check(label, !!cond, true);
};

// Lift a class method (six-space indent) out of the page: its parameter list
// and body, async or not, exactly as written.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function source(name) {
  const re = new RegExp('\\n      (async\\s+)?' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const sigEnd = i;
  i = html.indexOf('{', sigEnd);
  let depth = 0; const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + m[0].length - 1, sigEnd);
  return { isAsync: !!m[1], args: sig.slice(1, -1), body: html.slice(start + 1, i - 1), full: html.slice(m.index + 1, i) };
}
function extract(name) {
  const s = source(name);
  return new (s.isAsync ? AsyncFunction : Function)(s.args, s.body);
}

const METHODS = [
  'escapeHtml', '_calendarDaysUntil', '_isHandedInStatus', '_submittedLate', '_lateBadge',
  'renderUpcomingAssignments', '_studentGradeText', '_gradeFigureHtml', '_homeworkGameName',
  '_friendlySubject', '_practiceGoalText', '_finishedPracticeText', 'renderGameHomework',
  '_skillPracticePlace', 'openSkillPractice', 'launchHomeworkAssignment', 'viewGrades',
  'loadStudentOverview', '_dueText', '_nextItemView', 'doNextItem', '_attendanceSummary',
  'renderStudentNextCard', 'renderChildOverviewSection', 'handlePortalDeepLink',
  '_homeHeadingFor', 'loadStudentGPADisplay', 'loadStudentStrikesDisplay',
  'sendNewAssignmentNotifications', '_progressStudentId'
];

// A fresh app per test, with recorders for everything that leaves the page.
function makeApp(extra = {}) {
  const app = { calls: [], modals: [] };
  for (const m of METHODS) app[m] = extract(m);
  Object.assign(app, {
    userInfo: { user: { id: 'u-login' }, profile: { id: 'p-profile', user_type: 'student', first_name: 'Ines' } },
    auth: { studentRecordId: () => 'p-profile' },
    showModal(id, title, content) { app.modals.push({ id, title, content }); },
    closeModal(id) { app.calls.push(['closeModal', id]); },
    showLoading() {}, hideLoading() {},
    showNotification(m, t) { app.calls.push(['notify', t, m]); },
    submitAssignment(id) { app.calls.push(['submitAssignment', id]); },
    launchHomeworkAssignment: extra.launchHomeworkAssignment || ((id) => app.calls.push(['launchHomeworkAssignment', id])),
    viewGrades: extra.viewGrades || ((id) => app.calls.push(['viewGrades', id])),
    openSkillPractice: extra.openSkillPractice || ((s, k) => app.calls.push(['openSkillPractice', s, k])),
    async supabaseQuery(fn) { return fn(); },
  });
  return Object.assign(app, extra.overrides || {});
}

// A chainable stand-in for the Supabase query builder over in-memory tables.
// Hands back copies, never the rows themselves.
function fakeSupabase(T, log = []) {
  const OPS = { eq: (a, b) => (a ?? null) === b, in: (a, b) => b.includes(a), gte: (a, b) => a >= b,
    lte: (a, b) => a <= b, lt: (a, b) => a < b, gt: (a, b) => a > b, neq: (a, b) => a !== b };
  return {
    rpc: async (fn, args) => { log.push(['rpc', fn, args]); return { data: null, error: null }; },
    from(tb) {
      const f = []; let one = false; let write = null;
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; },
        single() { one = true; return api; }, maybeSingle() { one = true; return api; },
        update(v) { write = ['update', v]; return api; }, insert(v) { write = ['insert', v]; return api; },
        then(res, rej) {
          if (write) log.push([tb, ...write, f.map(x => x.slice(1))]);
          const rows = (T[tb] || []).filter(r => f.every(([op, k, v]) => OPS[op](r[k], v)));
          const out = JSON.parse(JSON.stringify(one ? (rows[0] || null) : rows));
          return Promise.resolve({ data: out, error: null }).then(res, rej);
        }
      };
      Object.keys(OPS).forEach(op => { api[op] = (k, v) => { f.push([op, k, v]); return api; }; });
      return api;
    }
  };
}

const strip = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const DAY = 86400000;
const atLocal = (days, hour = 12) => { const d = new Date(Date.now() + days * DAY); d.setHours(hour, 0, 0, 0); return d.toISOString(); };

(async () => {
  console.log('\n== 1. calendar days, and urgency on the work still to do ==\n');
  {
    const app = makeApp();
    const now = new Date(2026, 9, 2, 8, 0);          // Fri Oct 2, 8am local
    check('tonight 11:59pm is today', app._calendarDaysUntil(new Date(2026, 9, 2, 23, 59), now), 0);
    check('tomorrow 8am is 1', app._calendarDaysUntil(new Date(2026, 9, 3, 8, 0), now), 1);
    check('tomorrow 11pm is 1', app._calendarDaysUntil(new Date(2026, 9, 3, 23, 0), now), 1);
    check('yesterday is -1', app._calendarDaysUntil(new Date(2026, 9, 1, 23, 0), now), -1);
    check('across the November clock change', app._calendarDaysUntil(new Date(2026, 10, 2, 9, 0), new Date(2026, 10, 1, 0, 30)), 1);
    check('junk is null', app._calendarDaysUntil('not a date', now), null);

    check('no submission is not handed in', app._isHandedInStatus('not_submitted'), false);
    check('undefined is not handed in', app._isHandedInStatus(undefined), false);
    check('submitted is', app._isHandedInStatus('submitted'), true);
    check('graded is', app._isHandedInStatus('graded'), true);

    const rows = [
      { id: 'a1', title: 'Leaf sketch', due_date: atLocal(0, 23), submission_status: 'not_submitted', classes: { name: 'Invented Science', subject: 'Science' } },
      { id: 'a2', title: 'Seed journal', due_date: atLocal(0, 23), submission_status: 'submitted', classes: { name: 'Invented Science', subject: 'Science' } },
      { id: 'a3', title: 'Map quiz', due_date: atLocal(1, 9), submission_status: 'not_submitted', classes: { name: 'Invented Social', subject: 'Social' } },
    ];
    const out = app.renderUpcomingAssignments(rows);
    const items = out.split('class="list-item"').slice(1);
    ok('unsubmitted work due tonight says DUE TODAY', /DUE TODAY/.test(items[0]), strip(items[0]));
    ok('  in the danger colour', /border-left: 4px solid var\(--danger\)/.test(items[0]));
    ok('handed-in work due tonight reads as handed in', /Handed in/.test(items[1]) && !/DUE TODAY/.test(items[1]), strip(items[1]));
    ok('  in the done colour', /border-left: 4px solid var\(--accent-2\)/.test(items[1]));
    ok('unsubmitted work due tomorrow says so', /Due tomorrow/.test(items[2]), strip(items[2]));
    ok('  in the warning colour, not grey', /border-left: 4px solid var\(--warning\)/.test(items[2]));
  }

  console.log('\n== 8. "Submitted late" ==\n');
  {
    const app = makeApp();
    const a = { due_date: '2026-09-26T19:00:00Z' };
    check('after the due date is late', app._submittedLate({ status: 'graded', submitted_at: '2026-09-27T08:00:00Z' }, a), true);
    check('before it is not', app._submittedLate({ status: 'submitted', submitted_at: '2026-09-26T18:00:00Z' }, a), false);
    check('exactly on it is not', app._submittedLate({ status: 'submitted', submitted_at: '2026-09-26T19:00:00Z' }, a), false);
    check('excused is never late', app._submittedLate({ status: 'excused', submitted_at: '2026-09-30T08:00:00Z' }, a), false);
    check('not_submitted is never late', app._submittedLate({ status: 'not_submitted', submitted_at: '2026-09-30T08:00:00Z' }, a), false);
    check('no submission is not late', app._submittedLate(null, a), false);
    check('no due date is not late', app._submittedLate({ status: 'submitted', submitted_at: '2026-09-30T08:00:00Z' }, {}), false);
    ok('the chip says Submitted late', /Submitted late/.test(app._lateBadge()));

    // Every student-facing view that shows a submission carries the chip.
    const views = ['submitAssignment', 'viewGrades'];
    for (const v of views) ok(`${v} shows it`, /_submittedLate\(/.test(source(v).full));
    // The class's assignment list (student branch): the card's status column.
    const at = html.indexOf("? '👁️ View Grade' : (isSubmitted ? '👁️ View Submission'");
    const classList = html.slice(Math.max(0, at - 1200), at);
    ok("the student's class assignment list shows it", at > -1 && /_submittedLate\(submission, assignment\)/.test(classList));
  }

  console.log('\n== 2. "No grades yet", never 0.0 ==\n');
  {
    const app = makeApp();
    check('nothing graded', app._studentGradeText(0, 0), 'No grades yet');
    check('nothing graded, any value', app._studentGradeText(91, 0), 'No grades yet');
    check('null', app._studentGradeText(null, 3), 'No grades yet');
    check('undefined', app._studentGradeText(undefined), 'No grades yet');
    check('unknown count, the old COALESCE 0', app._studentGradeText(0), 'No grades yet');
    check('unknown count, a real grade', app._studentGradeText(88.46), '88.5');
    check('a real 0 with graded work under it stays', app._studentGradeText(0, 2), '0.0');
    check('a grade with graded work', app._studentGradeText(91, 4), '91.0');
    ok('figure keeps numbers as numbers', app._gradeFigureHtml('91.0') === '91.0');
    ok('and shrinks the words', /<span[^>]*font-size: 16px[^>]*>No grades yet<\/span>/.test(app._gradeFigureHtml('No grades yet')));

    // The real viewGrades, against a class where nothing is graded and the
    // enrolment holds the 0 the old recalculation wrote.
    const T = {
      quarters: [{ id: 'q1', name: 'Q1', school_year: '2026-2027', start_date: '2026-09-01', end_date: '2026-11-11', is_current: true }],
      class_enrollments: [{ id: 'e2', class_id: 'c2', student_id: 'p-profile', status: 'active', academic_grade: 0, class_grade: 0, current_quarter_id: 'q1' },
                          { id: 'e1', class_id: 'c1', student_id: 'p-profile', status: 'active', academic_grade: 88.5, class_grade: 88.5, current_quarter_id: 'q1' }],
      quarter_grade_snapshots: [],
      assignments: [
        { id: 'a5', class_id: 'c2', title: 'Cell diagram', due_date: '2026-10-06T19:00:00Z', max_points: 10, is_published: true },
        { id: 'a4', class_id: 'c1', title: 'Chapter 4 review', due_date: '2026-09-26T19:00:00Z', max_points: 100, is_published: true },
      ],
      assignment_submissions: [{ assignment_id: 'a4', student_id: 'p-profile', status: 'graded', points_earned: 88, grade: 'B+', submitted_at: '2026-09-27T08:00:00Z' }],
      grade_categories: [],
    };
    app.classes = [{ id: 'c1', name: 'Invented Pre-Algebra' }, { id: 'c2', name: 'Invented Life Science', status: 'active' }];
    app.auth.supabase = fakeSupabase(T);
    app.viewGrades = extract('viewGrades');
    await app.viewGrades('c2');
    const g = strip(app.modals.pop().content);
    check('class with nothing graded: two "No grades yet"', (g.match(/No grades yet/g) || []).length, 2);
    ok('  and no 0.0 anywhere', !/0\.0/.test(g), g);
    ok('  and it says why', /Nothing has been graded/.test(g), g);
    await app.viewGrades('c1');
    const g1 = strip(app.modals.pop().content);
    ok('class with a graded piece shows its grade', /88\.5/.test(g1) && !/No grades yet/.test(g1), g1);
    ok('  and the late piece is marked', /Submitted late/.test(g1), g1);

    // The past-quarter view had the same 0.0.
    ok('past quarters use the same rule', /_studentGradeText\(enrollment\.class_grade\)/.test(source('viewStudentQuarterGrades').full));
  }

  console.log('\n== 3 + 4. the whole practice goal, progress, and finished work ==\n');
  {
    const app = makeApp();
    check('game: best and minutes', app._practiceGoalText({ assignment_type: 'game', min_score: 70, min_play_time: 10, best_score: 55, play_seconds: 372 }),
      'Best 55% of 70% · 6 of 10 minutes');
    check('game: not played', app._practiceGoalText({ assignment_type: 'game', min_score: 70, min_play_time: 10, best_score: null, play_seconds: 0 }),
      'No score yet (goal 70%) · 0 of 10 minutes');
    check('game: both met', app._practiceGoalText({ assignment_type: 'game', min_score: 70, min_play_time: 10, best_score: 82, play_seconds: 900 }),
      'Best 82% of 70% ✓ · 10 of 10 minutes ✓');
    check('game: defaults when the row has none', app._practiceGoalText({ type: 'game', best_score: 40, play_seconds: 60 }),
      'Best 40% of 70% · 1 of 10 minutes');
    check('skill (homework row + mastery passed in)', app._practiceGoalText({ assignment_type: 'skill_mastery', skill_name: 'Fractions', target_mastery_score: 80 }, 45),
      'Fractions: now 45% of 80%');
    check('skill (overview row)', app._practiceGoalText({ type: 'skill_mastery', skill_name: 'Fractions', target: 80, current_mastery: 85 }),
      'Fractions: now 85% of 80% ✓');
    check('skill not started', app._practiceGoalText({ type: 'skill_mastery', skill_name: 'Fractions', target: 80, current_mastery: null }),
      'Fractions: not started (goal 80%)');
    ok('finished game line', /^Scored 82% · 12 min played · finished /.test(app._finishedPracticeText({ type: 'game', final_score: 82, play_seconds: 734, completed_at: '2026-09-30T18:00:00Z' })));

    const hw = [
      { id: 'h1', assignment_type: 'game', game_id: 'mathletics', title: 'Warm-up', min_score: 70, min_play_time: 10, best_score: 55, play_seconds: 372, due_date: atLocal(2), status: 'in_progress' },
      { id: 'h2', assignment_type: 'skill_mastery', skill_name: 'Fractions', title: "Ines's <goal>", target_mastery_score: 80, due_date: atLocal(5), status: 'assigned' },
      { id: 'h4', assignment_type: 'game', game_id: 'mathspire', title: 'No date', status: 'overdue', due_date: null },
    ];
    const done = [{ id: 'h3', assignment_type: 'game', title: 'Mathspire climb', final_score: 82, play_seconds: 734, completed_at: atLocal(-2) }];
    const out = app.renderGameHomework(hw, done, { practice: [{ id: 'h2', current_mastery: 45 }] });
    const text = strip(out);
    ok('the game row shows the whole goal', text.includes('Best 55% of 70% · 6 of 10 minutes'), text);
    ok('the skill row shows mastery from the overview', text.includes('Fractions: now 45% of 80%'), text);
    ok('no more "Score 70%+" alone', !/Score \d+%\+/.test(text));
    ok('titles are escaped', out.includes('Ines&#39;s &lt;goal&gt;'));
    ok('no due date is not "OVERDUE since 1970"', /No date[\s\S]*no due date/.test(text) && !/1970/.test(text), text);
    ok('Finished recently is listed', /Finished recently 🎮 Mathspire climb Scored 82% · 12 min played/.test(text), text);
    const empty = strip(app.renderGameHomework([], done));
    ok('finished work shows even with nothing open', /No practice assignments right now/.test(empty) && /Finished recently/.test(empty), empty);
    check('nothing finished, nothing extra', /Finished recently/.test(app.renderGameHomework([], [])), false);

    ok("'overdue' homework is still listed", /\.in\('status', \['assigned', 'in_progress', 'overdue'\]\)/.test(source('loadGameHomework').full));
    const fin = source('loadFinishedHomework').full;
    ok('finished = completed in the last 30 days', /\.eq\('status', 'completed'\)/.test(fin) && /30 \* 86400000/.test(fin) && /gte\('completed_at'/.test(fin));
    ok('Home passes finished work and the overview in', /renderGameHomework\(homework, finished, ov\)/.test(source('getStudentHomeContent').full));
  }

  console.log('\n== 5. the skill-mastery modal opens the practice ==\n');
  {
    const app = makeApp();
    const P = (s) => { const p = app._skillPracticePlace(s); return [p.kind, p.game]; };
    check('Math -> Math Dojo', P('Math'), ['game', 'math-dojo']);
    check('Reading -> English Lyceum', P('Reading'), ['game', 'english-lyceum']);
    check('Language -> English Lyceum', P('Language'), ['game', 'english-lyceum']);
    check('Science -> Science Lab', P('Science'), ['game', 'science-lab']);
    check('Social -> Chronicle Hall', P('Social'), ['game', 'social-studies']);
    check('Creative -> Art Studio', P('Creative'), ['game', 'art-studio']);
    check('LifeSkills -> Life Compass', P('LifeSkills'), ['game', 'life-skills']);
    check('Bible -> Berean Hall', P('Bible'), ['game', 'bible-study']);
    check('Physical -> Training Log', P('Physical'), ['game', 'training-log']);
    check('Programming -> its skill tree', P('Programming'), ['tree', null]);
    check('Robotics -> its skill tree', P('Robotics'), ['tree', null]);
    for (const g of ['math-dojo', 'english-lyceum', 'science-lab', 'social-studies', 'art-studio', 'life-skills', 'bible-study', 'training-log']) {
      ok(`  /games/${g}.html exists`, fs.existsSync(path.join(__dirname, '..', 'games', g + '.html')));
    }

    // openSkillPractice for real, with a stand-in localStorage.
    const store = {};
    global.localStorage = { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] ?? null };
    const real = makeApp();
    real.openSkillPractice = extract('openSkillPractice');
    real.openSkillPractice('Math', "Ratios & Rates");
    let m = real.modals.pop();
    ok('Math opens Math Dojo in the game player', m.id === 'game-player' && /src="\/games\/math-dojo\.html\?subject=Math&amp;userId=p-profile"|src="\/games\/math-dojo\.html\?subject=Math&userId=p-profile"/.test(m.content), m.content);
    const req = JSON.parse(store.tree_practice_request || 'null');
    check('  on the skill (the tree_practice_request hand-off)', [req?.skill, req?.subject], ['Ratios & Rates', 'Math']);
    ok('  skill name escaped in the page', m.content.includes('Ratios &amp; Rates'));
    delete store.tree_practice_request;
    real.openSkillPractice('Science', 'Food Chains');
    m = real.modals.pop();
    ok('Science opens Science Lab', /\/games\/science-lab\.html\?subject=Science/.test(m.content), m.content);
    check('  and leaves no Dojo request behind', store.tree_practice_request, undefined);
    real.openSkillPractice('Robotics', 'Gears');
    m = real.modals.pop();
    ok('Robotics opens its skill tree', /\/SkillTreeViewer\.html\?subject=Robotics&userId=p-profile&userType=student/.test(m.content), m.content);
    ok('no homework clock is started by a practice launch', !/_startHomeworkTracking|homework_assignments/.test(source('openSkillPractice').body));

    // The modal itself, through the real launchHomeworkAssignment.
    const T = {
      homework_assignments: [{ id: 'h2', assignment_type: 'skill_mastery', skill_name: "Ines's Fractions", subject: 'Math', target_mastery_score: 80, status: 'in_progress', title: 'Goal' }],
      skill_progress: [{ user_id: 'p-profile', subject: 'Math', skill_name: "Ines's Fractions", mastery_score: 45, state: 'in_progress' }],
    };
    const app2 = makeApp({ launchHomeworkAssignment: null });
    app2.launchHomeworkAssignment = extract('launchHomeworkAssignment');
    app2.getSkillPrerequisites = () => ({});
    app2.auth.supabase = fakeSupabase(T);
    await app2.launchHomeworkAssignment('h2');
    const sm = app2.modals.find(x => x.id === 'skill-practice');
    ok('the modal has a Practise button', sm && /id="skill-practice-open"/.test(sm.content));
    ok('  naming the place', /Practise in Math Dojo/.test(sm.content));
    ok('  that opens the practice', /app\.openSkillPractice\(app\._skillPracticeTarget\?\.subject, app\._skillPracticeTarget\?\.skill\)/.test(sm.content));
    check('  for this skill, carried outside the attribute', app2._skillPracticeTarget, { subject: 'Math', skill: "Ines's Fractions" });
    ok('  and the toast that only repeated the text is gone', !app2.calls.some(c => c[0] === 'notify'));
  }

  console.log('\n== 6. GPA and strikes by profile id ==\n');
  {
    for (const m of ['loadStudentGPADisplay', 'loadStudentStrikesDisplay']) {
      const b = source(m).body.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      ok(`${m} does not use the login id`, !/userInfo\.user\.id/.test(b));
      ok(`  it uses studentRecordId()`, /this\.auth\.studentRecordId\(\)/.test(b));
    }
    // And run the strikes one: the count must be fetched for the profile id.
    const seen = [];
    const app = makeApp();
    app.getStudentStrikes = async (id) => { seen.push(id); return { count: 1 }; };
    const el = { style: {}, textContent: '' };
    global.document = { getElementById: (id) => id === 'student-strikes-count' ? el : null };
    await app.loadStudentStrikesDisplay();
    check('strikes asked for the profile id', seen, ['p-profile']);
    check('  and shown', el.textContent, '1/3');
  }

  console.log('\n== 7. the email preference only decides the email ==\n');
  {
    const run = async (studentPrefs, parentPrefs) => {
      const T = {
        classes: [{ id: 'c1', name: 'Invented Pre-Algebra' }],
        user_profiles: [
          { id: 's1', first_name: 'Ines', email: 'ines@example.invalid', email_notifications: studentPrefs },
          { id: 'p1', first_name: 'Dana', email: 'dana@example.invalid', email_notifications: parentPrefs },
        ],
        class_enrollments: [{ class_id: 'c1', student_id: 's1', status: 'active' }],
        parent_child_links: [{ parent_id: 'p1', child_id: 's1' }],
      };
      const app = makeApp();
      const sent = { inApp: [], email: [] };
      app.auth.supabase = fakeSupabase(T);
      app._startEmailTally = () => ({});
      app._reportEmailTally = () => {};
      app.createNotificationFor = async (who, type) => { sent.inApp.push([who, type]); };
      app.sendEmailWithTracking = async (to, tpl) => { sent.email.push([to, tpl]); };
      await app.sendNewAssignmentNotifications('a1', 'Ratio worksheet', '2026-10-05T19:00:00Z', 'c1');
      return sent;
    };
    let s = await run({}, {});
    check('defaults: both in-app notices', s.inApp, [['s1', 'assignment_posted'], ['p1', 'child_assignment']]);
    check('defaults: both emails', s.email.map(e => e[1]), ['assignment_posted', 'child_assignment_posted']);
    s = await run({ assignment_posted: false }, { child_assignment_posted: false });
    check('email off: the in-app notices still go', s.inApp, [['s1', 'assignment_posted'], ['p1', 'child_assignment']]);
    check('email off: no email', s.email, []);
    s = await run({ assignment_posted: false }, {});
    check("the student's switch leaves the parent's email alone", s.email.map(e => e[0]), ['dana@example.invalid']);
  }

  console.log('\n== 9. the heading says it is their dashboard ==\n');
  {
    const app = makeApp();
    check('student', app._homeHeadingFor('student').title, '🏠 Your dashboard');
    check('teacher keeps the original', app._homeHeadingFor('teacher').title, '📚 Welcome to Classes & Messaging');
    check('parent keeps the original', app._homeHeadingFor('parent').title, '📚 Welcome to Classes & Messaging');
    ok('the static heading has an id to set', /<h2 id="home-heading">/.test(html) && /<p id="home-subheading">/.test(html));
    ok('setupHomeContent sets it', /_homeHeadingFor\(userType\)/.test(source('setupHomeContent').body));
  }

  console.log('\n== 10. deep links ==\n');
  {
    const ID = 'aaaaaaaa-0000-4000-8000-000000000004';
    const C = 'cccccccc-0000-4000-8000-000000000001';
    const H = 'bbbbbbbb-0000-4000-8000-000000000001';
    const run = (search, hash = '', userType = 'student') => {
      const app = makeApp();
      app.userInfo.profile.user_type = userType;
      const replaced = [];
      global.window = {
        location: { href: `https://rivertech.me/portal/${search}${hash}`, search },
        history: { state: null, replaceState: (_s, _t, url) => replaced.push(url) },
      };
      const kind = app.handlePortalDeepLink(search);
      return { kind, calls: app.calls, replaced };
    };
    let r = run(`?go=assignment&class=${C}&id=${ID}`);
    check('assignment', [r.kind, r.calls], ['assignment', [['submitAssignment', ID]]]);
    check('  params removed (history.replaceState)', r.replaced, ['/portal/']);
    r = run(`?go=homework&id=${H}`, '#home');
    check('homework', [r.kind, r.calls], ['homework', [['launchHomeworkAssignment', H]]]);
    check('  the hash survives', r.replaced, ['/portal/#home']);
    r = run(`?go=grades&class=${C}`);
    check('grades', [r.kind, r.calls], ['grades', [['viewGrades', C]]]);
    r = run(`?go=grades&class=${C}&utm=x`);
    check('other params are kept', r.replaced, ['/portal/?utm=x']);
    r = run(`?go=assignment&id=javascript:alert(1)`);
    check('junk id refused', [r.kind, r.calls], [null, []]);
    check('  but still cleared', r.replaced, ['/portal/']);
    r = run(`?go=homework&id=${H}`, '', 'teacher');
    check("staff are not sent into a student's homework", [r.kind, r.calls], [null, []]);
    r = run('');
    check('no link, nothing done', [r.kind, r.replaced], [null, []]);

    const init = source('init').body;
    const arrive = init.indexOf('this._arrivalSearch = window.location.search');
    const wait = init.indexOf('while (!this.auth.initialized');
    const route = init.indexOf("this.setupHomeContent();");
    // The call also falls back to a link remembered before a sign-in
    // (rtPendingLink), so match its opening rather than the whole argument.
    const link = init.indexOf('this.handlePortalDeepLink(');
    ok('init keeps the query string from arrival, before anything can rewrite it', arrive > -1 && arrive < wait);
    ok('  and handles the link after the first render', link > route && route > -1);
    // showSection('home') rewrites the URL to the bare path: the reason above.
    ok("  (showSection('home') does rewrite the URL)", /replaceState\(null, null, window\.location\.pathname\)/.test(source('showSection').body));
  }

  console.log('\n== 11. Do this next, and attendance ==\n');
  {
    const app = makeApp();
    check('attendance', app._attendanceSummary({ present: 39, late: 2, absent: 3, absent_excused: 1, left_early: 1, days: 44 }),
      'In school 41 of 44 days · 2 late · 3 absent (1 excused) · 1 left early');
    check('attendance, a clean quarter', app._attendanceSummary({ present: 20, late: 0, absent: 0, absent_excused: 0, left_early: 0, days: 20 }),
      'In school 20 of 20 days');
    check('attendance, nothing yet', app._attendanceSummary({ days: 0 }), 'No attendance recorded yet this quarter.');
    check('attendance, missing', app._attendanceSummary(null), 'No attendance recorded yet this quarter.');

    const next = [
      { rank: 1, kind: 'missing', title: 'Ratio worksheet', detail: 'Invented Pre-Algebra', due_at: atLocal(-3), assignment_id: 'a1' },
      { rank: 2, kind: 'due_soon', title: 'Leaf <sketch>', detail: 'Invented Life Science', due_at: atLocal(0, 23), assignment_id: 'a2' },
      { rank: 3, kind: 'game', title: 'Warm-up', detail: 'Goal: 70% and 10 minutes', due_at: atLocal(2), homework_id: 'h1' },
      { rank: 3, kind: 'skill', title: 'Fractions goal', detail: 'Goal: Fractions to 80%', due_at: atLocal(5), homework_id: 'h2' },
      { rank: 4, kind: 'stuck', title: 'Colour Mixing', detail: 'Creative · 42% after 7 tries', subject: 'Creative', skill: 'Colour Mixing' },
      { rank: 5, kind: 'fading', title: 'Place Value', detail: 'Math · last practised Aug 22', subject: 'Math', skill: 'Place Value' },
      { rank: 6, kind: 'due_later', title: 'Cell diagram', detail: 'Invented Life Science', due_at: atLocal(4), assignment_id: 'a5' },
    ];
    const ov = { next, quarter: { name: 'Q1' }, attendance: { days: 10, absent: 1, late: 0, absent_excused: 0, left_early: 0 },
      practice: [{ id: 'h1', type: 'game', min_score: 70, min_play_time: 10, best_score: 55, play_seconds: 372 }] };
    const out = app.renderStudentNextCard(ov);
    const text = strip(out);
    check('five rows, in order', (out.match(/class="list-item next-item" data-kind="(\w+)"/g) || []).map(s => s.match(/data-kind="(\w+)"/)[1]),
      ['missing', 'due_soon', 'game', 'skill', 'stuck']);
    ok('says there are more', /\+ 2 more after these/.test(text), text);
    ok('overdue says when it was due', /Ratio worksheet Invented Pre-Algebra · was due/.test(text), text);
    ok('tonight says due today', /due today/.test(text));
    ok('the game row shows progress, not just the goal', text.includes('Best 55% of 70% · 6 of 10 minutes'), text);
    ok('stuck subjects in plain words', text.includes('Art · 42% after 7 tries') && !text.includes('Creative'), text);
    ok('titles escaped', out.includes('Leaf &lt;sketch&gt;'));
    ok('attendance line under it', text.includes('Attendance this quarter (Q1): In school 9 of 10 days · 1 absent'), text);
    check('the buttons', (out.match(/onclick="app\.doNextItem\(\d\)">[^<]+/g) || []).map(s => s.replace(/.*>/, '')),
      ['📝 Hand in', '📝 Open', '🎮 Play', '📖 Practise', '💪 Practise']);

    // Each button goes through the handler its twin below uses.
    const calls = [];
    app.submitAssignment = (id) => calls.push(['submitAssignment', id]);
    app.launchHomeworkAssignment = (id) => calls.push(['launchHomeworkAssignment', id]);
    app.openSkillPractice = (s, k) => calls.push(['openSkillPractice', s, k]);
    [0, 1, 2, 3, 4].forEach(i => app.doNextItem(i));
    check('every button lands in the right place', calls, [
      ['submitAssignment', 'a1'], ['submitAssignment', 'a2'], ['launchHomeworkAssignment', 'h1'],
      ['launchHomeworkAssignment', 'h2'], ['openSkillPractice', 'Creative', 'Colour Mixing']]);
    check('an index past the list does nothing', app.doNextItem(9), null);

    app._nextItems = [next[5], next[6]];
    calls.length = 0;
    app.doNextItem(0); app.doNextItem(1);
    check('fading -> practice; due later -> the assignment', calls, [['openSkillPractice', 'Math', 'Place Value'], ['submitAssignment', 'a5']]);

    const none = strip(app.renderStudentNextCard({ next: [], attendance: { days: 0 } }));
    ok('nothing to do says so', /all caught up/.test(none), none);
    ok('a failed load says so, briefly', /Couldn't load this right now/.test(strip(app.renderStudentNextCard(null))));

    // loadStudentOverview: no argument means "me"; a failure is null, not a throw.
    const a2 = makeApp();
    a2._pickupRpc = async (fn, args) => { a2.calls.push([fn, args]); return { success: true, next: [] }; };
    await a2.loadStudentOverview();
    await a2.loadStudentOverview('p-child');
    check('asks rt_student_overview for me, then for a child', a2.calls,
      [['rt_student_overview', { p_student_id: null }], ['rt_student_overview', { p_student_id: 'p-child' }]]);
    a2._pickupRpc = async () => { throw new Error('Not allowed to see this student'); };
    check('a refusal comes back as null', await a2.loadStudentOverview('p-other'), null);
    a2._pickupRpc = async () => ({ success: false, error: 'No student' });
    check('success:false comes back as null', await a2.loadStudentOverview(), null);

    const home = source('getStudentHomeContent').full;
    ok('Home draws the card at the top', /<div id="student-next-container"/.test(home)
      && home.indexOf('student-next-container"') < home.indexOf('quarter-info-container"></div>'));
    ok('Missing and Coming up stay', /missing-assignments-container/.test(home) && /due-this-week-container/.test(home));
  }

  console.log('\n== 12. the parent\'s "Skills & practice" ==\n');
  {
    const app = makeApp();
    const ov = {
      quarter: { name: 'Q1' },
      next: [{ kind: 'missing', title: 'Ratio worksheet', detail: 'Invented Pre-Algebra', due_at: atLocal(-3), assignment_id: 'a1' },
             { kind: 'stuck', title: 'Long Division', detail: 'Math · 42% after 7 tries', subject: 'Math', skill: 'Long Division' }],
      practice: [{ id: 'h1', type: 'game', title: 'Warm-up', min_score: 70, min_play_time: 10, best_score: 55, play_seconds: 372, due_date: atLocal(2), overdue: false }],
      practice_done: [{ id: 'h3', type: 'game', title: 'Mathspire climb', final_score: 82, play_seconds: 734, completed_at: atLocal(-2) }],
      week: [{ subject: 'Math', this_sessions: 3, this_questions: 40, this_correct: 31, this_minutes: 25, last_sessions: 1, last_questions: 10, last_correct: 6, last_minutes: 10 },
             { subject: 'Physical', this_sessions: 0, this_questions: 0, this_correct: 0, this_minutes: 0, last_sessions: 0, last_minutes: 0 }],
      skills: { by_subject: [{ subject: 'Creative', mastered: 2, working: 1 }], stuck: [{ subject: 'Math', skill: 'Long Division', mastery: 42, practices: 7 }],
        fading: [{ subject: 'Reading', skill: 'Main Idea', last: '2026-08-20T12:00:00Z' }], recent_mastered: [{ subject: 'Math', skill: 'Place Value', at: '2026-09-28T12:00:00Z' }],
        mastered_this_quarter: 1 },
      attendance: { present: 39, late: 2, absent: 3, absent_excused: 1, left_early: 0, days: 44, recent: [{ date: '2026-09-30', status: 'absent', excused: true }] },
      planned_absences: [{ start: '2026-10-12', end: '2026-10-12', reason: "Dentist's visit", excused: true }],
    };
    const out = app.renderChildOverviewSection(ov, { first_name: 'Milo' });
    const text = strip(out);
    for (const [label, needle] of [
      ['heading', 'Skills & practice'],
      ["what's next, for the child by name", "What's next for Milo"],
      ['  overdue work in parent words', 'Overdue work · Invented Pre-Algebra · was due'],
      ['  a stuck skill in parent words', 'Finding this one hard · Math · 42% after 7 tries'],
      ['this week against last', 'Math This week: 3 sessions, 25 min, 40 questions (78% right) · Last week: 1 session, 10 min'],
      ['assigned practice with progress', 'Warm-up Best 55% of 70% · 6 of 10 minutes · due'],
      ['finished recently', 'Mathspire climb Scored 82% · 12 min played'],
      ['skill totals in plain subjects', 'Art: 2 mastered, 1 being worked on'],
      ['mastered this quarter, singular', '1 new skill mastered this quarter'],
      ['fading, subject in plain words', 'Main Idea English · mastered, last practised'],
      ['recently mastered', 'Place Value Math · mastered'],
      ['attendance', 'In school 41 of 44 days · 2 late · 3 absent (1 excused)'],
      ['recent days, as a local date', 'Recent: Sep 30: Absent (excused)'],
      ['a one-day planned absence', "Oct 12 Dentist's visit · excused"],
    ]) ok(label, text.includes(needle), text);
    ok('a subject with no practice either week is left out', !/PE This week/.test(text), text);
    ok('no raw subject codes', !/Creative|Reading|Physical/.test(text), text);
    ok('no buttons - a parent reads it, the child does it', !/<button/.test(out));
    ok('the reason is escaped', out.includes('Dentist&#39;s visit'));
    const failed = strip(app.renderChildOverviewSection(null, { first_name: 'Milo' }));
    ok('a failed load says so', /Couldn't load Milo's skills and practice/.test(failed), failed);
    const quiet = strip(app.renderChildOverviewSection({ next: [], practice: [], practice_done: [], week: [], skills: {}, attendance: { days: 0 }, planned_absences: [] }, { first_name: 'Milo' }));
    ok('a quiet child reads as such', /Milo is caught up/.test(quiet) && /No practice recorded/.test(quiet) && /None set right now/.test(quiet), quiet);

    const details = source('showChildDetails').full;
    ok('showChildDetails asks for that child', /this\.loadStudentOverview\(childId\)/.test(details));
    ok('  and draws the section', /this\.renderChildOverviewSection\(childOverview, child\)/.test(details));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
