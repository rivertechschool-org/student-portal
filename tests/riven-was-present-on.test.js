// "Was Josephine Beck present September 9" is three questions in a trench coat,
// and the page got all three wrong.
//
// 1. IT NEVER REACHED ATTENDANCE. Every copula pattern on VIEW_ATTENDANCE said
//    "is": /\bis\b.+\b(here|present|…)\b/. The sentence says "was". Nothing
//    matched, so the name alone carried it to VIEW_STUDENT — which prints an
//    account card. Email, RTC balance, status, join date, uuid. A confident
//    answer with nothing about attendance in it, which is the worst shape a
//    wrong answer can take: it looks answered.
//
// 2. IT READ THE WRONG REGISTER. terminalShowAttendance queried
//    class_attendance alone. daily_attendance is the one that knows whether a
//    child came to school. Same fault as the school-wide scan, same fix: the
//    morning register is the default, a NAMED subject is the exception.
//
// 3. IT WIDENED AN EMPTY DAY INTO A MONTH. With nothing in the lesson
//    registers for the 9th, the empty branch re-ran itself for the last 30 days
//    and rendered a month of summary. A different question, answered
//    confidently, again.
//
// THE SHAPE OF THE ANSWER
//
// A yes/no question gets a yes or a no. "3 records · 67% present" is a report,
// and a report is not an answer to "was she here". The multi-day view keeps its
// summary, but counts DAYS rather than register rows, because a child out all
// day has one daily row and one row per lesson and counting those flat reports
// five absences for one day off.
//
// Run: node tests/riven-was-present-on.test.js

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

const show = extract('terminalShowAttendance');
const isoDaysAgo = extract('_isoDaysAgo');
const parseTimeframe = extract('_parseTimeframe');
const pastDate = extract('_rivenPastDate');
const monthIndex = extract('_rivenMonthIndex');

const TODAY = isoDaysAgo.call({}, 0);
const MONTH = Number(TODAY.slice(5, 7));
const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
            'August', 'September', 'October', 'November', 'December'];
// A month that is already behind us, so these do not depend on the run date.
const pastMonth = MONTH >= 3 ? MONTH - 1 : MONTH + 9;
const pastYear = MONTH >= 3 ? Number(TODAY.slice(0, 4)) : Number(TODAY.slice(0, 4)) - 1;
const PM = MN[pastMonth - 1];
const P2 = String(pastMonth).padStart(2, '0');
const THE_9TH = `${pastYear}-${P2}-09`;

// One student, two registers, and a stub that records what was asked of each.
function makeApp({ daily = [], classy = [], classes = [] } = {}) {
  const app = {
    said: [], printed: [], asked: [],
    escapeHtml: (t) => String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    _isoDaysAgo: isoDaysAgo,
    _showRivenMessage(h) { app.said.push(h); },
    terminalPrint(m) { app.printed.push(m); },
    _naturalError(m) { app.printed.push(m); },
    _suggestStudents() { return []; },
    async _findStudentsByName() {
      return [{ id: 'eb', first_name: 'Josephine', last_name: 'Wexler', full_name: 'Josephine Wexler' }];
    },
    auth: { supabase: { from(table) {
      const rec = { table };
      app.asked.push(rec);
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq: (c, v) => { rec[c] = v; return q; },
        in: () => q,
        gte: (_c, v) => { rec.gte = v; return q; },
        lte: (_c, v) => { rec.lte = v; return q; },
        then: (res, rej) => Promise.resolve({
          data: table === 'daily_attendance' ? daily
            : table === 'class_attendance' ? classy
              : table === 'classes' ? classes : [],
          error: null,
        }).then(res, rej),
      };
      return q;
    } } },
  };
  app.terminalShowAttendance = show;
  return app;
}
const answer = (app) => app.said.join('\n') + '\n' + app.printed.join('\n');

// What the router ends up passing, for the sentence actually typed.
function optsFor(text) {
  const tf = parseTimeframe.call({ _isoDaysAgo: isoDaysAgo, _rivenPastDate: pastDate, _rivenMonthIndex: monthIndex }, text) || {};
  return { sinceDate: tf.sinceDate || null, untilDate: tf.untilDate || null, sinceLabel: tf.label || null };
}

