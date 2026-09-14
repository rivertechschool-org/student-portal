// The Riven transcript stays bounded, in the page as well as in storage.
//
// WHAT WAS WRONG
//
// Only the SAVED copy was ever trimmed - the live page kept every node it had
// ever rendered. A tab left open all day grew without limit, and the save then
// deep-cloned the whole transcript, 400ms after every message, in order to
// throw most of the copy away. That is the cost you feel on a phone in the
// afternoon, and it got worse the longer the tab stayed open.
//
// A Riven bubble is 647 bytes of markup before any content, so node count is a
// poor proxy for size: one roster listing outweighs fifty "done"s. The old
// save caught its own quota error and deleted the entire saved transcript
// without telling anyone.
//
// Nothing read savedAt either, so a conversation from last term came back
// mid-lesson looking like this morning's - and _nlpContext.lastStudent came
// back with it, which means "give him 5 rtc" pointed at a child nobody in the
// room had mentioned.
//
// Run: node tests/riven-chat-bounds.test.js

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

// A transcript element that behaves enough like the real one: children, removal
// and outerHTML. cloneNode is deliberately a trap - if anything calls it, the
// deep copy is back.
function makeOutput(n, bytesEach = 700) {
  const children = [];
  for (let i = 0; i < n; i++) {
    children.push({ _i: i, outerHTML: `<div data-i="${i}">${'x'.repeat(bytesEach)}</div>` });
  }
  return {
    children,
    cloneCalls: 0,
    cloneNode() { this.cloneCalls++; throw new Error('the whole transcript was cloned again'); },
    removeChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1); },
    get firstElementChild() { return this.children[0]; },
    get innerHTML() { return this.children.map(c => c.outerHTML).join(''); },
  };
}

function makeApp(out, { quotaAfter = Infinity, stored = null } = {}) {
  const store = {};
  const app = {
    notices: [],
    warned: 0,
    _nlpContext: { lastStudent: { id: 's1', full_name: 'Noah Williams', first_name: 'Noah', last_name: 'Williams', rtc_balance: 10 } },
    showNotification(m, k) { app.notices.push(`${k}:${m}`); },
    _terminalChatKey: () => 'riven_chat_test',
    store,
  };
  global.document = { getElementById: (id) => (id === 'terminal-output' ? out : null) };
  global.localStorage = {
    getItem: (k) => (k === 'riven_chat_test' ? stored : (store[k] ?? null)),
    setItem: (k, v) => {
      // Storage that is full above a byte ceiling, the way a browser behaves.
      if (v.length > quotaAfter) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      store[k] = v;
    },
    removeItem: (k) => { delete store[k]; app.removed = true; },
  };
  global.console = { ...console, warn: () => { app.warned++; } };
  for (const m of ['_rivenChatMaxNodes', '_rivenChatMaxAgeMs', '_trimTerminalChat',
                   '_persistTerminalChat', '_restoreTerminalChat']) {
    app[m] = extract(m);
  }
  return app;
}

(async () => {

  console.log('\n== the live page is trimmed, not just the save ==\n');

  {
    const out = makeOutput(500);
    const app = makeApp(out);
    app._persistTerminalChat.call(app);
    check('the transcript is cut to the cap', out.children.length, 200);
    // The whole point: the oldest go, the newest stay.
    check('  the newest message survives', out.children[out.children.length - 1]._i, 499);
    check('  and the oldest is gone', out.children[0]._i, 300);
    check('nothing deep-clones the transcript', out.cloneCalls, 0);
  }

  {
    const out = makeOutput(12);
    const app = makeApp(out);
    check('a short transcript is left alone', app._trimTerminalChat.call(app), false);
    check('  with every message kept', out.children.length, 12);
  }

  {
    const out = makeOutput(500);
    const app = makeApp(out);
    // The observer that schedules saves watches this element, so trimming must
    // announce itself or every dropped node schedules another save.
    let flagDuringTrim = null;
    const realRemove = out.removeChild.bind(out);
    out.removeChild = (el) => { flagDuringTrim = app._rivenTrimBusy; realRemove(el); };
    app._trimTerminalChat.call(app);
    check('the observer is told to ignore our own removals', flagDuringTrim, true);
    check('  and the flag is cleared afterwards', app._rivenTrimBusy, false);
  }

  console.log('\n== storage that will not fit ==\n');

  {
    const out = makeOutput(200, 700);
    const app = makeApp(out);
    app._persistTerminalChat.call(app);
    const saved = JSON.parse(app.store['riven_chat_test']);
    ok('a normal transcript saves whole', saved.html.includes('data-i="199"'));
    ok('  carrying the student in context', /Noah Williams/.test(JSON.stringify(saved.lastStudent)));
    ok('  and when it was saved', typeof saved.savedAt === 'number');
  }

  {
    // Node count is bounded; bytes are not. One roster listing outweighs fifty
    // "done"s, and the old code threw the entire transcript away.
    const out = makeOutput(200, 4000);
    const app = makeApp(out, { quotaAfter: 200000 });
    app._persistTerminalChat.call(app);
    const saved = app.store['riven_chat_test'];
    ok('an oversized transcript still saves something', !!saved);
    ok('  a shorter tail of it', saved.length <= 200000);
    // saved is the JSON string, where the quotes are escaped - read the html
    // back out rather than matching through the escaping.
    ok('  ending at the newest message', JSON.parse(saved).html.includes('data-i="199"'));
    check('  and the page is not cut down to fit storage', out.children.length, 200);
  }

  {
    const out = makeOutput(200, 4000);
    const app = makeApp(out, { quotaAfter: 10 });
    app._persistTerminalChat.call(app);
    check('when nothing fits, no half-written value is left', app.store['riven_chat_test'], undefined);
    // Losing the conversation on the next reload without being told is worse
    // than the loss.
    ok('  and the person is told once', app.notices.some(n => /can't save this conversation/.test(n)));
    ok('  with a way out', app.notices.some(n => /\/clear/.test(n)));

    app._persistTerminalChat.call(app);
    check('  but only once', app.notices.length, 1);
  }

  console.log('\n== a stale conversation is not restored ==\n');

  {
    const fresh = JSON.stringify({
      html: '<div>this morning</div>',
      lastStudent: { id: 's1', full_name: 'Noah Williams' },
      savedAt: Date.now() - 60 * 60 * 1000,
    });
    const out = makeOutput(0);
    out.innerHTML = '';
    const app = makeApp(out, { stored: fresh });
    Object.defineProperty(out, 'innerHTML', { set(v) { out._set = v; }, get() { return out._set || ''; }, configurable: true });
    app._restoreTerminalChat.call(app);
    ok('an hour-old conversation comes back', /this morning/.test(out._set || ''));
    ok('  with the student it was about', app._nlpContext.lastStudent.full_name === 'Noah Williams');
  }

  {
    // The one that matters: last term's context returning mid-lesson, so "give
    // him 5 rtc" points at a child nobody has mentioned.
    const stale = JSON.stringify({
      html: '<div>last term</div>',
      lastStudent: { id: 'old', full_name: 'Someone Else' },
      savedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });
    const out = makeOutput(0);
    const app = makeApp(out, { stored: stale });
    Object.defineProperty(out, 'innerHTML', { set(v) { out._set = v; }, get() { return out._set || ''; }, configurable: true });
    app._nlpContext = {};
    app._restoreTerminalChat.call(app);
    check('a month-old conversation is not restored', out._set, undefined);
    check('  and brings no student back with it', app._nlpContext.lastStudent, undefined);
    ok('  the stale copy is deleted', app.removed === true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
