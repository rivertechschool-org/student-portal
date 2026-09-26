// games/riutiz/RiutizAI.js
// The RIUTIZ computer opponent.
//
// Rewritten with the engine in 2026-09. The old AI never played an
// Interruption, never used an ability, and turned its locations into
// resources; with 262 different cards, a rule per card was never going to
// keep up. This one decides by LOOKING AHEAD: for each thing it could do -
// every playable card, in every mode, at the most plausible targets, and every
// usable ability - it plays the move out on a copy of the game and scores the
// board that results. It makes the best move while one improves on doing
// nothing, then fights and ends its turn. A new card needs no AI code: the
// engine already knows what it does.
//
// Combat uses rules of thumb (attack when a pupil survives or trades well,
// block to save points or win a trade), plus the same look-ahead for the
// defender's combat-time cards (Flash Point, Time Out, Calculated Risk...).
//
// Three difficulties (options.difficulty):
//   easy   - no look-ahead: a random affordable card at a random legal target,
//            attacks with about half its pupils, blocks at random.
//   normal - looks ahead, but at only part of its options and with its judge-
//            ment fuzzed; blocks one-on-one; no combat tricks.
//   hard   - everything: full look-ahead, gang blocks, combat tricks.
//
// Public surface used by the page and the tests: new RiutizAI(game, player,
// { difficulty }), takeTurn(), declareBlockers(), answerChoice(),
// thinkingDelay, actionDelay.

class RiutizAI {
    constructor(game, playerNum = 2, options = {}) {
        this.game = game;
        this.playerNum = playerNum;
        this.thinkingDelay = options.thinkingDelay ?? 700;
        this.actionDelay = options.actionDelay ?? 600;
        this.difficulty = RiutizAI.DIFFICULTIES[options.difficulty] ? options.difficulty : 'hard';
        this.aggression = options.aggression ?? 0.5;   // 0 cautious .. 1 reckless
        this.isRunning = false;
        this._blocking = false;
        // Another player's card can ask US something ("discard a card"):
        // answer it whenever it comes up, not only on our own turn.
        this._onChoice = () => setTimeout(() => this.answerChoice(), Math.min(this.actionDelay, 400));
        game.addEventListener('choiceNeeded', this._onChoice);
    }

    detach() { this.game.removeEventListener('choiceNeeded', this._onChoice); }

    static get DIFFICULTIES() {
        return {
            easy: { label: 'Easy', lookahead: false },
            normal: { label: 'Normal', lookahead: true, sample: 0.6, noise: 2.5 },
            hard: { label: 'Hard', lookahead: true, sample: 1, noise: 0 }
        };
    }

    get level() { return RiutizAI.DIFFICULTIES[this.difficulty]; }

    get g() { return this.game; }
    get me() { return this.playerNum; }
    get them() { return this.playerNum === 1 ? 2 : 1; }

    delay(ms) { return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve(); }

    // ======================================================================
    // Board evaluation
    // ======================================================================

    // Expected die result for a pupil, with or without this turn's boosts.
    expectedRoll(g, card, includeTemporary = true) {
        const d = g.effectiveDice(card);
        let e = 0;
        if (d.sides) {
            const n = Math.max(1, d.count) + (g.hasAdvantage(card) ? 1 : 0);
            // expected maximum of n dice
            let sum = 0;
            for (let k = 1; k <= d.sides; k++) sum += 1 - Math.pow((k - 1) / d.sides, n);
            e = sum;
        }
        const def = g.def(card);
        if (def?.combatRoll && card.id == 105) e = 2;          // four coins
        let mod = g.dieModifier(card);
        if (!includeTemporary) for (const m of card.mods || []) if (m.die && m.until !== 'permanent') mod -= m.die;
        return Math.max(0, e + mod);
    }

