// Riven, as a pinned widget rather than a section.
//
// Riven used to be a page you navigated to. Opening it meant leaving whatever
// you were doing, and - the part that was actually a bug - `#terminal-output`
// did not exist until the first visit, so every proactive push (a message
// arriving, the morning briefing) was written into nothing and lost. It is now
// mounted on <body> at load and never torn down.
//
// Four rules this guards, each of which has a way of quietly coming undone:
//
//   * THE TRANSCRIPT EXISTS FROM LOAD. init() mounts the widget. If that call
//     goes away the chat still works when you open it, and the dropped pushes
//     come straight back with nothing to show they left.
//   * NO TRANSFORM ON THE WIDGET OR THE PANEL. Riven's overlays - the ⌘K
//     palette, the entity popup - are `position: fixed`. A transform, filter,
//     perspective or will-change on an ancestor makes it their containing
//     block, which traps them inside a 420px box and clips them to it. This is
//     invisible until someone presses ⌘K on the live site.
//   * THE 1GB MODEL IS NEVER FETCHED AT PAGE LOAD. _initPhi3State() re-loads
//     the upgrade model when a teacher has enabled it. Mounting it eagerly
//     would pull a gigabyte on every portal load, for a chat nobody opened.
//   * THE ERROR BADGE AND THE LAUNCHER SHARE A CORNER. shared/config.js pins
//     the badge bottom-right, which is now where Riven lives.
//
// Run: node tests/extract-portalui.js && node tests/riven-widget.test.js

const fs = require('fs');
const path = require('path');

const PortalUI = require('./portalui.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- pull the real methods out of the file ------------------------------
// Same brace-walk the debug-tools harnesses use, so there is no drift between
// what runs here and what ships.
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
  const parEnd = i;
  i = html.indexOf('{', parEnd);
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const sig = html.slice(m.index + 1, parEnd).trim();
  const args = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  const body = html.slice(start + 1, i - 1);
  const Ctor = /^async\b/.test(sig)
    ? Object.getPrototypeOf(async function () {}).constructor
    : Function;
  return new Ctor(args, body);
}

// ---- a DOM small enough to reason about ---------------------------------
function makeEl(id) {
  return {
    id,
    dataset: {},
    style: {},
    hidden: false,
    textContent: '',
    scrollTop: 0,
    scrollHeight: 999,
    focus() { this.focused = (this.focused || 0) + 1; },
  };
}

function makeDom({ narrow = false, withWidget = true, withBadge = true } = {}) {
  const els = {
    'terminal-output': makeEl('terminal-output'),
    'terminal-input': makeEl('terminal-input'),
    'riven-unread': makeEl('riven-unread'),
  };
  if (withWidget) els['riven-widget'] = makeEl('riven-widget');
  if (withBadge) els['portal-issue-badge'] = makeEl('portal-issue-badge');

  const bodyClasses = new Set();
  global.document = {
    getElementById: (id) => els[id] || null,
    body: {
      classList: {
        add: (c) => bodyClasses.add(c),
        remove: (c) => bodyClasses.delete(c),
        contains: (c) => bodyClasses.has(c),
      },
    },
  };
  global.window = {
    innerWidth: narrow ? 390 : 1440,
    innerHeight: 900,
    visualViewport: null,
    matchMedia: (q) => ({ matches: narrow && /max-width/.test(q) }),
    addEventListener() {},
    removeEventListener() {},
  };
  global.PortalUI = PortalUI;
  return { els, bodyClasses };
}

// An app carrying the real state machine, with only its neighbours stubbed.
function makeApp(dom) {
  const app = {
    _rivenUnread: 0,
    _phi3Inits: 0,
    _hidden: 0,
    _paletteClosed: 0,
    _rivenNarrow: extract('_rivenNarrow'),
    _rivenState: extract('_rivenState'),
    _setRivenState: extract('_setRivenState'),
    openRiven: extract('openRiven'),
    closeRiven: extract('closeRiven'),
    toggleRiven: extract('toggleRiven'),
    expandRiven: extract('expandRiven'),
    restoreRiven: extract('restoreRiven'),
    _rivenFirstOpen: extract('_rivenFirstOpen'),
    _renderRivenUnread: extract('_renderRivenUnread'),
    _rivenNoteUnread: extract('_rivenNoteUnread'),
    _enterRivenFullscreen: extract('_enterRivenFullscreen'),
    _exitRivenFullscreen: extract('_exitRivenFullscreen'),
    _hideAutocomplete() { this._hidden++; },
    closeTerminalPalette() { this._paletteClosed++; },
    _rivenReady() { return Promise.resolve(); },
    _initPhi3State() { this._phi3Inits++; },
  };
  app._dom = dom;
  return app;
}

