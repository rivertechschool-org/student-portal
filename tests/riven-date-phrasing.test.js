// The ways people actually write a date.
//
// "Willow will be absent Sept 23" answered with the help text. So did "Willow
// will be gone September 23". The intent matched fine both times — it was the
// date that came back null, and a null date looks exactly like a sentence
// Riven did not understand.
//
// Three separate gaps, all of them in how a date can be written:
//
//   * A NAMED MONTH. The day-number reader only understood a month introduced
//     by "of" or "in" ("the 23rd OF September"), and it refused a lone number
//     carrying no ordinal suffix. "Sept 23" failed both tests, so the sentence
//     fell through every branch to nothing.
//
//   * A RANGE WITH NO SPACES. The separator had to be surrounded by
//     whitespace, so "Monday-Thursday" — which is how anyone writes it —
//     missed the range branch and fell through to the single-day path, which
//     silently kept the start and dropped the end. A half-recorded absence is
//     worse than none: it reads as recorded.
//
//   * SHORTHAND. "M,T,W,Th,F" meant nothing at all.
//
// The shorthand is the one with teeth, because it can be wrong in a way nobody
// notices: a stray letter read as a day puts a child down as absent on a date
// no one mentioned. So it only fires on a run of two or more codes where
// EVERY character is a day, longest token first — "th" must beat "t", or
// Thursday quietly becomes Tuesday.
//
// Run: node tests/riven-date-phrasing.test.js

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

const app = {};
for (const m of ['_rivenMonthIndex', '_rivenMonthDayDates', '_rivenDayCodes',
                 '_rivenPhraseToDate', '_rivenAbsenceDayNumbers',
                 '_rivenCollapseSpans', '_rivenResolveAbsenceSpans',
                 '_rivenParseWeekdays', '_rivenSpanLabel']) {
  app[m] = extract(m);
}
const call = (m, ...a) => app[m].apply(app, a);

