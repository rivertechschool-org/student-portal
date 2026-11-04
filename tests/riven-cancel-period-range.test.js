// "Cancel my classes today from 3-7 period" and runs like it.
//
// 2026-11-04: Riven answered that with the list of the teacher's 24 classes.
// Routing is covered by the run-of-periods lines in debug-tools/nlp-stress.js;
// this file checks what the canceller then does: which periods a run means,
// which classes it calls off, and what the confirmation says before it does.
//
// Run: node tests/riven-cancel-period-range.test.js

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


const app0 = {};
app0._rivenTargetPeriods = extract('_rivenTargetPeriods');
const target = (t) => [...app0._rivenTargetPeriods.call(app0, t)].sort((a, b) => a - b);
const upTo12 = (n) => Array.from({ length: 13 - n }, (_, i) => n + i);

console.log('\n== which periods a run means ==\n');
check('from 3-7 period', target('cancel my classes today from 3-7 period'), [3, 4, 5, 6, 7]);
check('periods 3-7', target('cancel my classes periods 3-7'), [3, 4, 5, 6, 7]);
check('periods 3 through 7', target('cancel periods 3 through 7'), [3, 4, 5, 6, 7]);
check('3rd through 7th period', target('cancel my 3rd through 7th period classes'), [3, 4, 5, 6, 7]);
check('p3-p7', target('cancel my classes p3-p7'), [3, 4, 5, 6, 7]);
check('periods 3 to 7 tomorrow', target('cancel periods 3 to 7 tomorrow'), [3, 4, 5, 6, 7]);
check('an en dash', target('cancel periods 3–7'), [3, 4, 5, 6, 7]);
check('backwards', target('cancel periods 7-3'), [3, 4, 5, 6, 7]);
check('a list and a run', target('cancel periods 2 and 5-7'), [2, 5, 6, 7]);
check('after 2nd period', target('cancel my classes after 2nd period'), upTo12(3));
check('from period 3 on', target('cancel my classes from period 3 on'), upTo12(3));
check('starting with p4', target('cancel my classes starting with p4 tomorrow'), upTo12(4));
check('a bare range with no "period" is not read as one', target('cancel classes 11-14'), []);
check('the run before "except" only', target('cancel periods 3-7 except period 5'), [3, 4, 5, 6, 7]);

console.log('\n== what gets cancelled ==\n');
// One teacher's day. Math meets twice, in 2 and 5. Nothing is taught in 4.
const CLASSES = [
  { id: 'bi', name: 'Bible',   teacher_id: 't1', is_active: true, status: 'active' },
  { id: 'ma', name: 'Math',    teacher_id: 't1', is_active: true, status: 'active' },
  { id: 'sp', name: 'Spanish', teacher_id: 't1', is_active: true, status: 'active' },
  { id: 'hi', name: 'History', teacher_id: 't1', is_active: true, status: 'active' },
  { id: 'co', name: 'Coding',  teacher_id: 't1', is_active: true, status: 'active' },
];
const PERIODS = { bi: [1], ma: [2, 5], sp: [3], hi: [6], co: [7] };
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
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('Cancel my classes today from 3-7 period'));
    check('THE REPORTED SENTENCE: periods 3-7 go', written(a), ['Coding', 'History', 'Math', 'Spanish']);
    check('  period 1 stays', written(a).includes('Bible'), false);
    ok('  the confirmation says periods 3–7', /periods 3–7/.test(a.confirmed));
    ok('  and warns that Math also meets in period 2', /Math[\s\S]{0,120}also meets P2/.test(a.confirmed));
  }
  {
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel my classes after 2nd period'));
    check('after 2nd period', written(a), ['Coding', 'History', 'Math', 'Spanish']);
    ok('  an open run is said up to the last period taught, not 12', /periods 3–7 on/.test(a.confirmed) && !/–12/.test(a.confirmed));
  }
  {
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel periods 6-7 except coding'));
    check('a run with an exception', written(a), ['History']);
  }
  {
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel periods 8-10'));
    check('a run nobody teaches in cancels nothing', written(a), []);
    check('  and offers nothing', a.confirmed, null);
  }
  {
    const a = makeApp();
    await a.terminalCancelDay.call(a, said('cancel my classes today'));
    check('"cancel my classes today" is the whole day', written(a), ['Bible', 'Coding', 'History', 'Math', 'Spanish']);
    ok('  with no "also meets" note', !/also meets/.test(a.confirmed));
  }

  console.log(`
${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
