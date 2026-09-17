// "Who was missing September 14th" has to be about September 14th.
//
// WHAT WENT WRONG
//
// _parseTimeframe knew "yesterday", "last week", "3 days ago" and "on Monday",
// and nothing at all about a date said out loud. So "/admin who was missing
// September 14th" fell through to the 30-day default and answered with 59
// names across the whole month — the same answer, to the character, as asking
// with no date at all.
//
// The window WAS disclosed: "(school-wide, last 30 days)", in grey, at the end
// of the headline. That is why this is worse than a refusal. A question that
// comes back answered looks answered, and the four words that say otherwise
// are the ones a reader skips.
//
// And a bare "who was missing?" had the same shape of problem from the other
// end: no date meant 30 days, when someone standing at the door asking that
// question means today.
//
// THE DIRECTION A DATE IS READ
//
// _rivenMonthDayDates already reads "Sept 23" — forwards, on purpose, because
// it serves "Willow will be absent Sept 23", which is a plan. A question is the
// opposite: nobody was missing next May. The two readers stay separate, and
// this one resolves backwards. Both directions are tested here, because the
// day this collapses into one "smart" reader with a flag is the day one of the
// two silently gets the other's answer.
//
// Run: node tests/riven-named-dates.test.js

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

// The whole call graph, not the entry point: _rivenPastDate leans on the month
// reader and on the local-date helper, and a stub for either would be testing
// the stub.
const app = {};
app._rivenPastDate = extract('_rivenPastDate');
app._parseTimeframe = extract('_parseTimeframe');
app._rivenMonthIndex = extract('_rivenMonthIndex');
app._rivenMonthDayDates = extract('_rivenMonthDayDates');
app._isoDaysAgo = extract('_isoDaysAgo');

const on = (n) => app._isoDaysAgo.call(app, n);
const TODAY = on(0);
const YEAR = Number(TODAY.slice(0, 4));
const MONTH = Number(TODAY.slice(5, 7));       // 1-12
const DOM = Number(TODAY.slice(8, 10));

const read = (text) => app._rivenPastDate.call(app, text);
const window = (text) => app._parseTimeframe.call(app, text);

// A date in a month that has already been and gone this year, so the tests
// below do not depend on when they are run.
const pastMonth = MONTH >= 3 ? MONTH - 1 : MONTH + 9;
const pastYear = MONTH >= 3 ? YEAR : YEAR - 1;
const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
            'August', 'September', 'October', 'November', 'December'];
const pm = MN[pastMonth - 1];
const p2 = String(pastMonth).padStart(2, '0');

