// Class Progress, the game & skill assignment results, and the Student Hub
// pieces they feed.
//
// The screen answers "where is this class?", so the rules worth pinning are
// the ones where a wrong answer reads as a right one:
//
//   * A FILTER MUST SAY WHO IT MEANS. "Not active this week" includes the
//     student who has never practised - leaving them out is how the one child
//     who most needs chasing disappears from the list.
//   * AN UNMEASURED STUDENT IS NOT THE WORST ONE. No questions this week is
//     no accuracy, not 0%, and sorts last whichever way the column runs.
//   * EMPTY MUST BE TRUE. "Nobody is stuck in Math" is good news; "No
//     practice recorded for Math yet" is a different fact. Each filter and
//     tab says its own.
//   * TWO STUDENTS MUST NEVER SHARE A ROW LABEL. Two Maras, both "O.", get
//     their whole surname in the grid.
//   * THE TERM SUMMARY COUNTS THE STUDENT'S OWN MASTERY. A teacher ticking a
//     skill off, or a skill already mastered being re-scored, is not progress
//     this term.
//
// Every name below is invented. Run: node tests/class-progress.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Lift a method out of the page by name (the emergency-drill pattern), as a
// plain function so it can be bound to a stub app.
function extract(name) {
  const re = new RegExp('\\n      (async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', closeParen);
  let depth = 0; const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const Ctor = m[1] ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const METHODS = [
  'escapeHtml', 'jsAttr', '_progressSubjectLabel', '_progressRelTime', '_progressAccuracy',
  '_progressInactive', '_progressFilterStudents', '_progressSortStudents', '_skillSourceLabel',
  '_skillStateLabel', '_skillCellStyle', '_skillHistoryLine', '_termMasterySummary',
  '_classProgressHtml', '_classProgressEmptyText', '_classProgressStudentsHtml', '_gridRowLabels',
  '_classProgressGridHtml', '_fmtMmSs', '_homeworkGoalText', '_progressDate', '_classHomeworkHtml',
  '_hubSkillSubjectOptions', '_hubSkillsHtml', '_dojoFamilyLabel', '_weeklyActivityRows', '_weeklyActivityHtml',
];
const app = {};
for (const n of METHODS) app[n] = extract(n);

// ---- fixtures ------------------------------------------------------------
const NOW = new Date(2026, 9, 1, 10, 0, 0);          // Thu 1 Oct 2026, 10:00 local
const ago = (d, h = 0) => new Date(NOW.getTime() - d * 86400000 - h * 3600000).toISOString();
const S = (id, first, last, extra = {}) => Object.assign({ id, first_name: first, last_name: last, grade_level: 4,
  last_active: null, sessions_7d: 0, questions_7d: 0, correct_7d: 0, minutes_7d: 0, mastered: 0,
  stuck: 0, fading: 0, homework_overdue: 0 }, extra);
const STUDENTS = [
  S('s1', 'Mara', 'Okonkwo', { last_active: ago(0, 1), sessions_7d: 4, questions_7d: 100, correct_7d: 90, mastered: 5 }),
  S('s2', 'Mara', 'Ozturk', { last_active: ago(3), sessions_7d: 2, questions_7d: 40, correct_7d: 18, stuck: 2, homework_overdue: 1 }),
  S('s3', 'Theo', 'Bell', { last_active: ago(8), fading: 1 }),
  S('s4', 'Juno', 'Park', {}),                                    // never practised
  S('s5', 'Sol', 'Reyes', { last_active: ago(6, 20), sessions_7d: 1, questions_7d: 0 }),
];

// ---- relative time --------------------------------------------------------
console.log('\n== last active, in words ==\n');
check('an hour ago is today', app._progressRelTime(ago(0, 1), NOW), 'today');
check('yesterday evening is yesterday, not "today"', app._progressRelTime(new Date(2026, 8, 30, 21, 0).toISOString(), NOW), 'yesterday');
check('3 days ago', app._progressRelTime(ago(3), NOW), '3 days ago');
check('16 days is 2 weeks ago', app._progressRelTime(ago(16), NOW), '2 weeks ago');
check('75 days is 2 months ago', app._progressRelTime(ago(75), NOW), '2 months ago');
check('null is never', app._progressRelTime(null, NOW), 'never');
check('garbage is never, not "NaN days ago"', app._progressRelTime('not a date', NOW), 'never');

// ---- filters --------------------------------------------------------------
console.log('\n== the filter chips ==\n');
const ids = (list) => list.map(s => s.id);
check('All is everyone', ids(app._progressFilterStudents(STUDENTS, 'all', NOW)), ['s1', 's2', 's3', 's4', 's5']);
check('Stuck', ids(app._progressFilterStudents(STUDENTS, 'stuck', NOW)), ['s2']);
check('Not active this week: 8 days ago AND never, not 6 days 20 hours ago',
  ids(app._progressFilterStudents(STUDENTS, 'inactive', NOW)), ['s3', 's4']);
check('Fading', ids(app._progressFilterStudents(STUDENTS, 'fading', NOW)), ['s3']);
check('Overdue work', ids(app._progressFilterStudents(STUDENTS, 'overdue', NOW)), ['s2']);
check('a filter never mutates the list it was given', STUDENTS.length, 5);

// ---- sorting --------------------------------------------------------------
console.log('\n== sorting ==\n');
check('by name: surname first', ids(app._progressSortStudents(STUDENTS, 'name', 1)), ['s3', 's1', 's2', 's4', 's5']);
check('by accuracy, best first: no-questions students last',
  ids(app._progressSortStudents(STUDENTS, 'accuracy', -1)), ['s1', 's2', 's3', 's4', 's5']);
check('  and still last ascending - unmeasured is not worst',
  ids(app._progressSortStudents(STUDENTS, 'accuracy', 1)).slice(-3), ['s3', 's4', 's5']);
check('by last active, most recent first; never at the bottom',
  ids(app._progressSortStudents(STUDENTS, 'lastActive', -1)), ['s1', 's2', 's5', 's3', 's4']);
check('accuracy is null with no questions, not 0', app._progressAccuracy(STUDENTS[4]), null);
check('accuracy rounds', app._progressAccuracy(STUDENTS[1]), 45);

// ---- the screen -----------------------------------------------------------
console.log('\n== the progress screen ==\n');
const CP = (over = {}) => Object.assign({ classId: 'c1', className: 'Invented Number Sense', subject: 'Math',
  filter: 'all', tab: 'students', sortKey: 'name', sortDir: 1, loading: false, error: null,
  data: { subjects: [{ subject: 'Math', students: 5 }, { subject: 'Creative', students: 1 }], students: STUDENTS, skills: [] } }, over);
const page = (cp) => app._classProgressHtml(cp, NOW);

let out = page(CP());
check('one row per student', (out.match(/<tr onclick=/g) || []).length, 5);
ok('chips carry their counts (Stuck 1)', out.includes(`setClassProgressFilter('stuck')">Stuck <span class="cp-chip-n">1</span>`));
ok('the picker labels Creative as Art (Art Studio)', out.includes('>Art (Art Studio) (1)</option>'));
ok('a student row opens the hub on the chosen subject', out.includes("app.openStudentHubSkills('s2', 'Math')"));
ok('the definitions are on screen', out.includes('practised 4 or more times, and still under 60'));
check('loading says so', page(CP({ loading: true })).includes('Loading progress'), true);
ok('an error is shown, escaped', page(CP({ error: '<b>denied</b>' })).includes('&lt;b&gt;denied&lt;/b&gt;'));
ok('no students: says the class is empty', page(CP({ data: { subjects: [], students: [], skills: [] } }))
  .includes('No students are enrolled in this class.'));
ok('Stuck with nobody stuck says good news, for the subject',
  page(CP({ filter: 'stuck', data: { subjects: [], students: [STUDENTS[0]], skills: [] } })).includes('Nobody is stuck in Math.'));
ok('Not active with everyone active says so',
  page(CP({ filter: 'inactive', data: { subjects: [], students: [STUDENTS[0]], skills: [] } })).includes('Everyone has practised in the last 7 days.'));
ok('the skills grid with no skills says no practice is recorded - not "nobody"',
  page(CP({ tab: 'skills' })).includes('No practice recorded for Math yet.'));
ok('  and for all subjects says it without a subject',
  page(CP({ tab: 'skills', subject: null })).includes('No practice recorded yet.'));
ok('the chips are hidden on the assignments tab', !page(CP({ tab: 'homework' })).includes('cp-chip'));
ok('a name with markup is escaped', page(CP({ data: { subjects: [], skills: [], students: [S('x', '<img src=x>', 'Q')] } }))
  .includes('&lt;img src=x&gt;'));

// ---- the grid -------------------------------------------------------------
console.log('\n== the skills grid ==\n');
const K = (sid, skill, state, mastery, flag = null, subject = 'Math') =>
  ({ student_id: sid, subject, skill, node_id: 'n', state, mastery, practices: 5, last: ago(2), source: 'dojo', flag });
const SKILLS = [
  K('s1', 'Place Value', 'mastered', 95), K('s1', 'Arrays', 'in_progress', 70),
  K('s2', 'Place Value', 'in_progress', 41, 'stuck'), K('s3', 'Place Value', 'mastered', 90, 'fading'),
  K('s2', 'Colour <Mixing>', 'in_progress', 30, null, 'Creative'),
];
out = page(CP({ tab: 'skills', subject: null, data: { subjects: [], students: STUDENTS, skills: SKILLS } }));
check('a column per skill anyone has, in RPC order', (out.match(/class="cp-col"/g) || []).length, 3);
check('one stuck square, one fading', [(out.match(/cp-cell stuck/g) || []).length, (out.match(/cp-cell fading/g) || []).length], [1, 1]);
ok('a skill name is escaped in the header', out.includes('Colour &lt;Mixing&gt;') && !out.includes('Colour <Mixing>'));
ok('squares are tapped by index, not by name', /showSkillCellDetail\(\d+\)/.test(out));
ok('two subjects get a subject header row', out.includes('Art (Art Studio)</span>'));
check('the cell index has every square with a record', app._cpGridCells.length, 5);
ok('Mara Okonkwo and Mara Ozturk are told apart', out.includes('>Mara Okonkwo<') && out.includes('>Mara Ozturk<'));
ok('  while Theo is still Theo B.', out.includes('>Theo B.<'));
out = page(CP({ tab: 'skills', subject: 'Math', data: { subjects: [], students: STUDENTS, skills: SKILLS } }));
check('choosing Math drops the Art column', (out.match(/class="cp-col"/g) || []).length, 2);
check('cell colours: mastered / working 60+ / under 60 / not started',
  [app._skillCellStyle({ state: 'mastered', mastery: 99 }).band, app._skillCellStyle({ state: 'in_progress', mastery: 60 }).band,
   app._skillCellStyle({ state: 'activated', mastery: 59 }).band, app._skillCellStyle({ state: 'available', mastery: 0 }).band],
  ['mastered', 'high', 'low', 'open']);

// ---- history and sources --------------------------------------------------
console.log('\n== how it got there ==\n');
check('sources in plain words', ['dojo', 'math-tutor', 'manual', 'belt_test', 'homework'].map(s => app._skillSourceLabel(s)),
  ['Dojo practice', 'Math Tutor', 'set by hand', 'a belt test', 'a homework assignment']);
check('no source is "not recorded", not blank', app._skillSourceLabel(null), 'not recorded');
const H = (o) => Object.assign({ changed_at: new Date(2026, 8, 12, 9).toISOString(), source: 'dojo', actor_type: 'student' }, o);
check('a change reads as a sentence',
  app._skillHistoryLine(H({ old_state: 'in_progress', new_state: 'mastered', old_score: 55, new_score: 82 })).replace(/^[^·]+· /, ''),
  'In progress → Mastered · 55 → 82 · via Dojo practice');
ok('a system change with a falling score is "faded over time"',
  app._skillHistoryLine(H({ old_state: 'mastered', new_state: 'in_progress', old_score: 80, new_score: 52, source: 'decay', actor_type: 'system' })).endsWith('faded over time'));
ok('a teacher change says who', app._skillHistoryLine(H({ old_state: 'in_progress', new_state: 'mastered', old_score: 50, new_score: 80, source: 'teacher', actor_type: 'teacher' })).endsWith('via a teacher (teacher)'));

console.log('\n== this term ==\n');
const T = (o) => Object.assign({ subject: 'Math', skill_name: 'A', old_state: 'in_progress', new_state: 'mastered', actor_type: 'student', changed_at: ago(5) }, o);
check('own mastery in 30 and 90 days, per subject',
  app._termMasterySummary([
    T({ skill_name: 'A' }), T({ skill_name: 'B', changed_at: ago(45) }), T({ skill_name: 'C', subject: 'Science' }),
    T({ skill_name: 'D', actor_type: 'teacher' }),                        // a teacher ticked it: not counted
    T({ skill_name: 'E', old_state: 'mastered' }),                        // re-scored while mastered: not counted
    T({ skill_name: 'F', changed_at: ago(120) }),                         // last year: not counted
    T({ skill_name: 'A', changed_at: ago(2) }),                           // same skill twice: counted once
  ], NOW, 'Math'),
  { d30: 2, d90: 3, s30: 1, s90: 2 });

// ---- game & skill assignments --------------------------------------------
console.log('\n== game & skill assignment results ==\n');
check('game goal', app._homeworkGoalText({ type: 'game', min_score: 70, min_play_time: 10 }), '70% and 10 minutes');
check('game goal, time only, singular', app._homeworkGoalText({ type: 'game', min_play_time: 1 }), '1 minute');
check('skill goal', app._homeworkGoalText({ type: 'skill_mastery', skill_name: 'Fractions', target_mastery_score: 80 }), 'Fractions to 80%');
check('mm:ss', [app._fmtMmSs(734), app._fmtMmSs(59), app._fmtMmSs(0), app._fmtMmSs(null)], ['12:14', '0:59', '0:00', '0:00']);
check('a bare due date is that calendar day, not the day before', app._progressDate('2026-10-03'),
  new Date(2026, 9, 3).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
ok('no batches says none have been set', app._classHomeworkHtml([], NOW).includes('No game or skill assignments have been set for this class yet.'));
const B = { key: 'b', title: 'Mathletics <Practice>', type: 'game', min_score: 70, min_play_time: 10, due_date: '2026-09-30',
  assigned: 3, completed: 1, started: 1, overdue: 1, students: [
    { student_id: 'a', first_name: 'Ines', last_name: 'Park', status: 'completed', best_score: 92, play_seconds: 734, attempts: 3, completed_at: ago(1), overdue: false, enrolled: true },
    { student_id: 'b', first_name: 'Mara', last_name: 'Ozturk', status: 'assigned', best_score: null, play_seconds: 0, attempts: 0, overdue: true, enrolled: true },
    { student_id: 'c', first_name: 'Rafe', last_name: 'Quill', status: 'in_progress', best_score: 55, play_seconds: 60, attempts: 1, overdue: false, enrolled: false },
  ] };
out = app._classHomeworkHtml([B], NOW);
ok('title escaped', out.includes('Mathletics &lt;Practice&gt;'));
ok('goal shown', out.includes('Goal: 70% and 10 minutes'));
ok('completion bar is completed/assigned (33%)', out.includes('width: 33%;'));
ok('overdue count on the batch', out.includes('1 overdue'));
const rowOrder = [...out.matchAll(/<td class="cp-name">([^<]+)/g)].map(m => m[1].trim());
check('overdue first, then not started, in progress, done', rowOrder, ['Mara Ozturk', 'Rafe Quill', 'Ines Park']);
ok('the overdue row is highlighted', /<tr class="hw-over">\s*<td class="cp-name">Mara Ozturk/.test(out));
ok('a student who left the class is marked', out.includes('(no longer in class)'));
ok('rows start collapsed', out.includes('<div class="hwb-rows" hidden>'));

// ---- the hub --------------------------------------------------------------
console.log('\n== Student Hub ==\n');
const opts = app._hubSkillSubjectOptions({ Math: 4, Creative: 2, LifeSkills: 1 }, 'Creative');
check('subjects with rows come first, with friendly labels',
  [...opts.matchAll(/>([^<]+)<\/option>/g)].map(m => m[1]).slice(0, 4), ['Math (4)', 'Art (Art Studio) (2)', 'Life Skills (1)', 'Art']);
ok('the current subject stays selected', opts.includes('value="Creative" selected'));
const hubOut = app._hubSkillsHtml(
  [{ skill_name: 'Place Value', state: 'mastered', mastery_score: 90, practice_count: 6, last_practiced: ago(2), source: 'math-tutor', mastered_at: ago(10) }],
  [H({ skill_name: 'Place Value', old_state: 'in_progress', new_state: 'mastered', old_score: 50, new_score: 90 })],
  { d30: 1, d90: 2, s30: 1, s90: 1 }, 'Math');
ok('each skill says how it got there', hubOut.includes('via Math Tutor'));
ok('and has its history', hubOut.includes('History (1)') && hubOut.includes('In progress → Mastered'));
ok('the term summary is on top', hubOut.indexOf('This term:') < hubOut.indexOf('Place Value'));
ok('no rows says so for the subject\'s friendly name',
  app._hubSkillsHtml([], [], { d30: 0, d90: 0, s30: 0, s90: 0 }, 'LifeSkills').includes('No Life Skills skill progress recorded yet.'));

check('Dojo-family games by subject', ['Math', 'Reading', 'Science', 'Creative', 'Bible', undefined].map(s => app._dojoFamilyLabel(s).name),
  ['Math Dojo', 'English Lyceum', 'Science Lab', 'Art Studio', 'Berean Hall', 'Math Dojo']);
const wk = app._weeklyActivityRows(
  [{ subject: 'Science', mode: 'practice', total_questions: 10, total_correct: 8, accuracy: 80, created_at: ago(2) }],
  [{ subject: 'Math', skill_name: 'Arrays', total_count: 10, correct_count: 6, source_type: 'game', game_id: 'practice-pilot', started_at: ago(1) }]);
check('weekly activity merges every subject, newest first', wk.map(r => r.activity), ['Practice Pilot', 'Science Lab · practice']);
ok('an empty week says so, in any subject', app._weeklyActivityHtml([]).includes('No practice recorded in the last 7 days, in any subject.'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
