// Text from the database is text. It is never code, and never a scheme.
//
// Three findings from a review of the Worship/Band page, all of them the same
// mistake wearing different clothes: `esc()` was treated as though it made a
// string safe everywhere, when all it does is escape five characters for one
// context — the body of an HTML attribute or element.
//
// 1. INSIDE AN INLINE HANDLER it is not enough. esc() turns ' into &#39;; the
//    HTML parser decodes that back to a live quote before the JS parser ever
//    sees the attribute, so the string literal ends early. A song key of
//    G'),…;// ran arbitrary script in the browser of everyone who opened the
//    plan. Proven in a real browser before it was fixed, not reasoned about.
//
// 2. IN AN HREF it is beside the point. There is nothing to escape in
//    "javascript:alert(1)" — the danger is the scheme, and esc() has no opinion
//    about schemes. Any song row could carry a "rehearsal track" link that ran
//    code on click.
//
// 3. showModal() did not escape its title at all. Every caller happened to pass
//    escaped text, so it was not exploitable — an unguarded sink one careless
//    caller away, which is the kind of thing that is only ever fixed before it
//    matters.
//
// Run: node tests/worship-safety.test.js

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'portal', 'worship.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Pull a top-level function out of the page and run the real thing.
function grab(name) {
  const re = new RegExp('(?:function\\s+' + name + '\\s*\\(|const\\s+' + name + '\\s*=)', 'g');
  const m = re.exec(page);
  if (!m) throw new Error('not found: ' + name);
  if (m[0].startsWith('const')) {
    // A const arrow can span lines — safeUrl does — so read to the `;` that
    // closes the declaration rather than to the end of the first line.
    let i = page.indexOf('=', m.index) + 1;
    let depth = 0;
    const start = i;
    for (; i < page.length; i++) {
      const c = page[i];
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth--;
      else if (c === ';' && depth === 0) break;
    }
    return eval('(' + page.slice(start, i) + ')');
  }
  let i = page.indexOf('{', m.index + m[0].length - 1);
  let d = 0; const st = i;
  for (; i < page.length; i++) {
    const c = page[i];
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { i++; break; } }
  }
  const sig = page.slice(m.index, st).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  return new Function(...args.split(',').map(s => s.trim()).filter(Boolean), page.slice(st + 1, i - 1));
}

// safeUrl resolves against the document, so it needs a location to resolve to.
global.window = { location: { href: 'https://rivertech.me/portal/worship.html' } };
const safeUrl = grab('safeUrl');

