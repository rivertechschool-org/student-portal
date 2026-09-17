// Who is on lunch, attendance, assembly and the gate.
//
// The rota comes out of the database as one row per
// (duty × position × assignment), because that is what a join gives. Every
// screen here draws a different shape from it — a week of my own slots, a grid
// of everyone's — so the fold from rows to that shape is where the behaviour
// actually is, and it is what these tests run.
//
// THE THREE THINGS THAT MAKE IT AWKWARD, AND ARE THEREFORE THE TESTS
//
// 1. A slot can hold MORE THAN ONE PERSON. Two adults on the playground at
//    lunch is the normal case, not a mistake, so nothing may collapse a slot to
//    one name — and when it is your slot, the rota has to say who is on it with
//    you, which is half of what you went looking for.
//
// 2. The join is a LEFT join. A duty with no positions yet, and a position
//    nobody covers yet, both arrive as a row full of nulls. Both are real
//    states of a rota being built, and both have to survive the fold rather
//    than being read as corrupt.
//
// 3. A duty is school-wide OR one cohort's. Six of the eleven cohorts here only
//    attend on a single weekday, so "which group" is not decoration.
//
// Run: node tests/staff-duties.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, '..', 'shared', 'config.js'), 'utf8');

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
app._dutyDays = extract('_dutyDays');
app._dutyTree = extract('_dutyTree');
app._myDuties = extract('_myDuties');
app._dutyWhen = extract('_dutyWhen');

const tree = (rows) => app._dutyTree.call(app, rows);
const mine = (rows, who) => app._myDuties.call(app, tree(rows), who);

// One row per (duty × position × assignment), the way the join returns it.
const row = (o) => Object.assign({
  duty_id: 'd1', duty_name: 'Lunch', group_id: null, group_name: null,
  block_key: null, starts_at: null, ends_at: null, notes: null, duty_sort: 10,
  position_id: 'p1', position_name: 'Playground', position_sort: 10,
  day_of_week: null, user_id: null, full_name: null,
}, o);

