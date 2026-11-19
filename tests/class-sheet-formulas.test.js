// Class sheet formulas (2026-11-19): the engine and the reference mover are
// extracted from the page and run as they are. Invented values only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n    ' + name + '\\('));
  assert(start >= 0, name);
  const end = html.indexOf('\n    }\n', start);
  return html.slice(start, end + 6).trim();
}
const app = eval(`({${method('_sheetCompute')},${method('_sheetShiftRefs')}})`);
const show = (grid) => app._sheetCompute(grid).values;
const one = (formula, grid = [[]]) => { const g = grid.map(r => [...r]); g[0] = [...(g[0] || [])]; g.push([formula]); return show(g)[g.length - 1][0]; };

const marks = [
  ['Name', 'Quiz', 'Test', 'Final'],
  ['Ada',  '90',   '80',   ''],
  ['Bo',   '70',   'absent', ''],
  ['Cy',   '100',  '95',   ''],
];

// Arithmetic and precedence, as Sheets.
assert.equal(one('=1+2*3'), '7');
assert.equal(one('=(1+2)*3'), '9');
assert.equal(one('=-2^2'), '4', 'negation before power, as in Sheets');
assert.equal(one('=2^3^2'), '64', 'power is left to right in Sheets');
assert.equal(one('=50%'), '0.5');
assert.equal(one('=0.1+0.2'), '0.3', 'no float noise');
assert.equal(one('=10/4'), '2.5');
assert.equal(one('="a"&"b"&1'), 'ab1');
assert.equal(one('=1/0'), '#DIV/0!');
assert.equal(one('=1+'), '#ERROR!');
assert.equal(one('=FOO(1)'), '#NAME?');
assert.equal(one('=sum(1,2)'), '3', 'function names in any case');

// References and ranges.
assert.equal(one('=B2+C2', marks), '170');
assert.equal(one('=b2*2', marks), '180', 'lower-case references');
assert.equal(one('=$B$2', marks), '90');
assert.equal(one('=SUM(B2:B4)', marks), '260');
assert.equal(one('=SUM(B2:C4)', marks), '435', 'text in a range is skipped');
assert.equal(one('=SUM(C3)', marks), '0', 'text in a referenced cell is skipped');
assert.equal(one('=C3+1', marks), '#VALUE!', 'but arithmetic on text is an error');
assert.equal(one('=AVERAGE(B2:B4)', marks), '86.66666667');
assert.equal(one('=ROUND(AVERAGE(B2:B4),1)', marks), '86.7');
assert.equal(one('=AVERAGE(D2:D4)', marks), '#DIV/0!');
assert.equal(one('=MAX(B:B)', marks), '100', 'whole column');
assert.equal(one('=MIN(B2:B4)', marks), '70');
assert.equal(one('=COUNT(B1:C4)', marks), '5');
assert.equal(one('=COUNTA(A1:A4)', marks), '4');
assert.equal(one('=COUNTBLANK(D2:D4)', marks), '3');
assert.equal(one('=MEDIAN(B2:B4)', marks), '90');
assert.equal(one('=A2', marks), 'Ada');
assert.equal(one('=D2', marks), '', 'an empty cell shows empty');
assert.equal(one('=A2&" "&B2', marks), 'Ada 90');
assert.equal(one('=B2:B4', marks), '#VALUE!', 'a bare range needs a function');

// Logic and text.
assert.equal(one('=IF(B2>=90,"A","not A")', marks), 'A');
assert.equal(one('=IF(B3>=90,"A","not A")', marks), 'not A');
assert.equal(one('=IF(B2>100,"x")', marks), 'FALSE');
assert.equal(one('=IFERROR(1/0,"none")'), 'none');
assert.equal(one('=IFERROR(C3*2,0)', marks), '0');
assert.equal(one('=AND(B2>50,B3>50)', marks), 'TRUE');
assert.equal(one('=OR(B2>95,B3>95)', marks), 'FALSE');
assert.equal(one('=NOT(TRUE)'), 'FALSE');
assert.equal(one('=IFS(B3>=90,"A",B3>=80,"B",TRUE,"C")', marks), 'C');
assert.equal(one('=UPPER(A2)', marks), 'ADA');
assert.equal(one('=LEN("hello")'), '5');
assert.equal(one('=LEFT("hello",2)&RIGHT("hello",2)'), 'helo');
assert.equal(one('=MID("hello",2,3)'), 'ell');
assert.equal(one('=PROPER("ada lovelace")'), 'Ada Lovelace');
assert.equal(one('=TRIM("  a   b ")'), 'a b');
assert.equal(one('=TEXTJOIN(", ",TRUE,A2:A4)', marks), 'Ada, Bo, Cy');
assert.equal(one('="He said ""hi"""'), 'He said "hi"');
assert.equal(one('=B2=90', marks), 'TRUE');
assert.equal(one('=A2="ada"', marks), 'TRUE', 'text compares without case');

