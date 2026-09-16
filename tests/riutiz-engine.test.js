// RIUTIZ's rules engine and AI, played headless.
//
// RiutizGame is DOM-free (an EventTarget) and RiutizAI only needs setTimeout, so
// both load straight into node's vm. The 2026-09-15 audit found two spend
// abilities that threw (Pencil called a method that does not exist, Illustration
// passed an instanceId where a player number was expected), pupils at exactly 0
// endurance staying on the field, end-of-turn / end-of-combat processing that no
// code path ever called, and half a dozen flags (cannotBlock, unblockable,
// impulsive, aura die bonuses, protection) that were written and never read.
//
// This file plays whole AI-vs-AI games to the end under a seeded Math.random -
// any engine exception surfaces as an "AI error" - and then checks each audited
// rule directly against a hand-built board.
//
// Run: node tests/riutiz-engine.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const G = path.join(__dirname, '..', 'games');
const CARDS = JSON.parse(fs.readFileSync(path.join(G, 'Data', 'Riutiz', 'cards.json'), 'utf8'));
// RIUTIZ_DIR=<dir> runs the same checks against other copies of the two modules
const SRC = ['RiutizGame.js', 'RiutizAI.js']
  .map(f => fs.readFileSync(path.join(process.env.RIUTIZ_DIR || path.join(G, 'riutiz'), f), 'utf8')).join('\n');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---------------------------------------------------------------- sandbox
