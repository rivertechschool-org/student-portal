// One loading state instead of twenty-nine copies of it.
//
// The same spinner markup was written out by hand at every screen that loads
// something, byte for byte, so changing how loading looks meant finding all of
// them. PortalUI.spinner() is that markup, once.
//
// Two things this test is careful about:
//
//   * It does NOT ask every remaining spinner to go through the helper. The
//     styled variants - a muted or margin-topped <p> - are deliberately left
//     alone, because folding them in would change how those screens look, and
//     a cleanup that quietly restyles things is not a cleanup.
//
//   * The helper escapes its message. Most callers pass a literal, but the
//     point of having one is that the next caller can pass a class or subject
//     name, and those come from the database.
//
// Run tests/extract-portalui.js first - this reads its output.
const fs = require('fs');
const path = require('path');

// tests/portalui.js is generated from shared/config.js and deliberately not
// committed, so a missing copy means the extraction step was skipped.
let PortalUI;
try {
  PortalUI = require('./portalui.js');
} catch (e) {
  console.log('  run `node tests/extract-portalui.js` first');
  process.exit(1);
}

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

console.log('\nthe helper renders the markup it replaced');

{
  const html = PortalUI.spinner('Loading students...');
  ok('it is a centred, padded box', /^<div style="text-align: center; padding: 40px;">/.test(html));
  ok('  holding the spinner', html.includes('<div class="loading-spinner"></div>'));
  ok('  and the message in a bare <p>', html.includes('<p>Loading students...</p>'));
  ok('  closed properly', html.trim().endsWith('</div>'));
}

{
  ok('the padding is a parameter', PortalUI.spinner('x', 20).includes('padding: 20px;'));
  ok('  defaulting to 40', PortalUI.spinner('x').includes('padding: 40px;'));
  // A caller that passes something odd should still get a valid declaration.
  // Checking the output merely lacks the string "NaN" is not that check: an
  // unguarded `padding: ${pad}px` renders "padding: widepx", which has no NaN
  // in it and is just as broken. The padding has to BE a number.
  ok('  and a junk padding still renders a number',
     /padding: \d+px;/.test(PortalUI.spinner('x', 'wide')));
  ok('  as does an undefined one',
     /padding: \d+px;/.test(PortalUI.spinner('x', undefined)));
}

{
  ok('it has a default message', PortalUI.spinner().includes('<p>Loading...</p>'));
}

console.log('\nand escapes what it is given');

{
  // The reason to have one place for this: the next caller passes a name from
  // the database, not a literal.
  const html = PortalUI.spinner('Loading <script>alert(1)</script>...');
  ok('a tag in the message cannot open a tag',
     !html.includes('<script>'));
  ok('  it is escaped instead', html.includes('&lt;script&gt;'));
  ok('an ampersand survives as an entity',
     PortalUI.spinner('Art & Design').includes('Art &amp; Design'));
}

console.log('\nthe page uses it');

{
  const calls = (SRC.match(/PortalUI\.spinner\(/g) || []).length;
  ok('at least 26 screens call the helper (' + calls + ')', calls >= 26);

  // The identical copies are gone. What is left is the styled variants, which
  // are meant to be left alone - so this is a ceiling, not a count of zero.
  const bare = (SRC.match(
    /innerHTML\s*=\s*'<div style="text-align: center; padding: \d+px;">\s*<div class="loading-spinner"><\/div>\s*<p>[^<']*<\/p>/g) || []).length;
  ok('no byte-identical copy is left to drift (' + bare + ')', bare === 0);
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
if (fail) process.exit(1);
