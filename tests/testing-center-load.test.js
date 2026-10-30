// Opening the Testing Center as a teacher.
//
// A teacher's test showed "0 assigned, 0 submitted" with 18 submissions in the
// database. The dashboard loaded every submission of every test with all its
// answers and question grades - about 4 of the database's 8 seconds for a
// teacher with 24 tests - and on a busy moment it went over. The load failed as
// a whole, and the class lists were only asked for after it, so "assigned"
// went to 0 as well.
//
// Now: the dashboard loads only what it counts, tries twice and says so if it
// still fails, asks for the classes regardless, and the grading form will not
// open on a submission whose answers never loaded.
//
// Run: node tests/testing-center-load.test.js
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

function makeContext({ role = 'teacher', failSubmissions = 0 } = {}) {
  const st = { selects: [], toasts: [], posted: [], subCalls: 0 };
  const rows = [
    { id: 's1', test_id: 't1', student_id: 'a', status: 'graded', auto_score: 80, final_score: 85, submitted_at: '2026-10-29' },
    { id: 's2', test_id: 't1', student_id: 'b', status: 'submitted', auto_score: 60, final_score: null, submitted_at: '2026-10-29' },
  ];
  const supabaseClient = {
    from(table) {
      let sel = '';
      const q = {
        select(s) { sel = s; if (table === 'test_submissions') st.selects.push(s); return q; },
        eq() { return q; }, in() { return q; }, order() { return q; },
        then(res, rej) {
          if (table === 'test_submissions') {
            st.subCalls++;
            if (st.subCalls <= failSubmissions) {
              return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } }).then(res, rej);
            }
            return Promise.resolve({ data: rows.map(r => ({ ...r })), error: null }).then(res, rej);
          }
          return Promise.resolve({ data: [], error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    supabaseClient, authReady: true, currentRole: role, isEmbedded: true, PARENT_ORIGIN: '*',
    currentUser: { id: 'me' },
    testsDatabase: [{ id: 't1', title: 'Literature Q1', questions: [] }],
    submissionsDatabase: {},
    studentsDatabase: [],
    viewSubmissionsData: { studentProfiles: {} },
    gradingSubmissionKey: null,
    showToast: (m) => st.toasts.push(m),
    window: { parent: { postMessage: (m) => st.posted.push(m.type) } },
    document: { getElementById: () => null },
    loadTests: async () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(['loadSubmissions', 'loadData', 'openGradeModal'].map(extract).join('\n')
    + '\nthis.loadSubmissions = loadSubmissions; this.loadData = loadData; this.openGradeModal = openGradeModal;', ctx);
  return { ctx, st };
}

(async () => {
  {
    const { ctx, st } = makeContext();
    await ctx.loadData();
    ok("a teacher's dashboard does not load answers or question grades",
      st.selects.length === 1 && !/test_question_grades|\*|answers/.test(st.selects[0]), st.selects[0]);
    ok('  but does load what the cards count', /status/.test(st.selects[0]) && /final_score/.test(st.selects[0]) && /student_id/.test(st.selects[0]));
    ok('both submissions are counted', Object.keys(ctx.submissionsDatabase).length === 2);
    ok('the classes are asked for', st.posted.includes('TESTING_CENTER_REQUEST_CLASSES'));
    ok('they are marked as not carrying answers', Object.values(ctx.submissionsDatabase).every(s => s.full === false));
  }
  {
    const { ctx, st } = makeContext({ role: 'student' });
    await ctx.loadSubmissions();
    ok("a student still loads their own submissions in full", /test_question_grades/.test(st.selects[0]));
    ok('  and they are marked as carrying answers', Object.values(ctx.submissionsDatabase).every(s => s.full === true));
  }
  {
    const { ctx, st } = makeContext({ failSubmissions: 1 });
    await ctx.loadData();
    ok('a timeout is tried again, and the second try counts', st.subCalls === 2 && Object.keys(ctx.submissionsDatabase).length === 2);
    ok('  with no error shown', st.toasts.length === 0, JSON.stringify(st.toasts));
  }
  {
    const { ctx, st } = makeContext({ failSubmissions: 5 });
    await ctx.loadData();
    ok('if it keeps failing, the teacher is told, with the reason', st.toasts.some(t => /Could not load submissions/.test(t) && /statement timeout/.test(t)), JSON.stringify(st.toasts));
    ok('  and the classes were still asked for', st.posted.includes('TESTING_CENTER_REQUEST_CLASSES'));
  }
  {
    const { ctx, st } = makeContext();
    await ctx.loadData();
    ctx.openGradeModal('t1', 'a');
    ok('the grading form will not open on a submission without its answers', st.toasts.some(t => /answers did not load/.test(t)));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
