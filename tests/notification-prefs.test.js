// The notification switches have to agree with the senders.
//
// The card rendered every switch as unticked until somebody pressed Save:
//
//     ${savedPrefs[opt.key] ? 'checked' : ''}
//
// while most senders treat an absent key as ON:
//
//     if (emailPrefs.child_assignment_graded === false) continue;
//
// So a parent who had never opened the card was receiving that mail while
// looking at four empty boxes — and the first press of Save wrote `false` for
// every key and unsubscribed them from all of it. Nobody would report that as a
// bug; it looks like the settings working.
//
// The fix is a `defaultOn` on each option. The risk with a fix of that shape is
// that it drifts: someone flips a sender from `=== false` to `=== true` and the
// card keeps claiming the old default. So this file does NOT hold a copy of the
// expected defaults. It reads each sender's own comparison out of
// portal/index.html and checks the option against it — the grid, not a sample.
//
// Three defaults are not `true`, which is why a blanket "default everything on"
// would have been just as wrong:
//
//   strike_notifications   staff are tested with `=== true`  -> opt in
//   attendance_alerts      `... : isAdmin`                   -> admin yes, teacher no
//   (and the keys with no sender at all are not shown)
//
// Run: node tests/notification-prefs.test.js

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

// ---- lift the real methods out of the page ------------------------------
function methodSource(name) {
  // Class methods in this file sit at six spaces.
  const re = new RegExp(`\\n {6}(?:async )?${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(name + ' not found');
  const start = m.index + 1;
  let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

const harness = new Function(`
  "use strict";
  const obj = {
    ${methodSource('getNotificationOptionsForUserType')},
    ${methodSource('notificationPrefIsOn')},
    ${methodSource('notificationPrefsProfileId')}
  };
  return obj;
`)();

const ROLES = ['student', 'parent', 'teacher', 'admin'];
const optionsFor = r => harness.getNotificationOptionsForUserType(r);

console.log('\n== every option carries a default ==\n');

for (const role of ROLES) {
  const opts = optionsFor(role);
  ok(`${role} gets at least one switch (${opts.length})`, opts.length > 0);
  const missing = opts.filter(o => typeof o.defaultOn !== 'boolean').map(o => o.key);
  check(`  every ${role} option declares defaultOn`, missing, []);
  const noLabel = opts.filter(o => !o.label || !o.description).map(o => o.key);
  check(`  every ${role} option has a label and a description`, noLabel, []);
}

check('an unknown user type gets nothing', optionsFor('nobody'), []);
check('and so does undefined', optionsFor(undefined), []);

console.log('\n== the default matches what the sender actually does ==\n');

// Read each key's own comparison out of the senders.
//
// Comment lines are dropped first, and that is the whole point rather than
// tidiness: the options table above each key carries a comment QUOTING its
// sender's comparison, so a scanner that kept comments would happily read my
// description of the code instead of the code. It would then pass with the
// sender deleted. Strip the commentary, keep the program.
const codeOnly = html
  .split('\n')
  .filter(l => !l.trim().startsWith('//'))
  .join('\n');

// The options table itself mentions every key; cut it out so a `defaultOn`
// cannot be mistaken for evidence about a sender either.
const tableStart = codeOnly.indexOf('getNotificationOptionsForUserType(userType) {');
const tableEnd = codeOnly.indexOf('notificationPrefIsOn(opt, savedPrefs)');
const senders = codeOnly.slice(0, tableStart) + codeOnly.slice(tableEnd);

// What a sender does with an ABSENT key, read off its comparison:
//   `prefs.k === false` -> skip only when explicitly false  -> absent means ON
//   `prefs.k === true`  -> send only when explicitly true   -> absent means OFF
//   `prefs.k !== undefined ? prefs.k : X` -> absent means X
function sendersFor(key) {
  const out = [];
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const any = '[A-Za-z_][A-Za-z0-9_]*';
  for (const m of senders.matchAll(new RegExp(`${any}\\.${esc} === (false|true)`, 'g'))) {
    out.push({ shape: m[0], absentMeans: m[1] === 'false' ? 'on' : 'off' });
  }
  for (const m of senders.matchAll(
    new RegExp(`${any}\\.${esc} !== undefined \\? ${any}\\.${esc} : (${any})`, 'g'))) {
    out.push({ shape: m[0], absentMeans: 'depends:' + m[1] });
  }
  // The submission pair is read through a computed key rather than by name.
  if ((key === 'assignment_submitted' || key === 'late_submissions')
      && /\[prefKey\] === false/.test(senders)
      && new RegExp(`'${esc}'`).test(senders)) {
    out.push({ shape: 'prefs[prefKey] === false', absentMeans: 'on' });
  }
  return out;
}

// Database triggers live in the other repo, so their COALESCE(pref, true) can't
// be read from here. They are named, not assumed — if one is renamed, the name
// stops matching a real option key and the count check below fails.
const TRIGGER_SENT = [
  'staff_link_requests', 'staff_material_requests', 'staff_bug_reports',
  'staff_enrollment_applications', 'staff_facility_bookings', 'staff_system_health'
];

const seen = new Set();
for (const role of ROLES) {
  for (const opt of optionsFor(role)) {
    const id = role + '/' + opt.key;
    if (seen.has(id)) continue;
    seen.add(id);

    if (TRIGGER_SENT.includes(opt.key)) {
      check(`${role} · ${opt.key} — trigger-sent, COALESCE(pref, true)`, opt.defaultOn, true);
      continue;
    }

    const found = sendersFor(opt.key);
    ok(`${role} · ${opt.key} — has a sender that reads it`, found.length > 0);
    if (!found.length) continue;

    // Resolve each sender's answer for THIS role, then require they agree.
    const answers = new Set(found.map(f => {
      if (f.absentMeans === 'depends:isAdmin') return role === 'admin';
      if (f.absentMeans.startsWith('depends:')) return 'UNRESOLVED:' + f.absentMeans;
      return f.absentMeans === 'on';
    }));

    if (answers.size > 1) {
      // strike_notifications is read both ways on purpose: parents `=== false`,
      // staff `=== true`. Only staff are ever shown the switch, so the staff
      // reading is the one this card must match.
      ok(`  ${opt.key} is read two ways — only staff see it`,
         opt.key === 'strike_notifications' && role !== 'parent' && role !== 'student');
      check(`  ${opt.key} follows the staff reading (opt in)`, opt.defaultOn, false);
      continue;
    }

    const expected = [...answers][0];
    check(`  ${opt.key} default matches its sender`, opt.defaultOn, expected);
  }
}

console.log('\n== no switch is shown that changes nothing ==\n');

// A key nothing reads is a switch that lies in a second way: it looks like a
// setting and it is scenery. These four were on the card and are now off it.
const REMOVED = ['new_messages', 'assignment_graded', 'assignment_due_reminder', 'child_late_assignment'];
for (const key of REMOVED) {
  const stillShown = ROLES.some(r => optionsFor(r).some(o => o.key === key));
  ok(`${key} is not offered (nothing reads it)`, !stillShown);
  check(`  and nothing reads it, still`, sendersFor(key).length, 0);
}

// The converse, and the one that actually protects us: anything ON the card
// must have a reader. Covered per-key above; this is the count.
{
  const all = new Set();
  ROLES.forEach(r => optionsFor(r).forEach(o => all.add(o.key)));
  const dead = [...all].filter(k => !TRIGGER_SENT.includes(k) && sendersFor(k).length === 0);
  check('every switch on the card has a sender', dead, []);
}

console.log('\n== what the checkbox shows ==\n');

const parentOpts = optionsFor('parent');
const graded = parentOpts.find(o => o.key === 'child_assignment_graded');
const staffOpts = optionsFor('teacher');
const strikes = staffOpts.find(o => o.key === 'strike_notifications');

check('nothing stored, sender defaults on  -> ticked', harness.notificationPrefIsOn(graded, {}), true);
check('nothing stored, sender opt-in       -> unticked', harness.notificationPrefIsOn(strikes, {}), false);
check('explicitly false beats the default', harness.notificationPrefIsOn(graded, { child_assignment_graded: false }), false);
check('explicitly true beats the default', harness.notificationPrefIsOn(strikes, { strike_notifications: true }), true);
check('null is treated as unset, not as off', harness.notificationPrefIsOn(graded, { child_assignment_graded: null }), true);
check('a missing prefs object is fine', harness.notificationPrefIsOn(graded, undefined), true);
check('a stray non-boolean is not read as on', harness.notificationPrefIsOn(graded, { child_assignment_graded: 'yes' }), false);

// The whole point: opening the card and pressing Save must not change anything.
{
  const before = {};                       // never saved
  const after = {};
  optionsFor('parent').forEach(o => { after[o.key] = harness.notificationPrefIsOn(o, before); });
  const senderWouldSend = k => {
    const o = parentOpts.find(x => x.key === k);
    return harness.notificationPrefIsOn(o, before);
  };
  const changed = Object.keys(after).filter(k => after[k] !== senderWouldSend(k));
  check('Save straight after opening changes nothing', changed, []);
  check('  and a fresh parent is ticked for both live switches',
        Object.values(after).filter(Boolean).length, parentOpts.length);
}

console.log('\n== the row it reads and writes ==\n');

// user_profiles.id is not the auth uid for anyone whose profile the school made
// before they had a login. Both halves filtered on the auth uid.
check('prefers the profile row id',
      harness.notificationPrefsProfileId.call({ userInfo: { profile: { id: 'P' }, user: { id: 'A' } } }), 'P');
check('falls back to the auth uid when there is no profile',
      harness.notificationPrefsProfileId.call({ userInfo: { user: { id: 'A' } } }), 'A');
check('and answers null rather than undefined',
      harness.notificationPrefsProfileId.call({ userInfo: {} }), null);

ok('the load filters on it', /\.eq\('id', this\.notificationPrefsProfileId\(\)\)/.test(html));
ok('  and so does the save', /\.eq\('id', this\.notificationPrefsProfileId\(\)\)\s*\n\s*\.select\('id'\)/.test(html));
check('neither half still filters on the auth uid',
      (html.match(/\.eq\('id', this\.userInfo\.user\.id\)/g) || []).length, 0);

// An update matching no row is a success in PostgREST. Without .select() the
// card reported "saved" and stored nothing, indefinitely.
ok('a save that matches no row is reported, not swallowed',
   /if \(!updated \|\| updated\.length === 0\)/.test(html));

console.log('\n== it is wired to the renderer ==\n');

ok('the checkbox asks notificationPrefIsOn',
   /\$\{this\.notificationPrefIsOn\(opt, savedPrefs\) \? 'checked' : ''\}/.test(html));
check('  and no longer reads the raw value',
      /\$\{savedPrefs\[opt\.key\] \? 'checked' : ''\}/.test(html), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
