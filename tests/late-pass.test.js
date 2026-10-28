// Late passes, portal side.
//
// 2026-10-28: runs the real _lateBadge, _latePassOffer and
// handleSubmitAssignment over an invented student and a stand-in database:
// what is offered on a late assignment, that a ticked pass is spent BEFORE the
// work is written (so a refusal hands nothing in), and the chip that replaces
// "Submitted late". The spending rules themselves are tested in the backend
// repo (supabase/tests/late_passes.sql).
//
// Run: node tests/late-pass.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  let start = html.indexOf(`\n      ${name}(`);
  if (start < 0) start = html.indexOf(`\n      async ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const app = eval(`({ ${['_lateBadge', '_latePassOffer', 'handleSubmitAssignment'].map(method).join(',\n')} })`);

// ---- the chip ----
ok('late work says so', /Submitted late/.test(app._lateBadge({ submitted_at: 'x' })));
ok('late work with a pass says that instead', /Late pass used/.test(app._lateBadge({ late_pass_used_at: '2026-10-28' }))
  && !/Submitted late/.test(app._lateBadge({ late_pass_used_at: '2026-10-28' })));
ok('no submission at all: the plain chip', /Submitted late/.test(app._lateBadge()));

// ---- what is offered ----
const calls = [];
let held = 2, rpcResult = { success: true, passes_left: 1 };
app.supabaseQuery = fn => Promise.resolve(fn());
app.auth = {
  studentRecordId: () => 'p-student',
  supabase: {
    rpc: (name, args) => {
      calls.push(['rpc', name, args]);
      if (name === 'rtc_my_late_passes') return Promise.resolve(held == null ? { data: null, error: { message: 'down' } } : { data: held, error: null });
      return Promise.resolve({ data: rpcResult, error: null });
    },
    from: name => ({
      upsert(row) { calls.push(['upsert', name, row]); return this; },
      select() { return Promise.resolve({ data: [{ ...calls.at(-1)[2], id: 's1' }], error: null }); },
    }),
  },
};

(async () => {
  let out = await app._latePassOffer({ id: 'a1', late_pass_allowed: true }, 'checkbox');
  ok('holding passes: a box to tick, with the count', /id="use-late-pass"/.test(out) && /you have 2/.test(out), out);
  out = await app._latePassOffer({ id: 'a1' }, 'checkbox');
  ok('an assignment from before the setting counts as allowed', /id="use-late-pass"/.test(out));
  out = await app._latePassOffer({ id: 'a1', late_pass_allowed: false }, 'checkbox');
  ok('not allowed: says so, no box', /cannot be used/.test(out) && !/use-late-pass/.test(out));
  out = await app._latePassOffer({ id: 'a1', late_pass_allowed: false }, 'button');
  ok('not allowed, already handed in: nothing', out === '');
  held = 0;
  out = await app._latePassOffer({ id: 'a1' }, 'checkbox');
  ok('none held: points at the store, no box', /RTC Store/.test(out) && !/use-late-pass/.test(out));
  held = null;
  out = await app._latePassOffer({ id: 'a1' }, 'checkbox');
  ok('count unreadable: says nothing rather than a wrong number', out === '');
  held = 1;
  out = await app._latePassOffer({ id: 'a1' }, 'button');
  ok('already handed in late: a button', /useLatePassOn\('a1'\)/.test(out) && /you have 1/.test(out));

  // ---- turning in with the box ticked ----
  const fields = {
    'submission-content': { value: 'Pgs 27-30' },
    'submission-file': { files: [] },
    'use-late-pass': { checked: true },
  };
  global.document = { getElementById: id => fields[id] || null, querySelector: () => null };
  global.window = {};
  const said = [];
  Object.assign(app, {
    isProcessing: false, assignments: [], classes: [], currentSection: 'home',
    showNotification: (m, t) => said.push([m, t]),
    closeModal() {}, _pagesGradedMessage: () => null,
    loadMissingAssignments: () => Promise.resolve([]), renderMissingAssignments: () => '',
    loadStudentData: () => Promise.resolve(),
  });

  calls.length = 0;
  await app.handleSubmitAssignment('a1', true);
  const order = calls.map(c => c[0] === 'rpc' ? c[1] : c[0]);
  ok('the pass is spent before the work is written', order.join() === 'rtc_use_late_pass,upsert', order.join());
  ok('on this assignment', calls[0][2]?.p_assignment_id === 'a1');
  ok('the page does not write the flag itself', !('late_pass_used_at' in (calls[1]?.[2] || {})));
  ok('the student is told', /Late pass used/.test(said.at(-1)?.[0] || ''), JSON.stringify(said));

  // Refused: nothing is handed in.
  calls.length = 0; said.length = 0;
  rpcResult = { success: false, error: 'You do not have a late pass. You can buy one in the RTC Store.' };
  await app.handleSubmitAssignment('a1', true);
  ok('a refused pass hands nothing in', !calls.some(c => c[0] === 'upsert'), JSON.stringify(calls));
  ok('and says why', said.at(-1)?.[1] === 'error' && /do not have a late pass/.test(said.at(-1)[0]));

  // Unticked: no pass is touched.
  calls.length = 0;
  fields['use-late-pass'].checked = false;
  await app.handleSubmitAssignment('a1', true);
  ok('unticked: handed in without spending one', calls.map(c => c[0]).join() === 'upsert', JSON.stringify(calls.map(c => c[1])));

  // ---- the forms ----
  ok('new assignments: the box starts ticked', html.includes('<input type="checkbox" id="assignment-late-pass-allowed" checked>'));
  ok('edit: reflects the assignment', html.includes("id=\"edit-assignment-late-pass-allowed\" ${assignment.late_pass_allowed !== false ? 'checked' : ''}"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
