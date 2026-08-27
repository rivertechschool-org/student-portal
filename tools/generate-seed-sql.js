#!/usr/bin/env node
/**
 * Phase 1.2: Generate seed SQL from compiled data.
 * Outputs INSERT statements for curriculum_nodes, curriculum_edges, curriculum_clusters.
 *
 * Usage: node tools/generate-seed-sql.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = require('./backend-path');  // private backend repo
const COMPILED_DIR = path.join(ROOT, 'data', 'compiled');
const OUT_PATH = path.join(BACKEND, 'supabase', 'migrations', 'curriculum_graph_seed.sql');

const masterGraph = JSON.parse(fs.readFileSync(path.join(COMPILED_DIR, 'master_graph.json'), 'utf-8'));
const edgesData = JSON.parse(fs.readFileSync(path.join(COMPILED_DIR, 'edges.json'), 'utf-8'));
const clustersData = JSON.parse(fs.readFileSync(path.join(COMPILED_DIR, 'clusters.json'), 'utf-8'));

function esc(str) {
    if (str === null || str === undefined) return 'NULL';
    return `'${String(str).replace(/'/g, "''")}'`;
}

function escJson(obj) {
    return `'${JSON.stringify(obj).replace(/'/g, "''")}'`;
}

function escArr(arr) {
    if (!arr || arr.length === 0) return "'{}'";
    return `ARRAY[${arr.map(v => esc(v)).join(',')}]`;
}

let sql = `-- Curriculum Graph Seed Data
-- Generated from compiled master graph: ${masterGraph.nodeCount} nodes, ${edgesData.edgeCount} edges, ${clustersData.clusterCount} clusters
-- Generated on: ${new Date().toISOString()}
--
-- SAFETY: This only INSERTs into the NEW curriculum_* tables.
-- It does NOT touch skill_progress or any other existing table.
-- Uses ON CONFLICT DO NOTHING so it's safe to run multiple times.

BEGIN;

-- ============================================================
-- Clusters (insert first since nodes don't FK to clusters)
-- ============================================================
`;

for (const cluster of clustersData.clusters) {
    sql += `INSERT INTO curriculum_clusters (id, domain, name, color, label_position) VALUES (${esc(cluster.id)}, ${esc(cluster.domain)}, ${esc(cluster.name)}, ${esc(cluster.color)}, ${escJson(cluster.label_position)}) ON CONFLICT (id) DO NOTHING;\n`;
}

sql += `\n-- ============================================================\n-- Nodes (${masterGraph.nodeCount} total)\n-- ============================================================\n`;

for (const node of masterGraph.nodes) {
    sql += `INSERT INTO curriculum_nodes (id, title, domain, path_type, stage, grade_band, primary_path, cluster, description, demonstration, mastery_criteria, evidence_types, visual, legacy_name, legacy_subject, csv_id, source) VALUES (${esc(node.id)}, ${esc(node.title)}, ${esc(node.domain)}, ${esc(node.path_type)}, ${esc(node.stage)}, ${esc(node.grade_band || '')}, ${node.primary_path}, ${esc(node.cluster)}, ${esc(node.description || '')}, ${esc(node.demonstration || '')}, ${escJson(node.mastery_criteria || [])}, ${escArr(node.evidence_types || [])}, ${escJson(node.visual)}, ${node.legacy_name ? esc(node.legacy_name) : 'NULL'}, ${node.legacy_subject ? esc(node.legacy_subject) : 'NULL'}, ${node.csv_id ? esc(node.csv_id) : 'NULL'}, ${esc(node.source)}) ON CONFLICT (id) DO NOTHING;\n`;
}

sql += `\n-- ============================================================\n-- Edges (${edgesData.edgeCount} total)\n-- ============================================================\n`;

for (const edge of edgesData.edges) {
    sql += `INSERT INTO curriculum_edges (id, from_node, to_node, edge_type) VALUES (${esc(edge.id)}, ${esc(edge.from)}, ${esc(edge.to)}, ${esc(edge.type)}) ON CONFLICT (from_node, to_node, edge_type) DO NOTHING;\n`;
}

sql += `\nCOMMIT;\n`;

fs.writeFileSync(OUT_PATH, sql);

console.log(`Seed SQL generated: ${OUT_PATH}`);
console.log(`  ${clustersData.clusterCount} cluster inserts`);
console.log(`  ${masterGraph.nodeCount} node inserts`);
console.log(`  ${edgesData.edgeCount} edge inserts`);
console.log(`  File size: ${(Buffer.byteLength(sql) / 1024).toFixed(1)} KB`);
