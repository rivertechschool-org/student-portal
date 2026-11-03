// Riven and parent-teacher conferences.
//
// Riven reads and changes conferences through the same data and the same
// database calls as the Conferences tool (rt_book_conference_slot,
// rt_cancel_conference_slot, rt_confirm_conference_day, the two tables), so
// what the database does about families and teachers is tested in the
// backend repo. This checks what Riven says before it acts, which call it
// makes, and that teachers can look but not change.
//
// Which sentence reaches which command is in debug-tools/nlp-stress.js.
//
// Run: node tests/riven-conferences.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  const m = new RegExp('\\n {4,6}(?:async\\s+)?' + name + '\\s*\\(').exec(html);
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

const names = ['_rivenConfText', '_rivenConferenceDay', '_rivenConferenceData', '_rivenConferenceStudentSlots', '_rivenConferencePlaceName',
  '_rivenConferenceLine', '_rivenConferenceFreeText', 'terminalViewConferences', '_rivenMyConferences', '_rivenReportConferenceSend',
  'terminalConfirmConferences', '_rivenStudentCoreTeachers', 'terminalBookConference', 'terminalCancelConference', '_rivenConferenceBlock',
  'terminalAddConferenceSlots', 'terminalSetConferenceLocation', 'terminalAddConferencePlace', '_rivenRequireAdmin', '_rivenPolicyError',
  '_confClock', '_confMinutes', '_confHHMM', '_confDayLabel', '_conferenceSlotTimes', '_conferenceZones', '_conferenceDayReview',
  '_localDateStr', '_rivenClockTime', '_rivenMonthDayDates', '_rivenMonthIndex', '_rivenPhraseToDate', '_rivenAbsenceDayNumbers', 'escapeHtml'];
const proto = eval(`({ ${names.map(n => method(n)).join(',\n')} })`);

// Dates from today, so the days are always still to come.
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const D1 = iso(7), D2 = iso(14), NEW = iso(21), PAST = iso(-3);

const people = {
  'st-noah': { id: 'st-noah', first_name: 'Noah', last_name: 'Williams', user_type: 'student' },
  'st-wren': { id: 'st-wren', first_name: 'Wren', last_name: 'Orchard', user_type: 'student' },
  'st-kit': { id: 'st-kit', first_name: 'Kit', last_name: 'Lonely', user_type: 'student' },
  't-math': { id: 't-math', first_name: 'Numa', last_name: 'Ratio', user_type: 'teacher' },
  't-eng': { id: 't-eng', first_name: 'Vera', last_name: 'Bose', user_type: 'teacher' },
  'p-wren': { id: 'p-wren', first_name: 'Paz', last_name: 'Orchard', user_type: 'parent' },
};
const NOAH = { id: 'st-noah', full_name: 'Noah Williams' };
const WREN = { id: 'st-wren', full_name: 'Wren Orchard' };

function fixture() {
  return {
    days: [
      { id: 'd1', day: D1, title: 'Fall conferences', is_open: true, finalized_at: null },
      { id: 'd2', day: D2, title: 'Fall conferences', is_open: false, finalized_at: '2026-11-01T10:00:00Z' },
    ],
    slots: [
      { id: 's1', day_id: 'd1', starts_at: '08:10:00', ends_at: '08:30:00', teacher_ids: ['t-math'], assigned_teacher_ids: ['t-math'], student_id: 'st-wren', booked_by: 'p-wren', confirmed_at: null, location_id: null },
      { id: 's2', day_id: 'd1', starts_at: '08:30:00', ends_at: '08:50:00', teacher_ids: ['t-math'], student_id: null, location_id: null },
      { id: 's3', day_id: 'd1', starts_at: '08:50:00', ends_at: '09:10:00', teacher_ids: ['t-eng'], student_id: null, location_id: null },
      { id: 's3b', day_id: 'd1', starts_at: '08:50:00', ends_at: '09:10:00', teacher_ids: ['t-math'], student_id: null, location_id: null },
      { id: 's4', day_id: 'd2', starts_at: '13:00:00', ends_at: '13:20:00', teacher_ids: ['t-eng'], assigned_teacher_ids: ['t-eng'], student_id: 'st-kit', booked_by: 'a-1', confirmed_at: '2026-11-01T10:00:00Z', location_id: 'loc-4' },
      { id: 's5', day_id: 'd2', starts_at: '13:20:00', ends_at: '13:40:00', teacher_ids: ['t-eng'], student_id: null, location_id: null },
    ],
    teachers: [{ id: 't-math', name: 'Numa Ratio', core: true }, { id: 't-eng', name: 'Vera Bose', core: true }, { id: 't-art', name: 'Ida Easel', core: false }],
    students: [], parentsOf: { 'st-wren': [{ name: 'Paz Orchard', email: 'paz@example.test' }], 'st-kit': [{ name: 'Lu Lonely', email: 'lu@example.test' }] },
    expected: new Set(['st-wren', 'st-kit', 'st-noah']),
    byId: people, name: (p) => p ? `${p.first_name} ${p.last_name}` : '',
    locations: [{ id: 'loc-4', name: 'Room 4', active: true }, { id: 'loc-lib', name: 'Library', active: true }, { id: 'loc-old', name: 'Old Annex', active: false }],
  };
}

