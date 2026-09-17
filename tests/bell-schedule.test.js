// A default, and the days that differ from it.
//
// class_schedule has said (day_of_week, period) since it was created, with no
// times anywhere — "Period 3" was an integer nothing could turn into a clock
// time. The bell schedule is where the times come from.
//
// THE SHAPE, AND WHY IT IS THIS SHAPE
//
// One row per block per day, plus a DEFAULT row whose day is null. The default
// runs on every weekday that has no row of its own. That is what makes a chapel
// Wednesday one short row instead of a second timetable — and it is the reason
// the resolve step below exists at all, so it is the part worth testing.
//
// `omitted` is a day saying a block does not run: "there is no Period 6 on
// Friday". Without it the only way to say that is to delete the default and
// re-add it on the four days it does run, which is how a schedule drifts.
//
// Run: node tests/bell-schedule.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const closeParen = i;
  i = html.indexOf('{', i);
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^\s*async\b/.test(m[0].slice(1));
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// The whole call graph — _bellResolve and _bellOverlaps both lean on _bellTime,
// and a stub for it would be free to normalise times in a way the real one
// does not.
const app = {};
app._bellTime = extract('_bellTime');
app._bellSay = extract('_bellSay');
app._bellResolve = extract('_bellResolve');
app._bellOverlaps = extract('_bellOverlaps');
app._bellOutOfOrder = extract('_bellOutOfOrder');
app._bellOrder = extract('_bellOrder');
app._bellApplyOrder = extract('_bellApplyOrder');
app.moveBellBlock = extract('moveBellBlock');
app.sortBellByTime = extract('sortBellByTime');
app._bellDays = extract('_bellDays');

const resolve = (rows, dow) => app._bellResolve.call(app, rows, dow)
  .map(b => `${b.label} ${app._bellTime.call(app, b.starts_at)}-${app._bellTime.call(app, b.ends_at)}`);

// Postgres hands back TIME as 'HH:MM:SS'; an <input type="time"> only speaks
// 'HH:MM'. Both spellings appear in these fixtures on purpose.
const DEFAULTS = [
  { block_key: 'p1', label: 'Period 1', period: 1, day_of_week: null, starts_at: '08:30:00', ends_at: '09:20:00', omitted: false, sort_order: 10 },
  { block_key: 'p2', label: 'Period 2', period: 2, day_of_week: null, starts_at: '09:25:00', ends_at: '10:15:00', omitted: false, sort_order: 20 },
  { block_key: 'lunch', label: 'Lunch', period: null, day_of_week: null, starts_at: '12:15', ends_at: '12:55', omitted: false, sort_order: 45 },
  { block_key: 'p6', label: 'Period 6', period: 6, day_of_week: null, starts_at: '13:50:00', ends_at: '14:40:00', omitted: false, sort_order: 60 },
];

// Records every sort_order written, so the assertions are about what reaches
// the database rather than about what the screen happens to show afterwards.
function orderingApp(rows) {
  const a = Object.create(app);
  a._bellRows = rows.map(r => ({ ...r }));
  a.writes = [];
  a.notified = [];
  a.rendered = 0;
  a.showNotification = (m, k) => a.notified.push([k, m]);
  a.renderAdminBellSchedule = async () => { a.rendered++; };
  a.supabaseQuery = async (fn) => await fn();
  a.auth = { supabase: { from() {
    const q = {
      update(patch) { q._patch = patch; return q; },
      eq(col, val) { q._col = col; q._val = val; return q; },
      then(res) { a.writes.push({ [q._col]: q._val, ...q._patch }); return Promise.resolve({ error: null }).then(res); },
    };
    return q;
  } } };
  return a;
}

