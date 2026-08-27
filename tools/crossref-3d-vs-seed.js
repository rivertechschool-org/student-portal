#!/usr/bin/env node
// Cross-reference the "3D Skill Tree" data.js against the curriculum seed
// migrations. Migration is TRUTH; flag anything the 3D tree is missing or
// has extra.
//
// Run: node tools/crossref-3d-vs-seed.js
// Writes: tools/crossref-3d-report.md

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = require('./backend-path');  // private backend repo
const NODES_PATH = path.join(BACKEND, 'supabase', 'migrations', 'seed_2_nodes.sql');
const EDGES_PATH = path.join(BACKEND, 'supabase', 'migrations', 'seed_3_edges.sql');
const TREE_PATH  = path.join(ROOT, 'Trees', '3D Skill Tree', 'data.js');
const OUT_PATH   = path.join(ROOT, 'tools', 'crossref-3d-report.md');

// --------------------------------------------------------------
// Load migration nodes/edges (reuse the parser from the CSV tool)
// --------------------------------------------------------------
function loadNodes() {
  const text = fs.readFileSync(NODES_PATH, 'utf8');
  const nodes = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('INSERT INTO curriculum_nodes')) continue;
    const m = line.match(/VALUES\s*\((.*)\)\s*ON CONFLICT/);
    if (!m) continue;
    const raw = m[1];
    const tokens = [];
    let cur = '', inStr = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) {
        if (ch === "'" && raw[i + 1] === "'") { cur += "'"; i++; continue; }
        if (ch === "'") { tokens.push(cur); cur = ''; inStr = false; continue; }
        cur += ch;
      } else {
        if (ch === "'") { inStr = true; cur = ''; continue; }
        if (ch === ',') {
          const v = cur.trim();
          if (v.length) tokens.push(v);
          cur = '';
          continue;
        }
        cur += ch;
      }
    }
    const v = cur.trim();
    if (v.length) tokens.push(v);
    nodes.push({
      id:         tokens[0],
      title:      tokens[1],
      domain:     tokens[2],
      path_type:  tokens[3],
      stage:      tokens[4],
      primary:    tokens[6] === 'true',
      cluster:    tokens[7],
    });
  }
  return nodes;
}

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
// Load 3D tree data.js (ES module — use dynamic import)
// --------------------------------------------------------------
async function loadTree() {
  const url = pathToFileURL(TREE_PATH).href;
  const mod = await import(url);
  return mod.DOMAINS;
}

// --------------------------------------------------------------
// Normalize title for fuzzy comparison
// --------------------------------------------------------------
function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b|\bof\b|\bin\b|\bfor\b|\band\b|\ba\b|\ban\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Domain mapping: migration domain → 3D tree domain id
const DOMAIN_MAP_MIG_TO_3D = {
  'Math':       'math',
  'Language':   'lang',
  'Social':     'social',
  'Bible':      'religion',
  'LifeSkills': 'life',
  'Creative':   'creative',
  'Technology': 'tech',
  'Physical':   'fitness',
  'Science':    null,                // no counterpart in 3D tree
};

