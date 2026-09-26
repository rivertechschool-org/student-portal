// Bank interest is the admin's to set and to pay out.
//
// RTC Management is one screen serving two roles: an admin gets every tab, a
// teacher gets Bank and IRL Store. The tab strip checked the role; the
// Bank Interest card above it did not, so every teacher was offered a rate
// box, "Set" and "Trigger Interest" - buttons the database refuses for them,
// so all a teacher could get from them was an error.
//
// This renders the real shell as each role and reads what came out, then
// calls the two handlers as a teacher and checks they never reach Supabase.
//
// Run: node tests/rtc-interest-admin-only.test.js

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function extract(name, isAsync) {
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
  i = html.indexOf('{', closeParen);
  let depth = 0; const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, closeParen).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const body = html.slice(start + 1, i - 1);
  if (isAsync) {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    return new AsyncFunction(args, body);
  }
  return new Function(args, body);
}

const renderShell = extract('_renderRTCManagementShell');
const setInterestRate = extract('setInterestRate', true);
const adminTriggerInterest = extract('adminTriggerInterest', true);

function appAs(userType) {
  const calls = [];
  const app = {
    userInfo: { profile: { user_type: userType } },
    _rtcStudents: [{ rtc_balance: 12 }, { rtc_balance: 0 }],
    _rtcCategories: [],
    _bankInterestRate: 7,
    showNotification: (msg, kind) => calls.push(['notify', kind]),
    _updateRTCSummaryStats: () => {},
    auth: {
      supabase: {
        from: (t) => { calls.push(['from', t]); return { upsert: async () => ({ error: null }) }; },
        rpc: async (n) => { calls.push(['rpc', n]); return { data: { success: true }, error: null }; }
      }
    }
  };
  return { app, calls };
}

function render(userType) {
  const { app } = appAs(userType);
  const section = { innerHTML: '' };
  renderShell.call(app, section);
  return section.innerHTML;
}

(async () => {
  console.log('\n== a teacher is not offered the interest controls ==\n');
  const teacher = render('teacher');
  check('no "Trigger Interest" button', /Trigger Interest/.test(teacher), false);
  check('no setInterestRate button', /setInterestRate\(/.test(teacher), false);
  check('no rate input', /bank-interest-rate-input/.test(teacher), false);
  check('no Bank Interest card', /Bank Interest:/.test(teacher), false);
  ok('  but still gets the Bank tab', /id="rtc-tab-bank"/.test(teacher));
  ok('  and the IRL Store tab', /id="rtc-tab-store"/.test(teacher));
  ok('  and the summary counts', /Total RTC in Circulation/.test(teacher));

  console.log('\n== an admin still has them ==\n');
  const admin = render('admin');
  ok('"Trigger Interest" button', /onclick="app\.adminTriggerInterest\(\)"/.test(admin));
  ok('"Set" button', /onclick="app\.setInterestRate\(\)"/.test(admin));
  ok('rate input carries the current rate', /id="bank-interest-rate-input"[^>]*value="7"/.test(admin));
  ok('Bank Interest: 7%', /Bank Interest: 7%/.test(admin));

  console.log('\n== the handlers refuse a teacher before reaching the database ==\n');
  global.document = { getElementById: () => ({ value: '12' }) };
  global.confirm = () => true;
  {
    const { app, calls } = appAs('teacher');
    await setInterestRate.call(app);
    check('setInterestRate as teacher touches nothing', calls, []);
  }
  {
    const { app, calls } = appAs('teacher');
    await adminTriggerInterest.call(app);
    check('adminTriggerInterest as teacher touches nothing', calls, []);
  }
  {
    const { app, calls } = appAs('admin');
    await setInterestRate.call(app);
    ok('setInterestRate as admin writes the setting', calls.some(c => c[0] === 'from' && c[1] === 'school_settings'));
  }
  {
    const { app, calls } = appAs('admin');
    await adminTriggerInterest.call(app);
    ok('adminTriggerInterest as admin calls the RPC', calls.some(c => c[0] === 'rpc' && c[1] === 'admin_trigger_bank_interest'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
