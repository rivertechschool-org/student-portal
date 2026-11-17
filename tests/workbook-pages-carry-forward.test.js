// Workbook Pages: changing an earlier week's pages carries on to the weeks
// that follow it (2026-11-17). The real methods are extracted from the page.
// Invented ids; no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n      (?:async )?' + name + '\\('));
  assert(start >= 0, name);
  const end = html.indexOf('\n      }', start);
  return html.slice(start, end + 8).trim();
}
const app = eval(`({${['_pagesShift', '_pagesFollowingTargets', '_pagesFollowingText', '_pagesNextLabel', '_pagesFollowingBox'].map(method).join(',')}})`);
const P = (s, e) => ({ page_start: s, page_end: e, page_label: null });
const L = (l) => ({ page_start: null, page_end: null, page_label: l });

// ---- one step ----
// Week 2 went from 5-8 to 7-10: week 3's 9-12 becomes 11-14 (same count).
assert.deepEqual(app._pagesShift(P(5, 8), P(7, 10), P(9, 12)), P(11, 14));
// Fewer pages on week 2 (5-8 -> 5-6): week 3 starts right after, still 4 pages.
assert.deepEqual(app._pagesShift(P(5, 8), P(5, 6), P(9, 12)), P(7, 10));
// A gap the teacher set by hand is kept: 9-12 had been moved to 15-18.
assert.deepEqual(app._pagesShift(P(5, 8), P(7, 10), P(15, 18)), P(17, 20));
// Start moved but end did not: nothing later changes.
assert.equal(app._pagesShift(P(5, 8), P(6, 8), P(9, 12)), null);
// No pages before: week 3 starts after the new end, keeping its count.
assert.deepEqual(app._pagesShift(L(null), P(20, 23), P(9, 12)), P(24, 27));
// Not on the later week, words now, or off the end of the book: left alone.
assert.equal(app._pagesShift(P(5, 8), P(7, 10), undefined), null);
assert.equal(app._pagesShift(P(5, 8), L('Week 4'), P(9, 12)), null);
assert.equal(app._pagesShift(P(5, 8), P(4995, 4998), P(9, 12)), null);
// "Week 3" -> "Week 4" chains follow a relabel; other words do not.
assert.deepEqual(app._pagesShift(L('Week 3'), L('Week 5'), L('Week 4')), L('Week 6'));
assert.equal(app._pagesShift(L('Week 3'), L('Week 5'), L('Week 4 Days 1-2')), null);

// ---- the chain ----
// w1 <- w2 <- w3 <- w4; Ava and Ben. Ben turned in w3.
const children = new Map([
  ['w1', [{ id: 'w2', title: 'Week 2' }]],
  ['w2', [{ id: 'w3', title: 'Week 3' }]],
  ['w3', [{ id: 'w4', title: 'Week 4' }]],
]);
const versions = new Map([
  ['w2', new Map([['ava', P(5, 8)], ['ben', P(5, 8)]])],
  ['w3', new Map([['ava', P(9, 12)], ['ben', P(9, 12)]])],
  ['w4', new Map([['ava', P(13, 16)], ['ben', P(13, 16)]])],
]);
const changes = new Map([
  ['ava', { was: P(1, 4), now: P(3, 6) }],
  ['ben', { was: P(1, 4), now: P(1, 2) }],
]);
const plan = app._pagesFollowingTargets('w1', changes, children, versions, new Set(['w3|ben']));
const at = (id) => plan.writes.find(w => w.assignment.id === id);
assert.deepEqual(plan.writes.map(w => w.assignment.id), ['w2', 'w3', 'w4'], 'parent before child');
assert.deepEqual(at('w2').targets.map(t => [t.student_id, t.page_start, t.page_end]), [['ava', 7, 10], ['ben', 3, 6]]);
// Ava keeps moving; Ben stops at the week he turned in.
assert.deepEqual(at('w3').targets.map(t => [t.student_id, t.page_start, t.page_end]), [['ava', 11, 14]]);
assert.deepEqual(at('w4').targets.map(t => [t.student_id, t.page_start, t.page_end]), [['ava', 15, 18]]);
assert.deepEqual(plan.held.map(h => h.assignment.id + ':' + h.student_id), ['w3:ben']);
// Each write remembers the old pages, for undo.
assert.deepEqual(at('w4').targets[0].was, P(13, 16));
// A loop in the links does not run forever.
const loop = new Map([['w1', [{ id: 'w2' }]], ['w2', [{ id: 'w1' }]]]);
assert.equal(app._pagesFollowingTargets('w1', changes, loop, versions, new Set()).writes.length, 1);

// ---- the words ----
const text = app._pagesFollowingText(plan, new Map([['ben', 'Ben Example']]));
assert.equal(text, 'Moved to match in 3 later assignments (Week 2, Week 3, Week 4) for 2 students. Left as they were, already turned in: Ben Example on Week 3.');
assert.equal(app._pagesFollowingText({ writes: [], held: [] }, new Map()), '');
assert.equal(app._pagesFollowingBox(0), '', 'offered only when something carries on');
assert.match(app._pagesFollowingBox(1), /id="pages-carry-following" checked/);
console.log('Workbook Pages carry-forward: shifts, the chain, turned-in work and the message passed.');
