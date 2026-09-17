// Who appears in the admin Classes teacher filter, and who does not.
//
// The dropdown used to be built from the classes themselves - the distinct set
// of `teacher_id` found on them. That is not the roster, and it drops three
// kinds of person on the floor:
//
//   * the SECOND teacher of a class. `secondary_teacher_id` was never read
//     here at all, so a co-teacher was in no dropdown and no class card, and
//     filtering to a teacher never returned the classes they co-teach. 16
//     classes have one.
//   * a teacher between classes. Nothing named them, so they did not exist.
//   * anyone whose class names them by their OTHER id. `teacher_id` points at
//     the login table and `secondary_teacher_id` at the profile table; the
//     lookup used profile ids for both. Every member of staff has the same
//     number in both today, which is exactly why this reads as working.
//
// And it kept people it should have dropped: a teacher who has left still
// appeared, because nothing consulted account_status.
//
// So this file builds a roster on purpose out of shape, renders the real
// method against it, and reads the HTML that comes out. Fixtures are invented
// - no real staff names go in a test file.
//
// Run: node tests/admin-class-teacher-filter.test.js

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

// ---- extract the real methods ------------------------------------------
function method(name, indent = '      ') {
  for (const sig of [`\n${indent}async ${name}(`, `\n${indent}${name}(`]) {
    const start = html.indexOf(sig);
    if (start === -1) continue;
    const close = `\n${indent}}\n`;
    const end = html.indexOf(close, start);
    if (end === -1) throw new Error(name + ' unterminated');
    const body = html.slice(start, end + close.length).trim();
    const isAsync = body.startsWith('async ');
    const src = isAsync ? body.slice('async '.length) : body;
    return eval(`(${isAsync ? 'async ' : ''}function ${src.slice(name.length)})`);
  }
  throw new Error(name + ' not found');
}

const renderAdminClasses = method('renderAdminClasses');
const classTeacherNames = method('classTeacherNames');
const showChangeTeacherModal = method('showChangeTeacherModal');
const staffHasId = method('staffHasId');
const staffLoginId = method('staffLoginId');
const filterAdminClasses = method('filterAdminClasses');
const clearAdminClassFilters = method('clearAdminClassFilters');

// ---- the roster, deliberately awkward ----------------------------------
// Ids are readable strings rather than uuids; nothing here parses them.
const STAFF = [
  // teaches C1 as PRIMARY, and C4 names them by their LOGIN id instead
  { id: 'p-alder', auth_user_id: 'a-alder', first_name: 'Rosa', last_name: 'Alder',
    user_type: 'teacher', account_status: 'activated' },
  // ONLY ever a co-teacher. Invisible before this fix.
  { id: 'p-birch', auth_user_id: 'a-birch', first_name: 'Tom', last_name: 'Birch',
    user_type: 'teacher', account_status: 'activated' },
  // teaches nothing at all right now. Also invisible before this fix.
  { id: 'p-cedar', auth_user_id: 'a-cedar', first_name: 'Nell', last_name: 'Cedar',
    user_type: 'teacher', account_status: 'activated' },
  // has left, but still attached to C2
  { id: 'p-dunne', auth_user_id: 'a-dunne', first_name: 'Ivo', last_name: 'Dunne',
    user_type: 'teacher', account_status: 'inactive' },
  // an admin who teaches nothing: not a teacher, should not be offered
  { id: 'p-elm', auth_user_id: 'a-elm', first_name: 'Sam', last_name: 'Elm',
    user_type: 'admin', account_status: 'activated' },
  // an admin who DOES teach: should be offered, marked as an admin
  { id: 'p-fell', auth_user_id: 'a-fell', first_name: 'Ada', last_name: 'Fell',
    user_type: 'admin', account_status: 'activated' },
];

const CLASSES = [
  { id: 'C1', name: 'Botany', subject: 'Science', grade_band: 'ms', status: 'open',
    teacher_id: 'a-alder', secondary_teacher_id: 'p-birch', max_students: 20 },
  { id: 'C2', name: 'Latin', subject: 'Language', grade_band: 'hs', status: 'open',
    teacher_id: 'a-dunne', secondary_teacher_id: null, max_students: 20 },
  { id: 'C3', name: 'Chorus', subject: 'Music', grade_band: 'ms', status: 'open',
    teacher_id: 'a-fell', secondary_teacher_id: null, max_students: 20 },
  // names Alder by their login id, which is NOT their profile id
  { id: 'C4', name: 'Geology', subject: 'Science', grade_band: 'hs', status: 'open',
    teacher_id: 'a-alder', secondary_teacher_id: null, max_students: 20 },
];

