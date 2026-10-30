// The quarter's Snapshot button. It used to send every enrolment's grade
// calculation at once (1,884 requests from one phone), about a quarter were
// dropped, and all it said was "534 failed". Now it sends six at a time,
// retries what fails, and lists anything left by class, student and reason,
// with a button to try just those again.
//
// Run: node tests/quarter-snapshot.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  const m = new RegExp('\\n      (?:async\\s+)?' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('not found: ' + name);
  let p = html.indexOf('(', m.index), pd = 0;
  for (; p < html.length; p++) {
    if (html[p] === '(') pd++;
    else if (html[p] === ')' && --pd === 0) break;
  }
  let i = html.indexOf('{', p), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(m.index + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const proto = eval(`({ ${['_runQuarterSnapshot', '_showSnapshotFailures', 'retrySnapshotFailures'].map(method).join(',\n')} })`);

// Real time would make the retry pauses slow; they are not what is tested.
const realTimeout = setTimeout;
global.setTimeout = (fn) => realTimeout(fn, 0);
global.window = {};

function makeApp({ flaky = () => false } = {}) {
  const st = { inFlight: 0, maxInFlight: 0, calls: {}, modal: null, notes: [] };
  const app = Object.assign(Object.create(proto), {
    st,
    escapeHtml: t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    showNotification: (m, k) => st.notes.push(`${k}:${m}`),
    showModal: (id, title, body) => { st.modal = { id, title, body }; },
    closeModal() {},
    auth: { supabase: {
      async rpc(name, args) {
        st.inFlight++; st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
        const id = args.p_enrollment_id;
        st.calls[id] = (st.calls[id] || 0) + 1;
        await new Promise(r => realTimeout(r, 1));
        st.inFlight--;
        const why = flaky(id, st.calls[id]);
        if (why === 'throw') throw new TypeError('Failed to fetch');
        return why ? { error: { message: why } } : { data: [], error: null };
      },
      from(table) {
        const rows = table === 'classes' ? [{ id: 'c1', name: 'Pre-Algebra' }]
          : [{ id: 's7', first_name: 'Wren', last_name: 'Okafor' }];
        const q = { select: () => q, in: () => Promise.resolve({ data: rows, error: null }) };
        return q;
      },
    } },
  });
  return app;
}

const list = (n) => Array.from({ length: n }, (_, i) => ({ id: 'e' + i, student_id: i === 7 ? 's7' : 's' + i, class_id: 'c1' }));

(async () => {
  {
    const app = makeApp();
    const r = await app._runQuarterSnapshot(list(100), 'q1');
    ok('every enrolment is saved', r.succeeded === 100 && r.failures.length === 0);
    ok('never more than six in flight at once', app.st.maxInFlight <= 6, String(app.st.maxInFlight));
  }
  {
    // Dropped on the first try, fine on the second: not reported at all.
    const app = makeApp({ flaky: (id, n) => (n === 1 && +id.slice(1) % 4 === 0 ? 'throw' : false) });
    const r = await app._runQuarterSnapshot(list(40), 'q1');
    ok('a dropped request is retried and saved', r.succeeded === 40 && r.failures.length === 0, JSON.stringify(r.failures.slice(0, 2)));
  }
  {
    const app = makeApp({ flaky: (id) => (id === 'e7' ? 'Unauthorized: only the class teacher or an admin can calculate grades' : false) });
    const r = await app._runQuarterSnapshot(list(20), 'q1');
    ok('one that keeps failing is tried three times', app.st.calls.e7 === 3);
    ok('  and reported with its reason', r.failures.length === 1 && /Unauthorized/.test(r.failures[0].error));

    await app._showSnapshotFailures('q1', 'Quarter 1', r.failures, r.succeeded);
    const body = app.st.modal?.body || '';
    ok('the list names the class and the student', /Pre-Algebra · Wren Okafor/.test(body), body.slice(0, 400));
    ok('  says why', /Unauthorized: only the class teacher/.test(body));
    ok('  and offers to try just those again', /Try these 1 again/.test(body));

    // Fixed meanwhile: the retry saves it and says so.
    app.auth.supabase.rpc = async () => ({ data: [], error: null });
    await app.retrySnapshotFailures();
    ok('retrying saves them and reports it', app.st.notes.some(n => /^success:All 1 saved for Quarter 1/.test(n)), JSON.stringify(app.st.notes));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
