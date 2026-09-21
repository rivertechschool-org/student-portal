// A pupil's strike count is the same number on every screen.
//
// It was not. `getStudentStrikes()` applied decay; the Strikes roster counted
// raw rows and left decay "when viewing individual student". So a pupil whose
// strikes had all expired went on showing 2/3 on the list staff actually scan,
// and opening their record was what both corrected the number AND deleted the
// rows — which meant the roster was only ever right about people somebody had
// already looked at.
//
// The rule now lives in one pure function, `strikeDecay(rows, now)`, that both
// screens call. Pure matters: the roster needs the count without deleting
// anything, and only the record view should tidy up.
//
// THE RULE. The clock restarts from the MOST RECENT strike. With three on
// record, the oldest clears three months after the latest one, the next at six,
// the newest at nine. So a pupil who keeps earning strikes keeps all of them;
// one who stops loses them one at a time.
//
// Run: node tests/strike-decay.test.js

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

function methodSource(name) {
  const re = new RegExp(`\\n {6}(?:async )?${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(name + ' not found');
  let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(m.index, i);
}

const app = new Function(`"use strict"; return { ${methodSource('strikeDecay')} };`)();

// Newest first, which is how both callers fetch them.
const at = (...isoDates) => isoDates.map((d, i) => ({ id: 's' + i, created_at: d }));
const ON = d => new Date(d);

console.log('\n== nothing on record ==\n');

check('no strikes, nothing active', app.strikeDecay([], ON('2026-09-20')).active.length, 0);
check('  and nothing to delete', app.strikeDecay([], ON('2026-09-20')).expired.length, 0);
check('undefined is not a crash', app.strikeDecay(undefined, ON('2026-09-20')).active.length, 0);

console.log('\n== one strike ==\n');

{
  const rows = at('2026-06-01');
  check('a day later it stands', app.strikeDecay(rows, ON('2026-06-02')).active.length, 1);
  check('just under three months it stands', app.strikeDecay(rows, ON('2026-08-31')).active.length, 1);
  check('at three months it is gone', app.strikeDecay(rows, ON('2026-09-01')).active.length, 0);
  check('  and is offered for deletion', app.strikeDecay(rows, ON('2026-09-01')).expired.length, 1);
}

console.log('\n== the clock restarts from the most recent ==\n');

{
  // Two strikes, the second four months after the first. If decay ran from each
  // strike's own date the first would already be gone; it does not.
  const rows = at('2026-05-01', '2026-01-01');   // newest first
  check('four months after the older one, both stand',
        app.strikeDecay(rows, ON('2026-05-02')).active.length, 2);
  // Oldest clears at most-recent + 3 months = 2026-08-01.
  check('the older clears three months after the NEWER',
        app.strikeDecay(rows, ON('2026-08-02')).active.length, 1);
  check('  and it is the older one that went',
        app.strikeDecay(rows, ON('2026-08-02')).expired[0].created_at, '2026-01-01');
  // The newer clears at most-recent + 6 months = 2026-11-01.
  check('the newer clears at six months',
        app.strikeDecay(rows, ON('2026-11-02')).active.length, 0);
}

{
  const rows = at('2026-05-01', '2026-04-01', '2026-03-01');
  check('three on record all stand at first', app.strikeDecay(rows, ON('2026-05-02')).active.length, 3);
  check('  two left after three months', app.strikeDecay(rows, ON('2026-08-02')).active.length, 2);
  check('  one left after six', app.strikeDecay(rows, ON('2026-11-02')).active.length, 1);
  check('  none after nine', app.strikeDecay(rows, ON('2027-02-02')).active.length, 0);
}

{
  // The behaviour that makes the rule worth having: earning a new strike
  // pushes the old ones back rather than letting them lapse separately.
  const before = at('2026-04-01', '2026-03-01');
  check('two old strikes would be down to one by August',
        app.strikeDecay(before, ON('2026-07-05')).active.length, 1);
  const after = at('2026-07-01', '2026-04-01', '2026-03-01');
  check('  but a fresh strike in July holds all three',
        app.strikeDecay(after, ON('2026-07-05')).active.length, 3);
}

console.log('\n== what it hands back ==\n');

{
  const rows = at('2026-05-01', '2026-01-01');
  const { active, expired } = app.strikeDecay(rows, ON('2026-08-02'));
  ok('an active strike carries its own decay date', active[0].decayDate instanceof Date);
  {
    // Asserted as a RELATIONSHIP, not a literal date. `created_at` parses as
    // UTC midnight while setMonth() works in local time, so the result lands a
    // day either side depending on the machine's offset — which is the existing
    // behaviour, immaterial for a three-month timer, and absolutely not
    // something a test should freeze into a string.
    const expected = new Date('2026-05-01');
    expected.setMonth(expected.getMonth() + 6);
    const daysApart = Math.abs(active[0].decayDate - expected) / 86400000;
    ok(`  which is six months from the most recent (${active[0].decayDate.toISOString().slice(0, 10)})`,
       daysApart < 1.5);
  }
  check('active and expired account for every row', active.length + expired.length, rows.length);
  ok('the original rows are not mutated', rows.every(r => !('decayDate' in r)));
}

console.log('\n== both screens ask the same function ==\n');

{
  const roster = methodSource('renderAdminStrikes');
  const record = methodSource('getStudentStrikes');

  ok('the roster applies decay', /this\.strikeDecay\(/.test(roster));
  ok('  rather than counting raw rows',
     !/strikeCounts\[s\.student_id\] = \(strikeCounts\[s\.student_id\] \|\| 0\) \+ 1/.test(roster));
  ok('the record view applies decay', /this\.strikeDecay\(/.test(record));

  // The three-month arithmetic must exist once, in the helper, and nowhere else.
  const sites = (html.match(/setMonth\([^)]*getMonth\(\) \+ \(3 \*/g) || []).length;
  check('the three-month rule is written once', sites, 1);
}

{
  // Pure: the roster must not delete anything while counting.
  const helper = methodSource('strikeDecay');
  ok('the helper touches no database', !/supabase|delete\(|from\(/.test(helper));
  ok('  and takes `now` so it can be tested', /strikeDecay\(rows, now = new Date\(\)\)/.test(helper));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
