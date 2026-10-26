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
  const start = html.indexOf(`\n    ${name}(`);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
