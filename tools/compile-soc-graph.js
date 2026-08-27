// Compile data/social_curriculum_v2.json into the live compiled graph + seed migration.
// Mirrors tools/compile-math-graph.js for the Science domain.
// Usage: node tools/compile-soc-graph.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BACKEND = require('./backend-path');  // private backend repo
const R = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const v2 = R('data/social_curriculum_v2.json');
const mg = R('data/compiled/master_graph.json');
const eg = R('data/compiled/edges.json');

const uNodes = v2.nodes;
const uById = new Map(uNodes.map(n => [n.id, n]));
const uIds = new Set(uNodes.map(n => n.id));
// old Science node ids = existing Science-domain nodes in master_graph
const oldLangIds = new Set(mg.nodes.filter(n => n.domain === 'Social').map(n => n.id));
const isLang = id => uIds.has(id) || oldLangIds.has(id);

// ---- 1. coords: reuse existing, inherit for new ----
const oldById = new Map(mg.nodes.filter(n => n.domain === 'Social').map(n => [n.id, n]));
const coord = new Map();
for (const n of uNodes) { const o = oldById.get(n.id); if (o && o.visual && typeof o.visual.x === 'number') coord.set(n.id, { x: o.visual.x, y: o.visual.y }); }
const clusterPts = {};
for (const n of uNodes) { const c = coord.get(n.id); if (c) (clusterPts[n.cluster] = clusterPts[n.cluster] || []).push(c); }
const centroid = cl => { const p = clusterPts[cl] || []; return p.length ? { x: p.reduce((a, q) => a + q.x, 0) / p.length, y: p.reduce((a, q) => a + q.y, 0) / p.length } : null; };
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
for (let pass = 0; pass < 8; pass++) for (const n of uNodes) {
  if (coord.has(n.id)) continue;
  const ps = (n.hard_prereqs || []).concat(n.soft_deps || []).map(id => coord.get(id)).filter(Boolean);
  if (ps.length) coord.set(n.id, { x: ps.reduce((a, q) => a + q.x, 0) / ps.length + ((hash(n.id) % 240) - 120), y: ps.reduce((a, q) => a + q.y, 0) / ps.length + 140 });
}
let fallback = 0;
for (const n of uNodes) if (!coord.has(n.id)) { const c = centroid(n.cluster) || { x: 400, y: 400 }; coord.set(n.id, { x: c.x + ((hash(n.id) % 400) - 200), y: c.y + ((hash(n.id + 'y') % 400) - 200) }); fallback++; }

// ---- 2. path_type ----
const hasDependents = new Set();
for (const n of uNodes) for (const p of (n.hard_prereqs || [])) hasDependents.add(p);

// ---- 3. new Science nodes in master_graph schema ----
const langNodes = uNodes.map(n => ({
  id: n.id, title: n.title, domain: 'Social',
  path_type: hasDependents.has(n.id) ? 'Spine' : 'Leaf',
  stage: n.stage, grade_band: n.grade_band || '', primary_path: hasDependents.has(n.id),
  cluster: n.cluster, description: n.mastery_criteria || '', demonstration: '',
  mastery_criteria: n.mastery_criteria ? [n.mastery_criteria] : [],
  evidence_types: [], visual: { x: Math.round(coord.get(n.id).x), y: Math.round(coord.get(n.id).y), z_group: 1, color_cluster: n.cluster },
  legacy_name: n.title, legacy_subject: 'Social', source: n.provenance || 'v2',
  game_skill: n.game_skill || null, stage_id: n.stage_id || null, atomic: n.atomic !== false
}));
const others = mg.nodes.filter(n => n.domain !== 'Social');
mg.nodes = [...others, ...langNodes];
mg.nodeCount = mg.nodes.length;

