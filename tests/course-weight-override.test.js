// Honors (or AP / dual credit) for one student: an admin overrides the class's
// course weight from the class roster, and the report card, transcript and GPA
// use the student's own weight.
//
// Run: node tests/course-weight-override.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  const m = new RegExp('\\n      (?:async\\s+)?' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('not found: ' + name);
  let p = html.indexOf('(', m.index), pd = 0;
  for (; p < html.length; p++) {
    if (html[p] === '(') pd++;
    else if (html[p] === ')' && --pd === 0) break;
  }
  let i = html.indexOf('{', p), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(m.index + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const names = ['generateReportCard', '_loadReportCardYear', '_loadReportCardInputs', '_buildReportCardData', 'loadReportCardSavedOptions',
  '_parseReportCardColumns', 'normalizeReportCardSubject', 'percentageToGPA', 'gpaToLetter', 'getCourseWeightModifier',
  'courseWeightFor', 'courseWeightLabel', 'courseWeightName', 'determineSchoolYear', 'getQuarterNumber', 'percentageToLetter',
  'calculateStudentGPA', 'editCourseWeightOverride', 'saveCourseWeightOverride'];
const proto = eval(`({ ${names.map(method).join(',\n')} })`);

// Two invented students in a normal class and an Honors class. Wren is Honors
// in the normal one; Ivy is taken back to Normal in the Honors one.
const db = {
  user_profiles: [
    { id: 'wren', first_name: 'Wren', last_name: 'Okafor', grade_level: '10' },
    { id: 'ivy', first_name: 'Ivy', last_name: 'Arden', grade_level: '10' },
  ],
  quarters: [{ id: 'q1', name: 'Q1', start_date: '2026-09-01', end_date: '2026-10-30', school_year: '2026-2027', is_current: true }],
  school_settings: [{ key: 'current_school_year', value: '2026-2027' }],
  classes: [
    { id: 'c-eng', name: 'English 10', subject: 'English', credits: 1, course_weight: 'normal', teacher_id: 't1' },
    { id: 'c-bio', name: 'Biology', subject: 'Science', credits: 1, course_weight: 'honors', teacher_id: 't1' },
  ],
  class_enrollments: [
    { id: 'w-eng', student_id: 'wren', class_id: 'c-eng', status: 'active', class_grade: 90, course_weight_override: 'honors' },
    { id: 'w-bio', student_id: 'wren', class_id: 'c-bio', status: 'active', class_grade: 90, course_weight_override: null },
    { id: 'i-eng', student_id: 'ivy', class_id: 'c-eng', status: 'active', class_grade: 90, course_weight_override: null },
    { id: 'i-bio', student_id: 'ivy', class_id: 'c-bio', status: 'active', class_grade: 90, course_weight_override: 'normal' },
  ],
  quarter_grade_snapshots: [
    { enrollment_id: 'w-eng', quarter_id: 'q1', class_grade: 90 }, { enrollment_id: 'w-bio', quarter_id: 'q1', class_grade: 90 },
    { enrollment_id: 'i-eng', quarter_id: 'q1', class_grade: 90 }, { enrollment_id: 'i-bio', quarter_id: 'q1', class_grade: 90 },
  ],
  report_card_options: [],
};
const classOf = id => db.classes.find(c => c.id === id);

// Embeds what the page asks for: classes(...) on enrolments, class_enrollments
// on snapshots, and filters on an embedded column ('class_enrollments.student_id').
let lastUpdate = null, adminOnly = false;
function from(table) {
  const f = [];
  const embed = r => {
    if (table === 'class_enrollments') return { ...r, classes: { ...classOf(r.class_id) } };
    if (table === 'quarter_grade_snapshots') return { ...r, class_enrollments: { ...db.class_enrollments.find(e => e.id === r.enrollment_id) } };
    return { ...r };
  };
  const get = (r, c) => c.split('.').reduce((o, k) => o?.[k], r);
  const rows = () => (db[table] || []).map(embed).filter(r => f.every(fn => fn(r)));
  let patch = null;
  const q = {
    select() { return q; },
    eq(c, v) { f.push(r => get(r, c) === v); return q; },
    in(c, v) { f.push(r => v.includes(get(r, c))); return q; },
    gte(c, v) { f.push(r => get(r, c) >= v); return q; },
    lte(c, v) { f.push(r => get(r, c) <= v); return q; },
    order() { return q; }, limit() { return q; },
    update(p) { patch = p; return q; },
    single() { const r = rows(); return Promise.resolve({ data: r[0] || null, error: r.length ? null : { message: 'no rows' } }); },
    maybeSingle() {
      if (patch) {
        lastUpdate = { table, patch };
        // The database quietly keeps the old value for anyone but an admin.
        const r = db[table].find(x => f.every(fn => fn(embed(x))));
        if (r && !adminOnly) Object.assign(r, patch);
        return Promise.resolve({ data: r ? { course_weight_override: r.course_weight_override } : null, error: null });
      }
      return Promise.resolve({ data: rows()[0] || null, error: null });
    },
    then(res, rej) { return Promise.resolve({ data: rows(), error: null }).then(res, rej); },
  };
  return q;
}

let printed = null;
global.sessionStorage = { setItem: (k, v) => { if (k === 'reportCardData') printed = JSON.parse(v); } };
global.localStorage = { getItem: () => null, setItem() {}, key: () => null, length: 0 };
global.window = { open() {} };
let modal = null, checked = null;
const notes = [];
global.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: sel => (sel === 'input[name="course-weight-override"]:checked' && checked !== undefined ? { value: checked } : null),
};

