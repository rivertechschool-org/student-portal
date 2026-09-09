// A container that content renders INTO must not centre that content.
//
// The Student Directory scrolled sideways but could never scroll back far
// enough to show the Name column. The table was fine; the container was not.
//
// #my-students-list shipped with the layout of its loading state baked in:
//
//   <div id="my-students-list" style="display: flex; align-items: center;
//                                     justify-content: center; padding: 40px;">
//     <div class="loading-spinner"></div> ...
//
// That style is right for a spinner and wrong for what replaces it. When
// renderMyStudentsTable() swaps the spinner for a table, the table becomes a
// CENTRED FLEX ITEM. A centred item wider than its container overflows both
// edges equally - and overflow past the start edge is not scrollable overflow,
// so no amount of scrolling reaches it. The phone rules
// (div:has(> table){overflow-x:auto} + min-width:max-content) were both
// present and working; they simply cannot expose a region the box model has
// put out of reach.
//
// Measured in headless Chrome at a 412px viewport, real stylesheet, real
// markup:
//
//   centred flex container : scrollWidth 628, table 745  ->  157px unreachable
//   plain block container  : scrollWidth 745, table 745  ->    0px unreachable
//
// 157px is the whole Name column - exactly what the report described.
//
// A stylesheet guard was measured too and rejected: justify-content:flex-start
// on the container has NO effect, because the inline style outranks it. It
// works only as !important, which would then override every deliberate
// centring in the file. The fix is structural instead - the spinner gets its
// own wrapper and the container stays a plain block - so this test guards the
// structure.
//
// Run: node tests/render-target-centering.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};

// A loading spinner marks a container as a render target: something replaces
// it later. That is the whole population at risk, and it is findable
// statically - no need to guess which ids receive tables.
const containers = [];
for (const m of html.matchAll(/<div\s+id="([^"]+)"([^>]*)>([\s\S]{0,400}?)<\/div>/g)) {
  if (!m[3].includes('loading-spinner')) continue;
  const style = (m[2].match(/style="([^"]*)"/) || [, ''])[1];
  containers.push({ id: m[1], style });
}

check('spinner containers were found at all', containers.length > 0, true);

// The failure needs both halves: flex to make the child an item, and a
// justification that pushes it off the start edge. align-items is the cross
// axis and harmless, which is why it is not part of the test.
const centres = (style) => /display:\s*flex/.test(style)
  && /justify-content:\s*(center|flex-end|right|end)/.test(style);

const offenders = containers.filter((c) => centres(c.style)).map((c) => c.id);
check('no render target centres what lands in it', offenders, []);

// The two that actually shipped broken, named so a regression says which.
for (const id of ['my-students-list', 'admin-student-record-content']) {
  const c = containers.find((x) => x.id === id);
  check(`${id} is a spinner container`, !!c, true);
  if (c) check(`  ...and does not centre its content`, centres(c.style), false);
}

// The spinner still has to look centred - the layout moved inward, it did not
// disappear. Each of those two should hold a wrapper carrying it.
for (const id of ['my-students-list', 'admin-student-record-content']) {
  const at = html.indexOf(`<div id="${id}"`);
  const near = html.slice(at, at + 500);
  check(`${id} centres the spinner on an inner wrapper`,
        /<div style="[^"]*display:\s*flex[^"]*justify-content:\s*center[^"]*">\s*<div class="loading-spinner">/.test(near),
        true);
}

// The phone rules this depends on must stay put: the container can only be
// scrolled if something makes it a scroller and lets the table outgrow it.
// mobile-table-scroll.test.js owns those rules in full; this is the pairing
// that made the centring bug invisible for so long - both halves present and
// correct, and the columns still unreachable.
check('div:has(> table) is still a scroller',
      /div:has\(>\s*table\)\s*\{[^}]*overflow-x:\s*auto/.test(html), true);
check('tables may still outgrow it',
      /div:has\(>\s*table\)\s*>\s*table\s*\{[^}]*min-width:\s*max-content/.test(html), true);

console.log(`\n  ${containers.length} spinner containers checked`);
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
