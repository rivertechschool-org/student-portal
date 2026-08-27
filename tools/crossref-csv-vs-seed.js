#!/usr/bin/env node
// Cross-reference Trees/master_tree.csv against the curriculum seed migrations.
// Migration is TRUTH; flag anything in the CSV that disagrees with or is missing
// from seed_2_nodes.sql / seed_3_edges.sql.
//
// Run:  node tools/crossref-csv-vs-seed.js
// Writes:  tools/crossref-report.md

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH   = path.join(ROOT, 'Trees', 'master_tree.csv');
const NODES_PATH = path.join(ROOT, 'supabase', 'migrations', 'seed_2_nodes.sql');
const EDGES_PATH = path.join(ROOT, 'supabase', 'migrations', 'seed_3_edges.sql');
const OUT_PATH   = path.join(ROOT, 'tools', 'crossref-report.md');

// --------------------------------------------------------------
// CSV parser (simple — respects commas inside double-quoted fields)
// --------------------------------------------------------------
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function loadCsv() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((h, j) => row[h] = cells[j] || '');
    row._lineNo = i + 1;
    // Trim domain — CSV has " Bible" with leading space for B rows
    row.Domain = row.Domain.trim();
    rows.push(row);
  }
  return { header, rows };
}

// --------------------------------------------------------------
// Seed node parser — extracts fields from each INSERT row
// --------------------------------------------------------------
function loadNodes() {
  const text = fs.readFileSync(NODES_PATH, 'utf8');
  const nodes = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('INSERT INTO curriculum_nodes')) continue;
    // Extract the VALUES (…) tuple. Node titles can contain quotes so we
    // rely on the fixed column order and split on "', '" between strings.
    const m = line.match(/VALUES\s*\((.*)\)\s*ON CONFLICT/);
    if (!m) continue;
    const raw = m[1];
    // Very deliberate tokenizer: the file was generated from JS so every
    // string is single-quoted and any internal apostrophe is doubled.
    const tokens = [];
    let cur = '', inStr = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) {
        if (ch === "'" && raw[i + 1] === "'") { cur += "'"; i++; continue; }
        if (ch === "'") { tokens.push({ kind: 'str', val: cur }); cur = ''; inStr = false; continue; }
        cur += ch;
      } else {
        if (ch === "'") { inStr = true; cur = ''; continue; }
        if (ch === ',') {
          const v = cur.trim();
          if (v.length) tokens.push({ kind: 'lit', val: v });
          cur = '';
          continue;
        }
        cur += ch;
      }
    }
    const v = cur.trim();
    if (v.length) tokens.push({ kind: 'lit', val: v });

    // Column order: id, title, domain, path_type, stage, grade_band,
    //               primary_path, cluster, description, demonstration,
    //               mastery_criteria, evidence_types, visual,
    //               legacy_name, legacy_subject, csv_id, source
    const get = i => tokens[i] ? tokens[i].val : '';
    nodes.push({
      id:             get(0),
      title:          get(1),
      domain:         get(2),
      path_type:      get(3),
      stage:          get(4),
      grade_band:     get(5),
      primary_path:   get(6),
      cluster:        get(7),
      description:    get(8),
      demonstration:  get(9),
      legacy_name:    get(13),
      legacy_subject: get(14),
      csv_id:         get(15) === 'NULL' ? null : get(15),
      source:         get(16),
    });
  }
  return nodes;
}

// --------------------------------------------------------------
// Seed edge parser
// --------------------------------------------------------------
function loadEdges() {
  const text = fs.readFileSync(EDGES_PATH, 'utf8');
  const edges = [];
  const rx = /VALUES\s*\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('INSERT INTO curriculum_edges')) continue;
    const m = line.match(rx);
    if (!m) continue;
    edges.push({ id: m[1], from: m[2], to: m[3], type: m[4] });
  }
  return edges;
}

// --------------------------------------------------------------
// Main
// --------------------------------------------------------------
const { rows: csvRows } = loadCsv();
const nodes = loadNodes();
const edges = loadEdges();

// Index: csv_id → node (migration side)
const nodeByCsvId = new Map();
for (const n of nodes) {
  if (n.csv_id) {
    if (!nodeByCsvId.has(n.csv_id)) nodeByCsvId.set(n.csv_id, []);
    nodeByCsvId.get(n.csv_id).push(n);
  }
}

// Index: node id → node
const nodeById = new Map(nodes.map(n => [n.id, n]));

