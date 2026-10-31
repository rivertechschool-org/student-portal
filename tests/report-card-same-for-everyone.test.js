// The admin's report card and the student's are the same card.
//
// Every Report Card button runs generateReportCard, but only the admin's report
// panel used to pass the admin's choices for that student (classes left off,
// classes linked or renamed for a mid-year switch) and the column set. Those
// lived in the admin's browser, so the student, a parent, the Student Hub and
// Riven all printed a different card. They are now saved to the database and
// the generator reads them whenever a caller does not pass its own.
//
// This prints one invented student's card both ways against a small database
// stub and checks the two are identical, then checks the admin panel's saves
// reach the database.
//
// Run: node tests/report-card-same-for-everyone.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  const m = new RegExp('\\n(\\s+)(?:async\\s+)?' + name + '\\s*\\(').exec(html);
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

const names = ['generateReportCard', '_loadReportCardYear', '_loadReportCardInputs', '_buildReportCardData', 'loadReportCardSavedOptions', '_parseReportCardColumns',
  '_reportCardOptionsRow', 'saveReportCardOptions', 'saveReportCardColumnPrefs', 'migrateLocalReportCardOptions',
  'loadReportCardOptionsFromStorage', 'normalizeReportCardSubject', 'percentageToGPA', 'gpaToLetter',
  'getCourseWeightModifier', 'courseWeightFor', 'courseWeightLabel', 'determineSchoolYear', 'getQuarterNumber', 'percentageToLetter'];
const proto = eval(`({ ${names.map(method).join(',\n')} })`);

// ---- the database ----
const STUDENT = 'stu-1';
const db = {
  user_profiles: [{ id: STUDENT, first_name: 'Wren', last_name: 'Okafor', date_of_birth: '2012-03-04', grade_level: '8' }],
  quarters: [
    { id: 'q1', name: 'Q1', start_date: '2026-08-20', school_year: '2026-2027', is_current: false },
    { id: 'q2', name: 'Q2', start_date: '2026-10-25', school_year: '2026-2027', is_current: true },
  ],
  school_settings: [{ key: 'current_school_year', value: '2026-2027' }],
  class_enrollments: [
    { id: 'e1', student_id: STUDENT, status: 'archived', class_id: 'c-alg-a', class_grade: 88, academic_grade: 90, participation_grade: 85, classes: { id: 'c-alg-a', name: 'Algebra A', subject: 'Math', credits: 1, course_weight: null } },
    { id: 'e2', student_id: STUDENT, status: 'active', class_id: 'c-alg-b', class_grade: 92, academic_grade: 93, participation_grade: 90, classes: { id: 'c-alg-b', name: 'Algebra B', subject: 'Math', credits: 1, course_weight: null } },
    { id: 'e3', student_id: STUDENT, status: 'active', class_id: 'c-art', class_grade: 75, academic_grade: 70, participation_grade: 80, classes: { id: 'c-art', name: 'Clay Studio', subject: 'Art', credits: 0.5, course_weight: null } },
    { id: 'e4', student_id: STUDENT, status: 'active', class_id: 'c-sci', class_grade: 81, academic_grade: 80, participation_grade: 85, classes: { id: 'c-sci', name: 'Earth Science', subject: 'Science', credits: 1, course_weight: 'honors' } },
  ],
  quarter_grade_snapshots: [
    { enrollment_id: 'e1', quarter_id: 'q1', class_grade: 88, academic_grade: 90, participation_grade: 85 },
    { enrollment_id: 'e4', quarter_id: 'q1', class_grade: 79, academic_grade: 78, participation_grade: 82 },
  ],
  report_card_options: [],
};
const writes = [];

function from(table) {
  const f = { eq: [], in: [], gte: [], lte: [] };
  const rows = () => (db[table] || []).filter(r =>
    f.eq.every(([c, v]) => r[c] === v) && f.in.every(([c, v]) => v.includes(r[c]))
    && f.gte.every(([c, v]) => r[c] >= v) && f.lte.every(([c, v]) => r[c] <= v))
    .map(r => JSON.parse(JSON.stringify(r)));
  const q = {
    select() { return q; },
    eq(c, v) { f.eq.push([c, v]); return q; },
    in(c, v) { f.in.push([c, v]); return q; },
    gte(c, v) { f.gte.push([c, v]); return q; },
    lte(c, v) { f.lte.push([c, v]); return q; },
    order() { return q; },
    single() { const r = rows(); return Promise.resolve({ data: r[0] || null, error: r.length ? null : { message: 'no rows' } }); },
    maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
    upsert(row, opts) {
      const list = Array.isArray(row) ? row : [row];
      const key = opts.onConflict;
      for (const r of list) {
        writes.push({ table, row: r });
        const i = (db[table] || []).findIndex(x => x[key] === r[key]);
        if (i === -1) db[table].push({ ...r });
        else if (!opts.ignoreDuplicates) db[table][i] = { ...db[table][i], ...r };
      }
      return Promise.resolve({ error: null });
    },
    then(res, rej) { return Promise.resolve({ data: rows(), error: null }).then(res, rej); },
  };
  return q;
}

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  key: i => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length; },
};
let printed = null;
global.sessionStorage = { setItem: (k, v) => { if (k === 'reportCardData') printed = JSON.parse(v); } };
global.window = { open() {} };
const checkboxes = {};
global.document = {
  getElementById: id => checkboxes[id] || null,
  querySelectorAll: sel => (sel === '.rc-class-checkbox' ? Object.values(checkboxes).filter(c => c.cls) : []),
};

