// Mathspire, played headless.
//
// The game is one 10k-line HTML file whose Game class talks to the DOM on
// almost every line, so it has never had a test that RUNS it - the 2026-09
// audit found a victory-screen crash at the end of Act 2, a soft-lock on a
// declined surprise combat, and half a dozen effects (Exposed, Burden, Regret,
// Confusion, elite frequency, relic pools) that were computed and then never
// applied. None of those can be caught by asserting on source text.
//
// So this file builds a small fake DOM (elements with classList/style/children,
// getElementById over the ids that exist in the HTML, a tiny selector engine),
// evaluates the real inline script inside it with node's vm module, and then
// drives the real Game: a seeded run from the placement test through both
// acts to the victory screen, plus targeted checks for each audited effect.
//
// Run: node tests/mathspire-run.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// MATHSPIRE_HTML=<path> runs the same checks against another copy (e.g. an old revision)
const html = fs.readFileSync(process.env.MATHSPIRE_HTML || path.join(__dirname, '..', 'games', 'mathspire.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---------------------------------------------------------------- fake DOM
function parseCompound(sel) {
  const m = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let x;
  while ((x = re.exec(sel))) {
    if (x[1]) m.tag = x[1].toUpperCase();
    else if (x[2]) m.id = x[2];
    else if (x[3]) m.classes.push(x[3]);
    else if (x[4]) m.attrs.push([x[4], x[5]]);
  }
  return m;
}
function matchesCompound(el, m) {
  if (m.tag && el.tagName !== m.tag) return false;
  if (m.id && el.id !== m.id) return false;
  for (const c of m.classes) if (!el._cls.has(c)) return false;
  for (const [k, v] of m.attrs) {
    const dsKey = k.startsWith('data-') ? k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) : null;
    const val = el.attributes[k] !== undefined ? el.attributes[k] : (dsKey ? el.dataset[dsKey] : undefined);
    if (val === undefined) return false;
    if (v !== undefined && String(val) !== v) return false;
  }
  return true;
}
function descendants(el, out = []) {
  for (const c of el.children) { out.push(c); descendants(c, out); }
  return out;
}
function matchesSelector(el, selector) {
  return selector.split(',').some(part => {
    const chain = part.trim().split(/\s+/).map(parseCompound);
    if (!matchesCompound(el, chain[chain.length - 1])) return false;
    let node = el.parentNode;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (node && !matchesCompound(node, chain[i])) node = node.parentNode;
      if (!node) return false;
      node = node.parentNode;
    }
    return true;
  });
}
function query(root, selector) {
  return descendants(root).filter(el => matchesSelector(el, selector));
}

// Just enough of an HTML parser for the game's template strings: nested tags with
// id/class/data-* attributes and their text. Good enough for querySelector('button').
const VOID_TAGS = new Set(['BR', 'HR', 'IMG', 'INPUT', 'META', 'LINK']);
function parseHTML(str, parent) {
  const root = { children: [] };
  const stack = [root];
  const re = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*"|='[^']*')?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1]) {                                     // closing tag
      const tag = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag) { stack.length = i; break; }
    } else if (m[2]) {                              // opening tag
      const el = makeEl(m[2]);
      m[3].replace(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g, (_, k, v1, v2) => {
        const v = v1 !== undefined ? v1 : (v2 !== undefined ? v2 : '');
        if (k === 'id') el.id = v; else if (k === 'class') el.className = v; else el.attributes[k] = v;
        if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
        return '';
      });
      const top = stack[stack.length - 1];
      el.parentNode = top === root ? parent : top;
      top.children.push(el);
      if (!m[4] && !VOID_TAGS.has(el.tagName)) stack.push(el);
    } else if (m[5] && m[5].trim()) {               // text
      const top = stack[stack.length - 1];
      if (top !== root) top._text += m[5].trim();
    }
  }
  return root.children;
}

function makeStyle() {
  const s = {};
  Object.defineProperties(s, {
    setProperty: { value: (k, v) => { s[k] = v; } },
    removeProperty: { value: k => { delete s[k]; } },
    getPropertyValue: { value: k => (s[k] === undefined ? '' : s[k]) },
  });
  return s;
}