    pupilValue(g, card, forSide) {
        const kws = g.keywords(card);
        const eNow = this.expectedRoll(g, card, true);
        const ePerm = this.expectedRoll(g, card, false);
        let end = card.currentEndurance;
        for (const m of card.mods || []) if (m.end && m.until !== 'permanent') end -= m.end;
        end = Math.max(0.5, end);
        let v = ePerm * 1.5 + end * 0.55;
        if (kws.has('lethal')) v += 3;
        if (kws.has('overwhelm')) v += 1;
        if (kws.has('firstStrike')) v += 1;
        if (kws.has('unblockable') || (card.mods || []).some(m => m.unblockable)) v += 1.5;
        if (kws.has('stubborn')) v += 2;
        if (kws.has('relentless')) v += 0.8;
        if (kws.has('nonSequitur')) v -= 0.5;
        if (g.cannotAttack(card)) v -= ePerm * 0.8;
        if (card.counters?.shield) v += card.counters.shield * 1.2;
        if (card.skipReady) v -= 1.5;
        // This turn's attack: a boosted pupil that can still attack is worth more now
        const g2 = g;
        const myTurn = g2.state.currentPlayer === forSide;
        const beforeCombat = g2.state.phase === 'main' && !g2.state.combatStep && !g2.state.players[forSide].flags.combatDone;
        if (myTurn && beforeCombat && !g.attackError(forSide, card)) v += Math.max(0, eNow - ePerm) * 1.2 + eNow * 0.3;
        return v;
    }

    sideValue(g, p) {
        const pl = g.state.players[p];
        let v = 0;
        for (const c of pl.field) {
            if (g.isPupil(c)) v += this.pupilValue(g, c, p);
            else if (g.isTool(c)) v += 2 + (c.isSpent ? 0 : 0.3);
            else if (g.isLocation(c)) v += 0.5;
        }
        v += pl.resources.filter(r => !r.temporary).length * 0.9;
        v += Math.min(pl.hand.length, 8) * 1.1;
        if (pl.deck.length === 0) v -= 6;
        v += (pl.flags.rerolls || 0) * 0.6;
        if (pl.flags.refuteNextInterruption) v += 1;
        if (pl.flags.preventNextPupil) v += 1;
        if (pl.flags.counterNextAbility) v += 0.6;
        if (pl.skipTurns) v -= 10;
        for (const e of g.state.effects || []) if (e.player === p) v += (e.die || 0) * 1.2 * g.pupilsOf(p).length + (e.attackDie || 0) * 0.8 * g.pupilsOf(p).length;
        return v;
    }

    evaluate(g, me = this.me) {
        const s = g.state;
        if (s.gameOver) return s.winner === me ? 1e6 : -1e6;
        const them = me === 1 ? 2 : 1;
        const P = s.players;
        // Points matter more as the game nears its end
        const pv = (n) => n * (2.5 + n / 12);
        return pv(P[me].points) - pv(P[them].points) + this.sideValue(g, me) - this.sideValue(g, them);
    }

    // A copy of the game to try things on.
    clone(g = this.game) {
        const Game = g.constructor;
        const sim = new Game({ cardData: g.cardData, cards: g.cards });
        sim.state = typeof structuredClone === 'function' ? structuredClone(g.state) : JSON.parse(JSON.stringify(g.state));
        sim.winCondition = g.winCondition;
        sim._sim = true;
        return sim;
    }

    // Finish any choices the sim raised, answering both sides sensibly.
    settle(sim) {
        for (let i = 0; i < 12 && sim.pendingChoice; i++) {
            const q = sim.pendingChoice;
            const r = sim.resolveChoice(q.player, this.pickChoice(sim, q, q.player));
            if (!r.success) sim.resolveChoice(q.player, q.kind === 'order' ? q.options.map(o => o.value) : q.options.slice(0, q.min).map(o => o.value));
        }
        return sim;
    }

    // ======================================================================
    // Candidates
    // ======================================================================

    // The few targets worth considering for a spec, best first.
    rankTargets(g, p, spec, source, chosen) {
        const legal = g.getTargets(p, spec, source, chosen);
        if (spec.kind === 'resource' || spec.kind === 'player' || spec.kind === 'opponent') return legal.slice(0, 3);
        const score = id => {
            const c = g.findInPlay(id);
            if (!c) return 0;
            const mine = g.controllerOf(c) === p;
            const val = g.isPupil(c) ? this.pupilValue(g, c, g.controllerOf(c)) : 2;
            if (spec.harm) return (mine ? -100 : 0) + val;
            if (spec.buff) return (mine ? 0 : -100) + val + (c.damage || 0) * 0.5;
            return val;
        };
        const sorted = [...legal].sort((a, b) => score(b) - score(a));
        // for harm, also try the cheapest enemy (a kill may beat a scratch)
        const picks = sorted.slice(0, 3);
        if (spec.harm) {
            const weak = [...legal].filter(id => g.controllerOf(g.findInPlay(id)) !== p)
                .sort((a, b) => (g.findInPlay(a)?.currentEndurance ?? 99) - (g.findInPlay(b)?.currentEndurance ?? 99))[0];
            if (weak && !picks.includes(weak)) picks.push(weak);
        }
        return picks;
    }

