// Resubmissions flagged for the teacher, portal side.
//
// 2026-10-28: runs the real _resubmitState, _resubmitBadge, _canResubmitGraded,
// confirmResubmit and filterSubmissionsList over an invented student and a
// stand-in database: which rows say "review grade", that graded work handed in
// again keeps its grade (the page sends no grade or status), that work not yet
// graded still resubmits as before, and the teacher's filter. The flag itself
// is set by the database and tested in the backend repo
// (supabase/tests/resubmit_flag.sql).
//
// Run: node tests/resubmit-flag.test.js
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

const app = eval(`({ ${['_resubmitState', '_resubmitBadge', '_canResubmitGraded', 'confirmResubmit', 'filterSubmissionsList'].map(method).join(',\n')} })`);

// ---- the state ----
const graded = { status: 'graded', grade: 'C', graded_at: '2026-10-20T10:00:00Z' };
ok('never resubmitted: nothing', app._resubmitState(graded) === null && app._resubmitBadge(graded) === '');
ok('resubmitted after grading: review', app._resubmitState({ ...graded, resubmitted_at: '2026-10-21T10:00:00Z', resubmit_count: 1 }) === 'review');
ok('regraded since: no longer review', app._resubmitState({ ...graded, resubmitted_at: '2026-10-19T10:00:00Z', resubmit_count: 1 }) === 'resubmitted');
ok('edited before grading: resubmitted', app._resubmitState({ status: 'submitted', resubmitted_at: '2026-10-21T10:00:00Z', resubmit_count: 2 }) === 'resubmitted');
ok('graded with no date: review', app._resubmitState({ status: 'graded', resubmitted_at: '2026-10-21T10:00:00Z' }) === 'review');
ok('the review chip says so', /review grade/.test(app._resubmitBadge({ ...graded, resubmitted_at: '2026-10-21T10:00:00Z', resubmit_count: 1 })));
ok('the plain chip counts', /2 times/.test(app._resubmitBadge({ status: 'submitted', resubmitted_at: '2026-10-21T10:00:00Z', resubmit_count: 2 })));

// ---- who may resubmit graded work ----
ok('an ordinary assignment: yes', app._canResubmitGraded({ assignment_type: 'regular' }));
ok('a Testing Center test: no', !app._canResubmitGraded({ assignment_type: 'test' }));
ok('offline: no', !app._canResubmitGraded({ assignment_type: 'regular', graded_offline: true }));

// ---- handing it in again ----
let row, written, said = [];
const fields = { 'resubmit-content': { value: 'second draft' }, 'resubmit-file': { files: [] } };
global.document = { getElementById: id => fields[id] || null };
global.window = {};
Object.assign(app, {
  isProcessing: false, currentSection: 'classes',
  supabaseQuery: fn => Promise.resolve(fn()),
  showNotification: (m, t) => said.push([m, t]),
  closeModal() {}, _pagesGradedMessage: () => null,
  loadStudentData: () => Promise.resolve(), viewAssignments() {}, setupHomeContent() {},
  auth: { supabase: { from: () => {
    const q = {
      select() { return q; }, eq() { return q; },
      single() { return Promise.resolve({ data: written ? { class_id: 'c1' } : { ...row }, error: null }); },
      update(d) { written = d; return { eq: () => ({ select: () => Promise.resolve({ data: [{ ...row, ...d }], error: null }) }) }; },
    };
    return q;
  } } },
});
global.setTimeout = () => 0;

(async () => {
  row = { id: 's1', status: 'graded', grade: 'C', points_earned: 15, content: 'first draft', submission_type: 'text' };
  written = null;
  await app.confirmResubmit('a1', 's1');
  ok('graded work: the new work is sent', written?.content === 'second draft' && !!written?.submitted_at, JSON.stringify(written));
  ok('graded work: no grade, points or status sent, so the grade stays',
    !['grade', 'points_earned', 'feedback', 'graded_at', 'status'].some(k => k in (written || {})), JSON.stringify(written));
  ok('graded work: the file it had is kept', written?.submission_type === 'text');
  ok('the student is told the grade may change', /may change your grade/.test(said.at(-1)?.[0] || ''), JSON.stringify(said));

  row = { id: 's1', status: 'submitted', content: 'first draft', submission_type: 'text' };
  written = null;
  await app.confirmResubmit('a1', 's1');
  ok('not graded yet: resubmits as before', written?.status === 'submitted' && written?.grade === null, JSON.stringify(written));

  // ---- the teacher's filter ----
  const item = (status, resub) => ({ style: {}, getAttribute: k => (k === 'data-status' ? status : resub) });
  const items = [item('graded', 'review'), item('graded', ''), item('submitted', 'resubmitted'), item('not-submitted', '')];
  global.document = { querySelectorAll: () => items };
  app.filterSubmissionsList('resubmitted', 'a1');
  ok('filter: only the ones to review', items.map(i => i.style.display).join() === 'flex,none,none,none', items.map(i => i.style.display).join());

  ok('the list marks each row', html.includes(`data-resubmit="\${this._resubmitState(submission) || ''}"`));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
