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
  'bookParentConference', 'addConferenceSlots', '_conferenceDayReview', '_renderConferenceReview', '_reportConferenceSend',
  '_loadConferenceScheduleCard', '_renderConferenceScheduleCard', 'showMyConferenceSchedule',
  '_renderConferencePlaces', '_renderConferenceFormLink', '_renderConferenceRequests', '_conferenceHeldSlots', '_renderConferenceWindows', '_conferenceBlockName', '_conferenceWindowsFromSlots', '_conferencePlaceOptions', 'addConferenceLocation', 'setConferenceSlotLocation', 'setConferenceDayLocation',
  'confirmConferenceDay', 'saveConferenceContactEmail', 'setConferenceDayOpen', 'fillConferenceSlot', 'clearConferenceSlot', 'notificationDestination', 'notificationTypeConfig', 'sanitizeLink', '_localDateStr', 'escapeHtml', 'jsAttr'];
const proto = eval(`({ ${names.map(n => method(n)).join(',\n')} })`);

(async () => {
  const app = Object.create(proto);

  // ---- making slots from a block of time ----
  const m = app._conferenceSlotTimes('08:10', '11:40', 20);
  ok('8:10-11:40 in 20 minutes is 10 slots', m.slots.length === 10 && m.slots[0].starts_at === '08:10' && m.slots[9].ends_at === '11:30', JSON.stringify(m.slots.slice(-1)));
  ok('  with 10 minutes left over, and says so', m.leftover === 10 && app._conferencePreviewText('08:10', '11:40', 20) === '10 slots, 8:10 AM–11:30 AM (10 min left over)', app._conferencePreviewText('08:10', '11:40', 20));
  ok('an afternoon block reads as PM', app._conferencePreviewText('12:30', '13:30', 20) === '3 slots, 12:30 PM–1:30 PM');
  ok('backwards or empty times make no slots', app._conferenceSlotTimes('11:00', '10:00', 20).slots.length === 0 && app._conferenceSlotTimes('', '10:00', 20).slots.length === 0 && app._conferenceSlotTimes('08:00', '09:00', 0).slots.length === 0);
  ok('the ready-made blocks are 8:10-11:40, 12:00-2:40 and 3:00-4:40', JSON.stringify(app._conferenceZones().map(z => [z.start, z.end])) === '[["08:10","11:40"],["12:00","14:40"],["15:00","16:40"]]');
  ok('  12:00-2:40 in 20s is 8 slots and 3:00-4:40 is 5, none left over', app._conferencePreviewText('12:00', '14:40', 20) === '8 slots, 12:00 PM\u20132:40 PM' && app._conferencePreviewText('15:00', '16:40', 20) === '5 slots, 3:00 PM\u20134:40 PM');

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
      't-2': { id: 't-2', first_name: 'Vera', last_name: 'Bose', user_type: 'teacher' },
      'st-2': { id: 'st-2', first_name: 'Kit', last_name: 'Lonely', user_type: 'student' },
      'st-3': { id: 'st-3', first_name: 'Ash', last_name: 'Unbooked', user_type: 'student' },
    };
    const c = {
      days: [{ id: 'd1', day: '2099-03-04', title: 'Spring conferences', is_open: true }],
      slots: [
        { id: 'sl-1', day_id: 'd1', starts_at: '08:10:00', ends_at: '08:30:00', teacher_ids: ['t-1', 't-2'], assigned_teacher_ids: ['t-1'], teachers_matched: true, student_id: 'st-1', booked_by: 'p-1', confirmed_at: null },
        { id: 'sl-2', day_id: 'd1', starts_at: '08:30:00', ends_at: '08:50:00', teacher_ids: ['t-1'], student_id: null },
        { id: 'sl-3', day_id: 'd1', starts_at: '08:10:00', ends_at: '08:30:00', teacher_ids: ['t-1', 't-2'], assigned_teacher_ids: ['t-1', 't-2'], teachers_matched: false, student_id: 'st-2', booked_by: 'a-1', contact_email: null, confirmed_at: null },
      ],
      teachers: [{ id: 't-1', name: 'Numa Ratio', core: true }, { id: 't-2', name: 'Vera Bose', core: false }],
      students: [{ id: 'st-1', name: 'Wren Orchard', grade: '7' }],
      parentsOf: { 'st-1': [{ name: 'Paz Orchard', email: 'paz@example.test' }] },
      expected: new Set(['st-1', 'st-2', 'st-3']),
      byId: by,
      name: (p) => p ? `${p.first_name} ${p.last_name}` : '',
    };
    const page = app._renderConferenceAdmin(c);
    ok('the admin sees who is booked, their parents and that a parent booked it', /<b>Wren Orchard<\/b>/.test(page) && /Paz Orchard/.test(page) && /booked by parent/.test(page));
    ok('  a free slot offers a student to add', /id="conf-pick-sl-2"/.test(page) && /app\.fillConferenceSlot\('sl-2'\)/.test(page));
    ok('  the day shows its count and its open switch', /2 of 3 booked/.test(page) && /checked onchange="app\.setConferenceDayOpen\('d1', this\.checked\)"/.test(page));
    ok('  math and English teachers start ticked, others do not', /value="t-1" checked/.test(page) && /value="t-2" >/.test(page));
    ok('  times read as a clock', /8:10 AM–8:30 AM/.test(page));
    ok("a booked slot shows the student's assigned teacher, not the whole pool", /<td style="padding: 6px 8px;"><b>Numa Ratio<\/b>/.test(page) && !/<b>Numa Ratio, Vera Bose<\/b>[\s\S]{0,400}conf-email-sl-1/.test(page));
    ok("  and flags a slot without the student's math or English teacher", /None of this student's math or English teachers is in this slot/.test(page));
    ok('  and a teacher in two conferences at once', /A teacher here has another conference at the same time/.test(page) && /A teacher has two conferences at the same time/.test(page));
    ok("the parent's email is shown, and a family with nobody to tell is flagged", /Paz Orchard &lt;paz@example\.test&gt;/.test(page) && /No parent account/.test(page) && /Nobody to send the confirmation to: add an email/.test(page));
    ok('  each booking has an "also email" box for any address', /id="conf-email-sl-3"/.test(page) && /saveConferenceContactEmail\('sl-3'\)/.test(page));
    ok('the review offers Finalize with the count, and lists who has no time', /Finalize & send 2 confirmations/.test(page) && /1 student in math or English with no time on this day/.test(page) && /Ash Unbooked/.test(page));
    ok('  and warns the booking with nobody to send to will stay unconfirmed', /1 booking has nobody to send to/.test(page));
    const sent = { ...c, days: [{ ...c.days[0], finalized_at: '2099-03-01T10:00:00Z' }], slots: c.slots.map(x => x.student_id ? { ...x, confirmed_at: '2099-03-01T10:00:00Z' } : x) };
    const after = app._renderConferenceAdmin(sent);
    ok('after finalizing it says so, offers Resend, and no Finalize button', /<b>Finalized<\/b>/.test(after) && /every family has been sent their time/.test(after) && /resendConferenceSlot\('sl-1', 'd1'\)/.test(after) && !/confirmConferenceDay/.test(after));
    sent.slots.push({ id: 'sl-4', day_id: 'd1', starts_at: '09:00:00', ends_at: '09:20:00', teacher_ids: ['t-2'], assigned_teacher_ids: ['t-2'], teachers_matched: true, student_id: 'st-3', booked_by: 'a-1', confirmed_at: null });
    ok('  a booking added afterwards offers to send just the new one', /Send 1 new confirmation/.test(app._renderConferenceAdmin(sent)));
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
    ok('the parent sees their booking with its teacher, as booked (not yet confirmed), with Cancel', /\u{1F552} <b>Wren Orchard<\/b>: 8:10 AM\u20138:30 AM with Numa Ratio/u.test(shown) && /Booked \u00b7 the school will confirm<\/span>/.test(shown) && /cancelParentConference\('sl-1'/.test(shown), shown);
    ok('  a child with a booking is offered other times as a move', /Pick another time to move Wren Orchard/.test(shown) && /bookParentConference\('sl-2', 'k1'\)/.test(shown) && !/bookParentConference\('sl-3'/.test(shown));
    ok('  and can switch to their other child', /showParentConferences\('k2'\)/.test(shown));
    await a.showParentConferences('k2');
    ok("  the other child is offered their own teacher's slot", /Pick a time for Ash Orchard/.test(shown) && /bookParentConference\('sl-3', 'k2'\)/.test(shown));
    days[0].slots[0].confirmed = true;
    await a.showParentConferences();
    ok('a confirmed time has no Cancel and no other times, and says to contact the office', /Confirmed \u00b7 to change it, contact the school office/.test(shown) && !/cancelParentConference\('sl-1'/.test(shown) && !/bookParentConference\('sl-2'/.test(shown), shown);
    days[0].slots[0].confirmed = false;
    days[0].is_open = false;
    days[0].slots = days[0].slots.filter(x => x.student_id);
    await a.showParentConferences();
    ok('a closed day still shows their booking, and says sign-up is closed', /Wren Orchard<\/b>: 8:10 AM/.test(shown) && /Sign-up for this day is closed/.test(shown));
    ok('  with no Cancel (they could not book again), only "contact the school office"', !/cancelParentConference/.test(shown) && /the school will confirm\. To change it, contact the school office/.test(shown));
    days[0].is_open = true;
    notes.length = 0;
    await a.bookParentConference('sl-2', 'k1');
    ok('booking goes through the database and says where they moved from', calls.some(([fn, args]) => fn === 'rt_book_conference_slot' && args.p_slot === 'sl-2' && args.p_student === 'k1') && /Moved from 8:10 AM/.test(notes[0]?.[0]), JSON.stringify(notes));
    ok('the parent screen never reads the slot tables directly', !/from\('conference_slots'\)/.test(method('showParentConferences') + method('_loadParentConferences') + method('bookParentConference')));
  }

  // ---- sending, and what the family gets ----
  {
    const notes = [];
    const a = Object.create(proto);
    a.showNotification = (msg, kind) => notes.push([msg, kind]);
    a._reportConferenceSend({ sent: 2, notifications: 2, emails: 1, nobody_to_tell: ['Kit Lonely'] });
    ok('after sending the admin is told what went and who had nobody to tell', /Sent 2 confirmations: 2 in-app, 1 email\. Not sent, nobody to tell: Kit Lonely/.test(notes[0][0]) && notes[0][1] === 'warning', notes[0][0]);
    a.userInfo = { profile: { user_type: 'parent' } };
    let opened = false;
    a.showParentConferences = () => { opened = true; };
    const dest = a.notificationDestination({ type: 'conference', title: 'Parent-teacher conference confirmed' });
    dest.then();
    ok("a conference notification opens the parent's conference screen", dest.section === 'home' && opened && a.notificationTypeConfig('conference').icon === '🤝');
    a.userInfo = { profile: { user_type: 'teacher' } };
    let mine = false;
    a.showMyConferenceSchedule = () => { mine = true; };
    opened = false;
    const tdest = a.notificationDestination({ type: 'conference', title: 'Your conference schedule is set', metadata: { for: 'teacher', kind: 'schedule' } });
    tdest.then();
    ok("  a teacher's conference note opens their own schedule", mine && !opened && tdest.label === 'Your conference schedule');
    a.userInfo = { profile: { user_type: 'admin' } };
    mine = false;
    a.notificationDestination({ type: 'conference', metadata: { for: 'teacher' } }).then();
    ok("  so does an admin's, when they are in the slots", mine);
    notes.length = 0;
    a.showNotification = (msg, kind) => notes.push([msg, kind]);
    a._reportConferenceSend({ sent: 3, notifications: 3, emails: 2, teachers: 2, nobody_to_tell: [] });
    ok('  Finalize says how many teachers were told', /^Sent 3 confirmations: 3 in-app, 2 emails\. 2 teachers told\.$/.test(notes[0][0]) && notes[0][1] === 'success', notes[0][0]);
    const bad = [];
    global.document = { getElementById: () => ({ value: 'not-an-email' }) };
    a.showNotification = (msg) => bad.push(msg);
    let wrote = false;
    a.supabaseQuery = async () => { wrote = true; return {}; };
    await a.saveConferenceContactEmail('sl-3');
    ok('a malformed "also email" is refused before saving', !wrote && /does not look right/.test(bad[0]));
  }

  // ---- guards found walking the journeys ----
  {
    const notes = [], asked = [];
    let answer = false;
    global.confirm = (q) => { asked.push(q); return answer; };
    const a = Object.create(proto);
    a.showNotification = (msg, kind) => notes.push([msg, kind]);
    a._refreshConferenceAdmin = async () => {};
    let writes = 0, rpcs = [];
    a.supabaseQuery = async () => { writes++; return {}; };
    a.auth = { supabase: { from: () => ({ update: () => ({ eq: () => ({}) }), insert: () => ({}) }), rpc: async (fn, args) => { rpcs.push([fn, args]); return { error: null }; } } };
    a._conf = {
      slots: [
        { id: 'sl-1', day_id: 'd1', starts_at: '08:10:00', ends_at: '08:30:00', teacher_ids: ['t-1'], student_id: 'st-1', booked_by: 'p-1' },
        { id: 'sl-2', day_id: 'd1', starts_at: '08:30:00', ends_at: '08:50:00', teacher_ids: ['t-1'], student_id: null },
      ],
      byId: { 'p-1': { user_type: 'parent' }, 'st-1': { first_name: 'Wren', last_name: 'Orchard' } },
      name: (p) => p ? `${p.first_name} ${p.last_name}` : '',
    };
    await a.setConferenceDayOpen('d-empty', true);
    ok('a day with no times cannot be opened to parents', writes === 0 && /Add time slots first/.test(notes[0]?.[0]));
    await a.setConferenceDayOpen('d1', true);
    ok('  a day with times can', writes === 1);

    const els = { 'conf-start-d1': { value: '08:10' }, 'conf-end-d1': { value: '09:10' }, 'conf-len-d1': { value: '20' }, 'conf-pick-sl-2': { value: 'st-1' } };
    let boxes = [{ checked: true, value: 't-1' }];
    global.document = { getElementById: (id) => els[id], querySelectorAll: () => boxes };
    writes = 0;
    await a.addConferenceSlots('d1');
    ok('adding times over the same teacher\'s times asks first, and No adds nothing', /2 of these 3 times overlap slots already on this day with the same teacher/.test(asked.pop()) && writes === 0);
    boxes = [{ checked: true, value: 't-2' }];
    await a.addConferenceSlots('d1');
    ok('  a second set with a different teacher (two families at once) is added without asking', asked.length === 0 && writes === 1);

    await a.fillConferenceSlot('sl-2');
    ok('putting a student in a second time on the same day asks first', /Wren Orchard already has 8:10 AM on this day/.test(asked.pop()) && rpcs.length === 0);
    await a.clearConferenceSlot('sl-1');
    ok('clearing a time a parent booked warns they will be told', /A parent booked this time\. Clear it\? They will be told it is cancelled\./.test(asked.pop()) && rpcs.length === 0);
    answer = true;
    await a.clearConferenceSlot('sl-1');
    ok('  and clears it on Yes', rpcs.some(([fn, args]) => fn === 'rt_cancel_conference_slot' && args.p_slot === 'sl-1'));
    delete global.confirm;
  }
  {
    const load = method('loadParentData');
    ok("the parent's home re-draws once conferences are loaded, past the half-second de-duplication", /await this\._loadParentConferences\(\);[\s\S]{0,200}this\._lastHomeSetup = 0;\s*this\.setupHomeContent\(\);/.test(load));
  }

  // ---- a teacher's own schedule ----
  {
    const host = { innerHTML: 'stale' };
    global.document = { getElementById: (id) => (id === 'conference-schedule-card' ? host : null) };
    let shown = null;
    const a = Object.create(proto);
    a.showModal = (id, title, body) => { shown = body; };
    a.showNotification = () => {};
    let days = [{ id: 'd1', day: '2099-03-04', title: 'Spring conferences', finalized: false, slots: [
      { id: 'sl-1', starts_at: '08:10', ends_at: '08:30', student: 'Wren Orchard', grade: '7', parents: ['Paz Orchard'], with: [], confirmed: false },
      { id: 'sl-2', starts_at: '08:30', ends_at: '08:50', student: null, grade: null, parents: null, with: ['Vera Bose'], confirmed: false },
    ] }];
    const calls = [];
    a.auth = { supabase: { rpc: async (fn) => { calls.push(fn); return { data: days, error: null }; } } };
    await a._loadConferenceScheduleCard();
    ok('the teacher home card sums up their day', calls[0] === 'rt_my_conference_schedule' && /Your parent-teacher conferences/.test(host.innerHTML) && /1 conference, 8:10 AM\u20138:50 AM \u00b7 1 open/.test(host.innerHTML), host.innerHTML);
    await a.showMyConferenceSchedule();
    ok('  and opens their schedule: student, grade, parents, and who else is in an open time', /<b>Wren Orchard<\/b> <span style="color: var\(--muted\);">\(gr 7\)<\/span>/.test(shown) && /Paz Orchard/.test(shown) && /not confirmed yet/.test(shown) && /Vera Bose/.test(shown) && /times may change/.test(shown), shown);
    days[0].finalized = true; days[0].slots[0].confirmed = true;
    await a.showMyConferenceSchedule();
    ok('  after finalizing it says families have their times', /families have been sent their times/.test(shown) && !/not confirmed yet/.test(shown));
    days = [];
    await a._loadConferenceScheduleCard();
    ok('  with no times coming up the card goes away', host.innerHTML === '');
    const home = method('getTeacherHomeContent');
    ok('  the card has a place on the teacher home page and is loaded with it', /<div id="conference-schedule-card"><\/div>/.test(home) && /this\._loadConferenceScheduleCard\(\);/.test(home));
  }

  // ---- where: the places list, the review's picker, and what people see ----
  {
    const by = {
      'st-1': { id: 'st-1', first_name: 'Wren', last_name: 'Orchard', user_type: 'student' },
      'st-2': { id: 'st-2', first_name: 'Kit', last_name: 'Lonely', user_type: 'student' },
      't-1': { id: 't-1', first_name: 'Numa', last_name: 'Ratio', user_type: 'teacher' },
    };
    const c = {
      days: [{ id: 'd1', day: '2099-03-04', title: 'Spring conferences', is_open: true }],
      slots: [
        { id: 'sl-1', day_id: 'd1', starts_at: '08:10:00', ends_at: '08:30:00', teacher_ids: ['t-1'], assigned_teacher_ids: ['t-1'], teachers_matched: true, student_id: 'st-1', booked_by: 'a-1', confirmed_at: null, location_id: 'loc-old' },
        { id: 'sl-2', day_id: 'd1', starts_at: '08:30:00', ends_at: '08:50:00', teacher_ids: ['t-1'], assigned_teacher_ids: ['t-1'], teachers_matched: true, student_id: 'st-2', booked_by: 'a-1', confirmed_at: '2099-03-01T10:00:00Z', location_id: null },
        { id: 'sl-3', day_id: 'd1', starts_at: '08:50:00', ends_at: '09:10:00', teacher_ids: ['t-1'], student_id: null },
      ],
      teachers: [{ id: 't-1', name: 'Numa Ratio', core: true }],
      students: [], parentsOf: { 'st-1': [{ name: 'Paz Orchard', email: 'paz@example.test' }], 'st-2': [{ name: 'Ivo Lonely', email: '' }] },
      expected: new Set(), byId: by, name: (p) => p ? `${p.first_name} ${p.last_name}` : '',
      locations: [{ id: 'loc-4', name: 'Room 4', active: true }, { id: 'loc-lib', name: 'Library', active: true }, { id: 'loc-old', name: 'Old Annex', active: false }],
    };
    const page = app._renderConferenceAdmin(c);
    ok('the admin keeps a list of places, with a way to add one and take one off', /Places <span[^>]*>2: Room 4, Library/.test(page) && /retireConferenceLocation\('loc-4'\)/.test(page) && /id="conf-new-place"/.test(page) && !/retireConferenceLocation\('loc-old'\)/.test(page), page.slice(0, 1500));
    const pick = (page.match(/<select id="conf-place-sl-1"[\s\S]*?<\/select>/) || [''])[0];
    ok('  each booking has a Where picker from that list', /setConferenceSlotLocation\('sl-1', this\.value\)/.test(pick) && /Room 4/.test(pick) && /Library/.test(pick), pick);
    ok("  which keeps a place taken off the list if the booking already has it", /value="loc-old" selected>Old Annex \(off the list\)/.test(pick));
    ok('  a free slot has none', !/conf-place-sl-3/.test(page));
    ok('the review counts bookings with no place and offers one place for all of them', /1 booking has no place yet/.test(page) && /id="conf-dayplace-d1"/.test(page) && /setConferenceDayLocation\('d1'\)/.test(page));
    const none = app._renderConferenceAdmin({ ...c, locations: [] });
    ok('  with no places yet it says to add them first, and the list opens', /Add places under/.test(none) && /<details class="card"[^>]*open>/.test(none));

    // the writes
    const notes = [], asked = [], updates = [], inserts = [];
    let answer = false;
    global.confirm = (q) => { asked.push(q); return answer; };
    const els = { 'conf-new-place': { value: '  library ' }, 'conf-dayplace-d1': { value: 'loc-4' } };
    global.document = { getElementById: (id) => els[id] };
    const a = Object.create(proto);
    a._conf = c;
    a.showNotification = (msg, kind) => notes.push([msg, kind]);
    a._refreshConferenceAdmin = async () => {};
    a.supabaseQuery = async (fn) => fn();
    const table = (name) => ({
      insert: (row) => { inserts.push([name, row]); return { error: null }; },
      update: (row) => ({
        eq: (k, v) => { updates.push([name, row, k, v]); return { error: null }; },
        in: (k, v) => { updates.push([name, row, k, v]); return { error: null }; },
      }),
    });
    a.auth = { supabase: { from: table } };
    await a.addConferenceLocation();
    ok('a place already on the list is not added twice, whatever its case', inserts.length === 0 && /Library is already on the list/.test(notes.pop()[0]));
    els['conf-new-place'].value = 'old annex';
    await a.addConferenceLocation();
    ok('  one taken off the list comes back instead of doubling up', inserts.length === 0 && JSON.stringify(updates.pop()) === '["conference_locations",{"active":true},"id","loc-old"]');
    els['conf-new-place'].value = '  Gym   B ';
    await a.addConferenceLocation();
    ok('  a new one is added, tidied', JSON.stringify(inserts.pop()) === '["conference_locations",{"name":"Gym B"}]');

    await a.setConferenceSlotLocation('sl-1', 'loc-4');
    ok('picking a place before the family is told just saves it', asked.length === 0 && JSON.stringify(updates.pop()) === '["conference_slots",{"location_id":"loc-4"},"id","sl-1"]');
    await a.setConferenceSlotLocation('sl-2', 'loc-4');
    ok('  after they were sent their time it asks first, and No changes nothing', /Tell them and the teachers about the new place\?/.test(asked.pop()) && updates.length === 0);
    answer = true;
    await a.setConferenceSlotLocation('sl-2', 'loc-4');
    ok('  and Yes saves it (the database tells them)', updates.length === 1 && /family and teachers were told/.test(notes.pop()[0]));
    updates.length = 0;
    await a.setConferenceDayLocation('d1');
    ok('one place for the day goes to every booking without one, saying who will be told', /1 of these families has been sent their time/.test(asked.pop()) && JSON.stringify(updates.pop()) === '["conference_slots",{"location_id":"loc-4"},"id",["sl-2"]]', JSON.stringify(updates));
    delete global.confirm;

    // what the parent and the teacher see
    let shown = null;
    const pa = Object.create(proto);
    pa.children = [{ id: 'k1', first_name: 'Wren', last_name: 'Orchard' }];
    pa.showModal = (id, title, body) => { shown = body; };
    pa.showNotification = () => {};
    pa.auth = { supabase: { rpc: async () => ({ data: [{ id: 'd1', day: '2099-03-04', title: 'Spring', is_open: false, slots: [
      { id: 'sl-1', starts_at: '08:10', ends_at: '08:30', teachers: ['Numa Ratio'], location: 'Room 4', student_id: 'k1', confirmed: true, for_children: ['k1'] }] }], error: null }) } };
    await pa.showParentConferences();
    ok("the parent's booking says where", /8:10 AM–8:30 AM with Numa Ratio in <b>Room 4<\/b>/.test(shown), shown);
    const ta = Object.create(proto);
    ta.showModal = (id, title, body) => { shown = body; };
    ta.showNotification = () => {};
    global.document = { getElementById: () => null };
    ta.auth = { supabase: { rpc: async () => ({ data: [{ id: 'd1', day: '2099-03-04', title: 'Spring', finalized: true, slots: [
      { id: 'sl-1', starts_at: '08:10', ends_at: '08:30', student: 'Wren Orchard', grade: '7', parents: ['Paz Orchard'], with: [], location: 'Room 4', confirmed: true }] }], error: null }) } };
    await ta.showMyConferenceSchedule();
    ok("  and so does the teacher's schedule", /<th[^>]*>Where<\/th>/.test(shown) && /<td style="padding: 6px 8px;">Room 4<\/td>/.test(shown));
  }

  // ---- the admin tile ----
  ok('the admin page has a Conferences tile', /onclick="app\.openConferenceAdmin\(\)"[\s\S]{0,300}Conferences/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
