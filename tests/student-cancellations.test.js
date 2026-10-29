// A class a teacher has canceled shows on the student's side: a "Class
// canceled" card on Home and a badge / line on the class card. Runs the real
// methods out of portal/index.html against a small database stub.
//
// Run: node tests/student-cancellations.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  const m = new RegExp('\\n(\\s+)(?:async\\s+)?' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('not found: ' + name);
  const start = m.index;
  let p = html.indexOf('(', start), pd = 0;
  for (; p < html.length; p++) {
    if (html[p] === '(') pd++;
    else if (html[p] === ')' && --pd === 0) break;
  }
  let i = html.indexOf('{', p), depth = 0;
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

const names = ['loadStudentCancellations', '_canceledDayText', '_canceledLines', 'renderStudentCanceledCard',
  'renderClassCard', '_calendarDaysUntil', '_localDateStr'];
const app = eval(`({ ${names.map(method).join(',\n')} })`);

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return app._localDateStr(d); };

// Sessions in the stub database. Only what the query asks for comes back.
const sessions = [
  { class_id: 'math', date: day(0), period: null, status: 'canceled', cancel_reason: 'teacher out sick' },
  { class_id: 'art', date: day(3), period: 2, status: 'canceled', cancel_reason: null },
  { class_id: 'math', date: day(1), period: null, status: 'completed', cancel_reason: null },
  { class_id: 'math', date: day(-2), period: null, status: 'canceled', cancel_reason: 'last week' },
  { class_id: 'art', date: day(10), period: null, status: 'canceled', cancel_reason: 'too far ahead' },
  { class_id: 'gone', date: day(0), period: null, status: 'canceled', cancel_reason: 'withdrawn class' },
];
let asked = null;
function from(table) {
  const f = { table, in: {}, eq: {}, gte: {}, lte: {} };
  const q = {
    select() { return q; },
    in(c, v) { f.in[c] = v; return q; },
    eq(c, v) { f.eq[c] = v; return q; },
    gte(c, v) { f.gte[c] = v; return q; },
    lte(c, v) { f.lte[c] = v; return q; },
    order() { return q; },
    then(res, rej) {
      asked = f;
      const rows = sessions.filter(r => (!f.in.class_id || f.in.class_id.includes(r.class_id))
        && (!f.eq.status || r.status === f.eq.status)
        && (!f.gte.date || r.date >= f.gte.date) && (!f.lte.date || r.date <= f.lte.date))
        .map(r => ({ class_id: r.class_id, date: r.date, period: r.period, cancel_reason: r.cancel_reason }));
      return Promise.resolve({ data: rows, error: null }).then(res, rej);
    },
  };
  return q;
}

Object.assign(app, {
  auth: { supabase: { from } },
  supabaseQuery: fn => Promise.resolve(fn()),
  escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  userInfo: { profile: { user_type: 'student' } },
  classes: [
    { id: 'math', name: 'Math', subject: 'Math', enrollment_status: 'active', status: 'active' },
    { id: 'art', name: 'Art <3', subject: 'Art', enrollment_status: 'active', status: 'active' },
    { id: 'gone', name: 'Old', subject: 'Old', enrollment_status: 'archived', status: 'active' },
  ],
  classDescription: () => '',
  gradeBandLabel: () => '',
  classScheduleLine: () => '',
});

(async () => {
  const list = await app.loadStudentCancellations();
  ok('reads attendance sessions', asked?.table === 'class_attendance_sessions');
  ok('only canceled ones', asked?.eq.status === 'canceled');
  ok('only the classes the student is in now', JSON.stringify(asked?.in.class_id) === '["math","art"]', JSON.stringify(asked?.in.class_id));
  ok('today through the next week', asked?.gte.date === day(0) && asked?.lte.date === day(7));
  ok('two cancellations this week', list.length === 2, JSON.stringify(list));

  const card = app.renderStudentCanceledCard(list);
  ok('Home card says Math is canceled today', /<b>Math<\/b> is canceled today/.test(card), card);
  ok('with the teacher\'s reason', /teacher out sick/.test(card));
  ok('a later day by name, with the period', new RegExp(`is canceled ${app._canceledDayText(day(3))} \\(period 2\\)`).test(card), card);
  ok('class names are escaped', /Art &lt;3/.test(card) && !/Art <3/.test(card));
  ok('no card when nothing is canceled', app.renderStudentCanceledCard([]) === '');

  ok('tomorrow says tomorrow', app._canceledDayText(day(1)) === 'tomorrow');

  const math = app.renderClassCard(app.classes[0]);
  ok('class card: canceled today badge', /CANCELED TODAY/.test(math));
  ok('class card: the line and reason', /🚫 Canceled today · teacher out sick/.test(math), math);
  const art = app.renderClassCard(app.classes[1]);
  ok('class card: a later day has the line but no badge', /🚫 Canceled /.test(art) && !/CANCELED TODAY/.test(art));

  app.userInfo = { profile: { user_type: 'teacher' } };
  ok('teachers\' cards are unchanged', !/Canceled/i.test(app.renderClassCard({ ...app.classes[0], class_code: 'X' })));

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