// ---- the transcript is alive from load ----------------------------------
console.log('\n== mounted at load, not on first visit ==\n');

const initBody = html.slice(html.indexOf('      async init() {'), html.indexOf('      checkPasswordSetupRequired()'));
ok('init() mounts the widget', /this\.mountRivenWidget\(\)/.test(initBody));
ok('  and does not block init on it', /mountRivenWidget\(\)\.catch\(/.test(initBody));

// Exactly one of each: two copies of #terminal-output is how a push lands in
// the invisible one.
for (const id of ['terminal-output', 'terminal-input', 'terminal-autocomplete',
                  'terminal-suggestions', 'riven-launcher', 'riven-panel']) {
  check(`one #${id}`, (html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
}
// The palette is built in script rather than markup, because it is appended to
// <body> instead of to the panel.
check('one #terminal-palette', (html.match(/palette\.id = 'terminal-palette'/g) || []).length, 1);
check('  and none in the markup', /id="terminal-palette"/.test(html), false);

ok('the old section is emptied out',
  /<section id="teacher-terminal-section" class="hidden"><\/section>/.test(html));
ok('renderTeacherTerminal opens the widget instead of drawing a page',
  /async renderTeacherTerminal\(\) \{\s*await this\.mountRivenWidget\(\);\s*this\.openRiven\(\);/.test(html));

const clearChat = html.slice(html.indexOf('    clearTerminalChat() {'), html.indexOf('    async _loadTerminalStudents('));
check('clearing the chat no longer rebuilds the shell', /renderTeacherTerminal/.test(clearChat), false);
ok('  it resets the transcript in place', /_rivenIntroHtml\(\)/.test(clearChat));

// ---- the rule that is invisible until it breaks -------------------------
console.log('\n== no containing block over Riven\'s fixed overlays ==\n');

const widgetCss = html.slice(html.indexOf('#riven-widget {'), html.indexOf('body.riven-fs #riven-panel {'));
ok('the widget CSS block was located', widgetCss.length > 500 && widgetCss.length < 9000);

// Only the avatar images may be transformed - they are leaves, not ancestors.
for (const sel of ['#riven-widget', '#riven-panel']) {
  const block = widgetCss.slice(widgetCss.indexOf(sel + ' {'));
  const rule = block.slice(0, block.indexOf('}'));
  ok(`${sel} has no transform`, !/\btransform\s*:/.test(rule));
  ok(`${sel} has no filter/perspective/will-change`,
    !/\b(filter|perspective|will-change)\s*:/.test(rule));
}
ok('fullscreen fits by height and top, never transform',
  !/widget\.style\.transform/.test(html) && /widget\.style\.top = vv\.offsetTop/.test(html));

// The palette is the overlay this actually protects, so it is built on <body>.
const mount = html.slice(html.indexOf('    async mountRivenWidget() {'), html.indexOf('    _rivenReady() {'));
const widgetHtml = html.slice(html.indexOf('    _rivenWidgetHtml() {'), html.indexOf('    // Riven is no longer a section.'));
ok('the widget markup was located', widgetHtml.length > 3000 && widgetHtml.length < 20000);
ok('the palette is appended to <body>', /document\.body\.appendChild\(palette\)/.test(mount));
check('  not into the panel', /terminal-palette/.test(widgetHtml), false);

// ---- a gigabyte is not a page-load cost ---------------------------------
console.log('\n== the upgrade model waits to be asked for ==\n');

check('mounting does not call _initPhi3State', /this\._initPhi3State\(\)/.test(mount), false);
ok('  it hangs off the first open instead',
  /_rivenFirstOpen\(\) \{[\s\S]{0,400}?_initPhi3State\(\)/.test(html));
ok('  with a placeholder so the button can paint meanwhile',
  /this\._phi3State = \{ pipe: null/.test(mount));

// ---- the state machine --------------------------------------------------
console.log('\n== closed / docked / full ==\n');

async function desktopRun() {
  const dom = makeDom({ narrow: false });
  const app = makeApp(dom);
  const w = dom.els['riven-widget'];
  w.dataset.state = 'closed';

  check('starts closed', app._rivenState(), 'closed');

  app.openRiven();
  check('a desktop opens docked', w.dataset.state, 'docked');
  check('  without the fullscreen takeover', dom.bodyClasses.has('riven-fs'), false);
  // The model load hangs off _rivenReady(), so let the microtasks drain.
  await Promise.resolve(); await Promise.resolve();
  check('  and asks for the model exactly once', app._phi3Inits, 1);

  app.openRiven();
  await Promise.resolve(); await Promise.resolve();
  check('opening again does not re-ask for the model', app._phi3Inits, 1);

  app.expandRiven();
  check('expand goes fullscreen', w.dataset.state, 'full');
  ok('  and locks the page behind it', dom.bodyClasses.has('riven-fs'));

  app.restoreRiven();
  check('restore comes back to docked', w.dataset.state, 'docked');
  check('  and unlocks the page', dom.bodyClasses.has('riven-fs'), false);

  app.toggleRiven();
  check('toggle closes it', w.dataset.state, 'closed');
  check('  and puts the autocomplete and palette away', [app._hidden, app._paletteClosed], [1, 1]);

  app.toggleRiven();
  check('toggle opens it again', w.dataset.state, 'docked');
}

{
  const dom = makeDom({ narrow: true });
  const app = makeApp(dom);
  const w = dom.els['riven-widget'];
  w.dataset.state = 'closed';

  app.openRiven();
  check('a phone opens fullscreen, not a 420px panel', w.dataset.state, 'full');
  // There is no docked size worth having at 390px, so "back" means closed.
  app.restoreRiven();
  check('and restoring from it closes', w.dataset.state, 'closed');
}

// ---- the unread marker --------------------------------------------------
console.log('\n== a push that lands while Riven is shut ==\n');

{
  const dom = makeDom({ narrow: false });
  const app = makeApp(dom);
  const w = dom.els['riven-widget'];
  const dot = dom.els['riven-unread'];
  w.dataset.state = 'closed';

  app._rivenNoteUnread();
  app._rivenNoteUnread();
  check('two arrivals count onto the circle', [dot.hidden, dot.textContent], [false, '2']);

  app.openRiven();
  check('opening clears the count', [dot.hidden, dot.textContent], [true, '0']);

  app._rivenNoteUnread();
  check('an arrival while open does not mark anything', [dot.hidden, dot.textContent], [true, '0']);

  app.closeRiven();
  for (let i = 0; i < 12; i++) app._rivenNoteUnread();
  check('the badge tops out rather than widening', dot.textContent, '9+');
}

ok('_showRivenMessage is what counts them',
  /_showRivenMessage\(content, isHtml = false\) \{[\s\S]{0,400}?this\._rivenNoteUnread\(\);/.test(html));

// ---- the corner the badge used to own -----------------------------------
console.log('\n== the error badge steps aside ==\n');

const at = (badge) => [badge.style.bottom, badge.style.right, badge.style.left];

{
  // No Riven at all (a student, or the main app): nothing changes.
  const dom = makeDom({ withWidget: false });
  PortalUI.positionIssueBadge();
  check('with no widget it stays in the corner', at(dom.els['portal-issue-badge']), ['18px', '18px', 'auto']);
}
{
  const dom = makeDom();
  dom.els['riven-widget'].dataset.state = 'closed';
  PortalUI.positionIssueBadge();
  check('with the circle there it sits above it', at(dom.els['portal-issue-badge']), ['88px', '18px', 'auto']);
}
for (const state of ['docked', 'full']) {
  const dom = makeDom();
  dom.els['riven-widget'].dataset.state = state;
  PortalUI.positionIssueBadge();
  // 620px of panel means there is no "above" left on this side.
  check(`with the panel ${state} it moves to the other side`,
    at(dom.els['portal-issue-badge']), ['18px', 'auto', '18px']);
}
{
  const dom = makeDom({ withBadge: false });
  PortalUI.positionIssueBadge();
  check('no badge is not an error', true, true);
}

const cfg = fs.readFileSync(path.join(__dirname, '..', 'shared', 'config.js'), 'utf8');
ok('every badge update repositions it',
  /badge\.textContent = `\$\{count\}[\s\S]{0,120}?PortalUI\.positionIssueBadge\(badge\)/.test(cfg));
ok('and so does every Riven state change',
  /PortalUI\.positionIssueBadge\(\)/.test(html.slice(html.indexOf('_setRivenState(state) {'),
                                                     html.indexOf('    openRiven('))));

// ---- routing ------------------------------------------------------------
console.log('\n== the old ways in still work ==\n');

const route = html.slice(html.indexOf("          case 'teacher-terminal':"), html.indexOf("          case 'notes':"));
ok('the section route sends the page home first', /this\.showSection\('home'\)/.test(route));
ok('  then opens the widget over it', /this\.renderTeacherTerminal\(\)/.test(route));
ok('  and stops there', /return;/.test(route));
ok('#teacher-terminal is still a valid hash',
  (html.match(/'teacher-terminal', 'irl-purchases'/g) || []).length === 2);
ok('the nav entry is untouched',
  /label: 'Riven', app: 'portal', section: 'teacher-terminal'/.test(cfg));
ok('navigating out of fullscreen docks Riven rather than closing the page over it',
  /if \(document\.body\.classList\.contains\('riven-fs'\)\) this\.restoreRiven\(\);/.test(html));
ok('⌘K is bound to the widget being open, not to a section',
  /e\.key === 'k' && this\._rivenState\(\) && this\._rivenState\(\) !== 'closed'/.test(html));

// ---- the actions, across the top ----------------------------------------
console.log('\n== actions across the top ==\n');

const topbar = html.slice(html.indexOf('<div id="riven-actions">'), html.indexOf('<div id="riven-chat-card">'));
for (const [label, call] of [
  ['Students', "app.terminalQuickAction('list')"],
  ['Briefing', "app.terminalQuickAction('briefing')"],
  ['Search', 'app.toggleTerminalPalette()'],
  ['Help', "app.terminalQuickAction('help')"],
  ['Smarter Riven', 'app.toggleRivenUpgrade()'],
  ['Clear', 'app.clearTerminalChat()'],
]) ok(`${label} is in the strip`, topbar.includes(call));

ok('the strip scrolls rather than stacking into three rows',
  /#riven-actions \{[^}]*overflow-x: auto/.test(widgetCss));
ok('the upgrade button keeps the id its renderer looks for',
  /id="riven-upgrade-btn"[^>]*class="riven-act riven-upgrade-btn-idle"/.test(topbar));

// ---- nothing on screen may depend on a font having the glyph ------------
console.log('\n== the window controls are drawn, not typed ==\n');

// This is here because it shipped broken once: the "leave full screen" button
// was \u{1F5D7}, which Samsung's font has no glyph for, so an Android phone drew the
// missing-character box instead. A glyph you cannot see on the machine you are
// writing on is not a glyph you can rely on.
const win = widgetHtml.slice(widgetHtml.indexOf('<div class="riven-win">'),
                             widgetHtml.indexOf('<div id="riven-actions-wrap">'));
ok('the window controls were located', win.length > 200 && win.length < 2000);
check('all three are SVG', (win.match(/<svg /g) || []).length, 3);
check('  expand, restore and close', (win.match(/<button /g) || []).length, 3);
ok('no astral-plane character survives in them', !/[\u{10000}-\u{10FFFF}]/u.test(win));
ok('  and specifically not the one that broke', !win.includes('\u{1F5D7}'));
ok('every one keeps a spoken label', (win.match(/aria-label="/g) || []).length === 3);
ok('the paths take their colour from the button', /stroke: currentColor/.test(widgetCss));

// ⌘ is not a key anyone has on a phone, and it is the widest thing in a strip
// that already overflows there.
ok('the ⌘K hint is hidden on a phone',
  /@media \(max-width: 700px\) \{ #riven-actions \.riven-act-kbd \{ display: none; \} \}/.test(widgetCss));

// The desktop run awaits a microtask (the model load hangs off a promise),
// so the tally waits for it rather than exiting out from under it.
desktopRun().then(() => {
  console.log(`
${pass} passed, ${fail} failed
`);
  process.exit(fail ? 1 : 0);
});
