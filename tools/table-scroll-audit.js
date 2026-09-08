#!/usr/bin/env node
// Which tables can actually be read on a phone?
//
// Two different failures look the same to a user - columns you cannot reach:
//
//   CLIPPED   no scrolling ancestor, or an ancestor with overflow-x:hidden.
//             The columns are rendered and unreachable.
//   SQUEEZED  the table is width:100% inside a scroller, so it never exceeds
//             the container and no scrollbar ever appears. Instead the columns
//             compress: text wraps, and a cell full of buttons becomes a
//             vertical stack that makes the row 200px tall.
//
// The second is the one that fooled me. Fixing the overflow made the Staff &
// Parents tables scrollable and they still looked broken, because width:100%
// meant there was nothing to scroll to.
//
//   node tools/table-scroll-audit.js            summary
//   node tools/table-scroll-audit.js --detail   every table

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'portal', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// Map a line to the method it sits in, so a finding names a screen.
const owners = [];
lines.forEach((l, i) => {
  const m = l.match(/^\s{4,8}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
  if (m && !['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(m[1])) {
    owners.push({ line: i + 1, name: m[1] });
  }
});
const ownerOf = (ln) => {
  let best = 'top level';
  for (const o of owners) { if (o.line <= ln) best = o.name; else break; }
  return best;
};

// Which mobile rules are in force, read from the stylesheet rather than
// assumed - they have changed twice.
const css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const cardScrolls = /\.card\s*\{[^}]*overflow-x:\s*auto/.test(css);
const cardHidden = /(^|,)\s*\.card\s*(,[^{]*)?\{[^}]*overflow-x:\s*hidden/m.test(css);
const tableFloorClasses = [...css.matchAll(/\.([\w-]+)\s*\{[^}]*min-width:\s*max-content/g)]
  .map((m) => m[1]);
// The general rules: any table in a card, or directly inside a div, now gets a
// width floor and a scroller. Read from the stylesheet so this stays honest if
// the rules are changed again.
const generalFloor = /\.card table[^{]*\{[^}]*min-width:\s*max-content/.test(css);
const generalScroller = /div:has\(>\s*table\)\s*\{[^}]*overflow-x:\s*auto/.test(css);

const findings = [];

for (const m of src.matchAll(/<table\b[^>]*>/g)) {
  const ln = src.slice(0, m.index).split('\n').length;
  const tag = m[0];

  // Its own <thead> tells us how many columns it is trying to fit.
  const close = src.indexOf('</table>', m.index);
  const body = src.slice(m.index, close === -1 ? m.index + 4000 : close);
  const cols = (body.match(/<th\b/g) || []).length;
  const hasButtons = /<button\b/.test(body);
  const fullWidth = /width:\s*100%/.test(tag);
  const cls = (tag.match(/class="([^"]*)"/) || [, ''])[1];
  const hasFloor = tableFloorClasses.some((c) => cls.split(/\s+/).includes(c));

  // A wrapper with its own overflow within the few lines above.
  const before = lines.slice(Math.max(0, ln - 6), ln - 1).join('\n');
  const wrapped = /overflow-x:\s*auto|overflow:\s*auto|overflow-x:auto/.test(before);

  // Nearest structural ancestor, by scanning back for an opening container.
  const back = src.slice(Math.max(0, m.index - 6000), m.index);
  const lastCard = back.lastIndexOf('class="card"');
  const lastModal = back.lastIndexOf('modal-content');
  const inCard = lastCard !== -1 && lastCard > lastModal;
  const inModal = lastModal !== -1 && lastModal > lastCard;

  // A scroller only helps if the table can outgrow it. width:100% guarantees
  // it cannot - the table is exactly the width of its container, so no
  // scrollbar ever appears and the columns compress instead. A wrapper around
  // a width:100% table therefore does nothing at all, which is why 17 tables
  // looked handled and were not.
  const canOutgrow = !fullWidth || hasFloor
    || (generalFloor && inCard) || generalFloor;
  const hasScroller = wrapped || (inCard && cardScrolls && !cardHidden)
    || generalScroller;

  let verdict;
  if (hasScroller && canOutgrow) verdict = wrapped ? 'ok-wrapped' : 'ok-card';
  else if (hasScroller) verdict = 'squeezed';
  else if (inModal) verdict = 'clipped-modal';
  else verdict = 'clipped';

  findings.push({ ln, owner: ownerOf(ln), cols, hasButtons, fullWidth, hasFloor,
                  wrapped, inCard, inModal, verdict, cls });
}

const detail = process.argv.includes('--detail');

console.log(`\nTable scroll audit — portal/index.html\n`);
console.log(`  mobile rules: .card overflow-x:auto = ${cardScrolls}, ` +
            `.card forced hidden = ${cardHidden}`);
console.log(`  tables with a width floor: ${tableFloorClasses.join(', ') || 'none'}\n`);

const by = {};
for (const f of findings) (by[f.verdict] ||= []).push(f);

const order = ['clipped', 'clipped-modal', 'squeezed', 'ok-wrapped', 'ok-card'];
const label = {
  clipped: 'CLIPPED — no scroller; columns unreachable',
  'clipped-modal': 'CLIPPED — inside .modal-content, which is overflow-x:hidden',
  squeezed: 'SQUEEZED — width:100% inside a scroller, so it never overflows',
  'ok-wrapped': 'ok — own overflow-x wrapper',
  'ok-card': 'ok — scrolling card, and able to outgrow it',
};

for (const k of order) {
  const list = by[k] || [];
  console.log(`  ${String(list.length).padStart(3)}  ${label[k]}`);
}

// Worth acting on: the ones a user actually cannot read.
const bad = [...(by.clipped || []), ...(by['clipped-modal'] || []), ...(by.squeezed || [])];
const worst = bad.filter((f) => f.hasButtons || f.cols >= 4);

console.log(`\n  ${bad.length} tables are hard to read on a phone.`);
console.log(`  ${worst.length} of those have 4+ columns or action buttons, which is where`);
console.log(`  it stops being cramped and starts being unusable.\n`);

const show = detail ? bad : worst;
const byOwner = new Map();
for (const f of show) {
  if (!byOwner.has(f.owner)) byOwner.set(f.owner, []);
  byOwner.get(f.owner).push(f);
}
for (const [owner, list] of [...byOwner].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${owner}`);
  for (const f of list) {
    console.log(`        line ${String(f.ln).padStart(5)}  ${f.verdict.padEnd(13)} ` +
      `${f.cols} cols${f.hasButtons ? ', buttons' : ''}${f.fullWidth ? ', width:100%' : ''}`);
  }
}
console.log('');
