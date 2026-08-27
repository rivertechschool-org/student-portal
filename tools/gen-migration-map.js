#!/usr/bin/env node
// Generate MIGRATION_MAP.md — a single map of every backend migration and edge
// function: what it is, what it touches, and where it sits in the apply order.
//
// The map is GENERATED. Do not hand-edit MIGRATION_MAP.md; edit the header
// comment at the top of the migration itself and re-run this script. That keeps
// each description next to the SQL it describes, so the two cannot drift.
//
// Run:  node tools/gen-migration-map.js
// Writes: MIGRATION_MAP.md

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');
const FN_DIR = path.join(ROOT, 'supabase', 'functions');
const OUT = path.join(ROOT, 'MIGRATION_MAP.md');

// ---------------------------------------------------------------- extraction

// Leading `--` comment block = the migration's own description.
function headerComment(sql) {
  const lines = [];
  for (const raw of sql.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') { if (lines.length) break; continue; }
    if (!line.startsWith('--')) break;
    const text = line.replace(/^--\s?/, '').trim();
    if (/^=+$/.test(text) || /^-+$/.test(text)) continue;   // rule lines
    lines.push(text);
  }
  return lines;
}

// Leading `//` block of a TS file — only the contiguous run before any code.
// Deliberately does NOT scrape inline comments from the body: those are
// implementation notes, and in this codebase some of them describe security
// weaknesses. A summary line belongs at the top of the file or nowhere.
function leadingComment(src, dirName) {
  const lines = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') { if (lines.length) break; continue; }
    if (!line.startsWith('//')) break;
    const text = line.replace(/^\/\/\s?/, '').trim();
    if (!text) continue;
    if (text === 'supabase/functions/' + dirName + '/index.ts') continue;  // just the path
    if (/^=+$/.test(text) || /^-+$/.test(text)) continue;
    lines.push(text);
  }
  if (!lines.length) return '_No header comment — add one at the top of the file._';
  return lines.slice(0, 2).join(' ');
}

// Strip comments and function bodies so declaration regexes don't match prose.
function stripNoise(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' BODY ');
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][\\w]*)';
const QUALIFIED = '(?:' + IDENT + '\\.)?(' + IDENT + ')';

