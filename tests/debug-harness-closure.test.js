// The debug-tools harnesses must extract everything they will end up calling.
//
// Those harnesses do not import Riven — there is nothing to import. They brace-
// match named methods straight out of portal/index.html, bind them to a stub
// `app`, and run them. That is the right design: there is no drift between the
// harness and what ships. It has one failure mode, and it is silent.
//
// When a method grows a new `this._something()` call, every harness that
// extracts that method needs `_something` in its list too. Miss it and the
// harness does not fail an assertion — it dies mid-run with
//
//     TypeError: this._rivenMatchGroup is not a function
//
// and if nobody runs it that week, it simply stays dead. phrasebook.js was dead
// on main for exactly this reason: _extractEntities had grown four dependencies
// since the harness was written, and a dead harness reports no failures at all,
// which reads a lot like passing.
//
// So: for each harness, walk the transitive closure of `this._x()` calls from
// the methods it extracts, and require every reachable method to be accounted
// for.
//
// A harness that writes its OWN version of a method cuts that branch — the real
// body never runs, so its callees are not needed. rt-surface.js does this with
// _showRivenMessage, deliberately, to capture the HTML instead of rendering it.
// That is why "accounted for" means *named anywhere in the harness*, not
// *listed for extraction*.
//
// Run: node tests/debug-harness-closure.test.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- index every method at Riven's class-body indent --------------------
// Same brace walk the harnesses use, so "found" here means "extractable there".
const DEF = /\n {4}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const bodies = new Map();
for (let m = DEF.exec(src); m; m = DEF.exec(src)) {
  const name = m[1];
  if (bodies.has(name)) continue;          // first definition wins, as in the harnesses
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  i = src.indexOf('{', i);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  bodies.set(name, src.slice(start, i));
}

ok('the portal methods were indexed', bodies.size > 400);
ok('  including the ones the harnesses lean on',
  ['_extractEntities', '_fuzzyFindStudent', '_matchIntent'].every(n => bodies.has(n)));

const CALL = /this\.(_[A-Za-z0-9_]+)\s*\(/g;
const callsIn = (name) => {
  const out = new Set();
  const body = bodies.get(name) || '';
  for (let m = CALL.exec(body); m; m = CALL.exec(body)) out.add(m[1]);
  return out;
};

// ---- every harness ------------------------------------------------------
console.log('\n== each harness extracts its whole call graph ==\n');

const harnesses = fs.readdirSync(path.join(root, 'debug-tools'))
  .filter(f => f.endsWith('.js'))
  .sort();

ok('the harness directory was found', harnesses.length > 5);

let checked = 0;
for (const file of harnesses) {
  const text = fs.readFileSync(path.join(root, 'debug-tools', file), 'utf8');

  // Quoted names are what the harness asks to be extracted from the real file.
  const listed = new Set(
    [...text.matchAll(/'(_[A-Za-z0-9_]+)'/g)].map(m => m[1]).filter(n => bodies.has(n)));
  if (!listed.size) continue;               // not an extraction harness
  checked++;

  const missing = new Set();
  const seen = new Set();
  const stack = [...listed];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const callee of callsIn(name)) {
      if (!bodies.has(callee)) continue;                 // not a method of this class
      if (listed.has(callee)) { stack.push(callee); continue; }
      // Named somewhere in the harness: it supplies its own, and that branch
      // stops here rather than reaching further into the real code.
      if (new RegExp('\\b' + callee + '\\b').test(text)) continue;
      missing.add(callee);
    }
  }

  check(`${file} (${listed.size} extracted)`, [...missing].sort(), []);
}

ok('several harnesses were actually checked', checked >= 8);

// ---- and they still run -------------------------------------------------
// The closure check is static. A harness can satisfy it and still be broken, so
// confirm the one that was dead is genuinely alive again.
console.log('\n== the harness that was dead is running ==\n');

const { spawnSync } = require('child_process');
const r = spawnSync(process.execPath, [path.join(root, 'debug-tools', 'phrasebook.js')],
  { encoding: 'utf8', timeout: 120000 });
check('phrasebook.js exits clean', r.status, 0);
ok('  and reports real checks', /PASS — \d+ checks, 0 failed/.test(r.stdout || ''));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
