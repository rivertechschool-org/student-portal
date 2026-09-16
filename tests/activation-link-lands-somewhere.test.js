// An activation link has to reach the page that can finish the job.
//
// CORRECTION - READ THIS BEFORE TRUSTING THE REST
//
// This file was written on a wrong diagnosis. I claimed every activation link
// was landing on the home page because /reset.html was not in the project's
// redirect allow-list. It is, and always was: auth.additional_redirect_urls
// contains https://rivertech.me/**.
//
// What actually happened is that my test call was malformed. The admin
// generate_link REST endpoint takes redirect_to at the TOP level; I passed it
// nested inside `options`, which is the JS client's shape. Nested, it is
// silently ignored and falls back to site_url - which is what I then read as
// "the path is being stripped". Passed correctly, a link goes straight to
// /reset.html. Both shapes verified against the live project.
//
// So the guard this file tests was never fixing a live bug.
//
// WHY IT IS STILL HERE
//
// It is cheap insurance against a real hazard. If a recovery grant ever does
// land on the home page - a stale link from before the allow-list was set, a
// template someone edits, a redirect_to that fails to match - index.html has
// to forward it, and the forward it already had could not be relied on: it ran
// inside initialize(), after the Supabase client is constructed with
// detectSessionInUrl, and supabase-js clears window.location.hash the moment
// it detects an implicit grant. The same race is documented a few lines below
// it for the teacher-invite path.
//
// Running in the head, ahead of both scripts, there is no client yet to race.
// That ordering is the only thing worth asserting, so it is what this file
// asserts - as defence in depth, not as a fix.
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