    targetCombos(g, p, specs, source, limit = 12) {
        let combos = [[]];
        for (const s of specs || []) {
            const next = [];
            for (const combo of combos) {
                const opts = this.rankTargets(g, p, s, source, combo);
                if (!opts.length) { if (s.optional || s.fizzleIfNone) next.push([...combo, undefined]); continue; }
                for (const t of opts) next.push([...combo, t]);
            }
            combos = next.slice(0, limit);
        }
        return combos;
    }

    // Every move worth trying now: [{ kind, id, index, choices, label }]
    candidates(g, p) {
        const out = [];
        const pl = g.state.players[p];
        for (const card of pl.hand) {
            const opts = g.getPlayOptions(p, card.instanceId);
            if (!opts.canPlay) continue;
            const modes = opts.modes || [{ index: undefined, targets: opts.targets }];
            for (const m of modes) {
                for (const t of this.targetCombos(g, p, m.targets, card)) {
                    out.push({ kind: 'play', id: card.instanceId, choices: { mode: m.index, targets: t }, label: card.name });
                }
            }
        }
        const hosts = [...pl.field, ...g.state.players[p === 1 ? 2 : 1].field.filter(c => g.def(c)?.sharedAbilities)];
        for (const card of hosts) {
            for (const ab of g.getAbilities(p, card.instanceId)) {
                if (!ab.canUse) continue;
                const modes = ab.modes || [{ index: undefined, targets: ab.targets }];
                for (const m of modes) {
                    for (const t of this.targetCombos(g, p, m.targets, card)) {
                        out.push({ kind: 'ability', id: card.instanceId, index: ab.index, choices: { mode: m.index, targets: t }, label: `${card.name}: ${ab.label}` });
                    }
                }
            }
        }
        return out;
    }

    apply(g, p, c) {
        if (c.kind === 'play') return g.playCard(p, c.id, false, c.choices);
        if (c.kind === 'resource') return g.playCard(p, c.id, true, c.choices);
        return g.activateAbility(p, c.id, c.index, c.choices);
    }

    // The best move and how much it gains; null if nothing beats standing still.
    bestMove(g = this.game, p = this.me, samples = 1) {
        const base = this.evaluate(g, p);
        let best = null, bestGain = 0.35;
        const { sample = 1, noise = 0 } = this.level || {};
        for (const c of this.candidates(g, p)) {
            if (sample < 1 && Math.random() > sample) continue;       // normal overlooks some options
            let total = 0, okRuns = 0;
            for (let s = 0; s < samples; s++) {
                const sim = this.clone(g);
                const r = this.apply(sim, p, c);
                if (!r.success) break;
                this.settle(sim);
                total += this.evaluate(sim, p); okRuns++;
            }
            if (!okRuns) continue;
            const gain = total / okRuns - base + (noise ? (Math.random() * 2 - 1) * noise : 0);
            if (gain > bestGain) { bestGain = gain; best = c; }
        }
        return best ? { move: best, gain: bestGain } : null;
    }

    // Easy: any card it can play, at any legal target, most of the time.
    randomMove(g = this.game, p = this.me) {
        if (Math.random() < 0.2) return null;
        const plays = this.candidates(g, p).filter(c => c.kind === 'play' || Math.random() < 0.3);
        if (!plays.length) return null;
        return { move: plays[Math.floor(Math.random() * plays.length)], gain: 0 };
    }

    // ======================================================================
    // Choices raised by the engine
    // ======================================================================

    cardWorth(g, card) {
        if (!card) return 0;
        const mv = g.manaValue(card);
        if (g.isPupil(card)) {
            const d = g.parseDice(card.dice);
            return (d.sides ? (d.sides + 1) / 2 : 0) * 1.4 + (parseInt(card.endurance, 10) || 0) * 0.4 + (g.def(card) ? 1 : 0);
        }
        return 2 + mv * 0.4;
    }

