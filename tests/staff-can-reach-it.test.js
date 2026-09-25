// Screens staff are meant to use, that staff could not get to.
//
// This is the third time the same shape of bug has turned up: a screen built
// for teachers, a backend that lets teachers read it, and no door. Staff
// Duties was the first, Materials Requests the second. So the rule is tested
// now rather than re-found.
//
// TWO DISTINCT FAILURES, and they are opposites:
//
//   1. MATERIALS REQUESTS had a router case and no button. loadMaterialRequests
//      filters .eq('user_id', ...) for non-admins, i.e. it exists to show a
//      teacher their own requests with pending/in-progress/completed tabs --
//      but the only way in was an admin-dashboard card. A teacher could file a
//      request and never learn what happened to it.
//
//   2. #admin-strikes had a button and no router case. It sits in
//      validSections, so the hash router called showSection and the switch
//      had nothing to run: the panel appeared and stayed empty. Clicking the
//      dashboard card worked, which is exactly why nobody noticed -- only a
//      refresh, a bookmark or the Back button hit it.
//
// The general rule, which is what the last block actually enforces: every
// section the hash router will ACCEPT must have something that draws it.
// A name in validSections with no case is a blank page by construction.
//
// Run: node tests/staff-can-reach-it.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// The body of loadSectionContent, which is the switch the hash router reaches.
function routerCases() {
  const i = html.indexOf('loadSectionContent(');
  if (i < 0) throw new Error('loadSectionContent not found');
  let j = html.indexOf('{', i), depth = 0, start = j;
  for (; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  const body = html.slice(start, j);
  return new Set((body.match(/case\s+'([a-z0-9-]+)'/g) || [])
    .map(c => c.replace(/case\s+'/, '').replace(/'$/, '')));
}

function validSectionLists() {
  return (html.match(/const validSections = \[[^\]]*\]/g) || [])
    .map(l => (l.match(/'([a-z0-9-]+)'/g) || []).map(s => s.replace(/'/g, '')));
}

(async () => {

  console.log('\n== a teacher can find their materials requests ==\n');

  {
    // The screen is built for them: non-admins get their own rows only.
    const i = html.indexOf('async loadMaterialRequests(');
    const body = html.slice(i, i + 1200);
    ok('the list is scoped to the person looking when they are not an admin',
       /if \(!isAdmin\)[\s\S]{0,120}\.eq\('user_id'/.test(body));
  }

  {
    const entries = (html.match(/showSection\('materials-requests'\)/g) || []).length;
    ok('more than one way in', entries > 1);
    ok('  one of them on the staff dashboard, beside the other daily actions',
       /Emergency drill[\s\S]{0,1600}showSection\('materials-requests'\)[\s\S]{0,200}Materials/.test(html));
  }

  {
    // Filing is still one tap: the list carries its own New Request button, so
    // pointing the dashboard at the list did not cost anybody a step.
    // The definition, not the first textual mention - which is an HTML
    // comment in the section stub, and matches long before the function does.
    const i = html.search(new RegExp('\\n {4,6}(?:async )?renderMaterialsRequests\\s*\\('));
    const body = html.slice(i, i + 2500);
    ok('the list can still start a new request',
       /showNewMaterialRequestModal\(\)/.test(body));
    ok('  and shows what happened to the old ones',
       /data-filter="pending"/.test(body) && /data-filter="completed"/.test(body));
  }

  console.log('\n== the four admin screens survive a refresh ==\n');

  const cases = routerCases();
  for (const [section, renderer] of [
    ['admin-strikes', 'renderAdminStrikes'],
    ['admin-bell-schedule', 'renderAdminBellSchedule'],
    ['admin-activities', 'renderAdminActivities'],
    ['admin-facilities', 'renderAdminFacilities'],
  ]) {
    ok(`#${section} has something to draw it`, cases.has(section));
    ok(`  and it calls ${renderer}`,
       new RegExp(`case '${section}':\\s*\\n\\s*this\\.${renderer}\\(\\);`).test(html));
  }

  {
    const lists = validSectionLists();
    check('both copies of validSections agree', lists.length >= 2 && lists[0].join() === lists[1].join(), true);
    ok('  and now accept the three that were silently rejected',
       ['admin-bell-schedule', 'admin-activities', 'admin-facilities']
         .every(s => lists[0].includes(s)));
  }

  console.log('\n== the rule, not just the four ==\n');

  {
    // A section the router ACCEPTS but cannot DRAW is a blank page. This is
    // the assertion that stops the next one being found by a person.
    const lists = validSectionLists();
    const accepted = lists[0] || [];
    const blank = accepted.filter(s => !cases.has(s));
    if (blank.length) {
      console.log('  accepted by the hash router with nothing to render them:');
      blank.forEach(s => console.log('    #' + s));
    }
    check('every routable section renders', blank, []);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
