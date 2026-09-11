// Reading dates out of "Jason will be missing 17, 18 and the 21st of this month".
//
// A planned absence is entered two ways: a form, where the dates are already
// dates, and a sentence to Riven, where they are whatever the person typed.
// This covers the sentence.
//
// Three things it has to get right, all of which are quietly destructive when
// wrong, because the output is a register mark against a child:
//
//   * A NUMBER THAT IS NOT A DATE MUST NOT BECOME ONE. "give him 5 rtc" has a
//     number in it. The guard is that a lone number needs an ordinal suffix
//     before it counts, and every number has to be a possible day of month.
//   * SCATTERED DAYS STAY SCATTERED. 17, 18 and 21 is two stretches, not one
//     five-day block. Collapsing them would mark a student absent on the 19th
//     and 20th, days nobody mentioned.
//   * A DAY THAT DOES NOT EXIST IS A MISHEARING. The 31st of September is not
//     the 1st of October; it is dropped.
//
// Today is frozen to Friday 2026-09-11 throughout, because every relative
// phrase here ("next monday", "the 17th") is answered against it.
//
// Run: node tests/planned-absences.test.js

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
  i = html.indexOf('{', i);
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, html.indexOf('{', m.index)).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  return new Function(args, html.slice(start + 1, i - 1));
}

// ---- today is Friday 2026-09-11 -----------------------------------------
const RealDate = Date;
const FROZEN = '2026-09-11T12:00:00';
class FakeDate extends RealDate {
  constructor(...args) { if (!args.length) super(FROZEN); else super(...args); }
  static now() { return new RealDate(FROZEN).getTime(); }
}
global.Date = FakeDate;

check('the frozen day really is a Friday', new Date().getDay(), 5);

const app = {};
for (const n of ['_rivenPhraseToDate', '_rivenAbsenceDayNumbers', '_rivenResolveAbsenceSpans', '_rivenSpanLabel']) {
  const fn = extract(n);
  app[n] = function (...a) { return fn.apply(app, a); };
}

const spans = (t) => app._rivenResolveAbsenceSpans(t);

// ---- the sentence this was built for ------------------------------------
console.log('\n== scattered days ==\n');

check('"will be missing 17,18 and 21st of this month"',
  spans('jason will be missing 17,18 and 21st of this month'),
  [{ start: '2026-09-17', end: '2026-09-18' }, { start: '2026-09-21', end: '2026-09-21' }]);

check('  consecutive days collapse, the gap is kept',
  spans('jason will be missing 17,18 and 21st of this month').length, 2);

check('spelled out with "and" throughout',
  spans('out the 17th and the 18th and the 21st'),
  [{ start: '2026-09-17', end: '2026-09-18' }, { start: '2026-09-21', end: '2026-09-21' }]);

check('a single ordinal is one day',
  spans('noah is away on the 23rd'), [{ start: '2026-09-23', end: '2026-09-23' }]);

check('days already past this month roll to next',
  spans('away on the 3rd and 4th'),
  [{ start: '2026-10-03', end: '2026-10-04' }]);

check('an explicit month is obeyed',
  spans('missing the 2nd and 3rd of november'),
  [{ start: '2026-11-02', end: '2026-11-03' }]);

check('"next month" is obeyed too',
  spans('out the 5th and 6th of next month'),
  [{ start: '2026-10-05', end: '2026-10-06' }]);

check('a list that wraps the month end',
  spans('missing the 30th and the 2nd'),
  [{ start: '2026-09-30', end: '2026-09-30' }, { start: '2026-10-02', end: '2026-10-02' }]);

// ---- numbers that are not dates -----------------------------------------
console.log('\n== a number is not a date ==\n');

check('a lone number with no ordinal is not a day', app._rivenAbsenceDayNumbers('give him 5 rtc'), null);
check('  even two of them, if neither is a date-ish phrase',
  app._rivenAbsenceDayNumbers('hook him up'), null);
