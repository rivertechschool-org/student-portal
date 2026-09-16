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

ok('the schedule is the first tab', page.indexOf("go('schedule')") < page.indexOf("go('songs')"));
ok('  and songs come before team', page.indexOf("go('songs')") < page.indexOf("go('team')"));
ok('the page opens on the schedule', /tab: 'schedule'/.test(page));
ok('  unless you are not on the team yet',
  /if \(!A\.member && !A\.isAdmin\) A\.tab = 'team';/.test(page));

ok('pressing Schedule from inside a plan comes back out',
  /if \(tab === 'schedule' && A\.tab === 'schedule'\) \{ A\.openService = null; A\._openType = null; \}/.test(page));

// An unplanned date is an admin's to start.
ok('an admin can start a plan from an empty date', /planDate\('\$\{type\.id\}','\$\{d\.date\}'\)/.test(page));
ok('  and it starts as a draft', /status: 'draft', created_by: A\.me\.id/.test(page));

// Reordering swaps two rows rather than rewriting the list.
ok('reorder swaps a pair', /sort_order: b\.sort_order/.test(page) && /sort_order: a\.sort_order/.test(page));

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
