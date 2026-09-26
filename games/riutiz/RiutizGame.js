// games/riutiz/RiutizGame.js
// RIUTIZ rules engine.
//
// Rewritten 2026-09 after an audit found most card text did nothing: the old
// engine pattern-matched ability TEXT, so a card whose wording no regex caught
// was silently inert, a loose regex ran the wrong effect ("counter" in any text
// was treated as a counterspell), and anything needing a target or a choice
// fired an event nobody listened to. Of 262 cards, about 50 worked as written.
//
// Now every card with an ability has an explicit definition in RiutizCards.js,
// looked up by card id, and this file is the rules those definitions run on:
//
//   - one damage path (protection, prevention, reduction, shields, lethal,
//     stubborn, rebuttal) instead of a copy per effect;
//   - stats DERIVED each time from base + counters + modifiers + auras, so an
//     "until end of turn" buff cannot leave a permanent residue behind;
//   - targets are chosen when a card is played (getPlayOptions / getTargets tell
//     the UI and the AI what is legal), and choices that only make sense
//     mid-effect ("look at the top 3, keep one") are a PENDING decision stored
//     in the state, so they survive a save, a reload and a multiplayer sync.
//
// The public surface the UI, AI and multiplayer code call is unchanged:
// startGame, playCard, canAfford, activateAbility, startCombat, toggleAttacker,
// confirmAttackers, toggleBlocker, confirmBlockers, endTurn, parseCost,
// getPrimaryColor, getSerializableState, loadState, isPlayerTurn, getOpponent.
//
// Rulings the card text leaves open are written down in games/riutiz/RULES.md.

const RIUTIZ_DIE_STEPS = [2, 3, 4, 6, 8, 10, 12, 20];

class RiutizGame extends EventTarget {
    constructor(options = {}) {
        super();
        this.mode = options.mode || 'vs-ai'; // 'vs-ai', 'local-pvp', 'online-pvp'
        this.cardData = options.cardData || [];
        this.player1Deck = options.player1Deck || null;
        this.player2Deck = options.player2Deck || null;
        this.cards = options.cards || (typeof window !== 'undefined' && window.RiutizCards) || null;
        this.state = null;
        this.winCondition = 25;
        this.handSize = 7;
        this._depth = 0;
    }

    static get COLORS() {
        return {
            O: { name: 'Orange', hex: '#f97316', bg: '#431407' },
            G: { name: 'Green', hex: '#22c55e', bg: '#052e16' },
            P: { name: 'Purple', hex: '#a855f7', bg: '#3b0764' },
            B: { name: 'Blue', hex: '#3b82f6', bg: '#172554' },
            Bk: { name: 'Black', hex: '#a1a1aa', bg: '#18181b' },
            C: { name: 'Colorless', hex: '#d4d4d8', bg: '#27272a' }
        };
    }

    static get COLOR_CODES() { return ['O', 'G', 'P', 'B', 'Bk']; }

    // ==========================================================================
    // Setup
    // ==========================================================================

    def(card) {
        if (!card || !this.cards) return null;
        return this.cards.get(card.id) || null;
    }

    findCardData(id) {
        const s = String(id);
        return this.cardData.find(c => String(c.id) === s) || null;
    }

    createInitialState() {
        return {
            turn: 1,
            currentPlayer: 1,
            phase: 'main',
            combatStep: null,
            attackers: [],
            blockers: {},
            players: {
                1: this.createPlayerState(this.player1Deck, 1),
                2: this.createPlayerState(this.player2Deck, 2)
            },
            pending: [],
            effects: [],
            log: [],
            nextId: 1,
            seq: 0,
            gameOver: false,
            winner: null,
            endReason: null
        };
    }

    createPlayerState(deckCards, playerNum) {
        const deck = deckCards && deckCards.length ? this.createDeckFromCards(deckCards, playerNum)
                                                   : this.createRandomDeck(playerNum);
        return {
            points: 0,
            deck: deck.slice(this.handSize),
            hand: deck.slice(0, this.handSize),
            field: [],
            resources: [],
            discard: [],
            interruptionPlayed: false,
            resourcePlayedThisTurn: false,
            skipTurns: 0,
            damageTakenThisTurn: 0,
            flags: {}
        };
    }

    createDeckFromCards(cardIds, owner) {
        const deck = [];
        cardIds.forEach((cardId, index) => {
            const data = this.findCardData(cardId);
            if (data) deck.push(this.createCardInstance(data, owner, index));
        });
        return this.shuffle(deck);
    }

    createRandomDeck(owner) {
        const pool = this.cardData.filter(c => c.type !== 'Location');
        const deck = [];
        for (let i = 0; i < 40; i++) {
            deck.push(this.createCardInstance(pool[Math.floor(this.random() * pool.length)], owner, i));
        }
        return this.shuffle(deck);
    }

    createCardInstance(cardData, owner = 1, index = 0) {
        const n = this.state ? this.state.nextId++ : index;
        const card = {
            ...cardData,
            instanceId: `${cardData.id}-${owner}-${n}-${Math.floor(this.random() * 1e9).toString(36)}`,
            owner,
            isToken: false
        };
        this.resetCard(card);
        return card;
    }

    // Everything a card forgets when it changes zone.
    resetCard(card) {
        card.damage = 0;
        card.counters = { plusOne: 0, minusOne: 0, shield: 0 };
        card.mods = [];
        card.isSpent = false;
        card.hasGettingBearings = true;
        card.skipReady = 0;
        card.dieUpgrades = 0;
        card.cumulativeDieBonus = 0;
        card.momentum = 0;
        card.preventNext = 0;
        card.attachedTimer = null;
        this.refreshCard(card);
        return card;
    }

    startGame() {
        this.state = this.createInitialState();
        this.log('Game started.');
        // Player 1 does not draw on the first turn: going first is already an edge.
        this.beginTurn(1, { skipDraw: true, first: true });
        this.emitEvent('gameStarted', { state: this.state });
        return this.state;
    }

    // ==========================================================================
    // Randomness (one place, so tests and replays can seed it)
    // ==========================================================================

    random() { return Math.random(); }
    flipCoin() { return this.random() < 0.5; }

    rollDie(sides) { return sides > 0 ? Math.floor(this.random() * sides) + 1 : 0; }

    parseDice(diceStr) {
        if (!diceStr || diceStr === '0' || diceStr === 'None') return { count: 0, sides: 0, adv: false };
        const m = String(diceStr).match(/(\d*)\s*d\s*(\d+)/i);
        if (!m) return { count: 0, sides: 0, adv: false };
        const count = parseInt(m[1], 10) || 1;
        return { count, sides: parseInt(m[2], 10), adv: count > 1 || /adv/i.test(diceStr) };
    }

    // A pupil's die after upgrades (Jock): d4 -> d6 -> d8 ...
    effectiveDice(card) {
        const over = (card.mods || []).filter(m => m.setDice).pop();
        const d = this.parseDice(over ? over.setDice : card.dice);
        if (!d.sides || !card.dieUpgrades) return d;
        let i = RIUTIZ_DIE_STEPS.indexOf(d.sides);
        if (i < 0) i = RIUTIZ_DIE_STEPS.findIndex(s => s > d.sides) - 1;
        const up = Math.min(RIUTIZ_DIE_STEPS.length - 1, Math.max(0, i) + card.dieUpgrades);
        return { ...d, sides: RIUTIZ_DIE_STEPS[up] };
    }

    diceLabel(card) {
        const d = this.effectiveDice(card);
        if (!d.sides) return '0';
        return `${d.count}d${d.sides}${d.count > 1 ? ' (adv)' : ''}`;
    }

    // "(adv)" and advantage both mean: roll the dice, keep the highest.
    rollDice(diceStr, extraAdvantage = false) {
        const d = typeof diceStr === 'object' ? diceStr : this.parseDice(diceStr);
        if (!d.sides) return 0;
        const n = Math.max(1, d.count) + (extraAdvantage ? 1 : 0);
        let best = 0;
        for (let i = 0; i < n; i++) best = Math.max(best, this.rollDie(d.sides));
        return best;
    }

    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ==========================================================================
    // Lookups
    // ==========================================================================

    other(p) { return p === 1 ? 2 : 1; }
    getOpponent(playerNum) { return this.state.players[this.other(playerNum)]; }
    isPlayerTurn(playerNum) { return this.state.currentPlayer === playerNum; }

    isPupil(card) { return !!card && /Pupil/.test(card.type || ''); }
    isTool(card) { return !!card && card.type === 'Tool'; }
    isLocation(card) { return !!card && card.type === 'Location'; }
    isInterruption(card) { return !!card && card.type === 'Interruption'; }

    allFieldCards() {
        return [...this.state.players[1].field, ...this.state.players[2].field];
    }

    allPupils() { return this.allFieldCards().filter(c => this.isPupil(c)); }

    pupilsOf(p) { return this.state.players[p].field.filter(c => this.isPupil(c)); }
    toolsOf(p) { return this.state.players[p].field.filter(c => this.isTool(c)); }

    findInPlay(instanceId) {
        for (const p of [1, 2]) {
            const card = this.state.players[p].field.find(c => c.instanceId === instanceId);
            if (card) return card;
        }
        return null;
    }

    controllerOf(card) {
        if (!card) return null;
        for (const p of [1, 2]) {
            if (this.state.players[p].field.some(c => c.instanceId === card.instanceId)) return p;
        }
        return card.controller || card.owner || null;
    }

    // Printed keywords only - what an aura may ask about without recursing.
    printedKeyword(card, kw) {
        return !!this.def(card)?.keywords?.includes(kw) && !this.modActive(card, m => m.disableAbilities);
    }

    colorsOf(card) {
        if (this.printedKeyword(card, 'allColors')) return RiutizGame.COLOR_CODES.slice();
        const { colors } = this.parseCost(card.cost);
        const keys = Object.keys(colors);
        return keys.length ? keys : ['C'];
    }

    hasSubtype(card, name) {
        if (this.printedKeyword(card, 'allTypes')) return true;
        return new RegExp(`\\b${name}`, 'i').test(card.subTypes || '');
    }

    isLegendary(card) { return /Legendary/.test(card.type || ''); }

    // ==========================================================================
    // Costs and resources
    // ==========================================================================

