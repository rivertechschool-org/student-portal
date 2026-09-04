// Pull the PortalUI class out of shared/config.js so it can be tested in node.
//
//     node tests/extract-portalui.js && node tests/notifications.test.js
//
// Finding the end of the class by brace-counting looks obvious and does not
// work: the class contains regex literals with quote characters in them
// (/[&<>"']/g), and any scanner that treats a quote as the start of a string
// runs off the end of the file. Rather than write a JS lexer for a test helper,
// this walks the candidate end lines and keeps the first slice node can parse.

const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const SRC = path.join(__dirname, '..', 'shared', 'config.js');
const OUT = path.join(__dirname, 'portalui.js');
const TMP = path.join(__dirname, '.portalui-candidate.js');

const src = fs.readFileSync(SRC, 'utf8');
const start = src.indexOf('class PortalUI {');
if (start < 0) throw new Error('class PortalUI not found in shared/config.js');

const lines = src.slice(start).split('\n');
let acc = '';
let found = null;

for (let i = 0; i < lines.length; i++) {
  acc += lines[i] + '\n';
  if (lines[i] !== '}') continue;          // only a column-0 brace can close it
  fs.writeFileSync(TMP, acc + '\nmodule.exports = PortalUI;\n');
  try {
    cp.execSync(`node --check "${TMP}"`, { stdio: 'pipe' });
    found = i;
    break;
  } catch (e) {
    // Not the end of the class - an earlier column-0 } inside it. Keep going.
  }
}

if (found === null) {
  try { fs.unlinkSync(TMP); } catch (e) {}
  throw new Error('could not find a parseable end to class PortalUI');
}

fs.renameSync(TMP, OUT);
console.log(`extracted PortalUI (${acc.length} bytes) -> ${path.relative(process.cwd(), OUT)}`);
