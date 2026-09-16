// The schedule: services -> the next fortnight of one -> one plan.
//
// The shape is the point. A service type is a standing thing ("Sunday
// Morning"), a date is an instance of it, and the plan is where people, songs
// and files live. A flat list of every date across every service tells you
// nothing about which is which, which is why this reads the way Planning
// Center does.
//
// Three rules worth holding:
//
//   * TODAY COUNTS. Opening this on a Sunday morning, the service you are
//     about to play must be the first thing on the list - not filtered out for
//     being "not in the future".
//   * A DATE WITH NO PLAN IS STILL A DATE. The service happens weekly whether
//     or not anyone has touched it, so an unplanned Sunday is shown, and an
//     admin can start a plan from it.
//   * A PLAYER ANSWERS FOR THEMSELVES AND NOTHING ELSE. Confirming goes
//     through worship_slot_respond(), never a direct update of the slot row:
//     the table is admin-write because a player must not be able to put
//     themselves on a rota or change what they are playing.
//
// Run: node tests/worship-schedule.test.js

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'portal', 'worship.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- lift the two date helpers out of the page -------------------------
function fn(name) {
  const sig = `\nfunction ${name}(`;
  const start = page.indexOf(sig);
  if (start === -1) throw new Error(name + ' not found');
  const end = page.indexOf('\n}\n', start);
  const body = page.slice(start, end + 3).trim();
  return eval(`(function ${body.slice('function '.length + name.length)})`);
}

const localDateStr = fn('localDateStr');
const upcomingDatesForType = fn('upcomingDatesForType');
const statusTag = fn('statusTag');

// A is the page's own state object; the helper reads services off it.
global.A = { services: [], types: [] };

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const TODAY = new Date();
const SUNDAY_TYPE = { id: 't1', name: 'Sunday Morning', weekday: 0 };
const TODAY_TYPE = { id: 't2', name: 'Today Service', weekday: TODAY.getDay() };
const NO_DAY_TYPE = { id: 't3', name: 'One-offs', weekday: null };

// ---- the fortnight window ----------------------------------------------
global.A.services = [];
let dates = upcomingDatesForType(SUNDAY_TYPE);
check('two Sundays fall in a fortnight', dates.length, 2);
ok('every one is a Sunday', dates.every(d => {
  const [y, m, day] = d.date.split('-').map(Number);
  return new Date(y, m - 1, day).getDay() === 0;
}));
ok('all within the next 14 days', dates.every(d => d.date >= dstr(TODAY) && d.date <= dstr(plus(13))));
ok('none of them is planned yet', dates.every(d => d.service === null));

// Today, when today is the service's day.
dates = upcomingDatesForType(TODAY_TYPE);
check("today's service is the first row", dates[0].date, dstr(TODAY));
ok('  and today is not filtered out for being "not future"', dates.length >= 2);

// A type with no weekday has no pattern to project, so only real rows show.
global.A.services = [{ id: 'sv9', service_type_id: 't3', service_date: dstr(plus(3)), status: 'published' }];
dates = upcomingDatesForType(NO_DAY_TYPE);
check('a type with no set day shows only what is planned', dates.map(d => d.service && d.service.id), ['sv9']);

// A planned date carries its service; an unplanned one does not.
const nextSunday = plus((0 - TODAY.getDay() + 7) % 7);
global.A.services = [{ id: 'sv1', service_type_id: 't1', service_date: dstr(nextSunday), status: 'published' }];
dates = upcomingDatesForType(SUNDAY_TYPE);
check('the planned Sunday carries its plan', dates[0].service.id, 'sv1');
check('  and the one after is still offered, unplanned', dates[1].service, null);

// Two services on one date (a morning and an evening) both appear.
global.A.services = [
  { id: 'sv1', service_type_id: 't1', service_date: dstr(nextSunday), status: 'published' },
  { id: 'sv2', service_type_id: 't1', service_date: dstr(nextSunday), status: 'draft' },
];
dates = upcomingDatesForType(SUNDAY_TYPE);
check('two plans on one day are two rows', dates.filter(d => d.date === dstr(nextSunday)).length, 2);
ok('  and the day is not also offered as unplanned',
  !dates.some(d => d.date === dstr(nextSunday) && d.service === null));

// Another service's plans never leak in.
global.A.services = [{ id: 'sv3', service_type_id: 'OTHER', service_date: dstr(nextSunday), status: 'published' }];
dates = upcomingDatesForType(SUNDAY_TYPE);
check('another service\'s date is not borrowed', dates[0].service, null);

// ---- services read in the order the week runs ---------------------------
const compareServiceTypes = fn('compareServiceTypes');
const order = list => list.slice().sort(compareServiceTypes).map(t => t.name);