// Index: migration edge set by "fromCsvId→toCsvId" (only for nodes that HAVE a csv_id)
const migEdgeSet = new Set();
for (const e of edges) {
  const fn = nodeById.get(e.from);
  const tn = nodeById.get(e.to);
  if (!fn || !tn) continue;
  if (fn.csv_id && tn.csv_id) {
    migEdgeSet.add(`${fn.csv_id}->${tn.csv_id}`);
  }
}

// Group CSV rows by ID (to surface duplicates)
const csvById = new Map();
for (const r of csvRows) {
  if (!csvById.has(r.ID)) csvById.set(r.ID, []);
  csvById.get(r.ID).push(r);
}

// --------------------------------------------------------------
// Build report
// --------------------------------------------------------------
const report = [];
const push = (...s) => report.push(s.join(''));

push('# Cross-reference: master_tree.csv vs seed_2_nodes.sql / seed_3_edges.sql');
push('');
push('**Truth:** the migration. Anything in the CSV that disagrees is flagged.');
push('');
push(`- CSV rows:               ${csvRows.length}`);
push(`- CSV unique IDs:         ${csvById.size}`);
push(`- CSV duplicate IDs:      ${[...csvById.values()].filter(a => a.length > 1).length}`);
push(`- Migration nodes:        ${nodes.length}`);
push(`- Migration edges:        ${edges.length}`);
push(`- Nodes with csv_id set:  ${[...nodeByCsvId.values()].reduce((a,b)=>a+b.length,0)}`);
push(`- Unique csv_id values:   ${nodeByCsvId.size}`);
push('');

// ---- 1. Duplicate IDs in CSV ----
push('## 1. Duplicate IDs in CSV');
push('');
push('Each listed ID appears on more than one CSV line. The user added a');
push('simplified pass at the end of the file that re-uses the first-pass IDs.');
push('');
const dupIds = [...csvById.entries()].filter(([_, arr]) => arr.length > 1);
if (!dupIds.length) push('_(none)_');
else {
  push('| ID | Lines | Names (per row) |');
  push('|---|---|---|');
  for (const [id, arr] of dupIds) {
    const names = arr.map(r => `L${r._lineNo}: "${r.Name}"`).join(' • ');
    push(`| ${id} | ${arr.length} | ${names} |`);
  }
}
push('');

// ---- 2. CSV IDs with no counterpart in the migration ----
push('## 2. CSV rows with no matching migration node (csv_id not found)');
push('');
push('These IDs exist in the CSV but no `curriculum_nodes.csv_id` points to them.');
push('Either the CSV row is stale or the migration is missing that skill.');
push('');
const orphans = [];
for (const [id, arr] of csvById) {
  if (!nodeByCsvId.has(id)) orphans.push([id, arr]);
}
if (!orphans.length) push('_(none)_');
else {
  push('| CSV ID | CSV Name | Domain | Stage | Line(s) |');
  push('|---|---|---|---|---|');
  for (const [id, arr] of orphans.sort((a,b)=>a[0].localeCompare(b[0]))) {
    const r = arr[0];
    const lines = arr.map(x => x._lineNo).join(', ');
    push(`| ${id} | ${r.Name} | ${r.Domain} | ${r.Stage} | ${lines} |`);
  }
}
push('');

// ---- 3. Migration csv_id values that don't exist in the CSV ----
push('## 3. Migration nodes with csv_id that is missing from CSV');
push('');
push('These migration nodes claim a csv_id but no CSV row has that ID.');
push('');
const danglingCsvIds = [];
for (const [cid, nArr] of nodeByCsvId) {
  if (!csvById.has(cid)) danglingCsvIds.push([cid, nArr]);
}
if (!danglingCsvIds.length) push('_(none — every csv_id in the migration resolves to a CSV row)_');
else {
  push('| csv_id | Migration node(s) |');
  push('|---|---|');
  for (const [cid, nArr] of danglingCsvIds.sort((a,b)=>a[0].localeCompare(b[0]))) {
    const list = nArr.map(n => `${n.id} (${n.title})`).join(' • ');
    push(`| ${cid} | ${list} |`);
  }
}
push('');

// ---- 4. Field mismatches between CSV and migration ----
push('## 4. Field mismatches (CSV row vs migration node linked by csv_id)');
push('');
push('Comparing CSV **Name / Domain / Stage / PathType** against migration');
push('**title / domain / stage / path_type**. CSV duplicates are compared');
push('against the same migration node — both CSV versions can mismatch.');
push('');

function domainNormalize(d) {
  const map = {
    'LifeSkills': 'LifeSkills', 'Life Skills': 'LifeSkills', 'Lifeskills': 'LifeSkills',
    'Language': 'Language', 'English': 'Language',
    'Social': 'Social', 'SocialStudies': 'Social', 'Social Studies': 'Social',
    'Science': 'Science',
    'Math': 'Math', 'Mathematics': 'Math',
    'Creative': 'Creative',
    'Physical': 'Physical', 'Physical Development': 'Physical',
    'Technology': 'Technology', 'Tech': 'Technology',
    'Bible': 'Bible',
  };
  return map[d] || d;
}

