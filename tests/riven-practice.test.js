// Where students are in their skills - Riven's practice answers.
//
// Riven read grades, attendance and missing work, and never a line of skill or
// practice data. These are the executors behind the four practice intents
// (STUDENT_PRACTICE, PRACTICE_STUCK, PRACTICE_INACTIVE, HOMEWORK_RESULTS), the
// practice lines in the proactive briefing, and the homework answer's fix:
// overdue is COMPUTED (due date passed, not completed or excused), because the
// 'overdue' status is never written and filtering on it found nothing.
//
// Routing - which sentence reaches which intent - is in
// debug-tools/nlp-stress.js round 44. This file checks what the answers SAY:
// the right students, the right numbers, nothing double-counted, and every
// name escaped.
//
// THE ROSTER IS INVENTED and deliberately awkward: surnames one edit from the
// practice vocabulary (Stucky, Dorjo, Player), a first name shared by two, and
// a name carrying markup. No real record is read to build any of it.
//
// Run: node tests/riven-practice.test.js

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

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', i);
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^\s*async\b/.test(m[0].slice(1));
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const METHODS = ['terminalStudentPractice', 'terminalPracticeStuck', 'terminalPracticeInactive',
  'terminalHomeworkResults', '_rivenHomeworkBlock', '_rivenBriefingPractice', '_rivenPracticeSubject',
  '_rivenSubjectIs', '_rivenPracticeWindow', '_rivenAgo', '_rivenPersonName', '_rivenProgressOverview',
  '_rivenClassProgress', '_rivenPracticeScope', '_rivenPracticeFromClasses', '_rivenProgressButtons',
  '_rivenBusiestClasses', '_rivenScopeLabel', '_rivenSkillPhrase', '_rivenSkillMatches',
  '_rivenStudentProgress', '_rivenPracticeLine', '_rivenResolvedStudent', '_rivenMyClassRows',
  '_rivenClassIsOpen', '_rivenResolveClassRow', '_briefingExpand', '_isoDaysAgo', 'terminalShowHomework'];

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const dateAgo = (d) => {
  const x = new Date(Date.now() - d * DAY);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const MATH = { id: 'c1', name: 'Math', teacher_id: 'me', secondary_teacher_id: null, is_active: true };
const ROBO = { id: 'c2', name: 'Robotics', teacher_id: 'me', secondary_teacher_id: null, is_active: true };
const ART = { id: 'c3', name: 'Art', teacher_id: 'someone', secondary_teacher_id: null, is_active: true };

// The invented roster.
const S = {
  stucky: { id: 's1', first_name: 'Masterson', last_name: 'Stucky' },
  dorjo: { id: 's2', first_name: 'Gamelin', last_name: 'Dorjo' },
  player: { id: 's3', first_name: 'Fadia', last_name: 'Player' },
  brook: { id: 's4', first_name: 'Marlowe', last_name: 'Brook' },
  tenley: { id: 's5', first_name: 'Marlowe', last_name: 'Tenley' },
  markup: { id: 's6', first_name: '<b>Kit</b>', last_name: "O'Hara" },
};
const full = (s) => `${s.first_name} ${s.last_name}`;

// A query builder that records every filter and resolves to rows for its table.
function makeSupabase(tables, log) {
  return {
    from(table) {
      const q = { table, calls: [] };
      log.push(q);
      const chain = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') {
            const rows = typeof tables[table] === 'function' ? tables[table](q) : (tables[table] || []);
            return (res) => res({ data: rows.map(r => ({ ...r })), error: null });
          }
          return (...args) => { q.calls.push([prop, ...args]); return chain; };
        }
      });
      return chain;
    }
  };
}

