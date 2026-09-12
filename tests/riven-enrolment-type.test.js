// "Is Jonathan a full time or homeschool student?"
//
// Riven answered that with "I found 3 classes that could match" and a picker.
//
// WHY IT DID
//
// "Homeschool" is two things at this school at once. It is the enrolment type
// of 36 of the 138 students on the roll, and it is a cohort qualifier inside
// four class names ("Creative Writing - Older Homeschool"). Class matching
// takes ANY distinctive word of four letters or more as partial evidence, so a
// bare "homeschool" matched all four classes, the question became ambiguous,
// and the picker is what ambiguity looks like.
//
// The fix has two halves, and this file covers both:
//
//   * the bare word no longer stands in for a class. It is dropped from class
//     NAME words, which costs nothing - "older homeschool" still resolves on
//     "older", "Film - Homeschoolers" on "film" - and stops the word alone
//     naming a class nobody mentioned. (The intent routing for this is in
//     debug-tools/nlp-stress.js, where the class list carries the real names.)
//   * the question now has an answer. Enrolment is a property of the student,
//     so ENROLLMENT_TYPE reads it off the profile, and ENROLLMENT_COUNTS
//     answers the same question about the whole school.
//
// The rule both executors follow: never guess the type. The difference between
// full-time and homeschool is a fee arrangement, and an empty column reported
// as "full-time" is a wrong number quoted to a parent.
//
// Run: node tests/riven-enrolment-type.test.js

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

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function makeApp({ profile, schedule = [], roster = null, profileError = null }) {
  const app = {
    said: [],
    errors: [],
    escapeHtml: esc,
    _showRivenMessage(html) { app.said.push(html); },
    terminalPrintError(m) { app.errors.push(m); },
    _rivenResolvedStudent: (e) => e?.student?.student || e?.student || null,
    auth: {
      supabase: {
        from(table) {
          const q = {
            select() { return q; },
            eq() { return q; },
            single() {
              return Promise.resolve({ data: profile, error: profileError });
            },
            then(res, rej) {
              const data = table === 'student_schedule' ? schedule : roster;
              return Promise.resolve({ data, error: null }).then(res, rej);
            },
          };
          return q;
        },
      },
    },
  };
  app.terminalEnrollmentType = extract('terminalEnrollmentType');
  app.terminalEnrollmentCounts = extract('terminalEnrollmentCounts');
  return app;
}

const WHO = { student: { student: { id: 's1', full_name: 'Jonathan Smith' } } };

(async () => {

  console.log('\n== one student ==\n');

  {
    const app = makeApp({
      profile: { enrollment_type: 'full-time', grade_level: '7' },
      schedule: [1, 2, 3, 4, 5].map(d => ({ day_of_week: d })),
    });
    await app.terminalEnrollmentType.call(app, WHO);
    const out = app.said[0];
    ok('it names the student', /Jonathan Smith/.test(out));
    ok('  and answers the actual question', /full-time/.test(out));
    // Five weekdays read as a phrase, not a list nobody wanted.
    ok('a full week is said as a week', /every weekday/.test(out));
    ok('no class picker anywhere near it', !/could match/.test(out));
  }

  {
    const app = makeApp({
      profile: { enrollment_type: 'homeschool', grade_level: '9' },
      schedule: [{ day_of_week: 2 }, { day_of_week: 4 }],
    });
    await app.terminalEnrollmentType.call(app, WHO);
    const out = app.said[0];
    ok('a homeschool student is reported as one', /homeschool/.test(out));
    // Which is what the label MEANS here: the days they are actually in.
    ok('  with the days they come in', /Tuesday, Thursday/.test(out));
  }

  {
    // The whole point of not guessing.
    const app = makeApp({
      profile: { enrollment_type: null, grade_level: '5' },
      schedule: [{ day_of_week: 1 }],
    });
    await app.terminalEnrollmentType.call(app, WHO);
    const out = app.said[0];
    ok('an empty column is reported as empty', /no enrolment type set/.test(out));
    ok('  and never guessed as full-time', !/is <b>full-time/.test(out));
    ok('  while still saying what is known', /Monday/.test(out));
  }

  {
    const app = makeApp({
      profile: { enrollment_type: 'homeschool', grade_level: '9' },
      schedule: [],
    });
    await app.terminalEnrollmentType.call(app, WHO);
    ok('a student with no attending days is flagged, not left blank',
      /No attending days are set/.test(app.said[0]));
  }

  {
    const app = makeApp({ profile: { enrollment_type: 'full_time' }, schedule: [] });
    await app.terminalEnrollmentType.call(app, WHO);
    ok('an underscore spelling still reads as full-time', /full-time/.test(app.said[0]));
  }

  {
    const app = makeApp({ profile: null, profileError: new Error('nope') });
    await app.terminalEnrollmentType.call(app, WHO);
    check('a failed read says so rather than inventing a type', app.said, []);
    ok('  naming the student', /Jonathan Smith/.test(app.errors[0]));
  }

  {
    const app = makeApp({ profile: {} });
    await app.terminalEnrollmentType.call(app, {});
    check('with nobody named it asks', app.said, []);
    ok('  and shows how to ask', /is jonathan full time or homeschool/.test(app.errors[0]));
  }

  console.log('\n== the whole school ==\n');

  {
    const app = makeApp({
      profile: {},
      roster: [
        { enrollment_type: 'full-time', student_status: 'active' },
        { enrollment_type: 'full-time', student_status: null },
        { enrollment_type: 'homeschool', student_status: 'active' },
        { enrollment_type: null, student_status: 'active' },
        // Left the school: counting them answers a question nobody asked.
        { enrollment_type: 'homeschool', student_status: 'past' },
      ],
    });
    await app.terminalEnrollmentCounts.call(app);
    const out = app.said[0];

    ok('it counts who is still on the roll', /4 on the roll/.test(out));
    ok('  full-time', /<b>2<\/b> full-time/.test(out));
    ok('  homeschool', /<b>1<\/b> homeschool/.test(out));
    // Folding these into full-time is how a wrong number reaches a parent.
    ok('  and reports the unrecorded separately', /<b>1<\/b> with no type recorded/.test(out));
    ok('a past student is not counted', !/<b>2<\/b> homeschool/.test(out));
    ok('full-time is listed before homeschool',
      out.indexOf('full-time') < out.indexOf('homeschool'));
  }

  {
    const app = makeApp({ profile: {}, roster: [] });
    await app.terminalEnrollmentCounts.call(app);
    ok('an empty roll says so', /No students on the roll/.test(app.said[0]));
  }

  console.log('\n== the word stops standing in for a class ==\n');

  {
    // The class matcher drops it from class NAME words. Everything else about
    // those names still matches, which is why this is safe.
    const generic = html.slice(html.indexOf('const genericWords = new Set('));
    const line = generic.slice(0, generic.indexOf(');') + 2);
    ok('homeschool is not class-name evidence', /'homeschool'/.test(line));
    ok('  nor its plural', /'homeschoolers'/.test(line));
    ok('  nor the -er form', /'homeschooler'/.test(line));
    // "grade" was already there for the same reason: a word that appears in
    // names but carries no identity.
    ok('  alongside the words that were already generic', /'grade'/.test(line));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
