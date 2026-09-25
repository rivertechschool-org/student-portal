// "Apply to Present" on the class Award RTC screen.
//
// The teacher sets an amount and gives it to everyone in the room today. Who
// is "in the room" comes from the class register when it has been taken, and
// from the daily register until then.
//
// Rules, each one a way of paying the wrong child:
//
//   * THE CLASS REGISTER WINS ONCE TAKEN. The daily register says the child
//     came to school, not that they came to this lesson.
//   * A CLASS THAT MEETS TWICE READS THE LATER LESSON.
//   * A ROW THE CLASS REGISTER SKIPPED FALLS BACK TO THE DAY, instead of
//     counting as absent.
//   * NOT MARKED IS NOT PRESENT. Nobody said they were here.
//   * LATE AND LEFT EARLY ARE PRESENT; absent and excused are not.
//   * EVERYONE NOT PRESENT IS SET TO 0, so "Apply to All" followed by
//     "Apply to Present" does not leave absent children filled in.
//
// Run: node tests/rtc-apply-present.test.js

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

function method(name, indent = '      ') {
  for (const sig of [`\n${indent}async ${name}(`, `\n${indent}${name}(`]) {
    const start = html.indexOf(sig);
    if (start === -1) continue;
    const end = html.indexOf(`\n${indent}}\n`, start);
    if (end === -1) throw new Error(name + ' unterminated');
    const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
    const isAsync = body.startsWith('async ');
    const src = isAsync ? body.slice('async '.length) : body;
    return eval(`(${isAsync ? 'async ' : ''}function ${src.slice(name.length)})`);
  }
  throw new Error(name + ' not found');
}

const app = {
  _rtcPresentFrom: method('_rtcPresentFrom'),
  _rtcPresenceLabel: method('_rtcPresenceLabel'),
  setPresentRTCAmounts: method('setPresentRTCAmounts'),
  updateRTCSummary() { this.summaryCalls = (this.summaryCalls || 0) + 1; },
};
const sorted = (set) => [...set].sort();

// ---- which register ---------------------------------------------------
{
  const r = app._rtcPresentFrom([], [
    { student_id: 'a', status: 'present' },
    { student_id: 'b', status: 'absent' },
    { student_id: 'c', status: 'late' },
    { student_id: 'd', status: 'excused' },
    { student_id: 'e', status: 'left_early' },
    { student_id: 'f', status: 'late_left_early' },
  ]);
  check('class not taken: daily register is used', r.source, 'daily');
  check('late / left early count as present; absent, excused do not', sorted(r.present), ['a', 'c', 'e', 'f']);
  check('everyone on the day is marked', r.marked.size, 6);
}
{
  const r = app._rtcPresentFrom(
    [{ student_id: 'a', period: 2, status: 'absent' }, { student_id: 'b', period: 2, status: 'present' }],
    [{ student_id: 'a', status: 'present' }, { student_id: 'b', status: 'absent' }]);
  check('class taken: class register beats the day', r.source, 'class');
  check('class taken: present is what the lesson says', sorted(r.present), ['b']);
}
{
  const r = app._rtcPresentFrom(
    [{ student_id: 'a', period: 1, status: 'present' }, { student_id: 'a', period: 5, status: 'absent' },
     { student_id: 'b', period: 5, status: 'present' }, { student_id: 'b', period: 1, status: 'absent' }],
    []);
  check('meets twice: the later lesson decides', sorted(r.present), ['b']);
}
{
  const r = app._rtcPresentFrom(
    [{ student_id: 'a', period: 3, status: 'present' }],
    [{ student_id: 'b', status: 'present' }, { student_id: 'c', status: 'absent' }]);
  check('skipped class row falls back to the day', sorted(r.present), ['a', 'b']);
  check('fallbacks are counted', r.fromDay, 2);
  check('unmarked student is not marked', r.marked.has('z'), false);
}
{
  const r = app._rtcPresentFrom([], []);
  check('nothing taken: no source', r.source, null);
  check('nothing taken: nobody present', r.present.size, 0);
  check('label says so', /No attendance taken/.test(app._rtcPresenceLabel(r, 5)), true);
  check('load failure label', /Couldn't load/.test(app._rtcPresenceLabel(null, 5)), true);
  check('daily label names the fallback',
    /Class attendance not taken yet/.test(app._rtcPresenceLabel(app._rtcPresentFrom([], [{ student_id: 'a', status: 'present' }]), 3)), true);
}

// ---- filling the amounts -----------------------------------------------
function dom(ids, setAll) {
  const rows = ids.map(id => {
    const input = { value: '0' };
    return { dataset: { studentId: id }, input, querySelector: () => input };
  });
  global.document = {
    getElementById: (id) => id === 'rtc-bulk-set-all' ? { value: setAll } : null,
    querySelectorAll: () => rows,
  };
  return rows;
}
{
  const rows = dom(['a', 'b', 'c'], '7');
  rows.forEach(r => { r.input.value = '10'; });            // "Apply to All" pressed first
  app._rtcPresence = app._rtcPresentFrom([], [{ student_id: 'a', status: 'present' }, { student_id: 'b', status: 'absent' }]);
  app.setPresentRTCAmounts();
  check('present get the amount; absent and unmarked go to 0', rows.map(r => r.input.value), ['7', '0', '0']);
  check('summary refreshed', app.summaryCalls, 1);
}
{
  const rows = dom(['a'], '7');
  app._rtcPresence = app._rtcPresentFrom([], []);
  app.setPresentRTCAmounts();
  check('nobody present: nothing is touched', rows[0].input.value, '0');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