const mismatches = [];
for (const [id, arr] of csvById) {
  const migNodes = nodeByCsvId.get(id);
  if (!migNodes) continue;                // already reported as orphan
  const mig = migNodes[0];               // if multiple, compare against the first
  for (const r of arr) {
    const diffs = [];
    const csvName   = r.Name.trim();
    const migName   = (mig.title || '').trim();
    const migLegacy = (mig.legacy_name || '').trim();
    if (csvName && migName && csvName !== migName && csvName !== migLegacy) {
      diffs.push(`Name: "${csvName}" ≠ migration title "${migName}"${migLegacy && migLegacy!==migName ? ` / legacy_name "${migLegacy}"` : ''}`);
    }
    const csvDom = domainNormalize(r.Domain);
    const migDom = domainNormalize(mig.domain);
    if (csvDom && migDom && csvDom !== migDom) {
      diffs.push(`Domain: "${r.Domain}" ≠ "${mig.domain}"`);
    }
    if (r.Stage && mig.stage && r.Stage !== mig.stage) {
      diffs.push(`Stage: "${r.Stage}" ≠ "${mig.stage}"`);
    }
    if (r.PathType && mig.path_type && r.PathType !== mig.path_type) {
      diffs.push(`PathType: "${r.PathType}" ≠ "${mig.path_type}"`);
    }
    if (diffs.length) mismatches.push({ id, line: r._lineNo, csvName, migId: mig.id, diffs });
  }
}

if (!mismatches.length) push('_(none — every CSV row agrees with its migration counterpart on Name/Domain/Stage/PathType)_');
else {
  push('| CSV ID | CSV Line | CSV Name | Migration id | Disagreements |');
  push('|---|---|---|---|---|');
  for (const m of mismatches.sort((a,b)=>a.id.localeCompare(b.id) || a.line - b.line)) {
    push(`| ${m.id} | ${m.line} | ${m.csvName} | ${m.migId} | ${m.diffs.join('<br>')} |`);
  }
}
push('');

// ---- 5. Prerequisite edges present in CSV but absent in migration ----
push('## 5. Prerequisite edges in CSV with no matching migration edge');
push('');
push('The CSV `Prerequisites` column lists IDs that should lead TO the current');
push('row. We check whether the migration has an edge `prereq_csv_id -> row_csv_id`');
push('(of any `prerequisite_*` type). If absent, the edge is stale in CSV or');
push('missing in migration.');
push('');

const missingPrereqEdges = [];
for (const r of csvRows) {
  if (!r.Prerequisites) continue;
  const rowId = r.ID;
  // if the row itself has no migration counterpart we can't compare — skip
  if (!nodeByCsvId.has(rowId)) continue;
  const prereqs = r.Prerequisites.split('|').map(s => s.trim()).filter(Boolean);
  for (const p of prereqs) {
    if (!nodeByCsvId.has(p)) {
      missingPrereqEdges.push({ row: rowId, line: r._lineNo, prereq: p, reason: 'prereq ID has no migration node' });
      continue;
    }
    // check that some node pair (prereqCsv -> rowCsv) exists as a prerequisite edge
    const key = `${p}->${rowId}`;
    if (!migEdgeSet.has(key)) {
      // also accept the case where the migration has the reverse (flagged separately)
      missingPrereqEdges.push({ row: rowId, line: r._lineNo, prereq: p, reason: 'no prereq edge in migration' });
    }
  }
}
if (!missingPrereqEdges.length) push('_(none — every CSV prerequisite has a corresponding migration edge)_');
else {
  push('| CSV Row | Line | Claimed Prereq | Reason |');
  push('|---|---|---|---|');
  for (const m of missingPrereqEdges.slice(0, 300)) {
    push(`| ${m.row} | ${m.line} | ${m.prereq} | ${m.reason} |`);
  }
  if (missingPrereqEdges.length > 300) {
    push(`| … | … | … | (${missingPrereqEdges.length - 300} more suppressed) |`);
  }
}
push('');

// ---- 6. LeadsTo edges in CSV absent in migration ----
push('## 6. LeadsTo edges in CSV with no matching migration edge');
push('');
push('CSV `LeadsTo` is the forward edge (row → dest). The migration should have');
push('`row_csv_id -> leads_csv_id` as a `prerequisite_*` or `leads_to` edge.');
push('');

