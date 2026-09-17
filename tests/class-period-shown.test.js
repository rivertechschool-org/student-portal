// A class says which period it is in. The screen has to say it too.
//
// class_schedule has said (class_id, day_of_week, period) since it was created,
// and all 203 rows carry a period. The loader read the row and kept only
// day_of_week, so the one fact a class stores about when it meets never reached
// any card: subject, grade, teacher, roll count, join code - no period.
//
// The period alone is half an answer, because "Period 3" is not a time until
// the bell schedule says what it is. So the line joins the two, and the joining
// is the part that can go wrong quietly:
//
//   * a period the bell schedule has no block for must show WITHOUT a time
//     rather than borrowing one or vanishing. One class is timetabled into
//     period 8 and nothing in the bell schedule gives period 8 a time; a line
//     that silently dropped it would hide exactly the case worth seeing.
//   * a class that meets twice in one period is one entry, not two.
//   * a class with no schedule row at all gets no line, not an empty one.
//
// Run: node tests/class-period-shown.test.js

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

// Methods live at two indents in this file: the app's own, and Riven's.
function method(name, indent) {
  for (const ind of indent ? [indent] : ['      ', '    ']) {
    for (const sig of [`\n${ind}async ${name}(`, `\n${ind}${name}(`]) {
      const start = html.indexOf(sig);
      if (start === -1) continue;
      const close = `\n${ind}}\n`;
      const end = html.indexOf(close, start);
      if (end === -1) throw new Error(name + ' unterminated');
      const body = html.slice(start, end + close.length).trim();
      const isAsync = body.startsWith('async ');
      const src = isAsync ? body.slice('async '.length) : body;
      return eval(`(${isAsync ? 'async ' : ''}function ${src.slice(name.length)})`);
    }
  }
  throw new Error(name + ' not found');
}

const app = {};
// The whole call graph: the line reads times through _bellRange, which reads
// _bellSay, which reads _bellTime. Stubbing any of them would be free to
// format in a way the real one does not.
app._bellTime = method('_bellTime');
app._bellSay = method('_bellSay');
app._bellRange = method('_bellRange');
app.classScheduleLine = method('classScheduleLine');
app.loadBellDefaults = method('loadBellDefaults');

// The real bell defaults, in the shape Postgres returns them.
app._bellDefaults = {
  1: { period: 1, label: 'Period 1', starts_at: '08:45:00', ends_at: '09:35:00' },
  3: { period: 3, label: 'Period 3', starts_at: '10:25:00', ends_at: '11:05:00' },
  6: { period: 6, label: 'Period 6', starts_at: '13:00:00', ends_at: '13:40:00' },
  7: { period: 7, label: 'Period 7', starts_at: '13:40:00', ends_at: '14:20:00' },
  // deliberately NO period 8
};
app._classMeets = {};

const line = (cls) => app.classScheduleLine.call(app, cls);

(async () => {

  console.log('\n== the period, and what time that is ==\n');

  check('one period, one day',
        line({ id: 'a', meets: [{ day: 3, period: 3 }] }),
        'Period 3 · 10:25–11:05 am · Wed');

  check('the same period on several days is said once',
        line({ id: 'b', meets: [{ day: 1, period: 3 }, { day: 3, period: 3 }, { day: 5, period: 3 }] }),
        'Period 3 · 10:25–11:05 am · Mon, Wed, Fri');

  check('days come out in week order however they arrive',
        line({ id: 'c', meets: [{ day: 5, period: 1 }, { day: 2, period: 1 }] }),
        'Period 1 · 8:45–9:35 am · Tue, Fri');

  // 13:00-13:40 is am to pm either side of noon? No - both pm. The suffix is
  // dropped from the first only when both halves share it.
  check('a range inside one half of the day says the suffix once',
        line({ id: 'd', meets: [{ day: 1, period: 6 }] }),
        'Period 6 · 1:00–1:40 pm · Mon');

  check('a range spanning noon keeps both',
        app._bellRange.call(app, '11:30:00', '12:30:00'),
        '11:30 am–12:30 pm');

  console.log('\n== the cases that used to disappear ==\n');

  // THE ONE THIS FILE EXISTS FOR. A class sits in period 8; the bell schedule
  // has no block for period 8. Showing nothing would hide a real gap in the
  // timetable behind a card that looks complete.
  check('a period with no bell block still shows, and says so',
        line({ id: 'e', meets: [{ day: 4, period: 8 }] }),
        'Period 8 · no time set · Thu');

  check('a class with no schedule row gets no line at all',
        line({ id: 'f', meets: [] }), '');
  check('...and neither does one the loader never saw',
        line({ id: 'unknown' }), '');

  check('two different periods list the numbers and leave the times',
        line({ id: 'g', meets: [{ day: 1, period: 6 }, { day: 3, period: 1 }] }),
        'Periods 1, 6 · Mon, Wed');

  check('a row with a day but no period still names the day',
        line({ id: 'h', meets: [{ day: 2, period: null }] }), 'Tue');

  console.log('\n== where it reads from ==\n');

  // The Classes screen fills a shared map; the admin screen hangs the rows on
  // the class. One line serves both, so both are asserted.
  app._classMeets = { z: [{ day: 1, period: 7 }] };
  check('it falls back to the shared map when the class carries nothing',
        line({ id: 'z' }), 'Period 7 · 1:40–2:20 pm · Mon');
  check('what the class carries wins',
        line({ id: 'z', meets: [{ day: 4, period: 1 }] }),
        'Period 1 · 8:45–9:35 am · Thu');

  console.log('\n== the period is actually fetched ==\n');

  // A fixture proves the formatting; it cannot prove the column is selected.
  // These read the shipping source, because the bug was a missing column.
  ok('the schedule query asks for the period',
     /from\('class_schedule'\)[\s\S]{0,120}select\('class_id, day_of_week, period'\)/.test(html));
  ok('the bell defaults are loaded for the times',
     /from\('schedule_blocks'\)[\s\S]{0,140}is\('day_of_week', null\)/.test(html));
  ok('the class card renders the line', /classScheduleLine\(cls\)/.test(html));

  // Both card renderers - the Classes screen and the admin one - must show it,
  // and a fixture for one says nothing about the other.
  check('every class-card renderer shows it',
        (html.match(/const when = this\.classScheduleLine\(cls\)/g) || []).length, 3);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