function collect(sql, pattern) {
  const re = new RegExp(pattern, 'gi');
  const out = new Set();
  let m;
  while ((m = re.exec(sql)) !== null) {
    const val = (m[1] || '').replace(/"/g, '').trim();
    if (val) out.add(val);
  }
  return [...out].sort();
}

function analyze(sql) {
  const s = stripNoise(sql);
  return {
    tablesCreated: collect(s, 'CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?' + QUALIFIED),
    tablesAltered: collect(s, 'ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?' + QUALIFIED),
    functions: collect(s, 'CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+' + QUALIFIED),
    functionsDropped: collect(s, 'DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?' + QUALIFIED),
    views: collect(s, 'CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+' + QUALIFIED),
    triggers: collect(s, 'CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER\\s+(' + IDENT + ')'),
    indexes: collect(s, 'CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(' + IDENT + ')'),
    policiesOn: collect(s, 'CREATE\\s+POLICY\\s+(?:"[^"]+"|' + IDENT + ')\\s+ON\\s+' + QUALIFIED),
    policiesDropped: collect(s, 'DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?(?:"[^"]+"|' + IDENT + ')\\s+ON\\s+' + QUALIFIED),
    rlsEnabled: collect(s, 'ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?' + QUALIFIED + '\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY'),
    securityDefiner: /SECURITY\s+DEFINER/i.test(sql),
    policyCount: (s.match(/CREATE\s+POLICY/gi) || []).length,
  };
}

// Apply order is alphabetical, so a leading 'z' run is how a migration is made
// to win over an earlier one. Count the z's to show override depth.
function overrideDepth(name) {
  const m = /^(z+)_/.exec(name);
  return m ? m[1].length : 0;
}

function classify(name) {
  if (/^seed_|_seed\.sql$|_seed_/.test(name)) return 'Seed data';
  if (overrideDepth(name) > 0) return 'Override / late fix';
  if (/^fix_/.test(name)) return 'Fix';
  if (/^add_/.test(name)) return 'Additive change';
  if (/^create_/.test(name)) return 'Schema creation';
  return 'Schema / feature';
}

// ------------------------------------------------------------------- gather

if (!fs.existsSync(MIG_DIR)) {
  console.error('No migrations directory at ' + MIG_DIR);
  process.exit(1);
}

const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();

const migrations = files.map((name, i) => {
  const sql = fs.readFileSync(path.join(MIG_DIR, name), 'utf8');
  return Object.assign({
    order: i + 1,
    name,
    kb: Math.round(Buffer.byteLength(sql) / 1024),
    lines: sql.split(/\r?\n/).length,
    header: headerComment(sql),
    depth: overrideDepth(name),
    kind: classify(name),
  }, analyze(sql));
});

const functions = fs.existsSync(FN_DIR)
  ? fs.readdirSync(FN_DIR)
      .filter((d) => fs.existsSync(path.join(FN_DIR, d, 'index.ts')))
      .sort()
      .map((d) => {
        const src = fs.readFileSync(path.join(FN_DIR, d, 'index.ts'), 'utf8');
        return {
          name: d,
          lines: src.split(/\r?\n/).length,
          summary: leadingComment(src, d),
          usesServiceRole: /SERVICE_ROLE|service_role/.test(src),
        };
      })
  : [];

// Reverse index: table -> migrations that touch it, in apply order.
const byTable = new Map();
function touch(t, m, how) {
  if (!byTable.has(t)) byTable.set(t, []);
  byTable.get(t).push({ order: m.order, how });
}
for (const m of migrations) {
  m.tablesCreated.forEach((t) => touch(t, m, 'create'));
  m.tablesAltered.forEach((t) => touch(t, m, 'alter'));
  m.policiesOn.forEach((t) => touch(t, m, 'policy'));
  m.rlsEnabled.forEach((t) => touch(t, m, 'rls'));
}

// --------------------------------------------------------------------- emit

const esc = (s) => String(s).replace(/\|/g, '\\|');
const list = (a, max) => {
  max = max || 8;
  if (!a.length) return '';
  const shown = a.slice(0, max).map((x) => '`' + x + '`').join(', ');
  return shown + (a.length > max ? ' _+' + (a.length - max) + ' more_' : '');
};

const out = [];
out.push('# Backend Migration Map');
out.push('');
out.push('> **Generated file — do not hand-edit.** Run `node tools/gen-migration-map.js` to rebuild.');
out.push('> To change a description here, edit the `--` header comment at the top of the migration itself.');
out.push('');
out.push(migrations.length + ' migrations and ' + functions.length + ' edge functions.');
out.push('');
out.push('## How to read this');
out.push('');
out.push('These migrations have **no timestamps** — they apply in **alphabetical order**, so the');
out.push('filename *is* the ordering. That is why later fixes carry a `z` prefix: each extra `z`');
out.push('pushes a file further down the apply order so its definitions win and cannot be silently');
out.push('reverted by an earlier file. The **#** column below is that apply order.');
out.push('');
out.push('When two migrations define the same policy or function, **the highest number wins.** Check');
out.push('the table index at the bottom before changing anything — a single table is often shaped by');
out.push('a dozen different files.');
out.push('');

out.push('## At a glance');
out.push('');
const kinds = {};
migrations.forEach((m) => { kinds[m.kind] = (kinds[m.kind] || 0) + 1; });
out.push('| Category | Count |');
out.push('| --- | ---: |');
Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a]).forEach((k) => out.push('| ' + k + ' | ' + kinds[k] + ' |'));
out.push('| **Total** | **' + migrations.length + '** |');
out.push('');
const allTables = [...new Set(migrations.flatMap((m) => m.tablesCreated))].sort();
const allFns = [...new Set(migrations.flatMap((m) => m.functions))].sort();
out.push('- **Tables created:** ' + allTables.length);
out.push('- **Functions defined:** ' + allFns.length + ' (' + migrations.filter((m) => m.securityDefiner).length + ' migrations use `SECURITY DEFINER`)');
out.push('- **RLS policies created:** ' + migrations.reduce((n, m) => n + m.policyCount, 0));
out.push('');

