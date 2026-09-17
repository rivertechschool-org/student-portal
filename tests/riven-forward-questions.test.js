// "Who is missing next week" is not a question the register can answer.
//
// WHAT HAPPENED
//
// "/admin who is missing next week?" came back "16 away from school · 1 in
// school but missed a class (school-wide, today)" — today's register, for a
// question about a week that has not happened. The window was disclosed, as
// the word "today" in grey at the end of the headline, which reads as part of
// the answer rather than as a correction to the question.
//
// TWO FAULTS
//
// 1. VIEW_PLANNED_ABSENCES already existed, weighted 7 against ATTENDANCE_ISSUES'
//    5, and would have won — except its two "who is …" patterns listed
//    out/away/absent/gone and not MISSING. So nothing matched, and the
//    aggregate attendance pattern (`who … missing`) took it.
//
// 2. Nothing stood behind the matcher. A phrasing nobody has thought of yet
//    still lands on the register and still gets answered about today.
//
// THE FIX HAS BOTH LAYERS, and this file asserts both, because the first one
// only covers the sentences we have already seen.
//
// _rivenForwardWindow is the mirror of _rivenPastDate and stays separate from
// it for the same reason: a date in a question about the past means the most
// recent one, a date in a question about the future means the next one.
//
// Run: node tests/riven-forward-questions.test.js

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

// The whole call graph. _rivenForwardWindow leans on the local-date helper and
// on the forward-reading month parser, and a stub for either would be testing
// the stub.
const app = {};
app._rivenPointsForward = extract('_rivenPointsForward');
app._rivenForwardWindow = extract('_rivenForwardWindow');
app._isoDaysAgo = extract('_isoDaysAgo');
app._rivenMonthDayDates = extract('_rivenMonthDayDates');
app._rivenMonthIndex = extract('_rivenMonthIndex');
app._rivenPastDate = extract('_rivenPastDate');

const fwd = (t) => app._rivenPointsForward.call(app, t);
const win = (t) => app._rivenForwardWindow.call(app, t);
const at = (n) => app._isoDaysAgo.call(app, -n);
const TODAY = app._isoDaysAgo.call(app, 0);

