// Compile data/math_curriculum_v2.json into the live compiled graph + a seed migration.
// - Replaces all Math (M*) nodes in master_graph.json with the 277 unified nodes.
// - Regenerates math prerequisite edges (hard + soft); re-points cross_domain edges off merged legacy ids.
// - Lays out coordinates for new nodes (inherits from prereqs / cluster centroid).
// - Emits supabase/migrations/zzzzzz_math_graph_v2_seed.sql (curriculum_nodes + curriculum_edges upsert).
// Usage: node tools/compile-math-graph.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BACKEND = require('./backend-path');  // private backend repo
const R = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const v2 = R('data/math_curriculum_v2.json');
const mg = R('data/compiled/master_graph.json');
const eg = R('data/compiled/edges.json');
const isMath = id => /^M-?\d/.test(id || '');

const uNodes = v2.nodes;
const uById = new Map(uNodes.map(n => [n.id, n]));
const legacyToCanon = new Map();
for (const m of (v2.merges || [])) legacyToCanon.set(m.legacy_id, m.canonical_id);

// ---- 1. existing coords (reuse for kept nodes) ----
const oldMath = new Map(mg.nodes.filter(n => isMath(n.id)).map(n => [n.id, n]));
const coord = new Map();
for (const n of uNodes) {
  const old = oldMath.get(n.id);
  if (old && old.visual && typeof old.visual.x === 'number') coord.set(n.id, { x: old.visual.x, y: old.visual.y });
}
// cluster centroids from known coords
const clusterPts = {};
for (const n of uNodes) { const c = coord.get(n.id); if (c) { (clusterPts[n.cluster] = clusterPts[n.cluster] || []).push(c); } }
const centroid = cl => { const p = clusterPts[cl] || []; if (!p.length) return null; return { x: p.reduce((a, q) => a + q.x, 0) / p.length, y: p.reduce((a, q) => a + q.y, 0) / p.length }; };
const hash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; };
// resolve missing coords: inherit from prereqs, iterate
for (let pass = 0; pass < 8; pass++) {
  for (const n of uNodes) {
    if (coord.has(n.id)) continue;
    const ps = (n.hard_prereqs || []).concat(n.soft_deps || []).map(id => coord.get(id)).filter(Boolean);
    if (ps.length) coord.set(n.id, { x: ps.reduce((a, q) => a + q.x, 0) / ps.length + ((hash(n.id) % 240) - 120), y: ps.reduce((a, q) => a + q.y, 0) / ps.length + 140 });
  }
}
let fallback = 0;
for (const n of uNodes) if (!coord.has(n.id)) { const c = centroid(n.cluster) || { x: 400, y: 400 }; coord.set(n.id, { x: c.x + ((hash(n.id) % 400) - 200), y: c.y + ((hash(n.id + 'y') % 400) - 200) }); fallback++; }

// ---- 2. path_type: Leaf if nothing depends on it (no outgoing hard edge), else Spine ----
const hasDependents = new Set();
for (const n of uNodes) for (const p of (n.hard_prereqs || [])) hasDependents.add(p);

// ---- 3. build new math nodes in master_graph schema ----
const mathNodes = uNodes.map(n => ({
  id: n.id, title: n.title, domain: 'Math',
  path_type: hasDependents.has(n.id) ? 'Spine' : 'Leaf',
  stage: n.stage, grade_band: n.grade_band || '', primary_path: hasDependents.has(n.id),
  cluster: n.cluster,
  description: n.mastery_criteria || '', demonstration: '',
  mastery_criteria: n.mastery_criteria ? [n.mastery_criteria] : [],
  evidence_types: [], visual: { x: Math.round(coord.get(n.id).x), y: Math.round(coord.get(n.id).y), z_group: 1, color_cluster: n.cluster },
  legacy_name: n.title, legacy_subject: 'Math', source: n.provenance || 'v2',
  dojo_skill: n.dojo_skill || null, dojo_tier: n.dojo_tier || null, atomic: n.atomic !== false
}));
const nonMath = mg.nodes.filter(n => !isMath(n.id));
mg.nodes = [...nonMath, ...mathNodes];
mg.nodeCount = mg.nodes.length;

// ---- 4. edges ----
let eid = 1;
const mkId = () => 'E' + String(eid++).padStart(4, '0');
const out = [];
const seen = new Set();
const push = (from, to, type) => { const k = from + '>' + to + '>' + type; if (from !== to && !seen.has(k)) { seen.add(k); out.push({ from, to, type, id: mkId() }); } };
const nodeExists = id => uById.has(id) || nonMath.some(n => n.id === id);
// keep non-math<->non-math edges
for (const e of eg.edges) {
  if (!isMath(e.from) && !isMath(e.to)) push(e.from, e.to, e.type);
}
// re-point + keep cross_domain edges touching math
for (const e of eg.edges) {
  if (e.type !== 'cross_domain') continue;
  let f = e.from, t = e.to;
  if (isMath(f) && legacyToCanon.has(f)) f = legacyToCanon.get(f);
  if (isMath(t) && legacyToCanon.has(t)) t = legacyToCanon.get(t);
  if ((isMath(f) ? uById.has(f) : nodeExists(f)) && (isMath(t) ? uById.has(t) : nodeExists(t))) push(f, t, 'cross_domain');
}
// regenerate math prereqs
for (const n of uNodes) {
  for (const p of (n.hard_prereqs || [])) if (uById.has(p)) push(p, n.id, 'prerequisite_hard');
  for (const p of (n.soft_deps || [])) if (uById.has(p)) push(p, n.id, 'prerequisite_soft');
}
eg.edges = out; eg.edgeCount = out.length;

