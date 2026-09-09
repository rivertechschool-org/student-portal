// Source files must not contain raw NUL bytes.
//
// Three files used U+0000 as a composite-key delimiter — a good choice, since
// it cannot occur in the data being joined — but wrote it as a LITERAL NUL in
// the source instead of an escape:
//
//     const key = (m.k === 'weak' ? 'weak' : 'miss') + '<literal NUL>' + shape;
//
// The code was correct and the site worked. The file, however, was no longer
// text. grep, ripgrep and most text tooling treat a NUL as the marker of a
// binary file: they stop reporting matches and print "Binary file ... matches"
// instead. That is a silent, partial answer, not an error.
//
// It cost real time. Searching portal/index.html for "school_events" returned
// nothing and the conclusion "the portal has no calendar" was drawn from it —
// wrong, because grep had stopped reading at byte 2,595,821 of 3,083,745.
// Roughly the last sixth of the file was invisible to every search. git also
// classified tools/dojo-skill-audit.js as binary and refused to diff it.
//
// The fix everywhere was to spell the same character as \u0000, which produces
// an identical string. Both audit tools emit byte-identical output afterwards.
//
// Run: node tests/no-nul-bytes.test.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.claude']);
// Only formats that are supposed to be text. Fonts, images and compiled
// artifacts legitimately contain NULs and are none of this test's business.
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json',
                          '.md', '.py', '.sql', '.txt', '.yml', '.yaml', '.svg']);

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(ROOT);
check('text files were found', files.length > 50, true);

const offenders = [];
for (const file of files) {
  const buf = fs.readFileSync(file);
  let count = 0, firstAt = -1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) { count++; if (firstAt === -1) firstAt = i; }
  }
  if (count) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const line = buf.subarray(0, firstAt).toString('utf8').split('\n').length;
    offenders.push(`${rel}: ${count} NUL byte(s), first at line ${line} — write it as \\u0000`);
  }
}

check(`no source file contains a raw NUL (${files.length} scanned)`, offenders, []);

// The escape has to be the same character, or this "fix" changed behaviour.
// Built with fromCharCode rather than an escape sequence, so that no
// editor, shell or tool between here and the file can quietly turn the
// escape back into a literal NUL - which is how this file first landed.
const NUL = String.fromCharCode(0);
check('the escape is one character', NUL.length, 1);
check('the escape is code point zero', NUL.charCodeAt(0), 0);
check('it still splits a joined key', ('weak' + NUL + 'shape').split(NUL), ['weak', 'shape']);

console.log(`\n  ${files.length} text files scanned`);
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
