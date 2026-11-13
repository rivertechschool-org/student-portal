// Math Dojo, Picture Graphs: every row is labelled with the thing it pictures,
// and the question names exactly those things.
//
// Reported 2026-11-13: "How many frogs and stars in all?" over rows labelled
// "Apples" and "Bananas". The rows carried an unrelated category while the
// question asked about the pictures. This runs the real generator out of the
// page many times and checks the words and the graph agree on every draw.
//
// Run: node tests/dojo-picture-graph-labels.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const start = html.indexOf('        "Picture Graphs": () => {');
assert(start >= 0, 'Picture Graphs generator found');
const end = html.indexOf('\n        "3D Shapes": () => {', start);
const src = html.slice(start, end).replace(/^\s*"Picture Graphs":\s*/, '').replace(/,\s*$/, '');

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);
const gen = eval(`(${src})`);

// The item pool, read from the same source, so a new item is covered too.
const pool = eval(src.match(/const itemPool = (\[[\s\S]*?\]);/)[1]);
const byLabel = new Map(pool.map(i => [i.name[0].toUpperCase() + i.name.slice(1), i]));

const seen = new Set();
for (let n = 0; n < 4000; n++) {
  const q = gen();
  seen.add(q.subType);
  const [head, ...rows] = q.question.split('\n');
  if (q.subType === 'count') { assert.equal(rows.length, 0); continue; }
  assert.equal(rows.length, 2, q.question);
  const counts = rows.map(r => {
    const m = r.match(/^([^:]+): (.+)$/);
    assert(m, `row has a label: ${r}`);
    const item = byLabel.get(m[1]);
    assert(item, `row label is an item, not a category: ${r}`);
    const marks = m[2].split(' ');
    assert(marks.every(x => x === item.symbol), `"${m[1]}" row pictures ${item.name} only: ${r}`);
    return { item, n: marks.length };
  });
  assert.notEqual(counts[0].item.name, counts[1].item.name, 'two different things');
  const [a, b] = counts;
  if (q.subType === 'total') {
    assert.equal(head, `How many ${a.item.name} and ${b.item.name} in all?`);
    assert.equal(q.answer, a.n + b.n);
  } else if (q.subType === 'difference') {
    assert.equal(head, `How many more ${a.item.name} than ${b.item.name}?`);
    assert.equal(q.answer, a.n - b.n);
    assert(q.answer > 0);
  } else if (q.subType === 'compare') {
    assert.equal(head, 'Which has more?');
    const more = a.n > b.n ? a : b;
    assert.equal(byLabel.get(q.answer), more.item);
    assert(q.options.includes(q.answer));
  } else assert.fail('unknown subtype ' + q.subType);
}
assert.deepEqual([...seen].sort(), ['compare', 'count', 'difference', 'total']);
console.log('Picture Graphs: rows labelled by what they picture, 4000 draws passed.');
