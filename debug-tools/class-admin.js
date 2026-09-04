#!/usr/bin/env node
// Behavioural test for creating and editing classes from Riven.
// Extracts the REAL methods from portal/index.html and runs them against an
// in-memory Supabase stub, so what is asserted here is what ships.
// PORTAL_SRC points it at another build.
const fs = require('fs'), path = require('path');
const SRC = [process.env.PORTAL_SRC,
             path.join(__dirname, '..', 'portal', 'index.html'),
             path.join(process.cwd(), 'portal', 'index.html')].filter(Boolean).find(fs.existsSync);
if (!SRC) { console.error('class-admin: cannot find portal/index.html'); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '(') pd++; else if (c === ')') { pd--; if (pd === 0) { i++; break; } } }
  const parEnd = i;
  i = src.indexOf('{', parEnd);
  let depth = 0, start = i;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  const sig = src.slice(m.index + 1, parEnd).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const isAsync = /^async\b/.test(sig);
  const Ctor = isAsync ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(...(args ? args.split(',').map(s => s.trim()).filter(Boolean) : []), src.slice(start + 1, i - 1));
}

let DB = {}, SEQ = 0;
// Deferred, like the real client: filters chained after .insert()/.delete()
// still apply, and .single() unwraps.
function qb(table) {
  const filters = []; let op = 'select', payload = null, one = false, lim = null;
  const hit = r => filters.every(([k, v, isIn]) => isIn ? v.includes(r[k]) : (r[k] === undefined ? null : r[k]) === v);
  const api = {
    select() { return api; },
    eq(k, v) { filters.push([k, v]); return api; },
    is(k, v) { filters.push([k, v]); return api; },
    in(k, vs) { filters.push([k, vs, true]); return api; },
    order() { return api; },
    limit(n) { lim = n; return api; },
    single() { one = true; return api; },
    insert(p) { op = 'insert'; payload = p; return api; },
    update(p) { op = 'update'; payload = p; return api; },
    delete() { op = 'delete'; return api; },
    run() {
      const all = DB[table] || [];
      let rows;
      if (op === 'insert') {
        rows = (Array.isArray(payload) ? payload : [payload]).map(o => ({ id: table[0] + (++SEQ), ...o }));
        DB[table] = all.concat(rows);
      } else if (op === 'update') {
        rows = all.filter(hit);
        rows.forEach(r => Object.assign(r, payload));
      } else if (op === 'delete') {
        rows = all.filter(hit);
        DB[table] = all.filter(r => !hit(r));
      } else {
        rows = all.filter(hit);
      }
      if (lim !== null) rows = rows.slice(0, lim);
      return { data: one ? (rows[0] || null) : rows, error: null };
    },
    then(res) { return Promise.resolve(api.run()).then(res); },
  };
  return api;
}

