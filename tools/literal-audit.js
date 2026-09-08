#!/usr/bin/env node
// Find string literals the code compares a database column against that the
// database will never produce.
//
// Written after `account_status === 'active'` shipped and matched zero rows:
// the column holds 'activated'. Nothing threw. The list just came up empty,
// and 'active' IS the right word in a dozen other tables, so it reads fine.
//
// That is the shape worth hunting: a literal that is *almost* right. Exact
// nonsense gets noticed; a near-miss survives review and fails silently.
//
// Three tiers, most certain first:
//
//   1 QUERY     .eq()/.neq()/.in() on a constrained column with a value that
//               column cannot hold. Unambiguously a database call.
//   2 NEAR-MISS any comparison whose literal is one small edit from a legal
//               value ('active'/'activated', 'cancelled'/'canceled'). This is
//               the tier that would have caught the Reports bug.
//   3 WRITE     an insert/update payload with a value that violates a CHECK.
//               Loud at runtime, but better found here.
//
// Plain `obj.status === 'x'` on a generic name is deliberately NOT reported on
// its own: half those hits are D3 graph links and game enemy states, and a
// report nobody trusts gets ignored.
//
// checks.json is regenerated from the live CHECK constraints - see the query
// in RUNBOOK_schema_consolidation.md. Stale input makes this tool lie.
//
//   node tools/literal-audit.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const contracts = JSON.parse(fs.readFileSync(path.join(__dirname, 'checks.json'), 'utf8'));

// Sentinels the UI invents to mean "no filter". Never stored, never a mismatch.
const SENTINELS = new Set(['all', 'any', 'none', '', 'null', 'undefined', 'other', 'default']);

const byColumn = new Map();          // column -> [{table, allowed:Set, sets}]
for (const [key, sets] of Object.entries(contracts)) {
  const [table, column] = key.split('.');
  // Two constraints on one column must both pass, so the real rule is the
  // intersection - which can be smaller than either one looks.
  const allowed = sets.reduce((a, s) => a.filter((v) => s.includes(v)));
  if (!byColumn.has(column)) byColumn.set(column, []);
  byColumn.get(column).push({ table, allowed: new Set(allowed), sets });
}

const allowedAnywhere = (col, lit) =>
  (byColumn.get(col) || []).some((c) => c.allowed.has(lit));

const legalValues = (col) =>
  [...new Set((byColumn.get(col) || []).flatMap((c) => [...c.allowed]))];

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
                         d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// "Almost right": a short edit away, or one string is a prefix of the other.
// Both halves earn their place - 'cancelled'/'canceled' is one edit, and
// 'active'/'activated' is three edits but a clean prefix.
function nearMiss(lit, legal) {
  if (!lit || lit.length < 3) return null;
  const l = lit.toLowerCase();
  for (const v of legal) {
    if (v === lit) return null;
    const w = v.toLowerCase();
    if (editDistance(l, w) <= 2) return v;
    if (w.startsWith(l) || l.startsWith(w)) return v;
  }
  return null;
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '_archive', 'tests'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(html|js)$/.test(e.name)) files.push(p);
  }
})(ROOT);

const tiers = { QUERY: [], 'NEAR-MISS': [], WRITE: [] };
const seen = new Set();

function record(tier, file, src, index, column, literal, extra) {
  const line = src.slice(0, index).split('\n').length;
  const key = tier + ':' + file + ':' + line + ':' + column + ':' + literal;
  if (seen.has(key)) return;
  seen.add(key);
  tiers[tier].push({
    file: path.relative(ROOT, file), line, column, literal, extra,
    text: src.split('\n')[line - 1].trim().slice(0, 130),
  });
}

