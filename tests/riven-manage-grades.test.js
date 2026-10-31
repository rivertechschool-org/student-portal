// Riven edits the same current-quarter components as Assignments → Manage Grades.
// Invented fixtures only. Run: node tests/riven-manage-grades.test.js
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');
function extract(name, indent = 4) {
  const re = new RegExp('\\n' + ' '.repeat(indent) + '(?:async\\s+)?' + name + '\\s*\\(', 'g');
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

const student = { id: 'student-fixture', full_name: 'Nova Example' };
const classRow = { id: 'class-fixture', name: 'Math 7', teacher_id: 'teacher-fixture' };
function makeApp({ role = 'teacher', owner = true, enrolled = true, snapshotError = null, rpcError = null,
                   snapshot = { id: 'snapshot-fixture', academic_grade: 70, participation_grade: 80,
                     class_grade: 75, academic_grade_override: false, class_grade_override: false } } = {}) {
  const app = {
    userInfo: { user: { id: owner ? 'teacher-fixture' : 'other-teacher' }, profile: { user_type: role } },
    calls: [], errors: [], successes: [], undos: [],
    escapeHtml: String,
    terminalPrintError(message) { this.errors.push(message); },
    _showRivenMessage(message) { this.errors.push(message); },
    _naturalSuccess(message) { this.successes.push(message); },
    _pushUndo(description, undo) { this.undos.push(undo); },
    _requestConfirmation(message, action) { this.confirmation = message; this.confirm = action; },
    async _rivenRequireClass() { return { row: classRow, enrollment: enrolled ? { id: 'enrollment-fixture' } : null }; },
    async _rivenCurrentQuarter() { return { id: 'quarter-fixture', name: 'Quarter 1' }; },
    auth: { supabase: {
      from(table) {
        const query = {
          select() { return this; }, eq() { return this; },
          async maybeSingle() { return { data: snapshot, error: snapshotError }; },
          update(patch) { app.calls.push({ table, patch }); return this; },
          then(resolve) { return Promise.resolve({ error: null }).then(resolve); }
        };
        return query;
      },
      async rpc(name, args) { app.calls.push({ name, args }); return { error: name === rpcError ? new Error('fixture write failed') : null }; }
    } }
  };
  for (const method of ['_rivenGradeChanges', '_rivenCanManageClass', '_letterToPct', '_pctToLetter', 'terminalSetGrade']) app[method] = extract(method);
  return app;
}
const command = text => ({ normalized: text, student: { student }, classMatch: { id: classRow.id }, amount: 7 });

(async () => {
  const parser = makeApp();
  for (const [text, component, value] of [
    ["edit nova's academic avg in math 7 to 88", 'academic', 88],
    ["set nova's academic average in math 7 to 88.5", 'academic', 88.5],
    ["set nova's participation in math 7 to 90", 'participation', 90],
    ["set nova's final grade in math 7 to 92", 'final', 92],
    ["give nova a b+ participation grade in math", 'participation', parser._letterToPct('b+')],
    ["give nova a b in participation", 'participation', parser._letterToPct('b')],
    ["set nova's final grade to 0", 'final', 0],
    ["set nova's academic avg to 100", 'academic', 100]
  ]) {
    assert.deepEqual(parser._rivenGradeChanges(text), { pairs: [{ component, value }] }, text);
    const app = makeApp();
    await app.terminalSetGrade(command(text));
    assert.equal(app.calls.length, 0, 'must wait for confirmation');
    assert.match(app.confirmation, /Quarter 1/);
    await app.confirm();
    const call = app.calls[0];
    assert.equal(call.name, { academic: 'set_academic_grade_override', participation: 'upsert_quarter_grade', final: 'set_class_grade_override' }[component]);
    assert.equal(call.args.p_enrollment_id, 'enrollment-fixture');
    assert.equal(call.args.p_quarter_id, 'quarter-fixture');
    assert.equal(call.args[{ academic: 'p_academic_grade', participation: 'p_participation_grade', final: 'p_class_grade' }[component]], value);
    assert.equal(app.successes.length, 1);
    await app.undos[0]();
    assert.equal(app.calls.at(-1).patch.academic_grade, 70, 'undo restores prior grades');
  }

  const combined = makeApp();
  await combined.terminalSetGrade(command("set nova's final grade to 92, academic avg to 88, and participation to 90 in math"));
  await combined.confirm();
  assert.deepEqual(combined.calls.map(c => c.name), ['set_academic_grade_override', 'upsert_quarter_grade', 'set_class_grade_override']);
  assert.deepEqual(combined.calls.map(c => c.args.p_academic_grade ?? c.args.p_participation_grade ?? c.args.p_class_grade), [88, 90, 92]);

  assert.deepEqual(parser._rivenGradeChanges('give nova a b in participation and a c in skill').pairs,
    [{ component: 'participation', value: parser._letterToPct('b') }, { component: 'academic', value: parser._letterToPct('c') }]);
  for (const text of ['set academic avg to -1', 'set final grade to 101', 'set participation to 9999',
    'set academic avg to 88 and participation to 150', 'set academic avg to 88 and participation',
    'set academic avg to 88 participation to 90', 'set academic avg in math 7']) {
    const app = makeApp();
    await app.terminalSetGrade(command(text));
    assert.equal(app.confirm, undefined, text);
    assert.equal(app.calls.length, 0, text);
    assert.ok(app.errors.length, text);
  }
  for (const opts of [{ role: 'student' }, { role: 'parent' }, { owner: false }, { enrolled: false }]) {
    const app = makeApp(opts);
    await app.terminalSetGrade(command('set academic avg to 88'));
    assert.equal(app.confirm, undefined, 'unauthorized or unenrolled student is refused');
    assert.equal(app.calls.length, 0);
  }
  const admin = makeApp({ role: 'admin', owner: false });
  await admin.terminalSetGrade(command('set participation to 90'));
  await admin.confirm();
  assert.equal(admin.successes.length, 1, 'admin can edit another teacher’s class');
  const readFailure = makeApp({ snapshotError: new Error('fixture read failed') });
  await assert.rejects(readFailure.terminalSetGrade(command('set academic avg to 88')), /fixture read failed/);
  assert.equal(readFailure.confirm, undefined);
  for (const rpcError of ['set_academic_grade_override', 'calculate_quarter_grades']) {
    const app = makeApp({ rpcError });
    await app.terminalSetGrade(command('set academic avg to 88'));
    await assert.rejects(app.confirm(), /fixture write failed/);
    assert.equal(app.successes.length, 0, 'failed writes/recalculations never report success');
  }
  const overridden = makeApp({ snapshot: { id: 'snapshot-fixture', class_grade_override: true } });
  await overridden.terminalSetGrade(command('set participation to 90'));
  await overridden.confirm();
  assert.deepEqual(overridden.calls.map(c => c.name), ['upsert_quarter_grade'], 'preserve an existing final override');
  console.log('Riven Manage Grades: command parsing, writes, confirmation, undo, permissions and failure paths passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