check('Sunday first, then the week in order',
  order([
    { name: 'Friday thing', weekday: 5 },
    { name: 'Sunday Morning', weekday: 0 },
    { name: 'Wednesday Chapel', weekday: 3 },
    { name: 'Monday band practice', weekday: 1 },
  ]),
  ['Sunday Morning', 'Monday band practice', 'Wednesday Chapel', 'Friday thing']);

// A service with no set day has no place in the week, so it goes after the
// ones that do rather than sorting as "day zero" alongside Sunday.
check('no set day sits at the end',
  order([
    { name: 'One-offs', weekday: null },
    { name: 'Saturday', weekday: 6 },
    { name: 'Sunday Morning', weekday: 0 },
  ]),
  ['Sunday Morning', 'Saturday', 'One-offs']);

// Two on the same day read earliest first, which is the order they happen in.
check('same day, earlier time first',
  order([
    { name: 'Sunday Evening', weekday: 0, start_time: '18:00:00' },
    { name: 'Sunday Morning', weekday: 0, start_time: '10:30:00' },
  ]),
  ['Sunday Morning', 'Sunday Evening']);

check('same day and time falls back to sort_order',
  order([
    { name: 'B', weekday: 0, start_time: '10:00:00', sort_order: 2 },
    { name: 'A', weekday: 0, start_time: '10:00:00', sort_order: 1 },
  ]),
  ['A', 'B']);

check('and then to the name',
  order([
    { name: 'Zebra', weekday: 2 },
    { name: 'Aardvark', weekday: 2 },
  ]),
  ['Aardvark', 'Zebra']);

ok('the sort is applied where the types are loaded',
  /A\.types = \(typesRes\.data \|\| \[\]\)\.slice\(\)\.sort\(compareServiceTypes\);/.test(page));

// ---- who is in, who is out ---------------------------------------------
ok('confirmed reads as in', /\bin\b/.test(statusTag('confirmed')) && statusTag('confirmed').includes('tag yes'));
ok('declined reads as out', statusTag('declined').includes('tag no'));
ok('no answer yet reads as asked', statusTag('scheduled').includes('asked'));
ok('  and an unknown status does not claim an answer', statusTag(null).includes('asked'));

