// RIUTIZ plays by its rules.
//
// tests/riutiz-cards.test.js proves every card DOES something. This proves the
// rules and the triggered abilities do the RIGHT thing, one situation at a
// time, with the dice fixed so each outcome is exact. The rules are the help
// text in games/riutiz.html; the rulings the cards leave open are in
// games/riutiz/RULES.md.
//
// Run: node tests/riutiz-rules.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const G = path.join(__dirname, '..', 'games');
const CARDS = JSON.parse(fs.readFileSync(path.join(G, 'Data', 'Riutiz', 'cards.json'), 'utf8'));
const SRC = ['RiutizCards.js', 'RiutizGame.js'].map(f => fs.readFileSync(path.join(G, 'riutiz', f), 'utf8')).join('\n');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log(`pass  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

const sb = { console: { log() {}, warn() {}, error() {} }, EventTarget, CustomEvent, Event };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(SRC, sb);
const RiutizGame = vm.runInContext('RiutizGame', sb);
const byId = id => CARDS.find(c => String(c.id) === String(id));
const byName = n => CARDS.find(c => c.name === n);

// A vanilla deck so nothing in the draw pile interferes
const VANILLA = CARDS.filter(c => c.type === 'Basic Pupil' && (!c.ability || /^(None|-)?$/.test(c.ability.trim())) && /d\d/.test(c.dice || ''));

// A game with empty boards, both players on 0, it being player 1's main phase.
// Dice rolls come from a queue: g.rolls = [4, 2] means the next rolls are 4 then 2.
function newGame(opts = {}) {
    const deck = Array.from({ length: 40 }, (_, i) => VANILLA[i % VANILLA.length].id);
    const g = new RiutizGame({ cardData: CARDS, player1Deck: deck, player2Deck: deck });
    g.rolls = [];
    g.coins = [];
    g.rollDie = function (sides) { return this.rolls.length ? this.rolls.shift() : Math.ceil(sides / 2); };
    g.flipCoin = function () { return this.coins.length ? this.coins.shift() : true; };
    g.startGame();
    for (const p of [1, 2]) {
        g.state.players[p].hand = [];
        for (let i = 0; i < (opts.resources ?? 10); i++) g.addResource(p, { anyColor: true, colors: ['O', 'G', 'P', 'B', 'Bk'] });
    }
    return g;
}

// Put a card straight into play, ready to act.
function put(g, p, idOrName, extra = {}) {
    const data = typeof idOrName === 'string' && isNaN(Number(idOrName)) ? byName(idOrName) : byId(idOrName);
    if (!data) throw new Error('no card ' + idOrName);
    const c = g.createCardInstance(data, p, g.state.nextId++);
    g.putIntoPlay(p, c);
    c.hasGettingBearings = false;
    Object.assign(c, extra);
    g.refreshAll();
    return c;
}
function hand(g, p, idOrName) {
    const data = typeof idOrName === 'string' && isNaN(Number(idOrName)) ? byName(idOrName) : byId(idOrName);
    const c = g.createCardInstance(data, p, g.state.nextId++);
    g.state.players[p].hand.push(c);
    return c;
}
// Attack with the given pupils; blocks is { attackerId: blockerId }.
function attack(g, p, attackers, blocks = {}) {
    g.state.currentPlayer = p; g.state.phase = 'main'; g.state.combatStep = null;
    g.state.players[p].flags.combatDone = false;
    const r0 = g.startCombat(p);
    if (!r0.success) return r0;
    for (const a of attackers) { const r = g.toggleAttacker(p, a.instanceId); if (!r.success) return r; }
    const r1 = g.confirmAttackers(p);
    if (!r1.success || r1.skipped) return r1;
    answer(g);
    for (const [a, b] of Object.entries(blocks)) { const r = g.toggleBlocker(g.other(p), b, a); if (!r.success) return r; }
    return g.confirmBlockers(g.other(p));
}
function answer(g, pick = q => q.options.slice(0, Math.max(q.min, 1)).map(o => o.value)) {
    for (let i = 0; i < 10 && g.pendingChoice; i++) g.resolveChoice(g.pendingChoice.player, pick(g.pendingChoice));
}
const inPlay = (g, c) => !!g.findInPlay(c.instanceId);
const pts = (g, p) => g.state.players[p].points;

console.log('\n== turns ==\n');
{
    const g = newGame();
    const deck = new RiutizGame({ cardData: CARDS }); // for sizes
    check('player 1 starts with 7 cards and does not draw on turn 1', new RiutizGame({ cardData: CARDS }).handSize, 7);
    const g2 = new RiutizGame({ cardData: CARDS }); g2.startGame();
    check('  after start, player 1 holds 7', g2.state.players[1].hand.length, 7);
    g2.endTurn(1);
    check('  player 2 draws at the start of their turn', g2.state.players[2].hand.length, 8);
    check('  it is player 2\'s main phase', [g2.state.currentPlayer, g2.state.phase], [2, 'main']);
}
{
    const g = newGame();
    const a = hand(g, 1, 3), b = hand(g, 1, 45);
    ok('one resource per turn', g.playCard(1, a.instanceId, true).success && !g.playCard(1, b.instanceId, true).success);
    const g2 = newGame();
    const r = hand(g2, 1, 'Reinforcement'); const x = hand(g2, 1, 3), y = hand(g2, 1, 45);
    g2.playCard(1, r.instanceId);
    ok('Reinforcement lets you play a second', g2.playCard(1, x.instanceId, true).success && g2.playCard(1, y.instanceId, true).success);
}
{
    const g = newGame({ resources: 0 });
    g.addResource(1, { colors: ['O', 'P'] }); g.addResource(1, { colors: ['O'] }); g.addResource(1, { colors: ['G'] });
    ok('(1)(O)(P) is payable from O/P, O, G (the old greedy check said no)', g.canPay('(1)(O)(P)', 1));
    ok('(O)(O)(P) is not', !g.canPay('(O)(O)(P)', 1));
}
{
    const g = newGame();
    const a = hand(g, 1, 3);
    g.state.currentPlayer = 2;
    ok('a card cannot be played on the other player\'s turn', !g.playCard(1, a.instanceId).success);
}

console.log('\n== combat ==\n');
{
    const g = newGame();
    const a = put(g, 1, 'Architecture Enthusiast');           // 1d6
    g.rolls = [5];
    attack(g, 1, [a]);
    check('an unblocked pupil scores its ROLL, not its AD (AD is 3, roll 5)', pts(g, 1), 5);
    ok('  and attacking spends it', a.isSpent);
}
{
    const g = newGame();
    const a = put(g, 1, 'Architecture Enthusiast');           // 1d6, 3 end
    const b = put(g, 2, 'Biology Enthusiast');                // 1d6, 7 end
    g.rolls = [4, 3];
    attack(g, 1, [a], { [a.instanceId]: b.instanceId });
    check('blocked: no points', pts(g, 1), 0);
    check('  the blocker takes the attacker\'s roll', b.damage, 4);
    ok('  the blocker rolls back, and 3 exhausts a 3-endurance attacker', !inPlay(g, a));
}
{
    const g = newGame();
    const a = put(g, 1, 'Dialectology Enthusiast');           // Lethal
    const b = put(g, 2, 'Biology Enthusiast');
    g.rolls = [1, 1];
    attack(g, 1, [a], { [a.instanceId]: b.instanceId });
    ok('Lethal: 1 damage exhausts a 7-endurance blocker', !inPlay(g, b));
}
{
    const g = newGame();
    const a = put(g, 1, 'Architecture Enthusiast');
    const b = put(g, 2, 'Dialectology Enthusiast');           // Lethal, blocking
    g.rolls = [1, 1];
    attack(g, 1, [a], { [a.instanceId]: b.instanceId });
    ok('Lethal works for a blocker too', !inPlay(g, a));
}
{
    const g = newGame();
    const a = put(g, 1, 'Dialectology Enthusiast');           // Lethal
    const b = put(g, 2, 'Functions Professor, Jordan');       // Stubborn, 1 end
    g.rolls = [6, 1];
    attack(g, 1, [a], { [a.instanceId]: b.instanceId });
    ok('Stubborn is not exhausted by damage, lethal or not', inPlay(g, b) && b.currentEndurance === 1);
}
{
    const g = newGame();
    const a = put(g, 1, 'Drama Queen');                        // first strike, 1d10, 2 end
    const b = put(g, 2, 'The Back Talker');                    // 1d4, 2 end
    g.rolls = [5, 4];
    attack(g, 1, [a], { [a.instanceId]: b.instanceId });
    ok('first strike: the blocker dies before it can hit back', !inPlay(g, b) && inPlay(g, a) && a.damage === 0);
}
{
    const g = newGame();
    const a = put(g, 1, 'Architecture Enthusiast');
    const b = put(g, 2, 'Biology Enthusiast'); b.counters.shield = 1;
    g.rolls = [6, 1];
    attack(g, 1, [a], { [a.instanceId]: b.instanceId });
    check('a shield counter absorbs a hit and is used up', [b.damage, b.counters.shield], [0, 0]);
}
{
    const g = newGame();
    const a = put(g, 1, 'Train Enthusiast');                   // Overwhelm, 1d6
    const b = put(g, 2, 'The Back Talker');                    // 2 end
    g.rolls = [6, 1];
    attack(g, 1, [a], { [a.instanceId]: b.instanceId });
    check('Overwhelm scores the damage beyond the blocker\'s Endurance (6 into 2)', pts(g, 1), 4);
}
{
    const g = newGame();
    const a = put(g, 1, 'Circuit Enthusiast');                 // 1d8, 7 end
    const b = put(g, 2, 'Shop Teacher');                       // Rebuttal 3
    g.rolls = [2, 1];
    attack(g, 1, [a], { [a.instanceId]: b.instanceId });
    check('Rebuttal 3: the attacker takes its roll back plus 3', a.damage, 4);
    const g2 = newGame();
    const a2 = put(g2, 1, 'Circuit Enthusiast');
    const b2 = put(g2, 2, 'Dioptrics Enthusiast');             // Rebuttal (equal), 0 dice
    g2.rolls = [5];
    attack(g2, 1, [a2], { [a2.instanceId]: b2.instanceId });
    check('Rebuttal (equal): the damage taken comes straight back', a2.damage, 5);
    const g3 = newGame();
    const a3 = put(g3, 1, 'Circuit Enthusiast');
    const b3 = put(g3, 2, 'Greaser');                          // Rebuttal (lethal)
    g3.rolls = [1, 1];
    attack(g3, 1, [a3], { [a3.instanceId]: b3.instanceId });
    ok('Rebuttal (lethal): hurting Greaser exhausts the attacker', !inPlay(g3, a3));
}
{
    const g = newGame();
    const a = put(g, 1, 'Architecture Enthusiast', { hasGettingBearings: true });
    check('Getting Bearings: cannot attack the turn it enters', attack(g, 1, [a]).success, false);
    const g2 = newGame();
    put(g2, 1, 'Parking Lot');
    const a2 = put(g2, 1, 'Architecture Enthusiast', { hasGettingBearings: true });
    ok('Parking Lot gives every pupil Impulsive', attack(g2, 1, [a2]).success);
}
{
    const g = newGame();
    const a = put(g, 1, 'Simba', { isSpent: true });           // Relentless
    ok('Relentless attacks while spent', attack(g, 1, [a]).success);
    const g2 = newGame();
    const s = put(g2, 1, 'Scooter');                           // Grounded
    check('Grounded cannot attack', attack(g2, 1, [s]).success, false);
    const g3 = newGame();
    const x = put(g3, 1, 'Architecture Enthusiast');
    const s3 = put(g3, 2, 'Scooter');
    g3.rolls = [1, 1];
    ok('  but can block', attack(g3, 1, [x], { [x.instanceId]: s3.instanceId }).success && s3.damage === 1);
    const g4 = newGame();
    const t = put(g4, 1, 'Psychology Teacher');
    ok('Psychology Teacher CAN attack (the old text-match said "cannot attack")', attack(g4, 1, [t]).success);
}
{
    const g = newGame();
    const t = put(g, 1, 'The Tool');                           // must be blocked if possible
    put(g, 2, 'Biology Enthusiast');
    g.startCombat(1); g.toggleAttacker(1, t.instanceId); g.confirmAttackers(1);
    check('The Tool must be blocked when a blocker is free', g.confirmBlockers(2).success, false);
}

console.log('\n== winning and ending ==\n');
{
    const g = newGame();
    g.state.players[1].points = 23;
    const a = put(g, 1, 'Architecture Enthusiast');
    g.rolls = [4];
    attack(g, 1, [a]);
    check('reaching 25 wins', [g.state.gameOver, g.state.winner], [true, 1]);
}
{
    const g = newGame();
    g.state.players[2].points = 24;
    put(g, 2, 'Free Spirit');
    g.coins = [true];
    g.endTurn(1);
    check('a point outside combat (Free Spirit) also wins at once', [g.state.gameOver, g.state.winner], [true, 2]);
}
{
    const g = newGame();
    g.state.players[2].deck = [];
    g.state.players[1].points = 3; g.state.players[2].points = 9;
    g.endTurn(1);
    check('drawing from an empty deck ends the game: more points wins', [g.state.gameOver, g.state.winner, g.state.endReason], [true, 2, 'deck']);
    const g2 = newGame();
    g2.state.players[2].deck = [];
    g2.state.players[1].points = 5; g2.state.players[2].points = 5;
    g2.endTurn(1);
    check('  and on a tie, whoever ran out loses', g2.state.winner, 1);
}

console.log('\n== costs, locations, durations ==\n');
{
    const g = newGame({ resources: 0 });
    g.addResource(1, { colors: ['C'] });
    put(g, 1, 'The Workshop');
    const t = hand(g, 1, 'Gold Coin');                          // (1) Tool
    const pencil = hand(g, 1, 'Flashcards');                    // (2) Tool
    ok('The Workshop: a (2) Tool costs (1)', g.canAfford(pencil, 1));
    const g2 = newGame();
    put(g2, 1, 'Parking Lot');
    const loc = hand(g2, 2, 'Field');
    g2.state.currentPlayer = 2;
    g2.playCard(2, loc.instanceId);
    check('one location at a time: a new one replaces the old', g2.allFieldCards().filter(c => c.type === 'Location').map(c => c.name), ['Field']);
}
{
    const g = newGame();
    const p = put(g, 1, 'Biology Enthusiast');                  // 7 end
    const w = hand(g, 1, 'Wild Gesture');
    g.playCard(1, w.instanceId, false, { targets: [p.instanceId] });
    check('Wild Gesture: +3/-2 this turn', [p.dieRollBonus, p.currentEndurance], [3, 5]);
    g.endTurn(1);
    check('  and it all comes back at end of turn (it used to be permanent)', [p.dieRollBonus, p.currentEndurance], [0, 7]);
}
{
    const g = newGame();
    const ro = put(g, 1, 'Resource Officer');
    const victim = put(g, 2, 'Biology Enthusiast');
    // play a second Resource Officer from hand to use the enter effect
    const ro2 = hand(g, 1, 'Resource Officer');
    g.playCard(1, ro2.instanceId, false, { targets: [victim.instanceId] });
    ok('Lockdown: cannot attack or block', g.cannotAttack(victim) && g.cannotBlock(victim));
    g.exhaust(g.findInPlay(ro2.instanceId));
    ok('  and it ends when the Resource Officer leaves (it used to be permanent)', !g.cannotAttack(victim) && !g.cannotBlock(victim));
}
{
    const g = newGame();
    const loner = put(g, 1, 'The Loner');                       // Closed-Minded, 8 end
    put(g, 1, 'Structural Design Teacher');                      // other pupils +2 end
    check('Closed-Minded ignores its own side\'s buffs', loner.currentEndurance, 8);
    put(g, 2, 'Authoritarian Parent');                           // opponents -1 die
    check('  but not the opponent\'s penalties', loner.dieRollBonus, -1);
    const g2 = newGame();
    const cad = put(g2, 1, 'CAD Designer');                      // Precision
    put(g2, 2, 'Authoritarian Parent');
    check('Precision: opponent effects do not change its rolls', cad.dieRollBonus, 0);
}
{
    const g = newGame();
    const a = put(g, 1, 'Architecture Enthusiast');
    g.addMod(a, { keywords: ['nonSequitur'], until: 'endOfTurn' }, 2);
    g.rolls = [4]; g.coins = [true];
    attack(g, 1, [a]);
    check('Non-Sequitur: heads doubles the roll', pts(g, 1), 8);
    const g2 = newGame();
    const b = put(g2, 1, 'Architecture Enthusiast');
    g2.addMod(b, { keywords: ['nonSequitur'], until: 'endOfTurn' }, 2);
    g2.rolls = [4]; g2.coins = [false];
    attack(g2, 1, [b]);
    check('  tails makes it nothing', pts(g2, 1), 0);
}

console.log('\n== triggered abilities ==\n');
{
    const g = newGame();
    const j = put(g, 1, 'Jock');                                 // 1d4
    g.rolls = [3];
    attack(g, 1, [j]);
    check('Jock: scoring upgrades its die to a d6', g.diceLabel(j), '1d6');
    const g2 = newGame();
    const j2 = put(g2, 1, 'Jock', { isSpent: true });
    const other = put(g2, 1, 'Architecture Enthusiast');
    g2.rolls = [3];
    attack(g2, 1, [other]);
    check('  but not when another pupil scores (it used to)', g2.diceLabel(j2), '1d4');
}
{
    const g = newGame();
    const t = put(g, 1, 'Chemistry Teacher');
    const hurt = put(g, 1, 'Biology Enthusiast', { damage: 3 });
    const a = put(g, 2, 'Architecture Enthusiast');
    g.state.currentPlayer = 2; g.rolls = [2];
    attack(g, 2, [a]);
    check('Chemistry Teacher heals after combat - defending too', hurt.damage, 2);
}
{
    const g = newGame();
    const bio = put(g, 1, 'Biology Teacher');
    const victim = put(g, 2, 'The Back Talker');
    g.dealDamage(victim, 5, null, {}); g.checkStateBasedActions();
    check('Biology Teacher: +1 when another pupil is exhausted', bio.dieRollBonus, 1);
}
{
    const g = newGame();
    const c = put(g, 1, 'Calculus Enthusiast');
    g.endTurn(1); g.endTurn(2);
    check('Calculus Enthusiast grows at the start of your turn', c.dieRollBonus, 1);
}
{
    const g = newGame();
    put(g, 1, 'Lunch Lady');
    const hurt = put(g, 1, 'Biology Enthusiast', { damage: 3 });
    g.endTurn(1); g.endTurn(2);
    check('Lunch Lady heals each of your pupils at upkeep', hurt.damage, 2);
}
{
    const g = newGame();
    put(g, 1, 'The Amphitheater');
    const v = put(g, 2, 'The Back Talker');
    const before = g.state.players[2].hand.length;
    g.dealDamage(v, 5, null, {}); g.checkStateBasedActions();
    check('The Amphitheater: the exhausted pupil\'s controller draws', g.state.players[2].hand.length, before + 1);
    const g2 = newGame();
    const r = put(g2, 1, 'Run-away Parent');
    const b2 = g2.state.players[1].hand.length;
    g2.dealDamage(r, 5, null, {}); g2.checkStateBasedActions();
    check('Run-away Parent draws when exhausted', g2.state.players[1].hand.length, b2 + 1);
}
{
    const g = newGame();
    put(g, 1, 'Dancer');
    const v = put(g, 2, 'Biology Enthusiast');
    const card = hand(g, 1, 'Theorem');
    g.playCard(1, card.instanceId);
    ok('Dancer: playing an Interruption asks for a target', g.pendingChoice && g.pendingChoice.player === 1);
    g.resolveChoice(1, [v.instanceId]);
    check('  and deals 1 damage to it', v.damage, 1);
}
{
    const g = newGame();
    put(g, 2, 'Authoritative Principal, Jordan');
    g.state.players[1].points = 5;
    const a = put(g, 1, 'Architecture Enthusiast'), b = put(g, 1, 'The Back Talker');
    g.rolls = [1, 1];
    attack(g, 1, [a, b]);
    check('Authoritative Principal: the ATTACKING player loses 1 per attacker (it used to hit its own controller)', pts(g, 1), 5 - 2 + 2);
}
{
    const g = newGame();
    const lp = put(g, 1, 'Latin Professor');                     // Rampage
    const b = put(g, 2, 'The Back Talker');                      // only defender
    g.rolls = [5, 1];
    attack(g, 1, [lp], { [lp.instanceId]: b.instanceId });
    check('Latin Professor: Rampage with no other defender scores the damage', pts(g, 1), 5);
}
{
    const g = newGame();
    const ex = put(g, 1, 'Ex-Astronaut');
    g.rolls = [4];
    attack(g, 1, [ex]);
    check('Ex-Astronaut: Momentum carries an unblocked roll to the next attack', ex.dieRollBonus, 4);
}
{
    const g = newGame();
    put(g, 1, 'Confusion Matrix'); put(g, 2, 'Confusion Matrix');
    const h1 = g.state.players[1].hand.length, h2 = g.state.players[2].hand.length;
    g.draw(2, 1);
    check('two Confusion Matrices do not loop: each draws once', [g.state.players[1].hand.length - h1, g.state.players[2].hand.length - h2], [1, 1]);
}
{
    const g = newGame();
    const dan = hand(g, 1, 63);
    g.playCard(1, dan.instanceId);
    const target = g.pendingChoice.options[0].value;
    g.resolveChoice(1, [target]);
    ok('Discovery Principal sets a card aside', g.state.players[1].setAside.length === 1);
    for (let i = 0; i < 3; i++) { g.endTurn(1); g.endTurn(2); }
    const c = g.state.players[1].hand.find(x => x.instanceId === target);
    ok('  three upkeeps later it is in your hand, free to play', c && c.freeToPlay && g.effectiveCost(c, 1).generic === 0);
}
{
    const g = newGame();
    const poc = hand(g, 1, 'Proof of Concept');
    g.playCard(1, poc.instanceId);
    g.endTurn(1);
    const t = hand(g, 2, 'Theorem');
    const before = g.state.players[2].hand.length;
    g.playCard(2, t.instanceId);
    check('Proof of Concept refutes the opponent\'s next Interruption', g.state.players[2].hand.length, before - 1);
}
{
    const g = newGame();
    const a = put(g, 1, 'Architecture Enthusiast');
    g.startCombat(1); g.toggleAttacker(1, a.instanceId); g.confirmAttackers(1);
    const fp = hand(g, 2, 'Flash Point');
    const r = g.playCard(2, fp.instanceId, false, { targets: [a.instanceId] });
    ok('Flash Point can be played by the defender during blocks', r.success);
    g.confirmBlockers(2);
    check('  and the refuted attack scores nothing, the attacker stays spent', [pts(g, 1), a.isSpent], [0, true]);
    const g2 = newGame();
    const a2 = put(g2, 1, 'Architecture Enthusiast');
    g2.startCombat(1); g2.toggleAttacker(1, a2.instanceId); g2.confirmAttackers(1);
    const to = hand(g2, 2, 'Time Out');
    g2.playCard(2, to.instanceId);
    check('Time Out ends the combat', [g2.state.combatStep, pts(g2, 1)], [null, 0]);
}
{
    const g = newGame();
    const t = put(g, 1, 'Psychology Teacher');
    const v = put(g, 2, 'Biology Enthusiast');
    g.activateAbility(1, t.instanceId, 0, { targets: [v.instanceId] });
    g.endTurn(1);
    ok('Psychology Teacher: still locked through the opponent\'s turn', g.cannotAttack(v) && g.cannotBlock(v));
    g.endTurn(2);
    ok('  and free again at your next turn', !g.cannotAttack(v));
}
{
    const g = newGame();
    const p = put(g, 1, 'Biology Enthusiast');
    const oc = hand(g, 1, 'Overclock');
    g.playCard(1, oc.instanceId, false, { targets: [p.instanceId] });
    g.endTurn(1);
    check('Overclock: 2 damage at end of turn', p.damage, 2);
}
{
    const g = newGame();
    const p = put(g, 1, 'Architecture Enthusiast');
    const v = put(g, 2, 'The Back Talker');
    const ft = hand(g, 1, 'Field Test');
    g.playCard(1, ft.instanceId, false, { targets: [p.instanceId] });
    g.rolls = [4, 1];
    attack(g, 1, [p], { [p.instanceId]: v.instanceId });
    g.endTurn(1);
    check('Field Test: the +2/+2 stays after it exhausts a pupil', p.dieRollBonus, 2);
}
{
    const g = newGame();
    const t = put(g, 1, 'Tetrix');
    g.coins = [true];
    g.activateAbility(1, t.instanceId, 0);
    g.endTurn(1);
    check('Tetrix heads: the opponent skips their next turn', g.state.currentPlayer, 1);
}
{
    const g = newGame();
    const tool = put(g, 2, 'Pencil');
    const mw = hand(g, 1, 'Malware');
    g.playCard(1, mw.instanceId, false, { targets: [tool.instanceId] });
    check('Malware takes a Tool', g.controllerOf(tool), 1);
    g.endTurn(1);
    check('  and it goes back at end of turn', g.controllerOf(tool), 2);
}
{
    const g = newGame();
    const t = put(g, 1, 'Trigonometry Enthusiast');
    const src = put(g, 2, 'Biology Enthusiast');
    g.rolls = [3, 2];
    attack(g, 2, [src], { [src.instanceId]: t.instanceId });
    check('Trigonometry Enthusiast sends its damage back to the attacker', [t.damage, src.damage], [0, 2 + 3]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
