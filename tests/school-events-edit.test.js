// Editing a school event instead of deleting and retyping it.
//
// Nine lab days went in as "Chemistry Lab" and should have said "Physics Lab".
// The only way to correct that was nine deletes and nine re-adds, retyping the
// date and description each time — which is how the dates drift and one of the
// nine quietly ends up on the wrong Thursday.
//
// What this holds:
//
//   * THE EDITOR CARRIES THE EVENT'S OWN VALUES. A form that opens blank is a
//     re-add with extra steps, and the field most likely to be left wrong is
//     the one you did not come to change.
//   * ONE ROW AT A TIME. Two open editors means unsaved text sitting in a row
//     that scrolled off screen.
//   * THE INPUT IDS ARE PER EVENT. Nine rows with the same title differ only
//     by id; a shared input id saves the wrong one, and nothing on screen would
//     say so.
//   * A BAD RANGE IS REFUSED, not written. The add path already checks this.
//
// Run: node tests/school-events-edit.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function method(name, indent = '            ') {
  for (const sig of [`\n${indent}async ${name}(`, `\n${indent}${name}(`]) {
    const start = html.indexOf(sig);
    if (start === -1) continue;
    const end = html.indexOf(`\n${indent}}\n`, start);
    if (end === -1) throw new Error(name + ' unterminated');
    const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
    const isAsync = body.startsWith('async ');
    const src = isAsync ? body.slice('async '.length) : body;
    return eval(`(${isAsync ? 'async ' : ''}function ${src.slice(name.length)})`);
  }
  throw new Error(name + ' not found');
}

// ---- a list of nine identically-named events ----------------------------
const LABS = ['2026-09-24', '2026-10-29', '2026-11-19'].map((d, i) => ({
  id: `lab-${i}`, title: 'Chemistry Lab', description: '2 periods of 6.',
  event_type: 'event', start_date: d, end_date: null,
}));
const BREAK = {
  id: 'brk', title: 'Thanksgiving Break', description: null,
  event_type: 'closure', start_date: '2026-11-23', end_date: '2026-11-27',
};

