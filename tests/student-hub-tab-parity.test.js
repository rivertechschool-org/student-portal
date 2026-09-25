// The Student Hub must not be able to quietly lose a capability again.
//
// My Students used to open its own details modal. That modal had eight tabs -
// Overview, Contacts, Medical, Notes, RTC, Skill Trees, Weekly Activity and
// Activity Log - and when it was folded into the Student Hub the first four
// mapped onto hub tabs and the last four did not. Teachers lost RTC awarding,
// skill trees, weekly activity and the activity log from that screen, and
// nothing failed: the loaders were still there, just unreachable.
//
// So this pins the mapping. Each restored tab has to paint the element ids its
// loader looks up - the loaders were written against the modal's markup and
// were not touched - and has to hand off to that loader.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

function extract(header) {
  const i = SRC.indexOf(header);
  if (i < 0) return null;
  let p = i, d = 0, sigEnd = -1;
  for (; p < SRC.length; p++) {
    if (SRC[p] === '(') d++;
    else if (SRC[p] === ')') { d--; if (d === 0) { sigEnd = p; break; } }
  }
  let j = SRC.indexOf('{', sigEnd); d = 0;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (d === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}

function compile(text) {
  const m = /^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/.exec(text);
  const Ctor = /^\s*async\b/.test(text)
    ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(...m[1].split(',').map(s => s.trim()).filter(Boolean), m[2]);
}

// What each restored tab is for: the renderer, the loader it must reach, and
// the ids that loader looks up by name.
//   onClick  - reached from a control in the markup, so asserted as a handler
//   onRender - must actually fire when the tab is opened, so asserted by
//              running it. Checking the body merely CONTAINS the name passes
//              on a commented-out call, which is how two of these assertions
//              first survived mutation.
const TABS = [
  { key: 'rtc',         fn: 'renderStudentHubRtcTab',
    onClick: ['awardRtc', 'loadRtcTransactions', 'loadStudentPrivileges'],
    onRender: [],
    ids: ['rtc-award-amount', 'rtc-award-reason', 'rtc-transaction-history',
          'sd-active-privileges'] },
  { key: 'skills',      fn: 'renderStudentHubSkillsTab',
    onClick: ['openStudentSkillTree'],
    onRender: ['loadStudentSkillsTab'],
    ids: ['skill-subject-select', 'skill-progress-content'] },
  { key: 'activity',    fn: 'renderStudentHubActivityTab',
    onClick: [],
    onRender: ['loadStudentWeeklyActivity'],
    ids: ['student-weekly-activity-content'] },
  { key: 'activitylog', fn: 'renderStudentHubActivityLogTab',
    onClick: [],
    onRender: ['loadStudentActivityLog'],
    ids: ['activity-log-range', 'activity-log-filters',
          'student-activity-log-content'] },
];

const hub = extract('      renderStudentHub() {');
const sw  = extract('      switchStudentHubTab(tab) {');

console.log('\nthe tab bar offers them');
for (const t of TABS) {
  ok(`${t.key} has a button`, hub.includes(`switchStudentHubTab('${t.key}')`));
  ok(`  and a switch arm that renders it`,
     new RegExp(`case '${t.key}':\\s*this\\.${t.fn}\\(\\)`).test(sw));
}

console.log('\neach tab paints what its loader looks for');
for (const t of TABS) {
  const body = extract('      ' + t.fn + '() {');
  ok(`${t.fn} exists`, !!body);
  if (!body) continue;
  const missing = t.ids.filter(id => !body.includes(`id="${id}"`));
  ok(`  paints every id its loader reads: ` +
     (missing.length ? 'MISSING ' + missing.join(', ') : t.ids.join(', ')),
     missing.length === 0);
  // Click-time loaders have to be wired to a real control, not merely named
  // somewhere in the body - an onclick="" is the thing that reaches them.
  const unwired = t.onClick.filter(l => !body.includes(`onclick="app.${l}(`)
                                     && !body.includes(`onchange="app.${l}(`));
  ok(`  wires ` + (t.onClick.length
        ? (unwired.length ? 'ALL BUT ' + unwired.join(', ') : t.onClick.join(', '))
        : 'no click-time loader'),
     unwired.length === 0);
  // The stylesheet for the modal's own classes went with the modal, so any
  // sd-* class left in this markup is invisible styling.
  ok(`  carries no orphaned sd-* class`, !/class="sd-/.test(body));
}

console.log('\nthe restored tabs actually run');
{
  const els = {};
  global.document = {
    getElementById: (id) => els[id] || (els[id] = { id, innerHTML: '' }),
  };
  for (const t of TABS) {
    const fn = compile(extract('      ' + t.fn + '() {'));
    const called = [];
    const app = {
      _studentHubData: { student: { id: 'stu-1', email: 'x@example.invalid', rtc_balance: 12 } },
      _studentHubId: 'stu-1',
      userInfo: { profile: { user_type: 'teacher' } },
    };
    [...t.onClick, ...t.onRender].forEach(l => { app[l] = () => called.push(l); });
    els['student-hub-tab-content'] = { innerHTML: '' };
    let threw = null;
    try { fn.call(app); } catch (e) { threw = e; }
    ok(`${t.fn} renders without throwing`, threw === null);
    ok(`  and puts markup in the hub tab body`,
       els['student-hub-tab-content'].innerHTML.length > 50);
    // Opening the tab has to load it. A commented-out call reads the same as
    // a live one in the source; running it does not.
    const late = t.onRender.filter(l => !called.includes(l));
    ok(`  and loads ` + (t.onRender.length
          ? (late.length ? 'NOTHING - missing ' + late.join(', ') : t.onRender.join(', '))
          : 'on demand, not on open'),
       late.length === 0);
    // The RTC tab loads nothing on open by design - its history and privileges
    // are behind buttons. Assert that rather than leaving it unstated.
    if (!t.onRender.length) ok(`  and issues no load on open`, called.length === 0);

    if (t.key === 'activitylog') {
      // Its range selector re-reads this off the app instead of taking an
      // argument. If the tab did not set it, changing the range would reload
      // the wrong student - and a commented-out assignment looks identical in
      // the source, so check the value after running.
      ok('  and leaves the student id where the range selector will find it',
         app._currentStudentDetailsId === 'stu-1');
      ok('  along with the email',
         app._currentStudentDetailsEmail === 'x@example.invalid');
    }
  }
}

console.log('\nthe admin-only RTC controls stay admin-only');
{
  const body = extract('      renderStudentHubRtcTab() {');
  const set = body.indexOf('rtc-set-balance');
  const gate = body.lastIndexOf("user_type === 'admin'", set);
  ok('the balance override sits behind an admin check',
     gate > -1 && set > gate);
  // Awarding is not admin-only - teachers award RTC, that is the point of the
  // tab - so the award control must NOT be inside that gate.
  const award = body.indexOf('rtc-award-amount');
  ok('  but awarding is not gated', award > -1 && award < gate);
}

console.log('\nthe activity log knows which student it is showing');
{
  const body = extract('      renderStudentHubActivityLogTab() {');
  // The values themselves are checked above, by running the tab. What is left
  // to pin here is the ORDER: the assignment has to happen before the markup
  // lands, or the selector can be interacted with before it is pointed at
  // anyone.
  const setsId = body.indexOf('this._currentStudentDetailsId =');
  const paints = body.indexOf('content.innerHTML');
  ok('the student id is set before the selector is painted',
     setsId > -1 && paints > -1 && setsId < paints);
  ok('  and the range selector reads it back',
     /onchange="app\.loadStudentActivityLog\(app\._currentStudentDetailsId/.test(body));
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
if (fail) process.exit(1);
