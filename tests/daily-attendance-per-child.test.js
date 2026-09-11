// Two phones on the same register.
//
// Daily attendance used to save by sweeping every row in the table and
// bulk-upserting the lot. That loses other people's work, silently:
//
//   08:00  Phone A opens the register, marks ten children, saves.
//   08:06  Phone B opens it. Its dropdowns are pre-filled with A's marks.
//   08:09  Phone A corrects one child from present to late.
//   08:10  Phone B marks three more and saves — writing all thirteen rows from
//          the snapshot it loaded at 08:06, and reverting A's correction.
//
// Nobody is warned, because from the database's side it is an ordinary upsert
// of values that a browser really was showing.
//
// So: a change to a child writes that child and nothing else, and the Save
// button is a retry for what the network swallowed rather than a second way to
// write the whole register.
//
// Run: node tests/daily-attendance-per-child.test.js

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
  // Build a sync function as sync. Wrapping everything in the async
  // constructor makes the plain helpers return a Promise, which reads as an
  // empty object and fails every assertion for the wrong reason.
  const Ctor = /async\s/.test(m[0])
    ? Object.getPrototypeOf(async function () {}).constructor
    : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// ---- enough DOM for three rows ------------------------------------------
function makeDom(seed) {
  const rows = {};
  for (const [id, status] of Object.entries(seed)) {
    const cell = { children: [], appendChild(el) { this.children.push(el); }, querySelector: () => null };
    const row = {
      dataset: { studentId: id },
      _f: {
        '.attendance-status': { value: status, dataset: { studentId: id } },
        '.arrived-at-period': { value: '2', dataset: { studentId: id } },
        '.left-at-period': { value: '5', dataset: { studentId: id } },
        '.excused-checkbox': { checked: false, dataset: { studentId: id } },
        '.excuse-note': { value: '', dataset: { studentId: id } },
      },
      _state: null,
      querySelector(sel) {
        if (sel === 'td') return cell;
        if (sel === '.daily-row-state') return row._state;
        return row._f[sel] || null;
      },
    };
    rows[id] = row;
  }
  const pick = (sel) => {
    let m = sel.match(/^tr\[data-student-id="([^"]+)"\]$/);
    if (m) return rows[m[1]] || null;
    m = sel.match(/^(\.[a-z-]+)\[data-student-id="([^"]+)"\]$/);
    if (m) return rows[m[2]]?._f[m[1]] || null;
    if (sel === 'tr[data-student-id] .attendance-status') {
      const first = Object.values(rows)[0];
      return first ? first._f['.attendance-status'] : null;
    }
    return null;
  };
  global.document = {
    activeElement: null,
    querySelector: pick,
    querySelectorAll: (sel) => (sel === 'tr[data-student-id]' ? Object.values(rows) : []),
    createElement: () => ({ style: {}, className: '', textContent: '' }),
  };
  // _markDailyRow appends its tag to the first cell; hand it back afterwards.
  for (const row of Object.values(rows)) {
    const cell = row.querySelector('td');
    const origAppend = cell.appendChild.bind(cell);
    cell.appendChild = (el) => { row._state = el; origAppend(el); };
  }
  return rows;
}

function makeApp(seed, { fails = new Set(), serverRows = [] } = {}) {
  const rows = makeDom(seed);
  const app = {
    writes: [],
    notices: [],
    _dailyDate: '2026-09-11',
    _dailyPending: new Set(),
    _dailyNoteTimers: {},
    _rows: rows,
    userInfo: { user: { id: 'staff-1' } },
    showNotification(m, k) { this.notices.push(`${k}:${m}`); },
    sendAttendanceAlertNotifications() {},
    auth: {
      supabase: {
        from: () => ({
          upsert: (recs) => {
            if (recs.some(r => fails.has(r.student_id))) return Promise.resolve({ error: new Error('network') });
            app.writes.push(recs.map(r => r.student_id));
            return Promise.resolve({ error: null });
          },
          select: () => ({ eq: () => Promise.resolve({ data: serverRows, error: null }) }),
        }),
      },
    },
  };
  for (const n of ['_dailyAttendanceRecord', '_markDailyRow', 'saveOneAttendance',
                   'saveDailyAttendance', 'refreshDailyAttendance', 'onAttendanceStatusChange']) {
    const fn = extract(n);
    app[n] = function (...a) { return fn.apply(app, a); };
  }
  // onAttendanceStatusChange touches elements this stub does not model; the
  // refresh only needs it for the show/hide half, so make that a no-op.
  app.onAttendanceStatusChange = () => {};
  return app;
}

