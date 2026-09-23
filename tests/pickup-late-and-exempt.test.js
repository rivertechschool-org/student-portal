// Pickup: who is called, who is late, and what gets sent.
//
// Three things this holds, and they are the three that were asked for.
//
// 1. NOT EVERY CHILD IS CALLED AT PICKUP. Some walk, some drive, some leave
//    with a sibling off-site. Before this there was no way to say so — you left
//    the family number blank, and the board reads a blank number as a job not
//    yet done ("Without a number (n)"). So the children who needed no chasing
//    were the ones the screen kept flagging, and a real gap hid among them. An
//    exemption is a positive statement; the count now excludes it.
//
// 2. LATENESS IS MEASURED FROM A LINE SOMEBODY SET. Dismissal has always been
//    timestamped. What was missing was the cutoff to compare it against.
//
// 3. ONE EMAIL. The first late child starts a hold; everyone else collected
//    late inside it joins the same message.
//
// The rules themselves live in the database, where they are enforced. What can
// be held here is the client half: that the settings screen refuses a value
// that would silently do nothing, and that the wiring exists at all.
//
// Run: node tests/pickup-late-and-exempt.test.js

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

// ---- a stub that records what would have been written ---------------------
function makeApp(fields) {
  const app = {
    notices: [],
    upserts: [],
    rpcs: [],
    auth: {
      userProfile: { id: 'admin-1' },
      supabase: {
        from() {
          const q = {
            upsert(rows) { app.upserts.push(rows); return Promise.resolve({ error: null }); },
            select() { return q; },
            in() { return Promise.resolve({ data: [], error: null }); },
          };
          return q;
        },
        rpc(fn, args) { app.rpcs.push({ fn, args }); return Promise.resolve({ data: { success: true }, error: null }); },
      },
    },
    supabaseQuery(fn) { return fn(); },
    showNotification(m, kind) { app.notices.push(`${kind}:${m}`); },
    loadHubPickupFamily() {},
  };

  const els = {};
  for (const [id, value] of Object.entries(fields)) {
    els[id] = (id === 'pickup-late-enabled') ? { checked: value } : { value: String(value) };
  }
  els['save-pickup-settings-btn'] = { disabled: false, textContent: '' };
  global.document = { getElementById: (id) => els[id] || null };

  app.savePickupSettings = new Function('return ' + methodSource('savePickupSettings')
    .replace(/^\s*async savePickupSettings/, 'async function savePickupSettings'))();
  app.toggleStudentPickupExempt = new Function('return ' + methodSource('toggleStudentPickupExempt')
    .replace(/^\s*async toggleStudentPickupExempt/, 'async function toggleStudentPickupExempt'))();
  return app;
}

const GOOD = {
  'pickup-cutoff-time': '14:45',
  'pickup-hold-minutes': '60',
  'pickup-late-email': 'learn@rivertech.me',
  'pickup-late-enabled': true,
};

