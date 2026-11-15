// Announcement banners: what shows, closing it, and the admin form's rules.
// announcements/banner.js runs as a module here; the portal methods are
// extracted from the page. Invented content; no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../announcements/banner.js');

// ---- the banner ----
const today = '2026-11-15';
// Conference days: within a week only, soonest first, today/tomorrow said so.
assert.deepEqual(B.upcoming([{ id: 'a', day: '2026-11-18' }, { id: 'b', day: '2026-11-23' }, { id: 'c', day: '2026-11-14' }, { id: 'd', day: 'junk' }], today).map(d => d.id), ['a']);
assert.equal(B.headline(B.upcoming([{ id: 'a', day: '2026-11-18' }], today)), 'Parent-teacher conferences are this week: Wednesday, November 18.');
assert.equal(B.headline(B.upcoming([{ id: 'a', day: '2026-11-15' }], today)), 'Parent-teacher conferences are today, Sunday, November 15.');
assert.equal(B.headline(B.upcoming([{ id: 'a', day: '2026-11-16' }, { id: 'b', day: '2026-11-19' }], today)),
  'Parent-teacher conferences are tomorrow, Monday, November 16 and Thursday, November 19.');
assert.deepEqual(B.upcoming([{ id: 'a', day: '2026-11-22' }], today).map(d => d.inDays), [7], 'a week out still counts');

const live = {
  viewer: 'parents',
  conferences: [{ id: 'd1', day: '2026-11-18' }],
  announcements: [
    { id: 'n1', message: 'Picture day Thursday', link_url: null, link_label: null, tone: 'info', updated_at: 't1' },
    { id: 'n2', message: 'Snow: school closed', link_url: 'https://example.com/snow', link_label: 'Details', tone: 'important', updated_at: 't1' },
    { id: 'n3', message: 'Sneaky', link_url: 'javascript:alert(1)', link_label: 'Click', tone: 'info', updated_at: 't1' },
  ],
};
const list = B.bannersFrom(live, today);
assert.deepEqual(list.map(b => b.kind + ':' + b.tone), ['announcement:important', 'conference:info', 'announcement:info', 'announcement:info'], 'important first');
const conf = list.find(b => b.kind === 'conference');
assert.equal(conf.sub, 'For full-time junior high and high school families.');
assert.equal(conf.url, '/conferences/');
assert.equal(list.find(b => b.text === 'Sneaky').url, '', 'a javascript: link is dropped');
assert.equal(B.safeUrl('/conferences/'), '/conferences/');
assert.equal(B.safeUrl('http://plain.example.com'), '', 'https only');
// Students get no conference days from the server; nothing to draw then.
assert.equal(B.bannersFrom({ announcements: [], conferences: [] }, today).length, 0);

// Closing is remembered per banner AND edit; an edited banner shows again.
const mem = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, x) { this.v[k] = x; } };
B.rememberClosed(list[0].key, mem);
assert.equal(B.visible(list, mem).length, 3);
const edited = B.bannersFrom({ ...live, announcements: live.announcements.map(a => a.id === 'n2' ? { ...a, updated_at: 't2' } : a) }, today);
assert.equal(B.visible(edited, mem).length, 4, 'edited, so it shows again');
// A broken store is not an error: everything just shows.
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
assert.equal(B.visible(list, broken).length, 4);
B.rememberClosed('x', broken);
// The memory is capped.
for (let i = 0; i < 100; i++) B.rememberClosed('k' + i, mem);
assert.equal(B.closedKeys(mem).length, 60);

// ---- the admin form ----
const html = fs.readFileSync(path.join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n      (?:async )?' + name + '\\('));
  assert(start >= 0, name);
  const end = html.indexOf('\n      }', start);
  return html.slice(start, end + 8).trim();
}
const app = eval(`({${['_annAudiences', '_annStatus', '_annToLocalInput', '_annFromLocalInput', '_annRowFromForm'].map(method).join(',')}})`);
const now = new Date('2026-11-15T12:00:00Z');
const form = (o) => ({ message: 'Picture day', audiences: ['parents'], starts: '', ends: '', ...o });

let r = app._annRowFromForm(form(), now);
assert.equal(r.row.starts_at, now.toISOString(), 'no start = now');
assert.equal(r.row.ends_at, null);
assert.equal(r.row.link_url, null); assert.equal(r.row.link_label, null);
assert.match(app._annRowFromForm(form({ message: '  ' }), now).error, /Write the announcement/);
assert.match(app._annRowFromForm(form({ message: 'x'.repeat(401) }), now).error, /under 400/);
assert.match(app._annRowFromForm(form({ audiences: [] }), now).error, /at least one group/);
assert.match(app._annRowFromForm(form({ link_url: 'javascript:alert(1)' }), now).error, /https:\/\//);
assert.equal(app._annRowFromForm(form({ link_url: 'www.example.com' }), now).row.link_url, 'https://www.example.com');
assert.equal(app._annRowFromForm(form({ link_url: '/conferences/' }), now).row.link_label, 'Open', 'a link gets a button');
// A schedule: local wall time in, an instant out, and back.
const start = app._annToLocalInput('2026-11-18T16:00:00Z');
assert.equal(app._annFromLocalInput(start), '2026-11-18T16:00:00.000Z', 'round trip');
r = app._annRowFromForm(form({ starts: app._annToLocalInput('2026-11-17T08:00:00Z'), ends: app._annToLocalInput('2026-11-19T08:00:00Z'), tone: 'important' }), now);
assert.equal(r.row.tone, 'important');
assert.equal(app._annStatus(r.row, now), 'scheduled');
assert.equal(app._annStatus(r.row, new Date('2026-11-18T00:00:00Z')), 'live');
assert.equal(app._annStatus(r.row, new Date('2026-11-19T08:00:00Z')), 'ended', 'down at its end time');
assert.match(app._annRowFromForm(form({ starts: app._annToLocalInput('2026-11-19T08:00:00Z'), ends: app._annToLocalInput('2026-11-17T08:00:00Z') }), now).error, /end after it starts/);
assert.match(app._annRowFromForm(form({ ends: app._annToLocalInput('2026-11-14T08:00:00Z'), starts: app._annToLocalInput('2026-11-13T08:00:00Z') }), now).error, /already passed/);
assert.equal(app._annStatus({ starts_at: '2026-11-01T00:00:00Z', ends_at: null }, now), 'live', 'no end: until ended');
console.log('Announcements: banners, closing, schedule and the admin form passed.');
