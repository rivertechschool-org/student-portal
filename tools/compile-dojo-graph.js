// Compile the curriculum and the graduation plan into games/math-dojo.html.
//
// The Dojo carries three things it used to keep by hand, and they had drifted:
//   MATH_CONNECTIONS  the edges isSkillUnlocked walks. 246 hand-written edges
//                     against the curriculum's 322 hard prerequisites, 288 of
//                     them disagreeing, three naming skills that do not exist.
//   MATH_GRAPH_V2     the graph the diagnostic walks. Nothing generated it.
//   MATH_PLAN         the 65 required core items and the four branches (new).
// All three are now written from data/math_curriculum_v2.json and
// data/math_graduation_plan.json. Edit those, then run this.
//
// Every skill gets a class, derived here and never typed by hand:
//   core        listed under one of the 65 core items
//   foundation  not listed, but needed (at any depth) by a core skill, or an
//               unlisted elementary skill (Tier 4 and below)
//   branch      listed under a branch only, and not needed by core
//   enrichment  unlisted Tier 5-6 skill: optional practice at core level
//   beyond      unlisted Tier 7+: advanced electives
//
// Checks (exit 1 on failure):
//   * every plan item resolves to skills that exist and are playable
//   * no skill needs a prerequisite at a higher Dojo tier (unsatisfiable)
//   * no cycles in the prerequisite graph
//   * core never needs a branch-only skill (by construction; asserted anyway)
//
// Usage: node tools/compile-dojo-graph.js [--check]   (--check: verify, do not write)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'games', 'math-dojo.html');
const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'math_curriculum_v2.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'math_graduation_plan.json'), 'utf8'));
const CHECK = process.argv.includes('--check');

const errors = [];
const byId = new Map(cur.nodes.map(n => [n.id, n]));

// ---- prerequisite sanity ----
for (const n of cur.nodes) {
  if (!n.dojo_skill || !n.dojo_tier) errors.push(`${n.id} ${n.title}: no dojo_skill/dojo_tier, so it cannot be played`);
  for (const p of n.hard_prereqs || []) {
    const pn = byId.get(p);
    if (!pn) { errors.push(`${n.id} ${n.title}: unknown prerequisite ${p}`); continue; }
    if ((pn.dojo_tier || 0) > (n.dojo_tier || 0)) errors.push(`${n.title} (T${n.dojo_tier}) needs ${pn.title} (T${pn.dojo_tier}): unsatisfiable`);
  }
}
{ // cycles
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { errors.push('cycle: ' + trail.concat(id).map(x => byId.get(x)?.title).join(' -> ')); return; }
    state.set(id, 1);
    for (const p of byId.get(id)?.hard_prereqs || []) visit(p, trail.concat(id));
    state.set(id, 2);
  };
  for (const n of cur.nodes) visit(n.id, []);
}

// ---- classes (tools/lib/math-plan.js, shared with compile-math-graph) ----
const { classify } = require('./lib/math-plan');
const { cls, planCodes, branchOf, coreClosure, readyListed, readyClosure } = classify(cur.nodes, plan);
const checkItem = (it, where) => {
  if (!it.skills.length) errors.push(`${where} item ${it.code} lists no skills`);
  for (const id of it.skills) if (!byId.has(id)) errors.push(`${where} item ${it.code}: unknown skill ${id}`);
};
for (const d of plan.core.domains) for (const it of d.items) checkItem(it, 'core');
for (const d of (plan.readiness ? plan.readiness.domains : [])) for (const it of d.items) checkItem(it, 'readiness');
for (const b of plan.branches) for (const d of b.domains) for (const it of d.items) checkItem(it, `branch ${b.id}`);
for (const id of coreClosure) if (cls(id) === 'branch' || cls(id) === 'readiness') errors.push(`core needs ${cls(id)} skill ${byId.get(id).title}`);
for (const id of readyClosure) if (cls(id) === 'branch') errors.push(`readiness needs branch-only skill ${byId.get(id).title}`);

// Skills a readiness item needs that are not themselves listed under one:
// pulled into readiness (a student must learn them first), so say which.
const pulledIntoReadiness = [...readyClosure].filter(id => !readyListed.has(id)).map(id => byId.get(id).title);

// Branch-listed skills that core needs anyway: legitimate (a branch can build
// on core), but they will not look "set apart", so say which ones.
const shared = [...branchOf.keys()].filter(id => coreClosure.has(id)).map(id => byId.get(id).title);

