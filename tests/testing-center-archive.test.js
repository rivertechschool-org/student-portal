// Last year's tests in the Testing Center: archive them out of the way, and
// reuse any of them as a fresh copy.
//
// Run: node tests/testing-center-archive.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'extensions', 'testing-center.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

function extract(name) {
  const re = new RegExp('\\n        (?:async\\s+)?function ' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', m.index + m[0].length);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(m.index + 1, i);
}

function iso(y, m, d) { return new Date(y, m - 1, d).toISOString(); }
const now = new Date();
const thisYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;   // school year start

function makeContext() {
  const st = { updates: [], saved: null, edited: null, toasts: [], confirms: 0 };
  const grid = { innerHTML: '' };
  const q = (table) => {
    const w = { table, patch: null, ids: null };
    const chain = {
      update(p) { w.patch = p; return chain; },
      eq(c, v) { w.ids = [v]; st.updates.push(w); return Promise.resolve({ error: null }); },
      in(c, v) { w.ids = v; st.updates.push(w); return Promise.resolve({ error: null }); },
    };
    return chain;
  };
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    supabaseClient: { from: q }, authReady: true,
    testsDatabase: [
      { id: 'old1', title: 'Gatsby Ch 2', subject: 'English', status: 'active', createdAt: iso(thisYear, 4, 22), timeLimit: 30, description: '',
        questions: [{ id: 'q1', type: 'multiple-choice', text: 'Who narrates?', options: ['Nick', 'Tom'], correctAnswer: 0, maxPoints: 2 },
                    { id: 'q2', type: 'write-in', text: 'Why the green light?', options: [], correctAnswer: null, maxPoints: 5 }] },
      { id: 'old2', title: 'Antarctica', subject: 'Science', status: 'active', createdAt: iso(thisYear, 5, 26), timeLimit: 30, description: '', questions: [] },
      { id: 'new1', title: 'Literature Q1', subject: 'Literature', status: 'active', createdAt: iso(thisYear, 10, 22), timeLimit: 40, description: '', questions: [] },
      { id: 'arch', title: 'Old Quiz', subject: 'Math', status: 'archived', createdAt: iso(thisYear, 2, 1), timeLimit: 10, description: '', questions: [] },
    ],
    submissionsDatabase: { 'old1_s1': { testId: 'old1', status: 'graded' } },
    escapeHtml: (t) => String(t ?? '').replace(/</g, '&lt;'),
    getAssignedStudents: () => [],
    showToast: (m) => st.toasts.push(m),
    confirm: () => { st.confirms++; return true; },
    document: { getElementById: (id) => (id === 'teacherTestsGrid' ? grid : null) },
    saveTestToDatabase: async (t) => { st.saved = t; return 'copy1'; },
    loadTests: async () => { ctx.testsDatabase.push({ ...st.saved, id: 'copy1', createdAt: new Date().toISOString(), assignedClasses: [] }); },
    editTest: async (id) => { st.edited = id; },
    Date,
  };
  ctx.renderTests = () => ctx.renderTeacherTests();
  vm.createContext(ctx);
  const names = ['schoolYearStart', 'renderTeacherTests', 'toggleArchivedTests', 'setTestArchived', 'archiveOldTests', 'reuseTest', 'renderTeacherTestCard'];
  vm.runInContext('let showArchivedTests = false;\n'
    + names.map(extract).join('\n')
    + '\n' + names.map(n => `this.${n} = ${n};`).join(' '), ctx);
  return { ctx, st, grid };
}

(async () => {
  {
    const { ctx, grid } = makeContext();
    ctx.renderTeacherTests();
    ok("this year's test is listed", /Literature Q1/.test(grid.innerHTML));
    ok("an archived test is not, until asked for", !/Old Quiz/.test(grid.innerHTML) && /Show archived tests \(1\)/.test(grid.innerHTML));
    ok("last year's tests are offered for archiving", /<b>2<\/b> tests are from an earlier school year/.test(grid.innerHTML), grid.innerHTML.slice(0, 300));
    ok('every card can be reused and archived', (grid.innerHTML.match(/reuseTest\(/g) || []).length === 3 && (grid.innerHTML.match(/setTestArchived\('[^']+', true\)/g) || []).length === 3);
    ctx.toggleArchivedTests();
    ok('shown on request, with Unarchive and Reuse but no Edit or Assign',
      /Old Quiz/.test(grid.innerHTML) && /setTestArchived\('arch', false\)/.test(grid.innerHTML) && /reuseTest\('arch'\)/.test(grid.innerHTML)
      && !/editTest\('arch'\)/.test(grid.innerHTML) && !/openAssignModal\('arch'\)/.test(grid.innerHTML));
  }
  {
    const { ctx, st, grid } = makeContext();
    await ctx.archiveOldTests();
    const u = st.updates[0];
    ok('"Archive them" archives exactly the two from last year', u && u.patch.status === 'archived' && JSON.stringify(u.ids) === '["old1","old2"]', JSON.stringify(u));
    ok('  after asking first', st.confirms === 1);
    ok('  and they leave the list', !/Gatsby Ch 2|Antarctica/.test(grid.innerHTML) && /Show archived tests \(3\)/.test(grid.innerHTML));
    ok('  the banner goes with them', !/earlier school year/.test(grid.innerHTML));
    ok("  and their submissions are untouched", !!ctx.submissionsDatabase.old1_s1);
  }
  {
    const { ctx, st } = makeContext();
    await ctx.setTestArchived('arch', false);
    ok('unarchiving brings it back as a draft, not live to students', st.updates[0].patch.status === 'draft' && ctx.testsDatabase.find(t => t.id === 'arch').status === 'draft');
    await ctx.setTestArchived('new1', true);
    ok('archiving one test archives that one', st.updates[1].patch.status === 'archived' && JSON.stringify(st.updates[1].ids) === '["new1"]');
  }
  {
    const { ctx, st } = makeContext();
    await ctx.reuseTest('old1');
    const c = st.saved;
    ok('reuse saves a NEW test', c && c.id === null);
    ok('  as a draft, titled as a copy', c.status === 'draft' && c.title === 'Gatsby Ch 2 (copy)');
    ok('  with the same questions, answers and points',
      c.questions.length === 2 && c.questions[0].text === 'Who narrates?' && c.questions[0].correctAnswer === 0
      && c.questions[0].maxPoints === 2 && c.questions[1].type === 'write-in' && c.questions[1].maxPoints === 5);
    ok("  but not the old question ids, so the copy's questions are its own", c.questions.every(q => !('id' in q) && !q.originalId));
    ok('  and opens in the editor', st.edited === 'copy1');
    ok('the original is left as it was', ctx.testsDatabase.find(t => t.id === 'old1').status === 'active');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