(async () => {
  console.log('\n== one child, one write ==\n');

  {
    const app = makeApp({ s1: 'present', s2: 'absent', s3: '' });
    await app.saveOneAttendance('s1');
    check('marking a child writes exactly one row', app.writes, [['s1']]);
    check('  and nothing is left pending', [...app._dailyPending], []);
  }

  {
    const app = makeApp({ s1: 'late', s2: '', s3: '' });
    const rec = app._dailyAttendanceRecord('s1');
    check('a late arrival carries the period', rec.arrived_at_period, 2);
    check('  and not a departure', rec.left_at_period, null);
    check('  with the roster\'s date, not today', rec.date, '2026-09-11');
    check('an unmarked child produces nothing at all', app._dailyAttendanceRecord('s2'), null);
  }

  console.log('\n== the button no longer sweeps ==\n');

  {
    // THE REGRESSION. Every row here has a status, and the old code would have
    // written all three — including two this device never touched.
    const app = makeApp({ s1: 'present', s2: 'absent', s3: 'late' });
    await app.saveDailyAttendance('2026-09-11');
    check('with nothing pending it writes NOTHING', app.writes, []);
    ok('  and says so', app.notices.some(n => /already saved/i.test(n)));
  }

  {
    // A failed write stays pending, and the button is how you retry it.
    const app = makeApp({ s1: 'present', s2: 'absent', s3: 'late' }, { fails: new Set(['s2']) });
    await app.saveOneAttendance('s2');
    check('a failed save writes nothing', app.writes, []);
    check('  and stays pending', [...app._dailyPending], ['s2']);
    ok('  telling the person on that row', app._rows.s2._state.textContent.includes('Not saved'));

    app.auth.supabase.from = () => ({
      upsert: (recs) => { app.writes.push(recs.map(r => r.student_id)); return Promise.resolve({ error: null }); },
    });
    await app.saveDailyAttendance('2026-09-11');
    check('the button retries only that row', app.writes, [['s2']]);
    check('  and clears it once written', [...app._dailyPending], []);
  }

  console.log('\n== the other phone\'s marks arrive ==\n');

  {
    const app = makeApp({ s1: '', s2: '', s3: '' }, {
      serverRows: [
        { student_id: 's1', status: 'present' },
        { student_id: 's2', status: 'absent' },
      ],
    });
    await app.refreshDailyAttendance();
    check('a row this device never touched takes the server value', app._rows.s1._f['.attendance-status'].value, 'present');
    check('  and so does the next', app._rows.s2._f['.attendance-status'].value, 'absent');
    check('  refreshing writes nothing back', app.writes, []);
  }

  {
    // Pulling the server's value over a half-finished change is the same bug
    // in the other direction.
    const app = makeApp({ s1: 'late', s2: '', s3: '' }, {
      serverRows: [{ student_id: 's1', status: 'present' }],
    });
    app._dailyPending.add('s1');
    await app.refreshDailyAttendance();
    check('a row with an unsaved edit is left alone', app._rows.s1._f['.attendance-status'].value, 'late');
  }

  {
    // And the box someone is typing in is not yanked out from under them.
    const app = makeApp({ s1: 'late', s2: '', s3: '' }, {
      serverRows: [{ student_id: 's1', status: 'present' }],
    });
    global.document.activeElement = app._rows.s1._f['.attendance-status'];
    await app.refreshDailyAttendance();
    check('the control in focus is left alone', app._rows.s1._f['.attendance-status'].value, 'late');
    global.document.activeElement = null;
  }

  console.log('\n== the wiring ==\n');

  ok('every control on a row saves that row',
    (html.match(/onchange="app\.saveOneAttendance\('\$\{student\.id\}'\)"/g) || []).length === 3);
  ok('  and the note waits for the typing to stop',
    /oninput="app\.queueOneAttendance\('\$\{student\.id\}'\)"/.test(html));
  ok('changing the status saves too',
    /if \(save && studentId\) setTimeout\(\(\) => this\.saveOneAttendance\(studentId\), 0\);/.test(html));
  ok('the refresh stops itself when the roster closes',
    /clearInterval\(this\._dailyRefreshTimer\);\s*\n\s*this\._dailyRefreshTimer = null;/.test(html));
  ok('  and reopening cannot stack a second timer',
    /clearInterval\(this\._dailyRefreshTimer\);\s*\n\s*this\._dailyRefreshTimer = setInterval/.test(html));

  // The class register is a different screen with its own save; this change
  // was not supposed to reach it.
  ok('the class register still saves the way it did',
    /this\.showNotification\(`Saved attendance for \$\{attendanceRecords\.length\} students\$\{periodLabel\}`/.test(html));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
