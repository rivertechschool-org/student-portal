// Wasteland Adventure: travel-time answers are times, not rounded whole hours.
//
// Reported 2026-10-16: "travel time question said a distance and traveling x
// speed, how many hours, and required a round to a whole number to get it
// right instead of doing the decimal or making it hr+min".
//
// The walk home keyed Math.ceil(distance / 3), so 10 km at 3 km/h only took 4,
// and its number box could not hold "3 h 20 min". The rate_time challenge
// compared text exactly, so "1 1/2" or "1 h 30 min" failed for 1.5. Both now
// read the answer with parseHoursAnswer and compare by value.
//
// Run: node tests/wasteland-travel-time.test.js

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'wasteland_adventure.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail !== undefined ? '\n        ' + detail : ''}`); }
};

const src = html.match(/function parseHoursAnswer[\s\S]*?\n        }\n/);
ok('parseHoursAnswer exists', !!src);
const parse = new Function(src[0] + ';return parseHoursAnswer')();
const near = (a, b) => Math.abs(a - b) < 0.05;

for (const [t, h] of [['3.33', 10 / 3], ['3.3', 10 / 3], ['3 h 20 min', 10 / 3], ['3 hours and 20 minutes', 10 / 3],
                      ['3:20', 10 / 3], ['200 min', 10 / 3], ['3 1/3', 10 / 3], ['10/3', 10 / 3],
                      ['1.5', 1.5], ['1 1/2', 1.5], ['1 h 30 min', 1.5], ['90 minutes', 1.5], ['2.5 hours', 2.5]]) {
  ok(`"${t}" reads as ${h.toFixed(2)} h`, near(parse(t), h), parse(t));
}
ok('a rounded-up 4 is not 3 h 20 min', !near(parse('4'), 10 / 3));
ok('3.4 is not 3 h 20 min', !near(parse('3.4'), 10 / 3));
ok('words are not a time', Number.isNaN(parse('abc')) && Number.isNaN(parse('')));

ok('the walk home no longer rounds up', !/Math\.ceil\(distance \/ speed\)/.test(html) && /answer = distance \/ speed;/.test(html));
ok('the walk home asks for a time and takes text', /timeAnswer: \['3', '4'\]\.includes\(grade\)/.test(html) &&
   /calcInput\.type = options\.timeAnswer \? 'text' : 'number'/.test(html));
ok('rate_time compares by value', /challengeType === 'rate_time'\s*\?\s*Math\.abs\(parseHoursAnswer\(selectedAnswer\)/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