const app = {
  auth: { supabase: { from: qb } },
  userInfo: { user: { id: 't1' }, profile: { id: 't1', user_type: 'teacher' } },
  _nlpContext: {},
  _terminalAllStudents: [
    { id: 's6', full_name: 'Ada Reyes', first_name: 'Ada', last_name: 'Reyes', status: 'active', rtc_balance: 0 },
    { id: 's7', full_name: 'Ben Okafor', first_name: 'Ben', last_name: 'Okafor', status: 'active', rtc_balance: 0 },
  ],
  _terminalAllClasses: [],
  _terminalAllGroups: [
    { id: 'g-ym', name: 'Full Young Middle', studentIds: ['s6', 's7'] },
    { id: 'g-oe', name: 'Full Old Elementary', studentIds: ['s6'] },
    { id: 'g-ye', name: 'Full Young Elementry', studentIds: ['s7'] },
  ],
  _notesPeople: { people: { p9: { id: 'dan1', name: 'Dan Hollis', user_type: 'teacher' } } },
  escapeHtml: s => String(s),
  terminalPrintError(m) { app._errors.push(m); },
  _showRivenMessage(m) { app._messages.push(m); },
  _requestConfirmation(summary, execute) { app._confirm = { summary, execute }; },
  _naturalSuccess() {}, _pushUndo(d, fn) { app._undo = fn; },
  _rememberClass() {},
  _loadTerminalClasses: async () => {},
  _loadNotesPeople: async () => {},
  loadSubjectOptions: async () => [{ subject: 'Bible' }, { subject: 'Science' }, { subject: 'English' }, { subject: 'Math' }],
  loadGradeBands: async () => [{ code: 'MS', label: 'Middle School', min_grade: 6, max_grade: 8 },
                               { code: 'HS', label: 'High School', min_grade: 9, max_grade: 12 }],
  _loadFacilitiesForSelect: async () => [{ id: 'f1', name: 'Chapel', type: 'room' }],
};
for (const n of ['_rivenParseClassSpec', '_rivenParseNewClassName', '_rivenParseClassRosterRef',
                 '_rivenGroupCanon', '_rivenMatchGroup', '_rivenMatchClass', '_rivenMatchTeacher',
                 '_rivenResolveRosterRef', '_rivenResolveSubject', '_rivenResolveGradeBand',
                 '_rivenResolveFacility', '_rivenResolveClassRow', '_rivenCanManageClass',
                 '_rivenRequireClass', '_preferOwnedClasses', '_rivenFindEnrollment',
                 '_showClassPicker', '_rivenQuantifiesClasses', '_rivenRequireClasses',
                 'terminalCreateClass', 'terminalUpdateClass', 'terminalEnrollGroup', 'terminalDeleteClass']) {
  const fn = extract(n);
  app[n] = function (...a) { return fn.apply(app, a); };
}

let pass = 0, fail = 0;
const t = (label, ok, got) => { ok ? pass++ : fail++; if (!ok) console.log('  FAIL', label, got !== undefined ? '\n        got: ' + JSON.stringify(got) : ''); };

async function say(fnName, text, { classes = [], enrollments = [] } = {}) {
  DB = { classes: classes.map(c => ({ ...c })), class_enrollments: enrollments.map(e => ({ ...e })) };
  app._terminalAllClasses = DB.classes;
  app._errors = []; app._messages = []; app._confirm = null; app._undo = null; app._nlpContext = {};
  const lower = text.toLowerCase();
  await app[fnName]({ original: text, normalized: lower, quoted: null,
    classMatch: app._rivenMatchClass(lower), groupMatch: app._rivenMatchGroup(lower) });
  if (app._confirm) await app._confirm.execute();
  return { db: DB, errors: app._errors, messages: app._messages, summary: app._confirm?.summary || '' };
}