if (errors.length) { console.log(errors.map(e => 'ERROR ' + e).join('\n')); process.exit(1); }

// ---- emit ----
const dependents = new Map(cur.nodes.map(n => [n.id, []]));
for (const n of cur.nodes) for (const p of n.hard_prereqs || []) dependents.get(p).push(n.id);
const graph = { nodes: {}, titleToId: {} };
for (const n of cur.nodes) {
  const node = { t: n.title, ds: n.dojo_skill, dt: n.dojo_tier, st: n.stage, gb: n.grade_band,
    hp: n.hard_prereqs || [], sd: n.soft_deps || [], atomic: n.atomic !== false, dep: dependents.get(n.id),
    tr: cls(n.id) };
  if (branchOf.has(n.id)) node.br = [...branchOf.get(n.id)].sort();
  if (planCodes.has(n.id)) node.pc = planCodes.get(n.id);
  graph.nodes[n.id] = node;
  graph.titleToId[n.title] = n.id;
}
const slimItem = it => ({ code: it.code, title: it.title, description: it.description, skills: it.skills });
const slimPlan = {
  core: { title: plan.core.title, domains: plan.core.domains.map(d => ({ id: d.id, name: d.name, items: d.items.map(slimItem) })) },
  readiness: plan.readiness ? { title: plan.readiness.title, stage: plan.readiness.stage, note: plan.readiness.note,
    domains: plan.readiness.domains.map(d => ({ id: d.id, name: d.name, items: d.items.map(slimItem) })) } : null,
  branches: plan.branches.map(b => ({ id: b.id, name: b.name, short: b.short, color: b.color,
    domains: b.domains.map(d => ({ id: d.id, name: d.name, items: d.items.map(slimItem) })) })),
};
const edges = [];
for (const n of cur.nodes) for (const p of n.hard_prereqs || []) edges.push([byId.get(p).title, n.title]);

let html = fs.readFileSync(GAME, 'utf8');
const before = html;
const replaceOnce = (re, text, label) => {
  const m = html.match(re);
  if (!m) { console.log(`ERROR could not find ${label} in math-dojo.html`); process.exit(1); }
  html = html.replace(re, () => text);   // function form: '$' in the data must not be read as a pattern
};

replaceOnce(/const MATH_CONNECTIONS = \[[\s\S]*?\n\];/,
  'const MATH_CONNECTIONS = [\n' +
  '    // GENERATED by tools/compile-dojo-graph.js from data/math_curriculum_v2.json\n' +
  '    // (hard prerequisites, [from, to] by curriculum title). Do not edit by hand.\n' +
  edges.map(([a, b]) => `    ${JSON.stringify([a, b]).replace(',', ', ')},`).join('\n').replace(/,$/, '') +
  '\n];', 'MATH_CONNECTIONS');

replaceOnce(/^const MATH_GRAPH_V2 = .*;$/m, 'const MATH_GRAPH_V2 = ' + JSON.stringify(graph) + ';', 'MATH_GRAPH_V2');

const planLine = 'const MATH_PLAN = ' + JSON.stringify(slimPlan) + ';';
if (/^const MATH_PLAN = .*;$/m.test(html)) {
  replaceOnce(/^const MATH_PLAN = .*;$/m, planLine, 'MATH_PLAN');
} else {
  html = html.replace(/^(const MATH_GRAPH_V2 = .*;)$/m, (all) => all +
    '\n// Graduation plan: 65 required core items + four branches. GENERATED by\n' +
    '// tools/compile-dojo-graph.js from data/math_graduation_plan.json; skills are graph node ids.\n' + planLine);
}

const counts = {};
for (const n of cur.nodes) counts[cls(n.id)] = (counts[cls(n.id)] || 0) + 1;
console.log(`${cur.nodes.length} skills: ` + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') + `; ${edges.length} prerequisite edges`);
if (shared.length) console.log(`branch items that core needs anyway (shown as core, still count for the branch): ${shared.join(', ')}`);
if (pulledIntoReadiness.length) console.log(`needed by readiness items, so classed readiness: ${pulledIntoReadiness.join(', ')}`);
if (CHECK) {
  if (html !== before) { console.log('math-dojo.html is out of date: run node tools/compile-dojo-graph.js'); process.exit(1); }
  console.log('math-dojo.html is up to date');
} else if (html !== before) {
  fs.writeFileSync(GAME, html);
  console.log('wrote games/math-dojo.html');
} else console.log('no change');
