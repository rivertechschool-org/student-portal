// Reading one chart in any key.
//
// A chart is stored ONCE, as scale degrees written inline in the lyric, and
// drawn in whichever key the band is in. The alternative - twelve transposed
// copies per song - is twelve chances to edit the wrong one.
//
// Three things have to hold, and all three are the kind of wrong that a
// musician spots from the platform and a test spots first:
//
//   * SPELLING FOLLOWS THE KEY, not the pitch. The 4 chord in Eb is Ab, never
//     G#. Same key, same black note, and one of those is unreadable on a
//     stand in a dark room.
//   * QUALITY COMES FROM THE SCALE. 1, 4 and 5 are major; 2, 3 and 6 minor;
//     7 diminished. "maj" in the chart overrides that for a borrowed chord.
//     A 6 drawn as major turns every chorus sour.
//   * A DIGIT IS A CHORD, A LETTER IS A LYRIC. "1mountain" is the 1 chord over
//     the word "mountain" - not a 1m chord, and not a lyric that starts with a
//     number. Songs in the library depend on both readings.
//
// Run: node tests/worship-chart-transpose.test.js

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'portal', 'worship.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- lift the engine out of the page -----------------------------------
function grab(startMarker, endMarker) {
  const a = page.indexOf(startMarker);
  const b = page.indexOf(endMarker, a);
  if (a === -1 || b === -1) throw new Error('could not find ' + startMarker);
  return page.slice(a, b);
}
// Everything from the key tables down to the end of renderChart.
const engine = grab('const KEY_SCALES = {', '// A pill is a button');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx = {};
// renderChart escapes through the page's own esc(), so hand it the same one.
new Function('ctx', 'esc', engine + `
  Object.assign(ctx, { KEYS, KEY_SCALES, normaliseKey, chordFor, parseChartLine, renderChartLine, renderChart });
`)(ctx, esc);
const { KEYS, normaliseKey, chordFor, parseChartLine, renderChartLine, renderChart } = ctx;

// ======================================================================
// 1. Twelve keys, spelled the way that key is written
// ======================================================================
check('twelve keys offered', KEYS.length, 12);

const degrees = key => [1, 2, 3, 4, 5, 6, 7].map(d => chordFor(d, false, key));