out.push('## Apply order');
out.push('');
out.push('| # | Migration | Kind | Summary |');
out.push('| ---: | --- | --- | --- |');
for (const m of migrations) {
  const summary = m.header.length ? esc(m.header[0]) : '_no header comment_';
  const flag = m.depth > 0 ? ' <sub>z' + m.depth + '</sub>' : '';
  out.push('| ' + m.order + ' | `' + m.name + '`' + flag + ' | ' + m.kind + ' | ' + summary + ' |');
}
out.push('');

out.push('## Detail');
out.push('');
for (const m of migrations) {
  out.push('### ' + m.order + '. `' + m.name + '`');
  out.push('');
  out.push('*' + m.kind + ' · ' + m.lines + ' lines · ' + m.kb + ' KB'
    + (m.depth ? ' · override depth z' + m.depth : '')
    + (m.securityDefiner ? ' · uses SECURITY DEFINER' : '') + '*');
  out.push('');
  if (m.header.length) {
    m.header.forEach((l) => out.push('> ' + l));
    out.push('');
  }
  const rows = [
    ['Creates tables', list(m.tablesCreated)],
    ['Alters tables', list(m.tablesAltered)],
    ['Enables RLS on', list(m.rlsEnabled)],
    ['Policies on', list(m.policiesOn)],
    ['Drops policies on', list(m.policiesDropped)],
    ['Functions', list(m.functions)],
    ['Drops functions', list(m.functionsDropped)],
    ['Triggers', list(m.triggers)],
    ['Views', list(m.views)],
    ['Indexes', list(m.indexes, 6)],
  ].filter((r) => r[1]);
  if (rows.length) {
    rows.forEach((r) => out.push('- **' + r[0] + ':** ' + r[1]));
  } else {
    out.push('- _No schema objects detected (data-only, or statement forms this parser does not track)._');
  }
  out.push('');
}

out.push('## Touched by — table index');
out.push('');
out.push('Every migration that creates, alters, enables RLS on, or writes a policy for each table,');
out.push('in apply order. **The last entry wins.**');
out.push('');
out.push('| Table | Touched by (apply order) |');
out.push('| --- | --- |');
for (const t of [...byTable.keys()].sort()) {
  const seen = new Set();
  const cells = byTable.get(t)
    .filter((e) => { const k = e.order + e.how; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((e) => e.order + '(' + e.how + ')');
  out.push('| `' + t + '` | ' + cells.join(', ') + ' |');
}
out.push('');

out.push('## Edge functions');
out.push('');
out.push('| Function | Lines | Service role | Summary |');
out.push('| --- | ---: | :---: | --- |');
for (const f of functions) {
  out.push('| `' + f.name + '` | ' + f.lines + ' | ' + (f.usesServiceRole ? 'yes' : 'no') + ' | ' + esc(f.summary) + ' |');
}
out.push('');
out.push('---');
out.push('');
out.push('## Keeping this current');
out.push('');
out.push('1. Write a `--` header comment at the top of every new migration. Its first line becomes the');
out.push('   one-line summary in the table above, so make that line say what the migration *does*.');
out.push('2. Run `node tools/gen-migration-map.js` and commit the regenerated `MIGRATION_MAP.md` in the');
out.push('   same commit as the migration. A map that lags the schema is worse than no map.');
out.push('3. Never hand-edit `MIGRATION_MAP.md` — the next regeneration discards your edits silently.');
out.push('');

fs.writeFileSync(OUT, out.join('\n'), 'utf8');
console.log('Wrote ' + path.relative(ROOT, OUT) + ' — ' + migrations.length + ' migrations, '
  + functions.length + ' edge functions, ' + byTable.size + ' tables indexed.');
