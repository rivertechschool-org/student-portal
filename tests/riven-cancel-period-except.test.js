// "Cancel my period 3 classes except Spanish".
//
// Riven offered four Spanish classes to choose from. Spanish was the one thing
// the sentence asked to SPARE, and it was the only thing on offer to cancel.
//
// Two faults, and they compound. Routing sent it to the single-class path
// because "except Spanish" names a class and that path only asks whether a
// class was named, not what the sentence wanted done with it. That is covered
// by round 41 of debug-tools/nlp-stress.js, which walks the phrasings.
//
// This file covers the other half: once the sentence reaches the bulk
// canceller, does it cancel the right SET? Three things have to hold, and each
// one of them cancels real registers if it does not:
//
//   * the periods named before "except" are the target
//   * the periods named after it are the exception
//   * a class named after it is kept, whole
//
// Cancelling deletes the attendance already taken, so a mistake here is not a
// wrong screen - it is marks a teacher cannot get back.
//
// Run: node tests/riven-cancel-period-except.test.js

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

// ======================================================================
// 1. Which periods the sentence is AIMED at
// ======================================================================
const app0 = {};
app0._rivenTargetPeriods = extract('_rivenTargetPeriods');
app0._rivenExceptClause = extract('_rivenExceptClause');
const target = (t) => [...app0._rivenTargetPeriods.call(app0, t)].sort((a, b) => a - b);
const except = (t) => {
  const r = app0._rivenExceptClause.call(app0, t);
  return r ? [...r.periods].sort((a, b) => a - b) : null;
};

console.log('\n== the periods being cancelled ==\n');

check('period 3', target('cancel my period 3 classes'), [3]);
check('p3', target('cancel my p3 classes'), [3]);
check('3rd period', target('cancel my 3rd period classes'), [3]);
check('two periods', target('cancel my period 3 and 4 classes'), [3, 4]);
check('a list', target('cancel periods 1, 2 and 6'), [1, 2, 6]);
check('no period named', target('cancel all my classes today'), []);

// THE INVERSION THAT MATTERS. Everything after "except" is the exception; if
// its numbers were read as targets the command would cancel exactly what it
// was told to spare - the same mistake as the reported bug, one layer down.
check('a period after "except" is NOT a target',
      target('cancel all my classes except period 3'), []);
check('  it is the exception',
      except('cancel all my classes except period 3'), [3]);
check('targets and exceptions are read from their own halves',
      target('cancel my period 3 and 4 classes except period 4'), [3, 4]);
check('  and the exception is still period 4',
      except('cancel my period 3 and 4 classes except period 4'), [4]);

// A bare number that is not a period must not become one - "cancel my 2
// o'clock" is not period 2.
check('a bare number is not a period', target('cancel my classes for 2 hours'), []);

// ======================================================================
// 2. The set that actually gets cancelled
// ======================================================================
console.log('\n== what the bulk canceller touches ==\n');

// Four classes, on two periods. Spanish sits in period 3 with two others.
const CLASSES = [
  { id: 'sp', name: 'Spanish', teacher_id: 't1', is_active: true, status: 'active' },
  { id: 'ma', name: 'Math',    teacher_id: 't1', is_active: true, status: 'active' },
  { id: 'bi', name: 'Bible',   teacher_id: 't1', is_active: true, status: 'active' },
  { id: 'hi', name: 'History', teacher_id: 't1', is_active: true, status: 'active' },
];
const PERIODS = { sp: [3], ma: [3], bi: [3], hi: [6] };