check('a day beyond 31 is not a day', app._rivenAbsenceDayNumbers('missing the 45th'), null);
check('the 31st of september does not exist, so it is dropped',
  app._rivenAbsenceDayNumbers('missing the 31st of september'), null);
check('  and a real day beside it survives',
  app._rivenAbsenceDayNumbers('missing the 29th and 31st of september'), ['2026-09-29']);

// ---- ranges and single phrases still work -------------------------------
console.log('\n== ranges and plain phrases ==\n');

check('"monday to wednesday"', spans('charlotte is out monday to wednesday'),
  [{ start: '2026-09-14', end: '2026-09-16' }]);
check('"next monday"', spans('noah is out next monday'),
  [{ start: '2026-09-14', end: '2026-09-14' }]);
check('a weekday names the NEXT one, never today',
  spans('noah is out friday'), [{ start: '2026-09-18', end: '2026-09-18' }]);
check('"tomorrow"', spans('charlotte wont be in tomorrow'),
  [{ start: '2026-09-12', end: '2026-09-12' }]);
check('an ISO date is taken as written', spans('out 2026-12-01'),
  [{ start: '2026-12-01', end: '2026-12-01' }]);
check('a range whose end reads earlier is pushed a week, not inverted',
  // Said on a Friday: Thursday resolves BEFORE the Wednesday it follows.
  spans('out wednesday to thursday'), [{ start: '2026-09-16', end: '2026-09-17' }]);
check('nothing date-like at all', spans('jason will be missing'), null);

// ---- how it reads back --------------------------------------------------
console.log('\n== how it reads back ==\n');

check('one stretch', app._rivenSpanLabel([{ start: '2026-09-17', end: '2026-09-18' }]),
  '2026-09-17 to 2026-09-18');
check('one day', app._rivenSpanLabel([{ start: '2026-09-21', end: '2026-09-21' }]), '2026-09-21');
check('two stretches join with "and"',
  app._rivenSpanLabel([{ start: '2026-09-17', end: '2026-09-18' }, { start: '2026-09-21', end: '2026-09-21' }]),
  '2026-09-17 to 2026-09-18 and 2026-09-21');
check('three use commas, then "and"',
  app._rivenSpanLabel([{ start: '2026-09-01', end: '2026-09-01' }, { start: '2026-09-03', end: '2026-09-03' }, { start: '2026-09-05', end: '2026-09-05' }]),
  '2026-09-01, 2026-09-03 and 2026-09-05');

// ---- the executor writes one row per stretch ----------------------------
console.log('\n== what reaches the table ==\n');

global.Date = RealDate;
const exec = html.slice(html.indexOf('    async terminalPlanAbsence(entities) {'),
                        html.indexOf('    async terminalShowPlannedAbsences(entities) {'));
ok('the executor was located', exec.length > 500);
ok('it writes one row per stretch', /spans\.map\(sp => \(\{/.test(exec));
ok('  in a single insert', /\.from\('planned_absences'\)\.insert\(rows\)/.test(exec));
ok('  and confirms before writing anything', /_requestConfirmation\(/.test(exec));
ok('  naming every stretch and the day count', /_rivenSpanLabel\(spans\)/.test(exec) && /dayCount/.test(exec));
// The teacher said it in one sentence, so taking it back is one word.
ok('one undo covers the whole sentence', /delete\(\)\.in\('id', ids\)/.test(exec));

// A plan is not a register mark, so the two must never be the same intent.
const intents = html.slice(html.indexOf("          intent: 'PLAN_ABSENCE',"), html.indexOf("        // BRIEFING"));
ok('PLAN_ABSENCE refuses "today" outright', (intents.match(/\(\?!\.\*\\b\(?today/g) || []).length >= 4);
ok('  and needs a student', /requiresStudent: true/.test(intents));
ok('"this week" is not a cue for the upcoming list', !/\bthis\|coming\|soon\|week\b/.test(intents));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
