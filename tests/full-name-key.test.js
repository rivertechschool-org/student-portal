// One spelling of "the name a search is matched against".
//
// Twelve screens built that string themselves, in three spellings. Three were
// null-safe. The other nine were not, and the difference is not cosmetic: a
// template literal turns a missing last name into the four characters "null"
// (or "undefined"), and string concatenation does the same. A pupil with one
// name absent got the haystack "ada null" - they stopped matching a search for
// their own name, and started matching a search for "null".
//
// The roster is not readable from here and does not need to be: the fixtures
// below are invented names chosen to reproduce the shapes that break - a
// missing surname, a missing first name, a name that is the empty string, one
// padded with stray spaces.
//
// Run tests/extract-portalui.js first - this reads its output.
let PortalUI;
try {
  PortalUI = require('./portalui.js');
} catch (e) {
  console.log('  run: node tests/extract-portalui.js');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};
const eq = (label, actual, expected) =>
  ok(label + ' -> "' + actual + '"', actual === expected);

console.log('\nthe ordinary case');

eq('both names', PortalUI.fullNameKey({ first_name: 'Marisol', last_name: 'Okonkwo' }),
   'marisol okonkwo');
eq('already lowercase', PortalUI.fullNameKey({ first_name: 'ada', last_name: 'vance' }),
   'ada vance');

console.log('\na missing name must not become the word "null"');

// This is the bug. Every one of these used to read "... null" or
// "undefined ...", which is both a miss for the real name and a hit for a
// search someone could actually type.
eq('no surname', PortalUI.fullNameKey({ first_name: 'Ada', last_name: null }), 'ada');
eq('surname undefined', PortalUI.fullNameKey({ first_name: 'Ada' }), 'ada');
eq('no first name', PortalUI.fullNameKey({ first_name: null, last_name: 'Vance' }), 'vance');
eq('neither', PortalUI.fullNameKey({}), '');
eq('empty strings', PortalUI.fullNameKey({ first_name: '', last_name: '' }), '');

ok('the word null never appears in a key',
   !PortalUI.fullNameKey({ first_name: 'Ada', last_name: null }).includes('null'));
ok('nor undefined',
   !PortalUI.fullNameKey({ first_name: undefined, last_name: 'Vance' }).includes('undefined'));

console.log('\nand the spacing has to survive it');

// With one name absent the naive version leaves a stray space at one end, so
// an exact or startsWith comparison against a typed name misses.
ok('no leading space when the first name is gone',
   PortalUI.fullNameKey({ last_name: 'Vance' })[0] !== ' ');
ok('no trailing space when the surname is gone',
   !PortalUI.fullNameKey({ first_name: 'Ada' }).endsWith(' '));
eq('inner whitespace collapses',
   PortalUI.fullNameKey({ first_name: '  Ada  ', last_name: '  Vance ' }), 'ada vance');
eq('a two-part surname keeps its single space',
   PortalUI.fullNameKey({ first_name: 'Ada', last_name: 'de la Vance' }), 'ada de la vance');

console.log('\nand a missing person is not a crash');

eq('null person', PortalUI.fullNameKey(null), '');
eq('undefined person', PortalUI.fullNameKey(undefined), '');
ok('a non-string name does not throw',
   PortalUI.fullNameKey({ first_name: 7, last_name: 9 }) === '7 9');

console.log('\nthe page stopped building it by hand');

{
  const calls = (SRC.match(/PortalUI\.fullNameKey\(/g) || []).length;
  ok('the screens call the helper (' + calls + ')', calls >= 12);

  const handBuilt = SRC.match(
    /first_name[^;\n]{0,24}(\+ ' ' \+|\} \$\{)[^;\n]{0,28}last_name[^;\n]{0,14}\}?`?\.toLowerCase\(\)/g) || [];
  ok('none is still spelled out' +
     (handBuilt.length ? ': ' + handBuilt[0] : ''),
     handBuilt.length === 0);
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
if (fail) process.exit(1);
