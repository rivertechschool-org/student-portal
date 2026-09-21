// Running a per-pupil call a few at a time.
//
// The two grade screens call an RPC that takes ONE enrolment, once per pupil.
// They awaited it inside a for loop, so a class of 25 paid 25 round-trip
// latencies in series before anything rendered at all. The RPC cannot be
// batched from the client — that is a server change and belongs in the other
// repo — but the waiting does not have to be sequential.
//
// `PortalUI.mapLimit(items, limit, fn)` runs them concurrently with a cap. The
// cap matters as much as the concurrency: a class of forty should not open
// forty sockets at once, and "just use Promise.all" is how that happens.
//
// Three properties this file exists to hold:
//   * the cap is never exceeded, at any list length
//   * results come back in the ORDER of the input, not of completion
//   * one failure does not lose the other pupils' grades — which is exactly
//     what the try/catch inside each original loop already said
//
// Run: node tests/map-limit.test.js

const fs = require('fs');
const path = require('path');

const config = fs.readFileSync(path.join(__dirname, '..', 'shared', 'config.js'), 'utf8');
const portal = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Lift the real static method out of config.js.
function staticSource(name) {
  const re = new RegExp(`\\n {4}static (?:async )?${name}\\s*\\(`);
  const m = re.exec(config);
  if (!m) throw new Error(name + ' not found in shared/config.js');
  let i = config.indexOf('{', m.index + m[0].length - 1), depth = 0;
  for (; i < config.length; i++) {
    if (config[i] === '{') depth++;
    else if (config[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return config.slice(m.index, i);
}

const PortalUI = new Function(`"use strict"; return class PortalUI { ${staticSource('mapLimit')} };`)();

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {

  console.log('\n== it actually runs them at once ==\n');

  {
    let running = 0, peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await PortalUI.mapLimit(items, 5, async (n) => {
      running++; peak = Math.max(peak, running);
      await wait(5);
      running--;
      return n;
    });
    check('the cap is respected', peak <= 5, true);
    ok(`  and is actually reached (peak ${peak})`, peak === 5);
  }

  {
    // A list shorter than the cap must not spin up idle workers forever.
    let peak = 0, running = 0;
    await PortalUI.mapLimit([1, 2], 8, async (n) => {
      running++; peak = Math.max(peak, running);
      await wait(2); running--; return n;
    });
    check('a short list only starts as many as it needs', peak, 2);
  }

  {
    const t0 = Date.now();
    await PortalUI.mapLimit(Array.from({ length: 12 }, (_, i) => i), 6, async () => wait(20));
    const elapsed = Date.now() - t0;
    // Sequential would be ~240ms; two waves of six is ~40ms. Generous bound so
    // this does not flake on a loaded machine — it is the shape being checked.
    ok(`twelve jobs of 20ms in two waves, not twelve (${elapsed}ms)`, elapsed < 150);
  }

  console.log('\n== order survives ==\n');

  {
    // Deliberately finish backwards: the first item is the slowest.
    const items = [50, 30, 10, 1];
    const out = await PortalUI.mapLimit(items, 4, async (ms) => { await wait(ms); return ms; });
    check('results are in input order, not completion order',
          out.map(r => r.value), [50, 30, 10, 1]);
  }

  {
    const out = await PortalUI.mapLimit(['a', 'b', 'c'], 2, async (v, i) => `${i}:${v}`);
    check('the callback gets the index too', out.map(r => r.value), ['0:a', '1:b', '2:c']);
  }

  console.log('\n== one bad row does not lose the rest ==\n');

  {
    const out = await PortalUI.mapLimit([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error('that enrolment is broken');
      return n * 10;
    });
    check('the good ones all came back', out.filter(r => r.ok).map(r => r.value), [10, 30, 40]);
    check('  and the bad one is reported, not thrown', out[1].ok, false);
    check('  with its reason', out[1].error.message, 'that enrolment is broken');
  }

  {
    // The whole call must not reject — the grade screen wants to draw.
    let threw = false;
    try {
      await PortalUI.mapLimit([1, 2], 2, async () => { throw new Error('nope'); });
    } catch (e) { threw = true; }
    check('mapLimit itself never rejects', threw, false);
  }

  console.log('\n== edges ==\n');

  check('an empty list is fine', (await PortalUI.mapLimit([], 4, async () => 1)).length, 0);
  check('undefined is fine', (await PortalUI.mapLimit(undefined, 4, async () => 1)).length, 0);
  check('a limit of zero still makes progress',
        (await PortalUI.mapLimit([1, 2], 0, async (n) => n)).map(r => r.value), [1, 2]);

  console.log('\n== the grade screens use it ==\n');

  {
    const uses = (portal.match(/PortalUI\.mapLimit\(/g) || []).length;
    check('all four per-pupil loops were converted', uses, 4);

    // The shape that was replaced must not come back.
    const seq = [...portal.matchAll(
      /for \(const enrollment of [^)]+\) \{[\s\S]{0,400}?await window\.app\.auth\.supabase\.rpc\('calculate_/g)];
    check('no per-enrolment RPC is awaited in a bare loop any more', seq.length, 0);
  }

  {
    // Adding a method to the shared file means a stale cached copy would throw
    // on the first gradebook open, so every page has to ask for a new one.
    const pages = ['index.html', 'confirm.html', 'reset.html', 'portal/index.html'];
    const versions = new Set(pages.map(p =>
      (fs.readFileSync(path.join(__dirname, '..', p), 'utf8').match(/config\.js\?v=(\d+)/) || [])[1]));
    check('every page pins one config.js version', versions.size, 1);
    ok(`  and it moved past 18 when mapLimit was added (v=${[...versions][0]})`,
       Number([...versions][0]) >= 19);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