// ---- 4. edges ----
let eid = 1; const mkId = () => 'E' + String(eid++).padStart(4, '0');
const out = []; const seen = new Set();
const push = (from, to, type) => { const k = from + '>' + to + '>' + type; if (from !== to && !seen.has(k)) { seen.add(k); out.push({ from, to, type, id: mkId() }); } };
const exists = id => uIds.has(id) || others.some(n => n.id === id);
// keep every edge NOT touching Science, and cross_domain edges touching Science (endpoints still exist — no merges deleted nodes)
for (const e of eg.edges) {
  const langInc = isLang(e.from) || isLang(e.to);
  if (!langInc) { push(e.from, e.to, e.type); continue; }
  if (e.type === 'cross_domain' && exists(e.from) && exists(e.to)) push(e.from, e.to, 'cross_domain');
  // drop old Science prerequisite_hard/leads_to (regenerated below)
}
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
const gradeBand = g => { if (!g) return ''; if (/college/i.test(g)) return '11-12'; if (/^k/i.test(g)) { const m = g.match(/\d+/); return (m ? +m[0] : 0) <= 2 ? 'K-2' : '3-5'; } const m = g.match(/\d+/); if (!m) return ''; const n = +m[0]; return n <= 2 ? 'K-2' : n <= 5 ? '3-5' : n <= 8 ? '6-8' : n <= 10 ? '9-10' : '11-12'; };
const langIncident = out.filter(e => isLang(e.from) || isLang(e.to));
let sql = `-- English/Science curriculum graph v2 seed (generated by tools/compile-soc-graph.js — do not hand-edit)\n`;
sql += `-- ${langNodes.length} Science nodes, ${langIncident.length} Science-incident edges. Apply via SQL editor or supabase db push.\nBEGIN;\n\n`;
sql += `-- 1. Upsert all Science nodes (existing kept, new/split added)\n`;
for (const n of langNodes) {
  const v = JSON.stringify(n.visual);
  sql += `INSERT INTO curriculum_nodes (id,title,domain,path_type,stage,grade_band,primary_path,cluster,description,demonstration,mastery_criteria,visual,legacy_name,legacy_subject,source) VALUES (`;
  sql += `'${esc(n.id)}','${esc(n.title)}','Social','${esc(n.path_type)}','${esc(n.stage)}','${esc(gradeBand(n.grade_band))}',${n.primary_path},'${esc(n.cluster)}','${esc(n.description)}','${esc(n.description)}',${jsonArr(n.mastery_criteria)},'${esc(v)}'::jsonb,'${esc(n.title)}','Social','${esc(n.source)}')\n`;
  sql += `  ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,path_type=EXCLUDED.path_type,stage=EXCLUDED.stage,grade_band=EXCLUDED.grade_band,primary_path=EXCLUDED.primary_path,cluster=EXCLUDED.cluster,description=EXCLUDED.description,demonstration=EXCLUDED.demonstration,mastery_criteria=EXCLUDED.mastery_criteria,visual=EXCLUDED.visual;\n`;
}
sql += `\n-- 2. Replace all Science-incident edges (nodes upserted above; cross-domain re-inserted below)\n`;
sql += `DELETE FROM curriculum_edges WHERE from_node IN (SELECT id FROM curriculum_nodes WHERE domain='Social') OR to_node IN (SELECT id FROM curriculum_nodes WHERE domain='Social');\n`;
let ec = 0;
for (const e of langIncident) {
  const idc = 'SOV2' + String(++ec).padStart(5, '0');
  sql += `INSERT INTO curriculum_edges (id,from_node,to_node,edge_type) VALUES ('${idc}','${esc(e.from)}','${esc(e.to)}','${esc(e.type)}') ON CONFLICT (id) DO NOTHING;\n`;
}
sql += `\nCOMMIT;\n`;
fs.writeFileSync(path.join(BACKEND, 'supabase/migrations/zzzzzz_social_graph_v2_seed.sql'), sql);

console.log('=== LANG COMPILE DONE ===');
console.log(`master_graph: ${mg.nodes.length} nodes (${langNodes.length} Science + ${others.length} other)`);
console.log(`edges: ${out.length} total`);
const et = {}; out.forEach(e => et[e.type] = (et[e.type] || 0) + 1); console.log('edge types:', JSON.stringify(et));
console.log(`new-node coords: inherited=${uNodes.length - fallback}, fallback=${fallback}`);
console.log(`seed: supabase/migrations/zzzzzz_social_graph_v2_seed.sql (${langIncident.length} edges)`);
