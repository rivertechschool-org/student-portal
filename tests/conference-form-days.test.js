// Conferences: gaps between slots, and public form windows from the slots.
// Real portal methods; invented times; no network or school data.
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
const app = eval(`({${['_confMinutes', '_confHHMM', '_confClock', '_conferenceSlotTimes', '_conferencePreviewText', '_conferenceWindowsFromSlots', '_conferenceBlocks', '_conferenceBlockName'].map(method).join(',')}})`);
const times = r => r.slots.map(x => x.starts_at + '-' + x.ends_at);

// No gap: back to back, as before.
let r = app._conferenceSlotTimes('08:10', '11:40', 20);
assert.equal(r.slots.length, 10); assert.equal(r.leftover, 10);
// A 5-minute gap: 8:20-8:40, 8:45-9:05 ... the last ending by 11:20.
r = app._conferenceSlotTimes('08:20', '11:20', 20, 5);
assert.deepEqual(times(r).slice(0, 3), ['08:20-08:40', '08:45-09:05', '09:10-09:30']);
assert.equal(r.slots.length, 7);
assert.equal(r.slots.at(-1).ends_at, '11:10'); assert.equal(r.leftover, 10, 'left over is after the last slot, gap not counted');
// A gap that exactly fills: 8:00-9:00 in 25s with 10 between is 2 slots, none over.
r = app._conferenceSlotTimes('08:00', '09:00', 25, 10);
assert.deepEqual(times(r), ['08:00-08:25', '08:35-09:00']); assert.equal(r.leftover, 0);
// Junk gaps are no gap.
assert.equal(app._conferenceSlotTimes('08:00', '09:00', 20, -5).slots.length, 3);
assert.equal(app._conferenceSlotTimes('08:00', '09:00', 20, 'x').slots.length, 3);
assert.equal(app._conferencePreviewText('08:20', '11:20', 20, 5), '7 slots, 8:20 AM–11:10 AM (10 min left over)');

// Windows from the slots: runs split where more than 30 minutes go empty.
const slot = (a, b) => ({ starts_at: a + ':00', ends_at: b + ':00' });
const w = app._conferenceWindowsFromSlots([
  slot('08:20', '08:40'), slot('08:45', '09:05'), slot('08:20', '08:40'),   // two teachers, same time
  slot('12:30', '12:50'), slot('12:50', '13:10'),
  slot('13:50', '14:10'), slot('17:00', '17:20')]);
assert.deepEqual(w.map(x => `${x.label} ${x.start}-${x.end}`),
  ['Morning 08:20-09:05', 'Midday 12:30-13:10', 'Afternoon 13:50-14:10', 'Evening 17:00-17:20']);
assert.deepEqual(app._conferenceWindowsFromSlots([slot('08:00', '08:20'), slot('10:00', '10:20')]).map(x => x.label), ['Morning', 'Morning 2']);
assert.deepEqual(app._conferenceWindowsFromSlots([]), []);
// Time blocks the admin makes: 8-12 in hours, 8:20-10:20 as one, a short last block kept.
const blk = (a, b, n) => app._conferenceBlocks(a, b, n).map(x => x.start + '-' + x.end);
assert.deepEqual(blk('08:00', '12:00', 60), ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00']);
assert.deepEqual(blk('08:20', '10:20', 120), ['08:20-10:20']);
assert.deepEqual(blk('08:00', '10:30', 60), ['08:00-09:00', '09:00-10:00', '10:00-10:30']);
assert.deepEqual(blk('10:00', '09:00', 60), []);
assert.equal(app._conferenceBlocks('00:00', '23:59', 30).length, 24, 'capped');
assert.equal(app._conferenceBlockName('08:00', '09:00'), '8:00 AM–9:00 AM');
assert.equal(app._conferenceBlockName('12:20', '14:20'), '12:20 PM–2:20 PM');
console.log('Conference slot gaps, time blocks and form windows from slots passed.');