(async () => {

  console.log('\n== the reported one ==\n');

  {
    // The screenshot: "/admin who was missing September 14th" answered
    // "(school-wide, last 30 days)".
    const got = read(`/admin who was missing ${pm} 14th`);
    ok('a named date is read at all', !!got);
    check('  and it is that day', got && [got.sinceDate, got.untilDate],
          [`${pastYear}-${p2}-14`, `${pastYear}-${p2}-14`]);
    check('  labelled as a person would say it', got && got.label, `${pm} 14`);
  }

  {
    // The other screenshot: no date at all meant 30 days.
    check('no timeframe in the words is still no timeframe',
          window('/admin who was missing?'), null);
    // Which the executor then turns into today — asserted further down against
    // the shipped regex, because that decision lives in the intent router.
  }

  console.log('\n== the ways people write one date ==\n');

  const day = `${pastYear}-${p2}-09`;
  for (const phrase of [`${pm} 9`, `${pm} 9th`, `${pm.slice(0, 3)} 9`, `${pm.slice(0, 3)}. 9th`,
                        `9 ${pm}`, `the 9th of ${pm}`, `${pm} 9, ${pastYear}`]) {
    const got = read(`who was missing ${phrase}`);
    check(`"${phrase}"`, got && got.sinceDate, day);
  }
  check(`"${pastMonth}/9"`, read(`who was missing ${pastMonth}/9`)?.sinceDate, day);
  check(`"${pastMonth}/9/${pastYear}"`, read(`who was missing ${pastMonth}/9/${pastYear}`)?.sinceDate, day);
  check(`"${pastMonth}/9/${String(pastYear).slice(2)}"`,
        read(`who was missing ${pastMonth}/9/${String(pastYear).slice(2)}`)?.sinceDate, day);

  console.log('\n== backwards, because the question is about the past ==\n');

  {
    // Today, named. Not this date next year.
    const got = read(`who was missing ${MN[MONTH - 1]} ${DOM}`);
    check('today, said by name, is today', got && got.sinceDate, TODAY);
  }

  {
    // A month still ahead of us cannot be this year.
    const ahead = MN[MONTH % 12];               // next month, wrapping
    const got = read(`who was missing ${ahead} 5`);
    ok('a month still to come is read as last year', !!got && got.sinceDate < TODAY);
    check('  and is dated so',
          got && got.sinceDate.slice(0, 4), String(MONTH === 12 ? YEAR : YEAR - 1));
    ok('  with the year spelled out, since it is not this one', /, \d{4}$/.test(got.label));
  }

  {
    // THE OTHER DIRECTION, deliberately unchanged. "Willow will be absent
    // Sept 23" is a plan and must still resolve forwards.
    const ahead = MN[MONTH % 12];
    const plan = app._rivenMonthDayDates.call(app, `${ahead} 5`);
    ok('the planning reader still looks forwards', !!plan && plan[0] > TODAY);
    ok('  which is the opposite of this one, on the same words',
       plan[0] !== read(`who was missing ${ahead} 5`).sinceDate);
  }

  console.log('\n== ranges ==\n');

  {
    const got = read(`who was missing ${pm} 9-11`);
    check('a range hung off one month', got && [got.sinceDate, got.untilDate],
          [`${pastYear}-${p2}-09`, `${pastYear}-${p2}-11`]);
    check('  reads as a span', got && got.label, `${pm} 9 – ${pm} 11`);
  }
  {
    const got = read(`who was missing ${pm} 9 to 11`);
    check('"to" says the same thing as a dash', got && got.untilDate, `${pastYear}-${p2}-11`);
  }
  {
    const got = read(`who was missing ${pm} 9 through 11`);
    check('and so does "through"', got && got.untilDate, `${pastYear}-${p2}-11`);
  }

  console.log('\n== a whole month ==\n');

  {
    const got = read(`who was missing in ${pm}`);
    check('"in September" is the month', got && got.sinceDate, `${pastYear}-${p2}-01`);
    ok('  ending on its last day', got && /-(28|29|30|31)$/.test(got.untilDate));
    check('  and named without a day', got && got.label, pm);
  }
  {
    // The month you are standing in ends today, not on the 30th.
    const got = read(`who was missing in ${MN[MONTH - 1]}`);
    check('this month stops at today', got && got.untilDate, TODAY);
  }

  console.log('\n== "may" is a verb ==\n');

  {
    // The reason the whole-month form insists on a preposition.
    check('a bare "may" is not a date', read('who may be absent tomorrow'), null);
    check('  nor is "may" in the middle of a question', read('which students may need help'), null);
    ok('  but "in May" is', !!read('who was missing in may'));
  }

  console.log('\n== things that are not dates ==\n');

  for (const phrase of ['who has been absent', 'attendance problems', 'who was missing',
                        'show me room 14', 'who missed period 3']) {
    check(`"${phrase}"`, read(phrase), null);
  }
  {
    // A stray word the month regex is happy to match. It must not eat the real
    // date sitting further along the sentence.
    const got = read(`marching band and who was missing ${pm} 9`);
    check('a word that only looks like a month is stepped over',
          got && got.sinceDate, `${pastYear}-${p2}-09`);
  }

  console.log('\n== the relative windows still work ==\n');

  check('"yesterday"', window('who was absent yesterday')?.sinceDate, on(1));
  check('"today"', window('who is absent today')?.sinceDate, TODAY);
  check('"last 7 days"', window('absences in the last 7 days')?.sinceDate, on(7));
  check('"last week"', window('absences last week')?.sinceDate, on(7));
  check('"3 days ago"', window('absences 3 days ago')?.sinceDate, on(3));
  ok('"last month" is a window, not the month of March',
     /month/.test(window('absences last month')?.label || ''));
  {
    const mon = window('who was absent on monday');
    ok('a weekday still resolves', !!mon && mon.sinceDate === mon.untilDate);
  }
  {
    // The new reader runs first, so this is the assertion that it does not
    // swallow anything the old branches were handling.
    const named = window(`who was missing ${pm} 9`);
    check('and a named date comes through _parseTimeframe', named && named.sinceDate,
          `${pastYear}-${p2}-09`);
    check('  with both ends, so the scan is one day wide', named && named.untilDate,
          `${pastYear}-${p2}-09`);
  }

  console.log('\n== a bare question means today ==\n');

  {
    // The gate lives in the intent router, which is far too big to extract, so
    // the shipped regex itself is pulled out and run. If somebody edits it, the
    // test is reading the edit.
    const src = html.slice(html.indexOf("case 'ATTENDANCE_ISSUES':"));
    const body = src.slice(0, src.indexOf("case 'BALANCE_AT':"));
    const m = body.match(/\/(\\bwho\(\?:[^\n]*?)\/\.test\(entities\.normalized/);
    ok('the today-gate is where it says it is', !!m);
    const gate = new RegExp(m[1]);

    for (const q of ['who was missing', 'who was gone', "who wasn't here", 'who is missing',
                     "who isn't here", "who's missing", 'who was absent', 'who are we missing']) {
      ok(`"${q}" means today`, gate.test(q));
    }
    // The present perfect is the pattern question, and keeps the wide window.
    for (const q of ['who has been absent a lot', "who's been absent", 'attendance problems',
                     'who has the most absences']) {
      ok(`"${q}" is still the 30-day question`, !gate.test(q));
    }

    // And it only fires when nothing else supplied a date, so "who was missing
    // September 14th" is not quietly rewritten to today.
    ok('the gate is behind a no-timeframe guard', /!entities\.sinceDate &&\s*\n\s*\/\\bwho/.test(body));
  }

  console.log('\n== the whole way through to the query ==\n');

  {
    // Parsing a date is worth nothing if the scan does not narrow to it. This
    // is the seam: the typed sentence, through the real _parseTimeframe, into
    // the real terminalAttendanceIssues, and out as the bounds it asks the
    // database for. Every bug in this chain so far has lived in a seam.
    const scan = extract('terminalAttendanceIssues');

    const run = async (text) => {
      const bounds = [];
      const tf = window(text) || {};
      const entities = {
        original: text, _rawInput: text, normalized: text,
        sinceDate: tf.sinceDate || null, untilDate: tf.untilDate || null,
        sinceLabel: tf.label || null,
      };
      const said = [];
      const app2 = {
        userInfo: { user: { id: 'me' }, profile: { user_type: 'admin' } },
        _terminalAllStudents: [{ id: 'a', full_name: 'Solo Pupil' }],
        escapeHtml: (x) => String(x == null ? '' : x),
        // The real one, not a stub: its whole point is that it reads the LOCAL
        // date, and a stub would be free to get that wrong in the same way the
        // code used to.
        _isoDaysAgo: app._isoDaysAgo,
        _showRivenMessage: (h) => said.push(h),
        terminalPrint() {}, terminalPrintError() {},
        async _loadTerminalStudents() {},
        async _rivenMyStudentIds() { return new Set(['a']); },
        _rivenSchoolScope: () => ({ school: true, refused: false }),
        auth: { supabase: { from(table) {
          const b = { table };
          bounds.push(b);
          const q = {
            select: () => q, neq: () => q, order: () => q, limit: () => q, eq: () => q,
            gte: (_c, v) => { b.gte = v; return q; },
            lte: (_c, v) => { b.lte = v; return q; },
            then: (res, rej) => Promise.resolve({
              data: [{ student_id: 'a', status: 'absent', date: b.gte }], error: null }).then(res, rej),
          };
          return q;
        } } },
      };
      await scan.call(app2, entities);
      return { bounds, out: said.join('\n') };
    };

    {
      const { bounds, out } = await run(`/admin who was missing ${pm} 14th`);
      const daily = bounds.find(b => b.table === 'daily_attendance');
      check('the morning register is asked for that day', [daily.gte, daily.lte],
            [`${pastYear}-${p2}-14`, `${pastYear}-${p2}-14`]);
      const cls = bounds.find(b => b.table === 'class_attendance');
      check('  and so are the lesson registers', [cls.gte, cls.lte],
            [`${pastYear}-${p2}-14`, `${pastYear}-${p2}-14`]);
      // THE ONE THE SCREENSHOT SHOWED. It said "last 30 days".
      ok('  and the answer says which day it read', out.includes(`${pm} 14`));
      ok('  not the default window', !/last 30 days/.test(out));
    }

    {
      const { bounds } = await run(`/admin who was missing ${pm} 9-11`);
      const daily = bounds.find(b => b.table === 'daily_attendance');
      check('a range narrows at both ends', [daily.gte, daily.lte],
            [`${pastYear}-${p2}-09`, `${pastYear}-${p2}-11`]);
    }

    {
      // No date in the words, and nothing set for it: the executor's own
      // default still stands, and still says so.
      const { bounds, out } = await run('who has been absent');
      const daily = bounds.find(b => b.table === 'daily_attendance');
      check('the pattern question keeps its 30 days', daily.gte, on(30));
      ok('  and the answer says so', /last 30 days/.test(out));
      check('  with no upper bound to cut it short', daily.lte, undefined);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