    parseCost(costStr) {
        if (!costStr || costStr === 'None') return { colors: {}, generic: 0, total: 0 };
        const colors = {};
        let generic = 0;
        (String(costStr).match(/\(([^)]+)\)/g) || []).forEach(m => {
            const v = m.slice(1, -1);
            if (/^\d+$/.test(v)) generic += parseInt(v, 10);
            else colors[v] = (colors[v] || 0) + 1;
        });
        const total = generic + Object.values(colors).reduce((a, b) => a + b, 0);
        return { colors, generic, total };
    }

    getPrimaryColor(costStr) {
        const keys = Object.keys(this.parseCost(costStr).colors);
        return keys.length ? keys[0] : 'C';
    }

    getAllColors(costStr) {
        const keys = Object.keys(this.parseCost(costStr).colors);
        return keys.length ? keys : ['C'];
    }

    manaValue(card) { return this.parseCost(card.cost).total; }

    resourceProvidesColor(res, color) {
        if (res.anyColor) return true;
        if (Array.isArray(res.colors)) return res.colors.includes(color);
        return res.color === color;
    }

    // The cost actually charged: printed cost less every reduction in play.
    effectiveCost(card, playerNum) {
        if (card.freeToPlay) return { colors: {}, generic: 0, total: 0 };
        const cost = this.parseCost(card.cost);
        let reduce = 0;
        const kind = this.isTool(card) ? 'Tool' : this.isInterruption(card) ? 'Interruption'
                   : this.isPupil(card) ? 'Pupil' : card.type;
        this.forEachAura((source, def) => {
            if (!def.costReduction) return;
            reduce += def.costReduction(this.api(source), { player: playerNum, card, kind }) || 0;
        });
        const player = this.state.players[playerNum];
        if (player.flags.nextIdeaDiscount && kind === 'Interruption') reduce += player.flags.nextIdeaDiscount;
        return { colors: cost.colors, generic: Math.max(0, cost.generic - reduce), total: 0 };
    }

    // Pay coloured pips with a proper matching (a greedy pass rejects
    // (1)(O)(P) against [O/P, O, G], which is payable), then generic.
    findPayment(cost, resources) {
        const avail = resources.map((r, i) => ({ r, i })).filter(x => !x.r.spent);
        const pips = [];
        for (const [color, n] of Object.entries(cost.colors)) for (let k = 0; k < n; k++) pips.push(color);
        // Most constrained pips first
        pips.sort((a, b) => avail.filter(x => this.resourceProvidesColor(x.r, a)).length
                          - avail.filter(x => this.resourceProvidesColor(x.r, b)).length);
        const used = new Set();
        const assign = (k) => {
            if (k === pips.length) return true;
            for (const x of avail) {
                if (used.has(x.i) || !this.resourceProvidesColor(x.r, pips[k])) continue;
                used.add(x.i);
                if (assign(k + 1)) return true;
                used.delete(x.i);
            }
            return false;
        };
        if (!assign(0)) return null;
        // Generic: spend the least flexible resources first
        const rest = avail.filter(x => !used.has(x.i))
            .sort((a, b) => (a.r.anyColor ? 1 : 0) - (b.r.anyColor ? 1 : 0));
        if (rest.length < cost.generic) return null;
        rest.slice(0, cost.generic).forEach(x => used.add(x.i));
        return [...used];
    }

    canPay(costOrStr, playerNum) {
        const cost = typeof costOrStr === 'string' ? this.parseCost(costOrStr) : costOrStr;
        return !!this.findPayment(cost, this.state.players[playerNum].resources);
    }

    pay(costOrStr, playerNum) {
        const cost = typeof costOrStr === 'string' ? this.parseCost(costOrStr) : costOrStr;
        const player = this.state.players[playerNum];
        const idx = this.findPayment(cost, player.resources);
        if (!idx) return false;
        idx.forEach(i => { player.resources[i].spent = true; });
        return true;
    }

    canAfford(card, player) {
        const p = typeof player === 'number' ? player
                : (this.state.players[1] === player ? 1 : 2);
        return this.canPay(this.effectiveCost(card, p), p);
    }

    addResource(playerNum, opts = {}) {
        const player = this.state.players[playerNum];
        const colors = opts.colors || ['C'];
        const res = {
            id: `res-${this.state.nextId++}`,
            color: opts.anyColor ? 'Any' : colors[0],
            colors,
            anyColor: !!opts.anyColor,
            spent: !!opts.spent,
            temporary: !!opts.temporary,
            cardName: opts.cardName || (opts.anyColor ? 'Any color' : colors.join('/')),
            card: opts.card || null
        };
        player.resources.push(res);
        return res;
    }

    // ==========================================================================
    // Derived stats
    // ==========================================================================

    // Keywords a card has right now. Abilities switched off (Logical Fallacy)
    // remove printed AND granted keywords.
    keywords(card) {
        if (!card) return new Set();
        if (card._kw && card._kwStamp === this._stamp) return card._kw;
        const set = new Set();
        const disabled = this.modActive(card, m => m.disableAbilities);
        if (!disabled) {
            const def = this.def(card);
            (def?.keywords || []).forEach(k => set.add(k));
            const closed = set.has('closedMinded');
            for (const m of card.mods || []) {
                if (!m.keywords) continue;
                if (closed && m.friendly) continue;
                m.keywords.forEach(k => set.add(k));
            }
            this.auraContributions(card).forEach(c => {
                if (c.keywords && !(closed && c.friendly)) c.keywords.forEach(k => set.add(k));
            });
        }
        (card.mods || []).forEach(m => { if (m.removeKeywords) m.removeKeywords.forEach(k => set.delete(k)); });
        return set;
    }

    hasKeyword(card, kw) { return this.keywords(card).has(kw); }

    modActive(card, pred) { return (card.mods || []).some(pred); }

    // Every static effect in play that touches this card, as
    // { die, end, dmgReduce, keywords, cannotAttack, cannotBlock, advantage,
    //   protection, friendly }. Auras live on card definitions (and locations).
    auraContributions(card) {
        // An aura that asks about another card's stats would come straight back
        // here; inside an aura, other auras are not consulted.
        if (this._inAura) return [];
        const out = [];
        const target = card;
        const tp = this.controllerOf(card);
        this.forEachAura((source, def, sp) => {
            if (!def.aura) return;
            if (this.modActive(source, m => m.disableAbilities)) return;
            this._inAura = true;
            let c;
            try { c = def.aura(this.api(source), target, { sourcePlayer: sp, targetPlayer: tp }); }
            finally { this._inAura = false; }
            if (c) out.push({ ...c, friendly: sp === tp, sourcePlayer: sp, source: source.instanceId });
        });
        return out;
    }

    forEachAura(fn) {
        if (!this.state) return;
        for (const p of [1, 2]) {
            for (const source of this.state.players[p].field) {
                const def = this.def(source);
                if (def && (def.aura || def.costReduction)) fn(source, def, p);
            }
        }
    }

    // Precision (CAD Designer): opponent effects cannot change its rolls.
    dieModifier(card) {
        const cp = this.controllerOf(card);
        const precise = this.hasKeyword(card, 'precision');
        const closed = this.hasKeyword(card, 'closedMinded');
        let total = (card.counters?.plusOne || 0) - (card.counters?.minusOne || 0)
                  + (card.cumulativeDieBonus || 0) + (card.momentum || 0);
        for (const m of card.mods || []) {
            if (!m.die) continue;
            if (precise && m.player && m.player !== cp) continue;
            if (closed && m.friendly && m.die > 0) continue;
            total += m.die;
        }
        for (const c of this.auraContributions(card)) {
            if (!c.die) continue;
            if (precise && c.sourcePlayer !== cp && c.die < 0) continue;
            if (closed && c.friendly && c.die > 0) continue;
            total += c.die;
        }
        for (const e of this.state.effects || []) {
            if (e.player !== cp || !e.die) continue;
            if (precise && e.by && e.by !== cp) continue;
            total += e.die;
        }
        const def = this.def(card);
        if (def?.dieBonus && !this.modActive(card, m => m.disableAbilities)) total += def.dieBonus(this.api(card)) || 0;
        return total;
    }

    // Bonuses that only apply to ATTACK rolls (Field, Backend Principal, Shy kid).
    attackModifier(card) {
        const cp = this.controllerOf(card);
        const precise = this.hasKeyword(card, 'precision');
        let t = 0;
        for (const c of this.auraContributions(card)) {
            if (!c.attackDie) continue;
            if (precise && c.sourcePlayer !== cp && c.attackDie < 0) continue;
            t += c.attackDie;
        }
        for (const e of this.state.effects || []) {
            if (e.player !== cp || !e.attackDie) continue;
            if (precise && e.by && e.by !== cp) continue;
            t += e.attackDie;
        }
        return t;
    }

    // A player-level effect: { player, die, attackDie, until, by }
    addEffect(effect) {
        const e = { until: 'endOfTurn', ...effect };
        if (e.until === 'yourNextTurn' && !e.expiresFor) e.expiresFor = e.by;
        this.state.effects.push(e);
        this.refreshAll();
    }

    // Endurance before static effects - what an aura may safely look at
    // (asking for the full figure from inside an aura would recurse).
    enduranceWithoutAuras(card) {
        let e = this.baseEndurance(card) + (card.counters?.plusOne || 0) - (card.counters?.minusOne || 0);
        for (const m of card.mods || []) if (m.end) e += m.end;
        return e - (card.damage || 0);
    }

    // Two pupils fight: each deals its roll to the other.
    fight(a, b) {
        if (!a || !b) return;
        const ra = this.combatRoll(a, 'fight');
        const rb = this.combatRoll(b, 'fight');
        this.log(`${a.name} (${ra}) fights ${b.name} (${rb}).`);
        this.dealDamage(b, ra, a, { lethal: this.hasKeyword(a, 'lethal') });
        this.dealDamage(a, rb, b, { lethal: this.hasKeyword(b, 'lethal') });
        this.checkStateBasedActions();
    }

    baseEndurance(card) {
        const over = (card.mods || []).filter(m => m.setEndurance !== undefined).pop();
        if (over) return over.setEndurance;
        const def = this.def(card);
        if (def?.baseEndurance) return def.baseEndurance(this.api(card));
        const n = parseInt(card.endurance, 10);
        return isNaN(n) ? 0 : n;
    }

    maxEndurance(card) {
        const closed = this.hasKeyword(card, 'closedMinded');
        let e = this.baseEndurance(card) + (card.counters?.plusOne || 0) - (card.counters?.minusOne || 0);
        for (const m of card.mods || []) if (m.end && !(closed && m.friendly && m.end > 0)) e += m.end;
        for (const c of this.auraContributions(card)) if (c.end && !(closed && c.friendly && c.end > 0)) e += c.end;
        return e;
    }

    damageReduction(card) {
        let r = 0;
        for (const m of card.mods || []) if (m.dmgReduce) r += m.dmgReduce;
        for (const c of this.auraContributions(card)) if (c.dmgReduce) r += c.dmgReduce;
        const def = this.def(card);
        if (def?.damageReduction && !this.modActive(card, m => m.disableAbilities)) r += def.damageReduction;
        return r;
    }

    hasAdvantage(card) {
        return this.hasKeyword(card, 'advantage')
            || this.auraContributions(card).some(c => c.advantage);
    }

    protectedFrom(card, sourceCard) {
        if (!sourceCard) return false;
        const colors = this.colorsOf(sourceCard);
        const prot = new Set();
        (card.mods || []).forEach(m => (m.protection || []).forEach(c => prot.add(c)));
        this.auraContributions(card).forEach(c => (c.protection || []).forEach(x => prot.add(x)));
        return colors.some(c => prot.has(c));
    }

    cannotAttack(card) {
        if (this.hasKeyword(card, 'grounded') || this.hasKeyword(card, 'cannotAttack')) return true;
        if (this.modActive(card, m => m.cannotAttack)) return true;
        return this.auraContributions(card).some(c => c.cannotAttack);
    }

    cannotBlock(card) {
        if (this.hasKeyword(card, 'cannotBlock')) return true;
        if (this.modActive(card, m => m.cannotBlock)) return true;
        return this.auraContributions(card).some(c => c.cannotBlock);
    }

    // Write the derived numbers onto the card, which is what the UI draws.
    refreshCard(card) {
        if (!card || !this.isPupil(card)) return;
        if (!this.state) {
            const n = parseInt(card.endurance, 10);
            card.maxEndurance = isNaN(n) ? 0 : n;
            card.currentEndurance = card.maxEndurance - (card.damage || 0);
            card.dieRollBonus = 0;
            return;
        }
        card.maxEndurance = this.maxEndurance(card);
        card.currentEndurance = card.maxEndurance - (card.damage || 0);
        card.dieRollBonus = this.dieModifier(card);
        card.damageReductionTotal = this.damageReduction(card);
        card.keywordList = [...this.keywords(card)];
        card.cannotBlockNow = this.cannotBlock(card);
        card.cannotAttackNow = this.cannotAttack(card);
        card.diceNow = this.diceLabel(card);
        // Old field names the UI still reads
        card.auraEnduranceBonus = 0;
        card.auraDamageReduction = card.damageReductionTotal;
        card.cannotBlock = card.cannotBlockNow;
    }

    refreshAll() {
        if (!this.state) return;
        this._stamp = (this._stamp || 0) + 1;
        for (const p of [1, 2]) this.state.players[p].field.forEach(c => this.refreshCard(c));
    }

    // ==========================================================================
    // Modifiers and counters
    // ==========================================================================

    // mod: { die, end, dmgReduce, keywords, protection, cannotAttack, cannotBlock,
    //        disableAbilities, until: 'endOfTurn'|'endOfCombat'|'yourNextTurn'|'permanent',
    //        player (who applied it), friendly }
    addMod(card, mod, sourcePlayer = null) {
        if (!card) return;
        const cp = this.controllerOf(card);
        const m = { until: 'endOfTurn', ...mod };
        m.player = m.player || sourcePlayer || null;
        m.friendly = m.player ? m.player === cp : false;
        // Closed-Minded: friendly buffs and new abilities do not stick
        if (this.hasKeyword(card, 'closedMinded') && m.friendly
            && ((m.die > 0) || (m.end > 0) || (m.keywords && m.keywords.length))) {
            return false;
        }
        if (m.until === 'yourNextTurn' && !m.expiresFor) m.expiresFor = m.player || cp;
        card.mods.push(m);
        this.refreshAll();
        return true;
    }

    addCounter(card, kind, n = 1) {
        if (!card || n === 0) return;
        if (kind === 'plusOne' && this.hasKeyword(card, 'closedMinded')) return;
        card.counters[kind] = Math.max(0, (card.counters[kind] || 0) + n);
        this.refreshAll();
    }

    // ==========================================================================
    // Damage
    // ==========================================================================

    // The one place damage is applied. Returns the damage actually dealt.
    // opts: { combat, sourcePlayer, lethal, fromRebuttal }
    dealDamage(target, amount, source = null, opts = {}) {
        if (!target || !this.isPupil(target) || !this.findInPlay(target.instanceId)) return 0;
        amount = Math.max(0, Math.floor(amount));
        if (amount <= 0) return 0;
        const tp = this.controllerOf(target);
        const sp = opts.sourcePlayer || (source ? this.controllerOf(source) : null);

        // Trigonometry Enthusiast: its damage goes somewhere else
        const tdef = this.def(target);
        if (tdef?.redirectDamage && !opts.redirected && !this.modActive(target, m => m.disableAbilities)) {
            const to = tdef.redirectDamage(this.api(target), source);
            if (to && to.instanceId !== target.instanceId) {
                this.log(`${target.name} redirects the damage to ${to.name}.`);
                return this.dealDamage(to, amount, source, { ...opts, redirected: true });
            }
            if (!to) return 0;
        }
        for (const m of target.mods) if (m.damageTakenBonus) amount += m.damageTakenBonus;
        if (source && this.protectedFrom(target, source)) {
            this.log(`${target.name} is protected from ${source.name}.`);
            return 0;
        }
        if (this.modActive(target, m => m.preventAll)) return 0;

        // Flat reduction, then prevention pools, then a shield absorbs a hit
        amount = Math.max(0, amount - this.damageReduction(target));
        const tpl = this.state.players[tp];
        if (amount > 0 && tpl.flags.reduceNextDamage > 0) {
            const used = Math.min(tpl.flags.reduceNextDamage, amount);
            amount -= used; tpl.flags.reduceNextDamage = 0;
        }
        for (const m of target.mods) {
            if (amount > 0 && m.preventNext > 0) {
                const used = Math.min(m.preventNext, amount);
                m.preventNext -= used; amount -= used;
            }
        }
        if (amount > 0 && target.counters.shield > 0) {
            target.counters.shield--;
            this.log(`A shield on ${target.name} absorbs the hit.`);
            amount = 0;
        }
        if (amount <= 0) { this.refreshAll(); return 0; }

        const max = this.maxEndurance(target);
        const remaining = max - target.damage;

        // Stubborn: never exhausted by damage. Comfort: an opponent's non-combat
        // effects cannot take a pupil below 1.
        let floor = null;
        if (this.hasKeyword(target, 'stubborn')) floor = 1;
        if (!opts.combat && sp && sp !== tp && this.playerHasFlagFromAura(tp, 'comfort')) floor = 1;
        let dealt = amount;
        if (floor !== null && remaining - dealt < floor) dealt = Math.max(0, remaining - floor);

        target.damage += dealt;
        this.state.players[tp].damageTakenThisTurn += dealt;
        this.refreshAll();

        const lethal = opts.lethal || (source && this.isPupil(source) && this.hasKeyword(source, 'lethal'));
        if (lethal && amount > 0 && !this.hasKeyword(target, 'stubborn')) target._markedLethal = true;

        this.trigger('onDamaged', target, { amount: dealt, source, combat: !!opts.combat });
        if (source && dealt > 0) this.trigger('onDealsDamage', source, { target, amount: dealt, combat: !!opts.combat });
        this.emitEvent('damageDealt', { target, amount: dealt, source });
        return dealt;
    }

    playerHasFlagFromAura(playerNum, flag) {
        let found = false;
        this.forEachAura((source, def, sp) => {
            if (sp === playerNum && def.playerFlags && def.playerFlags.includes(flag)
                && !this.modActive(source, m => m.disableAbilities)) found = true;
        });
        return found;
    }

    heal(card, amount) {
        if (!card || !this.isPupil(card)) return 0;
        const h = Math.min(card.damage, Math.max(0, amount));
        card.damage -= h;
        this.refreshAll();
        return h;
    }

    healFull(card) { return this.heal(card, card.damage); }

    // ==========================================================================
    // Moving cards
    // ==========================================================================

    removeFromField(card) {
        for (const p of [1, 2]) {
            const f = this.state.players[p].field;
            const i = f.findIndex(c => c.instanceId === card.instanceId);
            if (i >= 0) {
                f.splice(i, 1);
                // Lockdown and the like last only while their source stays
                for (const c of this.allFieldCards()) {
                    c.mods = c.mods.filter(m => !(m.until === 'whileSource' && m.sourceId === card.instanceId));
                }
                return p;
            }
        }
        return null;
    }

    // Defeated: to its owner's discard pile (tokens simply stop existing).
    exhaust(card, reason = 'exhausted') {
        if (!card || !this.findInPlay(card.instanceId)) return false;
        const controller = this.removeFromField(card);
        this.state.attackers = this.state.attackers.filter(a => a.instanceId !== card.instanceId);
        for (const [att, blk] of Object.entries(this.state.blockers)) {
            if (att === card.instanceId || blk === card.instanceId) delete this.state.blockers[att];
        }
        if (!card.isToken) {
            const owner = card.owner || controller;
            this.resetCard(card);
            this.state.players[owner].discard.push(card);
        }
        this.log(`${card.name} is exhausted.`);
        if (this.isPupil(card)) {
            this.trigger('onExhausted', card, { controller, reason });
            this.triggerAll('onAnyExhausted', { dead: card, controller });
        }
        this.emitEvent('cardExhausted', { card, controller });
        return true;
    }

    // "Send home": back to its owner's hand.
    sendHome(card) {
        if (!card || !this.findInPlay(card.instanceId)) return false;
        const controller = this.removeFromField(card);
        this.state.attackers = this.state.attackers.filter(a => a.instanceId !== card.instanceId);
        for (const [att, blk] of Object.entries(this.state.blockers)) {
            if (att === card.instanceId || blk === card.instanceId) delete this.state.blockers[att];
        }
        if (!card.isToken) {
            this.resetCard(card);
            this.state.players[card.owner || controller].hand.push(card);
        }
        this.log(`${card.name} goes back to hand.`);
        this.trigger('onLeave', card, { controller });
        this.refreshAll();
        return true;
    }

    spend(card) { if (card) { card.isSpent = true; this.refreshAll(); } }
    ready(card) { if (card) { card.isSpent = false; this.refreshAll(); } }

    changeControl(card, newController, until = 'endOfTurn') {
        const from = this.removeFromField(card);
        if (!from) return;
        card.controlReturn = until === 'permanent' ? null : { to: from, until };
        this.state.players[newController].field.push(card);
        this.refreshAll();
    }

    // Put a card into play for a player, with all the entering rules.
    putIntoPlay(playerNum, card, opts = {}) {
        const player = this.state.players[playerNum];
        if (!card.isToken) this.resetCard(card);
        card.controller = playerNum;
        if (this.isLocation(card)) {
            // One location at a time, shared by both players: a new one replaces it
            for (const p of [1, 2]) {
                const old = this.state.players[p].field.filter(c => this.isLocation(c));
                old.forEach(l => {
                    this.removeFromField(l);
                    this.state.players[l.owner || p].discard.push(this.resetCard(l));
                    this.log(`${l.name} is replaced.`);
                });
            }
        }
        player.field.push(card);
        card.hasGettingBearings = this.isPupil(card) && !opts.ready;
        if (opts.spent) card.isSpent = true;
        this.refreshAll();
        if (this.isPupil(card)) {
            this.triggerAll('onOtherEnter', { entering: card, player: playerNum }, card);
        }
        return card;
    }

    createToken(playerNum, cardId, overrides = {}) {
        const data = typeof cardId === 'object' ? cardId : this.findCardData(cardId);
        if (!data) return null;
        const token = this.createCardInstance(data, playerNum, this.state.nextId++);
        token.isToken = true;
        Object.assign(token, overrides);
        this.putIntoPlay(playerNum, token);
        this.log(`${this.pname(playerNum)} creates ${token.name}.`);
        return token;
    }

    // ==========================================================================
    // Drawing
    // ==========================================================================

    // Returns the number drawn. Running out ends the game (see RULES.md).
    draw(playerNum, n = 1, opts = {}) {
        const player = this.state.players[playerNum];
        let drawn = 0;
        let extra = 0;
        if (!opts.noExtra) {
            // Cinematography Instructor, Luke: an extra card whenever you draw
            this.forEachAura((source, def, sp) => {
                if (sp === playerNum && def.extraDraw && !this.modActive(source, m => m.disableAbilities)) extra += def.extraDraw;
            });
        }
        for (let i = 0; i < n * (1 + extra); i++) {
            if (!player.deck.length) {
                this.endByDeckOut(playerNum);
                break;
            }
            player.hand.push(player.deck.shift());
            drawn++;
        }
        if (drawn > 0 && !opts.silent) {
            this.triggerAll('onDraw', { player: playerNum, count: drawn });
        }
        return drawn;
    }

    discardFromHand(playerNum, instanceId) {
        const player = this.state.players[playerNum];
        const i = player.hand.findIndex(c => c.instanceId === instanceId);
        if (i < 0) return null;
        const [card] = player.hand.splice(i, 1);
        player.discard.push(card);
        return card;
    }

    // ==========================================================================
    // Points and winning
    // ==========================================================================

    gainPoints(playerNum, n, source = null) {
        if (n <= 0 || this.state.gameOver) return 0;
        this.state.players[playerNum].points += n;
        this.log(`${this.pname(playerNum)} scores ${n}.`);
        this.triggerAll('onYouScore', { player: playerNum, points: n, source });
        this.checkWinCondition();
        return n;
    }

    losePoints(playerNum, n) {
        const p = this.state.players[playerNum];
        p.points = Math.max(0, p.points - n);
    }

    checkWinCondition() {
        if (this.state.gameOver) return true;
        const p1 = this.state.players[1].points, p2 = this.state.players[2].points;
        if (p1 >= this.winCondition || p2 >= this.winCondition) {
            // Both past the line at once: more points wins; on a tie, whoever's turn it is
            const winner = p1 === p2 ? this.state.currentPlayer : (p1 > p2 ? 1 : 2);
            this.endGame(winner, 'points');
            return true;
        }
        return false;
    }

    // A player who has to draw from an empty deck ends the game: the higher
    // score wins, and on a tie the player who ran out loses.
    endByDeckOut(playerNum) {
        if (this.state.gameOver) return;
        const me = this.state.players[playerNum].points;
        const them = this.state.players[this.other(playerNum)].points;
        const winner = me > them ? playerNum : this.other(playerNum);
        this.log(`${this.pname(playerNum)} has run out of cards.`);
        this.endGame(winner, 'deck');
    }

    endGame(winner, reason) {
        if (this.state.gameOver) return;
        this.state.gameOver = true;
        this.state.winner = winner;
        this.state.endReason = reason;
        this.state.combatStep = null;
        this.state.pending = [];
        this.emitEvent('gameOver', { winner, reason });
    }

    // ==========================================================================
    // Triggers
    // ==========================================================================

    // The api object handed to card definitions: the engine plus "this card".
    api(card) {
        return { g: this, card, me: this.controllerOf(card), them: this.other(this.controllerOf(card) || 1) };
    }

    trigger(hook, card, data = {}) {
        if (!card || this.state.gameOver) return;
        const def = this.def(card);
        if (!def || !def.triggers || !def.triggers[hook]) return;
        if (this.modActive(card, m => m.disableAbilities)) return;
        if (this._depth > 40) return;             // a loop guard, not a rule
        this._depth++;
        try { def.triggers[hook](this.api(card), data); }
        finally { this._depth--; }
    }

    // Fire a hook on every card in play (and on the one leaving, if given).
    triggerAll(hook, data = {}, except = null) {
        const cards = this.allFieldCards();
        for (const c of cards) {
            if (except && c.instanceId === except.instanceId) continue;
            if (!this.findInPlay(c.instanceId)) continue;
            this.trigger(hook, c, data);
        }
    }

    // ==========================================================================
    // Pending decisions
    // ==========================================================================
    //
    // A decision a player has to make in the middle of an effect. Stored in the
    // state, answered with resolveChoice(player, values). While one is waiting,
    // nothing else may happen except answering it.
    //
    // { id, player, kind: 'cards'|'targets'|'order'|'yesno'|'color'|'option',
    //   prompt, options: [{ value, label, card? }], min, max,
    //   cont: { card: cardId, key } | { engine: key }, data, source }

    ask(playerNum, spec) {
        const q = {
            id: `q-${this.state.nextId++}`,
            player: playerNum,
            min: 1, max: 1,
            ...spec
        };
        if (q.kind !== 'order' && (!q.options || q.options.length === 0)) return null;   // nothing to choose from
        if (q.kind !== 'order') q.max = Math.min(q.max, q.options.length);
        q.min = Math.min(q.min, q.max);
        this.state.pending.push(q);
        this.emitEvent('choiceNeeded', { pending: q });
        return q;
    }

    get pendingChoice() { return this.state?.pending?.[0] || null; }

    resolveChoice(playerNum, values) {
        const q = this.pendingChoice;
        if (!q) return { success: false, error: 'Nothing to choose' };
        if (q.player !== playerNum) return { success: false, error: 'Not your choice' };
        values = Array.isArray(values) ? values : (values === undefined || values === null ? [] : [values]);
        const legal = new Set((q.options || []).map(o => o.value));
        if (q.kind === 'order') {
            const want = (q.options || []).map(o => o.value).sort().join('|');
            if ([...values].sort().join('|') !== want) return { success: false, error: 'Put every card in order' };
        } else {
            if (values.some(v => !legal.has(v))) return { success: false, error: 'Not one of the choices' };
            if (new Set(values).size !== values.length) return { success: false, error: 'Chosen twice' };
            if (values.length < q.min || values.length > q.max) {
                return { success: false, error: q.min === q.max ? `Choose ${q.min}` : `Choose ${q.min} to ${q.max}` };
            }
        }
        this.state.pending.shift();
        this.runContinuation(q, values);
        this.afterAction();
        this.emitEvent('choiceResolved', { pending: q, values });
        return { success: true };
    }

    runContinuation(q, values) {
        const cont = q.cont || {};
        if (cont.engine) {
            const fn = this.engineChoices[cont.engine];
            if (fn) fn.call(this, q, values);
            return;
        }
        const def = this.cards?.get(cont.card);
        const handler = def?.choices?.[cont.key];
        if (!handler) return;
        const source = q.source ? (this.findInPlay(q.source) || { id: cont.card, instanceId: q.source, name: q.sourceName }) : { id: cont.card };
        const api = { g: this, card: source, me: q.player, them: this.other(q.player) };
        handler(api, values, q.data || {});
    }

    // Built-in decisions the card definitions share.
    get engineChoices() {
        return {
            // Cards picked from a revealed set: q.data = { pool, dest, rest, restPlace, player }
            pickCards(q, values) {
                const d = q.data;
                const owner = this.state.players[d.owner || q.player];
                const from = d.zone === 'hand' ? owner.hand : owner.deck;
                const taken = [];
                for (const v of values) {
                    const i = from.findIndex(c => c.instanceId === v);
                    if (i >= 0) taken.push(from.splice(i, 1)[0]);
                }
                const dest = d.dest === 'discard' ? owner.discard
                           : d.dest === 'play' ? null
                           : this.state.players[q.player].hand;
                taken.forEach(c => {
                    if (d.dest === 'play') this.putIntoPlay(q.player, c, { spent: !!d.spent });
                    else dest.push(c);
                });
                if (d.rest && d.pool) {
                    const rest = d.pool.filter(id => !values.includes(id));
                    const restCards = [];
                    for (const id of rest) {
                        const i = from.findIndex(c => c.instanceId === id);
                        if (i >= 0) restCards.push(from.splice(i, 1)[0]);
                    }
                    if (d.rest === 'bottom') from.push(...restCards);
                    else if (d.rest === 'discard') owner.discard.push(...restCards);
                    else from.unshift(...restCards);
                }
                if (d.shuffle) owner.deck = this.shuffle(owner.deck);
                if (taken.length) this.log(`${this.pname(q.player)} takes ${taken.length} card${taken.length > 1 ? 's' : ''}.`);
            },
            // Discard from your own hand: q.data = { then }
            discard(q, values) {
                values.forEach(v => this.discardFromHand(q.player, v));
            },
            // Top of deck in a new order: values are instanceIds, first = top
            order(q, values) {
                const deck = this.state.players[q.data.owner || q.player].deck;
                const cards = values.map(v => deck.find(c => c.instanceId === v)).filter(Boolean);
                const rest = deck.filter(c => !values.includes(c.instanceId));
                this.state.players[q.data.owner || q.player].deck = [...cards, ...rest];
            },
            acknowledge() {}
        };
    }

    // Helpers card definitions call. Each asks only when there is a real choice.

    // Look at the top n of a deck; pick `take` into dest; rest to bottom/discard/top.
    lookAtTop(playerNum, n, take, opts = {}) {
        const owner = opts.owner || playerNum;
        const top = this.state.players[owner].deck.slice(0, n);
        if (!top.length) return null;
        return this.ask(playerNum, {
            kind: 'cards',
            prompt: opts.prompt || `Choose ${take} to put in your hand`,
            options: top.map(c => ({ value: c.instanceId, label: c.name, card: c })),
            min: opts.optional ? 0 : Math.min(take, top.length), max: take,
            cont: { engine: 'pickCards' },
            data: { owner, zone: 'deck', pool: top.map(c => c.instanceId), dest: opts.dest || 'hand',
                    rest: opts.rest || 'bottom' },
            sourceName: opts.sourceName
        });
    }

    // Search a deck for cards matching filter; shuffle after.
    searchDeck(playerNum, filter, opts = {}) {
        const deck = this.state.players[playerNum].deck;
        const found = deck.filter(filter);
        if (!found.length) {
            this.state.players[playerNum].deck = this.shuffle(deck);
            this.log(`${this.pname(playerNum)} searches and finds nothing.`);
            return null;
        }
        return this.ask(playerNum, {
            kind: 'cards',
            prompt: opts.prompt || 'Choose a card',
            options: found.map(c => ({ value: c.instanceId, label: c.name, card: c })),
            min: opts.optional === false ? 1 : 0, max: opts.count || 1,
            cont: { engine: 'pickCards' },
            data: { owner: playerNum, zone: 'deck', dest: opts.dest || 'hand', spent: opts.spent, shuffle: true },
            sourceName: opts.sourceName
        });
    }

    // Ask a player to discard n cards from their own hand.
    askDiscard(playerNum, n = 1, opts = {}) {
        const hand = this.state.players[playerNum].hand;
        if (!hand.length) return null;
        return this.ask(playerNum, {
            kind: 'cards',
            prompt: opts.prompt || `Discard ${n} card${n > 1 ? 's' : ''}`,
            options: hand.map(c => ({ value: c.instanceId, label: c.name, card: c })),
            min: Math.min(n, hand.length), max: Math.min(n, hand.length),
            cont: { engine: 'discard' },
            data: {},
            sourceName: opts.sourceName
        });
    }

    // ==========================================================================
    // Targets
    // ==========================================================================
    //
    // spec: { kind: 'pupil'|'tool'|'card'|'resource'|'opponent'|'player',
    //         side: 'you'|'them'|'any', other: bool, buff: bool,
    //         filter(g, card) -> bool, optional: bool, label }

    getTargets(playerNum, spec, sourceCard = null, chosen = []) {
        const out = [];
        if (spec.kind === 'player' || spec.kind === 'opponent') {
            if (spec.kind === 'opponent') out.push(String(this.other(playerNum)));
            else out.push('1', '2');
            return out;
        }
        if (spec.kind === 'resource') {
            const sides = spec.side === 'them' ? [this.other(playerNum)] : spec.side === 'any' ? [1, 2] : [playerNum];
            sides.forEach(p => this.state.players[p].resources.forEach(r => {
                if (!spec.filter || spec.filter(this, r)) out.push(r.id);
            }));
            return out;
        }
        const sides = spec.side === 'you' ? [playerNum] : spec.side === 'them' ? [this.other(playerNum)] : [1, 2];
        for (const p of sides) {
            for (const c of this.state.players[p].field) {
                if (spec.kind === 'pupil' && !this.isPupil(c)) continue;
                if (spec.kind === 'tool' && !this.isTool(c)) continue;
                if (spec.kind === 'pupilOrTool' && !this.isPupil(c) && !this.isTool(c)) continue;
                if (spec.other && sourceCard && c.instanceId === sourceCard.instanceId) continue;
                if (spec.distinct !== false && chosen.includes(c.instanceId)) continue;
                // Closed-Minded pupils cannot be targeted by their own side's buffs
                if (spec.buff && p === playerNum && this.hasKeyword(c, 'closedMinded')) continue;
                if (spec.filter && !spec.filter(this, c)) continue;
                out.push(c.instanceId);
            }
        }
        return out;
    }

    resolveTargetValue(spec, value) {
        if (spec.kind === 'player' || spec.kind === 'opponent') return parseInt(value, 10);
        if (spec.kind === 'resource') {
            for (const p of [1, 2]) {
                const r = this.state.players[p].resources.find(x => x.id === value);
                if (r) return r;
            }
            return null;
        }
        return this.findInPlay(value);
    }

    // Validate chosen targets for a list of specs; returns resolved objects or an error.
    checkTargets(playerNum, specs, values, sourceCard) {
        const out = [];
        const chosen = [];
        values = values || [];
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            const v = values[i];
            if (v === undefined || v === null) {
                if (spec.optional) { out.push(null); continue; }
                const legal = this.getTargets(playerNum, spec, sourceCard, chosen);
                if (!legal.length && spec.fizzleIfNone) { out.push(null); continue; }
                return { error: `Choose ${spec.label || 'a target'}`, needs: i };
            }
            const legal = this.getTargets(playerNum, spec, sourceCard, chosen);
            if (!legal.includes(v)) return { error: 'That is not a legal target', needs: i };
            chosen.push(v);
            out.push(this.resolveTargetValue(spec, v));
        }
        return { targets: out };
    }

    // ==========================================================================
    // Playing cards
    // ==========================================================================

    // What the UI/AI need to know before playing a card from hand.
    getPlayOptions(playerNum, instanceId) {
        const player = this.state.players[playerNum];
        const card = player.hand.find(c => c.instanceId === instanceId);
        if (!card) return { canPlay: false, reason: 'Card not in hand' };
        const def = this.def(card);
        const timingErr = this.playTimingError(playerNum, card);
        const res = {
            card,
            canResource: !timingErr?.resourceBlocked && this.canPlayResource(playerNum) === null,
            resourceReason: this.canPlayResource(playerNum),
            canPlay: false,
            reason: null,
            modes: null,
            targets: [],
            resourceModes: null,
            resourceTargets: []
        };
        const eff = def?.play;
        if (eff?.modes) res.modes = eff.modes.map((m, i) => ({ index: i, label: m.label, targets: m.targets || [] }));
        else res.targets = eff?.targets || [];
        const reff = def?.resource;
        if (reff?.modes) res.resourceModes = reff.modes.map((m, i) => ({ index: i, label: m.label, targets: m.targets || [] }));
        else res.resourceTargets = reff?.targets || [];

        if (timingErr) { res.reason = timingErr.error; return res; }
        if (!this.canAfford(card, playerNum)) { res.reason = 'Not enough resources'; return res; }
        if (this.isInterruption(card) && player.interruptionPlayed) { res.reason = 'Already played an Interruption this turn'; return res; }
        if (player.flags.cannotPlayCards) { res.reason = 'You cannot play cards this turn'; return res; }
        if (eff?.canPlay) {
            const why = eff.canPlay(this.api({ ...card, controller: playerNum }), playerNum);
            if (why) { res.reason = why; return res; }
        }
        // An interruption with a required target and nothing to aim at cannot be played
        const specs = eff?.modes ? null : (eff?.targets || []);
        if (specs && this.isInterruption(card)) {
            const chosen = [];
            for (const s of specs) {
                if (s.optional || s.fizzleIfNone) continue;
                const legal = this.getTargets(playerNum, s, card, chosen);
                if (!legal.length) { res.reason = `No ${s.label || 'target'} to choose`; return res; }
                chosen.push(legal[0]);
            }
        }
        res.canPlay = true;
        return res;
    }

    canPlayResource(playerNum) {
        const player = this.state.players[playerNum];
        if (this.state.currentPlayer !== playerNum) return 'Not your turn';
        if (this.state.phase !== 'main' || this.state.combatStep) return 'Resources are played in your main phase';
        if (player.flags.cannotPlayCards) return 'You cannot play cards this turn';
        if (this.pendingChoice) return 'Finish the current choice first';
        const allowed = 1 + (player.flags.extraResourcePlays || 0);
        if ((player.resourcesPlayedThisTurn || 0) >= allowed) return 'Already played a resource this turn';
        return null;
    }

    // Who may play what, when. Interruptions marked timing 'combat' may be
    // played during combat by either player (see RULES.md); everything else
    // only in your own main phase.
    playTimingError(playerNum, card) {
        if (this.state.gameOver) return { error: 'The game is over' };
        if (this.pendingChoice) return { error: 'Finish the current choice first' };
        const def = this.def(card);
        const timing = def?.play?.timing || 'main';
        const myTurn = this.state.currentPlayer === playerNum;
        const inMain = this.state.phase === 'main' && !this.state.combatStep;
        if (this.isInterruption(card) && (timing === 'combat' || timing === 'any')) {
            if (this.state.combatStep === 'declare-blockers') return null;   // both players
            if (timing === 'any' && myTurn && inMain) return null;
            if (timing === 'combat' && myTurn && this.state.combatStep === 'declare-attackers') return null;
            return { error: timing === 'combat' ? 'Play this during combat' : 'Not now' };
        }
        if (!myTurn) return { error: 'Not your turn', resourceBlocked: true };
        if (!inMain) return { error: 'Cards are played in your main phase' };
        return null;
    }

    // choices: { targets: [instanceId...], mode: index, x: number }
    playCard(playerNum, instanceId, asResource = false, choices = {}) {
        if (!this.state || this.state.gameOver) return { success: false, error: 'The game is over' };
        const player = this.state.players[playerNum];
        const idx = player.hand.findIndex(c => c.instanceId === instanceId);
        if (idx === -1) return { success: false, error: 'Card not in hand' };
        const card = player.hand[idx];
        const def = this.def(card);

        if (asResource) {
            const why = this.canPlayResource(playerNum);
            if (why) return { success: false, error: why };
            const reff = def?.resource;
            let resolved = { targets: [] };
            let mode = null;
            if (reff) {
                mode = reff.modes ? reff.modes[choices.mode ?? -1] : reff;
                if (reff.modes && !mode) return { success: false, error: 'Choose an option', needsMode: true };
                resolved = this.checkTargets(playerNum, mode.targets || [], choices.targets, card);
                if (resolved.error) return { success: false, error: resolved.error, needsTarget: true };
            }
            player.hand.splice(idx, 1);
            player.resourcesPlayedThisTurn = (player.resourcesPlayedThisTurn || 0) + 1;
            player.resourcePlayedThisTurn = true;
            const produces = reff?.produces || null;
            const count = produces?.count || 1;
            for (let i = 0; i < count; i++) {
                const colors = produces?.colors || this.getAllColors(card.cost);
                this.addResource(playerNum, {
                    colors: produces?.anyColor ? RiutizGame.COLOR_CODES.slice() : colors,
                    anyColor: !!produces?.anyColor,
                    cardName: card.name, card
                });
            }
            this.log(`${this.pname(playerNum)} plays ${card.name} as a resource.`);
            if (mode?.run) {
                mode.run(this.api({ ...card, controller: playerNum }), { player: playerNum, card, targets: resolved.targets, x: choices.x });
            }
            this.afterAction();
            this.emitEvent('cardPlayedAsResource', { player: playerNum, card, color: this.getPrimaryColor(card.cost) });
            return { success: true, action: 'resource' };
        }

        const opts = this.getPlayOptions(playerNum, instanceId);
        if (!opts.canPlay) return { success: false, error: opts.reason };

        const eff = def?.play;
        let mode = eff;
        if (eff?.modes) {
            mode = eff.modes[choices.mode ?? -1];
            if (!mode) return { success: false, error: 'Choose an option', needsMode: true, modes: opts.modes };
        }
        const resolved = this.checkTargets(playerNum, mode?.targets || [], choices.targets, card);
        if (resolved.error) {
            return { success: false, error: resolved.error, needsTarget: true, specs: mode?.targets || [] };
        }

        const cost = this.effectiveCost(card, playerNum);
        if (!this.pay(cost, playerNum)) return { success: false, error: 'Not enough resources' };
        if (this.isInterruption(card) && player.flags.nextIdeaDiscount) player.flags.nextIdeaDiscount = 0;
        player.hand.splice(idx, 1);

        if (this.isInterruption(card)) {
            player.interruptionPlayed = true;
            this.log(`${this.pname(playerNum)} plays ${card.name}.`);
            // Proof of Concept armed by the opponent refutes this one
            const opp = this.state.players[this.other(playerNum)];
            if (opp.flags.refuteNextInterruption) {
                opp.flags.refuteNextInterruption = false;
                player.discard.push(card);
                this.log(`${card.name} is refuted.`);
                this.triggerAll('onInterruptionPlayed', { player: playerNum, card, refuted: true });
                this.afterAction();
                this.emitEvent('cardPlayed', { player: playerNum, card, refuted: true });
                return { success: true, action: 'play', card, refuted: true };
            }
            player.discard.push(card);
            if (mode?.run) {
                mode.run(this.api({ ...card, controller: playerNum }), {
                    player: playerNum, card, targets: resolved.targets, x: choices.x
                });
            }
            this.triggerAll('onInterruptionPlayed', { player: playerNum, card });
        } else {
            // Electronics Enthusiast armed by the opponent turns the next pupil back
            const opp = this.state.players[this.other(playerNum)];
            if (this.isPupil(card) && opp.flags.preventNextPupil) {
                opp.flags.preventNextPupil = false;
                player.hand.push(card);
                this.log(`${card.name} is prevented from entering.`);
                this.afterAction();
                this.emitEvent('cardPlayed', { player: playerNum, card, prevented: true });
                return { success: true, action: 'play', card, prevented: true };
            }
            this.log(`${this.pname(playerNum)} plays ${card.name}.`);
            const entered = this.putIntoPlay(playerNum, card);
            if (this.hasKeyword(entered, 'impulsive')) entered.hasGettingBearings = false;
            if (mode?.run && !this.modActive(entered, m => m.disableAbilities)) {
                mode.run(this.api(entered), { player: playerNum, card: entered, targets: resolved.targets, x: choices.x });
            }
            this.trigger('onEnter', entered, { player: playerNum });
        }

        this.afterAction();
        this.emitEvent('cardPlayed', { player: playerNum, card });
        return { success: true, action: 'play', card };
    }

    // ==========================================================================
    // Activated abilities
    // ==========================================================================

    // Abilities a card in play offers its controller, with whether each can be used now.
    // A card whose abilities its controller may use - or either player, for a
    // location marked shared.
    abilityHost(playerNum, instanceId) {
        const own = this.state.players[playerNum].field.find(c => c.instanceId === instanceId);
        if (own) return own;
        const other = this.findInPlay(instanceId);
        return other && this.def(other)?.sharedAbilities ? other : null;
    }

    getAbilities(playerNum, instanceId) {
        const card = this.abilityHost(playerNum, instanceId);
        if (!card) return [];
        const def = this.def(card);
        return (def?.abilities || []).map((ab, index) => {
            const out = { index, label: ab.label, cost: ab.cost || null, spend: !!ab.spend, targets: ab.targets || [],
                          modes: ab.modes ? ab.modes.map((m, i) => ({ index: i, label: m.label, targets: m.targets || [] })) : null };
            out.reason = this.abilityError(playerNum, card, ab);
            out.canUse = !out.reason;
            return out;
        });
    }

    abilityError(playerNum, card, ab) {
        if (this.state.gameOver) return 'The game is over';
        if (this.pendingChoice) return 'Finish the current choice first';
        const player = this.state.players[playerNum];
        if (player.flags.cannotPlayCards && ab.isPlay) return 'You cannot play cards this turn';
        const timing = ab.timing || 'main';
        const myMain = this.state.currentPlayer === playerNum && this.state.phase === 'main' && !this.state.combatStep;
        if (timing === 'main' && !myMain) return 'Use this in your main phase';
        if (timing === 'combat' && !this.state.combatStep) return 'Use this during combat';
        if (timing === 'any' && !myMain && this.state.combatStep !== 'declare-blockers') return 'Not now';
        if (this.modActive(card, m => m.disableAbilities)) return 'Its abilities are ignored this turn';
        if (ab.spend && card.isSpent) return `${card.name} is spent`;
        // Pupils that have not got their bearings cannot Spend yet
        if (ab.spend && this.isPupil(card) && card.hasGettingBearings) return `${card.name} is getting its bearings`;
        if (ab.oncePerTurn && card.usedThisTurn?.[ab.label]) return 'Already used this turn';
        if (ab.cost && !this.canPay(ab.cost, playerNum)) return 'Not enough resources';
        if (ab.counterCost && !(card.counters[ab.counterCost] > 0)) return `Needs a ${ab.counterCost} counter`;
        if (ab.canUse) {
            const why = ab.canUse(this.api(card));
            if (why) return why;
        }
        if (!ab.modes) {
            const chosen = [];
            for (const s of ab.targets || []) {
                if (s.optional || s.fizzleIfNone) continue;
                const legal = this.getTargets(playerNum, s, card, chosen);
                if (!legal.length) return `No ${s.label || 'target'} to choose`;
                chosen.push(legal[0]);
            }
        }
        return null;
    }

    activateAbility(playerNum, instanceId, abilityIndex = 0, choices = {}) {
        // Old callers passed a target object as the third argument
        if (typeof abilityIndex === 'object' && abilityIndex !== null) {
            choices = { targets: [abilityIndex.instanceId] };
            abilityIndex = 0;
        }
        const card = this.abilityHost(playerNum, instanceId);
        if (!card) return { success: false, error: 'Card not found' };
        const def = this.def(card);
        const ab = def?.abilities?.[abilityIndex];
        if (!ab) return { success: false, error: 'Card has no ability to use' };
        const why = this.abilityError(playerNum, card, ab);
        if (why) return { success: false, error: why };
        // Chemistry Enthusiast armed by the opponent counters the next ability
        let mode = ab;
        if (ab.modes) {
            mode = ab.modes[choices.mode ?? -1];
            if (!mode) return { success: false, error: 'Choose an option', needsMode: true };
        }
        const resolved = this.checkTargets(playerNum, mode.targets || [], choices.targets, card);
        if (resolved.error) return { success: false, error: resolved.error, needsTarget: true, specs: mode.targets || [] };

        if (ab.cost && !this.pay(ab.cost, playerNum)) return { success: false, error: 'Not enough resources' };
        if (ab.spend) card.isSpent = true;
        if (ab.counterCost) card.counters[ab.counterCost]--;
        card.usedThisTurn = { ...(card.usedThisTurn || {}), [ab.label]: true };

        const opp = this.state.players[this.other(playerNum)];
        if (opp.flags.counterNextAbility) {
            opp.flags.counterNextAbility = false;
            this.log(`${card.name}'s ability is countered.`);
        } else {
            this.log(`${card.name}: ${ab.label}.`);
            if (ab.sendHome) this.sendHome(card);
            const api = { ...this.api(card), me: playerNum, them: this.other(playerNum) };
            mode.run(api, { player: playerNum, card, targets: resolved.targets, x: choices.x });
        }
        this.afterAction();
        this.emitEvent('abilityActivated', { player: playerNum, card, index: abilityIndex });
        return { success: true };
    }

    // ==========================================================================
    // Combat
    // ==========================================================================

    startCombat(playerNum) {
        if (this.state.currentPlayer !== playerNum) return { success: false, error: 'Not your turn' };
        if (this.state.phase !== 'main' || this.state.combatStep) return { success: false, error: 'Not now' };
        if (this.pendingChoice) return { success: false, error: 'Finish the current choice first' };
        if (this.state.players[playerNum].flags.combatDone) return { success: false, error: 'Only one combat per turn' };
        this.state.phase = 'combat';
        this.state.combatStep = 'declare-attackers';
        this.state.attackers = [];
        this.state.blockers = {};
        this.state.players[playerNum].flags.combatDone = true;
        this.emitEvent('combatStarted', { player: playerNum });
        return { success: true };
    }

    attackError(playerNum, card) {
        if (!card) return 'Card not found';
        if (!this.isPupil(card)) return 'Only pupils can attack';
        if (card.hasGettingBearings && !this.hasKeyword(card, 'impulsive')) return `${card.name} is getting its bearings`;
        if (this.cannotAttack(card)) return `${card.name} cannot attack`;
        if (card.isSpent && !this.hasKeyword(card, 'relentless')) return `${card.name} is spent`;
        return null;
    }

    canAttack(playerNum, card) { return !this.attackError(playerNum, card); }

    toggleAttacker(playerNum, instanceId) {
        if (this.state.combatStep !== 'declare-attackers' || this.state.currentPlayer !== playerNum) {
            return { success: false, error: 'Not in attacker declaration' };
        }
        const card = this.state.players[playerNum].field.find(c => c.instanceId === instanceId);
        const idx = this.state.attackers.findIndex(a => a.instanceId === instanceId);
        if (idx !== -1) {
            this.state.attackers.splice(idx, 1);
            this.emitEvent('attackerToggled', { card, attacking: false });
            return { success: true };
        }
        const why = this.attackError(playerNum, card);
        if (why) return { success: false, error: why };
        this.state.attackers.push({ instanceId, name: card.name });
        this.emitEvent('attackerToggled', { card, attacking: true });
        return { success: true };
    }

    confirmAttackers(playerNum) {
        if (this.state.combatStep !== 'declare-attackers' || this.state.currentPlayer !== playerNum) {
            return { success: false, error: 'Not in attacker declaration' };
        }
        if (this.pendingChoice) return { success: false, error: 'Finish the current choice first' };
        const player = this.state.players[playerNum];
        this.state.attackers = this.state.attackers.filter(a => player.field.some(c => c.instanceId === a.instanceId));
        if (this.state.attackers.length === 0) {
            this.endCombat(true);
            this.emitEvent('combatSkipped', {});
            return { success: true, skipped: true };
        }
        for (const a of this.state.attackers) {
            const card = player.field.find(c => c.instanceId === a.instanceId);
            if (card) card.isSpent = true;
        }
        this.log(`${this.pname(playerNum)} attacks with ${this.state.attackers.map(a => a.name).join(', ')}.`);
        // Authoritative Principal, Jordan and the like
        this.triggerAll('onAttackersDeclared', { player: playerNum, attackers: this.state.attackers.map(a => a.instanceId) });
        for (const a of [...this.state.attackers]) {
            const card = player.field.find(c => c.instanceId === a.instanceId);
            if (card) this.trigger('onAttack', card, { player: playerNum });
        }
        this.refreshAll();
        if (this.state.gameOver) return { success: true };
        this.state.combatStep = 'declare-blockers';
        this.emitEvent('attackersDeclared', { attackers: this.state.attackers });
        return { success: true };
    }

    blockError(defenderNum, blocker, attacker) {
        if (!blocker) return 'Blocker not found';
        if (!this.isPupil(blocker)) return 'Only pupils can block';
        if (blocker.isSpent) return `${blocker.name} is spent`;
        if (this.cannotBlock(blocker)) return `${blocker.name} cannot block`;
        if (attacker && this.hasKeyword(attacker, 'unblockable') && !this.hasKeyword(blocker, 'blocksUnblockable')) {
            return `${attacker.name} cannot be blocked`;
        }
        if (attacker && this.modActive(attacker, m => m.unblockable) && !this.hasKeyword(blocker, 'blocksUnblockable')) {
            return `${attacker.name} cannot be blocked`;
        }
        if (attacker && this.modActive(attacker, m => m.primeBlockersOnly)) {
            const e = this.enduranceWithoutAuras(blocker);
            let prime = e > 1;
            for (let i = 2; i * i <= e; i++) if (e % i === 0) prime = false;
            if (!prime) return `${attacker.name} can only be blocked by a pupil with a prime-number Endurance`;
        }
        return null;
    }

    // Assign (or with the same attacker, unassign) a blocker. Without an
    // attacker id it is removed from whatever it blocks.
    toggleBlocker(defenderNum, blockerInstanceId, attackerInstanceId) {
        if (this.state.combatStep !== 'declare-blockers') return { success: false, error: 'Not in blocker declaration' };
        if (defenderNum === this.state.currentPlayer) return { success: false, error: 'The defender blocks' };
        const blocker = this.state.players[defenderNum].field.find(c => c.instanceId === blockerInstanceId);
        const current = Object.entries(this.state.blockers).find(([, b]) => b === blockerInstanceId);
        if (current) {
            delete this.state.blockers[current[0]];
            if (!attackerInstanceId || current[0] === attackerInstanceId) {
                this.emitEvent('blockerToggled', { blocker, attackerId: current[0], blocking: false });
                return { success: true };
            }
        }
        if (!attackerInstanceId) return { success: false, error: 'Choose an attacker to block' };
        const attacker = this.findInPlay(attackerInstanceId);
        if (!this.state.attackers.some(a => a.instanceId === attackerInstanceId)) return { success: false, error: 'Not attacking' };
        const why = this.blockError(defenderNum, blocker, attacker);
        if (why) return { success: false, error: why };
        // One blocker per attacker: a new one replaces the old
        this.state.blockers[attackerInstanceId] = blockerInstanceId;
        this.emitEvent('blockerToggled', { blocker, attackerId: attackerInstanceId, blocking: true });
        return { success: true };
    }

    // Attackers that "must be defended if possible" and are not.
    unmetBlockRequirements(defenderNum) {
        const out = [];
        for (const a of this.state.attackers) {
            const att = this.findInPlay(a.instanceId);
            if (!att || this.state.blockers[a.instanceId]) continue;
            const must = this.hasKeyword(att, 'mustBeBlocked') || this.modActive(att, m => m.mustBeBlocked);
            if (!must) continue;
            const free = this.pupilsOf(defenderNum).filter(b =>
                !Object.values(this.state.blockers).includes(b.instanceId) && !this.blockError(defenderNum, b, att));
            if (free.length) out.push(att);
        }
        return out;
    }

    confirmBlockers(defenderNum = null) {
        if (this.state.combatStep !== 'declare-blockers') return { success: false, error: 'Not in blocker declaration' };
        if (this.pendingChoice) return { success: false, error: 'Finish the current choice first' };
        const d = defenderNum || this.other(this.state.currentPlayer);
        const unmet = this.unmetBlockRequirements(d);
        if (unmet.length) return { success: false, error: `${unmet[0].name} must be blocked if possible` };
        return this.resolveCombat();
    }

    // Roll for a pupil in combat, with every modifier.
    combatRoll(card, role) {
        const def = this.def(card);
        const api = this.api(card);
        let roll;
        if (def?.combatRoll && !this.modActive(card, m => m.disableAbilities)) {
            roll = def.combatRoll(api, role);
        }
        if (roll === undefined || roll === null) {
            roll = this.rollDice(this.effectiveDice(card), this.hasAdvantage(card));
        }
        const raw = roll;
        roll += this.dieModifier(card);
        if (role === 'attack') roll += this.attackModifier(card);
        // Non-Sequitur: heads doubles the roll, tails makes it nothing
        if (this.hasKeyword(card, 'nonSequitur')) {
            roll = this.flipCoin() ? roll * 2 : 0;
        }
        // Server Room style floors
        let floor = 0;
        this.forEachAura((source, sdef) => { if (sdef.rollFloor) floor = Math.max(floor, sdef.rollFloor); });
        roll = Math.max(floor && raw > 0 ? floor : 0, roll);
        // Second Opinion / Statistics Enthusiast: a reroll used automatically on a poor roll
        roll = this.maybeReroll(card, roll, role);
        card.lastRoll = roll;
        if (role === 'attack') {
            for (const m of card.mods) {
                if (m.drawIfRoll && roll >= m.drawIfRoll && !m.drawn) {
                    m.drawn = true;
                    this.draw(m.player || this.controllerOf(card), 1);
                }
            }
        }
        return roll;
    }

    maybeReroll(card, roll, role) {
        const cp = this.controllerOf(card);
        const d = this.effectiveDice(card);
        if (!d.sides) return roll;
        const avg = (d.sides + 1) / 2 + this.dieModifier(card);
        const tryUse = (p, mine) => {
            const pl = this.state.players[p];
            if (!pl.flags.rerolls) return false;
            const bad = mine ? roll < avg : roll > avg;
            if (!bad) return false;
            pl.flags.rerolls--;
            return true;
        };
        if (tryUse(cp, true) || tryUse(this.other(cp), false)) {
            const again = this.rollDice(d, this.hasAdvantage(card)) + this.dieModifier(card);
            this.log(`${card.name}'s roll of ${roll} is rerolled: ${Math.max(0, again)}.`);
            return Math.max(0, again);
        }
        return roll;
    }

    resolveCombat() {
        const ap = this.state.currentPlayer;
        const dp = this.other(ap);
        const results = [];
        let pointsScored = 0;

        for (const a of [...this.state.attackers]) {
            if (this.state.gameOver) break;
            const att = this.findInPlay(a.instanceId);
            if (!att || this.controllerOf(att) !== ap) continue;
            if (this.modActive(att, m => m.refuted)) { this.log(`${att.name}'s attack is refuted.`); continue; }
            const blkId = this.state.blockers[a.instanceId];
            const blk = blkId ? this.findInPlay(blkId) : null;
            const aRoll = this.combatRoll(att, 'attack');
            const entry = { attacker: att.name, attackRoll: aRoll };

            if (blk && this.controllerOf(blk) === dp) {
                const bRoll = this.combatRoll(blk, 'block');
                entry.blocker = blk.name; entry.blockerRoll = bRoll;
                const aFirst = this.hasKeyword(att, 'firstStrike') && !this.hasKeyword(blk, 'firstStrike');
                const bFirst = this.hasKeyword(blk, 'firstStrike') && !this.hasKeyword(att, 'firstStrike');
                const blkRemaining = blk.currentEndurance;
                let toBlk = 0, toAtt = 0;
                if (aFirst) {
                    toBlk = this.combatHit(att, blk, aRoll);
                    if (this.findInPlay(blk.instanceId) && !blk._markedLethal && blk.currentEndurance > 0) toAtt = this.combatHit(blk, att, bRoll);
                } else if (bFirst) {
                    toAtt = this.combatHit(blk, att, bRoll);
                    if (this.findInPlay(att.instanceId) && !att._markedLethal && att.currentEndurance > 0) toBlk = this.combatHit(att, blk, aRoll);
                } else {
                    toBlk = this.combatHit(att, blk, aRoll);
                    toAtt = this.combatHit(blk, att, bRoll);
                }
                entry.damageToBlocker = toBlk; entry.damageToAttacker = toAtt;
                // Rebuttal: the blocker strikes back at the attacker that hurt it
                if (toBlk > 0) this.rebuttal(blk, att, toBlk);
                // Overwhelm: damage beyond what the blocker could take is scored
                if (this.hasKeyword(att, 'overwhelm') && aRoll > blkRemaining) {
                    const over = aRoll - Math.max(0, blkRemaining);
                    pointsScored += this.scoreFor(ap, over, att);
                    entry.overwhelm = over;
                }
                const killed = blk._markedLethal || blk.currentEndurance <= 0;
                if (killed) {
                    entry.blockerExhausted = true;
                    this.keepIfKills(att);
                    this.trigger('onExhaustsPupil', att, { victim: blk, damage: aRoll });
                }
                if (att._markedLethal || att.currentEndurance <= 0) {
                    entry.attackerExhausted = true;
                    this.keepIfKills(blk);
                    this.trigger('onExhaustsPupil', blk, { victim: att, damage: bRoll });
                }
                this.trigger('onAttackResolved', att, { unblocked: false, roll: aRoll });
            } else {
                entry.unblocked = true;
                const pts = this.scoreFor(ap, aRoll, att);
                pointsScored += pts;
                entry.points = pts;
                this.trigger('onUnblocked', att, { roll: aRoll, points: pts });
                this.trigger('onAttackResolved', att, { unblocked: true, roll: aRoll });
            }
            results.push(entry);
            this.checkStateBasedActions();
        }

        this.emitEvent('combatDamage', { results });
        this.triggerAll('onEndCombat', { attacker: ap });
        this.endCombat(false);
        this.afterAction();
        if (!this.state.gameOver) {
            this.emitEvent('combatResolved', { pointsScored, results, combatLog: results });
        }
        return { success: true, pointsScored, results };
    }

    // One pupil's combat damage to another.
    combatHit(source, target, roll) {
        const lethal = this.hasKeyword(source, 'lethal');
        const dealt = this.dealDamage(target, roll, source, { combat: true, lethal });
        return dealt;
    }

    // Field Test: a bonus that becomes permanent if the pupil exhausts one
    keepIfKills(card) {
        if (!card) return;
        for (const m of card.mods) if (m.permanentIfKills) { m.until = 'permanent'; delete m.permanentIfKills; }
    }

    rebuttal(blocker, attacker, damageTaken) {
        const def = this.def(blocker);
        const r = def?.rebuttal;
        if (r === undefined || r === null) return;
        if (this.modActive(blocker, m => m.disableAbilities)) return;
        if (!this.findInPlay(attacker.instanceId)) return;
        if (r === 'lethal') {
            if (!this.hasKeyword(attacker, 'stubborn')) attacker._markedLethal = true;
            this.log(`Rebuttal: ${attacker.name} is exhausted.`);
        } else {
            const n = r === 'equal' ? damageTaken : r;
            this.dealDamage(attacker, n, blocker, { combat: true, fromRebuttal: true });
            this.log(`Rebuttal: ${blocker.name} deals ${n} back.`);
        }
    }

    // Points for an unblocked (or overwhelming) attacker, after Leo and friends.
    scoreFor(playerNum, amount, attacker) {
        if (amount <= 0) return 0;
        let prevent = 0;
        this.forEachAura((source, def, sp) => {
            if (sp !== playerNum && def.preventScoring && !this.modActive(source, m => m.disableAbilities)) prevent += def.preventScoring;
        });
        const pts = Math.max(0, amount - prevent);
        if (pts > 0) {
            this.gainPoints(playerNum, pts, attacker);
            if (attacker) {
                this.trigger('onScore', attacker, { points: pts });
                for (const m of attacker.mods || []) {
                    if (m.drawOnScore && !m.drawn) { m.drawn = true; this.draw(m.player || playerNum, 1); }
                }
            }
        }
        return pts;
    }

    endCombat(skipped) {
        this.state.combatStep = null;
        this.state.attackers = [];
        this.state.blockers = {};
        this.state.phase = 'end';      // Draw, Ready, Main, Combat, End: combat ends your main phase
        // Effects that last "until end of combat"
        for (const c of this.allFieldCards()) c.mods = c.mods.filter(m => m.until !== 'endOfCombat');
        this.refreshAll();
    }

    // Time Out
    cancelCombat() {
        if (!this.state.combatStep) return;
        this.log('Combat ends.');
        this.endCombat(true);
    }

    // ==========================================================================
    // State-based actions
    // ==========================================================================

    checkStateBasedActions() {
        if (!this.state || this.state.gameOver) return;
        for (let guard = 0; guard < 20; guard++) {
            this.refreshAll();
            const dead = this.allPupils().filter(c => c._markedLethal || c.currentEndurance <= 0);
            if (!dead.length) break;
            dead.forEach(c => { delete c._markedLethal; this.exhaust(c); });
        }
        this.refreshAll();
        this.checkWinCondition();
    }

    // Run after every action: deaths, the win check, and a sequence number the
    // multiplayer sync uses to tell a newer state from an older one.
    afterAction() {
        this.checkStateBasedActions();
        this.state.seq = (this.state.seq || 0) + 1;
    }

    // ==========================================================================
    // Turns
    // ==========================================================================

    endTurn(playerNum) {
        if (this.state.gameOver) return { success: false, error: 'The game is over' };
        if (this.state.currentPlayer !== playerNum) return { success: false, error: 'Not your turn' };
        if (this.state.combatStep) return { success: false, error: 'Finish combat first' };
        if (this.pendingChoice) return { success: false, error: 'Finish the current choice first' };

        this.state.phase = 'end';
        this.triggerAll('onEndTurn', { player: playerNum });
        for (const c of [...this.allFieldCards()]) {
            for (const m of c.mods) if (m.endTurnDamage && m.until !== 'permanent') this.dealDamage(c, m.endTurnDamage, null, {});
        }
        this.expire('endOfTurn', playerNum);
        this.checkStateBasedActions();
        if (this.state.gameOver) return { success: true };

        const next = this.other(playerNum);
        this.state.turn++;
        this.state.currentPlayer = next;
        this.state.attackers = [];
        this.state.blockers = {};
        this.beginTurn(next);
        this.afterAction();
        this.emitEvent('turnEnded', { player: playerNum, nextPlayer: this.state.currentPlayer });
        return { success: true, nextPlayer: this.state.currentPlayer };
    }

    // Remove what ends now. 'endOfTurn' also sends borrowed cards home.
    expire(when, playerNum) {
        this.state.effects = (this.state.effects || []).filter(e => {
            if (e.until === 'endOfTurn' && when === 'endOfTurn') return false;
            if (e.until === 'yourNextTurn' && when === 'startOfTurn' && e.expiresFor === playerNum) return false;
            return true;
        });
        for (const c of this.allFieldCards()) {
            c.mods = c.mods.filter(m => {
                if (m.until === 'endOfTurn' && when === 'endOfTurn') return false;
                if (m.until === 'endOfCombat' && (when === 'endOfTurn' || when === 'endOfCombat')) return false;
                if (m.until === 'yourNextTurn' && when === 'startOfTurn' && m.expiresFor === playerNum) return false;
                return true;
            });
            c.usedThisTurn = {};
        }
        if (when === 'endOfTurn') {
            for (const c of [...this.allFieldCards()]) {
                if (c.controlReturn && c.controlReturn.until === 'endOfTurn') {
                    const to = c.controlReturn.to;
                    this.removeFromField(c);
                    delete c.controlReturn;
                    this.state.players[to].field.push(c);
                }
            }
            for (const p of [1, 2]) {
                const pl = this.state.players[p];
                pl.resources = pl.resources.filter(r => !r.temporary);
                pl.resources.forEach(r => { if (r.tempAnyColor) { r.anyColor = false; delete r.tempAnyColor; } });
                pl.flags.cannotPlayCards = false;
                pl.flags.nextIdeaDiscount = 0;
                pl.flags.rerolls = Math.min(pl.flags.rerolls || 0, pl.flags.permanentRerolls || 0);
            }
        }
        this.refreshAll();
    }

    beginTurn(playerNum, opts = {}) {
        const player = this.state.players[playerNum];
        this.state.currentPlayer = playerNum;
        this.state.combatStep = null;

        // Ready
        this.state.phase = 'ready';
        this.expire('startOfTurn', playerNum);
        player.field.forEach(c => {
            if (c.skipReady > 0) { c.skipReady--; }
            else c.isSpent = false;
            c.hasGettingBearings = false;
        });
        player.resources.forEach(r => { r.spent = false; });
        for (const p of [1, 2]) {
            this.state.players[p].interruptionPlayed = false;
            this.state.players[p].damageTakenThisTurn = 0;
        }
        player.resourcePlayedThisTurn = false;
        player.resourcesPlayedThisTurn = 0;
        player.flags.combatDone = false;
        player.flags.preventNextPupil = false;
        player.flags.counterNextAbility = false;
        player.flags.refuteNextInterruption = false;
        player.flags.reduceNextDamage = 0;
        player.flags.extraResourcePlays = 0;
        this.refreshAll();

        // Skipped turn (Tetrix)
        if (player.skipTurns > 0) {
            player.skipTurns--;
            this.log(`${this.pname(playerNum)} skips this turn.`);
            this.state.phase = 'main';
            this.emitEvent('turnSkipped', { player: playerNum });
            if (!opts.noAutoEnd) {
                this.endTurnSkipped(playerNum);
            }
            return;
        }

        // Upkeep: start-of-turn triggers
        this.triggerAll('onStartTurn', { player: playerNum });
        this.checkStateBasedActions();
        if (this.state.gameOver) return;

        // Draw
        this.state.phase = 'draw';
        if (!opts.skipDraw) this.draw(playerNum, 1);
        if (this.state.gameOver) return;

        this.state.phase = 'main';
        this.emitEvent('turnStarted', { player: playerNum, handSize: player.hand.length });
    }

    endTurnSkipped(playerNum) {
        this.expire('endOfTurn', playerNum);
        const next = this.other(playerNum);
        this.state.turn++;
        this.beginTurn(next);
        this.emitEvent('turnEnded', { player: playerNum, nextPlayer: this.state.currentPlayer, skipped: true });
    }

    // ==========================================================================
    // Misc
    // ==========================================================================

    pname(p) { return `Player ${p}`; }

    log(text) {
        if (!this.state) return;
        this.state.log.push(text);
        if (this.state.log.length > 30) this.state.log.shift();
        this.emitEvent('log', { text });
    }

    emitEvent(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    getSerializableState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    loadState(serializedState) {
        this.state = JSON.parse(JSON.stringify(serializedState));
        // Defaults for anything a transport may have dropped
        const s = this.state;
        s.attackers = s.attackers || [];
        s.blockers = s.blockers || {};
        s.pending = s.pending || [];
        s.log = s.log || [];
        for (const p of [1, 2]) {
            const pl = s.players[p];
            ['deck', 'hand', 'field', 'resources', 'discard'].forEach(k => { pl[k] = pl[k] || []; });
            pl.flags = pl.flags || {};
            pl.field.forEach(c => {
                c.counters = c.counters || { plusOne: 0, minusOne: 0, shield: 0 };
                c.mods = c.mods || [];
                c.damage = c.damage || 0;
            });
        }
        this.refreshAll();
        this.emitEvent('stateLoaded', { state: this.state });
    }
}

// Export
if (typeof window !== 'undefined') window.RiutizGame = RiutizGame;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizGame };
}