function makeApp() {
  const app = {
    notices: [],
    updated: null,
    refreshed: 0,
    calendarYear: 2026, calendarMonth: 8,
    escapeHtml: (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    _manageEvents: { events: [...LABS, BREAK], schoolStart: '2026-09-01', hidePast: false, pane: null, editingId: null },
    auth: {
      supabase: {
        from(t) {
          return {
            update(patch) {
              return { eq(col, id) { app.updated = { table: t, patch, id }; return Promise.resolve({ error: null }); } };
            },
          };
        },
      },
    },
    async showManageSchoolEvents() { this.refreshed++; },
    async loadCalendarEvents() {},
    renderCalendar() {},
  };
  global.window = { PortalUI: { showNotification: (m, k) => app.notices.push(`${k}:${m}`) } };
  global.document = { getElementById: (id) => app._els[id] || null };
  app._els = {};
  app.renderManageEventsList = method('renderManageEventsList').bind(app);
  app.renderEditEventRow = method('renderEditEventRow').bind(app);
  app.editSchoolEvent = method('editSchoolEvent').bind(app);
  app.cancelEditSchoolEvent = method('cancelEditSchoolEvent').bind(app);
  app.submitManageEditEvent = method('submitManageEditEvent').bind(app);
  return app;
}

(async () => {
  console.log('\n== the list offers an edit ==\n');

  {
    const app = makeApp();
    const list = app.renderManageEventsList();
    check('every event can be edited', (list.match(/portal\.editSchoolEvent\(/g) || []).length, 4);
    check('  and deleting is still there', (list.match(/portal\.deleteSchoolEvent\(/g) || []).length, 4);
    check('no editor is open to start with', /mee-title/.test(list), false);
  }

  console.log('\n== the editor opens on the right row, filled in ==\n');

  {
    const app = makeApp();
    app._els['manage-events-list'] = { innerHTML: '' };
    app.editSchoolEvent('lab-1');

    check('the row being edited is remembered', app._manageEvents.editingId, 'lab-1');
    const list = app.renderManageEventsList();

    check('exactly one editor is open', (list.match(/mee-title-/g) || []).length, 1);
    ok('  and it is the row that was clicked', list.includes('id="mee-title-lab-1"'));
    // A form that opens blank is a re-add with extra steps.
    ok('the title is carried in', list.includes('value="Chemistry Lab"'));
    ok('the date is carried in', list.includes('value="2026-10-29"'));
    ok('the description is carried in', list.includes('2 periods of 6.'));
    ok('the type is preselected', /<option value="event" selected>/.test(list));
    // The other eight rows stay readable so you can see what you are matching.
    check('the rows around it are still listed',
      (list.match(/portal\.deleteSchoolEvent\(/g) || []).length, 3);
  }

  {
    // A multi-day closure has to round-trip its end date and its type.
    const app = makeApp();
    app._els['manage-events-list'] = { innerHTML: '' };
    app.editSchoolEvent('brk');
    const list = app.renderManageEventsList();
    ok('an end date is carried in', list.includes('value="2026-11-27"'));
    ok('  and the type it already had is selected', /<option value="closure" selected>/.test(list));
    check('  without selecting a second one', (list.match(/ selected>/g) || []).length, 1);
    ok('a null description does not print "null"', !/>null</.test(list));
  }

  console.log('\n== one at a time ==\n');

  {
    const app = makeApp();
    app._els['manage-events-list'] = { innerHTML: '' };
    app.editSchoolEvent('lab-0');
    app.editSchoolEvent('lab-2');
    check('opening another closes the first', app._manageEvents.editingId, 'lab-2');
    check('  so only one editor is ever open', (app.renderManageEventsList().match(/mee-title-/g) || []).length, 1);

    app.cancelEditSchoolEvent();
    check('cancel closes it', app._manageEvents.editingId, null);
    check('  and writes nothing', app.updated, null);
  }

  console.log('\n== saving ==\n');

  const fields = (app, id, vals) => {
    for (const [k, v] of Object.entries(vals)) app._els[`mee-${k}-${id}`] = { value: v };
  };

  {
    const app = makeApp();
    app._els['manage-events-list'] = { innerHTML: '' };
    app.editSchoolEvent('lab-1');
    fields(app, 'lab-1', {
      title: '  Physics Lab  ', start: '2026-10-29', end: '',
      type: 'event', description: 'High School · 2 periods of 6.',
    });
    await app.submitManageEditEvent('lab-1');

    check('it updated the right row', app.updated && app.updated.id, 'lab-1');
    check('  in the right table', app.updated && app.updated.table, 'school_events');
    check('  with the corrected title, trimmed', app.updated.patch.title, 'Physics Lab');
    check('  keeping the date it already had', app.updated.patch.start_date, '2026-10-29');
    // An emptied end date has to become null, not '' — an empty string is not a
    // date and the column would reject it.
    check('  an emptied end date is null', app.updated.patch.end_date, null);
    check('  and the description came along', app.updated.patch.description, 'High School · 2 periods of 6.');
    check('the editor closed', app._manageEvents.editingId, null);
    check('  the list and the calendar were both refreshed', app.refreshed, 1);
    ok('  and it said so', app.notices.some(n => /^success:/.test(n)));
  }

  console.log('\n== what it refuses ==\n');

  for (const [label, vals] of [
    ['an empty title', { title: '   ', start: '2026-10-29', end: '', type: 'event', description: '' }],
    ['a missing date', { title: 'Physics Lab', start: '', end: '', type: 'event', description: '' }],
    ['an end before the start', { title: 'Physics Lab', start: '2026-10-29', end: '2026-10-01', type: 'event', description: '' }],
  ]) {
    const app = makeApp();
    app._els['manage-events-list'] = { innerHTML: '' };
    app.editSchoolEvent('lab-1');
    fields(app, 'lab-1', vals);
    await app.submitManageEditEvent('lab-1');
    check(`${label} writes nothing`, app.updated, null);
    ok(`  and says why`, app.notices.some(n => /^warning:/.test(n)));
    check(`  leaving the editor open`, app._manageEvents.editingId, 'lab-1');
  }

  console.log('\n== ids cannot collide across rows ==\n');

  {
    // Nine rows named the same thing differ only by id. A shared input id would
    // read whichever element the DOM handed back first and save the wrong event.
    const app = makeApp();
    app._els['manage-events-list'] = { innerHTML: '' };
    const ids = new Set();
    for (const ev of app._manageEvents.events) {
      app.editSchoolEvent(ev.id);
      for (const m of app.renderManageEventsList().matchAll(/id="(mee-[a-z]+-[^"]+)"/g)) ids.add(m[1]);
    }
    check('every field id is unique across all rows', ids.size, app._manageEvents.events.length * 5);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
