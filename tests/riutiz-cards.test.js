// Every RIUTIZ card does SOMETHING when it is used.
//
// The 2026-09 audit found that about 200 of 262 cards did nothing: the old
// engine matched ability text with regexes, and text no regex caught was
// silently inert - a card paid for, discarded, and gone. This drives every
// card through the real engine the way a player would:
//
//   - played from hand, with a sensible legal target for each target it asks
//     for and the first option of every choice it raises;
//   - played as a resource, if it has a resource ability;
//   - each activated ability, from a card already in play;
//   - each always-on effect, by comparing the board with and without it.
//
// Each use is run twice from the same random seed - once for real and once
// with the card's effect switched off - and fails if the two games end up the
// same. Triggered abilities are checked one by one in tests/riutiz-rules.test.js.
//
// Run: node tests/riutiz-cards.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const G = path.join(__dirname, '..', 'games');
const CARDS = JSON.parse(fs.readFileSync(path.join(G, 'Data', 'Riutiz', 'cards.json'), 'utf8'));
const SRC = ['RiutizCards.js', 'RiutizGame.js', 'RiutizAI.js'].map(f => fs.readFileSync(path.join(G, 'riutiz', f), 'utf8')).join('\n');

let pass = 0, fail = 0;
const failures = [];
const ok = (label, cond, detail = '') => {
    if (cond) { pass++; }
    else { fail++; failures.push(`${label}${detail ? '  -- ' + detail : ''}`); }
};

function boot(seed = 7) {
    let s = seed >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const sb = { console: { log() {}, warn() {}, error: (...a) => { throw new Error(a.join(' ')); } }, EventTarget, CustomEvent, Event, __rnd: rnd };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC + '\nMath.random = __rnd;', sb);
    return { RiutizGame: vm.runInContext('RiutizGame', sb), RiutizCards: vm.runInContext('RiutizCards', sb), RiutizAI: vm.runInContext('RiutizAI', sb) };
}

const env = boot();
const byId = id => CARDS.find(c => String(c.id) === String(id));
const vanilla = CARDS.filter(c => /Pupil/.test(c.type) && !env.RiutizCards.get(c.id)
    && /d\d/.test(c.dice || '') && parseInt(c.endurance, 10) >= 3);

// A busy board: both sides have pupils of every colour (hurt, with counters,
// one spent), a Worker, a legendary, a Tool, plenty of resources - most of them
// any-colour, a couple plain - cards in hand and a deck to draw from.
function board(seed, e) {
    const deck = vanilla.slice(0, 40).map(c => c.id);
    const g = new e.RiutizGame({ cardData: CARDS, player1Deck: deck, player2Deck: deck });
    g.startGame();
    for (const p of [1, 2]) {
        for (let i = 0; i < 10; i++) g.addResource(p, { anyColor: true, colors: ['O', 'G', 'P', 'B', 'Bk'], cardName: 'test' });
        g.addResource(p, { colors: ['O'], cardName: 'plain', card: g.createCardInstance(byId(3), p, g.state.nextId++) });
        g.addResource(p, { colors: ['G'], cardName: 'plain', spent: true, card: g.createCardInstance(byId(45), p, g.state.nextId++) });
        const put = (id, extra = {}) => {
            const c = g.createCardInstance(byId(id), p, g.state.nextId++);
            g.putIntoPlay(p, c);
            c.hasGettingBearings = false;
            Object.assign(c, extra);
            return c;
        };
        put(45, { damage: 2 });                        // green, hurt
        put(70, { damage: 1 });                        // purple, hurt
        put(121, { isSpent: true });                   // black, spent
        put(100).counters.plusOne = 1;                 // blue, with a counter
        put(1, { damage: 1 });                         // orange, hurt
        put(12);                                       // a Worker ("Mechanic")
        put(114);                                      // a legendary
        put(157, { isSpent: true });                   // a Tool
        g.refreshAll();
    }
    return g;
}

// Everything a card could affect, as a string.
function signature(g) {
    const card = c => [c.id, c.damage, JSON.stringify(c.counters), c.isSpent, c.skipReady || 0,
        c.mods.map(m => JSON.stringify(m)).join('&'), c.dieUpgrades || 0, c.cumulativeDieBonus || 0,
        c.currentEndurance, c.dieRollBonus, (c.keywordList || []).join(','), c.cannotBlockNow, c.cannotAttackNow, c.diceNow].join(':');
    const out = [];
    for (const p of [1, 2]) {
        const pl = g.state.players[p];
        out.push(`P${p} pts=${pl.points} hand=${pl.hand.map(c => c.id).sort().join(',')}`);
        out.push(`deck=${pl.deck.map(c => c.id).join(',')}`);
        out.push(`discard=${pl.discard.map(c => c.id).join(',')}`);
        out.push(`res=${pl.resources.map(r => `${r.anyColor ? '*' : r.colors.join('')}${r.temporary ? 't' : ''}${r.spent ? 's' : ''}`).join(',')}`);
        out.push(`flags=${JSON.stringify(Object.fromEntries(Object.entries(pl.flags).filter(([, v]) => v)))} skip=${pl.skipTurns} aside=${(pl.setAside || []).length}`);
        out.push('field=' + pl.field.map(card).sort().join('|'));
    }
    out.push('effects=' + JSON.stringify(g.state.effects));
    out.push('combat=' + g.state.combatStep);
    return out.join('\n');
}

