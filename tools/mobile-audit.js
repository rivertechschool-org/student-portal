#!/usr/bin/env node
// Find layouts that cannot fit a phone.
//
// The portal is one 57k-line file with ~690 inline `display:flex` and 48
// tables, so eyeballing it is not a plan. This looks for the specific shapes
// that break at 390px and reports them grouped by the function they live in,
// so a fix can be scoped to a screen rather than a line.
//
// Deliberately not a linter. Every hit here is legitimate CSS that simply
// cannot reflow narrow, and some are fine because they sit inside a scroll
// container. The output is a shortlist to look at, not a list of bugs.
//
//   node tools/mobile-audit.js            # summary by screen
//   node tools/mobile-audit.js --detail   # every hit with line numbers

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'portal', 'index.html');
const PHONE = 390;                    // iPhone 14/15 logical width
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// Map a line number back to the enclosing method, so hits group by screen.
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

const CHECKS = [
  {
    id: 'fixed-min-width',
    why: `min-width above ${PHONE}px forces a horizontal scroll on a phone`,
    re: /min-width:\s*(\d{3,})px/g,
    keep: (m) => Number(m[1]) > PHONE,
  },
  {
    id: 'fixed-width',
    why: `an explicit width above ${PHONE}px cannot shrink`,
    re: /(?<!max-)width:\s*(\d{3,})px/g,
    keep: (m) => Number(m[1]) > PHONE,
  },
  {
    id: 'table-no-scroll',
    why: 'a table with no scrolling ancestor overflows the viewport',
    re: /<table\b/g,
    keep: (m, ctx) => !/overflow-x:\s*auto|overflow:\s*auto|table-wrap/.test(ctx),
  },
  {
    id: 'grid-fixed-columns',
    why: 'grid-template-columns with 3+ fixed tracks will not fit',
    re: /grid-template-columns:\s*(?:repeat\(\s*([3-9])|((?:[^;'"]*\d+px[^;'"]*){3,}))/g,
    keep: () => true,
  },
  {
    id: 'flex-no-wrap',
    why: 'a flex row of 4+ children with no flex-wrap will squash or overflow',
    re: /display:\s*flex;(?![^"';]*flex-wrap)[^"']*?gap:/g,
    keep: (m, ctx) => (ctx.match(/<button|<input|<select/g) || []).length >= 4,
  },
  {
    id: 'modal-fixed',
    why: 'a modal sized in px rather than % or vw will not fit',
    re: /(?:max-width|width):\s*(\d{3,})px[^;]*;[^"']*?(?:overflow-y|max-height)/g,
    keep: (m) => Number(m[1]) > PHONE,
  },
];

const hits = [];
for (const c of CHECKS) {
  let m;
  c.re.lastIndex = 0;
  while ((m = c.re.exec(src)) !== null) {
    const before = src.lastIndexOf('\n', m.index);
    const ln = src.slice(0, m.index).split('\n').length;
    const ctx = src.slice(Math.max(0, m.index - 400), m.index + 400);
    if (!c.keep(m, ctx)) continue;
    hits.push({ check: c.id, why: c.why, line: ln, owner: ownerOf(ln),
                text: lines[ln - 1].trim().slice(0, 110) });
  }
}

const detail = process.argv.includes('--detail');

const byOwner = new Map();
for (const h of hits) {
  if (!byOwner.has(h.owner)) byOwner.set(h.owner, []);
  byOwner.get(h.owner).push(h);
}

const ranked = [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length);

console.log(`\nMobile audit of portal/index.html at ${PHONE}px\n`);
console.log(`  ${hits.length} potential issues across ${ranked.length} screens\n`);

const byCheck = new Map();
for (const h of hits) byCheck.set(h.check, (byCheck.get(h.check) || 0) + 1);
console.log('  By kind:');
for (const [k, n] of [...byCheck].sort((a, b) => b[1] - a[1])) {
  const why = CHECKS.find((c) => c.id === k).why;
  console.log(`    ${String(n).padStart(4)}  ${k.padEnd(20)} ${why}`);
}

console.log('\n  Worst screens:');
for (const [owner, list] of ranked.slice(0, detail ? ranked.length : 18)) {
  console.log(`    ${String(list.length).padStart(4)}  ${owner}`);
  if (detail) {
    for (const h of list) console.log(`            ${h.line}: [${h.check}] ${h.text}`);
  }
}
console.log('');