function makeEl(tag, id) {
  const el = {
    tagName: String(tag).toUpperCase(), id: id || '', _cls: new Set(), children: [], parentNode: null,
    style: makeStyle(), dataset: {}, attributes: {}, _text: '', _html: '', disabled: false, value: '0',
    onclick: null, onchange: null, offsetWidth: 100, offsetHeight: 100, clientWidth: 100, clientHeight: 100,
    scrollTop: 0, scrollHeight: 100,
    classList: {
      add: (...c) => c.forEach(x => el._cls.add(x)),
      remove: (...c) => c.forEach(x => el._cls.delete(x)),
      contains: c => el._cls.has(c),
      toggle: (c, force) => { const on = force === undefined ? !el._cls.has(c) : force; on ? el._cls.add(c) : el._cls.delete(c); return on; },
    },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = el; el.children.push(c); return c; },
    append(...cs) { cs.forEach(c => el.appendChild(c)); },
    prepend(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = el; el.children.unshift(c); },
    insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = el; const i = el.children.indexOf(ref); i < 0 ? el.children.push(c) : el.children.splice(i, 0, c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i < 0) throw new Error("removeChild: node is not a child of this node"); el.children.splice(i, 1); c.parentNode = null; return c; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    querySelector(s) { return query(el, s)[0] || null; },
    querySelectorAll(s) { return query(el, s); },
    getElementsByClassName(c) { return query(el, '.' + c); },
    closest(s) { let n = el; while (n && n.tagName) { if (matchesSelector(n, s)) return n; n = n.parentNode; } return null; },
    matches(s) { return matchesSelector(el, s); },
    contains(o) { let n = o; while (n) { if (n === el) return true; n = n.parentNode; } return false; },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { el.attributes[k] = String(v); if (k === 'id') el.id = String(v); if (k === 'class') el.className = String(v); },
    getAttribute(k) { return el.attributes[k] === undefined ? null : el.attributes[k]; },
    hasAttribute(k) { return el.attributes[k] !== undefined; },
    removeAttribute(k) { delete el.attributes[k]; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 }; },
    focus() {}, blur() {}, scrollIntoView() {}, select() {},
    click() { if (typeof el.onclick === 'function') el.onclick({ preventDefault() {}, stopPropagation() {}, target: el, currentTarget: el }); },
  };
  Object.defineProperty(el, 'className', {
    get() { return [...el._cls].join(' '); },
    set(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); el.children = []; } });
  Object.defineProperty(el, 'innerText', { get() { return el._text; }, set(v) { el._text = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); el.children = parseHTML(el._html, el); } });
  Object.defineProperty(el, 'firstChild', { get() { return el.children[0] || null; } });
  Object.defineProperty(el, 'lastChild', { get() { return el.children[el.children.length - 1] || null; } });
  Object.defineProperty(el, 'parentElement', { get() { return el.parentNode; } });
  return el;
}

function buildDocument() {
  const body = makeEl('body');
  const head = makeEl('head');
  const htmlEl = makeEl('html');
  htmlEl.appendChild(head); htmlEl.appendChild(body);
  // Every element in the HTML body that carries an id or class, flat, in document
  // order (nesting is not needed by anything the tests drive).
  const bodyHtml = html.slice(html.indexOf('<body>'), html.lastIndexOf('<script>'));
  const tagRe = /<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g;
  let m;
  while ((m = tagRe.exec(bodyHtml))) {
    const attrs = {};
    m[2].replace(/([\w-]+)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = v === undefined ? '' : v; return ''; });
    if (attrs.id === undefined && attrs.class === undefined) continue;
    const el = makeEl(m[1], attrs.id);
    if (attrs.class) el.className = attrs.class;
    for (const [k, v] of Object.entries(attrs)) if (k !== 'id' && k !== 'class') el.attributes[k] = v;
    body.appendChild(el);
  }
  const doc = {
    body, head, documentElement: htmlEl, readyState: 'complete', fullscreenElement: null, webkitFullscreenElement: null,
    hidden: false, activeElement: null, title: '',
    getElementById(id) { return descendants(htmlEl).find(e => e.id === id) || null; },
    createElement(tag) { return makeEl(tag); },
    createElementNS(ns, tag) { return makeEl(tag); },
    createTextNode(t) { const e = makeEl('#text'); e._text = String(t); return e; },
    querySelector(s) { return query(htmlEl, s)[0] || null; },
    querySelectorAll(s) { return query(htmlEl, s); },
    addEventListener() {}, removeEventListener() {},
    exitFullscreen() { return Promise.resolve(); },
    execCommand() { return true; },
  };
  return doc;
}

