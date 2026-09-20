// The guides have to keep the promises they make.
//
// /guides/, /parents/, /students/, /teachers/ and /admin/ are ordinary static
// pages with no build step and no framework, which means nothing catches a
// broken anchor, a dead link, a stray unclosed tag or a mock-up that quietly
// lost its caption. This file is that catch.
//
// The caption rule is the one that matters most and is the least obvious. Every
// "here is what you will see" block is the portal REBUILT IN CSS with invented
// names in it, never a screenshot — a screenshot of the working portal carries a
// real family's name, and this repo is served verbatim to anyone who asks for
// it. The caption under each one is what tells the reader the names are made up.
// A mock-up without a caption is how that discipline erodes.
//
// Run: node tests/guides.test.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Every guide, and the accent each declares. The hub has no data-guide of its
// own because it is the index, not one of them.
const GUIDES = [
  { dir: 'guides',   role: null,       name: 'the hub' },
  { dir: 'parents',  role: 'parents',  name: 'parent guide' },
  { dir: 'students', role: 'students', name: 'student guide' },
  { dir: 'teachers', role: 'teachers', name: 'teacher guide' },
  { dir: 'admin',    role: 'admin',    name: 'admin guide' }
];

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

// A tag-balance walk. Not a parser — enough to catch the class of mistake that
// silently swallows half a page.
function unbalanced(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const stack = [];
  const errs = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(body))) {
    const [, closing, tag, selfClose] = m;
    const t = tag.toLowerCase();
    if (VOID.has(t) || selfClose === '/') continue;
    if (!closing) stack.push(t);
    else if (!stack.length) errs.push(`stray </${t}>`);
    else if (stack[stack.length - 1] === t) stack.pop();
    else { errs.push(`</${t}> closed while <${stack[stack.length - 1]}> was open`); stack.pop(); }
  }
  return errs.concat(stack.map(t => `<${t}> never closed`));
}

