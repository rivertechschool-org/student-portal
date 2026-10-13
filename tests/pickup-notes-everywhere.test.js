// Pickup notes and early pickups, on both tabs.
//
// Two gaps the person at the door fell into:
//
//   * PICKUP NOTES WERE ON ONE TAB. "Uncle Mike is collecting today" showed on
//     the Dismissal card, after a family lookup, and nowhere on Here today -
//     the list many staff actually work from.
//   * A PARENT'S EARLY PICKUP NEVER REACHED THE BOARD. The parent reports
//     "collecting at 1:45, his uncle will come"; the register flagged it, but
//     the reason sat in a table the pickup board did not read.
//
// Both tabs now draw a child's notes and today's early pickups with the same
// helper, and both give a child with something different today the orange
// edge. Standing notes ("usually aftercare") are the normal arrangement and do
// not count as different.
//
// Run: node tests/pickup-notes-everywhere.test.js

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
  const re = new RegExp('\\n      (?:async\\s+)?' + name + '\\s*\\(', 'g');
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
  const Ctor = /^async\b/.test(sig) ? Object.getPrototypeOf(async function () {}).constructor : Function;
  return new Ctor(args, html.slice(start + 1, i - 1));
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function makeApp() {
  const app = {
    calls: [],
    escapeHtml: esc,
    jsAttr: (t) => String(t == null ? '' : t).replace(/'/g, "\\'"),
    _formatDateOnly: (d) => `D(${d})`,
  };
  for (const n of ['_pickupNotesHtml', '_pickupHasExceptionToday', '_pickupClock',
                   '_refreshPickupHereList', '_refreshPickupAfterNote']) app[n] = extract(n);
  return app;
}

console.log('\n== the clock ==\n');
{
  const app = makeApp();
  const c = (t) => app._pickupClock(t);
  check('13:45 is 1:45 pm', c('13:45'), '1:45 pm');
  check('09:05 is 9:05 am', c('09:05'), '9:05 am');
  check('noon is 12:00 pm', c('12:00'), '12:00 pm');
  check('12:30 at night is 12:30 am', c('00:30'), '12:30 am');
  check('nonsense is shown as it came', c('soon'), 'soon');
}

console.log('\n== what a child\'s strips say ==\n');
{
  const app = makeApp();
  const out = app._pickupNotesHtml({
    notes: [{ note: 'Usually aftercare', standing: true },
            { note: 'Uncle Mike, blue truck', standing: false, today_only: true }],
    early_pickups: [{ at_time: '13:45', reason: 'His uncle <Mike> will come', source: 'parent' }],
  });
  ok('a standing note reads "Usually"', /Usually:<\/strong>\s*Usually aftercare/.test(out));
  ok('a one-day note reads "Today"', /Today:<\/strong>\s*Uncle Mike, blue truck/.test(out));
  ok('a parent\'s early pickup shows its time', /Early pickup 1:45 pm:/.test(out));
  ok('  and the reason the parent gave', /His uncle &lt;Mike&gt; will come/.test(out));
  ok('  escaped, never as markup', !/<Mike>/.test(out));
  ok('  and says it came from the parent', /from parent/.test(out));
  ok('standing first, then today\'s note, then the early pickup',
     out.indexOf('aftercare') < out.indexOf('blue truck') && out.indexOf('blue truck') < out.indexOf('Early pickup'));

  const bare = app._pickupNotesHtml({ early_pickups: [{ at_time: '14:00', reason: null, source: 'staff' }] });
  ok('an early pickup with no reason still shows, and says so', /Early pickup 2:00 pm/.test(bare) && /no reason given/.test(bare));
  ok('  and says staff entered it', /from staff/.test(bare));
  check('nothing to say draws nothing', app._pickupNotesHtml({}), '');
}

console.log('\n== what counts as different today ==\n');
{
  const app = makeApp();
  const x = (m) => app._pickupHasExceptionToday(m);
  check('no notes', x({}), false);
  check('only a standing note', x({ notes: [{ standing: true }] }), false);
  check('a dated note', x({ notes: [{ standing: false }] }), true);
  check('an early pickup alone', x({ notes: [], early_pickups: [{ at_time: '13:45' }] }), true);
}

console.log('\n== Here today shows them ==\n');
{
  const app = makeApp();
  const list = { innerHTML: '' }, count = { textContent: '' };
  global.document = { getElementById: (id) =>
      id === 'pickup-here-list' ? list : id === 'pickup-here-count' ? count : null };
  app._pickupHere = [
    { student_id: 's1', first_name: 'Ava', last_name: 'Q', status: 'present', dismissed: false,
      notes: [{ note: 'Uncle Mike today', standing: false, today_only: true }], early_pickups: [] },
    { student_id: 's2', first_name: 'Ben', last_name: 'R', status: 'present', dismissed: false,
      notes: [], early_pickups: [{ at_time: '13:45', reason: 'Dentist, Grandma collecting', source: 'parent' }] },
    { student_id: 's3', first_name: 'Cal', last_name: 'S', status: 'present', dismissed: false,
      notes: [{ note: 'Usually aftercare', standing: true }], early_pickups: [] },
    { student_id: 's4', first_name: 'Dee', last_name: 'T', status: 'present', dismissed: false },
  ];
  app._refreshPickupHereList();
  const out = list.innerHTML;
  const block = (name) => {
    const at = out.indexOf(name);
    const from = out.lastIndexOf('<div style="border:', at);
    const next = out.indexOf('<div style="border:', at);
    return out.slice(from, next < 0 ? out.length : next);
  };
  ok('a dated pickup note is on the row', /Today:<\/strong>\s*Uncle Mike today/.test(block('Ava')));
  ok('a parent\'s early pickup is on the row', /Early pickup 1:45 pm/.test(block('Ben')) && /Grandma collecting/.test(block('Ben')));
  ok('a standing note is on the row too', /Usually aftercare/.test(block('Cal')));
  ok('the dated note gets the orange edge', /border:2px solid var\(--warning/.test(block('Ava')));
  ok('  and so does the early pickup', /border:2px solid var\(--warning/.test(block('Ben')));
  ok('  but not a standing note', !/border:2px/.test(block('Cal')));
  ok('  nor a child with nothing on file', !/border:2px/.test(block('Dee')));
  ok('a row without the new fields still draws', /Dee/.test(out) && /Picked up<\/button>/.test(block('Dee')));
  ok('every row can open the note editor', (out.match(/showPickupNoteModal\(/g) || []).length === 4);
  ok('  marked 📝 where a note exists, ＋ where none does',
     /📝/.test(block('Ava')) && /＋/.test(block('Dee')) && /＋/.test(block('Ben')));
}

console.log('\n== saving a note refreshes the tab behind it ==\n');
(async () => {
  for (const [tab, present] of [['Here today', true], ['Dismissal', false]]) {
    const app = makeApp();
    app.loadPickupHereToday = async () => app.calls.push('here');
    app.pickupSearch = async () => app.calls.push('search');
    global.document = { getElementById: (id) => (id === 'pickup-here' && present ? {} : null) };
    await app._refreshPickupAfterNote();
    check(`${tab}: reloads ${present ? 'the list' : 'the search'} only`, app.calls, [present ? 'here' : 'search']);
  }

  console.log('\n== the Dismissal card uses the same helpers ==\n');
  const card = html.slice(html.indexOf('const renderMember = (m) =>'), html.indexOf('Who may collect'));
  ok('its strips come from _pickupNotesHtml', /this\._pickupNotesHtml\(m\)/.test(card));
  ok('its orange edge from _pickupHasExceptionToday', /this\._pickupHasExceptionToday\(m\)/.test(card));
  ok('save and delete refresh through the tab-aware helper',
     (html.match(/await this\._refreshPickupAfterNote\(\)/g) || []).length === 2);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
