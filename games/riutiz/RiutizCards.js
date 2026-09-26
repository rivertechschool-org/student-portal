// games/riutiz/RiutizCards.js
// What every RIUTIZ card does, keyed by the id in games/Data/Riutiz/cards.json.
//
// A card with no entry here has no ability (a "vanilla" pupil). Where a card's
// printed text is ambiguous, the reading chosen is noted beside it and
// collected in games/riutiz/RULES.md.
//
// A definition may have:
//   keywords: ['impulsive', 'relentless', 'grounded', 'lethal', 'stubborn',
//              'overwhelm', 'firstStrike', 'closedMinded', 'nonSequitur',
//              'mustBeBlocked', 'unblockable', 'cannotBlock', 'cannotAttack',
//              'precision', 'allColors', 'allTypes', 'blocksUnblockable']
//   play:     { targets | modes, run(api, ctx), timing, canPlay }  - an
//             Interruption's effect, or a pupil/Tool's "when it enters" effect.
//             Targets are chosen as the card is played.
//   resource: { produces: { count, colors, anyColor }, targets | modes, run }
//             - "When played as resource" / "Support".
//   abilities:[{ label, cost, spend, sendHome, counterCost, oncePerTurn,
//                timing, targets | modes, run, canUse }]
//   aura(api, target, info) -> { die, attackDie, end, dmgReduce, keywords,
//             cannotAttack, cannotBlock, advantage, protection }
//   costReduction(api, { player, card, kind }) -> number
//   triggers: { onEnter, onExhausted, onAnyExhausted, onOtherEnter, onAttack,
//               onAttackersDeclared, onUnblocked, onAttackResolved, onScore,
//               onYouScore, onStartTurn, onEndTurn, onEndCombat, onDraw,
//               onInterruptionPlayed, onDealsDamage, onExhaustsPupil, onDamaged }
//   choices:  { key(api, values, data) } - continuations for g.ask(...)
//   rebuttal, damageReduction, dieBonus(api), baseEndurance(api),
//   combatRoll(api, role), redirectDamage(api, source), extraDraw,
//   preventScoring, playerFlags, rollFloor, sharedAbilities
//
// api = { g, card, me, them }: the engine, this card, its controller, the other player.
// ctx = { player, card, targets: [...], x }.
//
// Every target spec says whether it HELPS (buff) or HARMS (harm) the target,
// which is how the AI knows whose pupil to point it at.

