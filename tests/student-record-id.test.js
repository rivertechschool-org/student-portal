// A student_id column holds a PROFILE id, never the auth uid.
//
// `shared/config.js` has carried the explanation on `studentRecordId()` for a
// while: a profile's `id` and the auth uid are two different values. They match
// for accounts that self-registered, because the profile was created with
// id = the new auth uid — which is why using the auth uid "appeared to work for
// years". Roster-created students are the other shape: staff make the profile
// first with its own id, and `auth_user_id` is filled in later when the student
// claims a login.
//
// Measured on the live roster when this was found: **37 of 167 student profiles
// have `auth_user_id <> id`, and 14 of those can sign in today.** For every one
// of them, handing work in was refused — and they could not see their own
// submissions either, so the screen looked like they had never submitted.
//
// Six call sites had been converted to the helper. Fourteen had not.
//
// This test is a scan, not a list: it fails on any NEW site that filters or
// writes a student_id from the auth uid, rather than on the fourteen that
// happened to exist.
//
// Run: node tests/student-record-id.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, '..', 'shared', 'config.js'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

const lineOf = (idx) => html.slice(0, idx).split('\n').length;

(async () => {

  console.log('\n== the helper exists and says why ==\n');

  ok('studentRecordId is defined', /studentRecordId\(\)\s*\{/.test(config));
  ok('  and prefers the profile id', /this\.userProfile\?\.id \|\| this\.currentUser\?\.id/.test(config));
  ok('  with the reason written down', /auth uid/.test(config) && /roster-created/i.test(config));

  console.log('\n== no student_id is taken from the auth uid ==\n');

  {
    // Both shapes: filtering by it and writing it.
    const filters = [...html.matchAll(/\.eq\(\s*'student_id'\s*,\s*([^)]+)\)/g)];
    const writes = [...html.matchAll(/student_id:\s*([^,\n}]+)/g)];

    const badFilters = filters
      .filter(m => /userInfo\.user\.id|currentUser\.id|auth\.user\.id/.test(m[1]))
      .map(m => `${lineOf(m.index)}: ${m[1].trim()}`);
    const badWrites = writes
      .filter(m => /userInfo\.user\.id|currentUser\.id|auth\.user\.id/.test(m[1]))
      .map(m => `${lineOf(m.index)}: ${m[1].trim()}`);

    check('nothing filters student_id by the auth uid', badFilters, []);
    check('nothing writes student_id from the auth uid', badWrites, []);
    // And there are enough of them for the scan to mean something.
    ok('  and there are student_id sites to check', filters.length + writes.length >= 15);
  }

  {
    // The helper is what they use instead. Counted rather than named, so
    // converting another site does not need this test edited.
    const used = (html.match(/studentRecordId\(\)/g) || []).length;
    ok(`the helper is used throughout (${used} sites)`, used >= 15);
  }

  console.log('\n== the distinction is not accidental ==\n');

  {
    // A student_id is a foreign key to user_profiles. The auth uid is not a
    // user_profiles id for a roster-created student, so writing one is a
    // constraint violation waiting for the right student to hit it.
    ok('config explains the foreign key', /user_profiles\.id/.test(config));
    ok('  and names the symptom it caused', /No Classes Yet/i.test(config));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