function makeApp(role) {
  return Object.assign(Object.create(proto), {
    auth: { supabase: { from } },
    supabaseQuery: fn => Promise.resolve(fn()),
    showNotification: (m, k) => notes.push(`${k}:${m}`),
    showModal: (id, title, content) => { modal = { id, title, content }; },
    closeModal() {},
    manageStudents() {},
    userInfo: { profile: { user_type: role }, user: { id: role + '-1' } },
    quarterWeights: { 1: 0.20, 2: 0.25, 3: 0.25, 4: 0.30 },
  });
}

(async () => {
  const course = (card, name) => card.subjectGroups.flatMap(g => g.courses).find(c => c.courseName === name);

  // ---- report card ----
  printed = null;
  await makeApp('admin').generateReportCard('wren');
  const wren = printed;
  ok('report card: Wren is H in English, which is normal for the class', course(wren, 'English 10')?.honorsCollege === 'H', JSON.stringify(course(wren, 'English 10')));
  ok('  and her weighted GP has the Honors half point', Math.abs(course(wren, 'English 10').weightedGP - course(wren, 'English 10').gradePoints - 0.5) < 1e-9);
  ok('  Biology still follows the class (Honors)', course(wren, 'Biology')?.honorsCollege === 'H');
  printed = null;
  await makeApp('student').generateReportCard('ivy');
  const ivy = printed;
  ok('report card: Ivy is not H in Biology, though the class is Honors', course(ivy, 'Biology')?.honorsCollege === 'N/A', JSON.stringify(course(ivy, 'Biology')));
  ok('  and gets no GPA bump there', course(ivy, 'Biology').weightedGP === course(ivy, 'Biology').gradePoints);
  ok('  English follows the class (normal)', course(ivy, 'English 10')?.honorsCollege === 'N/A');

  // ---- GPA ----
  const gw = await makeApp('admin').calculateStudentGPA('wren', '2026-2027');
  const gi = await makeApp('admin').calculateStudentGPA('ivy', '2026-2027');
  const cw = (g, id) => g?.quarters?.[1]?.classes?.find(c => c.classId === id);
  ok('GPA: Wren\'s English counts as Honors', cw(gw, 'c-eng')?.courseWeight === 'honors' && cw(gw, 'c-eng').adjustedGPA === cw(gw, 'c-eng').baseGPA + 0.5, JSON.stringify(gw?.quarters?.[1]));
  ok('GPA: Ivy\'s Biology counts as normal', cw(gi, 'c-bio')?.courseWeight === 'normal' && cw(gi, 'c-bio').adjustedGPA === cw(gi, 'c-bio').baseGPA);
  ok('  so Wren\'s quarter GPA is above Ivy\'s with the same grades', gw.quarters[1].gpa > gi.quarters[1].gpa);

  // ---- transcript: reads the same helper ----
  const tr = method('generateTranscript');
  ok('transcript: weight and H/C come from the student\'s own weight',
    /const courseWeight = this\.courseWeightFor\(enrollment, cls\);[\s\S]{0,200}getCourseWeightModifier\(courseWeight\)[\s\S]{0,600}courseWeightLabel\(courseWeight\)/.test(tr));
  ok('nothing reads the class\'s weight past the override', !/cls\.course_weight\b|classInfo\.course_weight\b|fromEnr\.classes\.course_weight\b/.test(html));

  // ---- roster: admin button, modal, save ----
  const roster = method('manageStudents');
  ok('roster: the ⭐ Honors button is for admins only', /\$\{canSetWeight \? `<button[^`]*editCourseWeightOverride\(/.test(roster)
    && /const canSetWeight = this\.userInfo\.profile\?\.user_type === 'admin';/.test(roster));
  ok('  and a student\'s own weight shows on the roster', /enrollment\.course_weight_override \? `[^`]*courseWeightName\(enrollment\.course_weight_override\)[^`]*\(override\)/.test(roster));

  const admin = makeApp('admin');
  admin.editCourseWeightOverride('i-eng', 'c-eng', '', 'normal');
  ok('the window offers the class default and all four weights', ['value=""', 'value="normal"', 'value="honors"', 'value="ap"', 'value="dual_credit"'].every(v => modal.content.includes(v))
    && /Class default \(Normal\)/.test(modal.content));
  ok('  with the class default picked when there is no override', /value="" checked/.test(modal.content));
  checked = 'ap';
  await admin.saveCourseWeightOverride('i-eng', 'c-eng');
  ok('saving AP writes it to that one enrolment', lastUpdate?.patch.course_weight_override === 'ap' && db.class_enrollments.find(e => e.id === 'i-eng').course_weight_override === 'ap');
  ok('  and says so', notes.some(n => n === 'success:AP for this student'), JSON.stringify(notes));
  checked = '';
  await admin.saveCourseWeightOverride('i-eng', 'c-eng');
  ok('choosing the class default clears it', db.class_enrollments.find(e => e.id === 'i-eng').course_weight_override === null);

  adminOnly = true;
  notes.length = 0;
  checked = 'honors';
  await makeApp('teacher').saveCourseWeightOverride('i-eng', 'c-eng');
  ok('when the database keeps the old value, the page says it was not saved', notes.some(n => /^error:Could not save: only an admin/.test(n)), JSON.stringify(notes));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