(async () => {

  console.log('\n== a setting that would do nothing is refused ==\n');

  {
    const app = makeApp({ ...GOOD, 'pickup-cutoff-time': '' });
    await app.savePickupSettings.call(app);
    check('no cutoff, nothing written', app.upserts.length, 0);
    ok('  and it says so', /end-of-day time/i.test(app.notices.join(' ')));
  }

  {
    const app = makeApp({ ...GOOD, 'pickup-hold-minutes': '0' });
    await app.savePickupSettings.call(app);
    check('a zero hold is refused', app.upserts.length, 0);
  }

  {
    const app = makeApp({ ...GOOD, 'pickup-hold-minutes': '900' });
    await app.savePickupSettings.call(app);
    check('a fifteen-hour hold is refused', app.upserts.length, 0);
    ok('  with the range named', /1 and 480/.test(app.notices.join(' ')));
  }

  {
    const app = makeApp({ ...GOOD, 'pickup-late-email': 'learn(at)rivertech.me' });
    await app.savePickupSettings.call(app);
    check('a bad address is refused while sending is ON', app.upserts.length, 0);
  }

  {
    // ...but not when nothing is being sent. Turning the feature off should not
    // require a valid address for an email nobody wants.
    const app = makeApp({ ...GOOD, 'pickup-late-email': '', 'pickup-late-enabled': false });
    await app.savePickupSettings.call(app);
    check('switching it off does not demand an address', app.upserts.length, 1);
  }

  console.log('\n== what a good save writes ==\n');

  {
    const app = makeApp(GOOD);
    await app.savePickupSettings.call(app);
    check('one upsert', app.upserts.length, 1);
    const rows = app.upserts[0];
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
    check('  all four keys', Object.keys(byKey).sort(),
          ['pickup_cutoff_time', 'pickup_late_email', 'pickup_late_enabled', 'pickup_late_hold_minutes']);
    check('  the cutoff as typed', byKey.pickup_cutoff_time, '14:45');
    check('  the hold as a string', byKey.pickup_late_hold_minutes, '60');
    check('  enabled as a string, not a boolean', byKey.pickup_late_enabled, 'true');
    ok('  stamped with who changed it', rows.every(r => r.updated_by === 'admin-1'));
    ok('the confirmation repeats the time back', /after 14:45/.test(app.notices.join(' ')));
    ok('  and the hold', /60 minutes after the first/.test(app.notices.join(' ')));
  }

  {
    const app = makeApp({ ...GOOD, 'pickup-late-enabled': false });
    await app.savePickupSettings.call(app);
    const byKey = Object.fromEntries(app.upserts[0].map(r => [r.key, r.value]));
    check('off is stored as the string false', byKey.pickup_late_enabled, 'false');
    ok('  and says times are still recorded',
       /still recorded/.test(app.notices.join(' ')));
  }

  console.log('\n== marking somebody as not called ==\n');

  {
    const app = makeApp(GOOD);
    global.prompt = () => 'walks home';
    await app.toggleStudentPickupExempt.call(app, 'stu-1', true);
    check('it goes through the admin-gated function', app.rpcs.map(r => r.fn), ['rt_set_pickup_exempt']);
    check('  for that student', app.rpcs[0].args.p_student_id, 'stu-1');
    check('  marking them exempt', app.rpcs[0].args.p_exempt, true);
    check('  with the reason given', app.rpcs[0].args.p_reason, 'walks home');
  }

  {
    // Cancelling the prompt is not the same as giving no reason.
    const app = makeApp(GOOD);
    global.prompt = () => null;
    await app.toggleStudentPickupExempt.call(app, 'stu-1', true);
    check('cancelling writes nothing at all', app.rpcs.length, 0);
  }

  {
    const app = makeApp(GOOD);
    global.prompt = () => '';
    await app.toggleStudentPickupExempt.call(app, 'stu-1', true);
    check('an empty reason still marks them', app.rpcs.length, 1);
    check('  with no reason rather than an empty one', app.rpcs[0].args.p_reason, null);
  }

  {
    const app = makeApp(GOOD);
    global.prompt = () => { throw new Error('should not be asked'); };
    await app.toggleStudentPickupExempt.call(app, 'stu-1', false);
    check('putting someone back asks for nothing', app.rpcs.length, 1);
    check('  and unsets it', app.rpcs[0].args.p_exempt, false);
  }

  console.log('\n== the wiring exists ==\n');

  ok('the settings screen loads the pickup values',
     /this\.loadPickupSettings\(\);/.test(html));
  ok('  beside the school ones',
     /loadSchoolSettings\(\);\s*\n\s*this\.loadPickupSettings\(\);/.test(html));
  ok('the card is on the admin settings screen', /id="pickup-cutoff-time"/.test(html));
  ok('  with a hold', /id="pickup-hold-minutes"/.test(html));
  ok('  a recipient', /id="pickup-late-email"/.test(html));
  ok('  and an off switch', /id="pickup-late-enabled"/.test(html));

  {
    const row = methodSource('loadHubPickupFamily');
    ok('the student record reads the exemption', /pickup_exemptions/.test(row));
    ok('  and the family-level one', /pickup_exempt/.test(row));
    ok('  offering the toggle', /toggleStudentPickupExempt/.test(row));
    // A child in an exempt household must not get a per-child toggle that
    // would appear to do nothing.
    ok('  but not when the whole family is exempt', /\$\{famExempt \? '' :/.test(row));
    ok('a missing number stops reading as a fault when it is deliberate',
       /No number, and none needed/.test(row));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
