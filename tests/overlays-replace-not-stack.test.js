// An overlay that does not replace itself stacks.
//
// Fourteen screens on this page build their own full-window overlay rather
// than going through showModal(). That is a deliberate choice - they are
// full-bleed layouts, not the standard dialog box - but showModal() does one
// thing for free that a hand-rolled overlay has to do for itself: when a modal
// with the same id is already open, it removes it instead of putting a second
// one on top.
//
// The button that opened the overlay is still on the page underneath it. Click
// it twice and an unguarded overlay appears twice; dismiss the top one and the
// one below is still there, holding whatever had been typed into it. Thirteen
// of the fourteen already guarded. showCSVImportModal did not.
//
// This does not ask them to become showModal() calls - converting them would
// change how they look for no behavioural gain. It asks each one to keep the
// single guarantee that matters.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

// Brace-match every method, starting the body scan after the argument list so
// a default parameter's object literal cannot close it early.
function methods(text) {
  const lines = text.split('\n');
  const out = [];
  lines.forEach((l, i) => {
    const m = /^( {4}| {6})(?:async\s+|static\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/.exec(l);
    if (!m) return;
    if (['if', 'for', 'while', 'switch', 'catch'].includes(m[2])) return;
    const off = lines.slice(0, i).join('\n').length + (i ? 1 : 0);
    let p = off, d = 0, sig = -1;
    for (; p < text.length; p++) {
      if (text[p] === '(') d++;
      else if (text[p] === ')') { d--; if (d === 0) { sig = p; break; } }
    }
    let j = text.indexOf('{', sig); d = 0;
    for (; j < text.length; j++) {
      if (text[j] === '{') d++;
      else if (text[j] === '}') { d--; if (d === 0) { j++; break; } }
    }
    out.push({ name: m[2], line: i + 1, body: text.slice(off, j) });
  });
  return out;
}

// A full-window overlay: pinned to all four edges and put on the body.
const PINNED = /position:\s*fixed;\s*top:\s*0;\s*left:\s*0;\s*right:\s*0;\s*bottom:\s*0/;
const overlays = [];
for (const m of methods(SRC)) {
  if (!PINNED.test(m.body)) continue;
  if (!/document\.body\.appendChild/.test(m.body)) continue;
  const id = (m.body.match(/\.id\s*=\s*'([a-z0-9-]+)'/) || [, null])[1];
  overlays.push({ ...m, id });
}

console.log('\nevery hand-rolled overlay is findable and replaceable');

ok('the overlays were found at all', overlays.length >= 10);

const anonymous = overlays.filter(o => !o.id).map(o => o.name);
// Without an id there is nothing to look up, so it cannot guard even in
// principle - and nothing else can close it either.
ok('every overlay gives itself an id' +
   (anonymous.length ? ': MISSING on ' + anonymous.join(', ') : ''),
   anonymous.length === 0);

console.log('\nand replaces an open copy of itself rather than stacking one');

const unguarded = [];
for (const o of overlays) {
  if (!o.id) continue;
  // The guard is two statements more often than one - look the overlay up,
  // then remove it on the next line - so match across a short gap rather than
  // demanding `.remove` be adjacent.
  const byId = new RegExp(
    `(?:getElementById\\('${o.id}'\\)|querySelector\\('#${o.id}'\\))[\\s\\S]{0,160}?\\.remove\\(\\)`);
  if (!byId.test(o.body)) unguarded.push(o.name + ' (#' + o.id + ')');
}
ok('none of the ' + overlays.length + ' can open twice' +
   (unguarded.length ? ': UNGUARDED ' + unguarded.join(', ') : ''),
   unguarded.length === 0);

console.log('\nthe one that shipped unguarded, named so a regression says which');
{
  const csv = overlays.find(o => o.name === 'showCSVImportModal');
  ok('showCSVImportModal is still an overlay', !!csv);
  if (csv) {
    const guard = csv.body.indexOf("getElementById('csv-import-modal-overlay')");
    const build = csv.body.indexOf("createElement('div')");
    ok('  it looks for an open copy', guard > -1);
    // Order matters: removing it after building the new one would take the new
    // one out, since they share an id.
    ok('  before it builds the new one', guard > -1 && build > -1 && guard < build);
  }
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
if (fail) process.exit(1);
