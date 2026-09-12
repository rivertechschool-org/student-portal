// Marking one student's work on one assignment.
//
// The commonest thing a teacher does, and the one Riven could not touch. It is
// deliberately a different command from SET_GRADE, which sets a student's
// standing in a CLASS for a quarter: that one takes a letter and a subject,
// this one takes points and an assignment.
//
// THE LETTER IS NOT INVENTED
//
// A submission needs both a letter and points - the gradebook refuses one
// without the other - and the letter belongs to the rubric, not to a scale
// made up here. Riven reads the assignment's rubric, or the school default,
// and picks the band the percentage falls in. With no rubric at all it refuses
// and sends the teacher to the gradebook, because a made-up letter is a grade
// on a child's record that nobody chose.
//
// THE THREE REFUSALS
//
//   * a score out of a different total than the assignment carries. Usually a
//     typo, and silently rescaling it is a wrong mark nobody sees.
//   * nothing submitted. Creating the row would record work that was never
//     handed in; marking a non-submission is a separate decision about whether
//     it is missing or excused, and Riven should not make it.
//   * an assignment in a class this teacher does not teach.
//
// Run: node tests/riven-grading.test.js

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
const MINE = { id: 'c1', name: 'Math', teacher_id: 'me', secondary_teacher_id: null };
const THEIRS = { id: 'c2', name: 'Art', teacher_id: 'someone', secondary_teacher_id: null };

const ASSIGNMENT = { id: 'a1', title: 'Chapter 4', class_id: 'c1', max_points: 20, rubric_id: 'r1' };
const BANDS = [
  { letter_grade: 'A', point_percentage: 90 },
  { letter_grade: 'B', point_percentage: 80 },
  { letter_grade: 'C', point_percentage: 70 },
  { letter_grade: 'F', point_percentage: 0 },
];

