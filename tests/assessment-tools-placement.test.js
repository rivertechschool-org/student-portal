// Where the PE Assessment and Tech Projects tools live.
//
// Both used to sit in every class's action grid. That was wrong twice over:
//
//   * IT PUT PE ASSESSMENT IN FRONT OF A MATHS TEACHER. The grid does not know
//     the subject, so every class offered both tools whether or not they meant
//     anything there.
//   * IT DUPLICATED A PICKER THE TOOL ALREADY HAD. pe-assessment.html and
//     tech-assessment.html each load every class the teacher owns and render a
//     class dropdown in their own header; ?class= only preselects one. So the
//     class context the buttons supplied was never needed.
//
// They are teacher tools that span classes, so they now sit in the Portal
// "More" launcher alongside the other periodic destinations, from the one list
// in navDestinations().
//
// Two rules this guards:
//
//   * THEY STAY OUT OF THE NAV BAR. `secondary: true` is what keeps the bar
//     scannable, and these are used now and then, not daily.
//   * A DESTINATION WITH A url IS ALWAYS A LINK. These are their own pages,
//     not sections, so app.showSection() would do nothing. buildUnifiedNav
//     honours url too, which keeps the "toggle one flag to move an item"
//     promise in the comment above navDestinations true for them.
//
// Run: node tests/extract-portalui.js && node tests/assessment-tools-placement.test.js

const fs = require('fs');
const path = require('path');

const PortalUI = require('./portalui.js');
const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

const TOOLS = ['PE Assessment', 'Tech Projects'];
const dest = (userType, app) => PortalUI.navDestinations(userType, app);
const find = (label, userType = 'teacher', app = 'portal') =>
  dest(userType, app).find(i => i.label === label);

// ---- gone from the class grid ------------------------------------------
console.log('\n== out of the class action grid ==\n');

check('no pe-assessment reference remains', portalHtml.includes('pe-assessment'), false);
check('no tech-assessment reference remains', portalHtml.includes('tech-assessment'), false);
ok('and no leftover button label', !/PE Assessment|Tech Projects/.test(portalHtml));

// The pages themselves must still exist - this moved the entry point, not the tool.
for (const f of ['pe-assessment.html', 'tech-assessment.html']) {
  ok(`${f} is still there`, fs.existsSync(path.join(__dirname, '..', 'portal', f)));
}

// ---- in the More launcher, for the right people ------------------------
console.log('\n== in the Portal More launcher ==\n');

for (const who of ['teacher', 'admin']) {
  const labels = PortalUI.getSecondaryNavItems(who, 'portal').map(i => i.label);
  for (const t of TOOLS) ok(`${who} sees ${t}`, labels.includes(t));
}

for (const who of ['student', 'parent']) {
  const labels = PortalUI.getSecondaryNavItems(who, 'portal').map(i => i.label);
  for (const t of TOOLS) ok(`${who} does not see ${t}`, !labels.includes(t));
}

for (const t of TOOLS) {
  const item = find(t);
  check(`${t} is secondary`, item.secondary, true);
  ok(`${t} is kept out of the nav bar`,
    !dest('teacher', 'portal').filter(i => !i.secondary).some(i => i.label === t));
  check(`${t} is teacher and admin only`, item.roles.sort(), ['admin', 'teacher']);
}

// ---- the url resolves from either app ----------------------------------
console.log('\n== the path depends on which app is asking ==\n');

check('PE from the portal', find('PE Assessment', 'teacher', 'portal').url, 'pe-assessment.html');
check('PE from the main app', find('PE Assessment', 'teacher', 'main').url, 'portal/pe-assessment.html');
check('Tech from the portal', find('Tech Projects', 'teacher', 'portal').url, 'tech-assessment.html');
check('Tech from the main app', find('Tech Projects', 'teacher', 'main').url, 'portal/tech-assessment.html');

ok('no other destination grew a url by accident',
  dest('admin', 'portal').filter(i => i.url).map(i => i.label).sort().join() === TOOLS.slice().sort().join());

// ---- a url destination renders as a link -------------------------------
console.log('\n== a url destination is a link, not a section call ==\n');

global.window = {
  portalAuth: { getUserInfo: () => ({ isAuthenticated: true, profile: { user_type: 'teacher' } }) },
  location: { pathname: '/portal/index.html' },
};
global.document = { querySelector: () => null };

// Promote one out of `secondary` and confirm the bar renders it as a link
// rather than calling app.showSection on a section that does not exist.
const real = PortalUI.navDestinations;
PortalUI.navDestinations = (u, a) => real.call(PortalUI, u, a)
  .map(i => (i.label === 'PE Assessment' ? { ...i, secondary: false } : i));

const bar = PortalUI.buildUnifiedNav('portal', 'home');
ok('promoted, it renders as an anchor', /<a href="pe-assessment\.html"/.test(bar));
ok('  opening in its own tab', /href="pe-assessment\.html" target="_blank"/.test(bar));
ok('  with rel=noopener', /href="pe-assessment\.html" target="_blank" rel="noopener"/.test(bar));
ok('  and never via showSection', !/showSection\('pe-assessment'\)/.test(bar));

PortalUI.navDestinations = real;
ok('restored: it is out of the bar again',
  !/pe-assessment/.test(PortalUI.buildUnifiedNav('portal', 'home')));

// ---- the launcher markup knows about url -------------------------------
console.log('\n== the More card handles both shapes ==\n');

// Search forward from the definition: getTeacherHomeContent is *called*
// earlier in the file than it is defined, so indexOf from zero runs backwards.
const cardStart = portalHtml.indexOf('_renderMoreSectionsCard()');
const card = portalHtml.slice(cardStart, portalHtml.indexOf('getTeacherHomeContent()', cardStart));
ok('the launcher body was located', card.length > 200 && card.length < 4000);
ok('it branches on url', /i\.url/.test(card));
ok('url items become anchors', /<a class="btn btn-secondary" href="\$\{i\.url\}"/.test(card));
ok('  in a new tab, with rel=noopener', /target="_blank" rel="noopener"/.test(card));
ok('section items are still buttons', /onclick="app\.showSection\('\$\{i\.section\}'\)"/.test(card));
ok('both shapes share one style string', (card.match(/const style =/g) || []).length === 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