(async () => {
  const migNodes = loadNodes();
  const migEdges = loadEdges();
  const tree = await loadTree();

  // Group migration nodes by domain
  const migByDomain = {};
  for (const n of migNodes) {
    (migByDomain[n.domain] = migByDomain[n.domain] || []).push(n);
  }

  // Group 3D tree skills by domain id
  const treeByDomain = {};
  for (const d of tree) treeByDomain[d.id] = { domain: d, skills: d.skills };

  // ----------------------------------------------------------
  // Build report
  // ----------------------------------------------------------
  const report = [];
  const p = (...s) => report.push(s.join(''));

  p('# 3D Skill Tree vs curriculum seed migrations');
  p('');
  p('Source-of-truth: `supabase/migrations/seed_2_nodes.sql` + `seed_3_edges.sql`.');
  p('Comparison target: `Trees/3D Skill Tree/data.js`.');
  p('');
  p('## Headline counts');
  p('');
  p('| Domain (migration) | Migration nodes | 3D tree id | 3D skills | Δ |');
  p('|---|---:|---|---:|---:|');
  for (const [mdom, tid] of Object.entries(DOMAIN_MAP_MIG_TO_3D)) {
    const migCount = (migByDomain[mdom] || []).length;
    const t = tid ? treeByDomain[tid] : null;
    const treeCount = t ? t.skills.length : 0;
    const deltaStr = tid
      ? (migCount - treeCount > 0 ? `**+${migCount - treeCount}**` : `${migCount - treeCount}`)
      : '**missing domain**';
    p(`| ${mdom} | ${migCount} | ${tid || '—'} | ${treeCount} | ${deltaStr} |`);
  }
  p('');

  // ----------------------------------------------------------
  // Entire missing domain
  // ----------------------------------------------------------
  p('## 1. Missing domain: Science');
  p('');
  p('The migration has a full `Science` domain (47 nodes). The 3D tree has');
  p('no `science` domain at all. Every skill below is absent.');
  p('');
  const sciNodes = (migByDomain['Science'] || []).sort((a, b) => {
    const stageOrder = { Foundations: 1, Fluency: 2, Application: 3, Integration: 4, Mastery: 5 };
    return (stageOrder[a.stage] || 9) - (stageOrder[b.stage] || 9) || a.title.localeCompare(b.title);
  });
  p('| Migration id | Title | Stage | Cluster | Path |');
  p('|---|---|---|---|---|');
  for (const n of sciNodes) {
    p(`| ${n.id} | ${n.title} | ${n.stage} | ${n.cluster} | ${n.path_type} |`);
  }
  p('');

  // ----------------------------------------------------------
  // Per-domain missing skills (migration → 3D tree)
  // ----------------------------------------------------------
  p('## 2. Per-domain: skills in migration NOT present in the 3D tree');
  p('');
  p('Fuzzy match on normalized title (lowercased, punctuation stripped, common');
  p('words like "the/of/and" ignored). Skills here are in the migration but');
  p('have no recognizable counterpart in the 3D tree for that domain.');
  p('');

  const perDomainMissing = {};

  for (const [mdom, tid] of Object.entries(DOMAIN_MAP_MIG_TO_3D)) {
    if (!tid) continue; // Science reported above
    const migs = migByDomain[mdom] || [];
    const treeSkills = treeByDomain[tid]?.skills || [];
    const treeNames = new Set(treeSkills.map(s => norm(s.name)));
    // Accept token-subset match too: if every significant token in migration
    // title appears in some tree name, treat as matched.
    const treeTokens = treeSkills.map(s => new Set(norm(s.name).split(' ').filter(Boolean)));

    const missing = [];
    for (const m of migs) {
      const target = norm(m.title);
      if (!target) continue;
      if (treeNames.has(target)) continue;
      // substring check in either direction
      const hit = treeSkills.some(s => {
        const n = norm(s.name);
        return n.includes(target) || target.includes(n);
      });
      if (hit) continue;
      // token subset (≥2 shared tokens, and migration title is short enough)
      const migTokens = new Set(target.split(' ').filter(Boolean));
      if (migTokens.size >= 1) {
        const strongHit = treeTokens.some(ts => {
          let shared = 0;
          for (const t of migTokens) if (ts.has(t)) shared++;
          return shared >= Math.min(2, migTokens.size) && shared / migTokens.size >= 0.6;
        });
        if (strongHit) continue;
      }
      missing.push(m);
    }
    perDomainMissing[mdom] = missing;
  }

  for (const [mdom, missing] of Object.entries(perDomainMissing)) {
    const tid = DOMAIN_MAP_MIG_TO_3D[mdom];
    const totalMig = (migByDomain[mdom] || []).length;
    p(`### ${mdom} → ${tid}  (${missing.length} of ${totalMig} migration nodes unmatched)`);
    p('');
    if (!missing.length) {
      p('_(every migration skill has a plausible 3D tree counterpart)_');
      p('');
      continue;
    }
    // Group by stage
    const byStage = {};
    for (const m of missing) (byStage[m.stage] = byStage[m.stage] || []).push(m);
    const stageOrder = ['Foundations', 'Fluency', 'Application', 'Integration', 'Mastery'];
    p('| Stage | Migration id | Title | Cluster | Path |');
    p('|---|---|---|---|---|');
    for (const st of stageOrder) {
      const arr = byStage[st] || [];
      arr.sort((a, b) => a.title.localeCompare(b.title));
      for (const m of arr) {
        p(`| ${st} | ${m.id} | ${m.title} | ${m.cluster} | ${m.path_type} |`);
      }
    }
    const other = missing.filter(m => !stageOrder.includes(m.stage));
    for (const m of other) {
      p(`| ${m.stage || '?'} | ${m.id} | ${m.title} | ${m.cluster} | ${m.path_type} |`);
    }
    p('');
  }

  // ----------------------------------------------------------
  // Things in 3D tree with no obvious migration counterpart
  // (for awareness — migration is truth, these might be extras)
  // ----------------------------------------------------------
  p('## 3. Skills in the 3D tree with no obvious migration counterpart');
  p('');
  p('Reverse direction: 3D-tree-only skills (not found in migration by name).');
  p('These might be *new* concepts the 3D tree introduced beyond the migration.');
  p('');

  for (const [mdom, tid] of Object.entries(DOMAIN_MAP_MIG_TO_3D)) {
    if (!tid) continue;
    const treeSkills = treeByDomain[tid]?.skills || [];
    const migs = migByDomain[mdom] || [];
    const migNames = new Set(migs.map(m => norm(m.title)));
    const migTokens = migs.map(m => new Set(norm(m.title).split(' ').filter(Boolean)));

    const extras = [];
    for (const s of treeSkills) {
      const target = norm(s.name);
      if (!target) continue;
      if (migNames.has(target)) continue;
      const hit = migs.some(m => {
        const n = norm(m.title);
        return n.includes(target) || target.includes(n);
      });
      if (hit) continue;
      const treeTok = new Set(target.split(' ').filter(Boolean));
      const strongHit = migTokens.some(ts => {
        let shared = 0;
        for (const t of treeTok) if (ts.has(t)) shared++;
        return shared >= Math.min(2, treeTok.size) && shared / treeTok.size >= 0.6;
      });
      if (strongHit) continue;
      extras.push(s);
    }

    p(`### ${tid} (${mdom}): ${extras.length} of ${treeSkills.length} skills have no migration match`);
    p('');
    if (!extras.length) {
      p('_(none — every 3D skill is also in the migration)_');
      p('');
      continue;
    }
    p('| Tier | 3D id | Name |');
    p('|---|---|---|');
    for (const s of extras.sort((a, b) => (a.tier || 0) - (b.tier || 0) || a.name.localeCompare(b.name))) {
      p(`| ${s.tier} | ${s.id} | ${s.name} |`);
    }
    p('');
  }

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------
  p('## Summary');
  p('');
  p(`- Migration nodes total:            ${migNodes.length}`);
  p(`- Migration edges total:            ${migEdges.length}`);
  p(`- 3D tree skills total:             ${tree.reduce((a, d) => a + d.skills.length, 0)}`);
  p(`- Missing domain in 3D tree:        Science (${(migByDomain['Science']||[]).length} skills)`);
  let totalMissing = (migByDomain['Science']||[]).length;
  for (const [d, arr] of Object.entries(perDomainMissing)) totalMissing += arr.length;
  p(`- Total migration skills missing from 3D tree: ${totalMissing}`);

  fs.writeFileSync(OUT_PATH, report.join('\n'), 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
  console.log('');
  console.log('Summary:');
  console.log(`  Migration nodes:  ${migNodes.length}`);
  console.log(`  3D tree skills:   ${tree.reduce((a, d) => a + d.skills.length, 0)}`);
  console.log(`  Missing Science:  ${(migByDomain['Science']||[]).length}`);
  for (const [d, arr] of Object.entries(perDomainMissing)) {
    const total = (migByDomain[d]||[]).length;
    console.log(`  ${d.padEnd(12)} missing ${String(arr.length).padStart(3)} / ${total}`);
  }
})();