// ---------------------------------------------------------------- sandbox
function boot() {
  const timers = [];
  const alerts = [];
  const errors = [];
  const store = {};
  const sandbox = {
    console: { log() {}, warn() {}, info() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) },
    alert: msg => alerts.push(String(msg)),
    confirm: () => sandbox.__confirm,
    prompt: () => null,
    __confirm: true,
    setTimeout: (fn, ms, ...args) => { timers.push({ fn, args }); return timers.length; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: fn => { timers.push({ fn, args: [performance.now()] }); return timers.length; },
    cancelAnimationFrame() {},
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '', href: 'http://localhost/games/mathspire.html', reload() { sandbox.__reloaded = true; } },
    navigator: { userAgent: 'node-test', clipboard: { writeText: () => Promise.resolve() }, maxTouchPoints: 0 },
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    screen: { width: 1280, height: 800 },
    getComputedStyle: () => ({ getPropertyValue: () => '', display: 'block' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {}, removeEventListener() {}, postMessage() {}, scrollTo() {},
    performance: { now: () => Date.now() },
    URLSearchParams,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.parent = sandbox;      // standalone: window.parent === window
  sandbox.top = sandbox;
  sandbox.document = buildDocument();
  const ctx = vm.createContext(sandbox);
  const js = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  vm.runInContext(js, ctx, { filename: 'mathspire.inline.js' });
  const g = name => vm.runInContext(name, ctx);
  const Game = g('Game');
  Game.prototype.wait = () => Promise.resolve();          // no animation delays
  const flush = () => { let n = 0; while (timers.length && n++ < 5000) { const t = timers.shift(); t.fn(...t.args); } };
  return {
    ctx, sandbox, doc: sandbox.document, timers, alerts, errors, flush, Game,
    game: sandbox.game,
    CARD_DATABASE: g('CARD_DATABASE'), ENEMY_DATABASE: g('ENEMY_DATABASE'), RELICS: g('RELICS'),
    EVENTS: g('EVENTS'), STARTING_CHOICES: g('STARTING_CHOICES'), STATIC_CARD_IDS: g('STATIC_CARD_IDS'),
  };
}

const active = (env, id) => { const el = env.doc.getElementById(id); return !!el && el._cls.has('active'); };
const byId = (env, id) => env.doc.getElementById(id);

// ---------------------------------------------------------------- auto-player
async function playCombat(env, opts = {}) {
  const { game } = env;
  for (let turn = 0; turn < 60; turn++) {
    if (!active(env, 'combat-view') || game.player.hp <= 0) return turn;
    game.currentMode = opts.mode ? opts.mode(turn) : 'attack';
    game.selectedTarget = 0;
    // biggest number, then an operator that cannot go negative, then the next number
    const value = id => (env.CARD_DATABASE[id] && env.CARD_DATABASE[id].value) || 0;
    const nums = game.hand.map((c, i) => ({ c, i })).filter(x => /^num/.test(x.c)).sort((x, y) => value(y.c) - value(x.c));
    const op = ['opMultiply', 'opAdd', 'opSubtract'].map(o => game.hand.indexOf(o)).find(i => i >= 0);
    let played = 0;
    if (nums.length >= 2 && op !== undefined) {
      const first = game.hand[nums[0].i], second = game.hand[nums[1].i];
      for (const id of [first, game.hand[op], second]) {
        const i = game.hand.indexOf(id);
        if (i < 0) break;
        game.playCard(i);
        played++;
      }
    }
    if (played === 3) await game.autoEvaluateEquation();
    else game.clearEquation();
    env.flush();
    // god mode is about exercising the flow, not the auto-player's arithmetic: after a
    // long stalemate, finish the fight through the real damage path
    if (opts.godMode && turn >= 25) {
      for (const enemy of game.enemies.slice()) await game.dealDamageToEnemyAnimated(enemy, 99999, 0);
      game.enemies = game.enemies.filter(e => e.hp > 0);      // same sweep autoEvaluateEquation does
      if (game.enemies.length === 0) { game.winCombat(); env.flush(); return turn; }
    }
    await game.endTurn();
    env.flush();
  }
  return 60;
}

async function afterCombat(env, scenario) {
  const { game } = env;
  if (active(env, 'reward-view')) game.skipReward();
  else if (active(env, 'elite-reward-view')) game.skipRelicReward();
  else if (active(env, 'boss-relic-view')) {
    const choices = byId(env, 'boss-relic-choices').children;
    if (choices.length && scenario % 2 === 0) choices[0].click(); else game.skipBossRelic();
  }
  env.flush();
}

// Walk a whole tower. Returns { result: 'victory'|'defeat'|'stuck', steps, log }
async function runTower(env, seed, scenario, opts = {}) {
  const { game, doc } = env;
  const log = [];
  game.startWithSeed(seed, opts.ascension || 0);
  const choice = env.STARTING_CHOICES[scenario % env.STARTING_CHOICES.length];
  game.applyStartingChoice(choice);
  env.flush();
  // choices that open a relic picker: take the first relic (twice for the cursed path)
  for (let i = 0; i < 2; i++) {
    const pick = doc.body.children.filter(e => e.tagName === 'DIV' && e.children.some(c => c.children.some(cc => cc._cls.has('relic-choice') || cc._cls.has('boss-relic-choice'))));
    if (!pick.length) break;
    const relicEl = pick[0].children[0].children.find(cc => cc._cls.has('relic-choice') || cc._cls.has('boss-relic-choice'));
    relicEl.click();
    env.flush();
  }
  if (!active(env, 'map-view')) game.proceedToMap();
  if (opts.godMode) { game.player.maxHp = 9999; game.player.hp = 9999; }
  log.push(`start ${choice.name} hp=${game.player.hp} deck=${game.deck.length} relics=${game.relics.join(',')}`);

  for (let step = 0; step < 120; step++) {
    if (active(env, 'victory-screen')) return { result: 'victory', steps: step, log };
    if (active(env, 'defeat-screen')) return { result: 'defeat', steps: step, log };
    if (byId(env, 'act-transition')) { game.startAct2(); env.flush(); continue; }
    if (active(env, 'combat-view')) { await playCombat(env, opts); await afterCombat(env, scenario); continue; }
    if (active(env, 'reward-view') || active(env, 'elite-reward-view') || active(env, 'boss-relic-view')) { await afterCombat(env, scenario); continue; }
    if (active(env, 'event-view')) {
      const choices = byId(env, 'event-choices').children;
      if (!choices.length) return { result: 'stuck:event-no-choices', steps: step, log };
      choices[(scenario + step) % choices.length].click();
      env.flush();
      continue;
    }
    if (active(env, 'shop-view')) { game.leaveShop(); env.flush(); continue; }
    if (active(env, 'rest-view')) { game.restHeal(); env.flush(); continue; }
    if (active(env, 'treasure-view')) {
      const choices = byId(env, 'treasure-choices').children;
      if (choices.length) choices[0].click(); else game.skipTreasure();
      env.flush();
      continue;
    }
    if (active(env, 'map-view')) {
      const acc = game.getAccessibleNodes();
      if (!acc.length) return { result: 'stuck:no-accessible-nodes', steps: step, log };
      const idx = acc[(scenario + step) % acc.length];
      log.push(`node ${idx} ${game.map[idx].type} f${game.map[idx].floor} hp=${game.player.hp}`);
      env.sandbox.__confirm = opts.confirm === undefined ? true : opts.confirm;
      game.enterNode(idx);
      env.flush();
      continue;
    }
    return { result: 'stuck:no-view', steps: step, log };
  }
  return { result: 'stuck:steps', steps: 120, log };
}

// ---------------------------------------------------------------- tests
module.exports = { boot, runTower, playCombat, afterCombat, active, byId, descendants };
if (require.main === module) main();

async function main() {
  // ---- 1. a whole tower, both acts, to the victory screen (god mode so the weak
  //         auto-player survives; this is the Act-2 victory crash regression)
  for (const [seed, scenario] of [['AUDIT-A', 0], ['AUDIT-B', 1], ['AUDIT-C', 4]]) {
    const env = boot();
    let res;
    try { res = await runTower(env, seed, scenario, { godMode: true }); }
    catch (e) { res = { result: 'THREW ' + e.message + '\n' + e.stack, log: [] }; }
    check(`tower ${seed}/${scenario} reaches victory`, res.result, 'victory');
    if (res.result !== 'victory') console.log('        ' + res.log.slice(-6).join('\n        '));
    ok(`tower ${seed}/${scenario}: no console.error`, env.errors.length === 0);
    if (env.errors.length) console.log('        ' + env.errors.slice(0, 3).join('\n        '));
    ok(`tower ${seed}/${scenario}: #victory-screen still exists after startAct2`, !!byId(env, 'victory-screen'));
    ok(`tower ${seed}/${scenario}: act transition overlay was removed`, !byId(env, 'act-transition'));
    check(`tower ${seed}/${scenario}: victory seed shown`, byId(env, 'victory-seed-value').textContent, seed);
  }

  // ---- 2. a normal-HP run must END (victory or defeat), never strand the player
  {
    const env = boot();
    let res;
    try { res = await runTower(env, 'AUDIT-D', 2, { confirm: false }); }
    catch (e) { res = { result: 'THREW ' + e.message + '\n' + e.stack, log: [] }; }
    ok(`normal run ends cleanly (${res.result})`, res.result === 'victory' || res.result === 'defeat');
    if (!(res.result === 'victory' || res.result === 'defeat')) console.log('        ' + res.log.slice(-6).join('\n        '));
  }

  // ---- 3. declining a surprise combat returns to the map (was: blank screen)
  {
    const env = boot();
    const { game } = env;
    game.startWithSeed('AUDIT-E', 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    const evIdx = game.map.findIndex(n => n.type === 'event');
    game.enteringNode = evIdx;
    game.hideAllViews();
    env.sandbox.__confirm = false;
    game.showEventSurpriseCombat();
    ok('declined surprise combat shows the map again', active(env, 'map-view'));
    ok('declined surprise combat started no fight', !active(env, 'combat-view'));
  }

  // ---- helpers for combat-state checks
  function combatEnv(seed = 'AUDIT-F') {
    const env = boot();
    const { game } = env;
    game.startWithSeed(seed, 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    game.enteringNode = game.map.findIndex(n => n.type === 'enemy');
    game.startCombat(['minusMite']);
    env.flush();
    return env;
  }
  async function evaluate(env, cards, mode = 'attack') {
    const { game } = env;
    game.currentMode = mode;
    game.selectedTarget = 0;
    game.currentEquation = [];
    game.hand = cards.slice();
    for (let i = 0; i < 3; i++) game.playCard(0);   // number, operator, number
    await game.autoEvaluateEquation();
    env.flush();
  }

  // ---- 4. Regret: -2 to the result while it sits in hand
  {
    const a = combatEnv(), b = combatEnv();
    const hpA0 = a.game.enemies[0].hp, hpB0 = b.game.enemies[0].hp;
    await evaluate(a, ['num5', 'opAdd', 'num3']);
    await evaluate(b, ['num5', 'opAdd', 'num3', 'regret']);
    const dmgA = hpA0 - a.game.enemies[0].hp, dmgB = hpB0 - b.game.enemies[0].hp;
    ok(`Regret in hand reduces damage by 2 (${dmgA} -> ${dmgB})`, dmgA > 0 && dmgB === dmgA - 2);
  }

  // ---- 5. Burden: turn-start draw is one card smaller
  {
    const a = combatEnv(), b = combatEnv();
    // a full draw pile, so the only difference between the two turns is the curse
    for (const env of [a, b]) { env.game.drawPile = env.game.deck.slice(); env.game.discardPile = []; }
    a.game.hand = ['num1']; b.game.hand = ['num1', 'burden'];
    await a.game.endTurn(); await b.game.endTurn();
    a.flush(); b.flush();
    ok(`Burden draws one fewer (${a.game.hand.length} vs ${b.game.hand.length})`, b.game.hand.length === a.game.hand.length - 1);
  }

  // ---- 6. Confusion exhausts when drawn
  {
    const env = combatEnv();
    const { game } = env;
    game.hand = []; game.drawPile = ['num2', 'confusion', 'num3']; game.discardPile = [];
    game.drawCards(3);
    check('Confusion never reaches the hand', game.hand.includes('confusion'), false);
    check('the other drawn cards do', game.hand.filter(c => c.startsWith('num')).length, 2);
  }

  // ---- 7. Exposed on an enemy is applied (+50%) and decays
  {
    const env = combatEnv();
    const { game } = env;
    const enemy = game.enemies[0];
    enemy.block = 0; enemy.hp = 100; enemy.maxHp = 100;
    enemy.debuffs = { exposed: 2 };
    await game.dealDamageToEnemyAnimated(enemy, 10, 0);
    check('Exposed enemy takes 15 from a 10 hit', enemy.hp, 85);
    game.hand = []; await game.endTurn(); env.flush();
    check('Exposed decays by one per turn', enemy.debuffs.exposed, 1);
  }

  // ---- 8. Event debuffs survive into the next fight, are cleared on winning it
  {
    const env = boot();
    const { game } = env;
    game.startWithSeed('AUDIT-G', 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    game.applyDebuff('confused', 2);
    game.enteringNode = game.map.findIndex(n => n.type === 'enemy');
    game.startCombat(['minusMite']);
    check('Mental Fog confusion carries into combat', game.player.debuffs.confused, 2);
    game.enemies = [];
    game.winCombat();
    check('winning the fight clears debuffs', game.player.debuffs, {});
  }

  // ---- 9. Any evaluated equation counts as the turn's first one (Recursive Ring)
  {
    const env = combatEnv();
    env.game.firstEquationThisTurn = true;
    await evaluate(env, ['num5', 'opAdd', 'num3'], 'defend');
    check('defend equation clears firstEquationThisTurn', env.game.firstEquationThisTurn, false);
  }

  // ---- 10. Elite frequency multiplier changes the map
  {
    const count = mult => {
      const env = boot();
      const { game } = env;
      game.startWithSeed('AUDIT-H', 0);
      game.applyStartingChoice(env.STARTING_CHOICES[0]);
      env.flush();
      game.difficultyMultipliers.eliteFrequency = mult;
      game.map = []; game.mapConnections = {};
      game.initMap();
      return game.map.filter(n => n.type === 'elite').length;
    };
    const base = count(1), heavy = count(100);
    ok(`eliteFrequency raises elite count (${base} -> ${heavy})`, heavy > base && heavy > 8);
  }

  // ---- 11. Reward pools never offer generated/upgraded card ids
  {
    const env = boot();
    const { game, CARD_DATABASE } = env;
    game.startWithSeed('AUDIT-I', 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    CARD_DATABASE['opAdd+'] = { ...CARD_DATABASE.opAdd, name: '++', rarity: 'rare', upgraded: true };
    CARD_DATABASE['num13'] = { ...CARD_DATABASE.num12, name: '13', value: 13, rarity: 'rare', upgraded: true };
    const pool = game.getWeightedCardPool();
    check('weighted pool excludes upgraded ids', pool.filter(id => id === 'opAdd+' || id === 'num13').length, 0);
    ok('weighted pool is not empty', pool.length > 0);
  }

  // ---- 12. addRandomRelic: never a boss relic, never a silent no-op
  {
    const env = boot();
    const { game, RELICS } = env;
    game.startWithSeed('AUDIT-J', 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    for (let i = 0; i < 20; i++) game.addRandomRelic();
    ok('addRandomRelic hands out no boss relics', game.relics.every(id => RELICS[id].tier !== 'boss'));
    check('no duplicates', new Set(game.relics).size, game.relics.length);
    const alertsBefore = env.alerts.length;
    game.addRandomRelic();     // everything non-boss is owned now
    ok('owning every relic still tells the player something', env.alerts.length === alertsBefore + 1);
  }

  // ---- 13. Card-removal modal renders card names (was: blank tiles)
  {
    const env = boot();
    const { game } = env;
    game.startWithSeed('AUDIT-K', 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    game.showRemovalModal(50, false);
    const tiles = byId(env, 'removal-cards').children;
    ok('removal modal has tiles', tiles.length > 0);
    ok('removal tiles show the card name', tiles.every(t => t.innerHTML.includes('card-name')));
  }

  // ---- 14. Cancelling the rest-site upgrade picker keeps the rest
  {
    const env = boot();
    const { game, doc } = env;
    game.startWithSeed('AUDIT-L', 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    game.enteringNode = game.map.findIndex(n => n.type === 'rest');
    game.hideAllViews();
    game.showRest();
    const before = game.currentNode;
    game.restUpgrade();
    const modal = byId(env, 'upgrade-modal');
    ok('upgrade modal opened', !!modal);
    const cancel = descendants(modal).find(e => e.tagName === 'BUTTON' && /cancel/i.test(e.textContent));
    ok('upgrade modal has a Cancel button', !!cancel);
    if (cancel) cancel.click();
    ok('cancel closes the modal', !byId(env, 'upgrade-modal'));
    ok('cancel keeps the rest site open', active(env, 'rest-view'));
    check('cancel does not consume the node', game.currentNode, before);
  }

  // ---- 15. Boss relic reward: owning every boss relic still transitions to Act 2
  {
    const env = boot();
    const { game, RELICS, ENEMY_DATABASE } = env;
    game.startWithSeed('AUDIT-M', 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    game.relics.push(...Object.keys(RELICS).filter(id => RELICS[id].tier === 'boss'));
    const boss = Object.keys(ENEMY_DATABASE).find(id => ENEMY_DATABASE[id].tier === 'boss');
    game.enteringNode = game.map.length - 1;
    game.startCombat([boss]);
    game.enemies = [];
    game.winCombat();
    env.flush();
    ok('Act 1 boss with no relic left to offer still shows the Act transition', !!byId(env, 'act-transition'));
    ok('...and not the victory screen', !active(env, 'victory-screen'));
  }

  // ---- 16. Graph Master duel actually starts a fight
  {
    const env = boot();
    const { game, EVENTS } = env;
    game.startWithSeed('AUDIT-N', 0);
    game.applyStartingChoice(env.STARTING_CHOICES[0]);
    env.flush();
    const gm = EVENTS.find(e => e.name === 'The Graph Master');
    const duel = gm.choices.find(c => /duel/i.test(c.text));
    game.enteringNode = game.map.findIndex(n => n.type === 'event');
    duel.outcome();
    ok('duel starts combat', active(env, 'combat-view') && game.enemies.length === 1);
    ok('duel is an elite fight', game.wasEventElite === true);
    ok('duel choice is flagged for the event handler', duel.startsCombat === true);
  }

  // ---- 17. Player damage float renders; victory() survives a missing seed element
  {
    const env = combatEnv();
    const before = env.doc.body.children.length;
    env.game.showPlayerDamageNumber(7);
    const float = env.doc.body.children.slice(before).find(e => e.textContent === '-7');
    ok('player damage number is added to the page', !!float);
    const env2 = boot();
    byId(env2, 'victory-seed-value').remove();
    let threw = false;
    try { env2.game.victory(); } catch (e) { threw = true; }
    ok('victory() tolerates a missing seed element', !threw);
  }

  // ---- 18. The headless DOM caught nothing the real page lacks: every id the
  //          script asks for exists in the markup (act-transition is created at runtime)
  {
    const env = boot();
    const ids = [...new Set([...html.matchAll(/getElementById\(\s*['"]([^'"$]+)['"]\s*\)/g)].map(m => m[1]))];
    const missing = ids.filter(id => id !== 'act-transition' && !byId(env, id));
    check('every getElementById target exists in the HTML', missing, []);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