function makeApp(role) {
  return Object.assign(Object.create(proto), {
    auth: { supabase: { from } },
    supabaseQuery: fn => Promise.resolve(fn()),
    showNotification() {},
    userInfo: { profile: { user_type: role }, user: { id: role + '-1' } },
    quarterWeights: { 1: 0.20, 2: 0.25, 3: 0.25, 4: 0.30 },
  });
}

async function print(app, ...args) {
  printed = null;
  await app.generateReportCard(...args);
  return printed;
}

(async () => {
  // ---- the admin sets the card up in the report panel ----
  const admin = makeApp('admin');
  admin.reportCardCurrentStudentId = STUDENT;
  // Clay Studio left off; Algebra A carried into Algebra B as one course; Earth
  // Science shown under a new name through an empty class.
  checkboxes['art'] = { cls: true, checked: false, value: 'c-art' };
  checkboxes['alg-a'] = { cls: true, checked: true, value: 'c-alg-a' };
  admin.reportCardVirtualClasses = [{ id: 'v-geo', name: 'Geoscience' }];
  admin.reportCardClassLinks = [{ fromClassId: 'c-alg-a', intoClassId: 'c-alg-b' }, { fromClassId: 'c-sci', intoClassId: 'v-geo' }];
  admin.saveReportCardOptions();
  await admin._rcOptionsSave;
  const saved = db.report_card_options.find(r => r.student_id === STUDENT);
  ok('the admin\'s choices for the student reach the database', !!saved
    && JSON.stringify(saved.excluded_class_ids) === '["c-art"]' && saved.class_links.length === 2, JSON.stringify(saved));

  // The H/C and credits columns turned off.
  Object.assign(checkboxes, {
    'rc-col-credits': { checked: false }, 'rc-col-finals': { checked: true }, 'rc-col-hc': { checked: false },
    'rc-col-gp': { checked: true }, 'rc-col-wtgp': { checked: true },
  });
  admin.saveReportCardColumnPrefs();
  await new Promise(r => setTimeout(r, 0));
  ok('the column choice becomes a school setting', db.school_settings.some(r => r.key === 'report_card_columns'
    && JSON.parse(r.value).hc === false && JSON.parse(r.value).credits === false));

  // What the admin panel passes when they press Report Card.
  const fromPanel = {
    columnVisibility: { credits: false, finals: true, hc: false, gp: true, wtgp: true },
    excludedClassIds: ['c-art'],
    classLinks: admin.reportCardClassLinks.slice(),
    virtualClasses: admin.reportCardVirtualClasses.slice(),
  };
  const adminCard = await print(admin, STUDENT, null, fromPanel);

  // ---- everyone else's button: no options ----
  const studentCard = await print(makeApp('student'), STUDENT);
  const parentCard = await print(makeApp('parent'), STUDENT);
  const hubCard = await print(makeApp('admin'), STUDENT);

  const courses = c => c.subjectGroups.flatMap(g => g.courses.map(x => x.courseName));
  ok('the admin\'s card leaves Clay Studio off', !courses(adminCard).includes('Clay Studio'), JSON.stringify(courses(adminCard)));
  ok('  shows Algebra A and B as one course', JSON.stringify(courses(adminCard).filter(n => /Algebra/.test(n))) === '["Algebra B"]', JSON.stringify(courses(adminCard)));
  ok('  and Earth Science renamed Geoscience', courses(adminCard).includes('Geoscience') && !courses(adminCard).includes('Earth Science'), JSON.stringify(courses(adminCard)));
  ok('the student\'s card is the same card', JSON.stringify(studentCard) === JSON.stringify(adminCard),
    'admin ' + JSON.stringify(courses(adminCard)) + ' cols ' + JSON.stringify(adminCard.columnVisibility)
    + '\n        student ' + JSON.stringify(courses(studentCard)) + ' cols ' + JSON.stringify(studentCard.columnVisibility));
  ok('  and so is a parent\'s', JSON.stringify(parentCard) === JSON.stringify(adminCard));
  ok('  and the Student Hub\'s / Riven\'s (no panel)', JSON.stringify(hubCard) === JSON.stringify(adminCard));

  // ---- a student with nothing saved prints the full card, all columns ----
  db.report_card_options = [];
  db.school_settings = db.school_settings.filter(r => r.key !== 'report_card_columns');
  const plain = await print(makeApp('student'), STUDENT);
  ok('nothing saved: every class, every column', courses(plain).length === 4
    && Object.values(plain.columnVisibility).every(Boolean), JSON.stringify(courses(plain)));

  // ---- options saved before this change, only in the admin's browser ----
  store['report_card_options_stu-2'] = JSON.stringify({ excludedClassIds: ['c-x'], classLinks: [], virtualClasses: [] });
  store['report_card_options_stu-3'] = JSON.stringify({ excludedClassIds: [], classLinks: [], virtualClasses: [] });
  db.report_card_options.push({ student_id: STUDENT, excluded_class_ids: ['c-sci'], class_links: [], virtual_classes: [] });
  store['report_card_options_' + STUDENT] = JSON.stringify({ excludedClassIds: ['c-art'], classLinks: [], virtualClasses: [] });
  await admin.migrateLocalReportCardOptions();
  ok('old browser-only options are copied up', db.report_card_options.some(r => r.student_id === 'stu-2'));
  ok('  empty ones are not', !db.report_card_options.some(r => r.student_id === 'stu-3'));
  ok('  and a database row is never overwritten from the browser',
    JSON.stringify(db.report_card_options.find(r => r.student_id === STUDENT).excluded_class_ids) === '["c-sci"]');
  const before = db.report_card_options.length;
  await makeApp('teacher').migrateLocalReportCardOptions();
  ok('only an admin\'s browser copies anything up', db.report_card_options.length === before);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
