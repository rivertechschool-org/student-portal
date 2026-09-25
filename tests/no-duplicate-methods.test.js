// No method may be defined twice in the same class.
//
// This exists because of a real bug that shipped and sat there.
//
// `parseCSV` was defined twice on ClassesPortalApp. A class body keeps only
// the LAST definition, so the second silently replaced the first:
//
//   first  -> { headers: [...], rows: [ {..}, {..} ] }   the student importer
//   second -> a plain 2D array                           the class-sheets grid
//
// handleCSVFileSelect does `parsed.rows.length`. Against a plain array that
// throws, so choosing a CSV to import students died on its first line. Nothing
// in the file looked wrong: both definitions were correct, both were sensible,
// and the one that was wrong for the caller was invisible because JS never
// complains about a redefinition.
//
// Two more were hiding the same way: `toggleGradeOverride` (two DIFFERENT
// bodies, the earlier one dead) and `escapeHtml` (identical, harmless).
//
// A duplicate is never intentional here, so this test does not care what the
// methods do - only that each name appears once per class.
//
// Run: node tests/no-duplicate-methods.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- find each class and the methods declared directly inside it ----------
//
// Per class, not per file: three classes live in this page and the same helper
// name appearing once in each is fine.
function classes() {
  const out = [];
  const re = /\n\s*class\s+([A-Za-z_$][\w$]*)[^{]*\{/g;
  let m;
  while ((m = re.exec(html))) {
    let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    out.push({ name: m[1], start: m.index, end: i });
  }
  return out;
}

// A member declaration, not a call: indented, optionally async, ends in `{`
// on the same line. `if (`, `for (`, `while (`, `switch (`, `catch (` and
// bare calls are excluded so they are not read as members.
const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'function',
  'return', 'else', 'do', 'with', 'typeof', 'new', 'await', 'yield']);

function membersOf(cls) {
  const body = html.slice(cls.start, cls.end);
  const startLine = html.slice(0, cls.start).split('\n').length;
  const seen = new Map();
  body.split('\n').forEach((line, idx) => {
    // Two shapes: a method opened on this line, and one written entirely on
    // it. Missing the second would let `foo() { return 1; }` shadow a real
    // method invisibly - which is exactly the failure being guarded against,
    // so only catching the multi-line form would be a guard with a hole in it.
    const m = /^ {2,8}(?:async\s+|\*\s*|static\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/.exec(line)
           || /^ {2,8}(?:async\s+|\*\s*|static\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{.*\}\s*$/.exec(line);
    if (!m) return;
    const name = m[1];
    if (NOT_A_METHOD.has(name)) return;
    if (!seen.has(name)) seen.set(name, []);
    seen.get(name).push(startLine + idx);
  });
  return seen;
}

(async () => {

  console.log('\n== no name is declared twice in one class ==\n');

  const found = classes();
  ok('the page\'s classes were located', found.length >= 1);

  let dupes = [];
  for (const cls of found) {
    for (const [name, lines] of membersOf(cls)) {
      if (lines.length > 1) dupes.push(`${cls.name}.${name} at lines ${lines.join(', ')}`);
    }
  }

  if (dupes.length) {
    console.log('  the later definition of each of these silently wins:');
    dupes.forEach(d => console.log('    ' + d));
  }
  check('no method is declared twice', dupes, []);

  console.log('\n== and the one that broke: parseCSV ==\n');

  // Behavioural, because "it is defined once" is not the property the importer
  // needs - it needs the shape.
  function lift(name) {
    const re = new RegExp('\\n {2,8}(?:async )?' + name + '\\s*\\(([^)]*)\\)\\s*\\{');
    const m = re.exec(html);
    if (!m) throw new Error(name + ' not found');
    let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
    const start = i;
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return new Function(m[1], html.slice(start + 1, i - 1));
  }

  const CSV = 'First Name,Last Name,Grade\nMarisol,Vance,4\nTeodor,Ilic,6\n';

  {
    const parseCSV = lift('parseCSV');
    const parsed = parseCSV.call({}, CSV);
    ok('the importer gets an object, not a bare array', !Array.isArray(parsed));
    ok('  with headers', Array.isArray(parsed.headers));
    // THE line that threw: handleCSVFileSelect does parsed.rows.length.
    check('  and rows it can count', parsed.rows.length, 2);
    check('  keyed by header, which the import maps by name',
          parsed.rows[0]['First Name'], 'Marisol');
  }

  {
    // The sheets grid still wants raw rows, and now has its own name.
    const grid = lift('_parseSheetGrid');
    const rows = grid.call({}, CSV);
    ok('the sheets parser still returns a plain grid', Array.isArray(rows));
    check('  header row included, because a sheet has no headers', rows[0][0], 'First Name');
  }

  ok('the sheets caller uses the renamed one',
     /this\._sheetData = this\._parseSheetGrid\(/.test(html));
  ok('  and nothing else calls parseCSV expecting a grid',
     (html.match(/this\.parseCSV\(/g) || []).length === 1);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