    pickChoice(g, q, p) {
        const opts = q.options || [];
        if (q.kind === 'order') {
            return [...opts].sort((a, b) => this.cardWorth(g, b.card) - this.cardWorth(g, a.card)).map(o => o.value);
        }
        if (q.reveal || q.max === 0) return [];
        if (q.kind === 'option') {
            const yes = opts.find(o => o.value === 'yes');
            const deck = g.state.players[p].deck.length;
            return [yes && deck > 3 ? 'yes' : opts[opts.length - 1].value];
        }
        const cont = q.cont || {};
        let ranked;
        if (cont.engine === 'discard' || /discard/i.test(q.prompt || '')) {
            // discard your own worst card (or, when choosing for the opponent, their best)
            const mineHand = opts.every(o => g.state.players[p].hand.some(c => c.instanceId === o.value));
            ranked = [...opts].sort((a, b) => mineHand ? this.cardWorth(g, a.card) - this.cardWorth(g, b.card)
                                                       : this.cardWorth(g, b.card) - this.cardWorth(g, a.card));
        } else if (q.harm) {
            ranked = [...opts].sort((a, b) => {
                const ca = g.findInPlay(a.value), cb = g.findInPlay(b.value);
                const va = ca ? (g.controllerOf(ca) === p ? -100 : this.pupilValue(g, ca, g.controllerOf(ca))) : 0;
                const vb = cb ? (g.controllerOf(cb) === p ? -100 : this.pupilValue(g, cb, g.controllerOf(cb))) : 0;
                return vb - va;
            });
            if (q.min === 0 && ranked.length && g.controllerOf(g.findInPlay(ranked[0].value)) === p) return [];
        } else if (q.buff) {
            ranked = [...opts].sort((a, b) => {
                const ca = g.findInPlay(a.value), cb = g.findInPlay(b.value);
                const va = ca ? (g.controllerOf(ca) === p ? 100 : 0) + (ca.damage || 0) + this.pupilValue(g, ca, p) * 0.1 : 0;
                const vb = cb ? (g.controllerOf(cb) === p ? 100 : 0) + (cb.damage || 0) + this.pupilValue(g, cb, p) * 0.1 : 0;
                return vb - va;
            });
            if (q.min === 0 && ranked.length && g.controllerOf(g.findInPlay(ranked[0].value)) !== p) return [];
        } else {
            // picking cards from a deck: the best ones
            ranked = [...opts].sort((a, b) => this.cardWorth(g, b.card) - this.cardWorth(g, a.card));
        }
        const n = Math.max(q.min, Math.min(q.max, q.min === 0 && !q.buff && !q.harm ? 1 : q.max));
        return ranked.slice(0, n).map(o => o.value);
    }

    // Answer the engine's question if it is ours. Safe to call any time.
    answerChoice() {
        const q = this.g.pendingChoice;
        if (!q || q.player !== this.me) return false;
        let r = this.g.resolveChoice(this.me, this.pickChoice(this.g, q, this.me));
        // Never leave the game waiting on us: if our pick is refused, give the
        // plainest valid answer instead.
        if (!r.success) {
            const vals = q.kind === 'order' ? q.options.map(o => o.value)
                       : q.options.slice(0, Math.max(q.min, 0)).map(o => o.value);
            r = this.g.resolveChoice(this.me, vals);
            if (!r.success) console.error('AI could not answer', q.prompt, r.error);
        }
        return r.success;
    }

    async answerAll() {
        for (let i = 0; i < 12 && this.g.pendingChoice && this.g.pendingChoice.player === this.me; i++) {
            this.answerChoice();
            await this.delay(Math.min(this.actionDelay, 300));
        }
    }

    // Wait while the other player has a decision to make.
    async waitForOther(maxMs = 120000) {
        const start = Date.now();
        while (this.g.pendingChoice && this.g.pendingChoice.player !== this.me && !this.g.state.gameOver) {
            if (Date.now() - start > maxMs) return false;
            await this.delay(250);
        }
        return true;
    }

    // ======================================================================
    // The turn
    // ======================================================================

