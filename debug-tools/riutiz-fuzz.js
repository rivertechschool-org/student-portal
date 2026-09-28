// RIUTIZ fuzzer: games of RANDOM moves, checked after every one.
//
// The AI only makes sensible moves, and the tests only the moves someone
// thought of. This plays whole games where every move is picked at random
// from everything the engine says is legal - odd targets, strange modes,
// blockers toggled back and forth, choices answered any valid way - plus a
// share of deliberately ILLEGAL requests (unknown ids, out of turn, wrong
// step), which must be refused without changing anything. After every move:
//
//   - nothing threw;
//   - no card was created or lost (hand + deck + field + discard + resource
//     cards + set aside, per owner);
//   - no pupil is in play at 0 Endurance; attackers and blockers are real
//     pupils in play on the right sides; points are never negative;
//   - the state survives save and reload unchanged.
//
//   node debug-tools/riutiz-fuzz.js [games] [seed]
//
// Prints the first failures with the seed and move that caused them, so a
// failure can be replayed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const G = path.join(__dirname, '..', 'games');
const CARDS = JSON.parse(fs.readFileSync(path.join(G, 'Data', 'Riutiz', 'cards.json'), 'utf8'));
const SRC = ['RiutizCards.js', 'RiutizGame.js'].map(f => fs.readFileSync(path.join(G, 'riutiz', f), 'utf8')).join('\n');
const GAMES = parseInt(process.argv[2], 10) || 300;
const SEED0 = parseInt(process.argv[3], 10) || 1;

function boot(seed) {
    let s = seed >>> 0 || 1;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const errors = [];
    const sb = { console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) }, EventTarget, CustomEvent, Event, __rnd: rnd };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC + '\nMath.random = __rnd;', sb);
    return { RiutizGame: vm.runInContext('RiutizGame', sb), rnd, errors };
}

function ownedCount(g, p) {
    const pl = g.state.players[p];
    const inPlay = [...g.state.players[1].field, ...g.state.players[2].field].filter(c => !c.isToken && (c.owner || p) === p).length;
    const res = new Set(pl.resources.filter(r => r.card && !r.card.isToken && (r.card.owner || p) === p).map(r => r.card.instanceId)).size;
    // a card of this owner sitting in the OTHER player's discard/hand is still this owner's
    let elsewhere = 0;
    const other = g.state.players[p === 1 ? 2 : 1];
    for (const z of ['hand', 'deck', 'discard']) elsewhere += other[z].filter(c => c.owner === p).length;
    const own = z => pl[z].filter(c => (c.owner || p) === p).length;
    return own('hand') + own('deck') + own('discard') + inPlay + res + (pl.setAside || []).length + elsewhere;
}

function invariants(g, sizes) {
    const probs = [];
    const s = g.state;
    for (const p of [1, 2]) {
        const n = ownedCount(g, p);
        if (n !== sizes[p]) probs.push(`player ${p} owns ${n} cards, started with ${sizes[p]}`);
        if (s.players[p].points < 0) probs.push(`player ${p} has ${s.players[p].points} points`);
    }
    if (!s.gameOver) {
        const dead = g.allPupils().filter(c => c.currentEndurance <= 0);
        if (dead.length && !s.pending.length) probs.push(`${dead.map(c => c.name).join(', ')} in play at 0 Endurance`);
    }
    for (const a of s.attackers) {
        const c = g.findInPlay(a.instanceId);
        if (!c) probs.push(`attacker ${a.name} is not in play`);
        else if (g.controllerOf(c) !== s.currentPlayer) probs.push(`attacker ${a.name} is not the attacking player's`);
    }
    for (const att of Object.keys(s.blockers)) {
        if (!s.attackers.some(a => a.instanceId === att)) probs.push('a block on something not attacking');
        for (const b of g.blockersOf(att)) {
            const c = g.findInPlay(b);
            if (!c) probs.push('a blocker not in play');
            else if (g.controllerOf(c) === s.currentPlayer) probs.push(`${c.name} blocks its own side`);
        }
    }
    const ids = new Set();
    for (const p of [1, 2]) for (const z of ['hand', 'deck', 'discard', 'field']) for (const c of s.players[p][z]) {
        if (ids.has(c.instanceId)) probs.push(`${c.name} is in two places`);
        ids.add(c.instanceId);
    }
    return probs;
}