const files = {};
for (const g of GUIDES) {
  const p = path.join(root, g.dir, 'index.html');
  files[g.dir] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

console.log('\n== every guide exists and is whole ==\n');

for (const g of GUIDES) {
  const html = files[g.dir];
  ok(`/${g.dir}/ exists`, html !== null);
  if (!html) continue;
  check(`  ${g.name} is well formed`, unbalanced(html), []);
  ok(`  has a <title>`, /<title>[^<]{4,}<\/title>/.test(html));
  ok(`  has a one-line description`, /<meta name="description" content="[^"]{20,}"/.test(html));
  ok(`  uses the shared stylesheet`, /href="\/guides\/guide\.css/.test(html));
  ok(`  carries no inline <style> block`, !/<style[^>]*>/.test(html));
  if (g.role) ok(`  declares data-guide="${g.role}"`, new RegExp(`<body data-guide="${g.role}"`).test(html));
}

console.log('\n== every mock-up says the names are invented ==\n');

for (const g of GUIDES) {
  const html = files[g.dir];
  if (!html) continue;
  // Count the shots, then count the captions that follow one.
  const shots = (html.match(/<div class="shot">/g) || []).length;
  if (shots === 0) { console.log(`      (${g.name}: no mock-ups)`); continue; }
  const captioned = (html.match(/<\/div>\s*<p class="caption">/g) || []).length;
  check(`${g.name}: all ${shots} mock-ups are captioned`, captioned, shots);
  ok(`  and it says somewhere that the names are made up`,
     /invented|made up|Example only/i.test(html));
}

console.log('\n== no link points at nothing ==\n');

for (const g of GUIDES) {
  const html = files[g.dir];
  if (!html) continue;

  // In-page anchors must have a target on the same page.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
  const deadAnchors = [...new Set(anchors)].filter(a => a !== 'top' && !ids.has(a));
  check(`${g.name}: every #anchor has a target`, deadAnchors, []);

  // Site-relative links must resolve to a real file or directory.
  const hrefs = [...new Set([...html.matchAll(/href="(\/[^"#?]*)/g)].map(m => m[1]))]
    .filter(h => !h.startsWith('//'));
  const dead = hrefs.filter(h => {
    const clean = h.replace(/\?.*$/, '');
    const asFile = path.join(root, clean);
    const asIndex = path.join(root, clean, 'index.html');
    return !fs.existsSync(asFile) && !fs.existsSync(asIndex);
  });
  check(`  every site link resolves`, dead, []);
}

console.log('\n== the hub reaches all four, and all four come back ==\n');

{
  const hub = files['guides'];
  if (hub) {
    for (const g of GUIDES.filter(x => x.role)) {
      ok(`the hub links /${g.dir}/`, new RegExp(`href="/${g.dir}/"`).test(hub));
    }
  }
  for (const g of GUIDES.filter(x => x.role)) {
    const html = files[g.dir];
    if (!html) continue;
    ok(`${g.name} offers a way back to the sign-in page`, /href="(\/|https:\/\/rivertech\.me\/)"/.test(html));
  }
}

console.log('\n== the shared stylesheet ==\n');

{
  const css = fs.readFileSync(path.join(root, 'guides', 'guide.css'), 'utf8');

  // Dark is the default; the light block may only REDEFINE tokens. A colour
  // whose single definition lives inside the media query is the classic
  // unreadable-page bug: it never applies in the un-stamped state.
  // Leading whitespace allowed on purpose: this block was lifted out of an
  // inline <style> and was indented four spaces at first. Anchored at column
  // zero, the match silently found nothing and every token looked light-only.
  const baseRoot = (css.match(/^[ \t]*:root\s*\{([\s\S]*?)\}/m) || [, ''])[1];
  const baseTokens = new Set([...baseRoot.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  const lightBlock = (css.match(/@media \(prefers-color-scheme: light\)\s*\{([\s\S]*?)\n\s*\}\s*\n/m) || [, ''])[1];
  const lightTokens = [...lightBlock.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);
  const onlyInLight = [...new Set(lightTokens)].filter(t => !baseTokens.has(t));
  check('every token is defined in the bare :root first', onlyInLight, []);

  ok('the light override is guarded against an explicit dark choice',
     /:root:not\(\[data-theme="dark"\]\)/.test(css));
  ok('body paints its own background', /body\s*\{[^}]*background:\s*var\(--bg\)/.test(css));

  // Each role accent has to exist in both themes, or one of them inherits blue.
  for (const role of ['students', 'teachers', 'admin']) {
    const dark = new RegExp(`body\\[data-guide="${role}"\\]\\s*\\{[^}]*--accent:`).test(css);
    const light = new RegExp(`:root:not\\(\\[data-theme="dark"\\]\\) body\\[data-guide="${role}"\\]\\s*\\{[^}]*--accent:`).test(css);
    ok(`${role} has an accent for the dark theme`, dark);
    ok(`  and one for the light theme`, light);
  }

  // The mock-ups draw the real portal, so its button gradient is fixed and must
  // not be swapped for the per-role accent.
  ok('mock-up buttons keep the portal\'s own gradient',
     /\.ui-btn\.primary\s*\{[^}]*linear-gradient\(135deg, #6aa9ff, #8bffb0\)/.test(css));

  // The lead-in rule must not catch inline bold inside a callout.
  ok('only the callout lead-in is a block', /\.note > b:first-child \{ display: block/.test(css));
  check('  and the unscoped rule is gone', /\.note b \{ display: block/.test(css), false);
}

console.log('\n== the portal points at them ==\n');

{
  const landing = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const portal = fs.readFileSync(path.join(root, 'portal', 'index.html'), 'utf8');
  ok('the sign-in page links a guide', /href="\/parents\/"/.test(landing));
  ok('the portal links a guide', /\/(parents|guides|students|teachers|admin)\//.test(portal));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
