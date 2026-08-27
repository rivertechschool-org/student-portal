#!/usr/bin/env node
/**
 * Split the seed SQL into 3 separate files that can be run individually.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = require('./backend-path');  // private backend repo
const seedPath = path.join(BACKEND, 'supabase', 'migrations', 'curriculum_graph_seed.sql');
const sql = fs.readFileSync(seedPath, 'utf-8');
const lines = sql.split('\n');

let clusterLines = [];
let nodeLines = [];
let edgeLines = [];

for (const line of lines) {
    if (line.startsWith('INSERT INTO curriculum_clusters')) clusterLines.push(line);
    else if (line.startsWith('INSERT INTO curriculum_nodes')) nodeLines.push(line);
    else if (line.startsWith('INSERT INTO curriculum_edges')) edgeLines.push(line);
}

const outDir = path.join(BACKEND, 'supabase', 'migrations');

fs.writeFileSync(path.join(outDir, 'seed_1_clusters.sql'),
    `-- Step 1: Clusters (${clusterLines.length} rows)\n` + clusterLines.join('\n') + '\n');

fs.writeFileSync(path.join(outDir, 'seed_2_nodes.sql'),
    `-- Step 2: Nodes (${nodeLines.length} rows)\n` + nodeLines.join('\n') + '\n');

fs.writeFileSync(path.join(outDir, 'seed_3_edges.sql'),
    `-- Step 3: Edges (${edgeLines.length} rows) — run AFTER nodes\n` + edgeLines.join('\n') + '\n');

console.log(`Split into 3 files:`);
console.log(`  seed_1_clusters.sql: ${clusterLines.length} inserts`);
console.log(`  seed_2_nodes.sql: ${nodeLines.length} inserts`);
console.log(`  seed_3_edges.sql: ${edgeLines.length} inserts`);