function roundTrip(g, RiutizGame) {
    const a = JSON.stringify(g.getSerializableState());
    const h = new RiutizGame({ cardData: CARDS });
    h.loadState(JSON.parse(a));
    const b = JSON.stringify(h.getSerializableState());
    return a === b ? null : 'state changes when saved and reloaded';
}

function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

// Every legal move for whoever may act now, plus some junk.
function moves(g, rnd) {
    const s = g.state;
    const out = [];
    const q = g.pendingChoice;
    if (q) {
        const p = q.player;
        if (q.kind === 'order') {
            const vals = q.options.map(o => o.value).sort(() => rnd() - 0.5);
            out.push({ who: p, label: 'order', run: () => g.resolveChoice(p, vals) });
        } else {
            const n = q.min + Math.floor(rnd() * (q.max - q.min + 1));
            const vals = [...q.options].sort(() => rnd() - 0.5).slice(0, n).map(o => o.value);
            out.push({ who: p, label: `answer ${q.prompt}`, run: () => g.resolveChoice(p, vals) });
        }
        out.push({ who: p === 1 ? 2 : 1, label: 'answer someone else\'s choice', junk: true, run: () => g.resolveChoice(p === 1 ? 2 : 1, []) });
        return out;
    }
    const cur = s.currentPlayer, def = cur === 1 ? 2 : 1;
    const randTargets = (p, specs, card) => {
        const chosen = [];
        for (const sp of specs || []) {
            const legal = g.getTargets(p, sp, card, chosen);
            chosen.push(legal.length ? pick(rnd, legal) : undefined);
        }
        return chosen;
    };
    const actor = s.combatStep === 'declare-blockers' ? def : cur;
    const pl = s.players[actor];
    for (const c of pl.hand) {
        const o = g.getPlayOptions(actor, c.instanceId);
        if (o.canPlay) {
            const modes = o.modes || [{ index: undefined, targets: o.targets }];
            const m = pick(rnd, modes);
            out.push({ who: actor, label: `play ${c.name}`, run: () => g.playCard(actor, c.instanceId, false, { mode: m.index, targets: randTargets(actor, m.targets, c) }) });
        }
        if (o.canResource) {
            const modes = o.resourceModes || [{ index: undefined, targets: o.resourceTargets }];
            const m = pick(rnd, modes);
            out.push({ who: actor, label: `resource ${c.name}`, run: () => g.playCard(actor, c.instanceId, true, { mode: m.index, targets: randTargets(actor, m.targets, c) }) });
        }
    }
    for (const c of [...s.players[1].field, ...s.players[2].field]) {
        for (const ab of g.getAbilities(actor, c.instanceId)) {
            if (!ab.canUse) continue;
            const modes = ab.modes || [{ index: undefined, targets: ab.targets }];
            const m = pick(rnd, modes);
            out.push({ who: actor, label: `${c.name}: ${ab.label}`, run: () => g.activateAbility(actor, c.instanceId, ab.index, { mode: m.index, targets: randTargets(actor, m.targets, c) }) });
        }
    }
    if (!s.combatStep && s.phase === 'main') out.push({ who: cur, label: 'combat', run: () => g.startCombat(cur) });
    if (s.combatStep === 'declare-attackers') {
        for (const c of g.pupilsOf(cur)) out.push({ who: cur, label: `toggle attacker ${c.name}`, run: () => g.toggleAttacker(cur, c.instanceId) });
        out.push({ who: cur, label: 'confirm attackers', run: () => g.confirmAttackers(cur) });
    }
    if (s.combatStep === 'declare-blockers') {
        for (const b of g.pupilsOf(def)) {
            const a = s.attackers.length ? pick(rnd, s.attackers).instanceId : null;
            out.push({ who: def, label: `block with ${b.name}`, run: () => g.toggleBlocker(def, b.instanceId, a) });
        }
        out.push({ who: def, label: 'confirm blockers', run: () => g.confirmBlockers(def) });
        out.push({ who: def, label: 'confirm blockers', run: () => g.confirmBlockers(def) });
    }
    if (!s.combatStep) out.push({ who: cur, label: 'end turn', run: () => g.endTurn(cur) });
    // junk that must be refused and change nothing
    out.push({ junk: true, label: 'play an unknown card', run: () => g.playCard(cur, 'no-such-card') });
    out.push({ junk: true, label: 'out-of-turn end turn', run: () => g.endTurn(def) });
    out.push({ junk: true, label: 'out-of-turn combat', run: () => g.startCombat(def) });
    out.push({ junk: true, label: 'block with an attacker', run: () => s.attackers[0] && g.toggleBlocker(cur, s.attackers[0].instanceId, s.attackers[0].instanceId) });
    out.push({ junk: true, label: 'activate a card you do not control', run: () => { const c = g.pupilsOf(def)[0]; return c ? g.activateAbility(cur, c.instanceId, 0) : { success: false }; } });
    return out;
}

