// Every card in the admin tools grid must close its own tags.
//
// Commit 489b3ee reordered those cards and dropped two closing </div> from
// each one. Nothing failed: the HTML still parsed, because a browser silently
// nests an unclosed element. On a desktop grid it looked almost right. On a
// phone it rendered as a staircase - each card inside the previous, indented
// further and clipped off the right edge - and stayed that way through four
// more commits and a mobile pass, because no check looked at markup structure.
//
// node --check cannot catch this: the template literal is a valid string
// whatever HTML it contains.
//
// Run: node tests/admin-cards-balanced.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
const lines = html.split('\n');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

const startIdx = lines.findIndex((l) => l.includes('class="admin-tools-grid'));
check('the admin tools grid exists', startIdx !== -1, true);
if (startIdx === -1) { process.exit(1); }

// Walk from the grid's opening tag to the line where it closes.
let depth = 0;
let endIdx = -1;
for (let i = startIdx; i < Math.min(startIdx + 400, lines.length); i++) {
  depth += (lines[i].match(/<div/g) || []).length;
  depth -= (lines[i].match(/<\/div>/g) || []).length;
  if (depth === 0) { endIdx = i; break; }
}

check('the grid closes at all', endIdx !== -1, true);
if (endIdx === -1) {
  console.log(`\n  The grid never returns to depth 0 — a card is missing a </div>.`);
  console.log(`  ${pass} passed, ${++fail} failed`);
  process.exit(1);
}

const block = lines.slice(startIdx, endIdx + 1);

// The block is static markup — no interpolation — so a raw tag count is a
// sound check here in a way it would not be inside a conditional template.
check('grid block has no interpolation', block.some((l) => l.includes('${')), false);

const opens = block.reduce((n, l) => n + (l.match(/<div/g) || []).length, 0);
const closes = block.reduce((n, l) => n + (l.match(/<\/div>/g) || []).length, 0);
check('every <div> in the grid is closed', opens - closes, 0);

// And each card individually, so one card borrowing another's closer cannot
// balance the total while still nesting.
const cardStarts = [];
block.forEach((l, i) => { if (l.includes('class="card"')) cardStarts.push(i); });
check('grid still holds every card', cardStarts.length, 13);

for (const s of cardStarts) {
  let d = 0;
  let closedAt = -1;
  for (let i = s; i < block.length; i++) {
    d += (block[i].match(/<div/g) || []).length;
    d -= (block[i].match(/<\/div>/g) || []).length;
    if (d === 0) { closedAt = i; break; }
  }
  const title = (block[s + 4] || '').match(/>([^<]+)<\/div>/);
  const name = title ? title[1].replace(/&amp;/g, '&') : `line ${startIdx + s + 1}`;
  check(`card "${name}" closes itself`, closedAt !== -1, true);
}

console.log(`\n  ${cardStarts.length} cards checked`);
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
