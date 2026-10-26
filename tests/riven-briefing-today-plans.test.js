// Riven's briefing: "Today's attendance notes" - who the office was told is
// away, arriving late or leaving early today.
//
// 2026-10-26: runs the real _rivenBriefingTodayPlans over invented students.
//
// Run: node tests/riven-briefing-today-plans.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  let start = html.indexOf(`\n    ${name}(`);
  if (start < 0) start = html.indexOf(`\n    async ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const app = eval(`({ ${method('_rivenBriefingTodayPlans')}, ${method('_briefingExpand')}, ${method('_bellSay')}, ${method('_bellTime')} })`);
app.escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const names = { a: 'Pella Ostrander', b: 'Quill Marrow', c: 'Rook <Ash>', d: 'Sable Finch' };
const absences = [
  { student_id: 'a', reason: 'Family trip' },
  // Two overlapping plans for one child read as one line.
  { student_id: 'a', reason: 'Family trip' },
  { student_id: 'd', reason: null },
];
const le = [
  { student_id: 'b', kind: 'late', at_time: '09:05:00', reason: null },
  { student_id: 'c', kind: 'early', at_time: '13:45:00', reason: 'Dentist' },
];

const all = app._rivenBriefingTodayPlans(absences, le, names, null);
const t = text(all);
ok('headed and counted', /Today's attendance notes \(4\)/.test(t), t);
ok('away first, then arrivals and pickups in clock order',
  /Pella Ostrander — away today · Family trip .*Sable Finch — away today .*Quill Marrow — ⏰ arriving at 9:05 am .*Rook &lt;Ash&gt; — 🚗 leaving at 1:45 pm · Dentist/.test(t), t);
ok('names are escaped', !all.includes('<Ash>'));
ok('a child with two overlapping plans is one line', (t.match(/Pella/g) || []).length === 1, t);

const mine = app._rivenBriefingTodayPlans(absences, le, names, new Set(['b', 'd']));
const m = text(mine);
ok('a teacher sees only their own students', /Sable Finch/.test(m) && /Quill Marrow/.test(m) && !/Pella|Rook/.test(m), m);

ok('nothing for this person gives no section', app._rivenBriefingTodayPlans(absences, le, names, new Set(['zz'])) === null);
ok('nothing at all gives no section', app._rivenBriefingTodayPlans([], [], names, null) === null);

// "Attendance not yet taken" lists only classes that have started.
(async () => {
  const s = eval(`({ ${method('_rivenClassesStarted')}, ${method('_bellTime')} })`);
  const bells = { 1: '08:30:00', 4: '13:00:00' };
  s._bellBlockFor = async (_d, p) => (p in bells ? { starts_at: bells[p] } : null);
  const rows = [
    { class_id: 'morning', period: 1 },
    { class_id: 'afternoon', period: 4 },
    { class_id: 'both', period: 4 }, { class_id: 'both', period: 1 },
    { class_id: 'untimed', period: null },
  ];
  const at = (h, m) => { const d = new Date(2026, 9, 26, h, m); return d; };
  const early = await s._rivenClassesStarted(rows, '2026-10-26', at(8, 0));
  ok('8:00 - nothing timed has started; the untimed class stays in',
    [...early].sort().join() === 'untimed', [...early].join());
  const mid = await s._rivenClassesStarted(rows, '2026-10-26', at(10, 0));
  ok('10:00 - the morning class, and the class that also meets in the morning',
    [...mid].sort().join() === 'both,morning,untimed', [...mid].join());
  const startMinute = await s._rivenClassesStarted(rows, '2026-10-26', at(13, 0));
  ok('13:00 exactly - the afternoon class counts', startMinute.has('afternoon'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
