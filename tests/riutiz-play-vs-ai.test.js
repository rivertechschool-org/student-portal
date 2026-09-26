// RIUTIZ vs the AI: you play the deck you chose, and you can click your cards.
//
// Found by playing it in a real browser (debug-tools/riutiz-journey.py), not
// by reading it - the engine test was green the whole time:
//
//   1. "Play vs AI" started straight away with player1Deck unset, so the engine
//      dealt the student a RANDOM deck. The starter deck they picked on day one
//      and every deck they built were never played against the AI.
//   2. The top half of every card in the hand was unclickable at every screen
//      size: the hand sat below .your-side (z-index 1) in the stacking order.
//   3. A spent (rotated) field card lay across its neighbours and took their clicks.
//   4. On a phone a 7-card hand fanned wider than the screen.
//   5. Signed out, every finished game wrote stats to a user called "null".
//
// Run: node tests/riutiz-play-vs-ai.test.js

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'games', 'riutiz.html'), 'utf8');
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'games', 'riutiz', 'RiutizUI.js'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Lift a top-level `function name(...) {...}` out of the page's script.
function pageFn(name) {
  const m = new RegExp('\\n(async )?function ' + name + '\\s*\\(').exec(page);
  if (!m) throw new Error('function not found: ' + name);
  let i = page.indexOf('{', page.indexOf(')', m.index));
  let depth = 0; const start = m.index + 1;
  for (; i < page.length; i++) {
    if (page[i] === '{') depth++;
    else if (page[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return page.slice(start, i);
}

function cssBlock(selector) {
  const m = new RegExp('\\n\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(page);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------- 1. the deck
console.log('\n== Play vs AI plays the deck you chose ==\n');
{
  // Run the real menu functions against a stub page and a stub game.
  const calls = [];
  const els = {};
  const el = id => (els[id] = els[id] || { classList: { add() {}, remove() {}, toggle() {} }, style: {}, textContent: '', innerHTML: '' });
  const env = {
    document: { getElementById: el, querySelectorAll: () => [] },
    alert: () => {},
  };
  const decks = [{ id: 'd1', name: 'My deck', cards: ['5', '5', '9'], card_count: 40, is_valid: true, deck_type: 'casual' }];
  const src = [
    'let multiplayerAction = null, selectedGameMode = null, selectedDeckId = null;',
    'let deckBuilder = { getDecksForMode: () => DECKS, getSavedDecks: () => DECKS };',
    'function showMenu() { CALLS.push(["menu"]); }',
    'function showGameModeSelect() { CALLS.push(["modeSelect"]); }',
    'function populateDeckSelectGrid() {}',
    'function startQuickGame(deck) { CALLS.push(["start", deck]); }',
    'async function startQuickMatch() { CALLS.push(["quickmatch"]); }',
    'async function createLobbyWithDeck() {} async function joinLobbyWithDeck() {}',
    pageFn('showAIDeckSelect'), pageFn('deckSelectBack'), pageFn('showDeckSelect'),
    pageFn('selectDeck'), pageFn('confirmDeckSelection'),
    'return { showAIDeckSelect, deckSelectBack, selectDeck, confirmDeckSelection, setDecks: d => { DECKS.length = 0; DECKS.push(...d); } };'
  ].join('\n');
  const DECKS = [...decks];
  const api = new Function('document', 'alert', 'CALLS', 'DECKS', src)(env.document, env.alert, calls, DECKS);

  api.showAIDeckSelect();
  check('with a deck saved, Play vs AI opens the picker instead of starting', calls, []);
  check('  and says what it is for', els['deck-select-mode-label'].textContent, 'Play vs AI - pick your deck');
  api.selectDeck('d1');
  (async () => {
    await api.confirmDeckSelection();
    check('confirming starts the AI game WITH that deck', calls, [['start', ['5', '5', '9']]]);

    calls.length = 0;
    api.deckSelectBack();
    check('Back from the AI picker returns to the menu', calls, [['menu']]);

    calls.length = 0;
    api.setDecks([]);
    api.showAIDeckSelect();
    check('with no deck ready, Play vs AI still starts a game', calls, [['start', null]]);

    finishRest();
  })();
}

function finishRest() {
  const start = pageFn('startQuickGame');
  ok('startQuickGame hands the deck to the engine as player1Deck',
     /function startQuickGame\(playerDeck[^)]*\)/.test(start) && /player1Deck:\s*playerDeck/.test(start));
  ok('  and the multiplayer route is untouched', /multiplayerAction === 'quickmatch'/.test(pageFn('confirmDeckSelection')));

  // -------------------------------------------------------------- 2-4. clicks
  console.log('\n== your cards can be clicked ==\n');
  const hand = cssBlock('.hand-area');
  const yourSide = cssBlock('.your-side');
  const z = s => { const m = /z-index:\s*(\d+)/.exec(s); return m ? +m[1] : null; };
  ok(`the hand stacks above the battlefield (hand ${z(hand)} > your-side ${z(yourSide)})`,
     z(hand) !== null && z(yourSide) !== null && z(hand) > z(yourSide));
  ok('  and below the action bar', z(hand) < z(cssBlock('.action-bar')));
  ok('a spent field card is given the room it takes up once rotated',
     /\.field-zone \.card\.small\.spent\s*\{\s*margin:\s*0 1rem/.test(page));

  // Run renderHand on a phone-width container and measure the fan.
  {
    const m = /\n    renderHand\(container, hand\) \{/.exec(uiSrc);
    let i = uiSrc.indexOf('{', m.index + 5), depth = 0; const s0 = i;
    for (; i < uiSrc.length; i++) { if (uiSrc[i] === '{') depth++; else if (uiSrc[i] === '}') { depth--; if (depth === 0) break; } }
    const body = uiSrc.slice(s0 + 1, i);
    const made = [];
    const fakeDoc = { createElement: () => { const e = { style: {}, appendChild() {} }; made.push(e); return e; }, documentElement: {} };
    const fn = new Function('container', 'hand', 'document', 'getComputedStyle', 'window', body);
    const self = { selectedCard: null, renderCard: () => ({}), handleHandCardClick() {} };
    const fan = width => {
      made.length = 0;
      const container = { innerHTML: '', clientWidth: width, appendChild() {} };
      fn.call(self, container, Array.from({ length: 7 }, (_, k) => ({ instanceId: 'c' + k })), fakeDoc, () => ({ fontSize: '16px' }), { innerWidth: width });
      const offs = made.map(w => +/calc\(50% \+ (-?[\d.]+)rem/.exec(w.style.cssText)[1]);
      const cardRem = 6;
      return { left: 50 * 0 + Math.min(...offs) - cardRem / 2, right: Math.max(...offs) + cardRem / 2, halfRem: width / 16 / 2 };
    };
    const phone = fan(390);
    ok(`7 cards fit a 390px phone (fan ${phone.left.toFixed(1)}..${phone.right.toFixed(1)}rem, half-width ${phone.halfRem.toFixed(1)}rem)`,
       phone.left >= -phone.halfRem && phone.right <= phone.halfRem);
    const desk = fan(1400);
    ok('  and still fan out fully on a desktop', desk.right - desk.left > 30);
  }

  // ------------------------------------------------------------- 5. offline
  console.log('\n== signed out, nothing is recorded ==\n');
  ok('the vs-AI result is only recorded when the arcade is online',
     /window\.arcade\?\.isOnline && typeof window\.arcade\.recordGameResult === 'function'/.test(start));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