// ---- stubs --------------------------------------------------------------
// A thenable query builder: every chained call returns itself, and awaiting it
// hands back whatever table was asked for.
function builder(rows) {
  const b = {
    select: () => b, eq: () => b, neq: () => b, in: () => b, order: () => b,
    then: (res) => res({ data: rows, error: null }),
  };
  return b;
}

let section;
const app = {
  adminClassesData: null,
  adminClassesStaff: null,
  adminClassFilters: null,
  showAdminClosedClasses: false,
  _gradeBands: [{ code: 'ms' }, { code: 'hs' }],
  gradeBandLabel(g) { return g === 'ms' ? 'Middle' : 'High'; },
  classDescription() { return ''; },
  classTeacherNames,
  staffHasId,
  staffLoginId,
  showChangeTeacherModal,
  renderAdminClasses,
  filterAdminClasses,
  clearAdminClassFilters,
  modal: null,
  notified: [],
  showModal(id, title, content) { this.modal = { id, title, content }; },
  showNotification(msg, kind) { this.notified.push([kind, msg]); },
  supabaseQuery: async (fn) => await fn(),
  auth: {
    supabase: {
      from(table) {
        if (table === 'classes') return builder(CLASSES.map(c => ({ ...c })));
        if (table === 'user_profiles') return builder(STAFF);
        if (table === 'class_enrollments') return builder([{ class_id: 'C1' }, { class_id: 'C1' }]);
        throw new Error('unexpected table ' + table);
      },
    },
  },
};

// Only the one element is ever fetched by the renderer.
global.document = {
  getElementById(id) { return id === 'admin-classes-section' ? section : null; },
};

async function render(filters) {
  section = { innerHTML: '' };
  app.adminClassesData = null;          // force the fetch path every time
  app.adminClassesStaff = null;
  app.adminClassFilters = Object.assign(
    { teacher: '', subject: '', gradeLevel: '', search: '', includePast: false },
    filters || {});
  await app.renderAdminClasses();
  return section.innerHTML;
}

// The teacher <select> only, so a name appearing on a class card below cannot
// be mistaken for the same name appearing in the dropdown.
function dropdown(out) {
  const i = out.indexOf('id="admin-class-teacher-filter"');
  const j = out.indexOf('</select>', i);
  return out.slice(i, j);
}