(async () => {

  console.log('\n== which sentences point forward ==\n');

  for (const t of ['who is missing next week', "who's out tomorrow", 'anyone away next month',
                   'upcoming absences', "who's gone next monday", 'who will be out',
                   'any absences coming up', 'who is going to be away next week']) {
    ok(`"${t}"`, fwd(t));
  }
  for (const t of ['who was missing', 'who is missing', 'who was absent last week',
                   'attendance problems', 'who has been absent a lot',
                   'who was missing September 14th', 'anyone absent this week']) {
    check(`"${t}" does not`, fwd(t), false);
  }
  // "this week" is deliberately not a forward cue — the comment on the intent
  // says so, and this is the assertion that keeps it true.
  check('"anyone absent this week" stays with the register', fwd('anyone absent this week'), false);

  console.log('\n== the window it means ==\n');

  {
    const w = win('who is missing next week');
    ok('next week is seven days', !!w && w.from < w.to);
    check('  seven of them', Math.round((new Date(w.to) - new Date(w.from)) / 86400000), 6);
    ok('  starting after today', w.from > TODAY);
    ok('  on a Monday', new Date(w.from + 'T12:00:00Z').getUTCDay() === 1);
    ok('  and it says which days it means', /next week \(/.test(w.label));
  }
  {
    // Said ON a Monday, "next week" is still the one coming, not this one.
    const dow = new Date().getDay();
    const w = win('who is out next week');
    ok('never starts today, whatever day it is asked', w.from !== TODAY);
    ok(`  (asked on day ${dow})`, w.from > TODAY);
  }
  {
    const w = win("who's out tomorrow");
    check('tomorrow is one day', [w.from, w.to], [at(1), at(1)]);
    ok('  and says the date', /tomorrow \(/.test(w.label));
  }
  {
    const w = win('anyone away next month');
    ok('next month starts on the 1st', /-01$/.test(w.from));
    ok('  and ends on its last day', /-(28|29|30|31)$/.test(w.to));
    ok('  and is named', /next month \(/.test(w.label));
  }
  {
    const w = win('who is out next friday');
    ok('a named weekday is one day', w.from === w.to);
    ok('  in the future', w.from > TODAY);
    check('  and it is a Friday', new Date(w.from + 'T12:00:00Z').getUTCDay(), 5);
  }
  check('no forward words, no window', win('who was missing yesterday'), null);

  console.log('\n== forwards and backwards read the same date differently ==\n');

  {
    // The whole reason there are two readers. A month still ahead of us:
    // the question about the past means last year, the question about the
    // future means this year.
    const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
    const ahead = MN[new Date().getMonth() === 11 ? 0 : new Date().getMonth() + 1];
    const back = app._rivenPastDate.call(app, `who was missing ${ahead} 5`);
    const forward = win(`who is out ${ahead} 5`);
    ok('the backward reader lands before today', back.sinceDate < TODAY);
    ok('the forward reader lands after it', forward.from > TODAY);
    ok('  which is the point of keeping them apart', back.sinceDate !== forward.from);
  }

  console.log('\n== the pattern that missed "missing" ==\n');

  {
    // Asserted on BEHAVIOUR, not on the text of a pattern.
    //
    // This block used to slice the source at the first `intent:
    // 'VIEW_PLANNED_ABSENCES'` and read the regexes there. That stopped being
    // the decision the day _rivenAttendanceQuestion was added — the slice
    // started landing inside that method's own return statement, and the
    // assertions failed while the behaviour was correct. Which is the argument
    // against source-text assertions generally: they go stale pointing at the
    // wrong layer, and say "broken" when the answer is right.
    const decide = extract('_rivenAttendanceQuestion');
    const someone = { student: { student: { id: 'x', full_name: 'Willow Fenmore' }, score: 1 } };
    const route = (t, e) => decide.call(app, t, e || {})?.intent || null;

    check('the sentence from the screenshot', route('who is missing next week'), 'VIEW_PLANNED_ABSENCES');
    check('  said as "anyone"', route('anyone missing next week'), 'VIEW_PLANNED_ABSENCES');
    check('  said as "out"', route('whos out next week'), 'VIEW_PLANNED_ABSENCES');
    check('  and about one person', route('will willow be missing next week', someone), 'VIEW_PLANNED_ABSENCES');
    // The same shapes pointing backwards still belong to the register.
    check('backwards, everyone', route('who was missing yesterday'), 'ATTENDANCE_ISSUES');
    check('backwards, one person', route('was willow here yesterday', someone), 'VIEW_ATTENDANCE');
  }

  console.log('\n== and a net behind the matcher ==\n');

  {
    const src = html.slice(html.indexOf("case 'ATTENDANCE_ISSUES':"));
    const body = src.slice(0, src.indexOf("case 'BALANCE_AT':"));
    ok('the register case checks first whether the question points forward',
       /_rivenPointsForward[\s\S]{0,200}terminalShowPlannedAbsences/.test(body));
    // It has to come BEFORE the today-default, or the default wins and the
    // answer is labelled "today" again.
    const iFwd = body.indexOf('_rivenPointsForward');
    const iToday = body.indexOf("sinceLabel = 'today'");
    ok('  before anything defaults the window to today', iFwd > -1 && iFwd < iToday);
  }

  console.log('\n== the planned list narrows to what was asked ==\n');

  {
    const show = extract('terminalShowPlannedAbsences');
    const mk = (rows) => {
      const a = {
        said: [], errors: [],
        escapeHtml: (t) => String(t == null ? '' : t),
        _showRivenMessage(h) { a.said.push(h); },
        terminalPrintError(m) { a.errors.push(m); },
        _localDateStr: () => TODAY,
        _isoDaysAgo: app._isoDaysAgo,
        _rivenPointsForward: app._rivenPointsForward,
        _rivenForwardWindow: app._rivenForwardWindow,
        _rivenMonthDayDates: app._rivenMonthDayDates,
        _rivenMonthIndex: app._rivenMonthIndex,
        _rivenResolvedStudent: () => null,
        _briefingExpand: extract('_briefingExpand'),
        async _fetchPlannedAbsences() { return rows; },
      };
      a.terminalShowPlannedAbsences = show;
      return a;
    };
    const w = win('who is missing next week');

    {
      const a = mk([
        { student_id: 'a', student_name: 'Next Week Pupil', start_date: w.from, end_date: w.to, reason: 'trip' },
        { student_id: 'b', student_name: 'Far Future Pupil', start_date: at(90), end_date: at(92), reason: 'wedding' },
      ]);
      await a.terminalShowPlannedAbsences.call(a, { normalized: 'who is missing next week' });
      const out = a.said.join('\n');
      ok('the one in the window is listed', /Next Week Pupil/.test(out));
      ok('  and the one three months out is not', !/Far Future Pupil/.test(out));
      ok('  with the window named in the heading', /Away next week/.test(out));
    }

    {
      // Overlap, not containment: a trip that starts before the window and
      // runs into it is somebody who is away next week.
      const a = mk([{ student_id: 'c', student_name: 'Straddler', start_date: TODAY, end_date: w.to }]);
      await a.terminalShowPlannedAbsences.call(a, { normalized: 'who is missing next week' });
      ok('a stretch running into the window counts', /Straddler/.test(a.said.join('\n')));
    }

    {
      // The claim has to match the question. "Nobody is away" and "nobody is
      // away next week" are different claims and only one of them is true.
      const a = mk([{ student_id: 'b', student_name: 'Far Future Pupil', start_date: at(90), end_date: at(92) }]);
      await a.terminalShowPlannedAbsences.call(a, { normalized: 'who is missing next week' });
      const out = a.said.join('\n');
      ok('an empty window says which window', /next week/.test(out));
      ok('  and does not claim nobody is away at all', !/^Nobody is down as away\./m.test(out));
      ok('  it says how many are further out', /1 further out/.test(out));
    }

    {
      // No window asked for: the whole list, as before.
      const a = mk([{ student_id: 'b', student_name: 'Far Future Pupil', start_date: at(90), end_date: at(92) }]);
      await a.terminalShowPlannedAbsences.call(a, { normalized: 'upcoming absences' });
      const out = a.said.join('\n');
      ok('a general question still gets the whole list', /Far Future Pupil/.test(out));
      ok('  under the old heading', /Upcoming absences/.test(out));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
