// "Add all" and Undo in the Add Students to Class picker.
//
// Two rules this guards, both of which fail quietly rather than loudly:
//
//   * ADD ALL IS GATED ON A GROUP. The picker's three filters (name, grade,
//     group) all narrow the same rows, so "add everyone shown" is only a
//     meaningful action when the shown set is a deliberate cohort. A stray
//     search term with the button live would enroll whoever happened to
//     match, and nothing about the result would look wrong afterwards.
//   * UNDO RESTORES THE PRIOR STATUS, NOT A FIXED ONE. Enrolling either
//     creates a row or reactivates an archived/removed one. Undoing the
//     second case by writing 'removed' would erase the fact that a student
//     had been withdrawn rather than never enrolled, and 'archived' vs
//     'removed' is read by different screens. So each undo entry carries
//     the status the row held before, and only rows this picker created go
//     to 'removed'.
//
// Enrollment rows are never deleted here, matching the rest of the portal:
// leaving a class is a status change.
//
// Run: node tests/add-all-in-group.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};

// ---- extract the real methods -----------------------------------------
function method(name, indent = '      ') {
  for (const sig of [`\n${indent}async ${name}(`, `\n${indent}${name}(`]) {
    const start = html.indexOf(sig);
    if (start === -1) continue;
    const end = html.indexOf(`\n${indent}}\n`, start);
    if (end === -1) throw new Error(name + ' unterminated');
    const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
    const isAsync = body.startsWith('async ');
    const src = isAsync ? body.slice('async '.length) : body;
    return eval(`(${isAsync ? 'async ' : ''}function ${src.slice(name.length)})`);
  }
  throw new Error(name + ' not found');
}

// ---- the smallest DOM these methods actually touch ---------------------
function el(id, extra = {}) {
  return Object.assign({ id, dataset: {}, style: {}, disabled: false, textContent: '' }, extra);
}

function makeDom(students, { hasAddAll = true } = {}) {
  const nodes = {};
  const rows = students.map(s => {
    const button = el(`enroll-btn-${s.id}`);
    const row = {
      dataset: { name: s.name, grade: String(s.grade ?? ''), groups: (s.groups || []).join(' ') },
      style: {},
      querySelector: () => button,
    };
    button.closest = () => row;
    nodes[button.id] = button;
    return row;
  });

  nodes['add-students-search'] = el('add-students-search', { value: '' });
  nodes['add-students-grade'] = el('add-students-grade', { value: '' });
  nodes['add-students-group'] = el('add-students-group', {
    value: '',
    selectedIndex: 0,
    options: [{ text: 'All groups' }, { text: 'Full Young Middle' }],
  });
  nodes['add-students-count'] = el('add-students-count');
  nodes['add-students-bulk-note'] = el('add-students-bulk-note');
  nodes['add-students-undo'] = el('add-students-undo', { style: { display: 'none' } });
  if (hasAddAll) nodes['add-students-add-all'] = el('add-students-add-all');

  global.document = {
    getElementById: id => nodes[id] || null,
    querySelectorAll: sel => (sel === '.add-student-row' ? rows : []),
  };
  return { nodes, rows };
}

const toasts = [];
global.window = { PortalUI: { showNotification: (m, t) => toasts.push([t, m]) } };

// app stub carrying the real methods
function makeApp(overrides = {}) {
  return Object.assign({
    filterAddStudentsList: method('filterAddStudentsList'),
    addAllStudentsInGroup: method('addAllStudentsInGroup'),
    _pushClassAddUndo: method('_pushClassAddUndo'),
    _refreshAddStudentsUndo: method('_refreshAddStudentsUndo'),
    undoLastClassAdd: method('undoLastClassAdd'),
    _resetAddStudentRow: method('_resetAddStudentRow'),
    enrollStudentInClass: method('enrollStudentInClass'),
  }, overrides);
}

// Blocks share one global `document`, so they run strictly in sequence.
const suite = [];
const test = fn => suite.push(fn);

