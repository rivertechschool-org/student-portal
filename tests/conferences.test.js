// Parent-teacher conferences: the admin's Conferences tool and the parent's
// "Book a Conference" screen.
//
// Runs the real methods against stubs with invented people. Who may see and
// book what is enforced by the database, and tested in the backend repo; this
// checks the page: the slots a block of time makes, which free slots a child
// is offered, that the parent's button appears only while there is something
// to book, and that the screens show what they should and nothing more.
//
// Run: node tests/conferences.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name, indent = '      ') {
  const m = new RegExp('\\n' + indent + '(?:async\\s+)?' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('not found: ' + name);
  const start = m.index;
  let p = html.indexOf('(', start), pd = 0;
  for (; p < html.length; p++) {
    if (html[p] === '(') pd++;
    else if (html[p] === ')' && --pd === 0) break;
  }
  let i = html.indexOf('{', p), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const names = ['_conferenceZones', '_confMinutes', '_confHHMM', '_confClock', '_confDayLabel', '_conferenceSlotTimes', '_conferencePreviewText',
  '_renderConferenceAdmin', '_renderConferenceAdminDay', '_loadParentConferences', '_conferenceFreeSlotsFor', 'showParentConferences',
  'bookParentConference', 'addConferenceSlots', '_localDateStr', 'escapeHtml', 'jsAttr'];
const proto = eval(`({ ${names.map(n => method(n)).join(',\n')} })`);

(async () => {
  const app = Object.create(proto);

  // ---- making slots from a block of time ----
  const m = app._conferenceSlotTimes('08:10', '11:40', 20);
  ok('8:10-11:40 in 20 minutes is 10 slots', m.slots.length === 10 && m.slots[0].starts_at === '08:10' && m.slots[9].ends_at === '11:30', JSON.stringify(m.slots.slice(-1)));
  ok('  with 10 minutes left over, and says so', m.leftover === 10 && app._conferencePreviewText('08:10', '11:40', 20) === '10 slots, 8:10 AM–11:30 AM (10 min left over)', app._conferencePreviewText('08:10', '11:40', 20));
  ok('an afternoon block reads as PM', app._conferencePreviewText('12:30', '13:30', 20) === '3 slots, 12:30 PM–1:30 PM');
  ok('backwards or empty times make no slots', app._conferenceSlotTimes('11:00', '10:00', 20).slots.length === 0 && app._conferenceSlotTimes('', '10:00', 20).slots.length === 0 && app._conferenceSlotTimes('08:00', '09:00', 0).slots.length === 0);
  ok('the Morning block is 8:10-11:40', JSON.stringify(app._conferenceZones()[0]) === '{"label":"Morning","start":"08:10","end":"11:40"}');

  // ---- adding slots needs a teacher ----
  {
    const els = { 'conf-start-d1': { value: '08:10' }, 'conf-end-d1': { value: '09:10' }, 'conf-len-d1': { value: '20' } };
    let boxes = [{ checked: false, value: 't-math' }];
    const inserted = [], notes = [];
    global.document = { getElementById: (id) => els[id], querySelectorAll: () => boxes };
    const a = Object.create(proto);
    a.showNotification = (msg, kind) => notes.push([msg, kind]);
    a.supabaseQuery = async (fn) => fn();
    a._refreshConferenceAdmin = async () => {};
    a.auth = { supabase: { from: () => ({ insert: async (rows) => { inserted.push(...rows); return { error: null }; } }) } };
    await a.addConferenceSlots('d1');
    ok('slots are not added without a teacher', inserted.length === 0 && /needs a teacher/.test(notes[0]?.[0]));
    boxes = [{ checked: true, value: 't-math' }, { checked: true, value: 't-eng' }, { checked: false, value: 't-art' }];
    await a.addConferenceSlots('d1');
    ok('with teachers ticked, each slot gets them', inserted.length === 3 && inserted.every(r => r.day_id === 'd1' && JSON.stringify(r.teacher_ids) === '["t-math","t-eng"]'), JSON.stringify(inserted));
  }

  // ---- the admin's page ----
  {
    const by = {
      'st-1': { id: 'st-1', first_name: 'Wren', last_name: 'Orchard', user_type: 'student' },
      'p-1': { id: 'p-1', first_name: 'Paz', last_name: 'Orchard', user_type: 'parent' },
      't-1': { id: 't-1', first_name: 'Numa', last_name: 'Ratio', user_type: 'teacher' },
    };
    const c = {
      days: [{ id: 'd1', day: '2099-03-04', title: 'Spring conferences', is_open: true }],
      slots: [
        { id: 'sl-1', day_id: 'd1', starts_at: '08:10:00', ends_at: '08:30:00', teacher_ids: ['t-1'], student_id: 'st-1', booked_by: 'p-1' },
        { id: 'sl-2', day_id: 'd1', starts_at: '08:30:00', ends_at: '08:50:00', teacher_ids: ['t-1'], student_id: null },
      ],
      teachers: [{ id: 't-1', name: 'Numa Ratio', core: true }, { id: 't-2', name: 'Vera Bose', core: false }],
      students: [{ id: 'st-1', name: 'Wren Orchard', grade: '7' }],
      parentsOf: { 'st-1': ['Paz Orchard'] },
      byId: by,
      name: (p) => p ? `${p.first_name} ${p.last_name}` : '',
    };
    const page = app._renderConferenceAdmin(c);
    ok('the admin sees who is booked, their parents and that a parent booked it', /<b>Wren Orchard<\/b>/.test(page) && /Paz Orchard/.test(page) && /booked by parent/.test(page));
    ok('  a free slot offers a student to add', /id="conf-pick-sl-2"/.test(page) && /app\.fillConferenceSlot\('sl-2'\)/.test(page));
    ok('  the day shows its count and its open switch', /1 of 2 booked/.test(page) && /checked onchange="app\.setConferenceDayOpen\('d1', this\.checked\)"/.test(page));
    ok('  math and English teachers start ticked, others do not', /value="t-1" checked/.test(page) && /value="t-2" >/.test(page));
    ok('  times read as a clock', /8:10 AM–8:30 AM/.test(page));
    ok('with no days, it says what to do', /No conference days yet/.test(app._renderConferenceAdmin({ ...c, days: [] })));
  }

  // ---- which free slots a child is offered ----
  {
    const day = { slots: [
      { id: 'a', student_id: null, for_children: ['k1'] },
      { id: 'b', student_id: null, for_children: [] },
      { id: 'c', student_id: 'k1', for_children: ['k1'] },
    ] };
    ok("a child is offered the free slots with one of their teachers", JSON.stringify(app._conferenceFreeSlotsFor(day, 'k1').map(x => x.id)) === '["a"]');
    ok('  and every free slot when none has one of their teachers', JSON.stringify(app._conferenceFreeSlotsFor(day, 'k2').map(x => x.id)) === '["a","b"]');
  }

  // ---- the parent's home button ----
  {
    const quick = html.slice(html.indexOf('⏰ Late Arrival / Early Pickup'), html.indexOf('⚙️ Account Settings'));
    ok('the parent home shows "Book a Conference" only while there is something to book', /\$\{\(this\.parentConferences \|\| \[\]\)\.length \? `<button class="btn btn-primary" onclick="app\.showParentConferences\(\)">/.test(quick), quick);
    const load = method('loadParentData');
    ok('  loaded with the rest of the parent data, before the home page draws', load.indexOf('await this._loadParentConferences();') > 0 && load.indexOf('await this._loadParentConferences();') < load.lastIndexOf('this.setupHomeContent()'));
    const a = Object.create(proto);
    a.auth = { supabase: { rpc: async () => ({ data: null, error: { message: 'down' } }) } };
    ok('  and a failed load hides it rather than breaking the page', JSON.stringify(await a._loadParentConferences()) === '[]');
  }

  // ---- the parent's screen ----
  {
    let shown = null;
    const notes = [];
    const a = Object.create(proto);
    a.children = [{ id: 'k1', first_name: 'Wren', last_name: 'Orchard' }, { id: 'k2', first_name: 'Ash', last_name: 'Orchard' }];
    a.showModal = (id, title, body) => { shown = body; };
    a.showNotification = (msg, kind) => notes.push([msg, kind]);
    let days = [];
    const calls = [];
    a.auth = { supabase: { rpc: async (fn, args) => {
      calls.push([fn, args]);
      if (fn === 'rt_conferences_for_parent') return { data: days, error: null };
      if (fn === 'rt_book_conference_slot') return { data: { ok: true, moved_from: '08:10' }, error: null };
      return { data: null, error: null };
    } } };
    a.currentSection = 'other';

    await a.showParentConferences();
    ok('with nothing open the parent is told, and no screen opens', shown === null && /no conference times/i.test(notes[0]?.[0]));

    days = [{ id: 'd1', day: '2099-03-04', title: 'Spring conferences', is_open: true, slots: [
      { id: 'sl-1', starts_at: '08:10', ends_at: '08:30', teachers: ['Numa Ratio'], student_id: 'k1', for_children: ['k1'] },
      { id: 'sl-2', starts_at: '08:30', ends_at: '08:50', teachers: ['Numa Ratio'], student_id: null, for_children: ['k1'] },
      { id: 'sl-3', starts_at: '08:50', ends_at: '09:10', teachers: ['Vera Bose'], student_id: null, for_children: ['k2'] },
    ] }];
    await a.showParentConferences();
    ok('the parent sees their booking with its teacher', /✅ <b>Wren Orchard<\/b>: 8:10 AM–8:30 AM with Numa Ratio/.test(shown), shown);
    ok('  a child with a booking is offered other times as a move', /Pick another time to move Wren Orchard/.test(shown) && /bookParentConference\('sl-2', 'k1'\)/.test(shown) && !/bookParentConference\('sl-3'/.test(shown));
    ok('  and can switch to their other child', /showParentConferences\('k2'\)/.test(shown));
    await a.showParentConferences('k2');
    ok("  the other child is offered their own teacher's slot", /Pick a time for Ash Orchard/.test(shown) && /bookParentConference\('sl-3', 'k2'\)/.test(shown));
    days[0].is_open = false;
    days[0].slots = days[0].slots.filter(x => x.student_id);
    await a.showParentConferences();
    ok('a closed day still shows their booking, and says sign-up is closed', /Wren Orchard<\/b>: 8:10 AM/.test(shown) && /Sign-up for this day is closed/.test(shown));
    days[0].is_open = true;
    notes.length = 0;
    await a.bookParentConference('sl-2', 'k1');
    ok('booking goes through the database and says where they moved from', calls.some(([fn, args]) => fn === 'rt_book_conference_slot' && args.p_slot === 'sl-2' && args.p_student === 'k1') && /Moved from 8:10 AM/.test(notes[0]?.[0]), JSON.stringify(notes));
    ok('the parent screen never reads the slot tables directly', !/from\('conference_slots'\)/.test(method('showParentConferences') + method('_loadParentConferences') + method('bookParentConference')));
  }

  // ---- the admin tile ----
  ok('the admin page has a Conferences tile', /onclick="app\.openConferenceAdmin\(\)"[\s\S]{0,300}Conferences/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