// Build a forward edge set that also includes leads_to edges
const migForwardEdgeSet = new Set();
for (const e of edges) {
  const fn = nodeById.get(e.from);
  const tn = nodeById.get(e.to);
  if (!fn || !tn) continue;
  if (fn.csv_id && tn.csv_id) migForwardEdgeSet.add(`${fn.csv_id}->${tn.csv_id}`);
}
const missingLeadsEdges = [];
for (const r of csvRows) {
  if (!r.LeadsTo) continue;
  if (!nodeByCsvId.has(r.ID)) continue;
  const leads = r.LeadsTo.split('|').map(s => s.trim()).filter(Boolean);
  for (const l of leads) {
    if (!nodeByCsvId.has(l)) {
      missingLeadsEdges.push({ row: r.ID, line: r._lineNo, leads: l, reason: 'LeadsTo ID has no migration node' });
      continue;
    }
    const key = `${r.ID}->${l}`;
    if (!migForwardEdgeSet.has(key)) {
      missingLeadsEdges.push({ row: r.ID, line: r._lineNo, leads: l, reason: 'no forward edge in migration' });
    }
  }
}
if (!missingLeadsEdges.length) push('_(none — every CSV LeadsTo is present in the migration)_');
else {
  push('| CSV Row | Line | LeadsTo | Reason |');
  push('|---|---|---|---|');
  for (const m of missingLeadsEdges.slice(0, 300)) {
    push(`| ${m.row} | ${m.line} | ${m.leads} | ${m.reason} |`);
  }
  if (missingLeadsEdges.length > 300) {
    push(`| … | … | … | (${missingLeadsEdges.length - 300} more suppressed) |`);
  }
}
push('');

// ---- 7. CrossLinks in CSV not present in migration ----
push('## 7. CrossLinks in CSV with no matching migration edge');
push('');
push('CSV `CrossLinks` (pipe-separated) should appear as cross-domain edges in');
push('the migration (same csv_id pair, either direction).');
push('');
const missingCross = [];
for (const r of csvRows) {
  if (!r.CrossLinks) continue;
  if (!nodeByCsvId.has(r.ID)) continue;
  const xs = r.CrossLinks.split('|').map(s => s.trim()).filter(Boolean);
  for (const x of xs) {
    if (!nodeByCsvId.has(x)) {
      missingCross.push({ row: r.ID, line: r._lineNo, cross: x, reason: 'CrossLink ID has no migration node' });
      continue;
    }
    const a = `${r.ID}->${x}`;
    const b = `${x}->${r.ID}`;
    if (!migForwardEdgeSet.has(a) && !migForwardEdgeSet.has(b)) {
      missingCross.push({ row: r.ID, line: r._lineNo, cross: x, reason: 'no edge in either direction' });
    }
  }
}
if (!missingCross.length) push('_(none)_');
else {
  push('| CSV Row | Line | CrossLink | Reason |');
  push('|---|---|---|---|');
  for (const m of missingCross.slice(0, 300)) {
    push(`| ${m.row} | ${m.line} | ${m.cross} | ${m.reason} |`);
  }
  if (missingCross.length > 300) {
    push(`| … | … | … | (${missingCross.length - 300} more suppressed) |`);
  }
}
push('');

// ---- Summary ----
push('## Summary');
push('');
push(`- Duplicate CSV IDs:               ${dupIds.length}`);
push(`- CSV rows not in migration:       ${orphans.length}`);
push(`- Migration csv_id → missing CSV:  ${danglingCsvIds.length}`);
push(`- Field mismatches:                ${mismatches.length}`);
push(`- Missing prereq edges:            ${missingPrereqEdges.length}`);
push(`- Missing LeadsTo edges:           ${missingLeadsEdges.length}`);
push(`- Missing CrossLinks:              ${missingCross.length}`);
push('');
push('_Protocol: the migration is truth. To reconcile, fix the CSV._');

fs.writeFileSync(OUT_PATH, report.join('\n'), 'utf8');
console.log(`Wrote ${OUT_PATH}`);
console.log('');
console.log('Summary:');
console.log(`  Duplicate CSV IDs:               ${dupIds.length}`);
console.log(`  CSV rows not in migration:       ${orphans.length}`);
console.log(`  Migration csv_id → missing CSV:  ${danglingCsvIds.length}`);
console.log(`  Field mismatches:                ${mismatches.length}`);
console.log(`  Missing prereq edges:            ${missingPrereqEdges.length}`);
console.log(`  Missing LeadsTo edges:           ${missingLeadsEdges.length}`);
console.log(`  Missing CrossLinks:              ${missingCross.length}`);
