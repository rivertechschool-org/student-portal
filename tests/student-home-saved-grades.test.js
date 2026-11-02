const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('\n            async homeLoadQuarterGrades(');
const end = html.indexOf('\n            }\n', start);
const load = eval('(' + html.slice(start, end + 15).trim().replace('async homeLoadQuarterGrades(', 'async function(') + ')');
(async () => {
  const calls = [];
  let fail = false;
  const app = { auth: { studentRecordId: () => 'student-profile', supabase: { from(table) {
    calls.push(['from', table]);
    const query = { then(resolve) { resolve(fail ? { error: { message: 'Synthetic failure' } } : { data: [
      { class_grade: 94, class_enrollments: { class_id: 'math' } },
      { class_grade: null, class_enrollments: { class_id: 'science' } },
    ] }); } };
    for (const key of ['select', 'eq', 'order', 'range']) query[key] = (...args) => { calls.push([key, ...args]); return query; };
    return query;
  } } } };
  const overview = { quarter: { id: 'current-quarter' }, classes: [
    { id: 'math', graded: 0, class_grade: 0 }, { id: 'science', graded: 0, class_grade: 90 },
  ] };
  await load.call(app, overview);
  assert.equal(overview.classes[0].quarter_snapshot_grade, 94);
  assert.equal(overview.classes[1].quarter_snapshot_grade, undefined);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'quarter_id' && c[2] === 'current-quarter'));
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'class_enrollments.student_id' && c[2] === 'student-profile'));
  assert.ok(calls.some(c => c[0] === 'range' && c[1] === 0 && c[2] === 999));
  fail = true;
  const warn = console.warn; console.warn = () => {};
  try { await load.call(app, overview); } finally { console.warn = warn; }
  assert.equal(overview.classes[0].quarter_snapshot_grade, 94);
  console.log('Student Home saved grades: scoped current-quarter query and fallback passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