(async () => {
  // ====================================================================
  // 1. Who is offered
  // ====================================================================
  let out = await render();
  let dd = dropdown(out);

  ok('the primary teacher is offered', dd.includes('Alder, Rosa'));
  ok('a teacher who ONLY co-teaches is offered', dd.includes('Birch, Tom'));
  ok('a teacher with no classes at all is offered', dd.includes('Cedar, Nell'));
  ok('an admin who teaches a class is offered', dd.includes('Fell, Ada'));
  ok('...and is marked as an admin', dd.includes('Fell, Ada (admin)'));
  ok('an admin who teaches nothing is NOT offered', !dd.includes('Elm, Sam'));
  ok('someone who has left is NOT offered by default', !dd.includes('Dunne, Ivo'));
  ok('the way back to them is offered instead',
     out.includes('id="admin-class-past-teachers"') && out.includes('Include 1 who left'));

  // ====================================================================
  // 2. Turning them back on
  // ====================================================================
  out = await render({ includePast: true });
  dd = dropdown(out);
  ok('asking for them brings them back', dd.includes('Dunne, Ivo'));
  ok('...under their own heading', dd.includes('No longer teaching here'));
  ok('the current teachers are still there', dd.includes('Alder, Rosa'));

  // A filter set to someone who has left must keep showing them, or the
  // dropdown reads "All Teachers" while a filter is quietly still applied.
  out = await render({ teacher: 'p-dunne' });
  dd = dropdown(out);
  ok('a selected past teacher stays visible even when not asked for',
     dd.includes('Dunne, Ivo'));
  ok('...and stays selected', /Dunne/.test(dd) && dd.includes('selected'));

  // ====================================================================
  // 3. Filtering
  // ====================================================================
  out = await render({ teacher: 'p-birch' });
  ok('filtering to a CO-teacher finds the class they co-teach', out.includes('Botany'));
  ok('...and excludes the ones they do not', !out.includes('Chorus'));

  out = await render({ teacher: 'p-alder' });
  ok('filtering finds a class that names them by their login id', out.includes('Geology'));
  ok('...as well as the one they teach outright', out.includes('Botany'));
  ok('...and no others', !out.includes('Latin'));

  out = await render({ teacher: 'p-cedar' });
  ok('a teacher with no classes filters down to nothing',
     out.includes('No classes match your filters'));

  // ====================================================================
  // 4. The class card names both teachers
  // ====================================================================
  out = await render();
  ok('a co-taught class names both', out.includes('Rosa Alder + Tom Birch'));
  ok('a singly-taught class names one', out.includes('Ada Fell'));

  check('no teacher at all', classTeacherNames({ teacher: null, secondaryTeacher: null }),
        'No Teacher');
  check('only a second teacher still reads sensibly',
        classTeacherNames({ teacher: null, secondaryTeacher: { first_name: 'Tom', last_name: 'Birch' } }),
        'Tom Birch');

  // ====================================================================
  // 5. Searching by name reaches the second teacher too
  // ====================================================================
  out = await render({ search: 'birch' });
  ok('searching a co-teacher by name finds their class', out.includes('Botany'));
  ok('...and only theirs', !out.includes('Chorus'));

  // ====================================================================
  // 6. Clearing puts everything back, including the past-teacher toggle
  // ====================================================================
  app.adminClassFilters = { teacher: 'p-dunne', subject: 'Science', gradeLevel: 'ms',
                            search: 'x', includePast: true };
  app.adminClassesData = CLASSES;
  app.adminClassesStaff = STAFF;
  section = { innerHTML: '' };
  app.clearAdminClassFilters();
  check('clearing resets every filter', app.adminClassFilters,
        { teacher: '', subject: '', gradeLevel: '', search: '', includePast: false });

  // ====================================================================
  // 7. Change Teacher: recognise the current one, and offer an id that
  //    classes.teacher_id can actually hold.
  //
  // The button hands this the class's teacher_id, which is a LOGIN id, and
  // the list it builds is keyed on PROFILE ids. Comparing the two meant the
  // modal opened on "-- Select Teacher --" as though the class had no
  // teacher; saving then wrote a profile id into a column whose foreign key
  // points at the login table, which does not write the wrong teacher - it
  // fails the constraint and saves nothing.
  // ====================================================================
  app.modal = null;
  await app.showChangeTeacherModal('C1', 'Botany', 'a-alder');   // by LOGIN id
  let m = app.modal.content;

  ok('the modal opened', !!m && app.modal.id === 'change-teacher');
  ok('the class name is in it', m.includes('Botany'));
  // Exactly this: the option carrying Rosa's LOGIN id is the selected one.
  // An either/or assertion here could pass on the wrong branch and report a
  // preselection that is not happening.
  const flat = m.replace(/\s+/g, ' ');
  ok('the teacher already on the class is preselected',
     flat.includes('value="a-alder" selected'));
  ok('...and nobody else is', (flat.match(/selected/g) || []).length === 1);
  ok('the options carry login ids, which is what the column holds',
     m.includes('value="a-birch"') && m.includes('value="a-fell"'));
  ok('...not profile ids', !m.includes('value="p-birch"'));

  // Someone with no login at all cannot be a class's teacher: there is nothing
  // for the foreign key to point at. Better said here than as a constraint
  // error after pressing Save.
  const NO_LOGIN = [{ id: 'p-gorse', auth_user_id: null, first_name: 'Kit',
                      last_name: 'Gorse', email: 'kit@x.com', user_type: 'teacher' }];
  const realFrom = app.auth.supabase.from;
  app.auth.supabase.from = (t) => t === 'user_profiles' ? builder(NO_LOGIN) : realFrom(t);
  app.modal = null;
  await app.showChangeTeacherModal('C1', 'Botany', 'a-alder');
  m = app.modal.content;
  ok('a teacher with no login is not offered as a choice', m.includes('disabled'));
  ok('...and the reason is on the row', m.includes('no login yet'));
  ok('...and they carry no id to save', !m.includes('value="p-gorse"'));
  app.auth.supabase.from = realFrom;

  check('staffLoginId gives the login id', staffLoginId({ id: 'p', auth_user_id: 'a' }), 'a');
  check('staffLoginId refuses a profile with no login',
        staffLoginId({ id: 'p', auth_user_id: null }), null);
  check('staffHasId matches the profile id', staffHasId({ id: 'p', auth_user_id: 'a' }, 'p'), true);
  check('staffHasId matches the login id', staffHasId({ id: 'p', auth_user_id: 'a' }, 'a'), true);
  check('staffHasId matches nobody else', staffHasId({ id: 'p', auth_user_id: 'a' }, 'z'), false);
  check('staffHasId is not fooled by a missing id', staffHasId({ id: 'p' }, undefined), false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
