// Strikes.
//
// Riven showed the strike count on every child card and could neither give one
// nor take one away. This is the one thing a teacher does about a child in the
// moment that is not attendance, so it is theirs, not an admin's.
//
// THE COUNT IS ALWAYS SAID
//
// Three is the ceiling and the system treats it as one. "Give him a strike"
// means something different when it is his third, and the person saying it
// does not always know - they have often just walked in from the corridor. So
// every confirmation and every answer names the number, and the third one says
// it is the last.
//
// A STRIKE NEEDS A REASON
//
// The form requires one. A strike with nothing on the record is one nobody can
// defend to a parent a fortnight later, so Riven asks rather than writing a
// blank.
//
// Run: node tests/riven-strikes.test.js

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
  const isAsync = /^\s*async\b/.test(m[0].slice(1));
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NOAH = { id: 'noah', full_name: 'Noah Williams' };

function makeApp({ strikes = [], count = null, nextDecayDate = null } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    inserts: [],
    deletes: [],
    userInfo: { profile: { user_type: 'teacher' }, user: { id: 'me' } },
    escapeHtml: esc,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _rivenResolvedStudent: (e) => e?.student?.student || e?.student || null,
    async getStudentStrikes() {
      return { strikes, count: count === null ? strikes.filter(s => !s.decayed).length : count, nextDecayDate };
    },
    _requestConfirmation(summary, run) {
      app.confirmed = summary;
      app._pending = (async () => run())();
    },
    auth: {
      supabase: {
        from(table) {
          const q = {
            insert(row) { app.inserts.push({ table, row }); return Promise.resolve({ error: null }); },
            delete() { q._op = 'delete'; return q; },
            eq(c, v) { q._eq = q._eq || {}; q._eq[c] = v; return q; },
            then(res, rej) {
              if (q._op === 'delete') { app.deletes.push({ table, where: q._eq }); }
              return Promise.resolve({ error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  app._rivenPolicyError = extract('_rivenPolicyError');
  for (const m of ['terminalIssueStrike', 'terminalRemoveStrike']) {
    const fn = extract(m);
    app[m] = async function (...a) {
      const r = await fn.apply(app, a);
      if (app._pending) { const p = app._pending; app._pending = null; await p; }
      return r;
    };
  }
  app.terminalViewStrikes = extract('terminalViewStrikes');
  return app;
}

const said = (text) => ({ student: { student: NOAH }, original: text, _rawInput: text });
const strike = (over = {}) => ({ id: 's1', created_at: '2026-09-10T10:00:00Z', reason: 'throwing chalk', decayed: false, ...over });

(async () => {

  console.log('\n== giving one ==\n');

  {
    const app = makeApp({ strikes: [] });
    await app.terminalIssueStrike.call(app, said('give noah a strike for throwing chalk'));
    check('the strike is written', app.inserts[0].row.student_id, 'noah');
    check('  with the reason', app.inserts[0].row.reason, 'throwing chalk');
    check('  and who gave it', app.inserts[0].row.issued_by, 'me');
    // The number matters more than the act.
    ok('the confirmation says which one it is', /strike <b>1 of 3<\/b>/.test(app.confirmed));
    ok('the answer says the running total', /has 1 strike/.test(app.ok[0]));
  }

  {
    const app = makeApp({ strikes: [strike(), strike({ id: 's2' })] });
    await app.terminalIssueStrike.call(app, said('give noah a strike for shouting'));
    // The one that changes how somebody feels about saying it.
    ok('the third strike says it is their last', /3 of 3<\/b> — their last/.test(app.confirmed));
  }

  {
    const app = makeApp({ strikes: [strike(), strike({ id: 's2' }), strike({ id: 's3' })] });
    await app.terminalIssueStrike.call(app, said('give noah a strike for shouting'));
    check('a fourth is not written', app.inserts, []);
    ok('  and says the maximum is reached', /already has <b>3<\/b> strikes/.test(app.said[0]));
  }

  {
    const app = makeApp({ strikes: [] });
    await app.terminalIssueStrike.call(app, said('give noah a strike'));
    check('no reason, nothing written', app.inserts, []);
    ok('  and it asks what for', /A strike needs a reason/.test(app.errors[0]));
  }

  console.log('\n== taking one away ==\n');

  {
    const app = makeApp({
      strikes: [strike({ id: 'newest', created_at: '2026-09-11T09:00:00Z', reason: 'shouting' }), strike({ id: 'older' })],
    });
    await app.terminalRemoveStrike.call(app, said('take noahs strike off'));
    // getStudentStrikes returns newest first, and "take it off" said after
    // giving one means the one just given.
    check('the newest is the one removed', app.deletes[0].where.id, 'newest');
    ok('  named in the confirmation', /shouting/.test(app.confirmed));
    ok('  with the before and after', /from 2 to 1/.test(app.confirmed));
    ok('the answer says where they stand', /on 1 strike/.test(app.ok[0]));
  }

  {
    const app = makeApp({ strikes: [] });
    await app.terminalRemoveStrike.call(app, said('take noahs strike off'));
    check('nothing to remove, nothing removed', app.deletes, []);
    ok('  and says so', /has no strikes/.test(app.said[0]));
  }

  {
    // A decayed strike is off the count already; removing it would be removing
    // nothing and reporting a change.
    const app = makeApp({ strikes: [strike({ id: 'gone', decayed: true })], count: 0 });
    await app.terminalRemoveStrike.call(app, said('take noahs strike off'));
    check('a decayed strike is not a strike', app.deletes, []);
  }

  console.log('\n== reading them ==\n');

  {
    const app = makeApp({
      strikes: [strike({ reason: 'shouting', issuer_name: 'Dan Pike' }), strike({ id: 's2', reason: 'late again' })],
      nextDecayDate: '2026-10-10T00:00:00Z',
    });
    await app.terminalViewStrikes.call(app, said('how many strikes does noah have'));
    const out = app.said[0];
    ok('the count leads', /<b>2 of 3<\/b>/.test(out));
    ok('  with each reason', /shouting/.test(out) && /late again/.test(out));
    ok('  and who gave it', /Dan Pike/.test(out));
    // Strikes expire; a teacher deciding what to do next needs to know when.
    ok('  and when the oldest drops off', /drops off 2026-10-10/.test(out));
  }

  {
    const app = makeApp({ strikes: [] });
    await app.terminalViewStrikes.call(app, said('how many strikes does noah have'));
    ok('none reads as none', /has no strikes/.test(app.said[0]));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