function makeApp({ role = 'admin', c = fixture(), rpcData = {}, enrol = {} } = {}) {
  const a = Object.create(proto);
  Object.assign(a, { said: [], errors: [], ok: [], asked: null, run: null, undos: [], rpcs: [], writes: [] });
  a.userInfo = { profile: { user_type: role }, user: { id: 'me' } };
  a._showRivenMessage = (h) => a.said.push(h);
  a.terminalPrintError = (m) => a.errors.push(m);
  a._naturalSuccess = (m) => a.ok.push(Array.isArray(m) ? m[0] : m);
  a._pushUndo = (desc, fn) => a.undos.push({ desc, fn });
  a._requestConfirmation = (summary, run) => { a.asked = summary; a.run = run; };
  a._loadConferenceAdmin = async () => c;
  const chain = (table) => {
    const q = { table, op: 'select', filters: [] };
    const api = {
      select() { return api; },
      insert(row) { q.op = 'insert'; q.row = row; return api; },
      update(row) { q.op = 'update'; q.row = row; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(k, v) { q.filters.push(['eq', k, v]); return api; },
      in(k, v) { q.filters.push(['in', k, v]); return api; },
      is(k, v) { q.filters.push(['is', k, v]); return api; },
      single() { q.single = true; return api; },
      then(res, rej) {
        if (q.op !== 'select') a.writes.push(q);
        let data = null;
        if (q.op === 'insert') data = q.single ? { id: 'new-' + table } : [].concat(q.row).map((r, i) => ({ id: `new-${i}` }));
        if (q.op === 'select' && table === 'class_enrollments') data = (enrol.classes || []).map(id => ({ class_id: id }));
        if (q.op === 'select' && table === 'classes') data = enrol.rows || [];
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return api;
  };
  a.auth = { supabase: {
    from: chain,
    rpc: async (fn, args) => { a.rpcs.push([fn, args]); return { data: rpcData[fn] ?? { ok: true }, error: null }; },
  } };
  return a;
}
const E = (text, student = null) => ({ original: text, student: student ? { student } : null });
proto._rivenResolvedStudent = (e) => e?.student?.student || null;

(async () => {
  // ---- looking ----
  {
    const t = makeApp({ role: 'teacher', rpcData: { rt_my_conference_schedule: [{ id: 'd1', day: D1, finalized: true, slots: [
      { starts_at: '08:10', ends_at: '08:30', student: 'Wren Orchard', location: 'Room 4' }, { starts_at: '08:30', ends_at: '08:50', student: null }] }] } });
    await t.terminalViewConferences(E('my conferences'));
    ok('a teacher asking about conferences gets their own schedule, with the place', t.rpcs[0][0] === 'rt_my_conference_schedule' && /Your conferences/.test(t.said[0]) && /8:10 AM <b>Wren Orchard<\/b> in Room 4/.test(t.said[0]) && /8:30 AM <span[^>]*>open/.test(t.said[0]), t.said[0]);
    await t.terminalViewConferences(E('when is noahs conference', NOAH));
    ok("  and about a student who isn't in it, says so", /Noah Williams has no conference with you coming up/.test(t.said[1]));

    const a = makeApp();
    await a.terminalViewConferences(E('conference slots'));
    const out = a.said[0];
    ok('an admin sees every day coming up: counts, state and who is booked', /1 of 4 booked · sign-up open/.test(out) && /1 of 2 booked · finalized/.test(out) && /<b>Wren Orchard<\/b> with Numa Ratio <span[^>]*>\(no place yet\)/.test(out) && /<b>Kit Lonely<\/b> with Vera Bose in Room 4 ✓/.test(out), out);
    ok('  what is left to do', /1 not sent yet · 1 with no place · 2 math or English students with no time/.test(out), out);
    ok('  and the open times', /Open: 8:30 AM, 8:50 AM, 8:50 AM/.test(out));
    await a.terminalViewConferences(E(`conferences on ${D2}`));
    ok('  a named day shows only that day', /1 of 2 booked/.test(a.said[1]) && !/1 of 4 booked/.test(a.said[1]));
    await a.terminalViewConferences(E("when is wren's conference", WREN));
    ok("a student's time, with teachers and place", /<b>Wren Orchard<\/b>/.test(a.said[2]) && /8:10 AM–8:30 AM <b>Wren Orchard<\/b> with Numa Ratio/.test(a.said[2]) && /not sent yet/.test(a.said[2]), a.said[2]);
    await a.terminalViewConferences(E("when is noah's conference", NOAH));
    ok('  a student with none is told the open times', /Noah Williams has no conference time yet\. Open on .*: 8:30 AM, 8:50 AM, 8:50 AM\./.test(a.said[3]), a.said[3]);
    await a.terminalViewConferences(E(`conferences on ${NEW}`));
    ok('  a date with no conference day says so', /There is no conference day on/.test(a.errors[0]));
  }

  // ---- confirming ----
  {
    const t = makeApp({ role: 'teacher' });
    await t.terminalConfirmConferences(E('confirm conferences'));
    ok('a teacher cannot send confirmations', /Only an admin can send conference confirmations/.test(t.errors[0]) && t.asked === null);

    const a = makeApp({ rpcData: { rt_confirm_conference_day: { sent: 1, notifications: 1, emails: 1, teachers: 1, nobody_to_tell: [] } } });
    await a.terminalConfirmConferences(E('confirm conferences'));
    ok('with no day named, it picks the one day with confirmations to send', /Finalize <b>[^<]+<\/b>: 1 confirmation to families \(in-app and email\), then close sign-up\?/.test(a.asked), a.asked);
    ok('  and warns the booking with no place will not say where', /1 of them has no place yet, so the message won(?:'|&#39;)t say where/.test(a.asked));
    ok('  nothing is sent before the yes', a.rpcs.length === 0);
    await a.run();
    ok('  on yes, it is the Finalize call for that day', JSON.stringify(a.rpcs[0]) === '["rt_confirm_conference_day",{"p_day":"d1"}]' && /Sent 1 confirmation: 1 in-app, 1 email\. 1 teacher told\./.test(a.ok[0]), JSON.stringify(a.rpcs));
    await a.terminalConfirmConferences(E(`confirm conferences for ${D2}`));
    ok('  a day with everyone sent says so', /Every family booked on .* has been sent their time/.test(a.said[0]));
    a.asked = null;
    await a.terminalConfirmConferences(E("resend kit's conference confirmation", { id: 'st-kit', full_name: 'Kit Lonely' }));
    await a.run();
    ok('with a student named, just their family, as a resend', /^Resend Kit Lonely's family/.test(a.asked) && JSON.stringify(a.rpcs[1]) === '["rt_confirm_conference_day",{"p_day":"d2","p_slot":"s4"}]');
  }

  // ---- booking ----
  {
    const t = makeApp({ role: 'teacher' });
    await t.terminalBookConference(E('book noah for conferences at 8:30', NOAH));
    ok('a teacher cannot book', /Only an admin can book a conference time/.test(t.errors[0]));

    let a = makeApp();
    await a.terminalBookConference(E(`book noah for a conference on ${D1}`, NOAH));
    ok('with no time, Riven lists the open ones', /What time for Noah Williams\? Open on .*: 8:30 AM, 8:50 AM, 8:50 AM\./.test(a.said[0]), a.said[0]);
    await a.terminalBookConference(E(`book noah for conferences on ${D1} at 8:10`, NOAH));
    ok('  a taken time names who has it', /8:10 AM is taken by Wren Orchard/.test(a.errors[0]));
    await a.terminalBookConference(E(`book noah for conferences on ${D1} at 9:40`, NOAH));
    ok('  a time no slot starts at says so', /No conference time starts at 9:40 AM/.test(a.errors[1]));
    await a.terminalBookConference(E('book noah for conferences at 8:30', NOAH));
    ok('  two days coming up and none named: it asks which', /Which day\?/.test(a.errors[2]));
    await a.terminalBookConference(E(`book noah for conferences on ${D1} at 8:30`, NOAH));
    ok('a free time: asks with the teacher', /Book <b>Noah Williams<\/b> for .* at <b>8:30 AM<\/b> with Numa Ratio\?/.test(a.asked), a.asked);
    await a.run();
    ok('  and books it through the same call as the tool', JSON.stringify(a.rpcs) === '[["rt_book_conference_slot",{"p_slot":"s2","p_student":"st-noah"}]]' && a.undos.length === 1);
    await a.undos[0].fn();
    ok('  undo frees it again', JSON.stringify(a.rpcs[1]) === '["rt_cancel_conference_slot",{"p_slot":"s2"}]');

    a = makeApp({ enrol: { classes: ['c-eng'], rows: [{ teacher_id: 't-eng', secondary_teacher_id: null }] } });
    await a.terminalBookConference(E(`book noah for conferences on ${D1} at 8:50`, NOAH));
    ok("two families at once: the slot with the student's own teacher", /with Vera Bose\?/.test(a.asked), a.asked);

    a = makeApp();
    await a.terminalBookConference(E('move wren to 8:30 for conferences', WREN));
    ok('a student with a time is moved, and the day comes from their booking', /This moves them from 8:10 AM\./.test(a.asked) && /at <b>8:30 AM<\/b>/.test(a.asked), a.asked);
    await a.run();
    ok('  new time first, then the old one freed', JSON.stringify(a.rpcs.map(r => r[0] + ':' + r[1].p_slot)) === '["rt_book_conference_slot:s2","rt_cancel_conference_slot:s1"]');
    const c = fixture();
    c.slots[0].confirmed_at = '2026-11-01T10:00:00Z';
    a = makeApp({ c });
    await a.terminalBookConference(E('move wren to 8:30 for conferences', WREN));
    ok('  moving a time the family was sent warns they will hear it is cancelled', /will be told it is cancelled; say "confirm conferences" to send the new one/.test(a.asked));
  }

  // ---- cancelling ----
  {
    let a = makeApp();
    await a.terminalCancelConference(E("cancel noah's conference", NOAH));
    ok('cancelling a student with no time says so', /Noah Williams has no conference time coming up/.test(a.errors[0]));
    await a.terminalCancelConference(E("cancel wren's conference", WREN));
    ok('  a parent-booked time warns the parent will be told', /Cancel <b>Wren Orchard<\/b>'s conference on .* at 8:10 AM\?/.test(a.asked) && /A parent booked it and will be told/.test(a.asked));
    await a.run();
    ok('  and clears it through the same call as the tool', JSON.stringify(a.rpcs[0]) === '["rt_cancel_conference_slot",{"p_slot":"s1"}]' && /The time is open again/.test(a.ok[0]));
    await a.undos[0].fn();
    ok('  undo books it back', JSON.stringify(a.rpcs[1]) === '["rt_book_conference_slot",{"p_slot":"s1","p_student":"st-wren"}]');
    a = makeApp();
    await a.terminalCancelConference(E("cancel kit's conference", { id: 'st-kit', full_name: 'Kit Lonely' }));
    ok('  a confirmed time warns the family and teachers will be told', /Their family and teachers were sent this time/.test(a.asked));
  }

  // ---- adding slots ----
  {
    const a = makeApp();
    ok('the block: a range, a length, dates left alone', JSON.stringify(a._rivenConferenceBlock(`add conference slots on ${NEW} from 8:10 to 9:10, 30 minutes`)) === '{"start":"08:10","end":"09:10","length":30}');
    ok('  bare hours read as school hours', JSON.stringify(a._rivenConferenceBlock('conference slots nov 20 8 to 3')) === '{"start":"08:00","end":"15:00","length":20}');
    ok('  or a ready-made block by name, "late afternoon" before "afternoon"', a._rivenConferenceBlock('late afternoon conference slots').start === '15:00' && a._rivenConferenceBlock('afternoon conference slots').start === '12:00');

    await a.terminalAddConferenceSlots(E(`add conference slots on ${NEW} from 8:10 to 9:10`));
    ok('a new date: three 20-minute times with the math and English teachers, on a new day', /Add <b>3<\/b> conference times on <b>[^<]+<\/b>, 8:10 AM–9:10 AM, 20 minutes each, with Numa Ratio &amp; Vera Bose\?/.test(a.asked) && /That makes a new conference day/.test(a.asked) && /once sign-up is opened/.test(a.asked), a.asked);
    await a.run();
    const [day, slots] = a.writes;
    ok('  on yes: the day, then its slots', day.table === 'conference_days' && day.op === 'insert' && day.row.day === NEW
      && slots.table === 'conference_slots' && slots.row.length === 3 && slots.row.every(r => r.day_id === 'new-conference_days' && JSON.stringify(r.teacher_ids) === '["t-math","t-eng"]'), JSON.stringify(a.writes));
    await a.undos[0].fn();
    ok('  undo removes the day it made', a.writes[2].table === 'conference_days' && a.writes[2].op === 'delete');

    const b = makeApp();
    await b.terminalAddConferenceSlots(E(`add conference slots on ${D1} late afternoon 25 minutes with ida easel`));
    ok('an existing day, a named block and length, and the teacher named', /Add <b>4<\/b> conference times .* 3:00 PM–4:40 PM, 25 minutes each, with Ida Easel\?/.test(b.asked) && !/new conference day/.test(b.asked) && /parents can book them right away/.test(b.asked), b.asked);
    await b.run();
    await b.undos[0].fn();
    ok('  undo there removes only the new times nobody has booked', b.writes[1].op === 'delete' && JSON.stringify(b.writes[1].filters) === '[["in","id",["new-0","new-1","new-2","new-3"]],["is","student_id",null]]', JSON.stringify(b.writes[1]));
    await b.terminalAddConferenceSlots(E(`add conference slots on ${D1} from 8:10 to 9:10`));
    ok('  times over the same teachers\' times are flagged', /⚠ 3 of them overlap times these teachers already have that day/.test(b.asked), b.asked);
    await b.terminalAddConferenceSlots(E(`add conference slots on ${PAST} morning`));
    ok('a date gone by is refused', /has passed/.test(b.errors[0]));
    await b.terminalAddConferenceSlots(E(`add conference slots on ${NEW}`));
    ok('  no times: it asks for them', /What times\? Say "morning", "afternoon", "late afternoon"/.test(b.errors[1]), b.errors[1]);
  }

  // ---- places ----
  {
    let a = makeApp();
    await a.terminalSetConferenceLocation(E("put wren's conference in the gym", WREN));
    ok('a place not on the list is not invented', /"gym" is not on the conference places list \(Room 4, Library\)\. Add it with "add conference place gym"/.test(a.errors[0]), a.errors[0]);
    await a.terminalSetConferenceLocation(E("put wren's conference in the library", WREN));
    ok("a student's conference into a place on the list", /Put Wren Orchard(?:'|&#39;)s 8:10 AM conference in <b>Library<\/b>\?/.test(a.asked) && !/will be told/.test(a.asked), a.asked);
    await a.run();
    ok('  sets it on their slot', JSON.stringify(a.writes[0].row) === '{"location_id":"loc-lib"}' && JSON.stringify(a.writes[0].filters) === '[["in","id",["s1"]]]');
    await a.undos[0].fn();
    ok('  undo puts back what it had', JSON.stringify(a.writes[1].row) === '{"location_id":null}');

    a = makeApp();
    await a.terminalSetConferenceLocation(E(`conferences on ${D2} are in the library`));
    ok('a whole day: only the bookings with no place, unless told "all"', /Every booking on .* already has a place/.test(a.said[0]), a.said[0]);
    await a.terminalSetConferenceLocation(E(`all conferences on ${D2} are in the library`));
    ok('  "all" moves them, and says the families sent their time will hear', /Put 1 conference on .* in <b>Library<\/b>\?/.test(a.asked) && /1 family was already sent their time and will be told the new place/.test(a.asked), a.asked);
    a = makeApp();
    await a.terminalSetConferenceLocation(E(`conferences on ${D1} are in room 4`));
    ok('  the day\'s bookings with no place', /Put 1 conference on .* with no place yet in <b>Room 4<\/b>\?/.test(a.asked), a.asked);

    const t = makeApp({ role: 'teacher' });
    await t.terminalSetConferenceLocation(E("put wren's conference in the library", WREN));
    ok('a teacher cannot move a conference', /Only an admin can set where conferences are/.test(t.errors[0]));

    a = makeApp();
    await a.terminalAddConferencePlace(E('add conference place Gym B'));
    await a.run();
    ok('adding a place, as typed', /Add <b>Gym B<\/b> to the conference places\?/.test(a.asked) && JSON.stringify(a.writes[0].row) === '{"name":"Gym B"}');
    await a.terminalAddConferencePlace(E('add the old annex to the conference places'));
    ok('  one taken off the list comes back instead', /Put <b>Old Annex<\/b> back on the conference places list\?/.test(a.asked), a.asked);
    await a.terminalAddConferencePlace(E('add conference location library'));
    ok('  one already there is not added twice', /Library is already on the conference places list/.test(a.said[0]));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