function makeApp({ overview = { students: [] }, classProgress = {}, homework = {}, tables = {}, classes = [MATH, ROBO, ART], showClassProgress = true, failClass = [] } = {}) {
  const log = [];
  const app = {
    said: [], errors: [], printed: [], rpc: [], queries: log,
    userInfo: { profile: { user_type: 'teacher', id: 'me' }, user: { id: 'me' } },
    _terminalAllClasses: classes,
    _terminalAllStudents: Object.values(S).map(s => ({ ...s, full_name: full(s) })),
    escapeHtml: esc,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrint(m) { app.printed.push(m); },
    terminalPrintError(m) { app.errors.push(m); },
    async _pickupRpc(fn, args) {
      app.rpc.push([fn, args]);
      if (fn === 'rt_teacher_progress_overview') return JSON.parse(JSON.stringify(overview));
      if (fn === 'rt_class_progress') {
        if (failClass.includes(args.p_class_id)) throw new Error('not your class');
        const d = classProgress[args.p_class_id];
        if (!d) throw new Error('no such class');
        return JSON.parse(JSON.stringify(d));
      }
      if (fn === 'rt_class_homework') {
        if (failClass.includes(args.p_class_id)) throw new Error('not your class');
        return JSON.parse(JSON.stringify(homework[args.p_class_id] || []));
      }
      throw new Error('unexpected rpc ' + fn);
    },
    auth: { supabase: makeSupabase(tables, log) },
  };
  if (showClassProgress) app.showClassProgress = () => {};
  for (const m of METHODS) { const fn = extract(m); app[m] = function (...a) { return fn.apply(app, a); }; }
  return app;
}
const last = (app) => app.said[app.said.length - 1] || '';
const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// An overview row with sensible defaults.
const ov = (s, extra = {}) => ({ id: s.id, first_name: s.first_name, last_name: s.last_name, grade_level: 5,
  last_active: null, active_in_window: false, sessions_7d: 0, questions_7d: 0, correct_7d: 0, minutes_7d: 0,
  mastered: 0, stuck: 0, fading: 0, mastered_30d: 0, stuck_skills: [], classes: [{ id: 'c1', name: 'Math' }],
  homework_overdue: [], ...extra });

