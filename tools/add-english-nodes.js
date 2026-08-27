// Additively add new English/Language curriculum nodes WITHOUT re-running the
// global pipeline (which would rewrite every domain's layout). Appends nodes +
// prerequisite edges to the compiled JSON, emits an additive seed migration
// (seed_4_english_nodes.sql, ON CONFLICT DO NOTHING), and appends CSV rows.
//
// Idempotent-ish: existing nodes are never modified; re-running would duplicate
// appended entries in JSON, so run once. The SQL is fully idempotent.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = p => path.join(ROOT, p);
const BACKEND = require('./backend-path');  // private backend repo

// id, title, stage, prereqs[], demonstration
const NEW = [
  ['E28','Parts of Speech','Fluency',['E7'],'Identify and use the eight parts of speech'],
  ['E29','Context Clues','Fluency',['L-006'],'Use surrounding text to determine word meaning'],
  ['E30','Genre Study','Fluency',['E21'],'Identify and distinguish literary genres'],
  ['E31','Punctuation & Capitalization','Application',['E11'],'Apply correct punctuation and capitalization'],
  ['E32','Clauses & Phrases','Application',['E7'],'Identify clauses and phrases and combine sentences'],
  ['E33','Roots & Affixes','Application',['L-006'],'Use roots, prefixes, and suffixes to decode meaning'],
  ['E34','Text Structures','Application',['E9'],'Identify nonfiction text structures'],
  ["E35","Author's Purpose",'Application',['E9'],"Determine an author's purpose and point of view"],
  ['E36','Summarizing','Application',['E5'],'Summarize a text in your own words'],
  ['E37','Narrative Writing','Application',['E8'],'Write an engaging narrative with sequence and detail'],
  ['E38','Informative Writing','Application',['E8'],'Write a clear informative or explanatory text'],
  ['E39','Writing Process','Application',['E10'],'Plan, draft, revise, edit, and publish writing'],
  ['E40','Drama & Theater','Application',['E21'],'Identify the elements of drama'],
  ['E41','Mood & Tone','Application',['E22'],'Distinguish mood and tone in a text'],
  ['E42','Active Listening & Discussion','Integration',['E16'],'Listen actively and participate in discussion'],
  ['E43','MLA & APA Citation','Integration',['E14'],'Cite sources correctly in MLA and APA'],
  ['E44','Rhetorical Analysis','Mastery',['E15'],'Analyze how a text persuades its audience'],
  ['E45','Synthesis Writing','Mastery',['E18'],'Synthesize multiple sources into one argument'],
  ['E46','Technical & Professional Writing','Mastery',['E17'],'Produce clear technical and professional documents'],
  ['E47','Formal Logic','Mastery',['E19'],'Evaluate arguments using premises and conclusions'],
  ['E48','Etymology & Word Origins','Mastery',['E33'],'Trace word origins to understand meaning'],
  ['E49','Literary Criticism','Mastery',['E23'],'Interpret texts through critical lenses'],
];

const mg = JSON.parse(fs.readFileSync(P('data/compiled/master_graph.json'), 'utf8'));
const ed = JSON.parse(fs.readFileSync(P('data/compiled/edges.json'), 'utf8'));
const rl = JSON.parse(fs.readFileSync(P('data/compiled/radial_layout.json'), 'utf8'));

// Guard against double-run
if (mg.nodes.some(n => n.id === 'E28')) { console.error('E28 already present — aborting to avoid duplicates.'); process.exit(1); }

// Guard: every prerequisite id must already exist OR be one of the new ids.
const existingIds = new Set(mg.nodes.map(n => n.id));
const newIds = new Set(NEW.map(r => r[0]));
const badRefs = [];
for (const [id, , , prereqs] of NEW) for (const pre of prereqs) {
  if (!existingIds.has(pre) && !newIds.has(pre)) badRefs.push(`${id} -> ${pre}`);
}
if (badRefs.length) { console.error('Unknown prerequisite ids: ' + badRefs.join(', ')); process.exit(1); }

// Reference coords from existing Language nodes, per stage.
const langByStage = {};
rl.nodes.filter(n => n.domain === 'Language').forEach(n => {
  (langByStage[n.stage] = langByStage[n.stage] || []).push(n);
});
const stageRef = {};
for (const s of Object.keys(langByStage)) {
  const arr = langByStage[s];
  stageRef[s] = {
    maxX: Math.max(...arr.map(n => n.visual.x)),
    y: arr[0].visual.y,
    z: arr[0].visual.z_group || 1,
    radial: arr[0].radial || { x: 0, y: 0 },
  };
}

