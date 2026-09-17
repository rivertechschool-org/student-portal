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

  console.log('\n== the section is wired up ==\n');

  ok('there is a container to render into', /id="admin-bell-schedule-section"/.test(html));
  ok('the router knows the section', /case 'bell-schedule':[\s\S]{0,120}renderAdminBellSchedule\(\)/.test(html));
  ok('  and the dashboard has a way in', /showAdminSection\('bell-schedule'\)/.test(html));
  // The client gate is an affordance; the real control is the RLS policy in the
  // backend repo. Worth asserting that the affordance is at least there.
  ok('the editor writes to the schedule table', /from\('schedule_blocks'\)/.test(html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
