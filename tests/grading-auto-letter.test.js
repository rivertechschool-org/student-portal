// Points grading: the letter follows the points, until the teacher picks one.
//
// Teachers grading in points had to set the letter by hand as well, so 9 of
// 10 could go in with a blank or a stale letter. Now typing the points fills
// the letter from the school scale (A- for 90%), a letter the teacher picks
// themselves is kept through later changes to the points, and "Use <letter>"
// hands it back. Picking the worked-out letter again counts as handing it
// back, so "overridden" always means "differs from what the points give".
//
// The full journeys, including category rubrics, are in
// debug-tools/grading-rubric-journeys.mjs (needs Chromium).
//
// Run: node tests/grading-auto-letter.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function extract(name) {
  const re = new RegExp('\\n {4,6}(?:async\\s+)?' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length - 1, pd = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') pd++;
    else if (html[i] === ')') { pd--; if (pd === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, i).trim();
  i = html.indexOf('{', i);
  const start = i;
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  return new Function(args, html.slice(start + 1, i - 1));
}

// A points box and a letter box, as the grading modals draw them.
function makePage(max, { letter = '', override = '0' } = {}) {
  const els = {
    pts: { value: '', getAttribute: (k) => (k === 'max' ? String(max) : null) },
    letter: { value: letter, dataset: { override } },
    'letter-auto-hint': { innerHTML: '' },
  };
  global.document = { getElementById: (id) => els[id] || null };
  const app = {};
  for (const n of ['calculateLetterGrade', '_letterForPoints', 'syncLetterFromPoints',
                   'letterGradeEdited', 'useAutoLetter', '_renderLetterHint']) app[n] = extract(n);
  const typePts = (v) => { els.pts.value = String(v); app.syncLetterFromPoints('pts', 'letter'); };
  const typeLetter = (v) => { els.letter.value = v; app.letterGradeEdited('pts', 'letter'); };
  return { app, els, typePts, typeLetter, hint: () => els['letter-auto-hint'].innerHTML };
}

console.log('\n== the points fill the letter ==\n');
{
  const p = makePage(10);
  p.typePts(9);
  check('9 of 10 is A-', p.els.letter.value, 'A-');
  ok('  and the hint says it was worked out', /Worked out from the points: 90%/.test(p.hint()));
  p.typePts(10); check('10 of 10 is A+', p.els.letter.value, 'A+');
  p.typePts(8.5); check('half points: 8.5 of 10 is B', p.els.letter.value, 'B');
  p.typePts(5); check('5 of 10 is F', p.els.letter.value, 'F');
  p.typePts(6.9); check('no D+: 6.9 of 10 is D', p.els.letter.value, 'D');
  p.typePts(6); check('no D-: 6 of 10 is D', p.els.letter.value, 'D');
}
{
  const p = makePage(20);
  p.typePts(17);
  check('the max is the box\'s own (17 of 20 is B)', p.els.letter.value, 'B');
}
{
  const p = makePage(10, { letter: 'B' });
  p.els.pts.value = '';
  p.app.syncLetterFromPoints('pts', 'letter');
  check('no points yet: the letter is left alone', p.els.letter.value, 'B');
  check('  and there is no hint', p.hint(), '');
}
{
  const p = makePage(0);
  p.typePts(5);
  check('a 0-point assignment gives no letter rather than Infinity%', p.els.letter.value, '');
}

console.log('\n== the teacher can override it ==\n');
{
  const p = makePage(10);
  p.typePts(9);
  p.typeLetter('B+');
  check('typing a different letter marks it overridden', p.els.letter.dataset.override, '1');
  ok('  and the hint offers the worked-out one back', /Your choice\. The points work out to <strong>A-<\/strong>/.test(p.hint()) && /Use A-/.test(p.hint()));
  p.typePts(7);
  check('the override survives new points', p.els.letter.value, 'B+');
  ok('  while the hint follows them', /work out to <strong>C-<\/strong>/.test(p.hint()));
  p.app.useAutoLetter('pts', 'letter');
  check('"Use" hands it back to the points', [p.els.letter.value, p.els.letter.dataset.override], ['C-', '0']);
  p.typePts(9.5);
  check('  which then follow again', p.els.letter.value, 'A');
}
{
  const p = makePage(10);
  p.typePts(9);
  p.typeLetter('a-');
  check('typing the worked-out letter (any case) is not an override', p.els.letter.dataset.override, '0');
}
{
  const p = makePage(10, { letter: 'A', override: '1' });
  p.typePts(8);
  check('a letter that opens as overridden is kept', p.els.letter.value, 'A');
}

console.log('\n== wired into the screens ==\n');
const near = (needle, also, span = 900) => {
  const i = html.indexOf(needle);
  return i >= 0 && also.every(a => html.slice(i - span, i + span).includes(a));
};
ok('Grade Submission: points fill the letter',
   near('id="points-earned"', ["app.syncLetterFromPoints('points-earned', 'letter-grade')"]));
ok('  and a typed letter is noticed',
   near('id="letter-grade"', ["app.letterGradeEdited('points-earned', 'letter-grade')"]));
ok('Missing / in-class: points fill the dropdown',
   near('id="grade-score"', ["app.syncLetterFromPoints('grade-score', 'grade-letter')"]));
{
  const i = html.indexOf('<select id="grade-letter"');
  const sel = html.slice(i, html.indexOf('</select>', i));
  ok('  and the dropdown has D, and no D+ or D- (the school does not use them)',
     /value="D"/.test(sel) && !/value="D\+"/.test(sel) && !/value="D-"/.test(sel));
}
ok('Rubric manual override: points fill the letter',
   (html.match(/app\.syncLetterFromPoints\('manual-points', 'manual-letter-grade'\)/g) || []).length === 2);
{
  const i = html.indexOf('async saveGradebook()');
  const body = html.slice(i, html.indexOf('closeGradebook()', i));
  ok('the Gradebook grid writes the letter with the points',
     /submissionData\.grade = window\.app\.calculateLetterGrade\(change\.points_earned \/ change\.max_points \* 100\)/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
