// An activation link has to reach the page that can finish the job.
//
// WHAT WAS BROKEN
//
// Every activation and password link Supabase sends was asking to land on
// /reset.html and landing on the home page instead. Verified against the live
// project by generating a recovery link through the admin API:
//
//   asked for  redirect_to=https://rivertech.me/reset.html
//   got        redirect_to=https://rivertech.me
//
// Every path collapses to the bare origin, because the project's redirect
// allow-list holds only the Site URL, and an un-allow-listed redirect_to falls
// back to it. The tokens still arrive, in the fragment, on the wrong page.
//
// WHY THE EXISTING FALLBACK DID NOT SAVE IT
//
// index.html already forwarded `type=recovery` to reset.html — but from inside
// initialize(), which runs after the Supabase client is constructed. That
// client sets detectSessionInUrl, and supabase-js clears window.location.hash
// the moment it detects an implicit grant. The same race is documented a few
// lines below it for the teacher-invite path. So the fragment was frequently
// gone before anything read it, the forward never fired, and the person was
// left sitting on the login screen with no idea why.
//
// Measured while diagnosing: 3 recovery links sent in 48 hours, 2 never
// completed.
//
// The guard therefore has to run BEFORE supabase-js is parsed, where there is
// no client yet to race. That ordering is the whole fix, so it is what this
// file asserts.
//
// Run: node tests/activation-link-lands-somewhere.test.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const reset = fs.readFileSync(path.join(root, 'reset.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

console.log('\n== the forward runs before anything can eat the fragment ==\n');

const guardAt = index.indexOf("indexOf('type=recovery')");
const supabaseAt = index.indexOf('shared/supabase.min.js');
const configAt = index.indexOf('shared/config.js');

ok('the home page forwards a recovery grant', guardAt > -1);
ok('  before supabase-js is loaded', guardAt > -1 && guardAt < supabaseAt);
// config.js is what constructs the client, so it counts too.
ok('  and before the client is constructed', guardAt > -1 && guardAt < configAt);

console.log('\n== and it forwards the tokens, not just the person ==\n');

const guardBlock = index.slice(guardAt - 400, guardAt + 600);
ok('the fragment is carried across', /reset\.html['"]?\s*\+\s*h\b/.test(guardBlock));
// Without this it would bounce reset.html -> reset.html for ever.
ok('it cannot loop on the reset page itself', /reset\\?\.html\$?\/i?\.test\(window\.location\.pathname\)|reset\\\.html\$/i.test(guardBlock));
// A half-consumed home page in history is a back button that breaks the flow.
ok('it replaces rather than pushes history', /location\.replace\(/.test(guardBlock));
ok('a failure here never blocks the page', /catch\s*\(e\)/.test(guardBlock));

console.log('\n== the destination still knows what to do ==\n');

ok('reset.html reads the recovery fragment', /type\s*!==\s*['"]recovery['"]/.test(reset));
ok('  and can also take a session supabase-js already established',
   /auth\.getSession\(\)/.test(reset));
ok('  setting one from the tokens when it has not', /setSession\(/.test(reset));

console.log('\n== the older paths are untouched ==\n');

// These land on the home page by design and are handled there. The guard must
// not swallow them - it keys on type=recovery alone.
ok('teacher password setup still handled on the home page',
   /setup_password/.test(index));
ok('signup and magiclink still handled there',
   /type === 'signup' \|\| type === 'magiclink'/.test(index));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
