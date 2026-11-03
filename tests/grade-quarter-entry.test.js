// Manage Grades saves to the quarter on screen, and emptying a box clears it.
//
// 2026-11-03: after the switch to Quarter 2, Quarter 1 grades typed into
// Manage Grades landed in Quarter 2, and emptying them to start over left the
// participation grades and turned the final grades into teacher-set zeros.
// This runs the real saveAllGrades, handleClassGradeChange, switchQuarter and
// showGradeManagementModal over invented students and a stand-in database.
//
// Run: node tests/grade-quarter-entry.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
const from = html.indexOf('    class TeacherGradeManagement {');
const to = html.indexOf('END TEACHER GRADE MANAGEMENT', from);
const src = html.slice(from, to);

function method(name) {
  let start = src.indexOf(`\n      ${name}(`);
  if (start < 0) start = src.indexOf(`\n      async ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const names = ['saveAllGrades', 'handleClassGradeChange', 'switchQuarter', 'showGradeManagementModal', 'percentageToLetterGrade'];
const proto = eval(`({ ${names.map(method).join(',\n')} })`);

(async () => {
  const Q1 = { id: 'q1', name: 'Quarter 1', is_current: false };
  const Q2 = { id: 'q2', name: 'Quarter 2', is_current: true };
  const calls = [], notes = [];
  let failRpc = null;
  global.document = { getElementById: () => null, querySelector: () => null };
  const sb = {
    rpc: async (fn, args) => { calls.push(['rpc', fn, args]); return { error: failRpc === fn ? { message: 'nope' } : null }; },
    from: (table) => ({
      update: (row) => {
        const q = { filters: {} };
        const chain = { eq: (k, v) => { q.filters[k] = v; return chain; }, then: (r) => { calls.push(['update', table, row, q.filters]); r({ error: null }); } };
        return chain;
      },
    }),
  };
  global.window = { app: { auth: { supabase: sb }, showNotification: (m, k) => notes.push([m, k]), escapeHtml: (x) => x } };

  const mk = () => {
    const t = Object.create(proto);
    t.currentClassId = 'c1'; t.currentQuarterId = 'q1'; t.currentQuarter = Q1;
    t.allQuarters = [Q2, Q1];
    t.showGradeManagementModal = async (...a) => { calls.push(['reload', ...a]); };
    return t;
  };

  // ---- emptying the final grade box ----
  let t = mk();
  t.pendingChanges = {};
  t.handleClassGradeChange('e1', '');
  ok('an emptied final grade is not a zero', t.pendingChanges.e1.class_grade === null && t.pendingChanges.e1.class_grade_override === false, JSON.stringify(t.pendingChanges));
  t.handleClassGradeChange('e2', '0');
  ok('  a typed 0 is still a 0', t.pendingChanges.e2.class_grade === 0 && t.pendingChanges.e2.class_grade_override === true);

  // ---- saving: to the quarter on screen, clears really clear ----
  t = mk();
  t.pendingChanges = {
    e1: { class_grade: null, class_grade_override: false, participation_grade: '' },
    e2: { participation_grade: '91', teacher_notes: '' },
  };
  calls.length = 0;
  await t.saveAllGrades();
  const quarters = calls.filter(c => c[0] === 'rpc').map(c => c[2].p_quarter_id).concat(calls.filter(c => c[0] === 'update').map(c => c[3].quarter_id));
  ok('every write goes to the quarter on screen', quarters.length > 0 && quarters.every(q => q === 'q1'), JSON.stringify(calls));
  ok('nothing is written to the enrollment row', !calls.some(c => c[1] === 'class_enrollments'));
  const e1 = calls.filter(c => (c[2]?.p_enrollment_id || c[3]?.enrollment_id) === 'e1');
  ok('  an emptied final grade hands back to the suggestion', e1.some(c => c[1] === 'set_class_grade_override' && c[2].p_class_grade === null && c[2].p_override === false)
    && e1.some(c => c[1] === 'calculate_quarter_grades'), JSON.stringify(e1));
  ok('  an emptied participation grade is cleared', e1.some(c => c[0] === 'update' && c[1] === 'quarter_grade_snapshots' && c[2].participation_grade === null));
  const clearAt = e1.findIndex(c => c[0] === 'update'), recalcAt = e1.findIndex(c => c[1] === 'calculate_quarter_grades');
  ok('  and cleared before the grade is recalculated', clearAt >= 0 && clearAt < recalcAt);
  const e2 = calls.filter(c => (c[2]?.p_enrollment_id || c[3]?.enrollment_id) === 'e2');
  ok('  emptied notes are cleared, a typed participation saved', e2.some(c => c[0] === 'update' && c[2].teacher_notes === null && !('participation_grade' in c[2]))
    && e2.some(c => c[1] === 'upsert_quarter_grade' && c[2].p_participation_grade === 91));
  ok('the message names the quarter', /Saved 2 student grade\(s\) for Quarter 1/.test(notes.pop()[0]));

  // ---- a failed save stays on screen and goes nowhere else ----
  t = mk();
  t.pendingChanges = { e1: { participation_grade: '88' }, e2: { participation_grade: '77' } };
  calls.length = 0; failRpc = 'upsert_quarter_grade';
  await t.saveAllGrades();
  failRpc = null;
  ok('a failed save is reported and kept', /2 of 2 could not be saved for Quarter 1/.test(notes.pop()[0]) && Object.keys(t.pendingChanges).length === 2);
  ok('  and is not written to the current quarter instead', !calls.some(c => c[1] === 'class_enrollments' || c[1] === 'update_enrollment_grades') && !calls.some(c => c[0] === 'reload'));

  // ---- switching quarter with typing on screen ----
  t = mk(); t.currentQuarter = Q2; t.currentQuarterId = 'q2';
  t.pendingChanges = { e1: { participation_grade: '90' } };
  let asked = '';
  global.confirm = (q) => { asked = q; return false; };
  const sel = { value: 'q1' };
  global.document = { getElementById: (id) => id === 'grade-quarter-selector' ? sel : null, querySelector: () => null };
  calls.length = 0;
  await t.switchQuarter('q1');
  ok('switching asks, naming the quarter the typing is for', /typed for Quarter 2/.test(asked) && /open Quarter 1/.test(asked), asked);
  ok('  Cancel stays put', sel.value === 'q2' && !calls.length);
  delete global.confirm;

  // ---- a slower, older load does not paint over a newer one ----
  const t2 = Object.create(proto);
  let release;
  const gate = new Promise(r => { release = r; });
  const painted = [];
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, style: {}, set innerHTML(v) { this._h = v; if (id === 'grade-modal-content' && /No Students/.test(v)) painted.push(v); }, get innerHTML() { return this._h; }, textContent: '' });
  global.document = { getElementById: el, querySelector: () => null };
  let n = 0;
  global.window.app.auth.supabase = {
    from: (table) => {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, gte: () => chain, lte: () => chain, single: () => chain,
        order: async () => {
          const mine = ++n;
          if (mine === 1) await gate;          // the first open is slow
          return { data: [Q2, Q1], error: null };
        },
        then: (r) => r(table === 'class_enrollments' ? { data: [], error: null } : { data: null, error: null }),
      };
      return chain;
    },
  };
  const first = t2.showGradeManagementModal('c1');        // opens on the current quarter, slowly
  const second = t2.showGradeManagementModal('c1', 'q1'); // the teacher picks Quarter 1
  await second; release(); await first;
  ok('the newest load is the one left on screen', t2.currentQuarterId === 'q1', t2.currentQuarterId);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