// ---- the rules, as they appear in the page ------------------------------
ok('a reply goes through the function, not the table',
  /rpc\('worship_slot_respond'/.test(page));
ok('  and nothing writes status onto a slot row directly',
  !/worship_service_slots'\)\s*\.update/.test(page));

ok('my schedule is the first tab', page.indexOf("go('myschedule')") < page.indexOf("go('songs')"));
ok('  then planning, for admins only', /A\.isAdmin \? `<button class="\$\{A\.tab === 'plan'/.test(page));
ok('  and songs come before team', page.indexOf("go('songs')") < page.indexOf("go('team')"));
ok('the page opens on my schedule', /tab: 'myschedule'/.test(page));
ok('  unless you are not on the team yet',
  /if \(!A\.member && !A\.isAdmin\) A\.tab = 'team';/.test(page));

ok('pressing Plan from inside a plan comes back out',
  /if \(tab === 'plan' && A\.tab === 'plan'\) \{ A\.openService = null; A\._openType = null; \}/.test(page));
ok('  and My schedule likewise', /if \(tab === 'myschedule' && A\.tab === 'myschedule'\) A\.openMyService = null;/.test(page));

// ---- one rota, two tabs -------------------------------------------------
// A service read from My schedule is the same page for a student, a teacher
// and an admin. The blocks take an `editable` flag rather than each asking
// A.isAdmin, so there is ONE source of that markup and the read-only view
// cannot drift away from the planning view.
ok('the blocks are told whether they may be edited', /function teamBlock\(s, slots, editable\)/.test(page));
ok('  all four of them', /function orderBlock\(s, editable\)/.test(page)
  && /function filesBlock\(s, editable\)/.test(page) && /function notesBlock\(s, editable\)/.test(page));
ok('  and the read-only view passes false', /teamBlock\(s, slots, false\)/.test(page));
ok('  while the plan passes true', /teamBlock\(s, slots, true\)/.test(page));

// Drafts are the planner's workings, so they do not appear on the team's screen.
ok('my schedule shows published services only', /x\.status === 'published'/.test(page));

// The one door between the tabs lands on the same service, not the top.
ok('an admin can step out to planning', /function editInPlan\(serviceId\)/.test(page));
ok('  landing on that service', /A\.openService = serviceId;\s*\n\s*A\.tab = 'plan';/.test(page));
ok('  and a non-admin is never offered it', /\$\{A\.isAdmin \? `<div class="row">\s*\n\s*<button class="btn sec small" onclick="editInPlan/.test(page));

// An unplanned date is an admin's to start.
ok('an admin can start a plan from an empty date', /planDate\('\$\{type\.id\}','\$\{d\.date\}'\)/.test(page));
ok('  and it starts as a draft', /status: 'draft', created_by: A\.me\.id/.test(page));

// Reordering swaps two rows rather than rewriting the list, so two people
// editing different parts of an order cannot clobber each other.
ok('reorder swaps a pair', /const \[newA, newB\] = ao === bo \? \[j, i\] : \[bo, ao\];/.test(page));

// Both numbers are read BEFORE either write goes out. Reading the second after
// the first write has been issued makes the result depend on whether anything
// has already changed the row in hand — a dependency this does not need and
// cannot see.
ok('  reading both first', /const ao = a\.sort_order, bo = b\.sort_order;/.test(page));
ok('  and issuing the writes after that',
  page.indexOf('const ao = a.sort_order, bo = b.sort_order;') <
  page.indexOf("update({ sort_order: newA })"));

// Rows that never had a sort_order set all hold the same number, and swapping
// equal numbers moves nothing: the press would silently do nothing at all.
ok('  with a tie falling back to positions', /ao === bo \? \[j, i\]/.test(page));

// The add-person picker answers the question being asked: who plays this.
// Everyone else is noise to read past.
ok('the picker lists the players of that instrument', /const players = free\.filter\(plays\);/.test(page));
// ...with two escapes, so a strict filter is never a dead end.
ok('  falling back to everyone when nobody plays it', /const widened = A\._addPersonAll \|\| !players\.length;/.test(page));
ok('  and offering to widen by hand', /Show everyone on the team/.test(page));
ok('  which resets after an add', /A\._addPersonAll = false;/.test(page));

// A player is regularly on twice — piano and singing — and answering for one
// is not answering for the other.
ok('every one of my positions gets its own answer', /const mySlots = slots\.filter\(sl => sl\.user_id === A\.me\.id\);/.test(page));
ok('  and nothing takes just the first', !/slots\.find\(sl => sl\.user_id === A\.me\.id\)/.test(page));

// A set-list row is editable after it is added: a key gets moved to suit
// whoever is singing, and who is singing changes too.
ok('a set-list row can be edited', /function editServiceSong\(linkId, serviceId\)/.test(page));
ok('  key, leader and note', /song_key:.*\n.*note:/.test(page) && /row\.leader_user_id = \$\('es-leader'\)\.value \|\| null;/.test(page));
ok('  and the leader is shown on the row', /led by/.test(page));
ok('  but not offered on a database without the column', /if \(A\.songLeaderAvailable\) row\.leader_user_id/.test(page));

// The songs tab is a list now.
ok('songs render as rows', /class="songrow"/.test(page));
ok('  and the card grid is gone', !/class="grid"/.test(page) && !/class="song"/.test(page));

// Practice files are newer than the rest; a database without them loses that
// block only.
ok('a missing files table is survivable', /A\.filesUnavailable = true/.test(page));
ok('  and hides just that block', /if \(A\.filesUnavailable\) return '';/.test(page));
ok('  while the rota still loads', !/if \(fileRes\.error\) throw/.test(page));

// ---- the song the library does not have yet -----------------------------
// The library is always missing the song you want at the moment you want it.
// Sending someone to the Songs tab to add it loses the half-built order behind
// them, so the picker itself makes the song and drops it into this service.
ok('the picker offers to make one', /<option value="__new">/.test(page));
ok('  and acts on the choice', /onchange="onOrderSongPick\('\$\{s\.id\}'\)"/.test(page));

// Cancelling out of the dialog must not leave the picker reading
// "Add a song not in the library…" as though that were a song.
ok('the picker is put back on a real song first',
  /const firstReal = \[\.\.\.sel\.options\]\.find\(o => o\.value !== '__new'\);/.test(page));

// The key already chosen on the row travels into the new song.
ok('the row\'s key is carried in', /const key = \(\$\('song-key-' \+ serviceId\) \|\| \{\}\)\.value \|\| '';/.test(page));
ok('  and used on the link', /song_key: \(key \|\| row\.default_key \|\| ''\)\.trim\(\) \|\| null/.test(page));

// The editor knows where it was opened from, and says so.
ok('the editor takes a service', /function editSong\(id, serviceId, key\)/.test(page));
ok('  and says what saving will do', /Saving adds it to the library and to this service/.test(page));
ok('  on a button that says it too', /Save\$\{forService \? ' and add' : ''\}/.test(page));

// An insert has to hand back the id, or there is nothing to add to the order.
ok('the new id comes back', /insert\(row\)\.select\('id'\)\.single\(\)/.test(page));
ok('  and the song lands at the end of the order', /sort_order: existing\.length/.test(page));

// Two writes, and only the first is the song. If the second fails the song is
// still in the library, which is worth saying rather than swallowing.
ok('a failed link is reported', /Saved to the library, but could not add it here/.test(page));

// And the plan comes back, rather than the whole page resetting to a tab.
ok('the plan is handed back', /await loadServiceChildren\(\);\s*\n\s*renderTab\(\);\s*\n\s*return;/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