// Columns this file actually reads out of the database, harvested from its
// .select() lists and .eq()/.order() column arguments.
//
// Without this, tiers 2 and 3 are unusable: `n.type === 'file'` in a terminal
// game and `enemy.userData.state === 'patrol'` match a column name by pure
// coincidence, and two of the loudest offenders never call .from() at all.
// Requiring the column to appear in a real query is what makes the report
// worth reading.
function columnsQueriedIn(src) {
  const cols = new Set();
  for (const m of src.matchAll(/\.select\(\s*[`'"]([^`'"]*)[`'"]/g)) {
    for (const part of m[1].split(',')) {
      const c = part.trim().split(/[\s(:]/)[0].replace(/[^\w]/g, '');
      if (c) cols.add(c);
    }
  }
  for (const m of src.matchAll(/\.(?:eq|neq|in|is|gte|lte|gt|lt|order|like|ilike)\(\s*['"](\w+)['"]/g)) {
    cols.add(m[1]);
  }
  for (const m of src.matchAll(/\.(?:insert|update|upsert)\(\s*\{([^}]*)\}/g)) {
    for (const km of m[1].matchAll(/(\w+)\s*:/g)) cols.add(km[1]);
  }
  return cols;
}

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const queried = columnsQueriedIn(src);
  let m;

  // --- tier 1: real query calls ---------------------------------------
  const q = /\.(eq|neq)\(\s*['"](\w+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g;
  while ((m = q.exec(src)) !== null) {
    const column = m[2], literal = m[3];
    if (SENTINELS.has(literal) || !byColumn.has(column)) continue;
    if (allowedAnywhere(column, literal)) continue;
    record('QUERY', file, src, m.index, column, literal, legalValues(column));
  }

  const qi = /\.in\(\s*['"](\w+)['"]\s*,\s*\[([^\]]*)\]/g;
  while ((m = qi.exec(src)) !== null) {
    const column = m[1];
    if (!byColumn.has(column)) continue;
    for (const lm of m[2].matchAll(/['"]([^'"]*)['"]/g)) {
      const literal = lm[1];
      if (SENTINELS.has(literal) || allowedAnywhere(column, literal)) continue;
      record('QUERY', file, src, m.index, column, literal, legalValues(column));
    }
  }

  // --- tier 2: near misses in any comparison ---------------------------
  const c = /\.(\w+)\s*(?:===|!==|==|!=)\s*['"]([^'"]*)['"]/g;
  while ((m = c.exec(src)) !== null) {
    const column = m[1], literal = m[2];
    if (SENTINELS.has(literal) || !byColumn.has(column)) continue;
    if (!queried.has(column)) continue;      // this file never reads that column
    if (allowedAnywhere(column, literal)) continue;
    // `typeof x.type !== 'string'` is a JS type test, not a column comparison.
    if (/typeof\s+[\w.]*$/.test(src.slice(Math.max(0, m.index - 40), m.index))) continue;
    const suggest = nearMiss(literal, legalValues(column));
    if (!suggest) continue;                 // an unrelated word: not this bug
    record('NEAR-MISS', file, src, m.index, column, literal, [suggest]);
  }

  // --- tier 3: writes ---------------------------------------------------
  const w = /\b(\w+)\s*:\s*['"]([^'"]*)['"]/g;
  while ((m = w.exec(src)) !== null) {
    const column = m[1], literal = m[2];
    if (SENTINELS.has(literal) || !byColumn.has(column)) continue;
    if (!queried.has(column)) continue;
    if (allowedAnywhere(column, literal)) continue;
    const ctx = src.slice(Math.max(0, m.index - 700), m.index);
    if (!/\.(insert|update|upsert)\(/.test(ctx)) continue;
    const tbl = [...ctx.matchAll(/\.from\(\s*['"](\w+)['"]/g)].pop();
    if (!tbl) continue;                     // not a Supabase write - Firebase
    const table = tbl[1];
    const spec = byColumn.get(column).find((x) => x.table === table);
    if (!spec) continue;                    // that column belongs to another table
    if (spec && spec.allowed.has(literal)) continue;
    record('WRITE', file, src, m.index, column, literal, [...spec.allowed]);
  }
}

console.log('\n=== columns whose CHECK constraints contradict each other ===\n');
let conflicts = 0;
for (const [column, cands] of byColumn) {
  for (const c of cands) {
    if (c.sets.length < 2) continue;
    const dead = [...new Set(c.sets.flat())].filter((v) => !c.allowed.has(v));
    if (!dead.length) continue;
    conflicts++;
    console.log('  ' + c.table + '.' + column);
    c.sets.forEach((s, i) => console.log('     constraint ' + (i + 1) + ':  ' + s.join(' | ')));
    console.log('     effective:     ' + ([...c.allowed].join(' | ') || '(nothing)'));
    console.log('     silently rejected: ' + dead.join(', ') + '\n');
  }
}
if (!conflicts) console.log('  none\n');

let total = 0;
for (const tier of Object.keys(tiers)) {
  const list = tiers[tier];
  console.log('=== ' + tier + ' (' + list.length + ') ===\n');
  if (!list.length) { console.log('  none\n'); continue; }
  list.sort((a, b) => a.column.localeCompare(b.column) || a.literal.localeCompare(b.literal));
  let last = '';
  for (const f of list) {
    const k = f.column + " = '" + f.literal + "'";
    if (k !== last) {
      console.log('  ' + k);
      console.log('     ' + (tier === 'NEAR-MISS' ? 'did you mean' : 'legal') + ': ' + f.extra.join(' | '));
      last = k;
    }
    console.log('       ' + f.file + ':' + f.line + '  ' + f.text);
  }
  console.log('');
  total += list.length;
}
console.log('  ' + total + ' sites\n');
