// There is one "view one student" screen now: the Student Hub.
//
// My Students used to open its own modal - showStudentDetailsModal(), with
// loadStudentDetails() and a 384-line renderStudentDetailsContent() behind it
// - showing profile, parents, emergency contacts, medical info, notes and
// strikes. The Hub has a tab for each of those, plus editing the modal never
// had, so My Students now opens the Hub like every other entry point.
//
// That move had a precondition. The Hub's tab bar had no role check at all,
// and its Account tab is account administration: resend invite, activate
// account, regenerate the games PIN, the parent link code. Only admins could
// reach the Hub before, so nothing was exposed - sending teachers there
// without gating it would have been.
//
// Client-side gating is a UX affordance, not the control; RLS is the control
// and lives in the other repo. These assertions are about the UI being honest
// about who the tab is for.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

function extract(header) {
  const i = SRC.indexOf(header);
  if (i < 0) return null;
  // brace-match from the end of the signature, not the first '{' - a default
  // parameter can open one inside the argument list
  let p = i, d = 0, sigEnd = -1;
  for (; p < SRC.length; p++) {
    if (SRC[p] === '(') d++;
    else if (SRC[p] === ')') { d--; if (d === 0) { sigEnd = p; break; } }
  }
  let j = SRC.indexOf('{', sigEnd); d = 0;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (d === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}

console.log('\nMy Students opens the Hub');

{
  const tbl = extract('      renderMyStudentsTable(students) {');
  ok('the My Students table was found', !!tbl);
  ok('its View Details button opens the Student Hub',
     /onclick="app\.viewStudentDetails\(/.test(tbl));
  ok('  and no longer opens a modal of its own',
     !/showStudentDetailsModal/.test(tbl));
}

console.log('\nthe retired screen left nothing behind');

for (const gone of ['showStudentDetailsModal', 'loadStudentDetails',
                    'renderStudentDetailsContent', 'switchStudentTab']) {
  ok(gone + ' is gone', !new RegExp('\\b' + gone + '\\s*\\(').test(SRC));
}
// Its markup went too - these class names existed only inside it, and a
// surviving reference would mean something is still reaching for it.
ok('none of its panel markup survives',
   !/sd-tabs|sd-panel|student-details-content/.test(SRC));

console.log('\nthe Account tab is admin-only');

{
  const hub = extract('      renderStudentHub() {');
  ok('the hub renderer was found', !!hub);
  // The button must sit inside an admin condition, not merely exist.
  const acct = hub.indexOf("switchStudentHubTab('account')");
  ok('the hub still offers an Account tab', acct > -1);
  const before = hub.slice(Math.max(0, acct - 400), acct);
  ok('  and the button is behind an admin check',
     /user_type === 'admin' \?/.test(before));
}

{
  const sw = extract('      switchStudentHubTab(tab) {');
  ok('the tab switcher was found', !!sw);
  const acct = sw.indexOf("case 'account':");
  ok('it still routes the account tab', acct > -1);
  const arm = sw.slice(acct, sw.indexOf("case '", acct + 10));
  // Hiding the button is not the gate - the tab can be switched to by name.
  ok('  the switch itself refuses non-admins',
     /user_type !== 'admin'/.test(arm));
  const bail = arm.indexOf('return this.switchStudentHubTab');
  const paint = arm.indexOf('this.renderStudentHubAccountTab()');
  ok('  and returns before rendering the tab',
     bail > -1 && paint > -1 && bail < paint);
}

{
  // The other tabs must NOT have been gated by this change - teachers keep
  // everything the retired modal showed them.
  const hub = extract('      renderStudentHub() {');
  const kept = ['overview', 'profile', 'records', 'attendance', 'notes',
                'strikes', 'family'];
  const gated = kept.filter(t => {
    const at = hub.indexOf(`switchStudentHubTab('${t}')`);
    return /user_type === 'admin' \?/.test(hub.slice(Math.max(0, at - 200), at));
  });
  ok('every other tab stays open to staff: ' + (gated.length ? gated.join(',') : 'none gated'),
     gated.length === 0);
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
if (fail) process.exit(1);