    async takeTurn() {
        if (this.isRunning) return;
        const g = this.g;
        if (!g.state || g.state.gameOver || g.state.currentPlayer !== this.me) return;
        this.isRunning = true;
        try {
            await this.delay(this.thinkingDelay);
            await this.answerAll();
            await this.waitForOther();

            this.playResource();
            await this.answerAll();
            await this.delay(this.actionDelay);

            for (let step = 0; step < 12 && !g.state.gameOver; step++) {
                await this.waitForOther();
                const best = this.level.lookahead ? this.bestMove(g, this.me) : this.randomMove(g, this.me);
                if (!best) break;
                const r = this.apply(g, this.me, best.move);
                if (!r.success) break;
                await this.answerAll();
                await this.delay(this.actionDelay);
            }

            if (!g.state.gameOver && g.state.currentPlayer === this.me) await this.doCombat();

            // wait for the defender to block, and for combat to finish
            const start = Date.now();
            while (g.state.combatStep && !g.state.gameOver && Date.now() - start < 300000) {
                await this.answerAll();
                await this.delay(250);
            }
            await this.answerAll();
            await this.waitForOther();
            await this.delay(Math.min(400, this.actionDelay));
            if (!g.state.gameOver && g.state.currentPlayer === this.me && !g.state.combatStep) g.endTurn(this.me);
        } catch (error) {
            console.error('AI error:', error);
            // Never strand the game on the AI's turn
            if (!g.state.gameOver && g.state.currentPlayer === this.me) {
                g.state.pending = [];
                if (g.state.combatStep) g.endCombat(true);
                g.endTurn(this.me);
            }
        } finally {
            this.isRunning = false;
        }
    }

    // One resource a turn: the card that is least useful in hand, preferring
    // one whose resource ability helps, and a colour we are short of.
    playResource() {
        const g = this.g;
        if (g.canPlayResource(this.me)) return;
        const pl = g.state.players[this.me];
        if (!pl.hand.length) return;
        if (!this.level.lookahead) {
            const c = pl.hand[Math.floor(Math.random() * pl.hand.length)];
            const o = g.getPlayOptions(this.me, c.instanceId);
            const specs = o.resourceModes ? o.resourceModes[0].targets : o.resourceTargets;
            const t = (specs || []).map(sp => g.getTargets(this.me, sp, c, [])[0]);
            g.playCard(this.me, c.instanceId, true, { mode: o.resourceModes ? 0 : undefined, targets: t });
            return;
        }
        const base = this.evaluate(g);
        let best = null, bestScore = -Infinity;
        const need = {};
        for (const c of pl.hand) for (const [col, n] of Object.entries(g.parseCost(c.cost).colors)) need[col] = (need[col] || 0) + n;
        const have = {};
        for (const r of pl.resources) for (const col of (r.anyColor ? ['O', 'G', 'P', 'B', 'Bk'] : r.colors || [])) have[col] = (have[col] || 0) + 1;
        for (const c of pl.hand) {
            const opts = g.getPlayOptions(this.me, c.instanceId);
            const modes = opts.resourceModes || [{ index: undefined, targets: opts.resourceTargets }];
            for (const m of modes) {
                for (const t of this.targetCombos(g, this.me, m.targets, c, 4)) {
                    const sim = this.clone(g);
                    const r = sim.playCard(this.me, c.instanceId, true, { mode: m.index, targets: t });
                    if (!r.success) continue;
                    this.settle(sim);
                    let score = this.evaluate(sim) - base;
                    // keep what we can cast soon; spend what we cannot
                    const mv = g.manaValue(c);
                    const castableSoon = mv <= pl.resources.length + 2;
                    score -= castableSoon ? this.cardWorth(g, c) * 0.6 : this.cardWorth(g, c) * 0.15;
                    // colours we need and lack
                    for (const col of g.getAllColors(c.cost)) if ((need[col] || 0) > (have[col] || 0)) score += 1.5;
                    if (score > bestScore) { bestScore = score; best = { c, m, t }; }
                }
            }
        }
        if (best) g.playCard(this.me, best.c.instanceId, true, { mode: best.m.index, targets: best.t });
    }

    // Blockers the opponent could use against a given attacker.
    blockersFor(g, attacker, defender) {
        return g.pupilsOf(defender).filter(b => !g.blockError(defender, b, attacker));
    }

