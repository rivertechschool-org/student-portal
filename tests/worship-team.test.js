// The Worship / Band page: where it is reached from, and the two rules that make
// it work for a student as well as for the person who runs the team.
//
//   * ONE ENTRY, BOTH PORTALS. It is a page, not a section, so it hangs off
//     navDestinations with a url and `secondary: true` - which puts it in the
//     More launcher at the foot of the Portal tab for students AND staff, from
//     one definition. Parents are not on it.
//   * NAMES COME BACK THROUGH THE RPCs. A student may not select another
//     student's user_profiles row, so a roster built by embedding that table
//     would render a page of blanks for exactly the people who need it most.
//     worship_roster() and worship_requests_list() return names and nothing
//     else; every other table is read directly.
//
// Dates are the third thing worth guarding. A service is a calendar day, and
// reading one back through Date() as UTC midnight moves it to the day before
// for everyone west of Greenwich - the same bug local-dates.test.js holds the
// portal to.
//
// Run: node tests/extract-portalui.js && node tests/worship-team.test.js

const fs = require('fs');
const path = require('path');

// tests/portalui.js is generated from shared/config.js and deliberately not
// committed. Without it this file throws a stack trace that says nothing about
// the real problem, which has now cost two people an afternoon apiece.
let PortalUI;
try {
  PortalUI = require('./portalui.js');
} catch (e) {
  console.log('\n  This suite reads tests/portalui.js, which is generated and not committed.');
  console.log('  Run this first, then try again:\n');
  console.log('      node tests/extract-portalui.js\n');
  process.exit(1);
}
// The section is named for both jobs it does: worship, and band work that has
// nothing to do with a service. The file and the tables keep the older name.
const LABEL = 'Worship / Band';
const page = fs.readFileSync(path.join(__dirname, '..', 'portal', 'worship.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- pull the page's own helpers out -----------------------------------
function fn(name) {
  const sig = `\nfunction ${name}(`;
  const start = page.indexOf(sig);
  if (start === -1) throw new Error(name + ' not found');
  const end = page.indexOf('\n}\n', start);
  if (end === -1) throw new Error(name + ' unterminated');
  const body = page.slice(start, end + 3).trim();
  return eval(`(function ${body.slice('function '.length + name.length)})`);
}

// ======================================================================
// 1. The way in
// ======================================================================
const find = (userType, app = 'portal') =>
  PortalUI.navDestinations(userType, app).find(i => i.label === LABEL);
const canSee = who => find(who).roles.includes(who);

ok('students can reach it', canSee('student'));
ok('teachers can reach it', canSee('teacher'));
ok('admins can reach it', canSee('admin'));
check('parents cannot', canSee('parent'), false);

ok('it is a page, not a section', !!find('student').url);
ok('it stays out of the nav bar', find('student').secondary === true);
check('path from the portal', find('student', 'portal').url, 'worship.html');
check('path from the main app', find('student', 'main').url, 'portal/worship.html');
ok('the page is actually there', fs.existsSync(path.join(__dirname, '..', 'portal', 'worship.html')));

// It has to be in the More launcher for both audiences, which is what
// getSecondaryNavItems feeds. Last in the list is "the button at the bottom".
for (const who of ['student', 'teacher', 'admin']) {
  const items = PortalUI.getSecondaryNavItems(who, 'portal').map(i => i.label);
  ok(`${who}: in the More launcher`, items.includes(LABEL));
  check(`${who}: at the bottom of it`, items[items.length - 1], LABEL);
}
check('parents: not in their launcher',
  PortalUI.getSecondaryNavItems('parent', 'portal').filter(i => i.label === LABEL), []);

// ======================================================================
// 2. Dates are calendar days, not instants
// ======================================================================
const localDateStr = fn('localDateStr');
const dateFromStr = fn('dateFromStr');
const nextDateForType = fn('nextDateForType');

const pad = n => String(n).padStart(2, '0');
const localOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let hours = 0, wrong = 0;
for (let h = 0; h < 72; h++) {
  const d = new Date(2026, 8, 8, h, 30, 0);   // 8-10 Sep 2026, every hour
  hours++;
  if (localDateStr(d) !== localOf(d)) wrong++;
}
check('localDateStr is the local day at every hour', [hours, wrong], [72, 0]);

// The failure this replaces: new Date('2026-09-20') is UTC midnight, which is
// the 19th once the clock is behind Greenwich.
const parsed = dateFromStr('2026-09-20');
check('a date string parses as that day', localOf(parsed), '2026-09-20');
check('  and keeps its weekday', parsed.getDay(), 0);      // a Sunday

ok('nothing in the page derives a day from toISOString',
  !/toISOString\(\)\s*\.\s*(split|slice)/.test(page) && !/toISOString\(\)\.split\('T'\)/.test(page));

// nextDateForType opens the picker on the next matching weekday.
const sunday = { weekday: 0 };
const next = dateFromStr(nextDateForType(sunday));
check('next Sunday is a Sunday', next.getDay(), 0);
ok('  and is not in the past', localDateStr(next) >= localDateStr(new Date()));
check('a type with no set day falls back to today',
  nextDateForType({ weekday: null }), localDateStr(new Date()));

// ======================================================================
// 3. Labels
// ======================================================================
// instrLabel reads the page's own instrument list, so lift that across too
// rather than restating four rows the page is the source of truth for.
const instrStart = page.indexOf('const INSTRUMENTS = [');
global.INSTRUMENTS = eval(page.slice(page.indexOf('[', instrStart), page.indexOf('];', instrStart) + 1));

const instrLabel = fn('instrLabel');
const whoLabel = fn('whoLabel');

ok('an instrument reads as a word, not an id', /Piano/.test(instrLabel('piano')));
check('an unknown instrument falls back to its id', instrLabel('theremin'), 'theremin');
check('a student shows their grade', whoLabel({ user_type: 'student', grade_level: 5 }), 'Student · Grade 5');
check('a student with no grade still reads', whoLabel({ user_type: 'student' }), 'Student');
check('a teacher', whoLabel({ user_type: 'teacher' }), 'Teacher');
check('an admin reads as staff, not as Admin', whoLabel({ user_type: 'admin' }), 'Staff');

// ======================================================================
// 4. The rules the page is built on
// ======================================================================
// Names via the two functions, never by embedding user_profiles - the embed
// would come back null for a student reading the roster.
ok('the roster comes from worship_roster()', page.includes("rpc('worship_roster')"));
ok('the queue comes from worship_requests_list()', page.includes("rpc('worship_requests_list')"));
ok('the add-person search comes from worship_directory()', page.includes("rpc('worship_directory')"));
ok('user_profiles is never queried directly', !/from\('user_profiles'\)/.test(page));

// A school admin runs the team without being on the roster.
ok('a school admin is a team admin', /user_type === 'admin' \|\| !!\(A\.member && A\.member\.is_worship_admin\)/.test(page));
// Parents and anyone else are turned away before a single query runs.
ok('only students and staff get in', /\['student', 'teacher', 'admin'\]\.includes\(A\.me\.user_type\)/.test(page));

// Drafts are the admin's workings; the team sees published dates only.
ok('members see published services only', /A\.isAdmin \|\| s\.status === 'published'/.test(page));

// Everything drawn from the database goes through esc(). Names, song titles and
// notes are all typed by people.
ok('names are escaped in the roster', /esc\(m\.full_name\)/.test(page));
ok('song titles are escaped', /esc\(s\.title\)/.test(page));
ok('request notes are escaped', /esc\(r\.note\)/.test(page));

// The four instruments are defined once.
const list = (page.match(/id: '(piano|guitar|cajon|singing)'/g) || []).length;
check('four instruments, defined in one list', list, 4);

// ======================================================================
// 5. The pills toggle, and more than one can be on
// ======================================================================
// They were <label>s wrapping a hidden checkbox. Clicking one ran the handler,
// and then the browser's own label behaviour dispatched a second click on the
// input which bubbled back to the label and ran it AGAIN - so every pill turned
// itself on and straight back off, and no instrument could be set. Buttons have
// no second act. These three checks are the shape of that bug, not the symptom.
ok('no pill is a label', !/<label class="pick/.test(page));
ok('no pill hides a checkbox', !/type="checkbox"/.test(page));
ok('every pill is a button', !/class="pick/.test(page) || /<button type="button" class="pick/.test(page));

// State is read back off the class list, never off a .checked that no longer exists.
ok('nothing reads .checked', !/\.checked/.test(page));
ok('the instruments are read with pillOn', /INSTRUMENTS\.filter\(i => pillOn\('em-' \+ i\.id\)\)/.test(page));
ok('  and so is the join form', /INSTRUMENTS\.filter\(i => pillOn\('join-' \+ i\.id\)\)/.test(page));
// The leader pill moved into the add-person dialog when the rota became
// position-first: the instrument is answered by the row you pressed, so the
// only questions left are who, and whether they lead.
ok('  and the leader flag', /pillOn\('ap-lead'\)/.test(page));

// filter() over the whole list is what makes it multi-select: nothing anywhere
// narrows the answer to one instrument.
ok('instruments are a list, not a choice', /instruments text\[\]|instruments: \[\]|instruments,/.test(page));
ok('the join form says so out loud', /You can choose more than one/.test(page));

// A pill a screen reader can follow.
ok('pressed state is exposed', /aria-pressed/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