function makeApp() {
  const a = {
    said: [], errors: [], confirmed: null, inserted: [], deleted: [],
    userInfo: { profile: { user_type: 'teacher' }, user: { id: 't1' } },
    escapeHtml: (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    _terminalAllClasses: CLASSES,
    _localDateStr: () => '2026-09-18',
    _rivenPhraseToDate: () => null,
    _loadTerminalClasses: async () => {},
    _rivenSchoolScope: () => ({ school: false, refused: false }),
    _rivenClassIsOpen: () => true,
    _rivenCanManageClass: () => true,
    _rivenOwnsClass: () => true,
    _rivenPeriodsOn: async (ids) => {
      const out = {};
      ids.forEach(id => { if (PERIODS[id]) out[id] = PERIODS[id]; });
      return out;
    },
    _rivenPolicyError: (e) => e,
    _showRivenMessage: (h) => a.said.push(h),
    terminalPrintError: (m) => a.errors.push(m),
    _naturalSuccess: (m) => a.said.push(Array.isArray(m) ? m.join(' ') : m),
    _requestConfirmation: (summary, run) => { a.confirmed = summary; a._pending = (async () => run())(); },
    auth: { supabase: { from(table) {
      const q = {
        _table: table,
        select() { return q; },
        eq(c, v) { (q._eq = q._eq || {})[c] = v; return q; },
        in(c, v) { (q._in = q._in || {})[c] = v; return q; },
        delete() { q._del = true; return q; },
        insert(row) { q._ins = row; return q; },
        then(res) {
          if (q._del) a.deleted.push({ table, where: { ...(q._eq || {}) } });
          else if (q._ins) a.inserted.push({ table, row: q._ins });
          return Promise.resolve({ data: [], error: null }).then(res);
        },
      };
      return q;
    } } },
  };
  a._rivenExceptClause = extract('_rivenExceptClause');
  a._rivenTargetPeriods = extract('_rivenTargetPeriods');
  const fn = extract('terminalCancelDay');
  a.terminalCancelDay = async (...args) => {
    const r = await fn.apply(a, args);
    if (a._pending) { const p = a._pending; a._pending = null; await p; }
    return r;
  };
  return a;
}

const said = (text) => ({ original: text, _rawInput: text });
// Which classes the confirmation lists as being cancelled.
const listed = (a) => CLASSES.filter(c => a.confirmed && a.confirmed.includes(c.name)).map(c => c.name);
// Which classes a cancellation row was actually written for.
const written = (a) => a.inserted
  .filter(i => i.table === 'class_attendance_sessions')
  .map(i => CLASSES.find(c => c.id === i.row.class_id).name).sort();

(async () => {

  {
    // THE REPORTED SENTENCE. Period 3 is the target; Spanish is spared.
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel my period 3 classes except spanish'));
    check('Spanish is NOT cancelled', written(a).includes('Spanish'), false);
    check('the other two period 3 classes are', written(a), ['Bible', 'Math']);
    check('  and the period 6 class is untouched', written(a).includes('History'), false);
    ok('the confirmation says which period', /period 3/i.test(a.confirmed));
    ok('  and says Spanish is left running', /Left running:[\s\S]*Spanish/.test(a.confirmed));
  }

  {
    // No exception: the whole period goes, and nothing outside it.
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel my period 3 classes'));
    check('every period 3 class', written(a), ['Bible', 'Math', 'Spanish']);
    check('  and only those', written(a).includes('History'), false);
  }

  {
    // No period: the whole day, which is what it always did.
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel all my classes today'));
    check('the whole day', written(a), ['Bible', 'History', 'Math', 'Spanish']);
    ok('  and the confirmation names no period', !/period \d/i.test(a.confirmed));
  }

  {
    // A period in the exception keeps that period whole.
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel all my classes except period 3'));
    check('only the period 6 class goes', written(a), ['History']);
  }

  {
    // Asking for a period nobody teaches that day changes nothing, and says so
    // rather than silently cancelling the day instead.
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel my period 2 classes'));
    check('nothing is cancelled', written(a), []);
    check('  and nothing was even offered', a.confirmed, null);
    ok('  and it says why', /period 2/i.test(a.said.join(' ')));
  }

  {
    // Everything excepted leaves nothing, and must not fall through to
    // cancelling the lot.
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel my period 3 classes except spanish and math and bible'));
    check('nothing is cancelled', written(a), []);
    check('  and nothing was offered', a.confirmed, null);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