    async doCombat() {
        const g = this.g;
        const ready = g.pupilsOf(this.me).filter(c => g.canAttack(this.me, c));
        if (!ready.length) return;
        const defenders = g.pupilsOf(this.them).filter(b => !b.isSpent && !g.cannotBlock(b));
        const attackers = [];
        const blockerRolls = defenders.map(b => this.expectedRoll(g, b));
        const bestBlockRoll = blockerRolls.length ? Math.max(...blockerRolls) : 0;
        const myPts = g.state.players[this.me].points;
        // Close to winning: send everything
        const allIn = myPts + ready.reduce((s, c) => s + this.expectedRoll(g, c), 0) >= g.winCondition && defenders.length < ready.length;
        for (const a of ready) {
            if (!this.level.lookahead) { if (Math.random() < 0.5) attackers.push(a); continue; }
            const e = this.expectedRoll(g, a);
            if (e <= 0.5 && !g.keywords(a).has('overwhelm')) continue;
            const blockable = this.blockersFor(g, a, this.them);
            const survives = a.currentEndurance > bestBlockRoll || g.hasKeyword(a, 'stubborn') || g.hasKeyword(a, 'firstStrike');
            const threatens = blockable.some(b => e >= b.currentEndurance) || g.hasKeyword(a, 'lethal');
            const unblockable = blockable.length === 0;
            const cheap = this.pupilValue(g, a, this.me) < 4;
            if (allIn || unblockable || survives || threatens || (cheap && this.aggression > 0.4) || Math.random() < this.aggression * 0.3) {
                attackers.push(a);
            }
        }
        // Keep a blocker home when the opponent is close to winning
        const theirPts = g.state.players[this.them].points;
        const theirThreat = g.pupilsOf(this.them).reduce((s, c) => s + (g.cannotAttack(c) ? 0 : this.expectedRoll(g, c)), 0);
        if (!allIn && theirPts + theirThreat >= g.winCondition && attackers.length > 1) {
            const keep = attackers.sort((x, y) => y.currentEndurance - x.currentEndurance).shift();
            attackers.splice(attackers.indexOf(keep), 1);
        }
        if (!attackers.length) return;
        if (!g.startCombat(this.me).success) return;
        await this.delay(this.actionDelay);
        for (const a of attackers) g.toggleAttacker(this.me, a.instanceId);
        await this.delay(this.actionDelay);
        g.confirmAttackers(this.me);
        await this.answerAll();
    }

    // ======================================================================
    // Defending
    // ======================================================================

    async declareBlockers() {
        const g = this.g;
        if (this._blocking) return;
        if (g.state.combatStep !== 'declare-blockers' || g.state.currentPlayer === this.me) return;
        this._blocking = true;
        try {
            await this.delay(this.thinkingDelay);
            await this.answerAll();
            await this.waitForOther();
            if (g.state.combatStep !== 'declare-blockers') return;

            this.assignBlockers(g);

            // A combat trick, if one clearly helps (hard only)
            const trick = this.difficulty === 'hard' ? this.bestCombatTrick(g) : null;
            if (trick) {
                this.apply(g, this.me, trick);
                await this.answerAll();
                await this.delay(this.actionDelay);
                if (g.state.combatStep === 'declare-blockers') { g.state.blockers = {}; this.assignBlockers(g); }
            }
            await this.delay(this.actionDelay);
            if (g.state.combatStep === 'declare-blockers') {
                const r = g.confirmBlockers(this.me);
                if (!r.success) {
                    // must-be-blocked: satisfy it with the cheapest pupil
                    for (const att of g.unmetBlockRequirements(this.me)) {
                        const free = this.blockersFor(g, att, this.me).filter(b => !g.isBlocking(b.instanceId))
                            .sort((a, b) => this.pupilValue(g, a, this.me) - this.pupilValue(g, b, this.me));
                        if (free[0]) g.toggleBlocker(this.me, free[0].instanceId, att.instanceId);
                    }
                    g.confirmBlockers(this.me);
                }
            }
        } catch (error) {
            console.error('AI block error:', error);
            if (g.state.combatStep === 'declare-blockers') { g.state.blockers = {}; g.confirmBlockers(this.me); }
        } finally {
            this._blocking = false;
        }
    }