(function () {
    const defs = {};
    const RiutizCards = {
        register(id, def) { defs[String(id)] = def; },
        get(id) { return defs[String(id)] || null; },
        all() { return defs; }
    };

    // ---------------------------------------------------------------- targets
    const LABEL = { any: 'a pupil', you: 'a pupil you control', them: "an opponent's pupil" };
    const pupil = (side = 'any', o = {}) => ({ kind: 'pupil', side, label: LABEL[side], ...o });
    const ally = (o = {}) => pupil('you', { buff: true, ...o });
    const enemy = (o = {}) => pupil('them', { harm: true, ...o });
    const anyBuff = (o = {}) => pupil('any', { buff: true, ...o });
    const anyHarm = (o = {}) => pupil('any', { harm: true, ...o });
    const tool = (side = 'any', o = {}) => ({
        kind: 'tool', side,
        label: side === 'you' ? 'a Tool you control' : side === 'them' ? "an opponent's Tool" : 'a Tool', ...o
    });
    const myResource = (o = {}) => ({ kind: 'resource', side: 'you', label: 'a resource you control', buff: true, ...o });

    // ---------------------------------------------------------------- effects
    const EOT = 'endOfTurn';
    const mod = (api, t, m) => api.g.addMod(t, m, api.me);
    const dmg = (api, t, n) => api.g.dealDamage(t, n, api.card && api.g.findInPlay(api.card.instanceId) ? api.card : null,
                                                { sourcePlayer: api.me });
    const damaged = (g, c) => g.isPupil(c) && c.damage > 0;
    const pupilsOf = (api, p) => api.g.pupilsOf(p);
    const vanillaIds = new Set();

    const keywords = (...kw) => ({ keywords: kw });
    const R = (id, def) => RiutizCards.register(id, def);

    // Resource producers
    const produces = (count, colors, anyColor = false) => ({ produces: { count, colors, anyColor } });

    // A triggered target choice made by the card's controller.
    const askTarget = (api, key, prompt, filter, opts = {}) => {
        const g = api.g;
        const options = g.allPupils().filter(c => !filter || filter(c)).map(c => ({
            value: c.instanceId, label: `${c.name} (${g.controllerOf(c) === api.me ? 'yours' : 'theirs'})`, card: c
        }));
        return g.ask(api.me, {
            kind: 'cards', prompt, options, min: opts.optional ? 0 : 1, max: 1,
            cont: { card: api.card.id, key }, source: api.card.instanceId, sourceName: api.card.name,
            data: opts.data || {}, harm: !!opts.harm, buff: !!opts.buff
        });
    };
    const chosen = (api, values) => values.length ? api.g.findInPlay(values[0]) : null;

    // ======================================================================
    // ORANGE — Workshop Warriors
    // ======================================================================

    R(2, { // The Apprentice
        triggers: { onEndTurn(api) { api.g.healFull(api.card); } }
    });
    R(4, keywords('overwhelm')); // Train Enthusiast
    R(5, { // Grease Monkey. Ruling: "add a resource of your choice to your hand" returns one of your resources to your hand.
        play: {
            targets: [myResource({ label: 'a resource to take back', fizzleIfNone: true, filter: (g, r) => !!r.card })],
            run(api, ctx) {
                const r = ctx.targets[0];
                if (!r) return;
                const pl = api.g.state.players[api.me];
                // a card that makes two pips is two resources: take back both
                pl.resources = pl.resources.filter(x => x.id !== r.id && !(r.card && x.card && x.card.instanceId === r.card.instanceId));
                if (r.card) pl.hand.push(r.card);
            }
        },
        resource: { targets: [myResource({ label: 'a resource to ready', filter: (g, r) => r.spent, fizzleIfNone: true })],
                    run(api, ctx) { if (ctx.targets[0]) ctx.targets[0].spent = false; } }
    });
    R(6, keywords('grounded', 'impulsive')); // Scooter
    R(7, keywords('relentless', 'grounded')); // The Overworker
    R(8, { // Jock
        keywords: ['relentless'],
        triggers: { onScore(api) { api.card.dieUpgrades = (api.card.dieUpgrades || 0) + 1; api.g.refreshAll(); } }
    });
    R(9, { keywords: ['lethal'], rebuttal: 'lethal' }); // Greaser
    R(10, { play: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { api.g.heal(ctx.targets[0], 3); } } }); // The Fixer
    R(11, keywords('mustBeBlocked')); // The Tool
    R(12, { // The Journeyman. Ruling: Grounded means it never attacks, so Apprenticeship fires when YOU attack.
        keywords: ['grounded'],
        triggers: {
            onAttackersDeclared(api, d) {
                if (d.player !== api.me) return;
                askTarget(api, 'apprentice', 'Apprenticeship: put a +1/+1 counter on another pupil you control',
                    c => api.g.controllerOf(c) === api.me && c.instanceId !== api.card.instanceId, { optional: true, buff: true });
            }
        },
        choices: { apprentice(api, v) { const t = chosen(api, v); if (t) api.g.addCounter(t, 'plusOne', 1); } },
        resource: {
            targets: [ally({ fizzleIfNone: true })],
            run(api, ctx) {
                const t = ctx.targets[0]; if (!t) return;
                const n = api.g.pupilsOf(api.me).filter(c => c.instanceId !== t.instanceId).length;
                api.g.addCounter(t, 'plusOne', n);
            }
        }
    });
    R(13, { // Shop Teacher
        rebuttal: 3,
        triggers: { onUnblocked(api) { api.g.healFull(api.card); } },
        resource: { run(api) { api.g.state.players[api.me].flags.reduceNextDamage = 3; } }
    });
    R(14, { keywords: ['grounded'], dieBonus: () => 1 }); // Mechanics Instructor
    R(15, { // Structural Design Teacher
        aura: (api, t, i) => (i.targetPlayer === api.me && t.instanceId !== api.card.instanceId && api.g.isPupil(t)) ? { end: 2 } : null
    });
    R(16, { // Recruiter. Ruling: search for a card with the same cost as a pupil in play.
        play: {
            targets: [pupil('any', { label: 'a pupil to match the cost of', fizzleIfNone: true })],
            run(api, ctx) {
                const t = ctx.targets[0]; if (!t) return;
                const mv = api.g.manaValue(t);
                api.g.searchDeck(api.me, c => api.g.manaValue(c) === mv, { prompt: `Choose a card costing ${mv}`, sourceName: api.card.name });
            }
        },
        resource: { run(api) { api.g.lookAtTop(api.me, 3, 1, { optional: true, prompt: 'You may put one in your hand', sourceName: 'Recruiter' }); } }
    });
    R(17, { // Janitor
        keywords: ['grounded'], rebuttal: 1,
        play: { run(api) {
            api.g.searchDeck(api.me, c => api.g.isPupil(c) && api.g.parseDice(c.dice).sides < 6,
                { prompt: 'Choose a pupil whose die is smaller than 1d6', sourceName: 'Janitor' });
        } }
    });
    R(18, { aura: (api, t, i) => (i.targetPlayer === api.me && api.g.isPupil(t)) ? { die: 1 } : null }); // Authoritative Parent
    R(19, { // Projects Constructor, Mary
        triggers: { onOtherEnter(api, d) { if (d.player === api.me) mod(api, d.entering, { end: 2, until: 'permanent' }); } },
        resource: { run(api) { api.g.searchDeck(api.me, c => api.g.isTool(c), { prompt: 'Choose a Tool', sourceName: 'Projects Constructor' }); } }
    });
    R(20, { // Slick Principal, Mary
        play: { run(api) { for (let i = 0; i < 2; i++) api.g.addResource(api.me, { anyColor: true, colors: ['O', 'G', 'P', 'B', 'Bk'], cardName: 'Created resource' }); } },
        resource: produces(2, null, true)
    });
    R(21, { // Amorphus. Ruling: "support item cards" are resources; the roll is a d4.
        play: { run(api) {
            const g = api.g; const n = g.rollDie(4); const pl = g.state.players[api.me];
            g.log(`Amorphus rolls ${n}.`);
            for (let i = 0; i < n && pl.deck.length; i++) {
                const c = pl.deck.shift();
                g.addResource(api.me, { colors: g.getAllColors(c.cost), cardName: c.name, card: c, spent: true });
            }
        } }
    });
    R(22, { // Welding
        play: {
            targets: [anyBuff({ label: 'the pupil that gets the die' }), pupil('any', { label: 'the pupil whose die it copies', other: true })],
            run(api, ctx) { const [a, b] = ctx.targets; if (a && b) mod(api, a, { setDice: api.g.diceLabel(b) }); }
        }
    });
    R(23, { play: { targets: [anyBuff()], run(api, ctx) { api.g.addCounter(ctx.targets[0], 'shield', 2); } } }); // Anneal
    R(24, { // Oil Spill. Ruling: "Mechanics" are Worker, Tinker and Labor pupils.
        play: { modes: [
            { label: '+1/+1 counter on every Mechanic', run(api) {
                api.g.allPupils().filter(c => isMechanic(api.g, c)).forEach(c => api.g.addCounter(c, 'plusOne', 1)); } },
            { label: '-1/-1 counter on every non-Mechanic', run(api) {
                api.g.allPupils().filter(c => !isMechanic(api.g, c)).forEach(c => api.g.addCounter(c, 'minusOne', 1)); } }
        ] }
    });
    const isMechanic = (g, c) => g.hasSubtype(c, 'Worker') || g.hasSubtype(c, 'Tinker') || g.hasSubtype(c, 'Labor');
    R(25, { play: { targets: [tool('any', { harm: true })], run(api, ctx) { api.g.exhaust(ctx.targets[0]); } } }); // Break Down
    R(26, { play: { targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { keywords: ['lethal'], until: EOT }); } } }); // Cement
    R(27, { play: { targets: [anyHarm({ label: 'a pupil costing 2 or less', filter: (g, c) => g.manaValue(c) <= 2 })],
                    run(api, ctx) { api.g.sendHome(ctx.targets[0]); } } }); // Frame
    R(28, { play: { targets: [anyHarm()], run(api, ctx) { mod(api, ctx.targets[0], { die: -2, until: EOT }); } } }); // Creep
    R(29, { play: { targets: [anyBuff()], run(api, ctx) { api.g.addCounter(ctx.targets[0], 'shield', 5); } } }); // Crystallinity
    R(30, { play: { targets: [anyBuff()], run(api, ctx) { api.g.addCounter(ctx.targets[0], 'plusOne', 1); } } }); // Cross Trains
    R(31, { play: { targets: [anyHarm()], run(api, ctx) { mod(api, ctx.targets[0], { die: -4, until: EOT }); } } }); // Delamination
    R(32, { // Fabricate: +2 this turn, then -1 for good
        play: { targets: [anyBuff()], run(api, ctx) {
            mod(api, ctx.targets[0], { die: 3, until: EOT });
            mod(api, ctx.targets[0], { die: -1, until: 'permanent' });
        } }
    });
    R(33, { // Flash Point
        play: { timing: 'combat',
            targets: [pupil('any', { harm: true, label: 'an attacking pupil', filter: (g, c) => g.state.attackers.some(a => a.instanceId === c.instanceId) })],
            run(api, ctx) { mod(api, ctx.targets[0], { refuted: true, until: 'endOfCombat' }); } }
    });
    R(34, { play: { targets: [anyBuff()], run(api, ctx) { api.g.heal(ctx.targets[0], 5); } } }); // Fix
    R(35, { play: { targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { unblockable: true, until: EOT }); } } }); // Permeability
    R(36, { play: { run(api) { const f = api.g.state.players[api.me].flags; f.extraResourcePlays = (f.extraResourcePlays || 0) + 1; } } }); // Reinforcement
    R(37, { play: { targets: [anyHarm()], run(api, ctx) { const t = ctx.targets[0]; api.g.spend(t); t.skipReady = Math.max(t.skipReady || 0, 1); } } }); // Fasten
    R(38, { play: { modes: [ // Build Up
        { label: '+1 to die rolls until end of turn', targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { die: 1, until: EOT }); } },
        { label: '2 shield counters', targets: [anyBuff()], run(api, ctx) { api.g.addCounter(ctx.targets[0], 'shield', 2); } }
    ] } });

    // Locations are shared: one in play at a time, and it applies to both players.
    R(39, { aura: (api, t) => api.g.isPupil(t) ? { keywords: ['impulsive'] } : null }); // Parking Lot
    R(40, { costReduction: (api, x) => x.kind === 'Tool' ? 1 : 0 }); // The Workshop
    R(41, { aura: (api, t) => api.g.isPupil(t) ? { attackDie: 1 } : null }); // Field
    R(42, { aura: (api, t) => (api.g.isPupil(t) && api.g.enduranceWithoutAuras(t) + t.damage >= 6) ? { die: 1 } : null }); // Gym

    // ======================================================================
    // GREEN — Lab Experiment
    // ======================================================================

    R(43, { // Chemistry Enthusiast
        abilities: [{ label: 'Counter the next ability your opponent uses', sendHome: true, timing: 'any',
            run(api) { api.g.state.players[api.me].flags.counterNextAbility = true; } }],
        resource: { run(api) { api.g.state.players[api.me].flags.counterNextAbility = true; } }
    });
    R(44, { // Botany Enthusiast
        abilities: [{ label: 'Create a resource of any color this turn', spend: true,
            run(api) { api.g.addResource(api.me, { anyColor: true, colors: ['O', 'G', 'P', 'B', 'Bk'], temporary: true, cardName: 'Botany' }); } }],
        resource: produces(2, ['G'])
    });
    R(47, { // Psychology Enthusiast
        abilities: [{ label: 'Two pupils fight', cost: '(G)', spend: true,
            targets: [pupil('any', { label: 'the first fighter' }), pupil('any', { label: 'the second fighter' })],
            run(api, ctx) { api.g.fight(ctx.targets[0], ctx.targets[1]); } }]
    });
    R(48, keywords('blocksUnblockable')); // Sociology Enthusiast: "Can block Circumvent"
    R(51, { abilities: [{ label: '+1/+1 counter on itself', cost: '(G)(G)', run(api) { api.g.addCounter(api.card, 'plusOne', 1); } }] }); // Geology
    R(52, keywords('overwhelm')); // Archeology Enthusiast
    R(53, { triggers: { onEndTurn(api) { api.g.healFull(api.card); } } }); // Chirography: Regen
    R(54, { resource: produces(2, ['G']) }); // Meteorology Enthusiast
    R(55, keywords('lethal')); // Dialectology Enthusiast
    R(56, { rebuttal: 'equal' }); // Dioptrics Enthusiast
    R(57, { triggers: { onEndCombat(api) { pupilsOf(api, api.me).forEach(c => api.g.heal(c, 1)); } } }); // Chemistry Teacher
    R(58, { triggers: { onAnyExhausted(api, d) { if (d.dead.instanceId !== api.card.instanceId) mod(api, api.card, { die: 1, until: EOT }); } } }); // Biology Teacher
    R(59, { // Psychology Teacher
        abilities: [{ label: "An opponent's pupil cannot attack or block until your next turn", spend: true,
            targets: [enemy()], run(api, ctx) { mod(api, ctx.targets[0], { cannotAttack: true, cannotBlock: true, until: 'yourNextTurn' }); } }]
    });
    R(60, { // Lunch Lady
        triggers: { onStartTurn(api, d) { if (d.player === api.me) pupilsOf(api, api.me).forEach(c => api.g.heal(c, 1)); } },
        resource: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { api.g.heal(ctx.targets[0], 2); } }
    });
    R(61, { // Ex-Astronaut: Momentum
        triggers: { onAttackResolved(api, d) { api.card.momentum = d.unblocked ? d.roll : 0; api.g.refreshAll(); } },
        resource: { targets: [ally({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { die: 3, until: EOT }); } }
    });
    R(62, { keywords: ['impulsive'], triggers: { onExhausted(api) { api.g.draw(api.me, 1); } } }); // Run-away Parent
    R(63, { // Discovery Principal, Dan
        play: { run(api) {
            const g = api.g; const pl = g.state.players[api.me];
            if (!pl.deck.length) return;
            g.ask(api.me, { kind: 'cards', prompt: 'Set aside a card from your deck with 3 timer counters',
                options: pl.deck.map(c => ({ value: c.instanceId, label: c.name, card: c })), min: 1, max: 1,
                cont: { card: api.card.id, key: 'setAside' }, source: api.card.instanceId, sourceName: api.card.name });
        } },
        choices: { setAside(api, v) {
            const pl = api.g.state.players[api.me];
            const i = pl.deck.findIndex(c => c.instanceId === v[0]);
            if (i < 0) return;
            const [c] = pl.deck.splice(i, 1);
            pl.deck = api.g.shuffle(pl.deck);
            pl.setAside = pl.setAside || [];
            pl.setAside.push({ card: c, timers: 3 });
            api.g.log(`${c.name} is set aside with 3 timer counters.`);
        } },
        triggers: { onStartTurn(api, d) {
            if (d.player !== api.me) return;
            const pl = api.g.state.players[api.me];
            (pl.setAside || []).forEach(x => x.timers--);
            const ready = (pl.setAside || []).filter(x => x.timers <= 0);
            pl.setAside = (pl.setAside || []).filter(x => x.timers > 0);
            ready.forEach(x => { x.card.freeToPlay = true; pl.hand.push(x.card); api.g.log(`${x.card.name} is ready - play it for free.`); });
        } },
        resource: { targets: [ally({ fizzleIfNone: true })], run(api, ctx) { api.g.addCounter(ctx.targets[0], 'plusOne', 1); } }
    });
    R(64, { // Gardening Teacher, Dan
        triggers: { onStartTurn(api, d) {
            if (d.player === api.me) pupilsOf(api, api.me).filter(c => c.instanceId !== api.card.instanceId).forEach(c => api.g.addCounter(c, 'plusOne', 1));
        } },
        resource: { run(api) { pupilsOf(api, api.me).forEach(c => api.g.heal(c, 1)); } }
    });
    R(65, { // Cafeteria (location): each player, at the start of their turn, may pay (1) to heal 2
        triggers: { onStartTurn(api, d) {
            const g = api.g;
            if (!g.canPay('(1)', d.player)) return;
            const hurt = g.pupilsOf(d.player).filter(c => c.damage > 0);
            if (!hurt.length) return;
            g.ask(d.player, { kind: 'cards', prompt: 'Cafeteria: pay (1) to recover 2 Endurance on a pupil?',
                options: hurt.map(c => ({ value: c.instanceId, label: c.name, card: c })), min: 0, max: 1, buff: true,
                cont: { card: api.card.id, key: 'eat' }, source: api.card.instanceId, sourceName: 'Cafeteria' });
        } },
        choices: { eat(api, v) { const t = chosen(api, v); if (t && api.g.pay('(1)', api.me)) api.g.heal(t, 2); } }
    });
    R(66, { aura: (api, t) => (api.g.isPupil(t) && api.g.colorsOf(t).includes('G')) ? { advantage: true } : null }); // The Lab

    // ======================================================================
    // PURPLE — Drama Club
    // ======================================================================

    const attackRally = { triggers: { onAttack(api) {
        api.g.state.attackers.filter(a => a.instanceId !== api.card.instanceId)
            .map(a => api.g.findInPlay(a.instanceId)).filter(Boolean)
            .forEach(c => mod(api, c, { die: 1, until: 'endOfCombat' }));
    } } };
    R(67, attackRally); // Singer
    R(68, { // Dancer
        triggers: { onInterruptionPlayed(api, d) {
            if (d.player === api.me && !d.refuted) askTarget(api, 'poke', 'Dancer: deal 1 damage to a pupil', null, { harm: true });
        } },
        choices: { poke(api, v) { const t = chosen(api, v); if (t) dmg(api, t, 1); } }
    });
    R(69, { play: { targets: [enemy({ fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) mod(api, ctx.targets[0], { cannotBlock: true, until: EOT }); } } }); // Selfie Girl
    R(71, keywords('impulsive')); // Hipster
    R(72, { keywords: ['closedMinded'], play: { targets: [anyHarm({ fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) dmg(api, ctx.targets[0], 2); } } }); // Emo Girl
    R(73, { abilities: [{ label: 'Must be blocked if possible this turn', cost: '(1)(P)', run(api) { mod(api, api.card, { mustBeBlocked: true, until: EOT }); } }] }); // Rebel
    R(74, { play: { run(api) { api.g.allPupils().forEach(c => dmg(api, c, 1)); } } }); // Style Sevant
    R(75, { // Drama Member
        abilities: [{ label: "Copy a pupil's stats this turn", cost: '(P)(P)(P)', targets: [pupil('any', { other: true, label: 'a pupil to mirror' })],
            run(api, ctx) {
                const t = ctx.targets[0];
                mod(api, api.card, { setDice: api.g.diceLabel(t), setEndurance: api.g.maxEndurance(t), until: EOT });
            } }]
    });
    R(76, { abilities: [{ label: 'Fight a pupil', cost: '(P)', spend: true, targets: [anyHarm({ other: true })],
        run(api, ctx) { api.g.fight(api.card, ctx.targets[0]); } }] }); // The Anarchist
    R(77, { // Musician
        abilities: [
            { label: "-1 to your opponent's die rolls this turn", spend: true, run(api) { api.g.addEffect({ player: api.them, die: -1, by: api.me }); } },
            { label: '+1 to your die rolls this turn', spend: true, run(api) { api.g.addEffect({ player: api.me, die: 1, by: api.me }); } }
        ],
        resource: { run(api) { api.g.addEffect({ player: api.me, die: 1, by: api.me }); api.g.addEffect({ player: api.them, die: -1, by: api.me }); } }
    });
    R(78, { keywords: ['firstStrike'], resource: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { die: 2, until: EOT }); } } }); // Drama Queen
    R(79, { // Free Spirit
        keywords: ['nonSequitur'],
        triggers: { onStartTurn(api, d) {
            if (d.player !== api.me) return;
            if (api.g.flipCoin()) { api.g.log('Free Spirit: heads.'); api.g.gainPoints(api.me, 1, api.card); }
            else { api.g.log('Free Spirit: tails.'); api.g.losePoints(api.me, 1); }
        } }
    });
    R(81, { dieBonus: (api) => api.g.allPupils().filter(c => c.instanceId !== api.card.instanceId && api.g.hasSubtype(c, 'Popular')).length }); // Popular Kid
    R(83, { // Pottery Teacher: Reshape
        abilities: [{ label: 'Move up to 2 Endurance between your pupils', spend: true,
            targets: [ally({ label: 'the pupil that gives Endurance', buff: false }), ally({ label: 'the pupil that receives it' })],
            run(api, ctx) {
                const [from, to] = ctx.targets;
                const n = Math.min(2, Math.max(0, from.currentEndurance - 1));
                if (!n) return;
                mod(api, from, { end: -n, until: 'permanent' });
                mod(api, to, { end: n, until: 'permanent' });
            } }]
    });
    R(84, { abilities: [ // English Teacher
        { label: 'Deal 2 damage to a pupil', cost: '(P)(P)(P)', targets: [anyHarm()], run(api, ctx) { dmg(api, ctx.targets[0], 2); } },
        { label: 'Gain 2 points', cost: '(P)(P)(P)', run(api) { api.g.gainPoints(api.me, 2, api.card); } }
    ] });
    R(85, keywords('impulsive')); // Foreign Language instructor
    R(86, { // Latin Professor: Rampage
        triggers: { onExhaustsPupil(api, d) {
            if (api.g.state.currentPlayer !== api.me) return;   // only when it is attacking
            const others = api.g.pupilsOf(api.them).filter(c => c.instanceId !== d.victim.instanceId && c.currentEndurance > 0);
            if (!others.length) { api.g.gainPoints(api.me, d.damage, api.card); return; }
            askTarget(api, 'rampage', `Rampage: deal ${d.damage} damage to another defending pupil`,
                c => api.g.controllerOf(c) === api.them && c.instanceId !== d.victim.instanceId, { harm: true, data: { n: d.damage } });
        } },
        choices: {
            rampage(api, v, data) { const t = chosen(api, v); if (t) dmg(api, t, data.n); },
            split(api, v) {
                const ts = v.map(id => api.g.findInPlay(id)).filter(Boolean);
                const parts = ts.length === 1 ? [3] : ts.length === 2 ? [2, 1] : [1, 1, 1];
                ts.forEach((t, i) => api.g.dealDamage(t, parts[i], null, { sourcePlayer: api.me }));
            }
        },
        resource: { run(api) {
            const g = api.g;
            g.ask(api.me, { kind: 'cards', prompt: 'Deal 3 damage divided among up to 3 pupils (first chosen takes the most)',
                options: g.allPupils().map(c => ({ value: c.instanceId, label: c.name, card: c })), min: 1, max: 3, harm: true,
                cont: { card: 86, key: 'split' }, sourceName: 'Latin Professor' });
        } }
    });
    R(87, { abilities: [{ label: 'A pupil recovers 2 Endurance', spend: true, targets: [anyBuff()], run(api, ctx) { api.g.heal(ctx.targets[0], 2); } }] }); // Counselor
    R(88, { abilities: [{ label: 'Draw a card, then discard a card', spend: true, run(api) { api.g.draw(api.me, 1); api.g.askDiscard(api.me, 1, { sourceName: 'Librarian' }); } }] }); // Librarian
    R(89, { aura: (api, t, i) => (i.targetPlayer === api.me && api.g.isPupil(t)) ? { keywords: ['impulsive'] } : null }); // Permissive Parent
    R(90, { // Arts and Crafts Teacher, Alicia
        combatRoll(api, role) {
            if (role !== 'attack') return null;
            if (api.g.flipCoin()) { api.g.log('Alicia: heads - she strikes with her Endurance.'); return api.card.currentEndurance; }
            api.g.log('Alicia: tails.');
            return null;
        },
        resource: { targets: [anyHarm({ fizzleIfNone: true })], run(api, ctx) { api.g.dealDamage(ctx.targets[0], 2, null, { sourcePlayer: api.me }); } }
    });
    R(91, { // Compassionate Principal, Alicia
        play: { run(api) { api.g.allPupils().filter(c => c.instanceId !== api.card.instanceId).forEach(c => dmg(api, c, 5)); } },
        resource: { run(api) { api.g.draw(api.me, 1); } }
    });
    R(92, { aura: (api, t) => (api.g.isPupil(t) && api.g.colorsOf(t).includes('P')) ? { die: 1 } : null }); // Music Room
    R(93, { triggers: { onAnyExhausted(api, d) { if (d.controller) api.g.draw(d.controller, 1); } } }); // The Amphitheater
    R(94, { // The Counselor's Office: each player, at the start of their turn, may discard a card to heal 3
        triggers: { onStartTurn(api, d) {
            const g = api.g;
            if (!g.state.players[d.player].hand.length) return;
            if (!g.pupilsOf(d.player).some(c => c.damage > 0)) return;
            g.ask(d.player, { kind: 'cards', prompt: "Counselor's Office: discard a card to recover 3 Endurance?",
                options: g.state.players[d.player].hand.map(c => ({ value: c.instanceId, label: c.name, card: c })), min: 0, max: 1,
                cont: { card: api.card.id, key: 'discard' }, source: api.card.instanceId, sourceName: "Counselor's Office" });
        } },
        choices: {
            discard(api, v) {
                if (!v.length) return;
                api.g.discardFromHand(api.me, v[0]);
                const hurt = api.g.pupilsOf(api.me).filter(c => c.damage > 0);
                api.g.ask(api.me, { kind: 'cards', prompt: 'Recover 3 Endurance on which pupil?', buff: true,
                    options: hurt.map(c => ({ value: c.instanceId, label: c.name, card: c })), min: 1, max: 1,
                    cont: { card: 94, key: 'heal' }, sourceName: "Counselor's Office" });
            },
            heal(api, v) { const t = chosen(api, v); if (t) api.g.heal(t, 3); }
        }
    });

    // ======================================================================
    // BLUE — Math League
    // ======================================================================

    R(95, { // Trigonometry Enthusiast. Ruling: damage goes back to the pupil that dealt it,
            // otherwise to the opponent's pupil with the least Endurance.
        redirectDamage(api, source) {
            const g = api.g;
            if (source && g.isPupil(source) && g.findInPlay(source.instanceId) && source.instanceId !== api.card.instanceId) return source;
            const theirs = g.pupilsOf(api.them).sort((a, b) => a.currentEndurance - b.currentEndurance);
            return theirs[0] || null;
        }
    });
    R(97, { // Statistics Enthusiast: one reroll every turn, used on a poor roll
        triggers: { onStartTurn(api) { const f = api.g.state.players[api.me].flags; f.rerolls = Math.max(f.rerolls || 0, 1); f.permanentRerolls = 1; } },
        play: { run(api) { const f = api.g.state.players[api.me].flags; f.rerolls = Math.max(f.rerolls || 0, 1); f.permanentRerolls = 1; } },
        resource: { run(api) { const f = api.g.state.players[api.me].flags; f.rerolls = (f.rerolls || 0) + 1; } }
    });
    const toggleSpend = { abilities: [{ label: 'Spend or ready a pupil', spend: true, targets: [pupil('any', { other: true })],
        run(api, ctx) { const t = ctx.targets[0]; if (t.isSpent) api.g.ready(t); else api.g.spend(t); } }] };
    R(98, toggleSpend); // Classic Nerd
    R(101, { play: { run(api) { api.g.lookAtTop(api.me, 3, 1, { sourceName: 'Data Mining' }); } } }); // Analytics Enthusiast
    R(104, { triggers: { onStartTurn(api, d) { if (d.player === api.me) { api.card.cumulativeDieBonus = (api.card.cumulativeDieBonus || 0) + 1; api.g.refreshAll(); } } } }); // Calculus Enthusiast
    R(105, { // Probability Enthusiast
        combatRoll(api) { let h = 0; for (let i = 0; i < 4; i++) if (api.g.flipCoin()) h++; api.g.log(`Probability Enthusiast flips ${h} heads.`); return h; }
    });
    R(106, { keywords: ['nonSequitur'], abilities: [{ label: 'Create an Average Joe', spend: true, run(api) { api.g.createToken(api.me, 155); } }] }); // Number Theory
    R(107, { keywords: ['nonSequitur'], resource: produces(1, null, true) }); // Game Theory Enthusiast
    R(108, { damageReduction: 4, resource: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { dmgReduce: 3, until: EOT }); } } }); // Geometry Teacher
    R(109, { // Trigonometry Teacher. Ruling: "Arts" is Purple, the arts colour.
        aura: (api, t, i) => (i.targetPlayer === api.me && api.g.isPupil(t) && t.instanceId !== api.card.instanceId) ? { protection: ['P'] } : null
    });
    R(110, { // Calculus Teacher
        triggers: { onInterruptionPlayed(api, d) { if (d.player === api.me) api.g.draw(api.me, 1); } },
        resource: { run(api) { api.g.draw(api.me, 1); } }
    });
    R(111, { abilities: [{ label: 'Protection from a color', spend: true, // Receptionist
        modes: ['O', 'G', 'P', 'B', 'Bk'].map(col => ({
            label: `Protection from ${{ O: 'Orange', G: 'Green', P: 'Purple', B: 'Blue', Bk: 'Black' }[col]}`,
            targets: [ally({ other: true })],
            run(api, ctx) { mod(api, ctx.targets[0], { protection: [col], until: 'yourNextTurn' }); }
        })) }] });
    R(112, { aura: (api, t, i) => (i.targetPlayer === api.me && api.g.isPupil(t) && t.instanceId !== api.card.instanceId) ? { die: 1 } : null }); // Applied Mathematics
    R(113, { aura: (api, t, i) => (i.targetPlayer !== api.me && api.g.isPupil(t)) ? { die: -1 } : null }); // Authoritarian Parent
    R(114, { keywords: ['stubborn'], resource: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { preventNext: 3, until: EOT }); } } }); // Functions Professor, Jordan
    R(115, { // Authoritative Principal, Jordan
        aura: (api, t, i) => (i.targetPlayer === api.me && api.g.isPupil(t)) ? { dmgReduce: 2 } : null,
        triggers: { onAttackersDeclared(api, d) { if (d.player !== api.me) api.g.losePoints(d.player, d.attackers.length); } },
        resource: { targets: [enemy({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { die: -2, until: EOT }); } }
    });
    R(116, { abilities: [{ label: '+1 to die rolls; draw if it rolls 6+', spend: true, targets: [anyBuff()], // Calculator
        run(api, ctx) { mod(api, ctx.targets[0], { die: 1, drawIfRoll: 6, until: EOT }); } }] });
    R(117, { aura: (api, t) => (api.g.isPupil(t) && api.g.isLegendary(t)) ? { die: 2 } : null }); // Auditorium
    R(118, { triggers: { onOtherEnter(api, d) { // The Office
        if (!d.entering.isToken && api.g.colorsOf(d.entering).includes('B')) api.g.createToken(d.player, 155);
    } } });

    // ======================================================================
    // BLACK — Tech Club
    // ======================================================================

    R(119, { play: { run(api) { api.g.draw(api.me, 1); } } }); // The Gamer
    const pickFromOpponentHand = (api, filterPupils) => {
        const g = api.g; const hand = g.state.players[api.them].hand;
        const opts = hand.filter(c => !filterPupils || g.isPupil(c));
        g.ask(api.me, { kind: 'cards', prompt: filterPupils ? 'Their hand: choose a pupil for them to discard' : 'Their hand: choose a card for them to discard',
            options: (opts.length ? opts : hand).map(c => ({ value: c.instanceId, label: c.name, card: c })),
            min: opts.length ? 1 : 0, max: opts.length ? 1 : 0, reveal: !opts.length,
            cont: { card: 120, key: 'strip' }, sourceName: 'Hand' });
    };
    R(120, { // The Hacker
        play: { run(api) { pickFromOpponentHand(api, true); } },
        choices: { strip(api, v) { if (v.length) api.g.discardFromHand(api.them, v[0]); } },
        resource: { run(api) { pickFromOpponentHand(api, false); } }
    });
    R(124, attackRally); // The Techno
    R(125, { abilities: [{ label: 'The next pupil your opponent plays is turned back', spend: true, // Electronics Enthusiast
        run(api) { api.g.state.players[api.me].flags.preventNextPupil = true; } }] });
    R(126, { play: { targets: [pupil('any', { harm: true, other: true, fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) api.g.sendHome(ctx.targets[0]); } } }); // AI Enthusiast
    R(127, { play: { targets: [pupil('any', { harm: true, other: true, fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) mod(api, ctx.targets[0], { keywords: ['nonSequitur'], until: EOT }); } } }); // The Vlogger
    R(128, { play: { targets: [enemy({ fizzleIfNone: true })], run(api, ctx) { // Film Enthusiast
        const t = ctx.targets[0]; if (!t) return; api.g.spend(t); t.skipReady = Math.max(t.skipReady || 0, 1);
    } } });
    R(130, { baseEndurance: (api) => Math.max(1, api.g.allPupils().filter(c => api.g.hasSubtype(c, 'Gamer')).length) }); // QA Tester
    R(131, toggleSpend); // The Server Fanatic
    R(133, { triggers: { onInterruptionPlayed(api, d) { if (d.player === api.me) api.g.addCounter(api.card, 'plusOne', 1); } } }); // Web Development Teacher
    const readyTool = { label: 'Ready a Tool', spend: true, targets: [tool('you', { buff: true, filter: (g, c) => c.isSpent })],
                        run(api, ctx) { api.g.ready(ctx.targets[0]); } };
    R(134, { // Robotics Professor
        costReduction: (api, x) => (x.player === api.me && x.kind === 'Tool') ? 1 : 0,
        abilities: [readyTool],
        resource: { run(api) { api.g.searchDeck(api.me, c => api.g.isTool(c) && api.g.manaValue(c) <= 2, { dest: 'play', prompt: 'Choose a Tool costing 2 or less to put into play', sourceName: 'Robotics Professor' }); } }
    });
    R(135, { // AI Instructor
        play: { targets: [pupil('any', { other: true, fizzleIfNone: true, label: 'a pupil to copy' })], run(api, ctx) {
            const t = ctx.targets[0]; if (!t) return;
            const data = api.g.findCardData(t.id);
            if (data) api.g.createToken(api.me, data);
        } },
        resource: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { keywords: ['closedMinded'], until: EOT }); } }
    });
    R(136, { abilities: [{ label: 'Discard a card, then draw a card', spend: true, // Social Networking Instructor. Ruling: (S)(S) means Spend.
        canUse: (api) => api.g.state.players[api.me].hand.length ? null : 'No card to discard',
        run(api) {
            api.g.ask(api.me, { kind: 'cards', prompt: 'Discard a card, then draw one', buff: true,
                options: api.g.state.players[api.me].hand.map(c => ({ value: c.instanceId, label: c.name, card: c })),
                min: 1, max: 1, cont: { card: 136, key: 'loot' }, source: api.card.instanceId, sourceName: api.card.name });
        } }],
        choices: { loot(api, v) { api.g.discardFromHand(api.me, v[0]); api.g.draw(api.me, 1); } }
    });
    R(137, { // Resource Officer: Lockdown
        rebuttal: 2,
        play: { targets: [enemy({ fizzleIfNone: true })], run(api, ctx) {
            if (ctx.targets[0]) mod(api, ctx.targets[0], { cannotAttack: true, cannotBlock: true, until: 'whileSource', sourceId: api.card.instanceId });
        } }
    });
    R(138, keywords('cannotBlock', 'unblockable')); // Uninvolved Parent
    R(139, { // Backend Principal, Luke
        aura: (api, t, i) => (i.targetPlayer !== api.me && api.g.isPupil(t)) ? { attackDie: -1 } : null,
        resource: { run(api) {
            const top = api.g.state.players[api.me].deck.slice(0, 3);
            if (top.length > 1) api.g.ask(api.me, { kind: 'order', prompt: 'Put these in order (first is the top)',
                options: top.map(c => ({ value: c.instanceId, label: c.name, card: c })), min: top.length, max: top.length,
                cont: { engine: 'order' }, data: {}, sourceName: 'Backend Principal' });
        } }
    });
    R(140, { extraDraw: 1, resource: { run(api) { api.g.draw(api.me, 1); api.g.askDiscard(api.me, 1, { sourceName: 'Cinematography Instructor' }); } } }); // Cinematography Instructor, Luke
    R(141, { triggers: { onDraw(api, d) { if (d.player !== api.me) api.g.draw(api.me, 1, { silent: true, noExtra: true }); } } }); // Confusion Matrix
    R(142, { abilities: [ // Battery
        { label: 'Put a charge counter on it', spend: true, run(api) { api.g.addCounter(api.card, 'charge', 1); } },
        { label: 'Remove a charge: a resource of any color this turn', spend: true, counterCost: 'charge',
          run(api) { api.g.addResource(api.me, { anyColor: true, colors: ['O', 'G', 'P', 'B', 'Bk'], temporary: true, cardName: 'Battery' }); } }
    ] });
    R(143, { // The Computer Lab
        aura: (api, t) => (api.g.isPupil(t) && api.g.colorsOf(t).includes('Bk')) ? { die: 1 } : null,
        sharedAbilities: true,
        abilities: [{ label: 'Pay (2): draw a card', cost: '(2)', run(api) { api.g.draw(api.me, 1); } }]
    });
    R(144, { // Server Room
        aura: (api, t) => api.g.isPupil(t) ? { die: -1 } : null,
        rollFloor: 1,
        triggers: { onStartTurn(api, d) {
            if (!api.g.state.players[d.player].deck.length) return;
            api.g.ask(d.player, { kind: 'option', prompt: 'Server Room: draw a card?', min: 1, max: 1,
                options: [{ value: 'yes', label: 'Draw a card' }, { value: 'no', label: 'No thanks' }],
                cont: { card: 144, key: 'draw' }, sourceName: 'Server Room' });
        } },
        choices: { draw(api, v) { if (v[0] === 'yes') api.g.draw(api.me, 1); } }
    });

    // ======================================================================
    // COLORLESS
    // ======================================================================

    R(145, { triggers: { onAnyExhausted(api, d) { // Foster Parent
        if (d.controller === api.me && d.dead.instanceId !== api.card.instanceId) api.g.draw(api.me, 1);
    } } });
    R(146, { resource: produces(2, ['C']) }); // Teacher's Assistant: Support: Add (2)
    R(147, { // Teacher's Pet
        abilities: [{ label: 'Go home, and put a Basic Pupil from your deck into play spent', spend: true, sendHome: true,
            run(api) { api.g.searchDeck(api.me, c => c.type === 'Basic Pupil', { dest: 'play', spent: true, prompt: 'Choose a Basic Pupil to put into play', sourceName: "Teacher's Pet" }); } }],
        resource: { run(api) { api.g.searchDeck(api.me, c => api.g.manaValue(c) <= 1, { prompt: 'Choose a card costing 1 or less', sourceName: "Teacher's Pet" }); } }
    });
    R(148, keywords('closedMinded', 'cannotAttack')); // The Loner
    R(149, { keywords: ['grounded', 'relentless'], resource: produces(2, null, true) }); // Jack of all trades
    R(150, { keywords: ['closedMinded', 'allTypes'], resource: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { keywords: ['closedMinded'], until: EOT }); } } }); // The Quiet One
    R(151, { keywords: ['grounded'], aura: (api, t, i) => (i.targetPlayer === api.me && api.g.isPupil(t)) ? { die: 1 } : null }); // Trades Instructor
    R(152, { play: { run(api) { api.g.addEffect({ player: api.them, attackDie: -1, by: api.me, until: 'yourNextTurn' }); } } }); // Shy kid. Ruling: lasts through the opponent's next turn.
    R(153, { resource: produces(2, ['C']) }); // The Reformer
    R(156, { resource: produces(1, null, true) }); // The Hoarder
    // Gold Coin. Ruling: the new resource arrives SPENT. Arriving ready, it paid
    // for the Coin's own replay - play, use, replay - an endless free resource.
    R(157, { abilities: [{ label: 'Go home and gain a resource of any color (ready next turn)', spend: true, sendHome: true,
        run(api) { api.g.addResource(api.me, { anyColor: true, colors: ['O', 'G', 'P', 'B', 'Bk'], cardName: 'Gold Coin', spent: true }); } }] });
    R(158, { abilities: [{ label: 'Search your deck for "I got a Page!"', spend: true, // Workbook
        run(api) { api.g.searchDeck(api.me, c => c.name === 'I got a Page!', { prompt: 'Take "I got a Page!"', sourceName: 'Workbook' }); } }] });
    R(159, { abilities: [{ label: 'A pupil takes 1 more damage from everything this turn', spend: true, targets: [anyHarm()], // Flashcards
        run(api, ctx) { mod(api, ctx.targets[0], { damageTakenBonus: 1, until: EOT }); } }] });
    R(160, { abilities: [{ label: '+1 to die rolls this turn', spend: true, targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { die: 1, until: EOT }); } }] }); // Pencil
    R(161, { abilities: [{ label: '+1 to die rolls; draw if it scores', spend: true, targets: [anyBuff()], // Mechanical Pencil
        run(api, ctx) { mod(api, ctx.targets[0], { die: 1, drawOnScore: true, until: EOT }); } }] });
    R(163, { playerFlags: ['comfort'], resource: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { keywords: ['stubborn'], until: EOT }); } } }); // Moche
    R(165, { abilities: [{ label: 'A pupil recovers 1 Endurance', spend: true, targets: [anyBuff()], run(api, ctx) { api.g.heal(ctx.targets[0], 1); } }] }); // Luna
    R(166, { preventScoring: 1 }); // Leo the Goldfish
    R(167, { keywords: ['closedMinded'], rebuttal: 1 }); // Tuffy
    R(168, { // Obie - Bear
        abilities: [{ label: 'Go home: your opponent cannot play cards this turn', sendHome: true, timing: 'any',
            run(api) { api.g.state.players[api.them].flags.cannotPlayCards = true; } }],
        resource: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { mod(api, ctx.targets[0], { keywords: ['closedMinded'], until: EOT }); } }
    });
    R(169, { // Sammy the Golden Retriever
        triggers: { onYouScore(api, d) {
            if (d.player === api.me && api.g.pupilsOf(api.me).some(c => c.damage > 0)) {
                askTarget(api, 'lick', 'Sammy: a pupil of yours recovers 1 Endurance', c => api.g.controllerOf(c) === api.me && c.damage > 0, { buff: true });
            }
        } },
        choices: { lick(api, v) { const t = chosen(api, v); if (t) api.g.heal(t, 1); } }
    });
    R(170, { abilities: [{ label: 'Pay (1): Rex recovers 2 Endurance', spend: true, cost: '(1)', run(api) { api.g.heal(api.card, 2); } }] }); // Rex
    R(171, { // Tetrix
        abilities: [{ label: 'Pay (3): flip - heads, your opponent skips their next turn', cost: '(3)', oncePerTurn: true,
            run(api) {
                if (api.g.flipCoin()) { api.g.state.players[api.them].skipTurns++; api.g.log('Tetrix: heads! Your opponent skips a turn.'); }
                else api.g.log('Tetrix: tails.');
            } }],
        resource: { run(api) { api.g.addEffect({ player: api.them, die: -2, by: api.me }); } }
    });
    R(172, { abilities: [{ label: 'Add a colorless resource this turn', spend: true, // Poodoo Bean
        run(api) { api.g.addResource(api.me, { colors: ['C'], temporary: true, cardName: 'Poodoo Bean' }); } }] });
    R(173, { dieBonus: (api) => api.card.damage || 0 }); // Lolly
    R(174, { triggers: { onOtherEnter(api, d) { if (d.player === api.me) mod(api, api.card, { die: 1, end: 1, until: EOT }); } } }); // Bugati
    R(175, keywords('grounded')); // Oreo
    R(176, { abilities: [ // Gretel
        { label: 'Add a cute counter', spend: true, run(api) { api.g.addCounter(api.card, 'cute', 1); } },
        { label: 'Remove a cute counter: score 1 point', spend: true, counterCost: 'cute', run(api) { api.g.gainPoints(api.me, 1, api.card); } }
    ] });
    R(177, { abilities: [{ label: 'A pupil of yours strikes first this turn', spend: true, targets: [ally()], // Snail
        run(api, ctx) { mod(api, ctx.targets[0], { keywords: ['firstStrike'], until: EOT }); } }] });
    R(178, keywords('relentless')); // Simba
    R(179, keywords('impulsive', 'relentless')); // Sonic the Hamster
    R(182, { aura: (api, t) => (api.g.isPupil(t) && api.g.effectiveDice(t).sides >= 6) ? { cannotAttack: true } : null }); // Library. Ruling: "Attack Die 3 or greater" = a d6 or larger.
    R(183, { play: { targets: [ally({ other: true, fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) mod(api, ctx.targets[0], { end: 2, until: 'permanent' }); } } }); // Adoptive Parent
    R(184, { keywords: ['allColors'], resource: produces(1, null, true) }); // Substitute
    R(185, { // Tinkerer
        play: { run(api) { api.g.searchDeck(api.me, c => api.g.isTool(c), { prompt: 'You may choose a Tool', sourceName: 'Tinkerer' }); } },
        resource: { targets: [tool('you', { buff: true, fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) api.g.ready(ctx.targets[0]); } }
    });
    R(186, { play: { targets: [enemy({ fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) mod(api, ctx.targets[0], { cannotBlock: true, until: EOT }); } } }); // Influencer
    R(187, { abilities: [{ label: 'A resource makes any color this turn', spend: true, targets: [myResource({ filter: (g, r) => !r.anyColor })], // Transformer
        run(api, ctx) { const r = ctx.targets[0]; r.anyColor = true; r.tempAnyColor = true; } }] });
    R(188, { abilities: [{ label: '+2/-1 until end of turn', spend: true, targets: [anyBuff()], // Marker
        run(api, ctx) { mod(api, ctx.targets[0], { die: 2, end: -1, until: EOT }); } }] });
    R(189, { abilities: [{ label: 'Go home: draw 2 cards', spend: true, sendHome: true, run(api) { api.g.draw(api.me, 2); } }] }); // Pen
    R(190, { play: { run(api) { api.g.pupilsOf(api.them).forEach(c => api.g.spend(c)); } } }); // Laziness
    R(191, { aura: (api, t) => (api.g.isPupil(t) && api.g.enduranceWithoutAuras(t) + t.damage <= 4) ? { die: 2 } : null }); // Playground
    R(192, { aura: (api, t, i) => !api.g.isPupil(t) ? null : (i.targetPlayer === api.me ? { die: 1 } : { end: -1 }) }); // University
    R(193, { costReduction: (api, x) => (x.player === api.me && x.kind === 'Interruption') ? 1 : 0 }); // Visual Aid
    R(194, { abilities: [{ label: 'Deal 1 damage to a pupil', spend: true, targets: [anyHarm()], run(api, ctx) { dmg(api, ctx.targets[0], 1); } }] }); // Illustration
    R(195, { abilities: [{ label: 'Look at the top 3, keep one', spend: true, run(api) { api.g.lookAtTop(api.me, 3, 1, { sourceName: 'Journal' }); } }] }); // Journal

    // ======================================================================
    // INTERRUPTIONS (Purple, Green, Blue, Black, colorless)
    // ======================================================================

    const damageCard = (n) => ({ play: { targets: [anyHarm()], run(api, ctx) { api.g.dealDamage(ctx.targets[0], n, null, { sourcePlayer: api.me }); } } });
    R(196, damageCard(2)); // Outburst
    R(197, damageCard(4)); // Tirade
    R(198, { play: { targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { die: 2, until: EOT }); } } }); // Emotional Appeal
    R(199, { play: { targets: [ally()], run(api, ctx) { api.g.sendHome(ctx.targets[0]); api.g.draw(api.me, 1); } } }); // Dramatic Exit
    R(200, { play: { run(api) { api.g.allPupils().forEach(c => api.g.dealDamage(c, 2, null, { sourcePlayer: api.me })); } } }); // Heated Exchange
    R(201, { play: { run(api) { api.g.draw(api.me, 1); api.g.askDiscard(api.me, 1, { sourceName: 'Creative Spark' }); } } }); // Creative Spark
    R(202, { play: { targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { die: 3, end: -2, until: EOT }); } } }); // Wild Gesture
    R(203, { play: { // Mood Swing
        targets: [pupil('any', { label: 'the first pupil' }), pupil('any', { label: 'the second pupil' })],
        run(api, ctx) {
            const g = api.g; const [a, b] = ctx.targets;
            const ca = a.currentEndurance, cb = b.currentEndurance;
            const setTo = (card, want) => {
                const max = g.maxEndurance(card);
                if (want > max) { g.addMod(card, { end: want - max, until: 'permanent' }, api.me); card.damage = 0; }
                else card.damage = max - want;
            };
            setTo(a, cb); setTo(b, ca);
            g.refreshAll();
        } } });
    R(204, { play: { targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { end: 4, until: EOT }); } } }); // Passionate Defense
    R(205, { play: { run(api) { // Improvisation
        if (api.g.flipCoin()) { api.g.log('Improvisation: heads.'); api.g.draw(api.me, 2); }
        else { api.g.log('Improvisation: tails.'); api.g.draw(api.them, 1); }
    } } });
    R(206, { play: { targets: [anyHarm()], run(api, ctx) { mod(api, ctx.targets[0], { die: -2, until: EOT }); } } }); // Performance Anxiety
    R(207, { play: { run(api) { api.g.pupilsOf(api.me).forEach(c => { api.g.ready(c); mod(api, c, { keywords: ['impulsive'], until: EOT }); c.hasGettingBearings = false; }); } } }); // Standing Ovation
    R(208, { play: { targets: [anyHarm()], run(api, ctx) { mod(api, ctx.targets[0], { keywords: ['nonSequitur'], until: EOT }); } } }); // Abstract Thought
    R(209, { play: { targets: [anyHarm()], // Catharsis
        canPlay: (api, p) => api.g.state.players[p].damageTakenThisTurn > 0 ? null : 'Your pupils have taken no damage this turn',
        run(api, ctx) { api.g.dealDamage(ctx.targets[0], api.g.state.players[api.me].damageTakenThisTurn, null, { sourcePlayer: api.me }); } } });
    R(210, { play: { targets: [anyHarm({ label: 'a pupil with 3 Endurance or less', filter: (g, c) => c.currentEndurance <= 3 })], run(api, ctx) { api.g.exhaust(ctx.targets[0]); } } }); // Dissection
    R(211, { play: { run(api) { api.g.allPupils().forEach(c => api.g.addCounter(c, 'minusOne', 1)); } } }); // Natural Decay
    R(212, { play: { targets: [anyBuff({ label: 'the pupil that gets +2/+2' }), anyHarm({ label: 'the pupil that gets a -1/-1 counter' })], // Mutation
        run(api, ctx) { mod(api, ctx.targets[0], { die: 2, end: 2, until: EOT }); api.g.addCounter(ctx.targets[1], 'minusOne', 1); } } });
    R(213, { play: { run(api) { api.g.lookAtTop(api.me, 4, 1, { sourceName: 'Controlled Experiment' }); } } }); // Controlled Experiment
    R(214, { play: { targets: [anyBuff()], run(api, ctx) { // Symbiosis
        const t = ctx.targets[0];
        const n = api.g.pupilsOf(api.me).filter(c => c.instanceId !== t.instanceId).length;
        if (n) mod(api, t, { die: n, end: n, until: EOT });
    } } });
    R(215, { play: { targets: [anyHarm()], run(api, ctx) { // Decomposition
        const t = ctx.targets[0]; const who = api.g.controllerOf(t); const n = api.g.manaValue(t);
        api.g.exhaust(t);
        for (let i = 0; i < n; i++) api.g.addResource(who, { colors: ['C'], spent: true, cardName: 'Decomposition' });
    } } });
    R(216, { play: { targets: [anyHarm()], run(api, ctx) { // Lab Accident
        const t = ctx.targets[0];
        api.g.dealDamage(t, 3, null, { sourcePlayer: api.me });
        if (t._markedLethal || t.currentEndurance <= 0) api.g.draw(api.me, 2);
    } } });
    R(217, { play: { modes: ['grounded', 'closedMinded', 'relentless'].map(k => ({ // Adaptation
        label: { grounded: 'Grounded (cannot attack)', closedMinded: 'Closed-Minded', relentless: 'Relentless' }[k],
        targets: [k === 'relentless' ? anyBuff() : pupil('any')],
        run(api, ctx) { mod(api, ctx.targets[0], { keywords: [k], until: EOT }); }
    })) } });
    R(218, { play: { timing: 'any', targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { preventNext: 3, until: EOT }); } } }); // Calculated Risk
    R(219, { play: { run(api) { api.g.state.players[api.me].flags.refuteNextInterruption = true; } } }); // Proof of Concept: arms against the next one
    R(220, { play: { run(api) { // Statistical Analysis
        const hand = api.g.state.players[api.them].hand;
        api.g.ask(api.me, { kind: 'cards', prompt: "Your opponent's hand", reveal: true, min: 0, max: 0,
            options: hand.map(c => ({ value: c.instanceId, label: c.name, card: c })), cont: { engine: 'acknowledge' }, sourceName: 'Statistical Analysis' });
    } } });
    R(221, { play: { run(api) { // Order of Operations
        const top = api.g.state.players[api.me].deck.slice(0, 4);
        if (top.length > 1) api.g.ask(api.me, { kind: 'order', prompt: 'Put these in order (first is the top)',
            options: top.map(c => ({ value: c.instanceId, label: c.name, card: c })), min: top.length, max: top.length,
            cont: { engine: 'order' }, data: {}, sourceName: 'Order of Operations' });
    } } });
    R(222, { play: { targets: [anyHarm()], run(api, ctx) { mod(api, ctx.targets[0], { disableAbilities: true, until: EOT }); } } }); // Logical Fallacy
    R(223, { play: { targets: [pupil('any')], run(api, ctx) { // Balance Equation
        const t = ctx.targets[0];
        t.damage = 0; t.counters.plusOne = 0; t.counters.minusOne = 0;
        t.mods = t.mods.filter(m => !m.end && m.setEndurance === undefined);
        api.g.refreshAll();
    } } });
    R(224, { play: { targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { maxOneBlocker: true, until: EOT }); } } }); // Prime Numbers
    R(225, { play: { run(api) { api.g.draw(api.me, 2); } } }); // Theorem
    R(226, { play: { targets: [anyHarm()], run(api, ctx) { const t = ctx.targets[0]; api.g.spend(t); t.skipReady = Math.max(t.skipReady || 0, 1); } } }); // System Crash
    R(227, { play: { run(api) { pickFromOpponentHand(api, false); } } }); // Data Breach
    R(228, { play: { targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { die: 3, endTurnDamage: 2, until: EOT }); } } }); // Overclock
    R(229, { play: { targets: [{ kind: 'pupilOrTool', side: 'any', label: 'a pupil or Tool' }], run(api, ctx) { // Debugging
        const t = ctx.targets[0]; Object.keys(t.counters).forEach(k => { t.counters[k] = 0; }); api.g.refreshAll();
    } } });
    R(230, { play: { targets: [anyBuff()], run(api, ctx) { api.g.ready(ctx.targets[0]); mod(api, ctx.targets[0], { keywords: ['relentless'], until: EOT }); } } }); // Firmware Update
    R(231, { play: { run(api) { const n = api.g.toolsOf(api.me).length; if (n) api.g.draw(api.me, n); } } }); // Network Effect
    R(232, { play: { targets: [tool('them', { harm: true })], run(api, ctx) { api.g.changeControl(ctx.targets[0], api.me, 'endOfTurn'); } } }); // Malware
    R(233, { play: { run(api) { [...api.g.toolsOf(1), ...api.g.toolsOf(2)].forEach(t => api.g.sendHome(t)); } } }); // Hard Reset
    R(234, { play: { timing: 'any', run(api) { const f = api.g.state.players[api.me].flags; f.rerolls = (f.rerolls || 0) + 1; } } }); // Second Opinion
    R(235, { play: { timing: 'combat', run(api) { api.g.cancelCombat(); } } }); // Time Out
    R(236, { play: { run(api) { api.g.draw(api.me, 1); api.g.draw(api.them, 1); } } }); // Common Ground
    R(237, { play: { targets: [anyHarm()], run(api, ctx) { api.g.sendHome(ctx.targets[0]); } } }); // Change of Subject
    R(238, { play: { run(api) { api.g.draw(api.me, 2); } } }); // Quick Study
    R(239, { play: { run(api) { api.g.pupilsOf(api.me).forEach(c => mod(api, c, { die: 1, until: EOT })); } } }); // Rally the Crowd

    // ======================================================================
    // MULTICOLOR
    // ======================================================================

    R(240, keywords('precision')); // CAD Designer
    R(241, { triggers: { onDealsDamage(api) { api.g.draw(api.me, 1); } } }); // Digital Artist
    R(242, { play: { run(api) { // Mad Scientist
        if (api.g.flipCoin()) { api.g.log('Mad Scientist: heads, +3/+3.'); mod(api, api.card, { die: 3, end: 3, until: 'permanent', player: api.me, friendly: true }); }
        else { api.g.log('Mad Scientist: tails.'); api.g.dealDamage(api.card, 3, null, { sourcePlayer: api.me }); }
    } } });
    R(243, { play: { run(api) { // Data Analyst
        const top = api.g.state.players[api.them].deck.slice(0, 3);
        api.g.ask(api.me, { kind: 'cards', prompt: "The top of your opponent's deck", reveal: true, min: 0, max: 0,
            options: top.map(c => ({ value: c.instanceId, label: c.name, card: c })), cont: { engine: 'acknowledge' }, sourceName: 'Data Analyst' });
    } } });
    R(244, { keywords: ['grounded'], play: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) api.g.addCounter(ctx.targets[0], 'plusOne', 1); } } }); // Lab Technician
    R(245, { keywords: ['impulsive'], play: { targets: [anyBuff({ fizzleIfNone: true })], run(api, ctx) { if (ctx.targets[0]) mod(api, ctx.targets[0], { end: 2, until: 'permanent' }); } } }); // Set Designer
    R(246, { triggers: { onExhaustsPupil(api, d) { if (d.victim.owner !== api.me) api.g.draw(api.me, 1); } } }); // Physics Enthusiast
    R(247, { triggers: { onAnyExhausted(api, d) { if (d.dead.instanceId !== api.card.instanceId) api.g.addCounter(api.card, 'plusOne', 1); } } }); // Biotech Intern
    R(248, { // Music Theory Student
        triggers: { onInterruptionPlayed(api, d) {
            if (d.player === api.me && !d.refuted) askTarget(api, 'flat', 'Music Theory Student: a pupil gets -1 to die rolls this turn', null, { harm: true });
        } },
        choices: { flat(api, v) { const t = chosen(api, v); if (t) mod(api, t, { die: -1, until: EOT }); } }
    });
    R(249, { costReduction: (api, x) => (x.player === api.me && x.kind === 'Tool') ? 1 : 0, abilities: [readyTool] }); // Robotics Club Captain
    R(250, { // Applied Sciences Coordinator, Jerome. Ruling: Grounded, so "when Jerome attacks" means when you attack.
        keywords: ['grounded', 'relentless'],
        aura: (api, t, i) => (i.targetPlayer === api.me && api.g.isPupil(t)) ? { end: 2 } : null,
        triggers: { onAttackersDeclared(api, d) {
            if (d.player !== api.me) return;
            if (!api.g.pupilsOf(api.me).some(c => c.isSpent && c.instanceId !== api.card.instanceId)) return;
            askTarget(api, 'ready', 'Jerome: you may ready another pupil you control',
                c => api.g.controllerOf(c) === api.me && c.isSpent && c.instanceId !== api.card.instanceId, { optional: true, buff: true });
        } },
        choices: { ready(api, v) { const t = chosen(api, v); if (t) api.g.ready(t); } },
        resource: { run(api) { api.g.pupilsOf(api.me).forEach(c => mod(api, c, { die: 1, end: 1, until: EOT })); } }
    });
    R(251, { // Traveling Missionary, Paul
        play: { run(api) { api.g.draw(api.me, 2); api.g.draw(api.them, 2); } },
        triggers: { onAnyExhausted(api, d) {
            if (d.dead.instanceId === api.card.instanceId || !api.g.canPay('(1)', api.me)) return;
            if (!api.g.pupilsOf(api.me).some(c => c.damage > 0)) return;
            askTarget(api, 'mend', 'Paul: you may pay (1) to recover 2 Endurance on a pupil',
                c => api.g.controllerOf(c) === api.me && c.damage > 0, { optional: true, buff: true });
        } },
        choices: { mend(api, v) { const t = chosen(api, v); if (t && api.g.pay('(1)', api.me)) api.g.heal(t, 2); } },
        resource: { run(api) {
            for (const p of [1, 2]) {
                const worst = api.g.pupilsOf(p).sort((a, b) => b.damage - a.damage)[0];
                if (worst && worst.damage > 0) api.g.heal(worst, 2);
            }
        } }
    });
    R(252, { // STEM Initiative Director, Mary
        costReduction: (api, x) => (x.player === api.me && (x.kind === 'Tool' || x.kind === 'Interruption')) ? 1 : 0,
        triggers: { onInterruptionPlayed(api, d) {
            if (d.player === api.me && !d.refuted) askTarget(api, 'boost', 'Mary: a pupil gets +1/+1 this turn', null, { buff: true });
        } },
        choices: { boost(api, v) { const t = chosen(api, v); if (t) mod(api, t, { die: 1, end: 1, until: EOT }); } },
        resource: { run(api) { api.g.state.players[api.me].flags.nextIdeaDiscount = 2; } }
    });
    R(253, { play: { timing: 'any', targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { preventAll: true, die: 2, until: EOT }); } } }); // Structural Analysis
    R(254, { play: { targets: [anyHarm()], run(api, ctx) { // Viral Content
        const n = api.g.dealDamage(ctx.targets[0], 3, null, { sourcePlayer: api.me });
        if (n) api.g.draw(api.me, n);
    } } });
    R(255, { play: { // Explosive Results
        targets: [pupil('you', { label: 'a pupil of yours to send home' }), anyHarm({ label: 'the pupil to hit', other: true })],
        run(api, ctx) {
            const [mine, target] = ctx.targets;
            const n = mine.currentEndurance;
            api.g.sendHome(mine);
            api.g.dealDamage(target, n, null, { sourcePlayer: api.me });
        } } });
    R(256, { play: { run(api) { api.g.draw(api.me, 2); api.g.askDiscard(api.them, 1, { sourceName: 'Information Overload' }); } } }); // Information Overload
    R(257, { play: { targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { die: 2, end: 2, until: EOT, permanentIfKills: true }); } } }); // Field Test
    R(258, { play: { run(api) { api.g.lookAtTop(api.me, 5, 2, { rest: 'discard', prompt: 'Choose 2 to put in your hand; the rest are discarded', sourceName: 'Hypothesis' }); } } }); // Hypothesis
    R(259, { abilities: [ // Synthesizer
        { label: '+2 to die rolls this turn', spend: true, targets: [anyBuff()], run(api, ctx) { mod(api, ctx.targets[0], { die: 2, until: EOT }); } },
        { label: 'Draw a card, then discard a card', spend: true, run(api) { api.g.draw(api.me, 1); api.g.askDiscard(api.me, 1, { sourceName: 'Synthesizer' }); } }
    ] });
    R(260, { // Drafting Table
        aura: (api, t, i) => (i.targetPlayer === api.me && api.g.isPupil(t)) ? { end: 1 } : null,
        abilities: [{ label: 'Prevent the next 2 damage to a pupil this turn', spend: true, targets: [anyBuff()],
            run(api, ctx) { mod(api, ctx.targets[0], { preventNext: 2, until: EOT }); } }]
    });
    R(261, { // Gene Sequencer
        triggers: { onAnyExhausted(api) {
            if (!api.g.canPay('(1)', api.me) || !api.g.state.players[api.me].deck.length) return;
            api.g.ask(api.me, { kind: 'option', prompt: 'Gene Sequencer: pay (1) to draw a card?', min: 1, max: 1,
                options: [{ value: 'yes', label: 'Pay (1), draw' }, { value: 'no', label: 'No' }],
                cont: { card: 261, key: 'draw' }, sourceName: 'Gene Sequencer' });
        } },
        choices: { draw(api, v) { if (v[0] === 'yes' && api.g.pay('(1)', api.me)) api.g.draw(api.me, 1); } },
        abilities: [{ label: 'Put a -1/-1 counter on a pupil', spend: true, targets: [anyHarm()], run(api, ctx) { api.g.addCounter(ctx.targets[0], 'minusOne', 1); } }]
    });
    R(262, { // Inspirational Speaker, Paul
        keywords: ['impulsive'],
        play: { run(api) { api.g.pupilsOf(api.me).forEach(c => mod(api, c, { die: 2, until: EOT })); } },
        triggers: { onYouScore(api, d) {
            if (d.player === api.me) askTarget(api, 'zing', 'Paul: you may deal 1 damage to a pupil', null, { optional: true, harm: true });
        } },
        choices: { zing(api, v) { const t = chosen(api, v); if (t) dmg(api, t, 1); } },
        resource: { run(api) { api.g.pupilsOf(api.me).forEach(c => mod(api, c, { die: 1, until: EOT })); } }
    });

    // I got a Page! - the card Workbook finds. Added 2026-09-26; the card
    // library spreadsheet has no row for it yet.
    R(263, { play: { targets: [ally()], run(api, ctx) { api.g.addCounter(ctx.targets[0], 'plusOne', 1); api.g.draw(api.me, 1); } } });

    RiutizCards.helpers = { pupil, ally, enemy, anyBuff, anyHarm, tool };

    if (typeof window !== 'undefined') window.RiutizCards = RiutizCards;
    if (typeof module !== 'undefined' && module.exports) module.exports = { RiutizCards };
    if (typeof globalThis !== 'undefined') globalThis.RiutizCards = RiutizCards;
})();
