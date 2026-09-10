// Long class descriptions, shortened on the card with the rest a click away.
//
// A description is free text a teacher typed. Some run to a paragraph, and on a
// card - especially a phone, where the card is the width of the screen - that
// pushes the stats and buttons off the bottom.
//
// Four rules, each of which fails quietly rather than loudly:
//
//   * TRUNCATION IS BY CHARACTER COUNT, NOT A CSS CLAMP. A clamp cannot tell
//     the caller whether it clipped anything, so the "more" control would have
//     to appear on every description or be measured after paint. A count is
//     deterministic, identical at every width, and testable without a DOM.
//
//   * A SHORT DESCRIPTION IS LEFT COMPLETELY ALONE. No cut, no ellipsis, and
//     no control - otherwise every card grows a "more" that does nothing, and
//     the affordance stops meaning anything.
//
//   * THE FULL TEXT SHIPS WITH THE CARD. Expanding swaps which half is hidden
//     rather than going back for the text, so opening a description cannot
//     fail or lag.
//
//   * THE TOGGLE STOPS THE EVENT. Every one of these sits inside a card whose
//     own click opens the class. Without stopPropagation, reading a
//     description navigates away from the thing you were reading.
//
// Escaping is checked on both halves: the text is teacher-authored and lands
// in innerHTML, and it would be easy to escape the preview and forget the copy
// that is hidden until someone clicks.
//
// Run: node tests/class-description-truncate.test.js

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

// ---- extract the real methods -----------------------------------------
function method(name, indents = ['    ', '      ']) {
  for (const indent of indents) {
    for (const sig of [`\n${indent}async ${name}(`, `\n${indent}${name}(`]) {
      const start = html.indexOf(sig);
      if (start === -1) continue;
      const end = html.indexOf(`\n${indent}}\n`, start);
      if (end === -1) continue;
      const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
      const isAsync = body.startsWith('async ');
      const src = isAsync ? body.slice('async '.length) : body;
      return eval(`(${isAsync ? 'async ' : ''}function ${src.slice(name.length)})`);
    }
  }
  throw new Error(name + ' not found');
}

const app = {
  escapeHtml: method('escapeHtml'),
  classDescription: method('classDescription'),
  toggleClassDescription: method('toggleClassDescription'),
};
const render = (text, extra) => app.classDescription(text, extra);

const LONG = 'This class covers the whole of introductory chemistry, including '
  + 'stoichiometry, gas laws, thermochemistry and a weekly practical lab that '
  + 'meets on Thursday afternoons in the science room.';
const SHORT = 'Introductory chemistry with a weekly lab.';

// ---- nothing to say ----------------------------------------------------
console.log('\n== no description ==\n');

for (const [label, value] of [['empty string', ''], ['null', null],
                              ['undefined', undefined], ['only spaces', '   ']]) {
  const out = render(value);
  ok(`${label}: says so`, /No description</.test(out));
  ok(`${label}: marked as empty`, /class-desc-empty/.test(out));
  ok(`${label}: no control`, !/class-desc-toggle/.test(out));
}

// ---- a short one is untouched ------------------------------------------
console.log('\n== a short description is left alone ==\n');

