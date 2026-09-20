// Switching child has to redraw the calendar.
//
// The parent dashboard draws its calendar from ONE child's classes, assignments
// and tests — loadCalendarEvents reads `this.selectedChildId` and asks for that
// child's enrolments. The Select Child dropdown set that field, relabelled a
// button, cleared a panel, and stopped. Nothing reloaded and nothing redrew, so
// a parent with two children switched to the second and went on looking at the
// first one's timetable until they happened to reload the page.
//
// It is the quietest kind of wrong: the screen changes (the button's label does)
// so it looks like the switch worked, and the dates on show are real dates for a
// real child — just not the one selected.
//
// There were four reasons the calendar's contents change and the same two steps
// were spelled out separately for three of them; the fourth was never written.
// They now share refreshCalendar(), and this file checks both halves: that
// switching child reloads for the NEW child, and that nobody has quietly gone
// back to hand-rolling the pair somewhere else.
//
// Run: node tests/calendar-child-switch.test.js

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

// ---- lift the real methods out of the page ------------------------------
// Class methods on this page sit at twelve spaces.
function methodSource(name) {
  const re = new RegExp(`\\n {12}(?:async )?${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(name + ' not found in index.html');
  const start = m.index + 1;
  let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

const REAL = ['refreshCalendar', 'onChildSelectorChange', 'navigateCalendar', 'navigateCalendarToday'];

// ---- a hand-built DOM, only as much as these methods touch ---------------
function makeApp() {
  const els = {
    'view-child-details-btn': { textContent: '' },
    'child-details-container': { innerHTML: '<p>stale panel</p>' }
  };
  const app = new Function(`
    "use strict";
    return {
      ${REAL.map(methodSource).join(',\n      ')}
    };
  `)();

  // The two stubs. loadCalendarEvents reads this.selectedChildId exactly as the
  // real one does, so recording it here proves the field is set BEFORE the
  // reload rather than after it — an ordering bug would look identical on screen.
  app.loads = [];
  app.draws = [];
  app.loadCalendarEvents = function (year, month) {
    app.loads.push({ year, month, forChild: app.selectedChildId });
    return Promise.resolve();
  };
  app.renderCalendar = function (year, month) {
    app.draws.push({ year, month, forChild: app.selectedChildId });
  };

  app.childProfiles = [
    { id: 'kid-1', first_name: 'Milo', last_name: 'Whitfield' },
    { id: 'kid-2', first_name: 'Junie', last_name: 'Whitfield' }
  ];
  app.selectedChildId = 'kid-1';
  app.calendarYear = 2026;
  app.calendarMonth = 8;            // September
  app._els = els;

  global.document = { getElementById: id => els[id] || null };
  return app;
}

(async () => {

  console.log('\n== switching child redraws for that child ==\n');

  {
    const app = makeApp();
    app.onChildSelectorChange('kid-2');
    await Promise.resolve(); await Promise.resolve();

    check('the selection is recorded', app.selectedChildId, 'kid-2');
    check('the calendar reloaded exactly once', app.loads.length, 1);
    check('  and it loaded for the NEW child', app.loads[0].forChild, 'kid-2');
    check('the calendar redrew exactly once', app.draws.length, 1);
    check('  for the new child too', app.draws[0].forChild, 'kid-2');
  }

  {
    // The month must survive the switch. Reloading via "today" would silently
    // move a parent who was reading ahead back to the current month.
    const app = makeApp();
    app.calendarYear = 2027;
    app.calendarMonth = 0;          // January, browsed to deliberately
    app.onChildSelectorChange('kid-2');
    await Promise.resolve(); await Promise.resolve();

    check('the month being viewed is kept', app.loads[0], { year: 2027, month: 0, forChild: 'kid-2' });
    check('  and is what gets drawn', app.draws[0], { year: 2027, month: 0, forChild: 'kid-2' });
  }

  {
    // The two things it already did, still done.
    const app = makeApp();
    app.onChildSelectorChange('kid-2');
    await Promise.resolve(); await Promise.resolve();

    check('the button names the new child', app._els['view-child-details-btn'].textContent,
          "View Junie's Details");
    check('the old details panel is cleared', app._els['child-details-container'].innerHTML, '');
  }

  {
    // An id that is not on the dashboard should not throw, and should not
    // relabel the button with someone else's name.
    const app = makeApp();
    app.onChildSelectorChange('kid-nope');
    await Promise.resolve(); await Promise.resolve();
    check('an unknown child leaves the label alone', app._els['view-child-details-btn'].textContent, '');
    check('  but still reloads rather than showing the previous child', app.loads.length, 1);
    check('  for the id it was given', app.loads[0].forChild, 'kid-nope');
  }

  console.log('\n== the other reasons still work ==\n');

  {
    const app = makeApp();
    app.navigateCalendar(1);
    await Promise.resolve(); await Promise.resolve();
    check('next month loads', app.loads[0], { year: 2026, month: 9, forChild: 'kid-1' });
    check('  and draws', app.draws.length, 1);
  }

  {
    const app = makeApp();
    app.calendarMonth = 0;
    app.navigateCalendar(-1);
    await Promise.resolve(); await Promise.resolve();
    check('stepping back past January rolls the year', app.loads[0],
          { year: 2025, month: 11, forChild: 'kid-1' });
  }

  {
    const app = makeApp();
    app.calendarYear = 1999; app.calendarMonth = 5;
    app.navigateCalendarToday();
    await Promise.resolve(); await Promise.resolve();
    const now = new Date();
    check('"Today" returns to this month', app.loads[0],
          { year: now.getFullYear(), month: now.getMonth(), forChild: 'kid-1' });
  }

  {
    const app = makeApp();
    const r = app.refreshCalendar();
    ok('refreshCalendar hands back a promise, so callers can wait', r && typeof r.then === 'function');
    await r;
    check('  and has drawn by the time it settles', app.draws.length, 1);
  }

  console.log('\n== one door, not four ==\n');

  // The pair "load this month, then draw this month" should appear in exactly
  // two places: refreshCalendar, and initCalendar — which is different on
  // purpose, because it also waits for the year-long countdown before drawing.
  //
  // It was in eight. Three navigation callers and five write-paths (adding an
  // assignment, adding, editing and deleting a school event) each spelled the
  // pair out again, and the ninth caller — the child selector — was the one
  // that forgot. Counting the call sites is how that stays fixed: a tenth
  // reason cannot half-implement itself without failing here.
  {
    const sites = [...html.matchAll(/loadCalendarEvents\(this\.calendarYear, this\.calendarMonth\)/g)]
      .map(m => html.slice(0, m.index).split('\n').length);
    check('loadCalendarEvents(year, month) is called from two places only', sites.length, 2);

    ok('  one of them is refreshCalendar', /loadCalendarEvents/.test(methodSource('refreshCalendar')));
    ok('  the other is the first draw, and says why it differs',
       /second thing to wait for/.test(html));

    // Drawing has one legitimate third caller. toggleCalendarFilter redraws
    // WITHOUT refetching, and should: a filter pill changes which of the events
    // already in hand are shown, not which ones were fetched. So the rule is not
    // "two draws" — it is that every draw is either inside refreshCalendar, the
    // first draw, or a filter toggle.
    const drawSites = [...html.matchAll(/this\.renderCalendar\(this\.calendarYear, this\.calendarMonth\)/g)]
      .map(m => {
        const before = html.slice(0, m.index);
        const owner = [...before.matchAll(/\n {12}(?:async )?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].pop();
        return owner ? owner[1] : '?';
      });
    check('every redraw belongs to one of the three that may redraw',
          [...new Set(drawSites)].sort(),
          ['initCalendar', 'refreshCalendar', 'toggleCalendarFilter']);
    ok('  and the filter toggle redraws without refetching, on purpose',
       !/loadCalendarEvents/.test(methodSource('toggleCalendarFilter')));
  }

  // The regression itself, stated as source: the handler must reach the calendar.
  ok('onChildSelectorChange refreshes the calendar',
     /refreshCalendar\(\)/.test(methodSource('onChildSelectorChange')));

  // And the three callers go through it rather than hand-rolling the pair again.
  for (const caller of ['navigateCalendar', 'navigateCalendarToday', 'onChildSelectorChange']) {
    const body = methodSource(caller);
    ok(`${caller} uses refreshCalendar`, /this\.refreshCalendar\(\)/.test(body));
    check(`  and does not redraw by hand`, /this\.renderCalendar\(/.test(body), false);
  }

  console.log('\n== the selector is actually wired to it ==\n');

  ok('the dropdown calls onChildSelectorChange',
     /onchange="portal\.onChildSelectorChange\(this\.value\)"/.test(html));
  ok('  and is only drawn when there is more than one child',
     /childProfiles\.length > 1/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
