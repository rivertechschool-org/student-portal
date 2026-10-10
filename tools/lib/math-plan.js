// How each math skill relates to the graduation plan. Shared by
// tools/compile-dojo-graph.js (the Dojo) and tools/compile-math-graph.js (the
// portal skill tree and its seed), so the two can never disagree about which
// skills are required.
//
//   core        listed under one of the 65 core items
//   readiness   listed under Stage 7 (66-73, College & Assessment Readiness),
//               or needed (at any depth) by one, and not core or foundation
//   foundation  not listed, but needed (at any depth) by a core skill, or an
//               unlisted elementary skill (Tier 4 and below)
//   branch      listed under a branch only, and not needed by core
//   enrichment  unlisted Tier 5-6 skill: optional practice at core level
//   beyond      unlisted Tier 7+: advanced electives
const fs = require('fs');
const path = require('path');

function loadPlan(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', 'math_graduation_plan.json'), 'utf8'));
}

function classify(nodes, plan) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const planCodes = new Map();
  const branchOf = new Map();
  const coreListed = new Set();
  const readyListed = new Set();
  const addCode = (id, code) => {
    if (!planCodes.has(id)) planCodes.set(id, []);
    if (!planCodes.get(id).includes(code)) planCodes.get(id).push(code);
  };
  for (const d of plan.core.domains) for (const it of d.items) for (const id of it.skills) {
    coreListed.add(id); addCode(id, it.code);
  }
  for (const d of (plan.readiness ? plan.readiness.domains : [])) for (const it of d.items) for (const id of it.skills) {
    readyListed.add(id); addCode(id, it.code);
  }
  for (const b of plan.branches) for (const d of b.domains) for (const it of d.items) for (const id of it.skills) {
    addCode(id, it.code);
    if (!branchOf.has(id)) branchOf.set(id, new Set());
    branchOf.get(id).add(b.id);
  }
  const coreClosure = new Set();
  const stack = [...coreListed];
  while (stack.length) {
    const id = stack.pop();
    if (coreClosure.has(id)) continue;
    coreClosure.add(id);
    for (const p of byId.get(id)?.hard_prereqs || []) stack.push(p);
  }
  const readyClosure = new Set();
  const rstack = [...readyListed];
  while (rstack.length) {
    const id = rstack.pop();
    if (readyClosure.has(id) || coreClosure.has(id)) continue;
    readyClosure.add(id);
    for (const p of byId.get(id)?.hard_prereqs || []) rstack.push(p);
  }
  const cls = id => {
    if (coreListed.has(id)) return 'core';
    if (coreClosure.has(id)) return 'foundation';
    if (readyClosure.has(id)) return 'readiness';
    if (branchOf.has(id)) return 'branch';
    const t = byId.get(id)?.dojo_tier || 0;
    return t <= 4 ? 'foundation' : t <= 6 ? 'enrichment' : 'beyond';
  };
  return { cls, planCodes, branchOf, coreListed, coreClosure, readyListed, readyClosure, byId };
}

module.exports = { loadPlan, classify };
