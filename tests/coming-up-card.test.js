// The staff home screen's "Coming up" card: planned absences, late arrivals and
// early pickups for the next two weeks, one list per school day.
//
// 2026-10-26: these were only visible on the admin Attendance screen, so
// teachers could not see them at all. This runs the real _renderComingUpCard
// over invented students and checks what a teacher would read.
//
// Run: node tests/coming-up-card.test.js
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

const host = { innerHTML: null };
const make = (userType) => {
  const src = `({ ${method('_renderComingUpCard')}, ${method('_bellSay')}, ${method('_bellTime')} })`;
  const app = eval(src);
  app.userInfo = { profile: { user_type: userType } };
  app.escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  app._localDateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return app;
};
global.document = { getElementById: id => (id === 'coming-up-card' ? host : null) };
const text = () => host.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// Monday 2026-10-26 to Monday 2026-11-09.
const today = '2026-10-26', until = '2026-11-09';
const absences = [
  // Thursday to the following Tuesday: shows Thu, Fri, Mon, Tue, never the weekend.
  { student_name: 'Pella Ostrander', start_date: '2026-10-29', end_date: '2026-11-03', reason: 'Family trip' },
  // Started last week, still going today.
  { student_name: 'Quill Marrow', start_date: '2026-10-21', end_date: '2026-10-26', reason: null },
];
const le = [
  { student_id: 's1', date: '2026-10-27', kind: 'early', at_time: '13:45:00', reason: 'Dentist' },
  { student_id: 's2', date: '2026-10-27', kind: 'late', at_time: '09:05:00', reason: null },
];
const names = { s1: 'Rook <Ash>', s2: 'Sable Finch' };

const teacher = make('teacher');
teacher._renderComingUpCard(today, until, absences, le, names);
const t = text();
ok('today is labelled and lists the ongoing absence', /Today Quill Marrow Away all day/.test(t), t);
ok('tomorrow lists the late arrival before the early pickup, by time',
  /Tomorrow Sable Finch ⏰ Arrives 9:05 am Rook &lt;Ash&gt; 🚗 Leaves 1:45 pm · Dentist/.test(t), t);
ok('names are escaped', !host.innerHTML.includes('<Ash>'));
ok('a multi-day absence shows on each school day in it',
  ['Thursday', 'Friday', 'Monday', 'Tuesday'].every(d => new RegExp(d + ',? [^A-Z]*\\d+ Oct|' + d + ',? \\d+ Nov|' + d + '[^·]*Pella').test(t)), t);
ok('never on a weekend', !/Saturday|Sunday/.test(t), t);
ok('the trip appears exactly four times (Thu, Fri, Mon, Tue)', (t.match(/Pella Ostrander/g) || []).length === 4, t);
ok('teachers get no Manage button', !host.innerHTML.includes('Manage'));

// Today is shown; the rest of the fortnight is behind a button.
const shown = host.innerHTML.split('<div style="display: none;">')[0];
ok('only today is shown at first', /Quill Marrow/.test(shown) && !/Pella|Sable|Rook/.test(shown), shown.replace(/\s+/g, ' ').slice(0, 300));
ok('the button counts what it hides (2 tomorrow + 4 trip days)', /Show the next two weeks \(6 more\)/.test(host.innerHTML), text());

teacher._renderComingUpCard(today, until, [], le, names);
ok('nothing today but things later: says so, and still offers the rest',
  /Nobody is expected away, late or leaving early today/.test(text()) && /2 more/.test(text()), text());

const admin = make('admin');
admin._renderComingUpCard(today, until, absences, le, names);
ok('admins get a Manage link to the Attendance screen', host.innerHTML.includes("showSection('admin-attendance')"));

teacher._renderComingUpCard(today, until, [], [], {});
ok('an empty fortnight says so rather than vanishing', /Nobody is expected away/.test(text()), text());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
