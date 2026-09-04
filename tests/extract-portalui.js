const fs = require('fs');

const SRC = 'D:/LLCWork/student-portal/shared/config.js';
const OUT = './tests/portalui.js';

const src = fs.readFileSync(SRC, 'utf8');
const start = src.indexOf('class PortalUI {');
if (start < 0) throw new Error('class PortalUI not found');

const SQ = String.fromCharCode(39);   // '
const DQ = String.fromCharCode(34);   // "
const BT = String.fromCharCode(96);   // `
const BS = String.fromCharCode(92);   // backslash

let i = src.indexOf('{', start);
let depth = 0;
let end = -1;

for (; i < src.length; i++) {
  const c = src[i], n = src[i + 1];

  if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
  if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }

  if (c === SQ || c === DQ || c === BT) {
    const quote = c;
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === BS) i++;
      i++;
    }
    continue;
  }

  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}

if (end < 0) throw new Error('could not find the end of the class');
const cls = src.slice(start, end);
fs.writeFileSync(OUT, cls + '\nmodule.exports = PortalUI;\n');
console.log('extracted', cls.length, 'chars; tail:', JSON.stringify(cls.slice(-30)));