check('C  is the plain one', degrees('C'), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
check('G  has one sharp',    degrees('G'), ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim']);
check('Eb spells flats',     degrees('Eb'), ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim']);
check('E  spells sharps',    degrees('E'), ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim']);
check('Db keeps its flats',  degrees('Db'), ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim']);

// The rule that makes a chart readable rather than merely correct.
check('the 4 of Eb is Ab, not G#', chordFor(4, false, 'Eb'), 'Ab');
check('the 3 of E is G#m, not Abm', chordFor(3, false, 'E'), 'G#m');
ok('no key mixes sharps and flats',
  KEYS.every(k => {
    const d = degrees(k).join('');
    return !(d.includes('#') && d.includes('b'));
  }));

// "maj" is how a borrowed major gets written - the III of "He Reigns".
check('3 is minor by default', chordFor(3, false, 'C'), 'Em');
check('3maj is major', chordFor(3, true, 'C'), 'E');
check('6maj too', chordFor(6, true, 'G'), 'E');

// What people type when they mean one of the twelve.
check('C# is read as Db', normaliseKey('C#'), 'Db');
check('A# is read as Bb', normaliseKey('A#'), 'Bb');
check('a key already spelled right is left alone', normaliseKey('Eb'), 'Eb');
check('lower case is fine', normaliseKey('eb'), 'Eb');
check('nothing is nothing', normaliseKey(''), null);
check('nonsense is nothing', normaliseKey('banana'), null);

// ======================================================================
// 2. A digit is a chord, a letter is a lyric
// ======================================================================
const line = (l, k) => parseChartLine(l, k);

let r = line('He 1picked me up, and 2turned me around', 'C');
check('the lyric keeps every letter', r.text, 'He picked me up, and turned me around');
check('  and the chords come out', r.chords.map(c => c.name), ['C', 'Dm']);
check('  above the right words', [r.text.slice(r.chords[0].at, r.chords[0].at + 6),
                                  r.text.slice(r.chords[1].at, r.chords[1].at + 6)], ['picked', 'turned']);

// The one that bit: a word beginning with m is not a minor chord.
r = line('4Praise on the 1mountain', 'G');
check('"1mountain" is the 1 chord over a word', r.text, 'Praise on the mountain');
check('  not a 1m chord', r.chords.map(c => c.name), ['C', 'G']);

r = line('This weary 4soul, this bag of bo1nes', 'C');
check('a chord can land mid-word', r.text, 'This weary soul, this bag of bones');
check('  splitting the syllable where it falls', r.text.slice(r.chords[1].at), 'nes');

// Slash chords name a bass NOTE: the lower degree carries no quality.
r = line('And 1/3placed my feet on 4solid ground', 'C');
check('1/3 in C is C/E', r.chords[0].name, 'C/E');
check('  and 4 is still F', r.chords[1].name, 'F');
check('1/3 in Eb is Eb/G', line('1/3x', 'Eb').chords[0].name, 'Eb/G');
check('2/4 keeps the minor on top only', line('2/4x', 'C').chords[0].name, 'Dm/F');

// maj inside a word, as "He Reigns" writes it.
r = line('With 6wis3majdom, power and love', 'C');
check('3maj mid-word: lyric survives', r.text, 'With wisdom, power and love');
check('  and the borrowed major is major', r.chords.map(c => c.name), ['Am', 'E']);

// A line with no digits is pure lyric.
r = line('Who thought I would find you at the lowest place?', 'C');
check('no chords, no changes', [r.text, r.chords.length],
  ['Who thought I would find you at the lowest place?', 0]);

// ======================================================================
// 3. The two-line layout
// ======================================================================
const laid = renderChartLine('He 1picked me up, and 2turned me around', 'C');
check('the lyric line is the words', laid.lyricLine, 'He picked me up, and turned me around');
ok('the chord sits over its word',
  laid.chordLine.indexOf('C') === laid.lyricLine.indexOf('picked'));
ok('  and so does the second', laid.chordLine.indexOf('Dm') === laid.lyricLine.indexOf('turned'));

// Two chords close together must not overwrite one another.
const tight = renderChartLine('1a2b', 'C');
ok('crowded chords are pushed apart, not merged', /C\s+Dm/.test(tight.chordLine));
ok('  and the lyric is untouched', tight.lyricLine === 'ab');

// ======================================================================
// 4. The whole chart
// ======================================================================
const chart = [
  '/V1',
  'I 1call upon Your name',
  'You de5livered me from harm',
  '',
  '/Chorus',
  'You are my 6refuge, my 4strength',
].join('\n');

const html = renderChart(chart, 'E');
ok('sections become headings', html.includes('<div class="chart-section">V1</div>'));
ok('  including the chorus', html.includes('<div class="chart-section">Chorus</div>'));
ok('the slash is not printed', !html.includes('/V1'));
ok('chords are drawn in the chosen key', html.includes('E') && html.includes('B'));
ok('  and the 6 of E is C#m', html.includes('C#m'));
ok('lyrics are there in full', html.includes('call upon Your name'));
ok('a blank line stays a gap', html.includes('height:10px'));

// The same chart in another key is a different set of letters, same words.
const inG = renderChart(chart, 'G');
ok('another key, other letters', inG.includes('Em') && inG.includes('D'));
ok('  same words', inG.includes('livered me from harm'));

// /blank is a spacer the app uses, not a section called "blank".
ok('/blank draws nothing but space', !renderChart('/blank', 'C').includes('blank'));

// Anything a person typed is escaped on the way out.
ok('lyrics are escaped', renderChart('1<script>x', 'C').includes('&lt;script&gt;'));
ok('section names are escaped', renderChart('/<b>V1', 'C').includes('&lt;b&gt;V1'));

// ======================================================================
// 5. Wired into the page
// ======================================================================
// The set list still opens a song in the key it is booked in - but the key no
// longer travels through an inline onclick, because esc() does not make a
// string safe inside one: it turns ' into &#39;, the HTML parser hands the
// decoded quote to the JS parser, and the literal ends early. It rides on a
// data- attribute now, where it is only ever text.
ok('the set list link carries the song', /data-song-id="\$\{esc\(song\.id\)\}"/.test(page));
ok('  and the key it is booked in', /data-song-key="\$\{esc\(l\.song_key\)\}"/.test(page));
ok('  and a listener opens it in that key',
   /closest\('\.song-open'\)[\s\S]{0,240}openSong\(el\.dataset\.songId, el\.dataset\.songKey/.test(page));
ok('  with no database text left in an inline handler',
   !/onclick="openSong\('\$\{/.test(page));
ok('the modal takes a key', /function openSong\(id, key, allowEdit\)/.test(page));
// Editing is the library's job, so reading a chart off a rota offers none.
ok('  and only the library may edit from it', /A\._chartCanEdit = !!allowEdit && A\.isAdmin;/.test(page));
ok('  defaulting to the song\'s own', /normaliseKey\(key\) \|\| normaliseKey\(s\.default_key\) \|\| 'C'/.test(page));
ok('the key bar offers every key', /KEYS\.map\(k =>/.test(page));
ok('a scheduled key is picked, not typed', /<select id="song-key-\$\{s\.id\}"/.test(page));
ok('only a numbers chart gets the key bar', /chart_format === 'nashville'/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
