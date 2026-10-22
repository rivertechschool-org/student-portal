// Riven plans for several students at once, and "and Hazel" follow-ups.
//
// Reported 2026-10-22: "<first> and <first> <surname> will be picked up at
// 11:15 today" planned only the second child, and the follow-up "And <name>"
// was read as "show me that student". Now a sentence naming several students
// plans every one of them, in one question with one undo, and a line that
// only names students straight after a plan repeats the plan for them.
//
// The routing is covered by debug-tools/late-early-commands.js. This runs the
// real executors against a stub database: who is asked about, what is
// written, and what undo puts back.
//
// Run: node tests/riven-plan-several.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

const FIXED = new Date('2026-10-01T10:00:00');
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED.getTime()); else super(...a); }
  static now() { return FIXED.getTime(); }
};

function extract(name) {
  const re = new RegExp('\\n    (?:async\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  let i = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0; const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = src.slice(m.index + 1, start).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const AsyncFunction = (async () => {}).constructor;
  const Ctor = /^async\s/.test(sig) ? AsyncFunction : Function;
  return new Ctor(...args.split(',').map(s => s.trim()).filter(Boolean), src.slice(start + 1, i - 1));
}

const app = {};
for (const n of ['terminalPlanLateEarly', '_rivenPlanLateEarlyMany', 'terminalPlanAbsence',
  '_rivenPlanInput', '_rivenPlanTargets', '_rivenResolvedStudent', '_rivenRememberPlan',
  '_rivenLateEarlyPlan', '_rivenClockTime', '_rivenLateEarlyDate']) {
  const fn = extract(n);
  app[n] = function (...a) { return fn.apply(app, a); };
}
// Invented students. Nothing here is read from the roster.
const kid = (id, f, l) => ({ id, first_name: f, last_name: l, full_name: `${f} ${l}` });
const HAZEL = kid('h', 'Hazel', 'Brennick'), OTTO = kid('o', 'Otto', 'Brennick');
app.escapeHtml = s => String(s);
app._bellSay = hm => hm;
app._rivenMonthDayDates = () => [];
app._rivenPhraseToDate = () => null;
app._rivenLateEarlyClasses = async (id) => [{ name: id === 'h' ? 'Art' : 'Guitar', period: 5, effect: 'misses' }];
app._rivenResolveAbsenceSpans = () => [{ start: '2026-10-05', end: '2026-10-05' }];
app._rivenSpanLabel = () => 'Monday';
app.userInfo = { user: { id: 't1' } };
app.renderLateEarlyPanel = async () => {};
app.renderPlannedAbsencesPanel = async () => {};
let asked = null, undo = null, said = null;
app._requestConfirmation = (html, fn) => { asked = html; app._pendingAction = { execute: fn }; };
app._pushUndo = (label, fn) => { undo = { label, fn }; };
app._naturalSuccess = lines => { said = lines[0]; };
app._showRivenMessage = html => { said = html; };
app.terminalPrintError = msg => { said = msg; };

// A stub table: upsert by (student_id, date, kind), insert, delete, update.
let rows = [];
function table(name) {
  let filters = [], op = null, payload = null;
  const match = r => r._t === name && filters.every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v);
  const q = {
    select() { return q; },
    eq(k, v) { filters.push([k, v]); return q; },
    in(k, v) { filters.push([k, v]); return q; },
    upsert(p) { op = 'upsert'; payload = p; return q; },
    insert(p) { op = 'insert'; payload = p; return q; },
    update(p) { op = 'update'; payload = p; return q; },
    delete() { op = 'delete'; return q; },
    async maybeSingle() { return { data: rows.find(match) || null }; },
    async single() { return run(true); },
    then(res, rej) { return run(false).then(res, rej); },
  };
  let seq = 0;
  async function run(one) {
    if (op === 'upsert') {
      const old = rows.find(r => r._t === name && r.student_id === payload.student_id && r.date === payload.date && r.kind === payload.kind);
      if (old) { Object.assign(old, payload); return { data: { id: old.id } }; }
      const r = { ...payload, _t: name, id: `${name}-${rows.length}-${++seq}` }; rows.push(r);
      return { data: { id: r.id } };
    }
    if (op === 'insert') {
      const made = payload.map(p => { const r = { ...p, _t: name, id: `${name}-${rows.length}-${++seq}` }; rows.push(r); return r; });
      return { data: made.map(r => ({ id: r.id })) };
    }
    if (op === 'delete') { rows = rows.filter(r => !match(r)); return { error: null }; }
    if (op === 'update') { rows.filter(match).forEach(r => Object.assign(r, payload)); return { error: null }; }
    return { data: one ? rows.find(match) : rows.filter(match) };
  }
  return q;
}
app.auth = { supabase: { from: table } };

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};
const reset = () => { rows = []; asked = undo = said = null; app._pendingAction = null; app._rivenLastPlan = null; };
const both = { student: { student: OTTO }, students: [{ student: HAZEL }, { student: OTTO }] };