let edgeNum = Math.max(...ed.edges.map(e => parseInt(String(e.id).replace(/\D/g, ''), 10) || 0));
const nextEdgeId = () => 'E' + String(++edgeNum).padStart(4, '0');

const perStageIndex = {};
const newNodeObjs = [];
const newEdges = [];

for (const [id, title, stage, prereqs, demo] of NEW) {
  const ref = stageRef[stage] || { maxX: 2000, y: 800, z: 1, radial: { x: 4000, y: 1500 } };
  const i = (perStageIndex[stage] = (perStageIndex[stage] || 0) + 1);
  const x = ref.maxX + 160 + (i - 1) * 150;
  const y = ref.y + ((i % 2) ? 60 : -60);
  const cluster = `Language: ${stage}`;
  const node = {
    id, title, domain: 'Language', path_type: 'Branch', stage,
    grade_band: '', primary_path: false, cluster, description: '',
    demonstration: demo, mastery_criteria: [demo], evidence_types: [],
    visual: { x, y, z_group: ref.z, color_cluster: cluster },
    legacy_name: null, legacy_subject: null, source: 'csv',
  };
  newNodeObjs.push(node);
  // radial node carries an extra radial:{x,y}
  rl.nodes.push({ ...node, radial: { x: ref.radial.x + (i - 1) * 80, y: ref.radial.y + (i - 1) * 60 } });
  mg.nodes.push(node);
  // prerequisite_hard edges: from prereq -> this node
  for (const pre of prereqs) {
    const e = { from: pre, to: id, type: 'prerequisite_hard', id: nextEdgeId() };
    newEdges.push(e); ed.edges.push(e); rl.edges.push(e);
  }
}

// update counts
mg.nodeCount = mg.nodes.length;
ed.edgeCount = ed.edges.length;
rl.nodeCount = rl.nodes.length;
rl.edgeCount = rl.edges.length;

fs.writeFileSync(P('data/compiled/master_graph.json'), JSON.stringify(mg, null, 2));
fs.writeFileSync(P('data/compiled/edges.json'), JSON.stringify(ed, null, 2));
fs.writeFileSync(P('data/compiled/radial_layout.json'), JSON.stringify(rl, null, 2));

// ---- additive seed migration ----
const esc = s => String(s).replace(/'/g, "''");
let sql = `-- Additive: ${NEW.length} new English/Language curriculum nodes (E28–E${27 + NEW.length})\n`;
sql += `-- and their prerequisite edges. Idempotent (ON CONFLICT DO NOTHING).\n`;
sql += `-- Runs after seed_2_nodes/seed_3_edges so the tables and referenced nodes exist.\n\n`;
for (const n of newNodeObjs) {
  sql += `INSERT INTO curriculum_nodes (id, title, domain, path_type, stage, grade_band, primary_path, cluster, description, demonstration, mastery_criteria, evidence_types, visual, legacy_name, legacy_subject, csv_id, source) VALUES (` +
    `'${n.id}', '${esc(n.title)}', 'Language', 'Branch', '${n.stage}', '', false, '${esc(n.cluster)}', '', '${esc(n.demonstration)}', '${esc(JSON.stringify(n.mastery_criteria))}', '{}', '${esc(JSON.stringify(n.visual))}', NULL, NULL, '${n.id}', 'csv') ON CONFLICT (id) DO NOTHING;\n`;
}
sql += `\n`;
for (const e of newEdges) {
  sql += `INSERT INTO curriculum_edges (id, from_node, to_node, edge_type) VALUES ('${e.id}', '${e.from}', '${e.to}', '${e.type}') ON CONFLICT (from_node, to_node, edge_type) DO NOTHING;\n`;
}
fs.writeFileSync(path.join(BACKEND, 'supabase/migrations/seed_4_english_nodes.sql'), sql);

// ---- append CSV rows (source of truth) ----
let csv = fs.readFileSync(P('Trees/master_tree.csv'), 'utf8');
if (!csv.endsWith('\n')) csv += '\n';
for (const [id, title, stage, prereqs, demo] of NEW) {
  // CSV: ID,Name,Domain,PathType,Stage,PrimaryPath,Prerequisites,LeadsTo,CrossLinks,Demonstration
  csv += `${id},${title},Language,Branch,${stage},FALSE,${prereqs.join('|')},,,${demo}\n`;
}
fs.writeFileSync(P('Trees/master_tree.csv'), csv);

console.log(`Added ${NEW.length} nodes, ${newEdges.length} edges.`);
console.log(`master_graph nodes: ${mg.nodeCount}, edges.json edges: ${ed.edgeCount}, radial nodes: ${rl.nodeCount}`);
console.log(`Wrote supabase/migrations/seed_4_english_nodes.sql and appended ${NEW.length} CSV rows.`);