// Dates are resolved against "now", so the expectations are computed the same
// way rather than hard-coded — a test that only passes in September is a test
// that fails in October for no reason.
const YEAR = new Date().getFullYear();
const iso = (mi, d) => {
  const y = mi < new Date().getMonth() ? YEAR + 1 : YEAR;
  return `${y}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const nextDow = (dow) => {
  const now = new Date();
  let delta = (dow - now.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

(async () => {

  console.log('\n== the two sentences from the screenshot ==\n');

  {
    const a = call('_rivenResolveAbsenceSpans', 'willow will be absent sept 23');
    check('"absent Sept 23"', a, [{ start: iso(8, 23), end: iso(8, 23) }]);

    const b = call('_rivenResolveAbsenceSpans', 'willow will be gone september 23');
    check('"gone September 23"', b, [{ start: iso(8, 23), end: iso(8, 23) }]);
  }

  console.log('\n== named months, written every which way ==\n');

  check('Sept with a full stop', call('_rivenMonthIndex', 'sept.'), 8);
  check('three-letter abbreviation', call('_rivenMonthIndex', 'sep'), 8);
  check('the whole word', call('_rivenMonthIndex', 'september'), 8);
  check('a month that is not one', call('_rivenMonthIndex', 'smarch'), null);
  // "may" is a month and also an ordinary word; the reader only looks where a
  // date is expected, so this is safe to resolve.
  check('May', call('_rivenMonthIndex', 'may'), 4);

  check('"Sept 23"', call('_rivenMonthDayDates', 'sept 23'), [iso(8, 23)]);
  check('"September 23rd"', call('_rivenMonthDayDates', 'september 23rd'), [iso(8, 23)]);
  // "23rd of September" is left to _rivenAbsenceDayNumbers, which already read
  // that form and reads it better - it gathers the whole list, where matching
  // it here would catch only the day nearest the month name. What matters is
  // that the sentence resolves, not which reader did it.
  check('"23rd of September" still resolves',
        call('_rivenResolveAbsenceSpans', 'away the 23rd of september'),
        [{ start: iso(8, 23), end: iso(8, 23) }]);
  check('  and a list of them keeps every day',
        call('_rivenResolveAbsenceSpans', 'missing the 23rd and 24th of september'),
        [{ start: iso(8, 23), end: iso(8, 24) }]);
  check('"23 Sept", with no "of"', call('_rivenMonthDayDates', '23 sept'), [iso(8, 23)]);
  check('several days on one month', call('_rivenMonthDayDates', 'sept 23, 24 and 25'),
        [iso(8, 23), iso(8, 24), iso(8, 25)]);
  // The 31st of September is a mishearing, not a date.
  check('a day that month does not have is dropped',
        call('_rivenMonthDayDates', 'september 31'), null);
  check('no month named', call('_rivenMonthDayDates', 'out on tuesday'), null);

  {
    // Consecutive days collapse, which is what makes the answer readable.
    const spans = call('_rivenResolveAbsenceSpans', 'away sept 23, 24 and 25');
    check('three consecutive days are one span', spans, [{ start: iso(8, 23), end: iso(8, 25) }]);
  }

  console.log('\n== ranges, written the way people write them ==\n');

  {
    const noSpaces = call('_rivenResolveAbsenceSpans', 'willow is out monday-thursday');
    ok('"monday-thursday" is a range, not a single day',
       noSpaces && noSpaces.length === 1 && noSpaces[0].start !== noSpaces[0].end);
    check('  starting Monday', noSpaces[0].start, nextDow(1));

    const spaced = call('_rivenResolveAbsenceSpans', 'willow is out monday - thursday');
    check('  and spacing makes no difference', spaced, noSpaces);

    const worded = call('_rivenResolveAbsenceSpans', 'willow is out monday to thursday');
    check('  nor does saying "to"', worded, noSpaces);
  }

  {
    const m = call('_rivenResolveAbsenceSpans', 'gone sept 23-25');
    check('"Sept 23-25"', m, [{ start: iso(8, 23), end: iso(8, 25) }]);
  }

  console.log('\n== shorthand ==\n');

  check('M,T,W,Th,F', call('_rivenDayCodes', 'm,t,w,th,f'), [1, 2, 3, 4, 5]);
  check('MWF run together', call('_rivenDayCodes', 'mwf'), [1, 3, 5]);
  check('Tu/Th', call('_rivenDayCodes', 'tu/th'), [2, 4]);
  check('spaced out', call('_rivenDayCodes', 'm w f'), [1, 3, 5]);
  // Thursday, not Tuesday-then-a-stray-letter.
  check('"th" beats "t"', call('_rivenDayCodes', 'm,th'), [1, 4]);

  console.log('\n-- and the ways it must NOT fire --\n');

  // THE ONE THAT MATTERS. A letter is not a day. Guessing here puts a child
  // down as absent on a date nobody mentioned.
  check('a single letter is never a day', call('_rivenDayCodes', 'out m'), []);
  check('an ordinary word is not a run of days', call('_rivenDayCodes', 'mrs smith'), []);
  check('  nor is a name', call('_rivenDayCodes', 'willow will be away'), []);
  check('  nor a repeated letter', call('_rivenDayCodes', 'mm'), []);

  console.log('\n== schedules read the same shorthand ==\n');

  check('"attends M,W,F"', call('_rivenParseWeekdays', 'attends m,w,f'), [1, 3, 5]);
  check('"tuesday-thursday"', call('_rivenParseWeekdays', 'tuesday-thursday'), [2, 3, 4]);
  check('"monday through friday"', call('_rivenParseWeekdays', 'monday through friday'), [1, 2, 3, 4, 5]);
  // Wrapping, because "friday to monday" is a real thing to say.
  check('a range that wraps the weekend', call('_rivenParseWeekdays', 'friday to monday'), [0, 1, 5, 6]);
  check('full words still win', call('_rivenParseWeekdays', 'mondays and wednesdays'), [1, 3]);
  // A sentence that already named its days must not then be re-read letter by
  // letter for stray codes.
  check('named days are not re-read as shorthand',
        call('_rivenParseWeekdays', 'she attends tuesday and thursday'), [2, 4]);

  console.log('\n== what the person is shown ==\n');

  {
    const spans = call('_rivenResolveAbsenceSpans', 'away sept 23 and 25');
    const label = call('_rivenSpanLabel', spans);
    ok('two separate days read as two', /and/.test(label));
    ok('  with real dates in it', new RegExp(iso(8, 23)).test(label));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