// Conditional and lookup.
assert.equal(one('=COUNTIF(B2:B4,">=90")', marks), '2');
assert.equal(one('=COUNTIF(C2:C4,"absent")', marks), '1');
assert.equal(one('=COUNTIF(A2:A4,"?o")', marks), '1', 'wildcards');
assert.equal(one('=COUNTIF(C2:C4,"<>absent")', marks), '2');
assert.equal(one('=SUMIF(B2:B4,">80")', marks), '190');
assert.equal(one('=SUMIF(A2:A4,"Cy",C2:C4)', marks), '95');
assert.equal(one('=AVERAGEIF(B2:B4,">80")', marks), '95');
assert.equal(one('=VLOOKUP("Bo",A2:C4,2,FALSE)', marks), '70');
assert.equal(one('=VLOOKUP("Zed",A2:C4,2,FALSE)', marks), '#N/A');
assert.equal(one('=VLOOKUP("Bo",A2:C4,9,FALSE)', marks), '#REF!');
assert.equal(one('=MATCH("Cy",A1:A4,0)', marks), '4');
assert.equal(one('=INDEX(A1:D4,3,2)', marks), '70');
assert.equal(one('=RANK(B3,B2:B4)', marks), '3');
assert.equal(one('=RANK(B3,B2:B4,1)', marks), '1');
assert.equal(one('=MOD(-7,3)'), '2', 'MOD takes the sign of the divisor, as Sheets');
assert.equal(one('=ROUND(2.5)'), '3');
assert.equal(one('=ROUND(-2.5)'), '-3');
assert.equal(one('=ROUNDUP(1.21,1)'), '1.3');
assert.equal(one('=ROUNDDOWN(1.29,1)'), '1.2');
assert.equal(one('=SQRT(-1)'), '#NUM!');

// Formulas that use formulas; and one that uses itself.
const chain = show([['1', '=A1+1', '=B1*10']]);
assert.deepEqual(chain[0], ['1', '2', '20']);
const loop = show([['=B1', '=A1', '5']]);
assert.deepEqual(loop[0], ['#REF!', '#REF!', '5'], 'a circular reference is #REF!, the rest still works');
const why = app._sheetCompute([['=A1']]).why[0][0];
assert(/circular/i.test(why), why);
// An error flows on to what uses it.
assert.deepEqual(show([['=1/0', '=A1+1', '=IFERROR(B1,"ok")']])[0], ['#DIV/0!', '#DIV/0!', 'ok']);
// Typed values show as typed; kinds drive alignment.
const typed = app._sheetCompute([['007', 'Ada', '=1+1', 'true']]);
assert.deepEqual(typed.values[0], ['007', 'Ada', '2', 'true']);
assert.deepEqual(typed.kinds[0], ['num', 'text', 'num', 'bool']);
assert.equal(one('=A1*2', [['007']]), '14');

// ---- Moving references --------------------------------------------------
const sh = (f, op) => app._sheetShiftRefs(f, op);
// Pasted one row down and one column right: relative parts move.
assert.equal(sh('=A1+B2', { dr: 1, dc: 1 }), '=B2+C3');
assert.equal(sh('=$A$1+A$1+$A1', { dr: 2, dc: 2 }), '=$A$1+C$1+$A3');
assert.equal(sh('=SUM(A1:A3)', { dr: 0, dc: 1 }), '=SUM(B1:B3)');
assert.equal(sh('=A1', { dr: -1, dc: 0 }), '=#REF!', 'moved off the sheet');
assert.equal(sh('=SUM(B:B)', { dr: 5, dc: 1 }), '=SUM(C:C)');
assert.equal(sh('="A1"&A1', { dr: 1, dc: 0 }), '="A1"&A2', 'text in quotes is left alone');
assert.equal(sh('=LOG10(A1)', { dr: 1, dc: 0 }), '=LOG10(A2)', 'a function name with digits is not a reference');
// A row inserted at index 1 (before row 2).
assert.equal(sh('=A1+A2+$A$3', { axis: 'row', at: 1, delta: 1 }), '=A1+A3+$A$4');
assert.equal(sh('=SUM(A1:A3)', { axis: 'row', at: 1, delta: 1 }), '=SUM(A1:A4)', 'a range grows around it');
// Row 2 deleted.
assert.equal(sh('=A1+A3', { axis: 'row', at: 1, delta: -1 }), '=A1+A2');
assert.equal(sh('=A2*2', { axis: 'row', at: 1, delta: -1 }), '=#REF!*2', 'a reference to a deleted row');
assert.equal(sh('=SUM(A1:A3)', { axis: 'row', at: 1, delta: -1 }), '=SUM(A1:A2)', 'a range shrinks');
assert.equal(sh('=SUM(A2:A2)', { axis: 'row', at: 1, delta: -1 }), '=SUM(#REF!)');
// Columns.
assert.equal(sh('=A1+C1', { axis: 'col', at: 1, delta: 1 }), '=A1+D1');
assert.equal(sh('=SUM(B:B)', { axis: 'col', at: 1, delta: -1 }), '=SUM(#REF!)');
assert.equal(sh('=SUM(B:D)', { axis: 'col', at: 1, delta: -1 }), '=SUM(B:C)');
assert.equal(sh('=SUM(A1:A9)', { axis: 'col', at: 3, delta: 1 }), '=SUM(A1:A9)', 'columns past it only');
assert.equal(sh('plain', { dr: 1, dc: 1 }), 'plain');

console.log('class-sheet-formulas: all passed');
