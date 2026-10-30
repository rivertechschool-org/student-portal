// The report card check: Reports > "Check report cards", and Riven's "check
// report cards" / "what grades are missing".
//
// It builds every enrolled student's card with _buildReportCardData - the code
// that prints them - and lists what would print blank or wrong. This runs the
// real methods against a small database of invented students, each set up to
// have exactly one kind of problem, and checks each is found and nothing else.
//
// Run: node tests/report-card-check.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name, indent = '      ') {
  const m = new RegExp('\\n' + indent + '(?:async\\s+)?' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('not found: ' + name);
  const start = m.index;
  let p = html.indexOf('(', start), pd = 0;
  for (; p < html.length; p++) {
    if (html[p] === '(') pd++;
    else if (html[p] === ')' && --pd === 0) break;
  }
  let i = html.indexOf('{', p), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const names = ['checkReportCards', '_reportCardYearProblems', '_reportCardGaps', '_renderReportCardCheck',
  '_loadReportCardYear', '_buildReportCardData', 'fetchAllRows', '_localDateStr',
  'normalizeReportCardSubject', 'percentageToGPA', 'gpaToLetter', 'getCourseWeightModifier',
  'determineSchoolYear', 'getQuarterNumber', 'percentageToLetter'];
const proto = eval(`({ ${names.map(n => method(n)).join(',\n')} })`);
const rivenCheck = method('terminalReportCardCheck', '    ');

// Q1 is over, Q2 is running.
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const Q1 = { id: 'q1', name: 'Q1', start_date: day(-80), end_date: day(-10), school_year: '2026-2027', is_current: false };
const Q2 = { id: 'q2', name: 'Q2', start_date: day(-9), end_date: day(60), school_year: '2026-2027', is_current: true };
const yearOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`; };
const SY = yearOf(Q1.start_date);
Q1.school_year = Q2.school_year = SY;

const cls = (id, name, subject, teacher = 't1') => ({ id, name, subject, credits: 1, course_weight: null, teacher_id: teacher });
const MATH = cls('c-math', 'Pre-Algebra', 'Math');
const ENG = cls('c-eng', 'Writing Lab', 'English', 't2');
const ART = cls('c-art', 'Clay Studio', 'Art');
const SCI = cls('c-sci', 'Earth Science', 'Science');

let db;
function reset() {
  const S = (id, first, extra = {}) => ({ id, first_name: first, last_name: 'Test', user_type: 'student', date_of_birth: '2012-01-01', grade_level: '7', student_status: 'active', ...extra });
  const E = (id, student, c, extra = {}) => ({ id, student_id: student, class_id: c.id, status: 'active', enrolled_at: day(-85) + 'T09:00:00Z', class_grade: 90, academic_grade: 90, participation_grade: 90, credits_override: null, classes: c, ...extra });
  db = {
    quarters: [Q1, Q2],
    school_settings: [{ key: 'current_school_year', value: SY }],
    user_profiles: [
      S('s-ok', 'Complete'),
      S('s-q1', 'NoQ1'),                                   // Q1 never saved for math
      S('s-blank', 'BlankQ1'),                             // Q1 saved, but blank (0)
      S('s-late', 'JoinedLate'),                           // joined after Q1: no Q1 expected
      S('s-left', 'LeftEarly'),                            // left art after Q1: no Q2 expected
      S('s-empty', 'EmptyRow'),                            // left art with no grades at all
      S('s-nodob', 'NoBirthday', { date_of_birth: null, grade_level: null }),
      S('s-twice', 'Twice'),                               // same class twice
      S('s-link', 'BadLink'),                              // link across subjects
      S('s-q2', 'NoQ2Yet'),                                // nothing yet for the running quarter
      S('s-past', 'Gone', { student_status: 'past' }),      // not checked school-wide
      S('s-none', 'NoClasses'),                            // no card at all
      { id: 't1', first_name: 'Ada', last_name: 'Teach', user_type: 'teacher' },
      { id: 't2', first_name: 'Bo', last_name: 'Teach', user_type: 'teacher' },
    ],
    class_enrollments: [
      E('e-ok', 's-ok', MATH),
      E('e-q1', 's-q1', MATH), E('e-q1b', 's-q1', ENG),
      E('e-blank', 's-blank', MATH),
      E('e-late', 's-late', MATH, { enrolled_at: day(-5) + 'T09:00:00Z' }),
      E('e-left', 's-left', ART, { status: 'archived', class_grade: null }), E('e-left2', 's-left', MATH),
      E('e-empty', 's-empty', ART, { status: 'archived', class_grade: null }), E('e-empty2', 's-empty', MATH),
      E('e-nodob', 's-nodob', MATH),
      E('e-tw1', 's-twice', MATH), E('e-tw2', 's-twice', MATH, { status: 'archived' }),
      E('e-ln1', 's-link', MATH), E('e-ln2', 's-link', ENG),
      E('e-q2', 's-q2', SCI, { class_grade: null }),
      E('e-past', 's-past', MATH, { class_grade: null }),
    ],
    quarter_grade_snapshots: [
      ...['e-ok', 'e-q1b', 'e-left2', 'e-empty2', 'e-nodob', 'e-tw1', 'e-tw2', 'e-ln1', 'e-ln2', 'e-q2', 'e-left']
        .map(e => ({ enrollment_id: e, quarter_id: 'q1', class_grade: 85, academic_grade: 85, participation_grade: 85 })),
      { enrollment_id: 'e-blank', quarter_id: 'q1', class_grade: 0, academic_grade: 0, participation_grade: 0 },
    ],
    report_card_options: [
      { student_id: 's-link', excluded_class_ids: [], class_links: [{ fromClassId: 'c-math', intoClassId: 'c-eng' }], virtual_classes: [{ id: 'v-x', name: 'Ghost Course' }] },
    ],
  };
}

function from(table) {
  const f = [];
  const q = {
    select() { return q; },
    eq(c, v) { f.push(r => r[c] === v); return q; },
    in(c, v) { f.push(r => v.includes(r[c])); return q; },
    gte(c, v) { f.push(r => r[c] >= v); return q; },
    lte(c, v) { f.push(r => r[c] <= v); return q; },
    or(expr) {
      // Only the shape the page uses: "col.is.null,col.neq.value".
      const [a, b] = expr.split(',');
      const col = a.split('.')[0], val = b.split('.').slice(2).join('.');
      f.push(r => r[col] == null || r[col] !== val);
      return q;
    },
    order() { return q; },
    range(a, b) { q._range = [a, b]; return q; },
    single() { const r = rows(); return Promise.resolve({ data: r[0] || null, error: r.length ? null : { message: 'none' } }); },
    then(res, rej) {
      let r = rows();
      if (q._range) r = r.slice(q._range[0], q._range[1] + 1);
      return Promise.resolve({ data: r, error: null }).then(res, rej);
    },
  };
  const rows = () => (db[table] || []).filter(r => f.every(fn => fn(r))).map(r => JSON.parse(JSON.stringify(r)));
  return q;
}

function makeApp(role = 'admin') {
  return Object.assign(Object.create(proto), {
    auth: { supabase: { from } },
    supabaseQuery: fn => Promise.resolve(fn()),
    escapeHtml: t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    jsAttr: t => String(t).replace(/'/g, "\\'"),
    userInfo: { profile: { user_type: role } },
    quarterWeights: { 1: 0.20, 2: 0.25, 3: 0.25, 4: 0.30 },
  });
}

(async () => {
  reset();
  const app = makeApp();
  const r = await app.checkReportCards();
  const who = (first) => r.students.find(x => x.name === `${first} Test`);
  const texts = (first) => (who(first)?.issues || []).map(i => i.text).join(' | ');

  ok('checks every enrolled student with classes, not past ones or ones with none', r.checked === 10, String(r.checked));
  ok('the quarter it checked up to is Q2', r.quarter === 'Q2');
  ok('a complete card is not listed', !who('Complete'));
  ok('Q1 never saved is a missing grade', /Pre-Algebra: no Q1 grade \(no grade was saved when the quarter closed\)/.test(texts('NoQ1')), texts('NoQ1'));
  ok('  and only that class', who('NoQ1')?.issues.length === 1, texts('NoQ1'));
  ok('a blank (0) saved grade is missing too', /no Q1 grade \(the saved grade is blank\)/.test(texts('BlankQ1')), texts('BlankQ1'));
  ok('joining after Q1 ended does not expect Q1', !who('JoinedLate'), texts('JoinedLate'));
  ok('leaving a class after Q1 does not expect Q2 for it', !who('LeftEarly'), texts('LeftEarly'));
  ok('a class left with no grades at all is a blank row', /Clay Studio prints with no grades at all/.test(texts('EmptyRow')), texts('EmptyRow'));
  ok('no birthday and no grade level are reported', /No date of birth/.test(texts('NoBirthday')) && /No grade level/.test(texts('NoBirthday')));
  ok('the same class twice is reported', /Pre-Algebra is on their record twice/.test(texts('Twice')), texts('Twice'));
  ok('a link across subjects is reported', /linked into Writing Lab, but they are different subjects/.test(texts('BadLink')), texts('BadLink'));
  ok('a renamed class with nothing linked in is reported', /"Ghost Course" has nothing linked into it/.test(texts('BadLink')));
  ok('the running quarter is not a missing grade', !who('NoQ2Yet'), texts('NoQ2Yet'));
  {
    // A quarter is due from its last day, not the day after.
    const save = Q2.end_date;
    Q2.end_date = day(0);
    reset();
    const lastDay = await app.checkReportCards();
    ok("on the quarter's last day its blanks count as missing", lastDay.students.some(x => x.name === 'NoQ2Yet Test'));
    Q2.end_date = save;
    reset();
  }
  ok('  but is counted apart as not entered yet', r.inProgress.some(c => c.className === 'Earth Science' && c.students.length === 1));

  const math = r.byClass.find(c => c.className === 'Pre-Algebra');
  ok('missing grades are grouped by class, with the teacher', math && math.teacher === 'Ada Teach' && math.students.length === 2,
    JSON.stringify(r.byClass));
  ok('the counts add up', r.missingCount === 2 && r.brokenCount === 4, `${r.missingCount} missing, ${r.brokenCount} broken`);

  // ---- one student ----
  const one = await app.checkReportCards({ studentId: 's-past' });
  ok('a named student is checked even after they left', one.checked === 1);
  ok('  Gone\'s Q1 is missing', /no Q1 grade/.test((one.students[0]?.issues || []).map(i => i.text).join(' ')));

  // ---- the school year ----
  db.quarters.push({ id: 'q9', name: 'Spring block', start_date: day(70), end_date: null, school_year: SY, is_current: false });
  const r2 = await app.checkReportCards();
  // Unnamed quarters are numbered from their start date, so this one lands
  // on a number already taken - which is just as broken on a card.
  ok('a quarter that does not fit Q1-Q4 is a school problem', r2.school.some(x => /"Spring block" both read as Q\d/.test(x)), JSON.stringify(r2.school));
  ok('  and one with no end date', r2.school.some(x => /"Spring block" has no end date/.test(x)));
  reset();
  db.quarters = db.quarters.map(q => ({ ...q, is_current: false }));
  const r3 = await app.checkReportCards();
  ok('no current quarter is a school problem', r3.school.some(x => /No quarter is marked as the current one/.test(x)));

  // ---- the page ----
  reset();
  const page = app._renderReportCardCheck(await app.checkReportCards());
  ok('the page leads with the totals', /Checked <b>10 students<\/b> up to <b>Q2<\/b>/.test(page) && /<b>6<\/b> need attention/.test(page), page.slice(0, 300));
  ok('  lists missing grades by class', /Missing grades by class \(2 grades\)/.test(page));
  ok('  and the cards that print wrong', /Cards that print wrong or incomplete \(4\)/.test(page));
  ok('  and escapes names', !/<script/.test(app._renderReportCardCheck({ quarter: '', school: [], checked: 1, students: [{ id: 'x', name: '<script>', issues: [{ kind: 'profile', text: 'x' }] }], byClass: [], inProgress: [] })));

  // ---- Riven ----
  const said = [];
  const riven = Object.assign(Object.create(proto), makeApp('admin'), {
    _showRivenMessage: (h) => said.push(h), terminalPrintError: (h) => said.push('ERR ' + h),
    _rivenResolvedStudent: (e) => e.student?.student || null,
    openReportCardCheck() {},
  });
  riven.terminalReportCardCheck = eval('(async function ' + rivenCheck.replace(/^async\s+/, '') + ')');
  await riven.terminalReportCardCheck({});
  const last = said[said.length - 1];
  ok('Riven answers with the same totals', /Checked 10 students up to Q2/.test(last) && /<b>6<\/b> need attention/.test(last), last);
  ok('  names the class missing grades', /Pre-Algebra<\/b> \(Ada Teach\): 2 grades missing/.test(last));
  ok('  and offers the full list', /openReportCardCheck/.test(last));
  said.length = 0;
  await riven.terminalReportCardCheck({ student: { student: { id: 's-q1', full_name: 'NoQ1 Test' } } });
  ok('for one student, Riven lists what is wrong with their card', /NoQ1 Test<\/b>'s card up to Q2/.test(said.at(-1)) && /no Q1 grade/.test(said.at(-1)), said.at(-1));
  said.length = 0;
  riven.userInfo = { profile: { user_type: 'teacher' } };
  await riven.terminalReportCardCheck({});
  ok('a teacher is told it is admin-only', /^ERR .*admin-only/.test(said.at(-1)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