function makeApp({ role = 'teacher', assignments = [ASSIGNMENT], submissions = [], bands = BANDS,
                   defaultRubric = [{ id: 'rdef' }], classes = [MINE, THEIRS] } = {}) {
  const app = {
    said: [],
    errors: [],
    ok: [],
    confirmed: null,
    updates: [],
    inserts: [],
    undos: [],
    userInfo: { profile: { user_type: role }, user: { id: 'me' } },
    _terminalAllClasses: classes,
    escapeHtml: esc,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrintError(m) { app.errors.push(m); },
    _naturalSuccess(m) { app.ok.push(Array.isArray(m) ? m[0] : m); },
    _pushUndo(desc, fn) { app.undos.push({ desc, fn }); },
    _rivenResolvedStudent: (e) => e?.student?.student || e?.student || null,
    async _rivenRequireClass() { return { row: null, asked: false }; },
    _requestConfirmation(summary, run) {
      app.confirmed = summary;
      app._pending = (async () => run())();
    },
    auth: {
      supabase: {
        from(table) {
          const q = {
            select() { return q; },
            eq(c, v) { q._eq = q._eq || {}; q._eq[c] = v; return q; },
            in(col, vals) { q._in = { col, vals }; return q; },
            limit() { return q; },
            update(patch) { q._patch = patch; return q; },
            insert(row) { app.inserts.push({ table, row }); return Promise.resolve({ error: null }); },
            then(res, rej) {
              if (q._patch) { app.updates.push({ table, patch: q._patch, where: q._eq }); return Promise.resolve({ error: null }).then(res, rej); }
              let data = table === 'assignments' ? assignments
                : table === 'assignment_submissions' ? submissions
                : table === 'rubric_criteria' ? bands
                : table === 'rubrics' ? defaultRubric : [];
              if (q._in) data = data.filter(r => q._in.vals.includes(r[q._in.col]));
              if (q._eq && table !== 'rubric_criteria' && table !== 'rubrics') {
                data = data.filter(r => Object.entries(q._eq).every(([k, v]) => r[k] === v));
              }
              return Promise.resolve({ data, error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  app._rivenCanManageClass = extract('_rivenCanManageClass');
  app._rivenPolicyError = extract('_rivenPolicyError');
  app._rivenFindAssignment = extract('_rivenFindAssignment');
  app._rivenAssignmentError = extract('_rivenAssignmentError');
  app._rivenLetterForScore = extract('_rivenLetterForScore');
  const fn = extract('terminalGradeSubmission');
  app.terminalGradeSubmission = async function (...a) {
    const r = await fn.apply(app, a);
    if (app._pending) { const p = app._pending; app._pending = null; await p; }
    return r;
  };
  return app;
}

const said = (text) => ({ student: { student: NOAH }, original: text, _rawInput: text });
const SUB = (over = {}) => ({ id: 's1', assignment_id: 'a1', student_id: 'noah', grade: null, points_earned: null, status: 'submitted', ...over });

(async () => {

  console.log('\n== the letter comes from the rubric ==\n');

  {
    const app = makeApp({});
    check('90% is an A', await app._rivenLetterForScore.call(app, ASSIGNMENT, 90), 'A');
    check('89.9% is a B', await app._rivenLetterForScore.call(app, ASSIGNMENT, 89.9), 'B');
    check('70% is a C', await app._rivenLetterForScore.call(app, ASSIGNMENT, 70), 'C');
    // Below every band, the lowest one - never undefined, never blank.
    check('0% is the bottom band', await app._rivenLetterForScore.call(app, ASSIGNMENT, 0), 'F');
  }

  {
    const app = makeApp({ bands: [], defaultRubric: [] });
    check('no rubric anywhere means no letter',
      await app._rivenLetterForScore.call(app, { id: 'a', rubric_id: null }, 95), null);
  }

  console.log('\n== marking work ==\n');

  {
    const app = makeApp({ submissions: [SUB()] });
    await app.terminalGradeSubmission.call(app, said('noah got 18 out of 20 on chapter 4'));

    check('the mark is written', app.updates[0].patch.points_earned, 18);
    check('  with the rubric letter', app.updates[0].patch.grade, 'A');
    check('  and it counts as graded', app.updates[0].patch.status, 'graded');
    ok('  stamped', !!app.updates[0].patch.graded_at);

    ok('the confirmation shows the percentage', /90%/.test(app.confirmed));
    ok('  and where the letter came from', /comes from the rubric/.test(app.confirmed));
    check('  and it can be taken back', app.undos.length, 1);
  }

  {
    const app = makeApp({ submissions: [SUB()] });
    await app.terminalGradeSubmission.call(app, said('give noah 15/20 on chapter 4'));
    check('the slash form works too', app.updates[0].patch.points_earned, 15);
    check('  75% is a C', app.updates[0].patch.grade, 'C');
  }

  {
    const app = makeApp({ submissions: [SUB({ grade: 'C', points_earned: 14 })] });
    await app.terminalGradeSubmission.call(app, said('noah got 18 out of 20 on chapter 4'));
    ok('a regrade shows what it was', /14\/20 \(C\)/.test(app.confirmed));
    ok('  and what it becomes', /18\/20/.test(app.confirmed));
  }

  console.log('\n== the refusals ==\n');

  {
    // Usually a typo. Rescaling it silently is a wrong mark nobody sees.
    const app = makeApp({ submissions: [SUB()] });
    await app.terminalGradeSubmission.call(app, said('noah got 18 out of 25 on chapter 4'));
    check('a different total is refused', app.updates, []);
    ok('  saying what the assignment is out of', /out of 20, not 25/.test(app.errors[0]));
  }

  {
    const app = makeApp({ submissions: [SUB()] });
    await app.terminalGradeSubmission.call(app, said('noah got 30 out of 20 on chapter 4'));
    check('a score above the maximum is refused', app.updates, []);
  }

  {
    // Creating the row would record work that was never handed in.
    const app = makeApp({ submissions: [] });
    await app.terminalGradeSubmission.call(app, said('noah got 18 out of 20 on chapter 4'));
    check('nothing submitted means nothing written', app.updates.concat(app.inserts), []);
    ok('  and it says why that is a decision', /missing or excused/.test(app.said[0]));
  }

  {
    const app = makeApp({ submissions: [SUB()], bands: [], defaultRubric: [] });
    await app.terminalGradeSubmission.call(app, said('noah got 18 out of 20 on chapter 4'));
    check('no rubric means no mark', app.updates, []);
    ok('  and it sends them somewhere that can', /gradebook/.test(app.errors[0]));
  }

  {
    const app = makeApp({
      assignments: [{ id: 'x', title: 'Still life', class_id: 'c2', max_points: 20, rubric_id: 'r1' }],
      submissions: [SUB({ assignment_id: 'x' })],
    });
    await app.terminalGradeSubmission.call(app, said('noah got 18 out of 20 on still life'));
    check("another teacher's assignment is not marked", app.updates, []);
  }

  {
    const app = makeApp({ submissions: [SUB()] });
    await app.terminalGradeSubmission.call(app, said('mark noah on chapter 4'));
    check('no score, nothing written', app.updates, []);
    ok('  and it asks for one', /What score/.test(app.errors[0]));
  }

  {
    const app = makeApp({
      assignments: [{ id: 'a1', title: 'Chapter 4', class_id: 'c1', max_points: null, rubric_id: 'r1' }],
      submissions: [SUB()],
    });
    await app.terminalGradeSubmission.call(app, said('noah got 18 on chapter 4'));
    check('an assignment with no points cannot be marked out of anything', app.updates, []);
    ok('  and says that', /no points set/.test(app.errors[0]));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