(async () => {

  console.log('\n== a link is http, https, or nothing ==\n');

  for (const good of ['https://example.com/song', 'http://example.com/x?a=1',
                      'https://open.spotify.com/track/abc', '/portal/chart.pdf',
                      'chart.pdf']) {
    ok(`keeps ${JSON.stringify(good)}`, safeUrl(good) === good);
  }
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)',
                     ' javascript:alert(1)', 'data:text/html,<script>x</script>',
                     'vbscript:msgbox(1)', 'file:///etc/passwd']) {
    check(`refuses ${JSON.stringify(bad)}`, safeUrl(bad), '');
  }
  check('an empty value is empty, not "undefined"', safeUrl(null), '');
  check('  and so is a blank string', safeUrl('   '), '');

  console.log('\n== every href on the page goes through it ==\n');

  {
    // Any href built by interpolation must have safeUrl inside it. Written as a
    // scan rather than a list, so a NEW link added later is covered too.
    const hrefs = [...page.matchAll(/href="\$\{([^}]*)\}"/g)].map(m => m[1]);
    const unsafe = hrefs.filter(h => !/safeUrl\(/.test(h));
    check('no interpolated href skips safeUrl', unsafe, []);
    ok('  and there are some to check', hrefs.length >= 6);
  }

  console.log('\n== no database text is ever parsed as JavaScript ==\n');

  {
    // The song links carry data now. A data- attribute is read back as text,
    // whatever is in it.
    ok('the set-list link carries the song as data', /data-song-id="\$\{esc\(song\.id\)\}"/.test(page));
    ok('  and the key it is booked in', /data-song-key="\$\{esc\(l\.song_key\)\}"/.test(page));
    ok('  and one listener opens them', /closest\('\.song-open'\)/.test(page));

    // The rule, stated as a scan over the VALUES rather than a list of function
    // names. A name list goes stale the moment somebody adds a handler, and
    // then gets edited to make the suite pass instead of being read.
    //
    // What is safe inside a handler is a value this page generated: an id, a
    // loop variable, a page constant, or something encoded for the JS context.
    // What is not safe is anything a person typed into a field.
    const handlers = [...page.matchAll(/on(?:click|change|input|submit)="([^"]*)"/g)].map(m => m[1]);
    const values = new Set();
    for (const h of handlers) for (const v of h.match(/\$\{[^}]*\}/g) || []) values.add(v.trim());

    const looksGenerated = (v) =>
      /\bid\b|_id\b|Id\b/.test(v)            // a uuid this page holds
      || /^\$\{[a-z]\}$/.test(v)             // a loop variable
      || /\bd\.date\b/.test(v)               // a date this page formatted
      || /\binstrument\b/.test(v)            // from the INSTRUMENTS constant
      || /jsStr\(/.test(v)                   // encoded for the JS context
      || /^\$\{\s*$/.test(v);                // a fragment of a nested template
    const risky = [...values].filter(v => !looksGenerated(v));
    check('nothing a person typed reaches an inline handler', risky, []);

    // And the specific columns, named, because those are what went wrong.
    ok('  no song key in a handler', ![...values].some(v => /song_key|default_key/.test(v)));
    ok('  no title, note, label, url or name',
       ![...values].some(v => /\.(title|note|notes|label|url|artist|full_name)\b/.test(v)));
  }

  console.log('\n== the modal escapes its own title ==\n');

  ok('showModal escapes rather than trusting its callers',
     /function showModal\(title, bodyHtml\)\{[\s\S]{0,400}<h3>\$\{esc\(title\)\}<\/h3>/.test(page));

  console.log('\n== a numeral in a lyric is a numeral ==\n');

  {
    // The chart is stored in Nashville numbers, so the parser has to tell a
    // chord from a number. It could not: "10,000 reasons" lost its digits and
    // gained a chord.
    const KEY_SCALES = eval('(' + page.slice(page.indexOf('const KEY_SCALES'),
      page.indexOf('};', page.indexOf('const KEY_SCALES')) + 1).replace('const KEY_SCALES =', '') + ')');
    const DEGREE_QUALITY = eval('(' + page.slice(page.indexOf('const DEGREE_QUALITY'),
      page.indexOf(';', page.indexOf('const DEGREE_QUALITY'))).replace('const DEGREE_QUALITY =', '') + ')');
    global.KEY_SCALES = KEY_SCALES;
    global.DEGREE_QUALITY = DEGREE_QUALITY;
    global.chordFor = grab('chordFor');
    const parse = grab('parseChartLine');

    const lyric = (line) => parse(line, 'C').text;
    const chords = (line) => parse(line, 'C').chords.map(c => c.name);

    check('10,000 keeps all of its zeroes',
          lyric('Bless the Lord, 10,000 reasons'), 'Bless the Lord, 10,000 reasons');
    check('  and gains no chord', chords('Bless the Lord, 10,000 reasons'), []);
    check('Psalm 23 keeps its 23', lyric('Psalm 23 is my song'), 'Psalm 23 is my song');
    check('an ordinal survives', lyric('the 1st time'), 'the 1st time');

    // The other half: the convention still works. These are the two shapes the
    // transpose suite asserts, restated here so a fix to one cannot break the
    // other silently.
    check('a chord against a syllable still reads',
          lyric('1He picked me up'), 'He picked me up');
    check('  and names the chord', chords('1He picked me up'), ['C']);
    check('a chord mid-word still lands', lyric('bag of bo1nes'), 'bag of bones');
    check('a chords-only line is all chords', chords('1 4 5 1'), ['C', 'F', 'G', 'C']);
    check('  leaving no words behind', lyric('1 4 5 1').trim(), '');
  }

  console.log('\n== a key we cannot draw is said out loud ==\n');

  {
    // KEY_SCALES holds the twelve major spellings, so a minor key does not
    // normalise. The chart used to open in C with nothing said, while the line
    // above it still read "Key Em".
    ok('the modal warns when the booked key was not used', /_chartAsked/.test(page));
    ok('  saying which key was asked for',
       /booked in <b>\$\{esc\(A\._chartAsked\)\}<\/b>/.test(page));
    ok('  and which one is being shown',
       /showing <b>\$\{esc\(key\)\}<\/b>/.test(page));
    ok('  and pressing a key clears it', /function setChartKey\(key\)\{[\s\S]{0,160}_chartAsked = null/.test(page));
    // The warning has to be reachable: it only means anything if the fallback
    // is still there to fall back to.
    ok('the fallback itself is unchanged', /normaliseKey\(key\) \|\| normaliseKey\(s\.default_key\) \|\| 'C'/.test(page));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