// Answer every pending choice the way the AI would - which also proves the
// AI can answer it. A choice the AI cannot answer freezes a game against it
// (The Hacker's did, until this caught it).
function answerAll(g) {
    for (let i = 0; i < 20 && g.pendingChoice; i++) {
        const q = g.pendingChoice;
        const picker = new g._AI(g, q.player, { thinkingDelay: 0, actionDelay: 0 });
        picker.detach();
        const vals = picker.pickChoice(g, q, q.player);
        const r = g.resolveChoice(q.player, vals);
        if (!r.success) return `the AI's answer to "${q.prompt}" is refused: ${r.error}`;
    }
    return null;
}

// Harmful effects at the opponent, helpful ones at your own; prefer a hurt
// pupil or one with counters so heals and resets have something to do.
function pickTargets(g, player, specs, source) {
    const chosen = [];
    for (const s of specs || []) {
        const legal = g.getTargets(player, s, source, chosen);
        const score = id => {
            const c = g.findInPlay(id);
            if (!c) return 0;
            const mine = g.controllerOf(c) === player;
            let v = s.harm ? (mine ? 0 : 4) : s.buff ? (mine ? 4 : 0) : 1;
            const hurt = c.damage > 0, countered = Object.values(c.counters || {}).some(n => n > 0);
            if (s.buff) v += (hurt ? 2 : 0) + (countered ? 0.5 : 0);     // heals need a hurt pupil
            else v += (countered ? 2 : 0) + (hurt ? 1 : 0);              // resets need something to reset
            return v;
        };
        chosen.push([...legal].sort((a, b) => score(b) - score(a))[0]);
    }
    return chosen;
}

// A few cards only do something in a particular situation.
const SETUP = {
    33: g => { const a = g.pupilsOf(2)[0]; g.state.currentPlayer = 2; g.startCombat(2); g.toggleAttacker(2, a.instanceId); g.confirmAttackers(2); answerAll(g); },
    235: g => { const a = g.pupilsOf(2)[0]; g.state.currentPlayer = 2; g.startCombat(2); g.toggleAttacker(2, a.instanceId); g.confirmAttackers(2); answerAll(g); },
    209: g => { g.state.players[1].damageTakenThisTurn = 3; },
    203: g => { g.pupilsOf(2).find(c => c.counters.plusOne).damage = 2; g.refreshAll(); }   // Mood Swing: two different Endurances
};
// Uses that change nothing on the board by design: they show information.
const INFO_ONLY = new Set(['play:220', 'play:243']);

// Run one use twice from the same seed, once with the effect switched off.
function compare(seed, data, kind, index, act) {
    const results = [];
    for (const live of [true, false]) {
        const e = boot(seed);
        const def = e.RiutizCards.get(data.id);
        if (!live) {
            const off = x => ({ ...x, run() {}, modes: x.modes && x.modes.map(m => ({ ...m, run() {} })) });
            if (kind === 'play') def.play = off(def.play);
            if (kind === 'resource') def.resource = off(def.resource);
            if (kind === 'ability') def.abilities = def.abilities.map((a, i) => i !== index ? a : off(a));
        }
        const g = board(seed, e);
        g._AI = e.RiutizAI;
        let r;
        try { r = act(g, def); }
        catch (err) { r = { success: false, error: 'THREW ' + err.stack.split('\n').slice(0, 3).join(' / ') }; }
        const choiceErr = r && r.success ? answerAll(g) : null;
        results.push({ r, choiceErr, sig: r && r.success ? signature(g) : null });
    }
    // RIUTIZ_DEBUG=<card id> prints what differs between the two runs
    if (process.env.RIUTIZ_DEBUG === String(data.id)) {
        const a = (results[0].sig || '').split('\n'), b = (results[1].sig || '').split('\n');
        console.log(`-- ${data.name} ${kind}: live ${JSON.stringify(results[0].r)} off ${JSON.stringify(results[1].r)}`);
        a.forEach((l, i) => { if (l !== b[i]) console.log(`  live: ${l}\n  off:  ${b[i]}`); });
    }
    return { r: results[0].r, err: results[0].choiceErr, changed: results[0].sig !== results[1].sig };
}