(async () => {
  console.log('\n== one sentence, two students: early pickup ==\n');
  reset();
  await app.terminalPlanLateEarly({ ...both, _rawInput: 'Hazel and Otto Brennick will be picked up at 11:15 today' });
  ok('the question names both', /Hazel Brennick/.test(asked) && /Otto Brennick/.test(asked), asked);
  ok('  and what each misses', /Art \(P5\)/.test(asked) && /Guitar \(P5\)/.test(asked));
  await app._pendingAction.execute();
  const pl = rows.filter(r => r._t === 'planned_late_early');
  ok('a row for each, at 11:15, early, today',
    pl.length === 2 && pl.every(r => r.at_time === '11:15' && r.kind === 'early' && r.date === '2026-10-01')
    && pl.some(r => r.student_id === 'h') && pl.some(r => r.student_id === 'o'), JSON.stringify(pl));
  ok('the reply names both', /Hazel Brennick and Otto Brennick leave at 11:15/.test(said), said);
  await undo.fn();
  ok('one undo takes both back', rows.filter(r => r._t === 'planned_late_early').length === 0);

  console.log('\n== a follow-up after a confirmed plan ==\n');
  reset();
  await app.terminalPlanLateEarly({ student: { student: OTTO }, _rawInput: 'Otto Brennick will be picked up at 11:15 today' });
  await app._pendingAction.execute();
  const first = app._rivenLastPlan;
  ok('the plan is remembered, and marked done', first && first.confirmed && first.intent === 'PLAN_LATE_EARLY');
  await app.terminalPlanLateEarly({ student: { student: HAZEL }, _rawInput: 'And Hazel Brennick', _planFollowUp: first });
  ok('the follow-up asks about Hazel only', /Hazel Brennick/.test(asked) && !/Otto/.test(asked), asked);
  ok('  at the same time and day', /leave at 11:15<\/b> <b>today/.test(asked), asked);
  await app._pendingAction.execute();
  ok('both are now down for 11:15', rows.filter(r => r._t === 'planned_late_early' && r.at_time === '11:15').length === 2);

  console.log('\n== a follow-up that set an unconfirmed plan aside ==\n');
  reset();
  await app.terminalPlanLateEarly({ student: { student: OTTO }, _rawInput: 'Otto Brennick will be picked up at 11:15 today' });
  app._rivenLastPlan.setAside = true; app._pendingAction = null;
  await app.terminalPlanLateEarly({ student: { student: HAZEL }, _rawInput: 'And Hazel Brennick', _planFollowUp: app._rivenLastPlan });
  ok('the question carries Otto along with Hazel', /Otto Brennick/.test(asked) && /Hazel Brennick/.test(asked), asked);
  await app._pendingAction.execute();
  ok('  and both are written', rows.filter(r => r._t === 'planned_late_early').length === 2);

  console.log('\n== absences: two students, then a follow-up ==\n');
  reset();
  await app.terminalPlanAbsence({ ...both, _rawInput: 'Hazel and Otto Brennick are out monday' });
  ok('the question names both', /Hazel Brennick and Otto Brennick/.test(asked), asked);
  await app._pendingAction.execute();
  const ab = rows.filter(r => r._t === 'planned_absences');
  ok('a row each for Monday', ab.length === 2 && ab.every(r => r.start_date === '2026-10-05'), JSON.stringify(ab));
  ok('the reply says "are"', /Hazel Brennick and Otto Brennick are /.test(said), said);
  const plan = app._rivenLastPlan;
  await app.terminalPlanAbsence({ student: { student: kid('w', 'Willow', 'Fenmore') }, _rawInput: 'and Willow', _planFollowUp: plan });
  ok('the follow-up asks about Willow for Monday', /Willow Fenmore/.test(asked) && /Monday/.test(asked) && !/Hazel/.test(asked), asked);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
