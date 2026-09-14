// Operating RTC on one group: the Balances tab's Group picker.
//
// The bulk award reads `_rtcFilteredStudents`, the same list the table renders,
// so narrowing the filter IS how an award is aimed at a group. That makes two
// things load-bearing:
//
//   * membership is a separate map (studentId -> [groupId]), not a column on
//     the student, so a student who is in no group must survive "All groups"
//     and fall out of every named group rather than the other way round;
//   * the card has to name the scope it is about to award to. "All Filtered
//     Students" reads the same whether the picker is on a group or not, and
//     the difference between those two is every student in the school.
//
// Run: node tests/rtc-group-filter.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};

// ---- extract the real methods -----------------------------------------
function method(name, indent = '    ') {
  const sig = `\n${indent}${name}(`;
  const start = html.indexOf(sig);
  if (start === -1) throw new Error(name + ' not found');
  const end = html.indexOf(`\n${indent}}\n`, start);
  if (end === -1) throw new Error(name + ' unterminated');
  const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
  return eval(`(function ${body.slice(name.length)})`);
}

const filterAdminRTC = method('filterAdminRTC');
const _rtcFilterScopeLabel = method('_rtcFilterScopeLabel');

// ---- a DOM just real enough -------------------------------------------
// The filter reads four controls by id and writes the scope line's text.
function makeApp({ search = '', sort = 'name-asc', group = '', scopeEl = { textContent: '' } } = {}) {
  const fields = {
    'rtc-search': { value: search },
    'rtc-sort': { value: sort },
    'rtc-group': { value: group },
    'rtc-bulk-scope': scopeEl,
  };
  global.document = { getElementById: (id) => fields[id] || null };

  const app = {
    _rtcStudents: [
      { id: 'ann', first_name: 'Ann', last_name: 'Becker', rtc_balance: 40 },
      { id: 'ben', first_name: 'Ben', last_name: 'Chase', rtc_balance: 10 },
      { id: 'cal', first_name: 'Cal', last_name: 'Diaz', rtc_balance: 25 },
      { id: 'dee', first_name: 'Dee', last_name: 'Ellis', rtc_balance: 0 },
    ],
    _rtcGroups: [
      { id: 'g-jh', name: 'Junior High' },
      { id: 'g-choir', name: 'Choir' },
      { id: 'g-empty', name: 'Robotics' },
    ],
    _rtcGroupsByStudent: {
      ann: ['g-jh'],
      ben: ['g-jh', 'g-choir'],
      cal: [],          // in the map, but a member of nothing
      // dee is absent from the map entirely
    },
    filterAdminRTC,
    _rtcFilterScopeLabel,
    renderAdminRTCTable() {},   // the table is not what this test is about
    _scopeEl: scopeEl,
  };
  return app;
}

const ids = (app) => (app._rtcFilteredStudents || []).map(s => s.id);

// ---- 1. the group narrows the list ------------------------------------
let app = makeApp();
app.filterAdminRTC();
check('no group selected keeps everyone', ids(app), ['ann', 'ben', 'cal', 'dee']);

app = makeApp({ group: 'g-jh' });
app.filterAdminRTC();
check('a group keeps only its members', ids(app), ['ann', 'ben']);

app = makeApp({ group: 'g-choir' });
app.filterAdminRTC();
check('a second group', ids(app), ['ben']);

app = makeApp({ group: 'g-empty' });
app.filterAdminRTC();
check('a group nobody is in awards to nobody', ids(app), []);

// A student with no membership row at all must not leak into a named group -
// that is the shape that would quietly pay a child who was never in the class.
app = makeApp({ group: 'g-jh' });
app.filterAdminRTC();
check('student missing from the map is not in any group', ids(app).includes('dee'), false);

// ---- 2. group and the other controls compose ---------------------------
app = makeApp({ group: 'g-jh', search: 'ben' });
app.filterAdminRTC();
check('group AND search intersect', ids(app), ['ben']);

app = makeApp({ group: 'g-jh', sort: 'balance-desc' });
app.filterAdminRTC();
check('sorting still applies inside a group', ids(app), ['ann', 'ben']);

app = makeApp({ group: 'g-jh', search: 'zzz' });
app.filterAdminRTC();
check('intersection can be empty', ids(app), []);

// ---- 3. the bulk-award card names what it will hit ---------------------
app = makeApp();
app.filterAdminRTC();
check('scope line, no group', app._scopeEl.textContent, 'Bulk Award to All Filtered Students (4 students)');

app = makeApp({ group: 'g-jh' });
app.filterAdminRTC();
check('scope line names the group and its count', app._scopeEl.textContent, 'Bulk Award to Junior High (2 students)');

app = makeApp({ group: 'g-choir' });
app.filterAdminRTC();
check('scope line is singular for one student', app._scopeEl.textContent, 'Bulk Award to Choir (1 student)');

app = makeApp({ group: 'g-empty' });
app.filterAdminRTC();
check('scope line for an empty group', app._scopeEl.textContent, 'Bulk Award to Robotics (0 students)');

// The confirm text is built from this label, so an unknown id must read as
// "no named scope" rather than printing a raw uuid at a teacher.
app = makeApp({ group: 'g-gone' });
check('unknown group id has no label', app._rtcFilterScopeLabel(), null);
app = makeApp();
check('no selection has no label', app._rtcFilterScopeLabel(), null);

// ---- 4. the picker is wired into the page ------------------------------
check('picker calls the filter', html.includes(`<select id="rtc-group" onchange="app.filterAdminRTC()"`), true);
check('picker offers All groups', html.includes('<option value="">All groups</option>'), true);
check('bulk card has the scope line', html.includes('<div id="rtc-bulk-scope"'), true);
check('bulk confirm names the group',
  html.includes('${scope ? \' in \' + scope : \'\'}'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