function boot(seed = 1) {
  const timers = [];
  const errors = [];
  let now = 0;
  let s = (seed >>> 0) || 1;
  const rnd = () => {                      // mulberry32
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sandbox = {
    console: { log() {}, info() {}, debug() {}, warn() {}, error: (...a) => errors.push(a.map(x => (x && x.stack) || String(x)).join(' ')) },
    setTimeout: (fn, ms, ...args) => { timers.push({ fn, args, at: now + (ms || 0), id: timers.length + 1 }); return timers.length; },
    clearTimeout(id) { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    EventTarget, CustomEvent, Event,
    __rnd: rnd,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC + '\nMath.random = __rnd;', ctx, { filename: 'riutiz.js' });
  const RiutizGame = vm.runInContext('RiutizGame', ctx);
  const RiutizAI = vm.runInContext('RiutizAI', ctx);
  // Run every pending timer (and whatever they schedule) in virtual-time order.
  async function drain(limit = 200000) {
    let n = 0;
    while (n++ < limit) {
      await new Promise(r => setImmediate(r));          // let awaited promises settle
      if (!timers.length) {
        await new Promise(r => setImmediate(r));
        if (!timers.length) return n;
      }
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift();
      now = Math.max(now, t.at);
      t.fn(...t.args);
    }
    throw new Error('drain: timer limit reached');
  }
  return { ctx, RiutizGame, RiutizAI, errors, timers, drain };
}

const byName = name => CARDS.find(c => c.name === name);
const byAbility = (re, type) => CARDS.find(c => c.ability && re.test(c.ability) && (!type || (c.type || '').includes(type)));

function board(env) {
  const game = new env.RiutizGame({ mode: 'vs-ai', cardData: CARDS });
  game.startGame();
  // start from an empty, quiet board in player 1's main phase
  for (const p of [1, 2]) {
    const pl = game.state.players[p];
    pl.field = []; pl.hand = []; pl.resources = []; pl.discard = [];
  }
  game.state.currentPlayer = 1;
  game.state.phase = 'main';
  game.state.combatStep = null;
  game.state.attackers = [];
  game.state.blockers = {};
  return game;
}
function put(game, playerNum, cardData, extra = {}) {
  const inst = game.createCardInstance(cardData, game.state.players[playerNum].field.length + 1);
  Object.assign(inst, { isSpent: false, hasGettingBearings: false }, extra);
  if (inst.currentEndurance === undefined) inst.currentEndurance = inst.endurance;
  game.state.players[playerNum].field.push(inst);
  return inst;
}
const onField = (game, p, inst) => game.state.players[p].field.some(c => c.instanceId === inst.instanceId);
const inDiscard = (game, p, inst) => game.state.players[p].discard.some(c => c.instanceId === inst.instanceId);
const pupil = CARDS.find(c => (c.type || '').includes('Pupil') && !c.ability && c.dice && c.endurance >= 3);

async function main() {
  // ---- 1. whole games, AI vs AI, seeded: must end (or hit the turn cap) without a
  //         single engine exception
  const seeds = Array.from({ length: Number(process.env.RIUTIZ_SEEDS) || 6 }, (_, i) => i + 1);
  for (const seed of seeds) {
    const env = boot(seed);
    const game = new env.RiutizGame({ mode: 'vs-ai', cardData: CARDS });
    const ai = { 1: new env.RiutizAI(game, 1), 2: new env.RiutizAI(game, 2) };
    for (const a of [ai[1], ai[2]]) { a.thinkingDelay = 0; a.actionDelay = 0; }
    game.startGame();
    game.addEventListener('turnEnded', e => { if (!game.state.gameOver && game.state.turn <= 40) env.timers.push({ fn: () => ai[e.detail.nextPlayer].takeTurn(), args: [], at: 0, id: 0 }); });
    game.addEventListener('attackersDeclared', () => { const d = game.state.currentPlayer === 1 ? 2 : 1; env.timers.push({ fn: () => ai[d].declareBlockers(), args: [], at: 0, id: 0 }); });
    let threw = null;
    try { ai[1].takeTurn(); await env.drain(); } catch (e) { threw = e.message; }
    const p = game.state.players;
    const outcome = game.state.gameOver ? `winner P${game.state.winner}` : `turn cap (${p[1].points}-${p[2].points})`;
    ok(`seed ${seed}: game ran to the end without throwing (${outcome}, turn ${game.state.turn})`, !threw && env.errors.length === 0);
    if (threw) console.log('        threw: ' + threw);
    if (env.errors.length) console.log('        ' + env.errors.slice(0, 2).join('\n        ').slice(0, 600));
    ok(`seed ${seed}: no pupil left on the field at 0 endurance`,
      [1, 2].every(n => p[n].field.every(c => !(c.type || '').includes('Pupil') || c.currentEndurance + (c.auraEnduranceBonus || 0) > 0)));
    ok(`seed ${seed}: combat state was cleared`, !game.state.combatStep);
  }

  // ---- 2. Pencil (+2/-1) on a 1-endurance pupil used to throw (exhaustPupil undefined)
  {
    const env = boot(7);
    const game = board(env);
    const pencil = put(game, 1, byAbility(/\+2\/-1/i, 'Tool'));
    const victim = put(game, 2, pupil, { currentEndurance: 1 });
    let threw = null;
    let result;
    try { result = game.activateAbility(1, pencil.instanceId, victim); } catch (e) { threw = e.message; }
    ok('Pencil on a 1-HP pupil does not throw', !threw);
    ok('Pencil resolves', result && result.success === true);
    ok('the pupil it killed left the field', !onField(game, 2, victim) && inDiscard(game, 2, victim));
  }

  // ---- 3. Illustration (deal 1 damage) on a 1-endurance pupil used to throw
  {
    const env = boot(8);
    const game = board(env);
    const ill = put(game, 1, byAbility(/spend:.*deal\s*1\s*damage to target/i, 'Tool'));
    const victim = put(game, 2, pupil, { currentEndurance: 1 });
    let threw = null;
    try { game.activateAbility(1, ill.instanceId, victim); } catch (e) { threw = e.message; }
    ok('Illustration on a 1-HP pupil does not throw', !threw);
    ok('the pupil it killed left the field', !onField(game, 2, victim));
    ok('the tool is spent', ill.isSpent === true);
  }

  // combat helper: A attacks, B blocks, resolve
  function fight(game, A, B) {
    game.state.currentPlayer = 1;
    game.state.phase = 'main';
    check('  startCombat', game.startCombat(1).success, true);
    check('  toggleAttacker', game.toggleAttacker(1, A.instanceId).success, true);
    check('  confirmAttackers', game.confirmAttackers(1).success, true);
    const tb = game.toggleBlocker(2, B.instanceId, A.instanceId);
    return { tb, res: tb.success ? game.confirmBlockers() : null };
  }

  // ---- 4. exact-lethal combat damage removes the blocker (0 endurance is dead)
  {
    const env = boot(9);
    const game = board(env);
    const A = put(game, 1, pupil, { dice: '1d1', currentEndurance: 5 });
    const B = put(game, 2, pupil, { dice: '1d1', currentEndurance: 1 });
    const { tb, res } = fight(game, A, B);
    ok('block assigned', tb.success);
    ok('combat resolved', res && res.success);
    ok('a blocker taken to exactly 0 endurance leaves the field', !onField(game, 2, B) && inDiscard(game, 2, B));
    ok('the attacker (5 HP, hit for 1) stays', onField(game, 1, A) && A.currentEndurance === 4);
  }

  // ---- 5. protection from a colour prevents that colour's combat damage
  {
    const env = boot(10);
    const game = board(env);
    const A = put(game, 1, pupil, { dice: '1d1', currentEndurance: 5 });
    const B = put(game, 2, pupil, { dice: '1d1', currentEndurance: 1 });
    B.protection = game.getAllColors(A.cost);
    const { res } = fight(game, A, B);
    ok('combat resolved', res && res.success);
    ok('protected blocker took no damage', onField(game, 2, B) && B.currentEndurance === 1);
  }

  // ---- 6. cannotBlock / unblockable are enforced in toggleBlocker
  {
    const env = boot(11);
    const game = board(env);
    const A = put(game, 1, pupil, { dice: '1d1' });
    const B = put(game, 2, pupil, { dice: '1d1', cannotBlock: true });
    game.startCombat(1); game.toggleAttacker(1, A.instanceId); game.confirmAttackers(1);
    check('cannotBlock refuses the block', game.toggleBlocker(2, B.instanceId, A.instanceId).success, false);
    B.cannotBlock = false; A.isUnblockable = true;
    check('an unblockable attacker refuses the block', game.toggleBlocker(2, B.instanceId, A.instanceId).success, false);
    A.isUnblockable = false;
    check('otherwise the block is accepted', game.toggleBlocker(2, B.instanceId, A.instanceId).success, true);
  }

  // ---- 7. Impulsive lets a fresh pupil attack; Getting Bearings still stops the rest
  {
    const env = boot(12);
    const game = board(env);
    const fresh = put(game, 1, pupil, { hasGettingBearings: true });
    const impulsive = put(game, 1, pupil, { hasGettingBearings: true, hasImpulsive: true });
    game.startCombat(1);
    check('Getting Bearings blocks the attack', game.toggleAttacker(1, fresh.instanceId).success, false);
    check('Impulsive overrides it', game.toggleAttacker(1, impulsive.instanceId).success, true);
  }

  // ---- 8. aura die modifiers reach the roll; advantage rolls twice
  {
    const env = boot(13);
    const game = board(env);
    const A = put(game, 1, pupil, { dice: '1d1', auraDieRollBonus: 2, auraDieRollPenalty: -1 });
    check('attack roll = 1 + 2 - 1', game.rollAttackDice(A), 2);
    const B = put(game, 1, pupil, { dice: '1d6', hasAdvantage: true });
    const rolls = Array.from({ length: 40 }, () => game.rollAttackDice(B));
    ok('advantage never rolls below the better of two dice (avg well above 3.5)', rolls.reduce((x, y) => x + y, 0) / rolls.length > 3.9);
  }

  // ---- 9. end-of-turn processing runs (Regen), end-of-combat +1 is taken back
  {
    const env = boot(14);
    const game = board(env);
    const regen = byAbility(/regen/i, 'Pupil');
    const R = put(game, 1, regen, { currentEndurance: 1 });
    game.endTurn(1);
    ok('Regen restores endurance at the end of its controller\'s turn', R.currentEndurance === (R.baseEndurance || R.endurance));
  }
  {
    const env = boot(15);
    const game = board(env);
    const A = put(game, 1, pupil, { dice: '1d1', currentEndurance: 9 });
    A.tempBuffs = [{ type: 'dieRollBonus', value: 1, expiresAt: 'endOfCombat' }];
    A.dieRollBonus = 1;
    const B = put(game, 2, pupil, { dice: '1d1', currentEndurance: 9 });
    fight(game, A, B);
    check('end-of-combat die bonus is reverted', A.dieRollBonus, 0);
    check('the buff itself is gone', (A.tempBuffs || []).length, 0);
  }

  // ---- 10. "cannot attack or block until your next turn" expires
  {
    const env = boot(16);
    const game = board(env);
    const locked = put(game, 2, pupil, { cannotAttack: true, cannotBlock: true, tempBuffs: [{ type: 'manipulation', expiresAt: 'nextTurn', owner: 1 }] });
    game.beginTurn(2);
    ok('still locked during the victim\'s own next turn', locked.cannotAttack && locked.cannotBlock);
    game.beginTurn(1);
    ok('unlocked when the controller\'s next turn begins', !locked.cannotAttack && !locked.cannotBlock);
  }

  // ---- 11. AI: valuation is finite for string attack values; the AI resolves its own blocks
  {
    const env = boot(17);
    const game = board(env);
    const ai = new env.RiutizAI(game, 2);
    ai.thinkingDelay = 0; ai.actionDelay = 0;
    const weird = CARDS.find(c => typeof c.ad === 'string');
    ok(`evaluateCardValue is finite for ad="${weird.ad}"`, Number.isFinite(ai.evaluateCardValue(game.createCardInstance(weird, 1))));
    const A = put(game, 1, pupil, { dice: '1d1', currentEndurance: 9 });
    put(game, 2, pupil, { dice: '1d1', currentEndurance: 9 });
    game.startCombat(1); game.toggleAttacker(1, A.instanceId); game.confirmAttackers(1);
    check('  combat waits on blockers', game.state.combatStep, 'declare-blockers');
    ai.declareBlockers();
    await env.drain();
    ok('the AI confirms its blockers and combat resolves', !game.state.combatStep);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
