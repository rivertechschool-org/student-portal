// The manual route and Riven agree about who may change a student's record.
//
// WHY THIS FILE EXISTS
//
// A trigger now refuses a teacher who changes a student's name, grade level or
// enrolment type. The Student Hub's Profile tab edits exactly those fields and
// is open to every teacher, so the day that trigger went in, a teacher filling
// the form in and pressing Save would have got a policy error out of the
// database - the rule was real but invisible until the moment it bit.
//
// The same was already true, and had always been true, of the attendance tab:
// RLS has never let a teacher write student_schedule, so "Save Schedule" could
// only ever fail for them. That one was not a regression, just never noticed.
//
// So the screen now says the rule. A teacher sees the values, cannot edit the
// protected ones, and is told who can - and the save sends only the fields
// that person is allowed to change, rather than submitting a form that will be
// refused.
//
// The database is still the control. This is the half that makes the control
// legible, and these assertions exist so a later edit to the form cannot
// quietly re-open an input the database will reject.
//
// Run: node tests/student-hub-record-gate.test.js

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
  const re = new RegExp('\\n      (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  i = html.indexOf('{', i);
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, html.indexOf('{', m.index)).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^\s*async\b/.test(m[0].slice(1));
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const STUDENT = {
  id: 's1', first_name: 'Jonathan', last_name: 'Smith', username: 'jsmith',
  email: 'j@example.com', grade_level: '7', enrollment_type: 'full-time',
  account_status: 'activated', auth_user_id: 'auth-1',
};

function makeApp(role, { fields = {} } = {}) {
  const node = (id) => ({ value: fields[id] !== undefined ? fields[id] : '', id });
  const app = {
    role,
    html: '',
    writes: [],
    notices: [],
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    _studentHubId: 's1',
    _studentHubData: { student: { ...STUDENT } },
    showNotification(m, k) { app.notices.push(`${k}:${m}`); },
    viewStudentDetails() {},
    supabaseQuery: (fn) => fn(),
    auth: {
      supabase: {
        from() {
          const q = {
            select() { return q; },
            eq() { return Promise.resolve({ data: [], error: null }); },
            update(patch) { app.writes.push(patch); return { eq: () => Promise.resolve({ error: null }) }; },
            then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
          };
          return q;
        },
      },
    },
  };
  global.document = {
    getElementById: (id) => (id === 'student-hub-tab-content'
      ? { set innerHTML(v) { app.html = v; }, get innerHTML() { return app.html; } }
      : node(id)),
    querySelectorAll: () => [],
  };
  global.confirm = () => false;
  // Side effects the tab kicks off after rendering. Stubbed rather than run:
  // this file is about what the form offers, not what the family panel fetches.
  app.loadHubPickupFamily = () => {};
  app.loadHubParentLinks = () => {};
  app.moveStudentLoginEmail = async () => ({ ok: true, emailSent: true });
  // The tab renders the account box too, which asks these.
  app.isActivated = extract('isActivated');
  app.accountStatusLabel = extract('accountStatusLabel');
  app.isEnrolled = extract('isEnrolled');
  app.escapeHtml = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  app.jsAttr = (t) => String(t == null ? '' : t).replace(/'/g, "\'");
  app.renderStudentHubProfileTab = extract('renderStudentHubProfileTab');
  app.saveStudentHubProfile = extract('saveStudentHubProfile');
  return app;
}

(async () => {

  console.log('\n== the profile form ==\n');

  {
    const app = makeApp('admin');
    await app.renderStudentHubProfileTab.call(app);
    ok('an admin gets an editable name', !/id="hub-first-name"[^>]*disabled/.test(app.html));
    ok('  an editable grade level', !/id="hub-grade-level"[^>]*disabled/.test(app.html));
    ok('  an editable enrolment type', !/id="hub-enrollment-type"[^>]*disabled/.test(app.html));
    ok('  and no notice about the office', !/set by the office/.test(app.html));
  }

  {
    const app = makeApp('teacher');
    await app.renderStudentHubProfileTab.call(app);
    ok('a teacher cannot edit the first name', /id="hub-first-name"[^>]*disabled/.test(app.html));
    ok('  nor the last name', /id="hub-last-name"[^>]*disabled/.test(app.html));
    ok('  nor the grade level', /id="hub-grade-level"[^>]*disabled/.test(app.html));
    ok('  nor the enrolment type', /id="hub-enrollment-type"[^>]*disabled/.test(app.html));
    // The point of the split: they still have the field they actually use.
    ok('but the email stays theirs to fix', !/id="hub-email"[^>]*disabled/.test(app.html));
    ok('and the form says who does set the rest', /set by the office/.test(app.html));
    ok('  while still showing the values', /value="Jonathan"/.test(app.html));
  }

  console.log('\n== the save ==\n');

  {
    const app = makeApp('admin', { fields: {
      'hub-first-name': 'Jonathan', 'hub-last-name': 'Smithe', 'hub-email': 'j@example.com',
      'hub-grade-level': '8', 'hub-enrollment-type': 'homeschool',
    } });
    await app.saveStudentHubProfile.call(app);
    check('an admin sends the whole record', Object.keys(app.writes[0]).sort(),
      ['email', 'enrollment_type', 'first_name', 'grade_level', 'last_name']);
  }

  {
    // A disabled input still HAS a value, so the form would happily post the
    // protected columns back. Sending them at all is what the database judges.
    const app = makeApp('teacher', { fields: {
      'hub-first-name': 'Jonathan', 'hub-last-name': 'Smith', 'hub-email': 'new@example.com',
      'hub-grade-level': '7', 'hub-enrollment-type': 'full-time',
    } });
    await app.saveStudentHubProfile.call(app);
    check('a teacher sends only the email', Object.keys(app.writes[0]), ['email']);
    check('  and it is the new one', app.writes[0].email, 'new@example.com');
    ok('the save is not refused', !app.notices.some(n => /^error:/.test(n)));
  }

  {
    const app = makeApp('teacher', { fields: { 'hub-first-name': '', 'hub-last-name': 'Smith' } });
    await app.saveStudentHubProfile.call(app);
    check('an empty name is still refused before anything is sent', app.writes, []);
  }

  console.log('\n== the attendance tab ==\n');

  {
    // Not a new restriction - RLS has always refused a teacher on
    // student_schedule, so this button could only ever produce an error.
    const src = html.slice(html.indexOf('async renderStudentHubAttendanceTab'));
    const tab = src.slice(0, 9000);
    ok('the day boxes are disabled for a non-admin', /name="hub-schedule-day"[\s\S]{0,200}canSetDays \? '' : 'disabled'/.test(tab));
    ok('Save Schedule is offered only to an admin', /user_type === 'admin'[\s\S]{0,160}saveStudentHubSchedule/.test(tab));
    ok('  and a teacher is told who does set them', /The office sets which days a student attends/.test(tab));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