(async () => {

  console.log('\n== a slot can hold more than one person ==\n');

  {
    const rows = [
      row({ day_of_week: 1, user_id: 'u1', full_name: 'Ada Vance' }),
      row({ day_of_week: 1, user_id: 'u2', full_name: 'Bo Marsh' }),
      row({ day_of_week: 2, user_id: 'u1', full_name: 'Ada Vance' }),
    ];
    const t = tree(rows);
    check('one duty', t.length, 1);
    check('  one position', t[0].positions.length, 1);
    check('  two people on Monday', t[0].positions[0].byDay[1].map(p => p.name), ['Ada Vance', 'Bo Marsh']);
    check('  one on Tuesday', t[0].positions[0].byDay[2].map(p => p.name), ['Ada Vance']);
    ok('  and nobody on Wednesday', !t[0].positions[0].byDay[3]);
  }

  {
    // Your own slot has to say who else is standing there.
    const rows = [
      row({ day_of_week: 1, user_id: 'u1', full_name: 'Ada Vance' }),
      row({ day_of_week: 1, user_id: 'u2', full_name: 'Bo Marsh' }),
      row({ day_of_week: 1, user_id: 'u3', full_name: 'Cal Ford' }),
    ];
    const m = mine(rows, 'u2');
    check('one slot of mine', m.length, 1);
    check('  and it names the others', m[0].alongside, ['Ada Vance', 'Cal Ford']);
    ok('  without listing me twice', !m[0].alongside.includes('Bo Marsh'));
  }

  console.log('\n== a rota still being built is not corrupt ==\n');

  {
    // A duty with no positions at all: one row, everything to the right null.
    const t = tree([row({ position_id: null, position_name: null, position_sort: null })]);
    check('the duty survives', t.length, 1);
    check('  with no positions', t[0].positions.length, 0);
    check('  and nobody on it', mine([row({ position_id: null })], 'u1').length, 0);
  }
  {
    // A position nobody covers yet.
    const t = tree([row({})]);
    check('the position survives', t[0].positions.length, 1);
    check('  with an empty week', Object.keys(t[0].positions[0].byDay).length, 0);
  }

  console.log('\n== order is the order people read in ==\n');

  {
    const rows = [
      row({ duty_id: 'd2', duty_name: 'Gate', duty_sort: 30, position_id: 'p9', position_name: 'Front', position_sort: 10, day_of_week: 1, user_id: 'u1', full_name: 'Ada Vance' }),
      row({ duty_id: 'd1', duty_name: 'Lunch', duty_sort: 10, position_id: 'p2', position_name: 'Canteen', position_sort: 20 }),
      row({ duty_id: 'd1', duty_name: 'Lunch', duty_sort: 10, position_id: 'p1', position_name: 'Playground', position_sort: 10 }),
    ];
    const t = tree(rows);
    check('duties in their own order', t.map(d => d.name), ['Lunch', 'Gate']);
    check('  positions in theirs', t[0].positions.map(p => p.name), ['Playground', 'Canteen']);
  }

  {
    // My week reads Monday to Friday whatever order the rows arrived in.
    const rows = [
      row({ day_of_week: 4, user_id: 'u1', full_name: 'Ada Vance' }),
      row({ day_of_week: 1, user_id: 'u1', full_name: 'Ada Vance' }),
      row({ duty_id: 'd2', duty_name: 'Gate', duty_sort: 30, position_id: 'p9', position_name: 'Front',
            day_of_week: 1, user_id: 'u1', full_name: 'Ada Vance' }),
    ];
    check('my week is in weekday order', mine(rows, 'u1').map(m => m.dow), [1, 1, 4]);
    check('  and within a day, duty order', mine(rows, 'u1').slice(0, 2).map(m => m.duty.name), ['Lunch', 'Gate']);
  }

  console.log('\n== school-wide or one cohort ==\n');

  {
    const t = tree([
      row({ group_id: null, group_name: null }),
      row({ duty_id: 'd2', duty_name: 'Attendance', group_id: 'g1', group_name: 'Homeschool Younger Thursday',
            position_id: 'p5', position_name: 'Register', day_of_week: 4, user_id: 'u1', full_name: 'Ada Vance' }),
    ]);
    // Looked up by name, not by index: the fold sorts, so an index here would
    // be asserting the sort order in the middle of a test about groups.
    const byName = (n) => t.find(d => d.name === n);
    check('a school-wide duty has no group', byName('Lunch').group_name, null);
    check('  and a cohort duty names it', byName('Attendance').group_name, 'Homeschool Younger Thursday');
    // The cohort is carried onto my slot, because "Thursday, Register" without
    // it does not say which children.
    check('  which my own row carries too',
          mine([row({ duty_id: 'd2', group_id: 'g1', group_name: 'Homeschool Younger Thursday',
                      day_of_week: 4, user_id: 'u1', full_name: 'Ada Vance' })], 'u1')[0].duty.group_name,
          'Homeschool Younger Thursday');
  }

  console.log('\n== when it happens ==\n');

  {
    const when = (d, bell) => { app._bellRows = bell || []; return app._dutyWhen.call(app, d); };
    check('explicit times read as people say them',
          when({ starts_at: '12:15:00', ends_at: '12:55:00' }), '12:15 pm–12:55 pm');
    check('a morning one too',
          when({ starts_at: '08:30:00', ends_at: '09:20:00' }), '8:30 am–9:20 am');
    // Tied to the bell instead: the duty follows the block, so moving the bell
    // moves the duty and nothing here needs editing.
    check('a block is named and timed from the bell schedule',
          when({ block_key: 'lunch' },
               [{ block_key: 'lunch', day_of_week: null, label: 'Lunch', starts_at: '12:15:00', ends_at: '12:55:00' }]),
          'Lunch · 12:15 pm–12:55 pm');
    // A block that has since been removed from the bell schedule must not
    // render "undefined" at somebody.
    check('  a block that no longer exists still says something',
          when({ block_key: 'chapel' }, []), 'chapel');
    check('no time set is no time shown', when({}), '');
  }

  console.log('\n== reachable, and only by staff ==\n');

  ok('there is a section to render into', /id="staff-duties-section"/.test(html));
  ok('the nav dispatches to it', /case 'staff-duties':[\s\S]{0,80}renderStaffDuties\(\)/.test(html));
  ok('  and the admin dashboard has a way in', /showSection\('staff-duties'\)/.test(html));
  {
    const item = (config.match(/\{[^}]*section: 'staff-duties'[^}]*\}/) || [''])[0];
    ok('it is in the nav', !!item);
    ok('  for teachers and admins', /roles: \['teacher', 'admin'\]/.test(item));
    // A duty rota is a staff working document. The database says the same; this
    // is the affordance agreeing with it rather than contradicting it.
    ok('  and not for students or parents', !/student|parent/.test(item));
  }
  {
    // Five weekdays, no weekend. The database refuses a Saturday; the screen
    // should not offer one.
    const days = app._dutyDays.call(app);
    check('five weekdays', days.map(d => d.dow), [1, 2, 3, 4, 5]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