(async () => {
  // ── subjects as teachers say them ──────────────────────────────────────
  console.log('\n== subjects as teachers say them ==\n');
  {
    const app = makeApp();
    const subj = (t) => { const r = app._rivenPracticeSubject(t); return r ? r.stored.join('/') : null; };
    check('"maths" is Math', subj('what is x stuck on in maths'), 'Math');
    check('"English" is Reading or Language', subj('help with in english'), 'Reading/Language');
    check('"art" is Creative', subj('who is stuck in art'), 'Creative');
    check('"social studies" is Social, not a half-match', subj('stuck in social studies'), 'Social');
    check('"PE" is Physical', subj('who is stuck in pe'), 'Physical');
    check('"life skills" is LifeSkills', subj('stuck in life skills'), 'LifeSkills');
    check('"his skills" is no subject at all', subj('how is x doing on his skills'), null);
    check('"pe" inside a word is not PE', subj('who hasnt practised as expected'), null);
    const dojo = app._rivenPracticeSubject("who hasn't played math dojo this week");
    check('Math Dojo is Math practice, and is named as the game', [dojo.stored[0], dojo.game], ['Math', 'Math Dojo']);
  }

  // ── windows and skill phrases ──────────────────────────────────────────
  console.log('\n== how far back, and which skill ==\n');
  {
    const app = makeApp();
    const w = (t) => app._rivenPracticeWindow(t, 7).days;
    check('"this week" is 7 days', w("who hasn't practised this week"), 7);
    check('"in 10 days" is 10', w('who hasnt practiced in 10 days'), 10);
    check('"2 weeks" is 14', w('in the last 2 weeks'), 14);
    check('"this month" is 30', w('this month'), 30);
    check('nothing said is the default', w('who is inactive'), 7);
    check('skill named after "struggling with", class scope cut off',
      app._rivenSkillPhrase('which students are struggling with long division in math')?.text, 'long division');
    check('a subject after "struggling with" is a subject, not a skill',
      app._rivenSkillPhrase('who is struggling with math'), null);
    const ph = app._rivenSkillPhrase('struggling with fractions');
    ok('"fractions" finds "Adding Fractions with Unlike Denominators"', app._rivenSkillMatches('Adding Fractions with Unlike Denominators', ph));
    ok('...and not "Long Division"', !app._rivenSkillMatches('Long Division', ph));
  }

  // ── who hasn't practised ───────────────────────────────────────────────
  console.log("\n== who hasn't practised ==\n");
  {
    const app = makeApp({ overview: { since: dateAgo(7), students: [
      ov(S.stucky, { last_active: null }),
      ov(S.dorjo, { last_active: ago(10) }),
      ov(S.player, { last_active: ago(2), sessions_7d: 3 }),
      ov(S.brook, { last_active: ago(0.2), sessions_7d: 5 }),
    ] } });
    await app.terminalPracticeInactive({ normalized: "who hasn't practised this week" });
    const t = text(last(app));
    check('asked the overview for a 7-day window', app.rpc[0], ['rt_teacher_progress_overview', { p_days: 7 }]);
    ok('says 2 of 4', /2 of 4 students/.test(t));
    ok('names the one who never practised, and says so', /Masterson Stucky — no practice on record/.test(t));
    ok('names the one quiet for 10 days', /Gamelin Dorjo — last practised 10 days ago/.test(t));
    ok('never-practised is listed first', t.indexOf('Masterson') < t.indexOf('Gamelin'));
    ok('leaves out the ones who practised', !/Fadia|Marlowe/.test(t));
    ok('offers the class progress screen', /showClassProgress\('c1'\)/.test(last(app)));
  }
  {
    // Practising Bible yesterday does not answer "who hasn't practised Math".
    const app = makeApp({ classProgress: {
      c1: { class: MATH, students: [ov(S.stucky, { last_active: ago(1) }), ov(S.dorjo, { last_active: ago(1) })],
        skills: [
          { student_id: 's1', subject: 'Bible', skill: 'Books of the Law', last: ago(1), flag: null },
          { student_id: 's2', subject: 'Math', skill: 'Place Value', last: ago(1), flag: null },
        ] },
      c2: { class: ROBO, students: [ov(S.dorjo, { last_active: ago(1) })],
        skills: [{ student_id: 's2', subject: 'Math', skill: 'Place Value', last: ago(1), flag: null }] },
    } });
    await app.terminalPracticeInactive({ normalized: "who hasn't played math dojo this week",
      classMatch: { id: 'c1', name: 'Math', row: MATH, consumed: ['math'] } });
    const t = text(last(app));
    ok('"math dojo" is the game, not the Math class: both own classes are read',
      app.rpc.filter(r => r[0] === 'rt_class_progress').length === 2);
    ok('...for Math only', app.rpc.every(r => r[0] !== 'rt_class_progress' || r[1].p_subject === 'Math'));
    ok('a student in two classes is counted once', /1 of 2 students/.test(t));
    ok('Bible practice does not count as Math', /Masterson Stucky — no practice on record/.test(t));
    ok('says the Dojo is counted as Math practice', /Math Dojo is counted as Math skill practice/.test(t));
  }
  {
    const app = makeApp({ overview: { students: [ov(S.brook, { last_active: ago(1) })] } });
    await app.terminalPracticeInactive({ normalized: "who's inactive" });
    ok('everyone active is said plainly', /Everyone has practised in the last 7 days/.test(text(last(app))));
  }

  // ── who is stuck ───────────────────────────────────────────────────────
  console.log('\n== who is stuck ==\n');
  const stuckOverview = { students: [
    ov(S.stucky, { stuck: 2, stuck_skills: [
      { subject: 'Math', skill: 'Long Division', mastery: 42, practices: 7 },
      { subject: 'Reading', skill: 'Main Idea', mastery: 51, practices: 5 }] }),
    ov(S.dorjo, { stuck: 1, stuck_skills: [{ subject: 'Math', skill: 'Long Division', mastery: 55, practices: 4 }] }),
    ov(S.player, { stuck: 1, stuck_skills: [{ subject: 'Math', skill: 'Adding Fractions', mastery: 30, practices: 9 }] }),
    ov(S.markup, { stuck: 0 }),
  ] };
  {
    const app = makeApp({ overview: stuckOverview });
    await app.terminalPracticeStuck({ normalized: 'who is stuck in maths' });
    const t = text(last(app));
    ok('3 of 4 stuck in Math', /3 of 4 students are stuck in Math/.test(t));
    ok('gives mastery and practices', /Long Division 42% after 7/.test(t));
    ok('a Reading skill is not listed under Math', !/Main Idea/.test(t));
    ok('names the skill that keeps coming up', /Most common: Long Division \(2\)/.test(t));
    ok('says what stuck means', /practised 4\+ times, still under 60%/.test(t));
  }
  {
    const app = makeApp({ overview: stuckOverview });
    await app.terminalPracticeStuck({ normalized: 'which students are struggling with fractions' });
    const t = text(last(app));
    ok('a named skill narrows it to that skill', /1 of 4 students is stuck on “fractions”/.test(t) && /Fadia Player/.test(t) && !/Masterson/.test(t));
  }
  {
    const app = makeApp({ overview: stuckOverview });
    await app.terminalPracticeStuck({ normalized: 'which students are struggling with photosynthesis' });
    ok('nobody stuck on it is said, with the rule', /Nobody is stuck on “photosynthesis” — that would be a skill practised 4\+ times/.test(text(last(app))));
  }
  {
    // A named class reads that class, and flag = 'stuck' is the source.
    const app = makeApp({ classProgress: { c2: { class: ROBO, students: [ov(S.markup), ov(S.brook)], skills: [
      { student_id: 's6', subject: 'Robotics', skill: 'Gear Ratios', mastery: 40, practices: 6, flag: 'stuck', state: 'learning' },
      { student_id: 's5', subject: 'Robotics', skill: 'Gear Ratios', mastery: 90, practices: 6, flag: null, state: 'mastered' },
    ] } } });
    await app.terminalPracticeStuck({ normalized: 'who is stuck in robotics class', classMatch: { id: 'c2', name: 'Robotics', row: ROBO, consumed: ['robotics'] } });
    const h = last(app);
    ok('a named class is read with rt_class_progress', app.rpc.some(r => r[0] === 'rt_class_progress' && r[1].p_class_id === 'c2'));
    ok('a name with markup in it is escaped', /&lt;b&gt;Kit&lt;\/b&gt; O&#39;Hara/.test(h) && !/<b>Kit<\/b>/.test(h));
    ok('the button is for that class', /showClassProgress\('c2'\)/.test(h));
  }

  // ── one student ────────────────────────────────────────────────────────
  console.log('\n== one student ==\n');
  const studentProgress = { class: MATH, students: [ov(S.stucky, { last_active: ago(3), sessions_7d: 2, questions_7d: 40, correct_7d: 30, minutes_7d: 25, mastered: 5 })], skills: [
    { student_id: 's1', subject: 'Math', skill: 'Long Division', state: 'learning', mastery: 42, practices: 7, last: ago(3), flag: 'stuck' },
    { student_id: 's1', subject: 'Math', skill: 'Adding Fractions', state: 'learning', mastery: 58, practices: 2, last: ago(3), flag: null },
    { student_id: 's1', subject: 'Math', skill: 'Place Value', state: 'mastered', mastery: 95, practices: 9, last: ago(45), mastered_at: ago(80), flag: 'fading' },
    { student_id: 's1', subject: 'Math', skill: 'Times Tables', state: 'mastered', mastery: 92, practices: 12, last: ago(3), mastered_at: ago(4), flag: null },
    { student_id: 's1', subject: 'Reading', skill: 'Main Idea', state: 'learning', mastery: 51, practices: 5, last: ago(3), flag: 'stuck' },
    { student_id: 's2', subject: 'Math', skill: 'Long Division', state: 'learning', mastery: 10, practices: 9, last: ago(1), flag: 'stuck' },
  ] };
  const stuckyEnt = (normalized) => ({ normalized, student: { student: { ...S.stucky, full_name: full(S.stucky) }, score: 1 } });
  {
    const app = makeApp({ overview: { students: [] }, classProgress: { c1: studentProgress }, tables: { class_enrollments: [{ class_id: 'c3' }, { class_id: 'c1' }] } });
    await app.terminalStudentPractice(stuckyEnt('what is masterson stucky stuck on'));
    const t = text(last(app));
    ok('stuck on 2 skills, across subjects', /is stuck on 2 skills/.test(t));
    ok('worst first, with mastery and practices', t.indexOf('Long Division') < t.indexOf('Main Idea') && /42% after 7 practices/.test(t));
    ok("another student's stuck skill is not theirs", !/10%/.test(t));
    ok('their own class was tried before the one they do not share with the asker',
      app.rpc.find(r => r[0] === 'rt_class_progress')[1].p_class_id === 'c1');
    ok('fading is named', /1 fading/.test(t) && /Place Value/.test(t));
    ok('last active is said', /Last active 3 days ago/.test(t));
  }
  {
    const app = makeApp({ overview: { students: [] }, classProgress: { c1: studentProgress }, tables: { class_enrollments: [{ class_id: 'c1' }] } });
    await app.terminalStudentPractice(stuckyEnt('what does masterson stucky need help with in english'));
    const t = text(last(app));
    ok('a subject narrows it: English is Reading', /stuck on 1 skill in English/.test(t) && /Main Idea/.test(t) && !/Long Division/.test(t));
  }
  {
    const app = makeApp({ overview: { students: [] }, classProgress: { c1: studentProgress }, tables: { class_enrollments: [{ class_id: 'c1' }] } });
    await app.terminalStudentPractice(stuckyEnt('what has masterson stucky mastered this week'));
    const t = text(last(app));
    ok('mastered this week: only the one from 4 days ago', /mastered 1 skill in the last 7 days \(2 in all\)/.test(t) && /Times Tables/.test(t) && !/Place Value/.test(t));
  }
  {
    const app = makeApp({ overview: { students: [] }, classProgress: { c1: studentProgress }, tables: { class_enrollments: [{ class_id: 'c1' }] } });
    await app.terminalStudentPractice(stuckyEnt('how is masterson stucky doing in math practice'));
    const t = text(last(app));
    ok('summary: activity with accuracy', /2 sessions, 40 questions \(75% right\), 25 min/.test(t));
    ok('summary: counts for the subject', /2 mastered in Math \(1 in the last 30 days\) · 1 stuck · 1 fading/.test(t));
  }
  {
    const app = makeApp({ classProgress: {}, tables: { class_enrollments: [] } });
    await app.terminalStudentPractice(stuckyEnt('what is masterson stucky stuck on'));
    ok('no readable practice is said, not guessed', /can't see any practice/.test(text(last(app))));
  }
  {
    const app = makeApp({ overview: { students: [ov(S.stucky, { last_active: ago(9), stuck_skills: [{ subject: 'Math', skill: 'Long Division', mastery: 42, practices: 7 }], fading: 1 })] } });
    const line = app._rivenPracticeLine(await app._rivenStudentProgress({ ...S.stucky, full_name: full(S.stucky) }, null, { classIds: [], skills: false }));
    ok('"how is X doing" line: last active, stuck, fading', /last active 9 days ago · stuck on Long Division \(42%, 7 tries\) · 1 fading/.test(line.html));
    ok('quiet for a week or stuck counts as worrying', line.worrying === true);
  }

  // ── game and skill assignments ─────────────────────────────────────────
  console.log('\n== game and skill assignments ==\n');
  const hw = { c1: [
    { key: 'k1', title: 'Multiplication Facts', type: 'game', game_id: 'math-dojo', subject: 'Math', due_date: dateAgo(2), assigned: 5, completed: 2, overdue: 2,
      students: [
        { student_id: 's1', first_name: 'Masterson', last_name: 'Stucky', status: 'completed', best_score: 92, completed_at: ago(3) },
        { student_id: 's2', first_name: 'Gamelin', last_name: 'Dorjo', status: 'completed', best_score: 61, completed_at: ago(3) },
        { student_id: 's3', first_name: 'Fadia', last_name: 'Player', status: 'in_progress', best_score: 40, play_seconds: 360, attempts: 2 },
        { student_id: 's4', first_name: 'Marlowe', last_name: 'Brook', status: 'assigned' },
        { student_id: 's5', first_name: 'Marlowe', last_name: 'Tenley', status: 'excused' },
      ] },
    { key: 'k2', title: 'Fractions', type: 'skill_mastery', skill_name: 'Adding Fractions', subject: 'Math', due_date: dateAgo(-5), assigned: 2, completed: 2, overdue: 0,
      students: [
        { student_id: 's1', first_name: 'Masterson', last_name: 'Stucky', status: 'completed', final_score: 80, completed_at: ago(1) },
        { student_id: 's2', first_name: 'Gamelin', last_name: 'Dorjo', status: 'completed', final_score: 70, completed_at: ago(1) },
      ] },
  ] };
  {
    const app = makeApp({ homework: hw });
    await app.terminalHomeworkResults({ normalized: "who hasn't finished the multiplication game" });
    const t = text(last(app));
    ok('found the assignment by a word of its title', /Multiplication Facts/.test(t) && !/Fractions/.test(t));
    ok('counts exclude the excused student', /2 of 4 finished · 1 started · 1 not started · 2 overdue/.test(t));
    ok('lists who is not done, with progress', /Fadia Player — started, best 40%, 6 min, overdue/.test(t) && /Marlowe Brook — not started, overdue/.test(t));
    ok('the excused one is not listed', !/Tenley/.test(t));
    ok('the finished ones are not in the not-done list', !/Masterson Stucky —/.test(t));
  }
  {
    const app = makeApp({ homework: hw });
    await app.terminalHomeworkResults({ normalized: 'how did math do on the multiplication facts',
      classMatch: { id: 'c1', name: 'Math', row: MATH, consumed: ['math'] } });
    const t = text(last(app));
    ok('"how did they do": average and lowest scores', /average 77%/.test(t) && /Lowest scores: Gamelin Dorjo 61%/.test(t));
    ok('...and who is not finished', /Not finished: .*Fadia Player \(overdue\)/.test(t));
    ok('only the named class was read', app.rpc.filter(r => r[0] === 'rt_class_homework').map(r => r[1].p_class_id).join() === 'c1');
  }
  {
    const app = makeApp({ homework: hw });
    await app.terminalHomeworkResults({ normalized: 'who has finished the math dojo assignment' });
    const t = text(last(app));
    ok('"math dojo" finds the game by its game id', /Multiplication Facts/.test(t));
    ok('finished list, best score first', t.indexOf('Masterson Stucky — finished — 92%') >= 0 && t.indexOf('92%') < t.indexOf('61%'));
  }
  {
    const app = makeApp({ homework: hw });
    await app.terminalHomeworkResults({ normalized: 'has gamelin dorjo finished the multiplication game',
      student: { student: { ...S.dorjo, full_name: full(S.dorjo) }, score: 1 } });
    ok("a student named: their row only", /Gamelin Dorjo: finished — 61%/.test(text(last(app))) && !/Fadia/.test(text(last(app))));
  }
  {
    const app = makeApp({ homework: hw });
    await app.terminalHomeworkResults({ normalized: "who hasn't done the volcano worksheet" });
    ok('an unknown title says so and lists real ones', /couldn't find .*“volcano worksheet”.*Multiplication Facts/.test(text(last(app))));
  }
  {
    const app = makeApp({ homework: hw });
    await app.terminalHomeworkResults({ normalized: "who hasn't done their homework" });
    const t = text(last(app));
    ok('no title: the open ones only', /Multiplication Facts/.test(t) && !/Fractions/.test(t));
  }
  {
    // One class unreadable must not sink the answer for the others.
    const app = makeApp({ homework: hw, failClass: ['c2'] });
    await app.terminalHomeworkResults({ normalized: "who hasn't finished the multiplication game" });
    ok('a failing class is skipped, the rest answered', /Multiplication Facts/.test(text(last(app))) && !app.errors.length);
  }

  // ── the progress button ────────────────────────────────────────────────
  console.log('\n== the progress button ==\n');
  {
    const app = makeApp({ showClassProgress: false });
    check('no showClassProgress, no button', app._rivenProgressButtons([MATH]), '');
    const app2 = makeApp();
    const b = app2._rivenProgressButtons([{ id: "c1');alert(1);('", name: 'Math' }]);
    ok('an id cannot break out of the onclick', !/alert\(1\);\('/.test(b.replace(/c1alert1/, '')) && /showClassProgress\('c1alert1'\)/.test(b));
  }

  // ── the briefing ───────────────────────────────────────────────────────
  console.log('\n== the briefing ==\n');
  {
    const app = makeApp();
    const lines = app._rivenBriefingPractice({ students: [
      ov(S.stucky, { last_active: null, stuck_skills: [{ skill: 'Long Division' }], homework_overdue: [{ id: 'h1', title: 'Multiplication Facts', type: 'game' }] }),
      ov(S.dorjo, { last_active: ago(9), stuck_skills: [{ skill: 'Long Division' }, { skill: 'Fractions' }], homework_overdue: [{ id: 'h2', title: 'Multiplication Facts', type: 'game' }] }),
      ov(S.player, { last_active: ago(1) }),
      ov(S.brook, { last_active: null, classes: [{ id: 'c9', name: 'Not mine' }] }),
    ] }, { classIds: new Set(['c1', 'c2']) });
    const t = lines.map(text).join(' | ');
    check('three lines: quiet, stuck, overdue', lines.length, 3);
    ok('quiet: count and names, never-practised first', /2 students haven't practised in 7 days : Masterson Stucky, Gamelin Dorjo/.test(t));
    ok("a student outside the asker's classes is left out", !/Marlowe/.test(t));
    ok('stuck: count and the commonest skills', /2 students are stuck — most often on Long Division \(2\), Fractions \(1\)/.test(t));
    ok('overdue work grouped by assignment', /Multiplication Facts — 2 students/.test(t));
    check('nothing to say, nothing said', makeApp()._rivenBriefingPractice({ students: [ov(S.player, { last_active: ago(1) })] }, {}), []);
  }

  // ── the homework answer: computed overdue, finished results ────────────
  console.log('\n== the homework answer ==\n');
  {
    const rows = [
      { id: 'h1', title: 'Times Tables', subject: 'Math', assignment_type: 'game', due_date: dateAgo(3), status: 'assigned', student_id: 's1' },
      { id: 'h2', title: 'Place Value', subject: 'Math', assignment_type: 'skill_mastery', due_date: dateAgo(-4), status: 'in_progress', student_id: 's1' },
      { id: 'h3', title: 'Fractions', subject: 'Math', assignment_type: 'skill_mastery', due_date: dateAgo(2), status: 'completed', best_score: 88, completed_at: ago(2), student_id: 's1' },
      { id: 'h4', title: 'Old Excused', subject: 'Math', assignment_type: 'game', due_date: dateAgo(5), status: 'excused', student_id: 's1' },
    ];
    const app = makeApp({ tables: { homework_assignments: rows } });
    const ent = { normalized: 'what homework does masterson stucky have', student: { student: { ...S.stucky, full_name: full(S.stucky) } } };
    await app.terminalShowHomework(ent);
    const h = last(app), t = text(h);
    ok('a late open assignment is overdue though its status says assigned', /Times Tables.*⚠️ Overdue/.test(t));
    ok('finished work is shown with its score', /Fractions.*Done · 88%/.test(t));
    ok('the tally says what the list holds', /1 overdue · 1 open · 1 finished in the last 2 weeks/.test(t));
    ok('excused work is neither overdue nor open', !/Old Excused/.test(t));
    const q = app.queries.find(x => x.table === 'homework_assignments');
    ok("no filter on the status nobody writes", !q.calls.some(c => c[0] === 'eq' && c[1] === 'status'));

    const app2 = makeApp({ tables: { homework_assignments: rows } });
    await app2.terminalShowHomework({ ...ent, normalized: 'any overdue homework for masterson stucky' });
    const t2 = text(last(app2));
    ok('"overdue" lists only the computed overdue', /1 overdue homework assignment/.test(t2) && /Times Tables/.test(t2) && !/Place Value|Fractions/.test(t2));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