    assignBlockers(g) {
        const attackers = g.state.attackers.map(a => g.findInPlay(a.instanceId)).filter(Boolean)
            .sort((a, b) => this.expectedRoll(g, b) - this.expectedRoll(g, a));
        const used = new Set();
        if (!this.level.lookahead) {
            // Easy: each free pupil blocks a random attacker half the time
            for (const b of g.pupilsOf(this.me)) {
                if (Math.random() < 0.5 || !attackers.length) continue;
                const att = attackers[Math.floor(Math.random() * attackers.length)];
                g.toggleBlocker(this.me, b.instanceId, att.instanceId);
            }
            return;
        }
        const theirPts = g.state.players[this.them].points;
        const incoming = attackers.reduce((s, a) => s + this.expectedRoll(g, a), 0);
        const desperate = theirPts + incoming >= g.winCondition;
        for (const att of attackers) {
            if (g.modActive(att, m => m.refuted)) continue;
            const eAtt = this.expectedRoll(g, att);
            const options = this.blockersFor(g, att, this.me).filter(b => !used.has(b.instanceId));
            let best = null, bestScore = 0;
            for (const b of options) {
                const eB = this.expectedRoll(g, b);
                const bDies = g.hasKeyword(att, 'lethal') ? 1 : (eAtt >= b.currentEndurance && !g.hasKeyword(b, 'stubborn') ? 0.8 : 0.15);
                const aDies = g.hasKeyword(b, 'lethal') ? 1 : (eB >= att.currentEndurance && !g.hasKeyword(att, 'stubborn') ? 0.7 : 0.1);
                const saved = g.hasKeyword(att, 'overwhelm') ? Math.min(eAtt, b.currentEndurance) : eAtt;
                let score = saved * (desperate ? 3 : 1.3)
                          + aDies * this.pupilValue(g, att, this.them)
                          - bDies * this.pupilValue(g, b, this.me);
                if (score > bestScore) { bestScore = score; best = b; }
            }
            if (best) { g.toggleBlocker(this.me, best.instanceId, att.instanceId); used.add(best.instanceId); }
        }
        if (this.difficulty === 'hard') this.gangBlock(g, attackers, used);
    }

    // Two pupils on one attacker when together they can bring down what
    // neither could alone - and its roll can take out at most one of them.
    gangBlock(g, attackers, used) {
        for (const att of attackers) {
            if (g.modActive(att, m => m.refuted || m.maxOneBlocker)) continue;
            if (g.hasKeyword(att, 'stubborn')) continue;
            const current = g.blockersOf(att.instanceId).map(id => g.findInPlay(id)).filter(Boolean);
            const have = current.reduce((sum, b) => sum + this.expectedRoll(g, b), 0);
            if (have >= att.currentEndurance) continue;
            const eAtt = this.expectedRoll(g, att);
            const spare = this.blockersFor(g, att, this.me).filter(b => !used.has(b.instanceId) && !g.isBlocking(b.instanceId))
                .sort((a, b) => this.expectedRoll(g, b) - this.expectedRoll(g, a));
            for (const b of spare) {
                const together = have + this.expectedRoll(g, b);
                const bodies = [...current, b].reduce((sum, x) => sum + x.currentEndurance, 0);
                if (together < att.currentEndurance) continue;
                if (g.hasKeyword(att, 'lethal') || eAtt >= bodies) continue;      // it would take them all
                if (this.pupilValue(g, att, this.them) < this.pupilValue(g, b, this.me) * 0.8) continue;
                g.toggleBlocker(this.me, b.instanceId, att.instanceId);
                used.add(b.instanceId);
                break;
            }
        }
    }

    // Try each playable combat card and ability on copies of the combat, a few
    // times each (the dice decide combat), and keep one that clearly helps.
    bestCombatTrick(g) {
        const cands = this.candidates(g, this.me);
        if (!cands.length) return null;
        const outcome = (sim) => {
            if (sim.state.combatStep === 'declare-blockers') {
                if (!sim.confirmBlockers(this.me).success) { sim.state.blockers = {}; sim.confirmBlockers(this.me); }
            }
            this.settle(sim);
            return this.evaluate(sim, this.me);
        };
        const samples = 4;
        let base = 0;
        for (let i = 0; i < samples; i++) base += outcome(this.clone(g));
        base /= samples;
        let best = null, bestGain = 1.0;
        for (const c of cands) {
            let total = 0, n = 0;
            for (let i = 0; i < samples; i++) {
                const sim = this.clone(g);
                if (!this.apply(sim, this.me, c).success) break;
                this.settle(sim);
                total += outcome(sim); n++;
            }
            if (!n) continue;
            const gain = total / n - base;
            if (gain > bestGain) { bestGain = gain; best = c; }
        }
        return best;
    }
}

// Export
if (typeof window !== 'undefined') window.RiutizAI = RiutizAI;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizAI };
}
