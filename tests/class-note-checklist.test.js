// Checklists in class notes and checkboxes in class sheets (2026-11-19).
// The real methods are extracted from the page. Invented items only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
function method(name, indent) {
  const start = html.search(new RegExp('\\n' + indent + name + '\\('));
  assert(start >= 0, name);
  const end = html.indexOf('\n' + indent + '}\n', start);
  return html.slice(start, end + indent.length + 2).trim();
}
const N = '      ', S = '    ';
const notes = eval(`({${method('_parseChecklist', N)},${method('_checklistText', N)},${method('_toChecklistText', N)}})`);

// Parsing: items with or without the dash, ticked in either case; other lines are text.
const p = notes._parseChecklist('Friday\n- [ ] Grade quizzes\n[x] Email Ms Hale\n- [X] Print maps\n  - [ ] sub item\nnot an item [ ]');
assert.deepEqual(p.map(l => l.item), [false, true, true, true, true, false]);
assert.deepEqual(p.filter(l => l.item).map(l => l.done), [false, true, true, false]);
assert.equal(p[1].text, 'Grade quizzes');
assert.equal(p[4].indent, '  ', 'an indented item keeps its indent');

// Round trip: what is parsed writes back the same (ticks normalised to x).
assert.equal(notes._checklistText(notes._parseChecklist('Head\n- [ ] a\n- [x] b')), 'Head\n- [ ] a\n- [x] b');
assert.equal(notes._checklistText(notes._parseChecklist('[X] b')), '- [x] b');

// Making a checklist: one item per non-empty line; existing items untouched.
assert.equal(notes._toChecklistText('Grade quizzes\n\n  Email Ms Hale  \n- [x] Done already'), '- [ ] Grade quizzes\n- [ ] Email Ms Hale\n- [x] Done already');

// Sheets: "[x]" / "[ ]" are checkboxes, TRUE/FALSE to formulas and export.
const sheet = eval(`({${method('_sheetCompute', S)}})`);
const calc = sheet._sheetCompute([
  ['Name', 'Handed in'],
  ['Ada', '[x]'],
  ['Bo', '[ ]'],
  ['Cy', '[X]'],
  ['', '=COUNTIF(B2:B4,TRUE)'],
  ['', '=IF(B3,"in","missing")'],
]);
assert.deepEqual(calc.kinds.map(r => r[1]), ['text', 'check', 'check', 'check', 'num', 'text']);
assert.deepEqual(calc.values.map(r => r[1]), ['Handed in', 'TRUE', 'FALSE', 'TRUE', '2', 'missing']);
assert.equal(sheet._sheetCompute([['[]', 'x', '[ x]']]).kinds[0].join(), 'text,text,text', 'only exact [ ] / [x] are boxes');

console.log('class-note-checklist: all passed');
