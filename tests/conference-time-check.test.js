// Conference blocks vs slots (2026-11-17: the blocks said until 4:40 but the
// slots stopped at 3:20, so families who picked the afternoon got no time).
// The real methods are extracted from the page. No people involved.
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
const app = eval(`({${['_conferenceTimeCheck', '_conferenceZones', '_conferenceBlockName', '_confMinutes', '_confHHMM', '_confClock'].map(method).join(',')}})`);

// That day's shape: 20-minute slots 8:20 to 3:20, blocks to 4:40.
const slots = [];
for (let t = 8 * 60 + 20; t < 15 * 60 + 20; t += 20) slots.push({ starts_at: app._confHHMM(t) + ':00', ends_at: app._confHHMM(t + 20) + ':00' });
const wins = [{ label: 'Morning', start: '08:20', end: '11:40' }, { label: 'Midday', start: '12:00', end: '15:00' }, { label: 'Afternoon', start: '15:00', end: '16:40' }];
let r = app._conferenceTimeCheck(wins, slots);
assert.deepEqual(r.gaps, [{ label: 'Afternoon', start: '15:20', end: '16:40' }], 'the afternoon after 3:20 has no slots');
assert.deepEqual(r.outside.map(o => o.start), ['11:40:00'], '11:40-12:00 is in no block');

// Slots added to 4:40: nothing left to warn about in the afternoon.
const more = [...slots];
for (let t = 15 * 60 + 20; t < 16 * 60 + 40; t += 20) more.push({ starts_at: app._confHHMM(t), ends_at: app._confHHMM(t + 20) });
assert.deepEqual(app._conferenceTimeCheck(wins, more).gaps, []);

// A hole in the middle, a block with no slots at all, and a short leftover
// (under 10 minutes) that is not worth a warning.
r = app._conferenceTimeCheck([{ label: 'A', start: '08:00', end: '10:05' }, { label: '', start: '13:00', end: '14:00' }],
  [{ starts_at: '08:00', ends_at: '08:20' }, { starts_at: '09:00', ends_at: '10:00' }]);
assert.deepEqual(r.gaps, [{ label: 'A', start: '08:20', end: '09:00' }, { label: '1:00 PM–2:00 PM', start: '13:00', end: '14:00' }]);
assert.deepEqual(r.outside, []);
// A slot only partly inside a block does not count as covering it.
assert.deepEqual(app._conferenceTimeCheck([{ label: 'A', start: '08:00', end: '09:00' }], [{ starts_at: '08:40', ends_at: '09:20' }]).gaps,
  [{ label: 'A', start: '08:00', end: '09:00' }]);
// No blocks: nothing to compare.
assert.deepEqual(app._conferenceTimeCheck([], slots), { gaps: [], outside: [] });

// "Add time slots" offers the day's own blocks, else the old presets.
assert.deepEqual(app._conferenceZones(wins).map(z => z.start + '-' + z.end), ['08:20-11:40', '12:00-15:00', '15:00-16:40']);
assert.equal(app._conferenceZones([]).length, 3);
assert.equal(app._conferenceZones()[0].start, '08:10');
console.log('Conference time check: gaps, slots outside blocks and the presets passed.');