(async () => {
    const failures = [];
    let totalMoves = 0, finished = 0, junkChanged = 0;
    for (let k = 0; k < GAMES && failures.length < 12; k++) {
        const seed = SEED0 + k;
        const env = boot(seed);
        const rnd = env.rnd;
        // random 40-card decks from the whole card pool, locations included
        const pool = CARDS;
        const deck = () => Array.from({ length: 40 }, () => pick(rnd, pool).id);
        const g = new env.RiutizGame({ cardData: CARDS, player1Deck: deck(), player2Deck: deck() });
        let move = 0, label = 'start';
        try {
            g.startGame();
            const sizes = { 1: ownedCount(g, 1), 2: ownedCount(g, 2) };
            for (move = 0; move < 1500 && !g.state.gameOver; move++) {
                const ms = moves(g, rnd);
                const junk = ms.filter(m => m.junk), real = ms.filter(m => !m.junk);
                const m = (rnd() < 0.08 || !real.length) ? pick(rnd, junk.length ? junk : ms) : pick(rnd, real);
                label = m.label;
                const before = m.junk ? JSON.stringify(g.state) : null;
                const r = m.run();
                if (m.junk && r && r.success) { failures.push(`seed ${seed} move ${move}: illegal "${label}" was accepted`); break; }
                if (m.junk && before !== JSON.stringify(g.state)) { junkChanged++; failures.push(`seed ${seed} move ${move}: refused "${label}" still changed the state`); break; }
                totalMoves++;
                const probs = invariants(g, sizes);
                if (probs.length) { failures.push(`seed ${seed} move ${move} after "${label}": ${probs.slice(0, 2).join('; ')}`); break; }
                if (move % 25 === 0) { const rt = roundTrip(g, env.RiutizGame); if (rt) { failures.push(`seed ${seed} move ${move}: ${rt}`); break; } }
                if (env.errors.length) { failures.push(`seed ${seed} move ${move} after "${label}": logged ${env.errors[0].slice(0, 200)}`); break; }
            }
            if (g.state.gameOver) finished++;
        } catch (e) {
            failures.push(`seed ${seed} move ${move} "${label}" THREW ${e.stack.split('\n').slice(0, 3).join(' / ')}`);
        }
    }
    console.log(`${GAMES} random games, ${totalMoves} moves, ${finished} finished`);
    if (failures.length) console.log('\n' + failures.map(f => '  ' + f).join('\n'));
    else console.log('no failures');
    process.exit(failures.length ? 1 : 0);
})();
