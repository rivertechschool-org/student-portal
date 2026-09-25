// The student record form has one loader now, not two.
//
// renderStudentHubRecordsTab() used to be a second copy of
// loadAdminStudentRecord() - same four queries, same form, same state
// assignment, different target element. The copy hid a real bug: the form's
// own buttons call back into loadAdminStudentRecord() to refresh after a save,
// and that function looked its container up by an id that only existed inside
// a modal nothing routes to any more. Saving from the Student Hub therefore
// painted into null.
//
// These assertions are about behaviour, not about the words in the file: each
// one runs the real extracted method against stubs and checks where the HTML
// actually landed.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

// Lift a method out of the page by its header, brace-matched.
function extract(header) {
  const i = SRC.indexOf(header);
  if (i < 0) throw new Error('no such method: ' + header.trim());
  let j = SRC.indexOf('{', i), depth = 0;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}

// Turn "async name(args) { body }" into a callable that keeps `this`.
function compile(text) {
  const m = /^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/.exec(text);
  if (!m) throw new Error('could not parse method');
  const isAsync = /^\s*async\b/.test(text);
  const Ctor = isAsync
    ? Object.getPrototypeOf(async function () {}).constructor
    : Function;
  return new Ctor(...m[1].split(',').map(s => s.trim()).filter(Boolean), m[2]);
}

// --- a DOM with only the elements we say exist -------------------------------
function makeDom(ids) {
  const els = {};
  ids.forEach(id => { els[id] = { id, innerHTML: '' }; });
  global.document = { getElementById: id => els[id] || null };
  return els;
}

// --- a supabase that answers any chain these methods build -------------------
let queriesIssued;
function makeSupabase() {
  queriesIssued = [];
  return {
    from(table) {
      queriesIssued.push(table);
      const p = Promise.resolve({ data: { id: 'stub' } });
      const node = {
        select: () => node,
        eq: () => node,
        order: () => p,
        single: () => p,
      };
      return node;
    },
  };
}

function appStub(dom) {
  return {
    auth: { supabase: makeSupabase() },
    _studentHubId: 'stu-1',
    renderAdminStudentRecordForm: () => '<<THE FORM>>',
    showNotification: () => {},
    _dom: dom,
  };
}

const loadRecord = compile(extract('      async loadAdminStudentRecord(studentId) {'));
const hubTab = compile(extract('      async renderStudentHubRecordsTab() {'));

(async () => {
  console.log('\nloadAdminStudentRecord resolves its host');

  {
    const els = makeDom(['student-hub-tab-content']);
    const app = appStub(els);
    await loadRecord.call(app, 'stu-1');
    // This is the regression. Before the two copies were collapsed, the loader
    // asked for one fixed id, got null, and threw on the assignment.
    ok('with only the hub tab present, the form lands in the hub tab',
       els['student-hub-tab-content'].innerHTML === '<<THE FORM>>');
    ok('  and the student it loaded is remembered for the save handlers',
       app._currentAdminStudentId === 'stu-1');
  }

  {
    const els = makeDom(['admin-student-record-content', 'student-hub-tab-content']);
    const app = appStub(els);
    await loadRecord.call(app, 'stu-2');
    ok('a host that supplies its own container still wins',
       els['admin-student-record-content'].innerHTML === '<<THE FORM>>');
    ok('  and the hub tab is left alone in that case',
       els['student-hub-tab-content'].innerHTML === '');
  }

  {
    makeDom([]);                       // neither container on the page
    const app = appStub({});
    let threw = null;
    try { await loadRecord.call(app, 'stu-3'); } catch (e) { threw = e; }
    ok('with no container at all it returns quietly instead of throwing',
       threw === null);
    ok('  and it does not query for a student it cannot display',
       queriesIssued.length === 0);
  }

  console.log('\nthe hub tab delegates rather than restating');

  {
    const els = makeDom(['student-hub-tab-content']);
    const app = appStub(els);
    let delegatedTo = null;
    app.loadAdminStudentRecord = async (id) => { delegatedTo = id; };
    await hubTab.call(app);
    ok('it calls the shared loader', delegatedTo === 'stu-1');
    // The point of collapsing them: the tab must not carry its own copy of the
    // four queries, or a fix to one path silently misses the other.
    ok('  and issues no queries of its own', queriesIssued.length === 0);
  }

  {
    // End to end: the real loader, reached through the real tab.
    const els = makeDom(['student-hub-tab-content']);
    const app = appStub(els);
    app.loadAdminStudentRecord = loadRecord;
    await hubTab.call(app);
    ok('through the real loader, the tab ends up showing the form',
       els['student-hub-tab-content'].innerHTML === '<<THE FORM>>');
    ok('  having queried the four record tables once',
       queriesIssued.length === 4);
  }

  console.log('\nthe retired copies are gone');

  ok('the unrouted record modal no longer exists',
     !/\basync showAdminStudentRecordModal\s*\(/.test(SRC));
  ok('nothing still tries to open it',
     !/\.showAdminStudentRecordModal\s*\(/.test(SRC));
  ok('the form renderer is kept - the hub tab draws with it',
     /\brenderAdminStudentRecordForm\s*\(/.test(SRC));

  console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
  if (fail) process.exit(1);
})();
