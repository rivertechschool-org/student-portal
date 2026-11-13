// Student Hub > Skill Trees > Set starting point: what a chosen skill marks.
// Real portal method; the real curriculum; no network or school data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n      (?:async )?' + name + '\\('));
  assert(start >= 0, name);
  const end = html.indexOf('\n      }', start);
  return html.slice(start, end + 8).trim();
}
const app = eval(`({${method('_skillStartPlan')}})`);

// A small invented graph: D needs B and C, both need A; E stands alone.
const nodes = [
  { id: 'M-1', title: 'A', dojo_tier: 1, hard_prereqs: [] },
  { id: 'M-2', title: 'B', dojo_tier: 2, hard_prereqs: ['M-1'] },
  { id: 'M-3', title: 'C', dojo_tier: 1, hard_prereqs: ['M-1', 'M-gone'] },
  { id: 'M-4', title: 'D', dojo_tier: 3, hard_prereqs: ['M-2', 'M-3'] },
  { id: 'M-5', title: 'E', dojo_tier: 1, hard_prereqs: [] },
];
let p = app._skillStartPlan(nodes, 'M-4', {});
assert.deepEqual(p.needs.map(n => n.title), ['A', 'C', 'B'], 'every prerequisite at any depth, easiest first, once each');
assert.deepEqual(p.toMark.map(n => n.title), ['A', 'C', 'B']);
assert.equal(p.already, 0);
p = app._skillStartPlan(nodes, 'M-4', { A: 'mastered', C: 'activated', B: 'in_progress', D: 'available' });
assert.deepEqual(p.toMark.map(n => n.title), ['B'], 'mastered skills are left alone');
assert.equal(p.already, 2);
assert.equal(p.targetState, 'available');
assert.deepEqual(app._skillStartPlan(nodes, 'M-5', {}).needs, [], 'a root skill needs nothing');
assert.equal(app._skillStartPlan(nodes, 'M-9', {}), null);
// A cycle in bad data cannot hang it.
assert.equal(app._skillStartPlan([{ id: 'X', title: 'X', hard_prereqs: ['Y'] }, { id: 'Y', title: 'Y', hard_prereqs: ['X'] }], 'X', {}).needs.length, 1);

// The real curriculum: the names written are the names Math Dojo reads.
const cur = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/math_curriculum_v2.json'), 'utf8'));
const dojo = fs.readFileSync(path.join(__dirname, '../games/math-dojo.html'), 'utf8');
const graph = JSON.parse(dojo.match(/const MATH_GRAPH_V2 = (\{.*?\});\n/)[1]);
const dojoTitles = new Set(Object.values(graph.nodes).map(n => n.t));
const missing = cur.nodes.filter(n => !dojoTitles.has(n.title)).map(n => n.title);
assert.deepEqual(missing, [], 'every curriculum title is a Dojo skill name');
// A late skill pulls in a large, sane prerequisite set, all of it real.
const deepest = cur.nodes.reduce((best, n) => {
  const q = app._skillStartPlan(cur.nodes, n.id, {});
  return q.needs.length > best.n ? { n: q.needs.length, id: n.id } : best;
}, { n: 0 });
assert(deepest.n > 20 && deepest.n < cur.nodes.length, `deepest skill needs ${deepest.n}`);
const q = app._skillStartPlan(cur.nodes, deepest.id, {});
assert(q.needs.every(n => n.dojo_tier <= q.target.dojo_tier), 'nothing marked sits above the chosen skill');
console.log(`Set starting point: plan, mastered left alone, real curriculum (deepest needs ${deepest.n}) passed.`);
