// A subject in a new Drive group must actually appear.
//
// Subjects live in the database and the admin panel can already edit them. The
// GROUP each one belongs to could not be chosen so freely: the five academic
// names were written out in the client twice — once to order the optgroups on
// the class form, once to fill the group dropdown in the admin panel — on top of
// the two places the database pins them.
//
// The client half failed in the quietest possible way. buildSubjectOptions
// walked a hard-coded list of five group names and rendered an <optgroup> for
// each. A subject in a sixth group was not mis-sorted or shown oddly: it was
// simply **not rendered at all**. The form would have looked complete, the row
// would have been in the database, and nobody would have had anything to search
// for.
//
// So both places derive the groups from the rows now, and this file holds that:
// the five keep their established order (the order of the school's own START
// HERE document, not alphabetical chance), anything else follows, and nothing is
// dropped.
//
// Run: node tests/subject-groups.test.js

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

const app = new Function(`
  "use strict";
  return {
    escapeHtml(t) {
      if (t == null) return '';
      return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    },
    ${methodSource('subjectGroupOrder')},
    ${methodSource('buildSubjectOptions')}
  };
`)();

const row = (subject, group_name) => ({ subject, group_name });

console.log('\n== the order the school reads them in ==\n');

{
  const rows = [row('Algebra', 'Core'), row('Robotics', 'Tech'), row('Choir', 'Arts'),
                row('Cooking', 'Life'), row('PE', 'Health')];
  check('the five keep their established order',
        app.subjectGroupOrder(rows), ['Core', 'Tech', 'Arts', 'Life', 'Health']);
}

{
  // Shuffled input must not shuffle the output — it is a fixed reading order,
  // not whatever the database happened to return first.
  const rows = [row('PE', 'Health'), row('Choir', 'Arts'), row('Algebra', 'Core')];
  check('order does not depend on row order',
        app.subjectGroupOrder(rows), ['Core', 'Arts', 'Health']);
}

{
  check('a group with no subjects is not offered',
        app.subjectGroupOrder([row('Algebra', 'Core')]), ['Core']);
  check('no rows, no groups', app.subjectGroupOrder([]), []);
  check('undefined is not a crash', app.subjectGroupOrder(undefined), []);
  check('a blank group name is ignored',
        app.subjectGroupOrder([row('X', ''), row('Y', null), row('Algebra', 'Core')]), ['Core']);
}

console.log('\n== and anything new comes after ==\n');

{
  const rows = [row('Algebra', 'Core'), row('Study Hall', 'Other'), row('PE', 'Health')];
  check('a sixth group follows the five',
        app.subjectGroupOrder(rows), ['Core', 'Health', 'Other']);
}

{
  const rows = [row('A', 'Zebra'), row('B', 'Other'), row('C', 'Core')];
  check('several new ones are sorted among themselves',
        app.subjectGroupOrder(rows), ['Core', 'Other', 'Zebra']);
}

console.log('\n== the bug: a subject that was never rendered ==\n');

{
  // The whole point. Before this, buildSubjectOptions walked five fixed names,
  // so "Study Hall" in group "Other" produced no <option> anywhere — silently.
  app._subjectGroups = [
    row('Algebra', 'Core'),
    row('Study Hall', 'Other'),
    row('Props', 'Other'),
    row('Other', 'Other'),
  ];
  const opts = app.buildSubjectOptions(null);

  ok('a subject in a new group is rendered at all', opts.includes('>Study Hall<'));
  ok('  and so are the others beside it', opts.includes('>Props<') && opts.includes('>Other<'));
  ok('  under an optgroup named for their group', /<optgroup label="Other">/.test(opts));
  ok('the academic ones still render', opts.includes('>Algebra<'));
  ok('  under theirs', /<optgroup label="Core">/.test(opts));

  // Core before Other, because Core is one of the five.
  ok('  and Core comes first', opts.indexOf('label="Core"') < opts.indexOf('label="Other"'));

  const groups = [...opts.matchAll(/<optgroup label="([^"]+)"/g)].map(m => m[1]);
  check('exactly one optgroup per group present', groups, ['Core', 'Other']);
}

{
  // Selecting one has to survive the round trip, or editing a study-hall class
  // would quietly change what it is.
  app._subjectGroups = [row('Algebra', 'Core'), row('Study Hall', 'Other')];
  const opts = app.buildSubjectOptions('Study Hall');
  ok('the chosen subject comes back selected', /<option value="Study Hall" selected>/.test(opts));
  check('  and is not also listed as unknown', /Not in the subject list/.test(opts), false);
}

{
  // A subject that predates the list still has to stay selectable.
  app._subjectGroups = [row('Algebra', 'Core')];
  const opts = app.buildSubjectOptions('Latin');
  ok('an off-list subject is kept', opts.includes('>Latin<'));
  ok('  and labelled as such', /Not in the subject list/.test(opts));
}

{
  app._subjectGroups = [];
  const opts = app.buildSubjectOptions(null);
  ok('with no list at all the field still works', /Select Subject/.test(opts));
}

console.log('\n== nothing lists the groups by hand any more ==\n');

{
  // Two sites are allowed to name the five: the helper that defines their
  // reading order, and the admin panel's floor of always-offerable groups.
  // Anything else is a list that will go stale.
  const sites = (html.match(/\['Core', 'Tech', 'Arts', 'Life', 'Health'\]/g) || []).length;
  check('the five are named in exactly two places', sites, 2);

  ok('the class form asks for the order', /this\.subjectGroupOrder\(rows\)\.forEach/.test(html));
  check('  and no longer walks a literal list',
        /\['Core', 'Tech', 'Arts', 'Life', 'Health'\]\.forEach/.test(html), false);

  ok('the admin panel offers whatever exists',
     /\.concat\(this\.subjectGroupOrder\(c\.subjects\)\)/.test(html));
  ok('  without repeating any', /\[\.\.\.new Set\(/.test(methodSource('renderCurriculumModal')));
}

console.log('\n== the panel is reachable ==\n');

ok('Admin → Settings offers the editor',
   /onclick="app\.showCurriculumLists\(\)"/.test(html));
ok('  and it can add, rename and delete a subject',
   /rt_save_subject/.test(html) && /rt_delete_subject/.test(html));
ok('  refreshing the cached lists afterwards',
   /_subjectGroups = null/.test(methodSource('_afterCurriculumChange')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
