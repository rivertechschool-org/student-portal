// A privilege bought for two students must not quietly be bought for one.
//
// "charlotte and noah are buying a privilege for 2 gold" is a normal sentence.
// The matcher reads both names and hands the executor an `entities.students`
// pair — but terminalBuyPrivilege is written end to end for a single buyer:
// one atomic RPC, one fallback deduction, one grant, one undo entry. It read
// `entities.student?.student` and charged whichever name resolved first. The
// other student paid nothing and received nothing, and nothing on screen said
// so.
//
// Half a purchase is worse than none, and worse still because it looks like a
// whole one. So a named pair is declined out loud.
//
// nlp-stress round 26 covers the other half of this — that BOTH names survive
// as far as the executor. If that regresses, this guard never fires, so the two
// tests are load-bearing together.
//
// Run: node tests/riven-pair-purchase.test.js

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
  const Ctor = Object.getPrototypeOf(async function () {}).constructor;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

// An app that records what was said and screams if the database is touched.
function makeApp() {
  const app = {
    said: [],
    errors: [],
    dbCalls: [],
    escapeHtml: (t) => String(t == null ? '' : t),
    _showRivenMessage(msg) { this.said.push(String(msg)); },
    terminalPrintError(msg) { this.errors.push(String(msg)); },
    async _ensureTerminalPrivileges() { this.dbCalls.push('_ensureTerminalPrivileges'); },
    async terminalViewPrivilegeCatalog() { this.dbCalls.push('catalog'); },
    _normalizeInput: (t) => String(t || '').toLowerCase(),
    _rivenExtractPrivilegeName: () => 'homework pass',
    _rivenMatchStoreItem: (n, list) => ({ item: list[0] }),
    _terminalPrivileges: [
      { id: 'p1', name: 'Homework Pass', price: 2, duration_days: 7, is_active: true, icon: '🎟️' },
    ],
    _terminalAllStudents: [],
    auth: {
      supabase: {
        rpc: (fn) => { app.dbCalls.push('rpc:' + fn); return Promise.resolve({ data: null, error: new Error('no') }); },
        from: (t) => { app.dbCalls.push('from:' + t); throw new Error('the database must not be reached'); },
      },
    },
    _requestConfirmation(summary) { this.said.push('CONFIRM: ' + summary); },
  };
  app.terminalBuyPrivilege = extract('terminalBuyPrivilege');
  return app;
}

const stu = (id, full_name) => ({ student: { id, full_name, rtc_balance: 50 } });

(async () => {
  console.log('\n== two names, one grant path ==\n');

  {
    const app = makeApp();
    await app.terminalBuyPrivilege.call(app, {
      students: [stu('s1', 'Charlotte Tebow'), stu('s2', 'Noah Williams')],
      student: stu('s1', 'Charlotte Tebow'),
      amount: 2,
      _rawInput: 'charlotte and noah are buying a privilege for 2 gold',
    });

    check('it declines rather than charging one of them', app.said.length, 1);
    ok('  and names both students', /Charlotte Tebow and Noah Williams/.test(app.said[0]));
    ok('  says what to do instead', /one at a time|once for each/i.test(app.said[0]));
    check('  nothing was written', app.dbCalls, []);
    check('  and it is not reported as an error', app.errors, []);
  }

  console.log('\n== one name still buys ==\n');

  {
    // The guard must not swallow the ordinary case. This gets as far as the
    // confirmation, which is where a real purchase pauses.
    const app = makeApp();
    await app.terminalBuyPrivilege.call(app, {
      student: stu('s1', 'Charlotte Tebow'),
      students: [stu('s1', 'Charlotte Tebow')],
      amount: 2,
      _rawInput: 'charlotte is buying the homework pass for 2 gold',
    });
    ok('a single buyer reaches the confirmation', app.said.some(m => m.startsWith('CONFIRM:')));
    check('  and is not declined', app.said.filter(m => /one at a time/i.test(m)).length, 0);
  }

  {
    // No student at all is the pre-existing path and must be untouched.
    const app = makeApp();
    await app.terminalBuyPrivilege.call(app, { amount: 2, _rawInput: 'someone is buying a privilege' });
    check('no buyer still asks which student', app.errors.length, 1);
    ok('  by name', /Which student/i.test(app.errors[0]));
  }

  console.log('\n== the guard is the first thing it does ==\n');

  // If the pair check ever moves below the single-student resolution, the bug
  // comes back silently — the first student would already be chosen.
  const body = html.slice(html.indexOf('    async terminalBuyPrivilege('));
  const guardAt = body.indexOf('named.length >= 2');
  const resolveAt = body.indexOf('const student = entities.student?.student;');
  ok('the pair check runs before a single buyer is picked', guardAt > 0 && guardAt < resolveAt);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