fs.writeFileSync(path.join(ROOT, 'data/compiled/master_graph.json'), JSON.stringify(mg, null, 1));
fs.writeFileSync(path.join(ROOT, 'data/compiled/edges.json'), JSON.stringify(eg, null, 1));

// ---- 5. seed migration ----
const esc = s => String(s == null ? '' : s).replace(/'/g, "''");
const jsonArr = a => `'${esc(JSON.stringify(a || []))}'::jsonb`;
// map free-text grade band -> the curriculum_nodes CHECK enum
const gradeBand = g => {
  if (!g) return '';
  if (/college/i.test(g)) return '11-12';
  if (/^k/i.test(g)) { const m = g.match(/\d+/); const n = m ? +m[0] : 0; return n <= 2 ? 'K-2' : '3-5'; }
  const m = g.match(/\d+/); if (!m) return '';
  const n = +m[0];
  return n <= 2 ? 'K-2' : n <= 5 ? '3-5' : n <= 8 ? '6-8' : n <= 10 ? '9-10' : '11-12';
};
const mathIncident = out.filter(e => isMath(e.from) || isMath(e.to));
let sql = `-- Math curriculum graph v2 seed (generated by tools/compile-math-graph.js — do not hand-edit)\n`;
sql += `-- ${mathNodes.length} math nodes, ${mathIncident.length} math-incident edges. Apply via SQL editor or supabase db push.\nBEGIN;\n\n`;
sql += `-- 1. Upsert all math nodes (creates new/split/seeded, updates existing)\n`;
for (const n of mathNodes) {
  const v = JSON.stringify(n.visual);
  sql += `INSERT INTO curriculum_nodes (id,title,domain,path_type,stage,grade_band,primary_path,cluster,description,demonstration,mastery_criteria,visual,legacy_name,legacy_subject,source) VALUES (`;
  sql += `'${esc(n.id)}','${esc(n.title)}','Math','${esc(n.path_type)}','${esc(n.stage)}','${esc(gradeBand(n.grade_band))}',${n.primary_path},'${esc(n.cluster)}','${esc(n.description)}','${esc(n.description)}',${jsonArr(n.mastery_criteria)},'${esc(v)}'::jsonb,'${esc(n.title)}','Math','${esc(n.source)}')\n`;
  sql += `  ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,path_type=EXCLUDED.path_type,stage=EXCLUDED.stage,grade_band=EXCLUDED.grade_band,primary_path=EXCLUDED.primary_path,cluster=EXCLUDED.cluster,description=EXCLUDED.description,demonstration=EXCLUDED.demonstration,mastery_criteria=EXCLUDED.mastery_criteria,visual=EXCLUDED.visual;\n`;
}
sql += `\n-- 2. Remove merged legacy duplicate nodes (cascades their edges)\n`;
sql += `DELETE FROM curriculum_nodes WHERE id IN (${[...legacyToCanon.keys()].map(id => `'${esc(id)}'`).join(',')});\n\n`;
sql += `-- 3. Replace all math-incident edges\n`;
sql += `DELETE FROM curriculum_edges WHERE from_node LIKE 'M%' OR to_node LIKE 'M%';\n`;
let ec = 0;
for (const e of mathIncident) {
  const eidStr = 'EMV2' + String(++ec).padStart(5, '0');
  sql += `INSERT INTO curriculum_edges (id,from_node,to_node,edge_type) VALUES ('${eidStr}','${esc(e.from)}','${esc(e.to)}','${esc(e.type)}') ON CONFLICT (id) DO NOTHING;\n`;
}
sql += `\nCOMMIT;\n`;
fs.writeFileSync(path.join(BACKEND, 'supabase/migrations/zzzzzz_math_graph_v2_seed.sql'), sql);

console.log('=== COMPILE DONE ===');
console.log(`master_graph: ${mg.nodes.length} nodes (${mathNodes.length} math + ${nonMath.length} other)`);
console.log(`edges: ${out.length} total`);
const et = {}; out.forEach(e => et[e.type] = (et[e.type] || 0) + 1); console.log('edge types:', JSON.stringify(et));
console.log(`new-node coords: inherited=${uNodes.length - fallback}, cluster-fallback=${fallback}`);
console.log(`seed migration: supabase/migrations/zzzzzz_math_graph_v2_seed.sql`);
