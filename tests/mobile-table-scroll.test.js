// Tables must be readable on a phone.
//
// An audit of all 51 tables in this file found 47 unreadable, in two ways that
// look identical to a user - columns you cannot reach:
//
//   19  no scrolling ancestor at all
//   28  had a scroller and still could not scroll
//
// The second is the subtle one. A table set to width:100% is exactly as wide as
// its container, so it never overflows, so no scrollbar ever appears and the
// columns compress instead. Wrapping a width:100% table in an overflow-x:auto
// div does nothing at all - which is why 17 of them looked handled.
//
// Both halves are therefore required: something to scroll, and permission for
// the table to outgrow it. These assertions pin that pair down, plus the two
// exceptions that make it survivable in practice.
//
// Run: node tests/mobile-table-scroll.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
// Comments first: the rule splitter below captures everything up to the next
// `{`, so a comment above a rule lands inside its selector.
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

const rules = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  rules.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2], at: m.index });
}
const ruleFor = (re) => rules.filter((r) => re.test(r.sel));

// --- the scroller -----------------------------------------------------
const cardRules = ruleFor(/(^|,)\s*\.card\s*(,|$)/);
check('a rule gives .card overflow-x: auto',
      cardRules.some((r) => /overflow-x:\s*auto/.test(r.body)), true);
check('no rule sets .card to overflow-x: hidden',
      cardRules.filter((r) => /overflow-x:\s*hidden/.test(r.body)).length, 0);

const hasScroller = rules.filter((r) => /div:has\(>\s*table\)/.test(r.sel)
                                     && /overflow-x:\s*auto/.test(r.body));
check('any div holding a table becomes a scroller', hasScroller.length > 0, true);

// --- permission to outgrow it -----------------------------------------
const floors = rules.filter((r) => /min-width:\s*max-content/.test(r.body));
check('tables have a width floor', floors.length > 0, true);
check('  ...covering tables in cards',
      floors.some((r) => /\.card table/.test(r.sel)), true);
check('  ...and tables directly in a div',
      floors.some((r) => /div:has\(>\s*table\)\s*>\s*table/.test(r.sel)), true);

// It must be min-width. Every one of these tables carries an inline
// width:100%, which beats a stylesheet `width` outright.
check('the floor is min-width, not width',
      floors.every((r) => !/(^|;)\s*width:\s*max-content/.test(r.body)), true);

// --- the two exceptions -----------------------------------------------
const caps = rules.filter((r) => /table (td|th)/.test(r.sel) && /max-width:\s*220px/.test(r.body));
check('cells are capped so prose wraps', caps.length > 0, true);

const exempt = rules.filter((r) => /td:has\(button\)/.test(r.sel) && /max-width:\s*none/.test(r.body));
check('cells of buttons are exempt from the cap', exempt.length > 0, true);
// The exemption must outrank the cap or it silently loses: `table td:has(button)`
// is (0,0,3) against `.card table td` at (0,1,2).
check('  ...and is scoped to outrank it',
      exempt.every((r) => /\.card |div:has/.test(r.sel)), true);

// --- the rules must live in a phone media query ------------------------
const mobileBlock = /@media[^{]*max-width:\s*768px[^{]*\{[\s\S]*?div:has\(>\s*table\)/.test(css);
check('the table rules sit inside the phone media query', mobileBlock, true);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