(async () => {

  console.log('\n== a day with nothing of its own gets the default ==\n');

  check('Monday', resolve(DEFAULTS, 1),
        ['Period 1 08:30-09:20', 'Period 2 09:25-10:15', 'Lunch 12:15-12:55', 'Period 6 13:50-14:40']);
  check('  and Thursday is the same', resolve(DEFAULTS, 4), resolve(DEFAULTS, 1));

  console.log('\n== a day that differs overrides only itself ==\n');

  {
    // Chapel Wednesday: two periods shortened, nothing else said.
    const rows = [...DEFAULTS,
      { block_key: 'p1', label: 'Period 1', period: 1, day_of_week: 3, starts_at: '08:30', ends_at: '09:05', omitted: false, sort_order: 10 },
      { block_key: 'chapel', label: 'Chapel', period: null, day_of_week: 3, starts_at: '09:10', ends_at: '09:45', omitted: false, sort_order: 15 },
    ];
    check('Wednesday takes its own times', resolve(rows, 3),
          ['Period 1 08:30-09:05', 'Chapel 09:10-09:45', 'Period 2 09:25-10:15', 'Lunch 12:15-12:55', 'Period 6 13:50-14:40']);
    // THE POINT OF THE DEFAULT. One day changing must not touch the rest.
    check('  and Monday is untouched', resolve(rows, 1),
          ['Period 1 08:30-09:20', 'Period 2 09:25-10:15', 'Lunch 12:15-12:55', 'Period 6 13:50-14:40']);
    check('  as is Friday', resolve(rows, 5), resolve(DEFAULTS, 5));
    ok('  a block that exists only on Wednesday is not in Monday',
       !resolve(rows, 1).some(s => /Chapel/.test(s)));
  }

  console.log('\n== a day can say a block does not run ==\n');

  {
    // "There is no Period 6 on Friday." An override row, not a deletion.
    const rows = [...DEFAULTS,
      { block_key: 'p6', label: 'Period 6', period: 6, day_of_week: 5, starts_at: null, ends_at: null, omitted: true, sort_order: 60 },
    ];
    ok('Friday has no Period 6', !resolve(rows, 5).some(s => /Period 6/.test(s)));
    ok('  but Monday still does', resolve(rows, 1).some(s => /Period 6 13:50-14:40/.test(s)));
    // The alternative was deleting the default and re-adding it on four days,
    // which is how a schedule drifts out of agreement with itself.
    check('  and the default is still there to come back to',
          rows.filter(r => r.block_key === 'p6' && r.day_of_week === null).length, 1);
  }

  console.log('\n== the day the row belongs to is the day it applies to ==\n');

  {
    const rows = [...DEFAULTS,
      { block_key: 'p1', label: 'Period 1', period: 1, day_of_week: 2, starts_at: '08:00', ends_at: '08:50', omitted: false, sort_order: 10 },
    ];
    for (const d of [1, 3, 4, 5]) {
      ok(`day ${d} keeps the default`, resolve(rows, d).some(s => s === 'Period 1 08:30-09:20'));
    }
    ok('and only Tuesday moves', resolve(rows, 2).some(s => s === 'Period 1 08:00-08:50'));
  }

  console.log('\n== blocks come back in clock order ==\n');

  {
    // Rows arrive in whatever order the database returns them.
    const shuffled = [DEFAULTS[3], DEFAULTS[1], DEFAULTS[2], DEFAULTS[0]];
    check('sorted down the day', resolve(shuffled, 1),
          ['Period 1 08:30-09:20', 'Period 2 09:25-10:15', 'Lunch 12:15-12:55', 'Period 6 13:50-14:40']);
  }

  console.log('\n== overlaps are pointed out, not refused ==\n');

  {
    const rows = [...DEFAULTS,
      { block_key: 'p2', label: 'Period 2', period: 2, day_of_week: 1, starts_at: '09:00', ends_at: '10:15', omitted: false, sort_order: 20 },
    ];
    const clash = app._bellOverlaps.call(app, app._bellResolve.call(app, rows, 1));
    check('the one pair that overlaps is found', clash.length, 1);
    check('  and it names both blocks', clash[0].map(b => b.label), ['Period 1', 'Period 2']);
    // A school can legitimately run two things at once, so this is a warning.
    check('a clean day has none', app._bellOverlaps.call(app, app._bellResolve.call(app, DEFAULTS, 1)).length, 0);
  }

  console.log('\n== times read back the way people say them ==\n');

  check('morning', app._bellSay.call(app, '08:30:00'), '8:30 am');
  check('afternoon', app._bellSay.call(app, '13:50:00'), '1:50 pm');
  check('noon', app._bellSay.call(app, '12:15'), '12:15 pm');
  check('midnight', app._bellSay.call(app, '00:05'), '12:05 am');
  check('nothing set', app._bellSay.call(app, null), '—');
  // Both spellings Postgres might hand back.
  check('seconds are trimmed for the input', app._bellTime.call(app, '14:40:00'), '14:40');
  check('  and a bare HH:MM is left alone', app._bellTime.call(app, '14:40'), '14:40');
  check('  and a missing time is empty, not "undefined"', app._bellTime.call(app, null), '');

  console.log('\n== only weekdays are offered ==\n');

  {
    const days = app._bellDays.call(app);
    check('five of them', days.length, 5);
    check('  Monday to Friday', days.map(d => d.dow), [1, 2, 3, 4, 5]);
  }

  console.log('\n== an overlap is two blocks sharing clock time ==\n');

  {
    // THE BUG THIS BLOCK EXISTS FOR. Period 7 runs 13:40-14:20, genuinely last
    // in the day, but was given a sort_order that put it above Period 1. The
    // old check compared each row with the one BELOW IT IN THE LIST, so it
    // reported that Period 7 "ends after Period 1 starts" - true of the list
    // and false of the day. Nothing overlaps here.
    const outOfOrder = [
      { block_key: 'p7', label: 'Period 7', starts_at: '13:40:00', ends_at: '14:20:00', day_of_week: null, sort_order: 5 },
      { block_key: 'p1', label: 'Period 1', starts_at: '08:45:00', ends_at: '09:35:00', day_of_week: null, sort_order: 10 },
      { block_key: 'p2', label: 'Period 2', starts_at: '09:35:00', ends_at: '10:25:00', day_of_week: null, sort_order: 20 },
    ];
    check('a list in the wrong order is not an overlap',
          app._bellOverlaps.call(app, outOfOrder), []);
    ok('  but it is still worth saying', app._bellOutOfOrder.call(app, outOfOrder));

    // One ending exactly when the next starts is a schedule, not a clash.
    ok('touching blocks do not overlap',
       app._bellOverlaps.call(app, outOfOrder.slice(1)).length === 0);
  }

  {
    // A real clash, and deliberately NOT adjacent in the list, which the old
    // adjacent-pairs walk could not see at all.
    const clash = [
      { block_key: 'a', label: 'Assembly', starts_at: '09:00', ends_at: '10:30', day_of_week: null, sort_order: 10 },
      { block_key: 'b', label: 'Break', starts_at: '10:30', ends_at: '10:45', day_of_week: null, sort_order: 20 },
      { block_key: 'c', label: 'Choir', starts_at: '09:30', ends_at: '09:45', day_of_week: null, sort_order: 30 },
    ];
    const bad = app._bellOverlaps.call(app, clash);
    check('a genuine clash is found even two rows apart', bad.length, 1);
    check('  and is named earlier-first', bad[0].map(x => x.label), ['Assembly', 'Choir']);
    ok('a schedule in clock order is not flagged as out of order',
       !app._bellOutOfOrder.call(app, [clash[0], clash[1]]));
  }

  console.log('\n== blocks can be moved ==\n');

  // What the schedule looks like after the writes land. The write LIST would
  // also encode the decision not to touch rows already holding the right
  // number, which is an optimisation, not the behaviour under test.
  const orderAfter = (a) => {
    const by = new Map(a._bellRows.filter(r => r.day_of_week === null)
      .map(r => [r.block_key, Number(r.sort_order) || 0]));
    for (const w of a.writes) by.set(w.block_key, w.sort_order);
    return [...by.entries()].sort((x, y) => x[1] - y[1]).map(x => x[0]);
  };

  const ORD = [
    { block_key: 'p7', label: 'Period 7', starts_at: '13:40:00', ends_at: '14:20:00', day_of_week: null, sort_order: 5 },
    { block_key: 'p1', label: 'Period 1', starts_at: '08:45:00', ends_at: '09:35:00', day_of_week: null, sort_order: 10 },
    { block_key: 'p2', label: 'Period 2', starts_at: '09:35:00', ends_at: '10:25:00', day_of_week: null, sort_order: 20 },
  ];

  {
    const a = orderingApp(ORD);
    check('the order it is in now', a._bellOrder.call(a), ['p7', 'p1', 'p2']);

    await a.moveBellBlock.call(a, 'p7', 1);
    check('moving down puts it one lower', orderAfter(a), ['p1', 'p7', 'p2']);
    check('  writing only the rows that actually change', a.writes,
          [{ block_key: 'p7', sort_order: 20 }, { block_key: 'p2', sort_order: 30 }]);
    check('  and redraws once', a.rendered, 1);
  }

  {
    const a = orderingApp(ORD);
    await a.moveBellBlock.call(a, 'p7', -1);
    check('the top block cannot move up', a.writes, []);
    check('  and nothing is redrawn', a.rendered, 0);
    await a.moveBellBlock.call(a, 'p2', 1);
    check('the bottom block cannot move down', a.writes, []);
  }

  {
    // A day's override carries its own copy of sort_order, and _bellResolve
    // sorts by it. Leaving those behind would order Tuesday differently from
    // every other day, so every row sharing a key moves together - which
    // .eq('block_key', …) does in one statement.
    const a = orderingApp([...ORD,
      { block_key: 'p7', label: 'Period 7', starts_at: '13:50', ends_at: '14:30', day_of_week: 2, sort_order: 5 }]);
    await a.moveBellBlock.call(a, 'p7', 1);
    ok('a move addresses the block by key, not by row',
       a.writes.every(w => 'block_key' in w));
    check('  so a day override moves with its default',
          a.writes.find(w => w.block_key === 'p7').sort_order, 20);
  }

  {
    const a = orderingApp(ORD);
    await a.sortBellByTime.call(a);
    check('time order puts the afternoon block last', orderAfter(a), ['p1', 'p2', 'p7']);
    check('  and moves only the block that was adrift', a.writes,
          [{ block_key: 'p7', sort_order: 30 }]);
  }

  {
    // Already in clock order: nothing to write, and nothing to redraw around.
    const a = orderingApp([
      { block_key: 'p1', label: 'Period 1', starts_at: '08:45', ends_at: '09:35', day_of_week: null, sort_order: 10 },
      { block_key: 'p2', label: 'Period 2', starts_at: '09:35', ends_at: '10:25', day_of_week: null, sort_order: 20 },
    ]);
    await a.sortBellByTime.call(a);
    check('a schedule already in order is left alone', a.writes, []);
  }

  console.log('\n== the section is wired up ==\n');

  ok('there is a container to render into', /id="admin-bell-schedule-section"/.test(html));
  ok('the router knows the section', /case 'bell-schedule':[\s\S]{0,120}renderAdminBellSchedule\(\)/.test(html));
  ok('  and the dashboard has a way in', /showAdminSection\('bell-schedule'\)/.test(html));
  // The client gate is an affordance; the real control is the RLS policy in the
  // backend repo. Worth asserting that the affordance is at least there.
  ok('the editor writes to the schedule table', /from\('schedule_blocks'\)/.test(html));
  ok('  and the rows carry move controls', /app\.moveBellBlock\('/.test(html));
  ok('  with the ends of the list stopped', /at === 0 \? 'disabled'/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