let checked = 0;
for (const data of CARDS) {
    const def = env.RiutizCards.get(data.id);
    if (!def) continue;
    const name = `${data.id} ${data.name}`;

    if (def.play) {
        const res = compare(Number(data.id) + 11, data, 'play', 0, (g) => {
            if (SETUP[data.id]) SETUP[data.id](g);
            const acting = g.state.combatStep === 'declare-blockers' ? g.other(g.state.currentPlayer) : 1;
            const card = g.createCardInstance(data, acting, g.state.nextId++);
            g.state.players[acting].hand.push(card);
            const opts = g.getPlayOptions(acting, card.instanceId);
            // several modes: use the last (Oil Spill's second mode touches this board)
            const mode = opts.modes ? opts.modes.length - 1 : undefined;
            const specs = opts.modes ? opts.modes[mode].targets : opts.targets;
            return g.playCard(acting, card.instanceId, false, { mode, targets: pickTargets(g, acting, specs, card) });
        });
        ok(`${name}: can be played`, res.r && res.r.success, res.r && res.r.error);
        if (res.err) ok(`${name}: its choice can be answered`, false, res.err);
        else if (res.r && res.r.success && (def.play.run || def.play.modes)) {
            ok(`${name}: playing it changes the game`, res.changed || INFO_ONLY.has(`play:${data.id}`));
        }
        checked++;
    }

    if (def.resource) {
        const res = compare(Number(data.id) + 23, data, 'resource', 0, (g, d) => {
            g.state.currentPlayer = 1; g.state.phase = 'main';
            const card = g.createCardInstance(data, 1, g.state.nextId++);
            g.state.players[1].hand.push(card);
            const rs = d.resource;
            const specs = rs.modes ? rs.modes[0].targets : rs.targets;
            const before = g.state.players[1].resources.length;
            const r = g.playCard(1, card.instanceId, true, { mode: rs.modes ? 0 : undefined, targets: pickTargets(g, 1, specs, card) });
            r.added = g.state.players[1].resources.length - before;
            r.any = r.added > 0 && g.state.players[1].resources.slice(-r.added).every(x => x.anyColor);
            return r;
        });
        ok(`${name}: can be played as a resource`, res.r && res.r.success, res.r && res.r.error);
        if (def.resource.produces && res.r && res.r.success) {
            ok(`${name}: as a resource it gives ${def.resource.produces.count}`, res.r.added === def.resource.produces.count, `gave ${res.r.added}`);
            if (def.resource.produces.anyColor) ok(`${name}: ...of any colour`, res.r.any);
        }
        if (res.err) ok(`${name}: its resource choice can be answered`, false, res.err);
        else if (def.resource.run && res.r && res.r.success) ok(`${name}: its resource ability changes the game`, res.changed);
        checked++;
    }

    (def.abilities || []).forEach((ab, i) => {
        const res = compare(Number(data.id) * 7 + i, data, 'ability', i, (g, d) => {
            g.state.currentPlayer = 1; g.state.phase = 'main';
            const card = g.createCardInstance(data, 1, g.state.nextId++);
            g.putIntoPlay(1, card);
            card.hasGettingBearings = false;
            if (g.isPupil(card) && parseInt(card.endurance, 10) > 1) card.damage = 1;    // so a self-heal has something to do
            const a = d.abilities[i];
            if (a.counterCost) card.counters[a.counterCost] = 1;
            g.refreshAll();
            const specs = a.modes ? a.modes[0].targets : a.targets;
            return g.activateAbility(1, card.instanceId, i, { mode: a.modes ? 0 : undefined, targets: pickTargets(g, 1, specs, card) });
        });
        ok(`${name}: ability "${ab.label}" can be used`, res.r && res.r.success, res.r && res.r.error);
        if (res.err) ok(`${name}: ability choice can be answered`, false, res.err);
        else if (res.r && res.r.success) ok(`${name}: ability "${ab.label}" changes the game`, res.changed);
        checked++;
    });

    // always-on effects: the board with the card vs without it
    if (def.aura || def.costReduction) {
        const e = boot(Number(data.id) + 99);
        const g = board(Number(data.id) + 99, e);
        const costs = () => [157, 196, 225, 18].map(id => JSON.stringify(g.effectiveCost(g.createCardInstance(byId(id), 1, 0), 1))).join(';');
        const stats = (skip) => [...g.allPupils().filter(c => c.instanceId !== skip).map(c =>
            `${c.dieRollBonus}/${g.attackModifier(c)}/${c.currentEndurance}/${c.damageReductionTotal}/${(c.keywordList || []).join(',')}` +
            `/${c.cannotAttackNow}/${c.cannotBlockNow}/${g.hasAdvantage(c)}/${g.protectedFrom(c, byId(196))}`), costs()].join('|');
        const card = g.createCardInstance(data, 1, g.state.nextId++);
        const before = stats(card.instanceId);
        g.putIntoPlay(1, card);
        g.refreshAll();
        ok(`${name}: its always-on effect shows`, before !== stats(card.instanceId));
        checked++;
    }
}

console.log(`${checked} card uses checked`);
if (failures.length) console.log('\n' + failures.map(f => '  FAIL  ' + f).join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