(async () => {

  console.log('\n== the sentence from the screenshot reaches attendance ==\n');

  {
    // Asserted on BEHAVIOUR. This used to slice the source at the first
    // `intent: 'VIEW_ATTENDANCE'` and read the regexes there, which stopped
    // being the decision the day _rivenAttendanceQuestion was added — the
    // slice landed inside that method's own return statement and the
    // assertions failed while the behaviour was right.
    const decide = extract('_rivenAttendanceQuestion');
    const someone = { student: { student: { id: 'eb', full_name: 'Josephine Wexler' }, score: 1 } };
    const route = (t) => decide.call({ _rivenPointsForward: extract('_rivenPointsForward') },
                                     t, someone)?.intent || null;

    check('the sentence from the screenshot', route(`was josephine beck present ${PM} 9`), 'VIEW_ATTENDANCE');
    check('  the present tense too', route('is josephine here today'), 'VIEW_ATTENDANCE');
    check('  and the plural', route('were they absent yesterday'), 'VIEW_ATTENDANCE');
    check('  "did she miss school"', route('did josephine miss school yesterday'), 'VIEW_ATTENDANCE');
    // Forward-facing goes to the plan instead, whatever the person's name.
    check('  but "will she be out" is the plan', route('will josephine be out tomorrow'), 'VIEW_PLANNED_ABSENCES');
  }

  console.log('\n== the morning register is read ==\n');

  {
    // THE CASE THAT USED TO VANISH: off school all day, and no lesson register
    // taken for her at all.
    const app = makeApp({ daily: [{ status: 'absent', date: THE_9TH, notes: null }], classy: [] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', optsFor(`was josephine beck present ${PM} 9`));
    const out = answer(app);

    ok('the daily register was queried', app.asked.some(a => a.table === 'daily_attendance'));
    check('  for that student', app.asked.find(a => a.table === 'daily_attendance').student_id, 'eb');
    check('  bounded to the one day',
          [app.asked.find(a => a.table === 'daily_attendance').gte,
           app.asked.find(a => a.table === 'daily_attendance').lte], [THE_9TH, THE_9TH]);
    ok('and the answer is a No', /No —/.test(out) && /marked absent/.test(out));
    ok('  naming the day asked about', out.includes(`${PM} 9`));
    ok('  and which register said so', /morning register/.test(out));
    // The failure that started this.
    ok('  with no account card in sight', !/RTC Balance|Joined:|ID:/.test(out));
  }

  {
    // A named subject is the exception: that question is about the lesson, and
    // the morning register cannot answer it.
    const app = makeApp({ daily: [{ status: 'absent', date: THE_9TH }], classy: [] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler',
      { ...optsFor(`was josephine present in chemistry ${PM} 9`), subject: 'chemistry' });
    ok('a named subject does not reach for the daily register',
       !app.asked.some(a => a.table === 'daily_attendance'));
  }

  {
    // "in school" is not a subject called School.
    //
    // The entity reader pulls "school" out of "was she in school yesterday"
    // and hands it over as a subject — nlp-stress prints `subj=school` for
    // that sentence. Taken at face value it filters every lesson away AND
    // counts as a named subject, switching off the morning register: the one
    // question daily_attendance exists to answer would come back "nothing
    // recorded".
    for (const generic of ['school', 'class', 'classes', 'lesson', 'lessons', 'School']) {
      const app = makeApp({ daily: [{ status: 'absent', date: THE_9TH }] });
      await app.terminalShowAttendance.call(app, 'Josephine Wexler',
        { ...optsFor(`was josephine in school ${PM} 9`), subject: generic });
      ok(`"${generic}" is not treated as a subject`,
         app.asked.some(a => a.table === 'daily_attendance'));
      ok(`  so the question is answered`, /marked absent/.test(answer(app)));
    }
    // A real subject still narrows.
    const app = makeApp({ daily: [{ status: 'absent', date: THE_9TH }] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler',
      { ...optsFor(`was josephine in chemistry ${PM} 9`), subject: 'chemistry' });
    ok('a real subject still narrows to the lesson registers',
       !app.asked.some(a => a.table === 'daily_attendance'));
  }

  console.log('\n== a yes/no question gets a yes or a no ==\n');

  {
    const app = makeApp({ daily: [{ status: 'present', date: THE_9TH }] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', optsFor(`was josephine present ${PM} 9`));
    const out = answer(app);
    ok('present reads as Yes', /Yes —/.test(out));
    ok('  and says so plainly', /was present on/.test(out));
    // Not a report.
    ok('  with no percentage', !/% present/.test(out));
    ok('  and no day tally', !/days? recorded/.test(out));
  }

  {
    // excuse_note, not notes. daily_attendance has no notes column — asking
    // for one is a 400, and the warn-and-continue in the executor would have
    // turned that into "class registers only", silently restoring the bug.
    // The first version of this fixture had it wrong in exactly the way the
    // code did, which is what a stub is for and against.
    const app = makeApp({ daily: [{ status: 'late', date: THE_9TH, excuse_note: 'bus' }] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', optsFor(`was josephine present ${PM} 9`));
    const out = answer(app);
    ok('late is neither a yes nor a no', !/Yes —|No —/.test(out));
    ok('  it is what it is', /was marked late on/.test(out));
    ok('  and the excuse note comes with it', /bus/.test(out));
  }

  {
    // "Absent" and "absent, and the school knew why" are different things to
    // be told — one of them ends in a phone call home.
    const app = makeApp({ daily: [{ status: 'absent', date: THE_9TH, excused: true, excuse_note: 'dentist' }] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', optsFor(`was josephine present ${PM} 9`));
    const out = answer(app);
    ok('an excused absence says so', /absent, excused,/.test(out));
    ok('  and gives the reason', /dentist/.test(out));
  }

  {
    const app = makeApp({ daily: [{ status: 'absent', date: THE_9TH, excused: false }] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', optsFor(`was josephine present ${PM} 9`));
    ok('an unexcused one does not claim to be excused', !/excused/.test(answer(app)));
  }

  {
    // The columns the executor actually asks the morning register for. If this
    // drifts from the live schema again it is a 400 that hides itself.
    const src = html.slice(html.indexOf('async terminalShowAttendance'));
    const body = src.slice(0, src.indexOf('async terminalShowClassAttendance'));
    const daily = body.slice(body.indexOf("from('daily_attendance')"));
    const sel = /\.select\('([^']+)'\)/.exec(daily)?.[1];
    check('the daily select matches the live schema', sel, 'status, date, excused, excuse_note');
    ok('  and never asks for notes, which does not exist there',
       !/\.select\('[^']*\bnotes\b/.test(daily.slice(0, 200)));
  }

  {
    // In school, but missed a lesson. Two facts that need opposite things done
    // about them, so the answer must not flatten them into "present".
    const app = makeApp({
      daily: [{ status: 'present', date: THE_9TH }],
      classy: [{ status: 'absent', date: THE_9TH, class_id: 'c1' }],
      classes: [{ id: 'c1', name: 'Chemistry', subject: 'Science' }],
    });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', optsFor(`was josephine present ${PM} 9`));
    const out = answer(app);
    ok('it says she was in school', /was in school on/.test(out));
    ok('  and that she still missed the lesson', /marked absent in/.test(out) && /Chemistry/.test(out));
    ok('  so it is not reported as a plain Yes', !/Yes —/.test(out));
  }

  console.log('\n== an empty day is not a month ==\n');

  {
    const app = makeApp({ daily: [], classy: [] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', optsFor(`was josephine present ${PM} 9`));
    const out = answer(app);
    ok('it says nothing is recorded', /Nothing is recorded/.test(out));
    ok('  names the day', out.includes(`${PM} 9`));
    ok('  and explains the two reasons that is possible', /no register was taken/.test(out));
    // THE WIDENING. It used to answer with the last 30 days instead.
    ok('  without answering a different question', !/last 30 days/.test(out));
    check('  and without a second round trip',
          app.asked.filter(a => a.table === 'daily_attendance').length, 1);
  }

  console.log('\n== the wide view counts days, not register rows ==\n');

  {
    // One day off school: one daily row, three lesson rows. Counted flat that
    // is four absences and a 0% attendance record.
    const d = `${pastYear}-${P2}-09`;
    const app = makeApp({
      daily: [{ status: 'absent', date: d }, { status: 'present', date: `${pastYear}-${P2}-10` }],
      classy: [{ status: 'absent', date: d, class_id: 'c1' },
               { status: 'absent', date: d, class_id: 'c2' },
               { status: 'absent', date: d, class_id: 'c3' },
               { status: 'present', date: `${pastYear}-${P2}-10`, class_id: 'c1' }],
      classes: [{ id: 'c1', name: 'Chemistry' }, { id: 'c2', name: 'Maths' }, { id: 'c3', name: 'Art' }],
    });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', {});
    const out = answer(app);
    check('two days, not five rows', /(\d+) days? recorded/.exec(out)?.[1], '2');
    ok('  one absent', /❌ 1 absent/.test(out));
    ok('  one present', /✅ 1 present/.test(out));
    ok('  so the percentage is halves, not fifths', /50% present/.test(out));
    ok('  and a whole-school absence says which register it came from', /school day/.test(out));
  }

  {
    // The wide view still widens when the window it was given is empty — that
    // behaviour is fine there, and it announces itself.
    const src = html.slice(html.indexOf('async terminalShowAttendance'));
    const body = src.slice(0, src.indexOf('async terminalShowClassAttendance'));
    ok('a range still falls back to 30 days', /here's the last 30 days instead/.test(body));
    ok('  but only when the question was not about one day',
       /if \(oneDay\)[\s\S]{0,700}?if \(opts\.sinceDate\)/.test(body));
  }

  console.log('\n== and it answers in a bubble like everything else ==\n');

  {
    const app = makeApp({ daily: [{ status: 'present', date: THE_9TH }] });
    await app.terminalShowAttendance.call(app, 'Josephine Wexler', {});
    ok('the wide view goes through _showRivenMessage', app.said.length > 0);
    // It used to do output.innerHTML += html, which re-parses the whole
    // transcript to append one answer.
    const src = html.slice(html.indexOf('async terminalShowAttendance'));
    const body = src.slice(0, src.indexOf('async terminalShowClassAttendance'));
    // Comments stripped: one of them names the old pattern on purpose, and an
    // assertion that a comment can satisfy is not an assertion.
    const code = body.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    ok('  and never appends to the transcript container', !/output\.innerHTML/.test(code));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
