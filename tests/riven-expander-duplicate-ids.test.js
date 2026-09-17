// A "show all" toggle has to open the list it is standing next to.
//
// THE BUG THIS EXISTS FOR
//
// _briefingExpand used to mint an element id — `brf-<counter>-<length>` — and
// have the toggle find its hidden block with document.getElementById. The
// counter is an in-memory property on the app, so it restarts at 1 on every
// page load. The transcript does not restart: _restoreTerminalChat writes the
// saved HTML of the last 200 messages straight back into #terminal-output.
//
// So this morning's answer came back from localStorage still carrying
// `brf-1-17`, this afternoon's identical answer minted `brf-1-17` again, and
// getElementById handed back the FIRST one in document order — the restored
// bubble, far up the scroll. The tap expanded the old copy, off-screen, and
// flipped the label on the new one.
//
// Reported as: "show less appears and nothing else happens." That symptom has
// exactly one shape behind it. The handler ran to completion, so it found an
// element; nothing moved where the finger was, so the element it found was
// somewhere else.
//
// It never reproduced in a fresh page, because a fresh page holds one copy.
//
// WHAT IS ASSERTED
//
// Not "the ids are unique now" — that would be the same bet, placed again.
// The id is gone. The toggle reaches its block through previousElementSibling,
// which is the markup's own relationship and cannot be captured by anything
// else in the document. The tests below run the REAL shipped onclick source
// against a document that throws if it is touched at all.
//
// Run: node tests/riven-expander-duplicate-ids.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', i);
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  return new Function(args, html.slice(start + 1, i - 1));
}

const _briefingExpand = extract('_briefingExpand');

// Seventeen absences, ten shown — the day this was reported.
const LINES = [];
for (let i = 0; i < 17; i++) LINES.push(`<div class="row">Pupil ${i}</div>`);

// The app object the method is called on. It is deliberately bare: if the
// method ever reaches for per-instance state again (a counter, a seq, a
// registry), that is the thing this file exists to stop, and it will throw.
const app = new Proxy({}, {
  get(_t, prop) {
    if (prop === Symbol.toPrimitive || typeof prop === 'symbol') return undefined;
    throw new Error(`_briefingExpand reached for instance state: ${String(prop)}`);
  },
  set(_t, prop) {
    throw new Error(`_briefingExpand stored instance state: ${String(prop)}`);
  },
});

const render = () => _briefingExpand.call(app, LINES, 10, 'students', '');

// Pull the shipped handler source straight out of the markup, so what runs
// below is the code that ships and not a paraphrase of it.
function handlerSource(markup) {
  const m = markup.match(/onclick="([^"]*)"/);
  if (!m) throw new Error('no onclick in the rendered markup');
  return m[1];
}

// The smallest DOM that can tell the two failures apart: a toggle, the block
// it is standing next to, and a document that is not allowed to be consulted.
function makePair() {
  const block = { style: { display: 'none' } };
  const toggle = { previousElementSibling: block, textContent: '' };
  return { block, toggle };
}
const FORBIDDEN_DOCUMENT = new Proxy({}, {
  get(_t, prop) {
    throw new Error(`the toggle consulted the document: document.${String(prop)}`);
  },
});
function click(src, toggle) {
  // `document` is a parameter here, so it shadows the global for the handler.
  new Function('document', src).call(toggle, FORBIDDEN_DOCUMENT);
}

(async () => {

  console.log('\n== the id is gone, so it cannot collide ==\n');

  {
    const out = render();
    ok('nothing is addressed by id', !/\bid=/.test(out));
    ok('  and no brf- name survives anywhere', !/brf-/.test(out));
    ok('  the toggle reaches its block as a sibling',
       /previousElementSibling/.test(handlerSource(out)));
    ok('  and never through the document',
       !/getElementById|querySelector/.test(handlerSource(out)));
  }

  console.log('\n== the same answer twice in one transcript ==\n');

  {
    // This is the restore: the identical answer rendered before a reload and
    // again after it, both sitting in #terminal-output at once. Under the old
    // code both carried `brf-1-17`.
    const restored = render();
    const fresh = render();

    check('the two renders are byte-identical', restored === fresh, true);
    // Which is now harmless, and was the whole bug before.
    ok('  and share no id to be confused by', !/\bid=/.test(restored + fresh));

    // Each one gets its own pair of elements, as the real document would.
    const older = makePair();
    const newer = makePair();
    const src = handlerSource(fresh);

    click(src, newer.toggle);

    // THE ONE THAT WAS WRONG. Under getElementById this opened `older`.
    check('tapping the new toggle opens the new block', newer.block.style.display, 'block');
    check('  and leaves the restored one shut', older.block.style.display, 'none');
    check('  the label follows the block it actually opened', newer.toggle.textContent, 'show less');
    check('  the restored toggle says nothing new', older.toggle.textContent, '');
  }

  console.log('\n== and it closes again ==\n');

  {
    const out = render();
    const src = handlerSource(out);
    const { block, toggle } = makePair();

    click(src, toggle);
    check('open', block.style.display, 'block');
    click(src, toggle);
    check('shut again', block.style.display, 'none');
    check('  with the count back on the label', toggle.textContent,
          '…and 7 more students — show all');
    click(src, toggle);
    check('and open a second time', block.style.display, 'block');
  }

  console.log('\n== a list that fits is left alone ==\n');

  {
    const out = _briefingExpand.call(app, LINES.slice(0, 4), 10, 'students', '');
    ok('no toggle when there is nothing to hide', !/onclick/.test(out));
    ok('  and every line is there', (out.match(/class="row"/g) || []).length === 4);
  }

  console.log('\n== the label counts what is hidden ==\n');

  {
    const out = _briefingExpand.call(app, LINES, 10, 'students', '');
    ok('seventeen minus ten is seven', /and 7 more students/.test(out));
    const shown = out.slice(0, out.indexOf('<div style="display: none;">'));
    check('ten are shown before the fold', (shown.match(/class="row"/g) || []).length, 10);
    const hidden = out.slice(out.indexOf('<div style="display: none;">'));
    check('  and seven behind it', (hidden.match(/class="row"/g) || []).length, 7);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