(async () => {
  console.log('== creating a class ==');

  // The reported sentence, end to end.
  let r = await say('terminalCreateClass', 'Create a new class Lower MS Bible with the Lower MS group in it.');
  t('the class is created with the spoken name',
    r.db.classes.length === 1 && r.db.classes[0].name === 'Lower MS Bible', r.db.classes);
  t('the cohort is named in the confirmation',
    /Enrolling <b>2 students<\/b> from <b>Full Young Middle<\/b>/.test(r.summary), r.summary);
  t('both cohort members are enrolled',
    r.db.class_enrollments.length === 2 &&
    r.db.class_enrollments.every(e => e.status === 'active' && e.class_id === r.db.classes[0].id),
    r.db.class_enrollments);
  t('the creator is the teacher', r.db.classes[0].teacher_id === 't1', r.db.classes[0]);

  // Custom specs.
  r = await say('terminalCreateClass', 'create a class Chapel Choir subject Bible grade range Middle School max 15 room Chapel');
  const c = r.db.classes[0] || {};
  t('subject, band, cap and room all land',
    c.name === 'Chapel Choir' && c.subject === 'Bible' && c.grade_band === 'MS' &&
    c.max_students === 15 && c.facility_id === 'f1', c);

  r = await say('terminalCreateClass', 'create a class Art History co-teacher Dan weighted by participation');
  t('co-teacher and grading weight land',
    (r.db.classes[0] || {}).secondary_teacher_id === 'dan1' &&
    (r.db.classes[0] || {}).grading_weight === 'participation', r.db.classes[0]);

  // Nothing half-made: an unresolved piece stops the whole command.
  r = await say('terminalCreateClass', 'create a class Ceramics with the Pottery group in it');
  t('an unknown group creates nothing', r.db.classes.length === 0, r.db.classes);
  t('and says which group it could not find', /don't know a group called "Pottery"/.test(r.errors[0] || ''), r.errors);

  r = await say('terminalCreateClass', 'create a class Recess with the elementary group in it');
  t('an ambiguous group creates nothing', r.db.classes.length === 0, r.db.classes);
  t('and offers the candidates',
    /Full Old Elementary or Full Young Elementry/.test(r.errors[0] || ''), r.errors);

  r = await say('terminalCreateClass', 'create a class Nonsense subject Underwater Basket Weaving');
  t('an unknown subject creates nothing', r.db.classes.length === 0, r.db.classes);

  r = await say('terminalCreateClass', 'create a class Tiny Group max 1 with the Lower MS group in it');
  t('a roster over the cap creates nothing', r.db.classes.length === 0, r.db.classes);
  t('and says why', /cap is 1/.test(r.errors[0] || ''), r.errors);

  r = await say('terminalCreateClass', 'create a class Chess', { classes: [{ id: 'c1', name: 'Chess', teacher_id: 't1', is_active: true, max_students: 30 }] });
  t('a duplicate name is refused', r.db.classes.length === 1, r.db.classes);
  t('and points at the existing one', /already exists/.test(r.messages[0] || ''), r.messages);

  console.log('\n== editing a class ==');
  const CH = [{ id: 'c1', name: 'Chess', subject: 'Games', teacher_id: 't1', secondary_teacher_id: null, is_active: true, max_students: 30 }];

  r = await say('terminalUpdateClass', 'set Chess subject to Bible', { classes: CH });
  t('subject is updated', r.db.classes[0].subject === 'Bible', r.db.classes[0]);

  r = await say('terminalUpdateClass', 'change Chess max students to 12', { classes: CH });
  t('cap is updated', r.db.classes[0].max_students === 12, r.db.classes[0]);

  r = await say('terminalUpdateClass', 'make Dan co-teacher of Chess', { classes: CH });
  t('co-teacher is updated', r.db.classes[0].secondary_teacher_id === 'dan1', r.db.classes[0]);

  // A cap under the current roster would silently contradict the enrolment screen.
  r = await say('terminalUpdateClass', 'set Chess max students to 1', { classes: CH,
    enrollments: [{ id: 'e1', class_id: 'c1', student_id: 's6', status: 'active' },
                  { id: 'e2', class_id: 'c1', student_id: 's7', status: 'active' }] });
  t('a cap below the roster is refused', r.db.classes[0].max_students === 30, r.db.classes[0]);
  t('and says the real count', /already has 2 students/.test(r.errors[0] || ''), r.errors);

  r = await say('terminalUpdateClass', 'set Chess to something', { classes: CH });
  t('an unrecognised field changes nothing', r.db.classes[0].subject === 'Games', r.db.classes[0]);

  console.log('\n== adding a group to a class ==');
  r = await say('terminalEnrollGroup', 'add the Lower MS group to Chess', { classes: CH });
  t('the whole cohort is enrolled', r.db.class_enrollments.length === 2, r.db.class_enrollments);

  r = await say('terminalEnrollGroup', 'add the Lower MS group to Chess', { classes: CH,
    enrollments: [{ id: 'e1', class_id: 'c1', student_id: 's6', status: 'active' }] });
  t('already-enrolled students are not duplicated',
    r.db.class_enrollments.filter(e => e.student_id === 's6').length === 1, r.db.class_enrollments);
  t('and the newcomer is added',
    r.db.class_enrollments.some(e => e.student_id === 's7' && e.status === 'active'), r.db.class_enrollments);

  console.log('\n== deleting a class ==');
  r = await say('terminalDeleteClass', 'delete the Chess class', { classes: CH });
  t('delete writes nothing at all', r.db.classes[0].is_active === true, r.db.classes[0]);
  t('and does not even ask for confirmation', r.summary === '', r.summary);
  t('and points at the Classes tab', /Classes<\/b> tab/.test(r.messages[0] || ''), r.messages);
  t('and offers close as the reversible alternative', /"close \[class name\]"/.test(r.messages[0] || ''), r.messages);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
