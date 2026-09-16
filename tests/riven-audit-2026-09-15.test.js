// Four things an audit of Riven turned up, and what each one cost.
//
// All four are the same shape: something that looks guarded, or looks loaded,
// and is not. None of them threw. None of them showed up in a log.
//
//   1. row.max_students was read off the class cache, which never fetched it.
//      Every class read as a cap of 30. Every one of this school's 75 open
//      classes has a cap set and 20 are below 30 — the smallest is 7 — so the
//      bulk-enrol cap check was passing crowds into rooms that cannot hold
//      them. Same shape as the grade_band bug: a field used, never selected,
//      silently undefined.
//
//   2. `if (cls && !canManage(cls))` — a permission check that skips itself
//      when it cannot find the class. A gate that opens when it cannot see
//      what it is guarding is not a gate.
//
//   3. Date of birth was writable by any teacher, through a command that reads
//      like contact details. It is on the admin-only list with the name and
//      the year group; it had neither a check here nor a trigger behind it.
//
//   4. The create-a-class name clash matched CLOSED classes, so every
//      September "create a Chess class" answered "Chess already exists" and
//      pointed at last year's. 39 closed class names have no open equivalent.
//
// Run: node tests/riven-audit-2026-09-15.test.js

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

function extract(name, indent = 4) {
  const pad = ' '.repeat(indent);
  const re = new RegExp('\\n' + pad + '(?:async\\s+)?' + name + '\\s*\\(', 'g');
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

function bodyOf(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('not found: ' + name);
  let i = html.indexOf('{', m.index + m[0].length - 1);
  let d = 0; const st = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') d++;
    else if (html[i] === '}') { d--; if (d === 0) { i++; break; } }
  }
  return html.slice(st, i);
}

(async () => {

  console.log('\n== 1. the cache fetches what the code reads ==\n');

  {
    const sel = html.match(/\.select\('id, name, subject, teacher_id, secondary_teacher_id, is_active, status, grading_weight[^']*'\)/);
    ok('the class cache query was found', !!sel);
    // Both of these are read off cached rows and both were missing at some
    // point today. A field read but not selected is undefined with no error.
    ok('  it fetches grade_band', /grade_band/.test(sel[0]));
    ok('  and max_students', /max_students/.test(sel[0]));

    const body = bodyOf('terminalEnrollGroup');
    ok('the bulk-enrol cap check still reads it', /max_students/.test(body));
  }

  console.log('\n== 2. gates fail closed ==\n');

  {
    // Three assignment writes: grade a submission, delete one, edit one.
    const stillOpen = (html.match(/if \(cls && !this\._rivenCanManageClass\(cls\)\)/g) || []).length;
    check('no permission check skips itself when the class is unknown', stillOpen, 0);
    const closed = (html.match(/if \(!cls \|\| !this\._rivenCanManageClass\(cls\)\)/g) || []).length;
    check('  all three refuse instead', closed, 3);
    ok('  and say why, rather than a bare denial',
       /can't tell which class that assignment belongs to/.test(html));
  }

  console.log('\n== 3. date of birth is the student record ==\n');

  {
    const makeApp = (role) => {
      const app = {
        said: [], errors: [], confirmed: null, updates: [],
        userInfo: { profile: { user_type: role }, user: { id: 'me' } },
        escapeHtml: (t) => String(t == null ? '' : t),
        _showRivenMessage(h) { app.said.push(h); },
        terminalPrintError(m) { app.errors.push(m); },
        _requestConfirmation(summary) { app.confirmed = summary; },
        auth: { supabase: { from() {
          const q = {
            select() { return q; }, eq() { return q; },
            single: async () => ({ data: { phone: '111', email: 'a@b.c', date_of_birth: '2010-01-01', address_line1: 'x' }, error: null }),
            update(p) { app.updates.push(p); return q; },
          };
          return q;
        } } },
      };
      app.terminalUpdateContact = extract('terminalUpdateContact');
      return app;
    };
    const said = (text) => ({ student: { student: { id: 's1', full_name: 'Noah Williams' } }, original: text });

    {
      const app = makeApp('teacher');
      await app.terminalUpdateContact.call(app, said("set his date of birth to 2012-04-09"));
      check('a teacher changing only a birthday is refused', app.confirmed, null);
      ok('  and told which field it was', /date of birth/i.test(app.errors[0] || ''));
    }

    {
      // The one that matters for usability: don't throw away the good half.
      const app = makeApp('teacher');
      await app.terminalUpdateContact.call(app, said("change his phone to 555-123-4567 and date of birth to 2012-04-09"));
      ok('a mixed request still changes the phone', /phone/.test(app.confirmed || ''));
      ok('  but not the birthday', !/2012-04-09<\/b>/.test(app.confirmed || ''));
      ok('  and says what it left alone', /Leaving the date of birth alone/.test(app.confirmed || ''));
    }

    {
      const app = makeApp('admin');
      await app.terminalUpdateContact.call(app, said("set his date of birth to 2012-04-09"));
      ok('an admin may change it', /date of birth/.test(app.confirmed || ''));
      check('  with no refusal', app.errors, []);
    }
  }

  console.log('\n== 4. last year\'s class does not block this year\'s ==\n');

  {
    const body = bodyOf('terminalCreateClass');
    ok('the clash check only counts classes still running',
       /sameName\(c\) && this\._rivenClassIsOpen\(c\)/.test(body));
    // Silently ignoring it would leave someone with two Chess classes and no
    // idea where last year's register went.
    ok('  and a closed one of the same name is mentioned', /closedTwin/.test(body));
    ok('  pointing at reopen as the alternative', /reopen \$\{this\.escapeHtml\(closedTwin\.name\)\}/.test(body));
  }

  console.log('\n== 5. every write intent is gated against musings ==\n');

  {
    // WRITE_INTENTS suppresses writes phrased as questions, negations and
    // conditionals. An intent missing from it fires on "should I ...?".
    const wi = html.match(/const WRITE_INTENTS = \[([\s\S]*?)\];/);
    ok('the list was found', !!wi);
    const declared = wi[1];
    // Marking notifications read is small, but it is still a write.
    ok('MARK_READ is in it', /'MARK_READ'/.test(declared));
    ok('ENROLL_BAND is in it', /'ENROLL_BAND'/.test(declared));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