let out = render(SHORT);
ok('the text is whole', out.includes(SHORT));
ok('no ellipsis', !out.includes('…'));
ok('no control', !/class-desc-toggle/.test(out));
ok('no id needed', !/ id="cd/.test(out));
ok('still carries the class', /class="class-desc"/.test(out));

// exactly at the limit
const exactly100 = 'x'.repeat(100);
out = render(exactly100);
ok('100 characters is not truncated', !/class-desc-toggle/.test(out));
out = render('x'.repeat(101));
ok('101 characters is', /class-desc-toggle/.test(out));

// ---- a long one is cut, and the rest travels with it -------------------
console.log('\n== a long description is cut ==\n');

out = render(LONG);
ok('a control appears', /class-desc-toggle[\s\S]*>more</.test(out));
ok('the preview ends in an ellipsis', /…<\/span>/.test(out));
ok('the full text ships too', out.includes(app.escapeHtml(LONG)));
ok('the full half starts hidden', /class="class-desc-rest" hidden/.test(out));
ok('the control reports collapsed', /aria-expanded="false"/.test(out));
ok('the toggle is wired to the id', /onclick="app\.toggleClassDescription\(event, 'cd\d+'\)"/.test(out));

const head = /class="class-desc-head">([^<]*)</.exec(out)[1];
ok('the preview is shorter than the whole', head.length < LONG.length);
ok('the preview is a prefix of the text', LONG.startsWith(head.replace('…', '')));
// The cut must not land inside a word. It is allowed to land on punctuation,
// because trailing punctuation is stripped so the preview reads "gas laws…"
// rather than "gas laws,…" - so what is checked is that the character AFTER
// the preview in the source is not a word character.
const bare = head.replace('…', '');
ok('the cut does not land mid-word', /[^\w]/.test(LONG[bare.length]));
ok('  and the preview itself ends on a word', /\w$/.test(bare));
ok('no trailing space or comma before the ellipsis', !/[\s,;:.!?-]…$/.test(head));

// a single unbroken token has no boundary to find
const url = 'https://example.com/' + 'a'.repeat(200);
out = render(url);
ok('an unbroken token is still cut', /class-desc-toggle/.test(out));
const urlHead = /class="class-desc-head">([^<]*)</.exec(out)[1];
ok('  and cut near the limit, not left whole', urlHead.length <= 102);

// ---- escaping ----------------------------------------------------------
console.log('\n== teacher text is escaped on both halves ==\n');

const nasty = '<img src=x onerror=alert(1)> ' + 'padding '.repeat(20) + '<b>end</b>';
out = render(nasty);
ok('no raw tag survives anywhere', !/<img|<b>/.test(out));
ok('the preview is escaped', /&lt;img/.test(out));
ok('the hidden half is escaped too', out.split('class-desc-rest')[1].includes('&lt;b&gt;end'));

out = render('Ampersands & "quotes" \'apostrophes\'');
ok('short text is escaped as well', /&amp;/.test(out));

// ---- ids are unique so two cards cannot fight --------------------------
console.log('\n== two long descriptions on one page ==\n');

const a = /id="(cd\d+)"/.exec(render(LONG))[1];
const b = /id="(cd\d+)"/.exec(render(LONG))[1];
ok('each render gets its own id', a !== b);

ok('an extra class is carried through', /class="class-desc list-item-meta"/.test(render(SHORT, 'list-item-meta')));
ok('  and on the truncated shape', /class="class-desc class-desc-sm"/.test(render(LONG, 'class-desc-sm')));

// ---- the toggle --------------------------------------------------------
console.log('\n== opening and closing ==\n');

function makeHost() {
  const head = { hidden: false };
  const rest = { hidden: true };
  const btn = { textContent: 'more', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const host = {
    querySelector: (sel) => sel === '.class-desc-head' ? head
      : sel === '.class-desc-rest' ? rest
      : sel === '.class-desc-toggle' ? btn : null,
  };
  global.document = { getElementById: (id) => (id === 'cd1' ? host : null) };
  return { head, rest, btn };
}

let stopped = 0, prevented = 0;
const ev = () => ({ stopPropagation: () => stopped++, preventDefault: () => prevented++ });

let d = makeHost();
app.toggleClassDescription(ev(), 'cd1');
check('opening shows the full text', d.rest.hidden, false);
check('  and hides the preview', d.head.hidden, true);
check('  and the control now offers less', d.btn.textContent, 'less');
check('  and reports expanded', d.btn.attrs['aria-expanded'], 'true');

app.toggleClassDescription(ev(), 'cd1');
check('closing hides the full text again', d.rest.hidden, true);
check('  and restores the preview', d.head.hidden, false);
check('  and the control offers more', d.btn.textContent, 'more');
check('  and reports collapsed', d.btn.attrs['aria-expanded'], 'false');

check('the card click is stopped every time', stopped, 2);
check('  and the default with it', prevented, 2);

makeHost();
let threw = false;
try { app.toggleClassDescription(ev(), 'nope'); } catch (e) { threw = true; }
check('an id that is not there does not throw', threw, false);

threw = false;
try { app.toggleClassDescription(null, 'cd1'); } catch (e) { threw = true; }
check('a missing event does not throw', threw, false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
