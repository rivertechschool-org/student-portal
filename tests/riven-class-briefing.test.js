// "How is my robotics class doing?" - Riven's class briefing.
//
// A teacher asking how a class is doing wants the flags: who is below 70%,
// who is missing work and on what, what is waiting to be graded, who has
// stopped practising, who keeps missing the lesson. Riven used to answer with
// an average and an attendance count, and without the word "class" it
// answered with the roster.
//
// Routing - which sentence reaches CLASS_BRIEFING - is round 45 of
// debug-tools/nlp-stress.js. This file checks what the answer SAYS, with the
// real _rivenClassBriefing run against an in-memory database:
//
//   * missing work follows the morning briefing's rule: paper (graded_offline)
//     work, work set for chosen students only, and a due date the student's
//     own version moved past today are never "missing"; a submission row of
//     any status means handed in
//   * the class average and the below-70 list come from this quarter's grades
//   * one failed read costs its own section, never the answer, and says so
//   * a class with nothing wrong says so in so many words
//   * every name and title is escaped
//
// THE ROSTER IS INVENTED. No real record is read to build any of it.
//
// Run: node tests/riven-class-briefing.test.js

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

function extract(name) {
  const re = new RegExp('\\n {4,6}(?:async\\s+)?' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') pd++;
    else if (html[i] === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, i).trim();
  i = html.indexOf('{', i);
  const start = i;
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const Ctor = /^async\b/.test(sig) ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const TODAY = '2026-10-13';
const daysAgo = (n) => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

// A query builder that really filters, so a wrong filter shows up as a wrong
// answer rather than passing because the stub ignored it.
function db(tables, { failing = [] } = {}) {
  return {
    from(t) {
      const f = [];
      const api = {
        select() { return api; },
        eq(c, v) { f.push(r => r[c] === v); return api; },
        in(c, vs) { f.push(r => vs.includes(r[c])); return api; },
        lt(c, v) { f.push(r => r[c] != null && String(r[c]) < v); return api; },
        gte(c, v) { f.push(r => r[c] != null && String(r[c]) >= v); return api; },
        order() { return api; }, limit() { return api; },
        then(res, rej) {
          if (failing.includes(t)) return Promise.reject(new Error(t + ' is down')).then(res, rej);
          const rows = (tables[t] || []).filter(r => f.every(fn => fn(r)));
          return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}

const ROSTER = [
  { id: 's1', full_name: 'Ada Pell' },
  { id: 's2', full_name: 'Bo <b>Rook</b>' },     // markup in a name
  { id: 's3', full_name: 'Cy Moss' },
  { id: 's4', full_name: 'Di Fenn' },
];

function world() {
  return {
    class_enrollments: [
      { id: 'e1', class_id: 'rob', student_id: 's1', status: 'active' },
      { id: 'e2', class_id: 'rob', student_id: 's2', status: 'active' },
      { id: 'e3', class_id: 'rob', student_id: 's3', status: 'active' },
      { id: 'e4', class_id: 'rob', student_id: 's4', status: 'active' },
      { id: 'e9', class_id: 'other', student_id: 's1', status: 'active' },
    ],
    quarter_grade_snapshots: [
      { enrollment_id: 'e1', quarter_id: 'q1', class_grade: 92 },
      { enrollment_id: 'e2', quarter_id: 'q1', class_grade: 64 },
      { enrollment_id: 'e3', quarter_id: 'q1', class_grade: 81 },
      { enrollment_id: 'e4', quarter_id: 'q1', class_grade: 0 },      // no grade yet
      { enrollment_id: 'e9', quarter_id: 'q1', class_grade: 10 },     // another class
    ],
    assignments: [
      { id: 'a1', class_id: 'rob', title: 'Lab <1>', due_date: daysAgo(5), is_published: true, assigned_to_all: true, graded_offline: false },
      { id: 'a2', class_id: 'rob', title: 'Circuit quiz', due_date: daysAgo(3), is_published: true, assigned_to_all: true, graded_offline: false },
      { id: 'a3', class_id: 'rob', title: 'Paper worksheet', due_date: daysAgo(4), is_published: true, assigned_to_all: true, graded_offline: true },
      { id: 'a4', class_id: 'rob', title: 'Extra for two', due_date: daysAgo(4), is_published: true, assigned_to_all: false, graded_offline: false },
      { id: 'a5', class_id: 'rob', title: 'Next week', due_date: daysAgo(-5), is_published: true, assigned_to_all: true, graded_offline: false },
      { id: 'a6', class_id: 'rob', title: 'Draft', due_date: daysAgo(2), is_published: false, assigned_to_all: true, graded_offline: false },
      { id: 'a7', class_id: 'rob', title: 'Last quarter', due_date: '2026-07-01', is_published: true, assigned_to_all: true, graded_offline: false },
    ],
    assignment_submissions: [
      { assignment_id: 'a1', student_id: 's1', status: 'graded' },
      { assignment_id: 'a2', student_id: 's1', status: 'submitted' },
      { assignment_id: 'a1', student_id: 's3', status: 'excused' },
      { assignment_id: 'a2', student_id: 's3', status: 'submitted' },
    ],
    homework_assignments: [
      { class_id: 'rob', student_id: 's2', due_date: daysAgo(2), status: 'assigned' },
      { class_id: 'rob', student_id: 's2', due_date: daysAgo(1), status: 'in_progress' },
      { class_id: 'rob', student_id: 's3', due_date: daysAgo(1), status: 'completed' },
      { class_id: 'rob', student_id: 's1', due_date: daysAgo(-2), status: 'assigned' },
    ],
    class_attendance: [
      ...[1, 2, 3].map(n => ({ class_id: 'rob', student_id: 's4', date: daysAgo(n), status: 'absent' })),
      { class_id: 'rob', student_id: 's1', date: daysAgo(2), status: 'late' },
      ...[1, 2, 3].map(n => ({ class_id: 'rob', student_id: 's3', date: daysAgo(40 + n), status: 'absent' })),  // too long ago
    ],
  };
}

function makeApp(tables, opts = {}) {
  const app = {
    auth: { supabase: db(tables, opts) },
    _terminalAllStudents: ROSTER,
    escapeHtml: (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    jsAttr: (t) => String(t == null ? '' : t).replace(/'/g, "\\'"),
    _isoDaysAgo: (n) => daysAgo(n),
    _rivenCurrentQuarter: async () => ({ id: 'q1', start_date: '2026-08-20' }),
    // s4's own version moves Lab <1> to next week: not missing yet.
    loadStudentVersions: async () => [{ assignment_id: 'a1', student_id: 's4', due_date: daysAgo(-7) }],
    studentVersionOf: (vs, aid, sids) => vs.find(v => v.assignment_id === aid && sids.includes(v.student_id)) || null,
    _rivenPracticeFromClasses: async () => opts.practice || {
      people: [
        { id: 's1', name: 'Ada Pell', last: new Date().toISOString() },
        { id: 's2', name: 'Bo <b>Rook</b>', last: null },
        { id: 's3', name: 'Cy Moss', last: new Date(Date.now() - 12 * 86400000).toISOString() },
        { id: 's4', name: 'Di Fenn', last: new Date().toISOString() },
      ], failed: 0,
    },
  };
  for (const n of ['_rivenClassBriefing', '_pctToLetter', '_briefingExpand', '_rivenAgo']) app[n] = extract(n);
  return app;
}

const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const ROW = { id: 'rob', name: 'Robotics', subject: 'Science' };

(async () => {
  console.log('\n== a class with things to flag ==\n');
  const out = await makeApp(world())._rivenClassBriefing(ROW);
  const t = text(out);
  if (process.env.SHOW) console.log(t);

  ok('names the class and its size', /Robotics — how it's doing/.test(t) && /4 students enrolled/.test(t));
  ok('class average over the students with a grade (92, 64, 81 -> 79%)', /Class average 79% \(C\+\)/.test(t) && /3\/4 with a grade/.test(t));
  ok('below 70: the one student, with their grade', /Below 70%: 1 student/.test(t) && /Rook<\/b> — 64% \(D\)/.test(t));
  ok('  not the student from another class', !/10%/.test(t));

  ok('missing work counts 2 students', /Missing work: 2 students/.test(t));
  ok('  Bo is missing both live assignments', /Rook<\/b> — 2 missing: Lab <1>, Circuit quiz/.test(t));
  ok('  Di is missing only the quiz (their own version moved the lab)', /Di Fenn — 1 missing: Circuit quiz/.test(t));
  ok('  an excused row counts as handed in', !/Cy Moss — \d+ missing/.test(t));
  ok('  paper work, chosen-students work, drafts, future and last-quarter work are never missing',
     !/Paper worksheet|Extra for two|Draft|Next week|Last quarter/.test(t));
  ok('most missed names the assignment two skipped', /Most missed: .*— 2 haven't turned it in/.test(t));

  ok('waiting to grade: the two submitted ones', /Waiting for you to grade: 2 submissions/.test(t) && /Circuit quiz — 2 waiting/.test(t));
  ok('  each opens the submissions', /app\.viewSubmissions\('a2'\)/.test(out));

  ok('overdue game & skill work: only Bo, twice', /Overdue game & skill work: 1 student/.test(t) && /Rook<\/b> — 2 overdue/.test(t));

  ok('not practised in 7 days: Bo (never) and Cy (12 days)', /Not practised in 7 days: 2 students/.test(t)
     && /Rook<\/b> — no practice on record/.test(t) && /Cy Moss — last practised/.test(t));
  ok('  never practised is listed first', t.indexOf('no practice on record') < t.indexOf('Cy Moss — last practised'));

  ok('attendance: Di, 3 absences', /Attendance, last 30 days: 1 student/.test(t) && /Di Fenn — 3 absences/.test(t));
  ok('  one late does not flag Ada', !/Ada Pell — \d+ (absence|late)/.test(t));
  ok('  absences 40 days ago do not count', !/Cy Moss — 3 absences/.test(t));

  ok('a name is escaped, never markup', !/<b>Rook<\/b>/.test(out) && /Bo &lt;b&gt;Rook/.test(out));
  ok('a title is escaped', /Lab &lt;1&gt;/.test(out));
  ok('no "nothing needs attention" when there are flags', !/Nothing needs attention/.test(t));

  console.log('\n== a class with nothing wrong ==\n');
  {
    const w = world();
    w.quarter_grade_snapshots = w.quarter_grade_snapshots.map(g => ({ ...g, class_grade: g.enrollment_id === 'e9' ? 10 : 88 }));
    w.assignments = w.assignments.filter(a => a.id !== 'a1' && a.id !== 'a2');
    w.assignment_submissions = [];
    w.homework_assignments = [];
    w.class_attendance = [];
    const now = new Date().toISOString();
    const out2 = await makeApp(w, { practice: { people: ROSTER.map(r => ({ ...r, name: r.full_name, last: now })), failed: 0 } })._rivenClassBriefing(ROW);
    ok('says nothing needs attention', /Nothing needs attention/.test(text(out2)));
  }

  console.log('\n== one read failing ==\n');
  {
    const out3 = text(await makeApp(world(), { failing: ['class_attendance'] })._rivenClassBriefing(ROW));
    ok('the other sections still answer', /Missing work: 2 students/.test(out3) && /Below 70%/.test(out3));
    ok('  and it says what could not load', /Couldn't load: attendance/.test(out3));
    const out4 = text(await makeApp(world(), { practice: { people: [], failed: 1, lastError: new Error('down') } })._rivenClassBriefing(ROW));
    ok('practice that failed to load is not "everyone practised"', /Couldn't load: practice/.test(out4) && !/Not practised/.test(out4));
  }

  console.log('\n== an empty class ==\n');
  {
    const w = world(); w.class_enrollments = [];
    ok('says no one is enrolled', /No students are enrolled yet/.test(text(await makeApp(w)._rivenClassBriefing(ROW))));
  }

  console.log('\n== wiring ==\n');
  ok('CLASS_BRIEFING reaches the class stats handler', /case 'CLASS_STATS':\s*case 'CLASS_BRIEFING':\s*await this\.terminalClassStats\(entities\);/.test(html));
  ok('a named class gets the briefing', /this\._showRivenMessage\(await this\._rivenClassBriefing\(row\), true\);/.test(html));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
