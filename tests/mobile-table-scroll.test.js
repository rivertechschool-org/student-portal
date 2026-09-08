// Cards must be able to scroll sideways on a phone.
//
// 35 tables in this file have no scrolling ancestor. Rather than wrap each one,
// a mobile rule gives the card they sit in `overflow-x: auto`. A later rule in
// the same stylesheet set `.card, .modal-content, section { overflow-x: hidden }`
// to stop the page scrolling horizontally - both selectors are (0,1,0), and the
// later one wins, so every one of those tables was clipped with no way to reach
// the hidden columns. On Staff & Parents that lost Username and Actions.
//
// Nothing detects that: it is valid CSS, both rules are intentional, and the
// conflict only shows on a narrow viewport.
//
// Run: node tests/mobile-table-scroll.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
// Comments must go first: the rule-splitting regex below captures everything
// up to the next `{`, so a comment above a rule lands inside its selector and
// `.card` stops being at the start of the string.
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

// Every rule block, as {selector, body}.
const rules = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  rules.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2], at: m.index });
}

const cardRules = rules.filter((r) => /(^|,)\s*\.card\s*(,|$)/.test(r.sel));

const grants = cardRules.filter((r) => /overflow-x:\s*auto/.test(r.body));
const denies = cardRules.filter((r) => /overflow-x:\s*hidden/.test(r.body));

check('a rule gives .card overflow-x: auto', grants.length > 0, true);
check('no rule sets .card to overflow-x: hidden', denies.length, 0);

if (denies.length && grants.length) {
  const lastGrant = Math.max(...grants.map((r) => r.at));
  const lastDeny = Math.max(...denies.map((r) => r.at));
  console.log(`        auto at ${lastGrant}, hidden at ${lastDeny} — ` +
    (lastDeny > lastGrant
      ? 'hidden comes later and wins, so tables are clipped'
      : 'auto comes later, but the pair is still a trap'));
}

// The Staff & Parents tables are pinned to width:100%, which squeezes the
// three action buttons into a stack ~200px tall. Natural width keeps them on
// one line and the card scrolls to reach them.
const userTable = rules.filter((r) => r.sel.includes('.admin-user-table'));
check('.admin-user-table has a width floor', userTable.length > 0, true);
check('  ...and it is min-width: max-content',
      userTable.some((r) => /min-width:\s*max-content/.test(r.body)), true);

// The markup has to actually carry the class, or the rule is decoration.
const tagged = (html.match(/<table class="admin-user-table"/g) || []).length;
check('all four Staff & Parents tables are tagged', tagged, 4);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