const STUDENTS = [
  { id: 's1', name: 'ann apple',  grade: 5, groups: ['g1'] },
  { id: 's2', name: 'ben berry',  grade: 6, groups: ['g1'] },
  { id: 's3', name: 'cal cherry', grade: 5, groups: ['g2'] },
];

// ======================================================================
// 1. The gate: no group, no "Add all".
// ======================================================================
test(async () => {
  const { nodes } = makeDom(STUDENTS);
  const app = makeApp();
  app.filterAddStudentsList();

  check('no group: button disabled', nodes['add-students-add-all'].disabled, true);
  check('no group: generic label', nodes['add-students-add-all'].textContent, 'Add all in group');
  check('no group: note explains the gate',
  /Pick a group/.test(nodes['add-students-bulk-note'].textContent), true);

  nodes['add-students-group'].value = 'g1';
  nodes['add-students-group'].selectedIndex = 1;
  app.filterAddStudentsList();

  check('group picked: button live', nodes['add-students-add-all'].disabled, false);
  check('group picked: label counts the shown rows',
  nodes['add-students-add-all'].textContent, '➕ Add all 2 shown');
  check('group picked: note clears', nodes['add-students-bulk-note'].textContent, '');
});

// ======================================================================
// 2. A search box on top of the group narrows what "all" means.
// ======================================================================
test(async () => {
  const { nodes } = makeDom(STUDENTS);
  const app = makeApp();
  nodes['add-students-group'].value = 'g1';
  nodes['add-students-group'].selectedIndex = 1;
  nodes['add-students-search'].value = 'ann';
  app.filterAddStudentsList();

  check('group + search: label follows the filters',
  nodes['add-students-add-all'].textContent, '➕ Add all 1 shown');
});

// ======================================================================
// 3. Already-added rows drop out of the count and out of the batch.
// ======================================================================
test(async () => {
  const { nodes, rows } = makeDom(STUDENTS);
  const enrolled = [];
  const app = makeApp({
  enrollStudentInClass: async (classId, studentId, button, options) => {
    enrolled.push(studentId);
    options.collect.push({ studentId, enrollmentId: `e-${studentId}`, action: 'created', priorStatus: null });
    button.closest().dataset.added = 'true';
    return { ok: true, action: 'enrolled', studentId };
  },
  });

  rows[0].dataset.added = 'true';          // s1 added a moment ago
  nodes['add-students-group'].value = 'g1';
  nodes['add-students-group'].selectedIndex = 1;
  app.filterAddStudentsList();
  check('added rows leave the count', nodes['add-students-add-all'].textContent, '➕ Add all 1 shown');

  await app.addAllStudentsInGroup('c1');
  check('batch skips added rows and rows outside the group', enrolled, ['s2']);
  check('batch is one undo step', app._classAddUndoStack.length, 1);
  check('undo step is labelled with the group',
    app._classAddUndoStack[0].label, '1 student from Full Young Middle');
  check('undo button appears',
    nodes['add-students-undo'].textContent, '↩ Undo (1 student from Full Young Middle)');
  check('nothing left to add: no misleading count',
    { label: nodes['add-students-add-all'].textContent, disabled: nodes['add-students-add-all'].disabled },
    { label: 'Add all in group', disabled: true });
});

// ======================================================================
// 4. Without a group the batch refuses, even if called directly.
// ======================================================================
test(async () => {
  const { nodes } = makeDom(STUDENTS);
  const enrolled = [];
  const app = makeApp({
  enrollStudentInClass: async (c, id) => { enrolled.push(id); return { ok: true }; },
  });
  nodes['add-students-group'].value = '';

  await app.addAllStudentsInGroup('c1');
  check('no group: nothing enrolled', enrolled, []);
  check('no group: says why', /Pick a group first/.test(toasts[toasts.length - 1][1]), true);
});

