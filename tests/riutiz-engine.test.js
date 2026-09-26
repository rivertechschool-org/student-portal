// RIUTIZ plays whole games to the end.
//
// The rules and the cards are checked one at a time in riutiz-rules and
// riutiz-cards. This plays complete AI-vs-AI games - every starter deck
// against every other from both seats, plus random 40-card decks that reach
// cards no starter holds - under a seeded Math.random, and checks after every
// action that the game is still sound:
//
//   - nothing throws and nothing is logged as an error;
//   - every game FINISHES (a choice nobody can answer, or a turn handed to a
//     player who never acts, used to freeze a game - The Hacker did);
//   - no card is created or lost: hand + deck + field + discard + resource
//     cards + set-aside always add up to 40 per player (tokens aside);
//   - no pupil sits in play at 0 Endurance, and combat is always cleared.
//
// Run: node tests/riutiz-engine.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const G = path.join(__dirname, '..', 'games');
const CARDS = JSON.parse(fs.readFileSync(path.join(G, 'Data', 'Riutiz', 'cards.json'), 'utf8'));
const DECKS = JSON.parse(fs.readFileSync(path.join(G, 'Data', 'Riutiz', 'starter-decks.json'), 'utf8')).starter_decks;
const SRC = ['RiutizCards.js', 'RiutizGame.js', 'RiutizAI.js'].map(f => fs.readFileSync(path.join(G, 'riutiz', f), 'utf8')).join('\n');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; }
    else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function boot(seed) {
    const timers = [];
    const errors = [];
    let s = (seed >>> 0) || 1;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const sb = {
        console: { log() {}, info() {}, warn() {}, error: (...a) => errors.push(a.map(x => (x && x.stack) || String(x)).join(' ')) },
        setTimeout: (fn, ms, ...args) => { timers.push({ fn, args }); return timers.length; },
        clearTimeout() {},
        EventTarget, CustomEvent, Event, __rnd: rnd
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC + '\nMath.random = __rnd;', sb);
    return {
        RiutizGame: vm.runInContext('RiutizGame', sb), RiutizAI: vm.runInContext('RiutizAI', sb), errors,
        later(fn) { timers.push({ fn, args: [] }); },
        async drain() {
            for (let n = 0; n < 400000; n++) {
                await new Promise(r => setImmediate(r));
                if (!timers.length) { await new Promise(r => setImmediate(r)); if (!timers.length) return; }
                const t = timers.shift(); t.fn(...t.args);
            }
            throw new Error('drain limit');
        }
    };
}

function cardCount(g, p) {
    const pl = g.state.players[p];
    const real = c => !c.isToken;
    const owned = c => (c.owner || p) === p;
    const inPlay = [...g.state.players[1].field, ...g.state.players[2].field].filter(c => real(c) && owned(c)).length;
    // a card that makes two pips is two resources but one card
    const resources = new Set(pl.resources.filter(r => r.card && !r.card.isToken).map(r => r.card.instanceId)).size;
    return pl.hand.length + pl.deck.length + inPlay + pl.discard.length + resources + (pl.setAside || []).length;
}

async function play(seed, deck1, deck2, label) {
    const env = boot(seed);
    const g = new env.RiutizGame({ cardData: CARDS, player1Deck: deck1, player2Deck: deck2 });
    const ai = { 1: new env.RiutizAI(g, 1, { thinkingDelay: 0, actionDelay: 0 }), 2: new env.RiutizAI(g, 2, { thinkingDelay: 0, actionDelay: 0 }) };
    const problems = [];
    const sizes = {};
    const audit = (when) => {
        if (!g.state) return;
        for (const p of [1, 2]) {
            const n = cardCount(g, p);
            if (sizes[p] === undefined) sizes[p] = n;
            else if (n !== sizes[p] && problems.length < 3) problems.push(`${when}: player ${p} has ${n} cards, started with ${sizes[p]}`);
        }
        const dead = g.allPupils().filter(c => c.currentEndurance <= 0);
        if (dead.length && problems.length < 3) problems.push(`${when}: ${dead.map(c => c.name).join(', ')} in play at 0 Endurance`);
    };
    ['cardPlayed', 'cardPlayedAsResource', 'abilityActivated', 'choiceResolved', 'combatResolved', 'turnEnded'].forEach(t =>
        g.addEventListener(t, () => audit(t)));
    g.addEventListener('turnEnded', e => { if (!g.state.gameOver && g.state.turn <= 120) env.later(() => ai[e.detail.nextPlayer].takeTurn()); });
    g.addEventListener('attackersDeclared', () => { const d = g.state.currentPlayer === 1 ? 2 : 1; env.later(() => ai[d].declareBlockers()); });
    let threw = null;
    try {
        g.startGame();
        audit('start');
        ai[1].takeTurn();
        await env.drain();
    } catch (e) { threw = e.stack || String(e); }
    ok(`${label}: no exception`, !threw);
    if (threw) console.log('        ' + threw.split('\n').slice(0, 3).join('\n        '));
    ok(`${label}: nothing logged as an error`, env.errors.length === 0);
    if (env.errors.length) console.log('        ' + env.errors[0].slice(0, 400));
    ok(`${label}: the game finished (turn ${g.state.turn}, ${g.state.players[1].points}-${g.state.players[2].points})`, g.state.gameOver);
    ok(`${label}: combat was cleared`, !g.state.combatStep);
    check(`${label}: cards neither created nor lost, and no pupil at 0`, problems, []);
    return g;
}

(async () => {
    console.log('\n== every starter deck against every other, both seats ==\n');
    let seed = 1;
    for (let i = 0; i < DECKS.length; i++) {
        for (let j = 0; j < DECKS.length; j++) {
            await play(seed++, DECKS[i].deck_list, DECKS[j].deck_list, `${DECKS[i].name} v ${DECKS[j].name}`);
        }
    }
    console.log('\n== random decks: every card gets a chance to be played ==\n');
    const pool = CARDS.filter(c => c.type !== 'Location');
    for (let k = 0; k < 30; k++) {
        const env = boot(1000 + k);
        const rnd = () => vm.runInContext('Math.random()', vm.createContext({ Math }));
        let s = 1000 + k;
        const pick = () => { s = (s * 1103515245 + 12345) >>> 0; return pool[s % pool.length].id; };
        const d1 = Array.from({ length: 40 }, pick), d2 = Array.from({ length: 40 }, pick);
        await play(2000 + k, d1, d2, `random decks #${k + 1}`);
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
