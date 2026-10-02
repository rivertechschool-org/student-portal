// The student Home: "how am I doing, and what do I do next".
//
// Home is drawn from one rt_student_overview call by pure renderers on
// StudentPortal (root index.html): data in, HTML out. These tests lift the
// real methods out of the page and run them against invented data, so what is
// checked here is what ships.
//
// The rules that matter most, and why:
//
//   * EVERY NEXT ITEM GOES SOMEWHERE. A "Do this next" row whose button lands
//     on the portal home instead of the assignment is a dead end the student
//     meets exactly when they are trying to do the right thing. Each kind has
//     its own destination and each is checked.
//   * "NO GRADES YET", NEVER 0.0. A class nothing has been marked in yet is not
//     a class the student is failing. graded = 0 (and the portal's own
//     convention that a stored 0 means "no data") must never print as 0.0%, 0%
//     or an F.
//   * ARROWS ONLY WHERE THERE IS SOMETHING TO COMPARE. Accuracy with no
//     questions is "no data", not 0%, and must not draw a ↓.
//   * ONE VOCABULARY. Subjects show the names students know (Reading is
//     English, Physical is PE), and skill states are Locked / Ready to start /
//     In progress / Mastered on Home, the skill tree and the guide - never a
//     raw state name like 'activated'.
//   * EMPTY IS A STATE, NOT A BLANK. Every card says something when it has
//     nothing to show.
//
// Run: node tests/student-home.test.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tree = fs.readFileSync(path.join(root, 'SkillTreeViewer.html'), 'utf8');
const guide = fs.readFileSync(path.join(root, 'students', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Lift a class method out of a page: the 12-space indented member
// declaration in index.html and SkillTreeViewer.html. Sync on purpose - the
// renderers are called inside template literals.
function extract(src, name) {
  const re = new RegExp('\\n            (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const sig = src.slice(m.index + m[0].length - 1, i);
  const args = sig.slice(1, -1);
  i = src.indexOf('{', i);
  let depth = 0; const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (/^\s*async\b/.test(src.slice(m.index + 1, m.index + 20))) throw new Error(name + ' is async; renderers must be sync');
  return new Function(args, src.slice(start + 1, i - 1));
}

// The page's own escapeHtml and every Home renderer, on one object so their
// `this.` calls reach each other the way they do on StudentPortal.
const METHODS = ['escapeHtml', 'homeSubjectName', 'homePracticeTarget', 'homeLetterGrade', 'homeGradeText',
  'homeDayDiff', 'homeShortDate', 'homeDueLabel', 'homeNextAction', 'homeActionButton', 'homeRenderNext',
  'homeRenderClasses', 'homeWeekArrow', 'homePracticeProgress', 'homePracticePercent', 'homeRenderPractice',
  'homeRenderSkills', 'homeAttendanceStatus', 'homeRenderAttendance', 'homeRenderHow'];
const portal = {};
for (const n of METHODS) portal[n] = extract(html, n).bind(portal);
const getStateLabel = extract(tree, 'getStateLabel');

const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const count = (h, needle) => h.split(needle).length - 1;

// A fixed "now": Tuesday 6 October 2026, 10am local. Every due date below is
// built from local parts so the test means the same thing in any timezone.
const NOW = new Date(2026, 9, 6, 10, 0);
const at = (d, h = 15, min = 0) => new Date(2026, 9, d, h, min).toISOString();

// ---------------------------------------------------------------------------
console.log('\n== do this next: one button per kind, each to the right place ==\n');

const NEXT = [
  { rank: 1, kind: 'missing', title: 'Volcano diagram', detail: 'Earth Science', due_at: at(4, 23, 59), assignment_id: 'a-1', class_id: 'c-sci' },
  { rank: 2, kind: 'due_soon', title: 'Chapter 4 review', detail: 'English 7', due_at: at(7), assignment_id: 'a-2', class_id: 'c-eng' },
  { rank: 3, kind: 'game', title: 'Mathletics practice', detail: 'Goal: 70% and 10 minutes', due_at: at(9), homework_id: 'h-1', overdue: false },
  { rank: 3, kind: 'skill', title: 'Fractions push', detail: 'Goal: Fractions to 80%', due_at: null, homework_id: 'h-2' },
  { rank: 4, kind: 'stuck', title: 'Long Division', detail: 'Math · 41% after 6 tries', subject: 'Math', skill: 'Long Division' },
  { rank: 5, kind: 'fading', title: 'Parts of Speech', detail: 'Reading · last practised Aug 20', subject: 'Reading', skill: 'Parts of Speech' },
  { rank: 6, kind: 'due_later', title: 'Map quiz', detail: 'Geography', due_at: at(12), assignment_id: 'a-3', class_id: 'c-geo' }
];

const act = (k) => portal.homeNextAction(NEXT.find(n => n.kind === k));
check('missing -> hand it in, on that assignment', [act('missing').label, act('missing').href],
  ['Hand it in', '/portal/?go=assignment&class=c-sci&id=a-1']);
check('due soon -> open that assignment', act('due_soon').href, '/portal/?go=assignment&class=c-eng&id=a-2');
check('due later -> open that assignment', act('due_later').href, '/portal/?go=assignment&class=c-geo&id=a-3');
check('game assignment -> play it through the portal (the portal runs the clock)', [act('game').label, act('game').href],
  ['Play', '/portal/?go=homework&id=h-1']);
check('skill assignment -> its homework link', act('skill').href, '/portal/?go=homework&id=h-2');
check('stuck skill -> practise on this site, by subject', [act('stuck').label, act('stuck').practice, act('stuck').href],
  ['Practise', 'Math', undefined]);
check('fading skill -> refresh on this site, by subject', [act('fading').label, act('fading').practice], ['Refresh', 'Reading']);
check('an unknown kind still goes somewhere', portal.homeNextAction({ kind: 'mystery' }).href, '/portal/');
check('an assignment item missing its ids falls back to the portal, not a broken link',
  portal.homeNextAction({ kind: 'missing' }).href, '/portal/');

const nextHtml = portal.homeRenderNext(NEXT, NOW);
check('shows the first five items only', count(nextHtml, 'class="home-row"'), 5);
check('in the order given', (nextHtml.match(/data-kind="([a-z_]+)"/g) || []).map(s => s.slice(11, -1)),
  ['missing', 'due_soon', 'game', 'skill', 'stuck']);
ok('says how many more are waiting', text(nextHtml).includes('and 2 more after these'));
ok('overdue work says how overdue', text(nextHtml).includes('2 days overdue'));
ok('tomorrow says tomorrow', text(nextHtml).includes('due tomorrow'));
ok('the game row links to its homework', nextHtml.includes('href="/portal/?go=homework&amp;id=h-1"'));
ok('the stuck row is a practise button carrying its subject', nextHtml.includes('data-home-practice="Math"'));
ok('a row with no due date shows no due label', !/Fractions push[\s\S]*?due /.test(text(nextHtml).split('Long Division')[0]));

const evil = portal.homeRenderNext([{ kind: 'missing', title: '<img src=x onerror=alert(1)>', detail: '"><b>', assignment_id: 'a', class_id: 'c' }], NOW);
ok('titles and details are escaped', !evil.includes('<img') && evil.includes('&lt;img'));

const empty = portal.homeRenderNext([], NOW);
ok("nothing to do -> \"You're all caught up\"", text(empty).includes("You're all caught up"));
ok('...with a gentle suggestion and a way to act on it', text(empty).includes('Keep a skill fresh') && empty.includes('data-home-games'));
ok('an undefined list is treated as empty, not a crash', text(portal.homeRenderNext(undefined, NOW)).includes('all caught up'));

// ---------------------------------------------------------------------------
console.log('\n== due labels ==\n');

const due = (iso) => portal.homeDueLabel(iso, NOW);
check('1 day overdue (singular)', due(at(5)), { text: '1 day overdue', cls: 'overdue' });
check('earlier today is already late', due(at(6, 8)), { text: 'was due today', cls: 'overdue' });
check('later today', due(at(6, 23, 59)), { text: 'due today', cls: 'soon' });
check('tomorrow', due(at(7)), { text: 'due tomorrow', cls: 'soon' });
check('later this week says the weekday', due(at(9)).text, 'due Friday');
check('no date, no label', due(null), { text: '', cls: '' });

// ---------------------------------------------------------------------------
console.log('\n== my classes: grades, "No grades yet", missing ==\n');

const CLASSES = [
  { id: 'c-eng', name: 'English 7', subject: 'Reading', class_grade: 88.4, graded: 5, missing: 0, teacher: 'Ms Quill' },
  { id: 'c-sci', name: 'Earth Science', subject: 'Science', class_grade: 0, graded: 0, missing: 2, teacher: 'Mr Basalt' },
  { id: 'c-art', name: 'Studio Art', subject: 'Creative', class_grade: 92, graded: 0, missing: 0, teacher: '' },
  { id: 'c-pe', name: 'PE', subject: 'Physical', class_grade: null, graded: 3, missing: 0, teacher: 'Coach Day' }
];
check('a graded class: letter and percent on the portal scale', portal.homeGradeText(CLASSES[0]), 'B+ · 88.4%');
check('graded = 0 -> no grade, even with a stored number', portal.homeGradeText(CLASSES[2]), null);
check('class_grade 0 -> no grade (the portal reads 0 as "no data")', portal.homeGradeText(CLASSES[1]), null);
check('no class_grade -> no grade', portal.homeGradeText(CLASSES[3]), null);
check('letter scale edges', [97, 93, 90, 89.9, 60, 59.9].map(p => portal.homeLetterGrade(p)), ['A+', 'A', 'A-', 'B+', 'D-', 'F']);

const classesHtml = portal.homeRenderClasses(CLASSES);
check('three classes say "No grades yet"', count(classesHtml, 'No grades yet'), 3);
ok('nothing prints as 0.0 or 0%', !/\b0\.0\b|\b0%/.test(text(classesHtml)));
ok('missing work shows as a badge', text(classesHtml).includes('2 missing'));
ok('no badge where nothing is missing', count(classesHtml, 'home-badge') === 1);
ok('each class opens My Grades for that class', classesHtml.includes('href="/portal/?go=grades&class=c-sci"'));
ok('subjects show their friendly names', text(classesHtml).includes('English · Ms Quill') && text(classesHtml).includes('PE · Coach Day'));
ok('no classes -> says so and points at Join Class', text(portal.homeRenderClasses([])).includes("aren't in any classes"));

// ---------------------------------------------------------------------------
console.log('\n== practice: week over week, every subject ==\n');

check('more than last week -> up', portal.homeWeekArrow(5, 3), { sym: '↑', cls: 'home-up' });
check('less -> down', portal.homeWeekArrow(1, 3), { sym: '↓', cls: 'home-down' });
check('same -> =', portal.homeWeekArrow(2, 2), { sym: '=', cls: 'home-same' });
check('no data on either side -> no arrow', [portal.homeWeekArrow(null, 3).sym, portal.homeWeekArrow(80, null).sym], ['', '']);

const OV = {
  week: [
    { subject: 'Math', this_sessions: 4, this_questions: 40, this_correct: 30, this_minutes: 35,
      last_sessions: 2, last_questions: 20, last_correct: 18, last_minutes: 20 },
    { subject: 'Reading', this_sessions: 0, this_questions: 0, this_correct: 0, this_minutes: 0,
      last_sessions: 1, last_questions: 10, last_correct: 7, last_minutes: 8 }
  ],
  practice: [
    { id: 'h-1', type: 'game', title: 'Mathletics practice', subject: 'Math', game_id: 'mathletics',
      due_date: at(9), min_score: 70, min_play_time: 10, best_score: 55, play_seconds: 372 },
    { id: 'h-2', type: 'skill_mastery', title: 'Fractions push', subject: 'Math', skill_name: 'Fractions',
      due_date: null, target: 80, current_mastery: 62 }
  ],
  practice_done: [{ id: 'h-0', type: 'game', title: 'Clockwork Defense', final_score: 82, play_seconds: 660, completed_at: at(2) }]
};
check('game progress in words', portal.homePracticeProgress(OV.practice[0]), 'Best 55% of 70% · 6 of 10 minutes');
check('skill progress in words', portal.homePracticeProgress(OV.practice[1]), 'Fractions 62% of 80%');
check('a game bar shows whichever of score and minutes is further behind', portal.homePracticePercent(OV.practice[0]), 62);
check('server defaults when the teacher set none', portal.homePracticeProgress({ type: 'game' }), 'Best 0% of 70% · 0 of 10 minutes');

const practiceHtml = portal.homeRenderPractice(OV, NOW);
const pt = text(practiceHtml);
ok('every subject, not only Math (Reading shows as English)', pt.includes('Math') && pt.includes('English'));
ok('accuracy this week vs last: 75% down from 90%', /75% ↓ accuracy last 90%/.test(pt));
ok('sessions up from last week', /4 ↑ sessions last 2/.test(pt));
ok('no questions this week -> accuracy "–", not 0%', /– accuracy last 70%/.test(pt));
ok('assigned practice links to its homework', practiceHtml.includes('/portal/?go=homework&amp;id=h-1'));
ok('a skill assignment says Practise, a game says Play', pt.includes('Practise') && pt.includes('Play'));
ok('finished recently is listed with its score', pt.includes('Finished recently') && pt.includes('Score 82%'));
const quiet = text(portal.homeRenderPractice({ week: [], practice: [], practice_done: [] }, NOW));
ok('no practice -> says so', quiet.includes('No practice this week or last'));
ok('no assignments -> says so', quiet.includes('No game or skill assignments right now'));
ok('nothing finished -> the heading is left out, not shown empty', !quiet.includes('Finished recently'));

// ---------------------------------------------------------------------------
console.log('\n== skills: totals, needs attention, recently mastered ==\n');

const SKILLS = {
  by_subject: [{ subject: 'Math', mastered: 12, working: 3 }, { subject: 'LifeSkills', mastered: 2, working: 1 }],
  stuck: [{ subject: 'Math', skill: 'Long Division', mastery: 41, practices: 6 }],
  fading: [{ subject: 'Reading', skill: 'Parts of Speech', last: '2026-08-20T17:00:00Z' }],
  recent_mastered: [{ subject: 'Math', skill: 'Equivalent Fractions', at: at(1), source: 'practice' }],
  mastered_this_quarter: 4
};
const skillsHtml = portal.homeRenderSkills(SKILLS);
const st = text(skillsHtml);
ok('mastered this quarter, in all, and in progress', /4 Mastered this quarter 14 Mastered in all 4 In progress/.test(st));
ok('totals by subject with friendly names', st.includes('Life Skills 2 mastered · 1 in progress'));
ok('a stuck skill says why, in words', st.includes('stuck: 41% after 6 tries'));
ok('a fading skill says it needs a refresh', st.includes('needs a refresh: last practised'));
ok('each needs-attention skill has a practise button by subject',
  skillsHtml.includes('data-home-practice="Math"') && skillsHtml.includes('data-home-practice="Reading"'));
ok('and names where it will open', st.includes('in 🥋 Math Dojo') && st.includes('in ✒️ English Lyceum'));
ok('recently mastered is listed', st.includes('Equivalent Fractions'));
const noSkills = text(portal.homeRenderSkills({}));
ok('no skills -> says how to start', noSkills.includes('No skills started yet'));
ok('nothing stuck or fading -> says so', noSkills.includes('Nothing needs attention'));

// ---------------------------------------------------------------------------
console.log('\n== attendance ==\n');

const attHtml = text(portal.homeRenderAttendance(
  { present: 30, late: 2, absent: 3, absent_excused: 2, left_early: 1, days: 36,
    recent: [{ date: '2026-10-02', status: 'absent', excused: true }, { date: '2026-09-29', status: 'late_left_early', excused: false }] },
  [{ start: '2026-10-19', end: '2026-10-21', reason: 'Family trip', excused: true }],
  { name: 'Q1' }));
ok('this quarter, by name', attHtml.includes('Attendance Q1'));
ok('counts, with excused absences called out', attHtml.includes('3 Absent (2 excused)'));
ok('a school date is not shifted a day by timezone', attHtml.includes('Fri, Oct 2'));
ok('statuses read as words', attHtml.includes('Absent (excused)') && attHtml.includes('Late and left early'));
ok('planned absences show their span and reason', attHtml.includes('Mon, Oct 19 – Wed, Oct 21') && attHtml.includes('Family trip · Excused'));
ok('no attendance -> says so', text(portal.homeRenderAttendance(null, [], null)).includes('No attendance recorded yet'));

// ---------------------------------------------------------------------------
console.log('\n== one vocabulary: subjects and skill states ==\n');

check('every stored subject has its friendly name',
  ['Math', 'Reading', 'Science', 'Social', 'Creative', 'LifeSkills', 'Bible', 'Programming', 'Robotics', 'Physical'].map(s => portal.homeSubjectName(s)),
  ['Math', 'English', 'Science', 'Social Studies', 'Art', 'Life Skills', 'Bible', 'Programming', 'Robotics', 'PE']);
check('an unknown subject shows as stored; an empty one as Other',
  [portal.homeSubjectName('Latin'), portal.homeSubjectName(null)], ['Latin', 'Other']);
check('practice goes to the subject\'s own game',
  ['Math', 'Reading', 'Social', 'Creative', 'LifeSkills', 'Programming', 'Physical'].map(s => portal.homePracticeTarget(s).game),
  ['math-dojo', 'english-lyceum', 'social-studies', 'art-studio', 'life-skills', 'terminal-quest', 'training-log']);
check('a subject with no game falls back to the Skills tab', portal.homePracticeTarget('Robotics'), { game: null, label: '🌟 Skills' });
ok('every practice game is one openGame knows', ['math-dojo', 'english-lyceum', 'science-lab', 'social-studies', 'art-studio',
  'life-skills', 'bible-study', 'terminal-quest', 'training-log'].every(g => html.includes(`'${g}': {`)));

check('skill tree states: the four words, activated and mastered alike',
  ['locked', 'available', 'in_progress', 'activated', 'mastered'].map(s => getStateLabel(s)),
  ['Locked', 'Ready to start', 'In progress', 'Mastered', 'Mastered']);
check('a stale mastered skill reads "Needs a refresh", as on Home', getStateLabel('needs_review'), 'Needs a refresh');
check('a raw or unknown state is never shown', [getStateLabel('weird_state'), getStateLabel(undefined)], ['Locked', 'Locked']);
const legendAt = tree.indexOf('>', tree.indexOf('id="legend"')) + 1;
const legend = tree.slice(legendAt, tree.indexOf('</div>\n    </div>', legendAt));
check('the tree legend uses the same four', (legend.match(/<span>([^<]*)<\/span>/g) || []).map(s => s.slice(6, -7)),
  ['Mastered', 'In progress', 'Ready to start', 'Locked']);
ok('Home says "Skills mastered", not "Skills Unlocked"', html.includes('Skills mastered') && !html.includes('Skills Unlocked'));
ok('the student guide uses the four words', ['Locked', 'Ready to start', 'In progress', 'Mastered'].every(w => guide.includes(`<b>${w}</b>`)));
ok('the guide no longer teaches the raw "activated"', !/<b>activated<\/b>/.test(guide));

// ---------------------------------------------------------------------------
console.log('\n== the page itself ==\n');

ok('the dead Grades tab is gone', !html.includes('id="grades-tab"') && !html.includes('id="grades-section"'));
ok('Home calls the overview exactly once', count(html, ".rpc('rt_student_overview')") === 1);
ok('every Home card has its mount', ['home-next', 'home-classes', 'home-practice', 'home-skills', 'home-attendance', 'home-how', 'calendar-mount']
  .every(id => html.includes(`id="${id}"`)));
const how = text(portal.homeRenderHow());
ok('How it works covers grades, mastery, refresh, stuck, game assignments and RTC',
  ['class grade', 'Mastery %', 'Needs a refresh', 'Stuck', 'Game assignments', 'Earning RTC'].every(w => how.includes(w)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