// ======================================================================
// 5. Undo writes the right status for each kind of add.
// ======================================================================
test(async () => {
  const { nodes, rows } = makeDom(STUDENTS);
  const writes = [];
  const app = makeApp({
  supabaseQuery: fn => fn(),
  auth: {
    supabase: {
      from: () => ({
        update: patch => {
          const w = { status: patch.status };
          const q = {
            eq: (col, val) => { w[col] = val; return q; },
            then: r => r({ error: null }),
          };
          writes.push(w);
          return q;
        },
      }),
    },
  },
  });

  rows.forEach(r => { r.dataset.added = 'true'; r.querySelector().textContent = '✓ Added'; });
  app._classAddUndoStack = [{
  classId: 'c1',
  label: '3 students from Full Young Middle',
  entries: [
    { studentId: 's1', enrollmentId: 'e1', action: 'created',     priorStatus: null },
    { studentId: 's2', enrollmentId: 'e2', action: 'reactivated', priorStatus: 'archived' },
    { studentId: 's3', enrollmentId: null, action: 'created',     priorStatus: null },
  ],
  }];

  await app.undoLastClassAdd();

  check('a row this picker created goes to removed',
    { status: writes[0].status, id: writes[0].id }, { status: 'removed', id: 'e1' });
  check('a reactivated row goes back to the status it had',
    { status: writes[1].status, id: writes[1].id }, { status: 'archived', id: 'e2' });
  check('no row id falls back to class + student',
    { status: writes[2].status, class_id: writes[2].class_id, student_id: writes[2].student_id },
    { status: 'removed', class_id: 'c1', student_id: 's3' });

  check('buttons go back to Add to Class',
    rows.map(r => r.querySelector().textContent),
    ['Add to Class', 'Add to Class', 'Add to Class']);
  check('rows are addable again', rows.map(r => r.dataset.added), ['', '', '']);
  check('stack empties', app._classAddUndoStack.length, 0);
  check('undo button hides', nodes['add-students-undo'].style.display, 'none');
});

// ======================================================================
// 6. enrollStudentInClass records what it actually did.
// ======================================================================
function supabaseFor(existingRow, insertedId = 'new-1') {
  return {
    supabaseQuery: fn => fn(),
    auth: {
      supabase: {
        from: () => {
          const chain = {
            select: () => chain,
            insert: () => chain,
            update: () => chain,
            eq: () => chain,
            maybeSingle: () => Promise.resolve({ data: existingRow, error: null }),
            then: r => r(chain._mode === 'insert'
              ? { data: [{ id: insertedId }], error: null }
              : { data: null, error: null }),
          };
          const realInsert = chain.insert;
          chain.insert = (...a) => { chain._mode = 'insert'; return realInsert(...a); };
          return chain;
        },
      },
    },
  };
}

test(async () => {
  const { rows } = makeDom(STUDENTS);
  const app = makeApp(supabaseFor(null));
  const collected = [];

  const res = await app.enrollStudentInClass('c1', 's1', rows[0].querySelector(), { silent: true, collect: collected });
  check('new enrollment reports ok', { ok: res.ok, action: res.action }, { ok: true, action: 'enrolled' });
  check('new enrollment records the created row',
    { action: collected[0].action, enrollmentId: collected[0].enrollmentId },
    { action: 'created', enrollmentId: 'new-1' });
  check('the row is marked added', rows[0].dataset.added, 'true');
});

test(async () => {
  const { rows } = makeDom(STUDENTS);
  const app = makeApp(supabaseFor({ id: 'old-9', status: 'removed' }));
  const collected = [];

  const res = await app.enrollStudentInClass('c1', 's2', rows[1].querySelector(), { silent: true, collect: collected });
  check('reactivation reports ok', res.ok, true);
  check('reactivation records the status it replaced',
    { action: collected[0].action, priorStatus: collected[0].priorStatus, enrollmentId: collected[0].enrollmentId },
    { action: 'reactivated', priorStatus: 'removed', enrollmentId: 'old-9' });
});

test(async () => {
  const { rows } = makeDom(STUDENTS);
  const app = makeApp(supabaseFor({ id: 'old-3', status: 'active' }));
  const collected = [];

  const res = await app.enrollStudentInClass('c1', 's3', rows[2].querySelector(), { silent: true, collect: collected });
  check('an already-active student is not undoable', collected.length, 0);
  check('and is reported as already enrolled', res.action, 'already');
});

// ---- run ---------------------------------------------------------------
(async () => {
  for (const block of suite) await block();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
