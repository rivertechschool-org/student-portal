// class_enrollments.student_id is a foreign key to user_profiles.id
// (constraint class_enrollments_student_id_fkey — the portal even names it in
// its embedded-resource selects). The student side of both portals was matching
// that column against the AUTH uid instead.
//
// Those two ids are the same value only for accounts that self-registered: the
// profile row was created with id = the brand-new auth uid. Roster-created
// students are the other shape — staff make the user_profiles row first with
// its own id, and auth_user_id is filled in later when the student claims the
// login. For them the auth uid matches no profile row at all, so:
//
//   * reading enrollments by it returned zero rows, and the Classes tab said
//     "No Classes Yet" even though the teacher had enrolled them, and
//   * joining by class code tried to INSERT it and got
//     'insert or update on table "class_enrollments" violates foreign key
//      constraint "class_enrollments_student_id_fkey"'.
//
// Reported Sep 10 2026 (lower MS English). This test locks in both halves.
//
// Run: node tests/enrollment-student-id.test.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'shared', 'config.js'), 'utf8');

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log('  ok  ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (detail ? '\n       ' + detail : ''));
  }
}

// --- A. the helper exists and prefers the profile row id --------------------
console.log('A. PortalAuth.studentRecordId()');

check('shared/config.js defines studentRecordId()', /studentRecordId\s*\(\s*\)\s*\{/.test(config));

const body = config.slice(config.indexOf('studentRecordId()'));
const impl = body.slice(0, body.indexOf('}'));
check('it prefers userProfile.id over the auth uid',
      impl.indexOf('userProfile') !== -1 &&
      impl.indexOf('userProfile') < impl.indexOf('currentUser'),
      impl.trim());

// Exercise it for real against the three account shapes.
const studentRecordId = new Function('return function () { ' + impl.slice(impl.indexOf('{') + 1) + ' }')();

check('roster-created student -> profile id',
      studentRecordId.call({
        userProfile: { id: 'profile-uuid', auth_user_id: 'auth-uuid' },
        currentUser: { id: 'auth-uuid' },
      }) === 'profile-uuid');

check('legacy self-registered student -> the shared id',
      studentRecordId.call({
        userProfile: { id: 'same-uuid', auth_user_id: 'same-uuid' },
        currentUser: { id: 'same-uuid' },
      }) === 'same-uuid');

check('profile not loaded yet -> falls back to the auth uid',
      studentRecordId.call({ userProfile: null, currentUser: { id: 'auth-uuid' } }) === 'auth-uuid');

// --- B. no call site reaches for the auth uid any more ----------------------
// Walk each file tracking the most recent .from('<table>') so we only judge the
// student_id lines that actually belong to class_enrollments.
console.log('B. class_enrollments call sites');

for (const rel of ['portal/index.html', 'index.html']) {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
  let table = null;
  const offenders = [];

  lines.forEach((line, i) => {
    const from = line.match(/\.from\('([a-z_]+)'\)/);
    if (from) table = from[1];
    if (table !== 'class_enrollments') return;
    if (!/student_id/.test(line)) return;
    // userInfo.user.id and profile.auth_user_id are both the auth uid.
    if (/userInfo\.user[?]?\.id|auth_user_id/.test(line)) {
      offenders.push((i + 1) + ': ' + line.trim());
    }
  });

  check(rel + ' matches class_enrollments.student_id on the profile id',
        offenders.length === 0, offenders.join('\n       '));
}

// --- C. the shared file's cache-buster moved ---------------------------------
// Every page pins shared/config.js with ?v=N. studentRecordId() is new, so a
// page served with a stale cached config.js would throw on the student's first
// enrollment read. The version must not sit at the pre-fix 17.
console.log('C. cache-busting');

const pages = ['index.html', 'portal/index.html', 'pin-login.html', 'confirm.html', 'reset.html'];
const versions = new Set();
for (const rel of pages) {
  const m = fs.readFileSync(path.join(root, rel), 'utf8').match(/config\.js\?v=(\d+)/);
  check(rel + ' pins a config.js version', !!m);
  if (m) versions.add(Number(m[1]));
}
check('every page pins the same version', versions.size === 1, [...versions].join(', '));
check('version is newer than the pre-fix 17', [...versions].every((v) => v > 17), [...versions].join(', '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
