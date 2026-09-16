// games/riutiz/RiutizGame.js
// Core RIUTIZ game logic - state management, rules, and game flow

class RiutizGame extends EventTarget {
    constructor(options = {}) {
        super();

        this.mode = options.mode || 'vs-ai'; // 'vs-ai', 'local-pvp', 'online-pvp'
        this.cardData = options.cardData || [];
        this.player1Deck = options.player1Deck || null;
        this.player2Deck = options.player2Deck || null;

        this.state = null;
        this.winCondition = 25; // Points to win

        // Ability system - pending actions that need targeting
    }

    // ==========================================
    // Ability Keywords & Patterns
    // ==========================================

    // ==========================================
    // Constants
    // ==========================================

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

    // ==========================================
    // Game Initialization
    // ==========================================

    /**
     * Create initial game state
     */
    createInitialState() {
        return {
            turn: 1,
            currentPlayer: 1,
            phase: 'main',
            combatStep: null,
            attackers: [],
            blockers: {},
            selectedCard: null,
            selectedFieldCard: null,
            players: {
                1: this.createPlayerState(this.player1Deck),
                2: this.createPlayerState(this.player2Deck)
            },
            gameOver: false,
            winner: null
        };
    }

    /**
     * Create player state
     */
    createPlayerState(deckCards = null) {
        const deck = deckCards ? this.createDeckFromCards(deckCards) : this.createRandomDeck();
        return {
            points: 0,
            deck: deck.slice(7),
            hand: deck.slice(0, 7),
            field: [],
            resources: [],
            discard: [],
            interruptionPlayed: false
        };
    }

    /**
     * Create deck from card IDs
     */
    createDeckFromCards(cardIds) {
        const deck = [];
        cardIds.forEach((cardId, index) => {
            const cardData = this.cardData.find(c => c.id === cardId);
            if (cardData) {
                deck.push(this.createCardInstance(cardData, index));
            }
        });
        return this.shuffle(deck);
    }

    /**
     * Create random deck (for AI or quick play)
     */
    createRandomDeck() {
        const pool = this.cardData.filter(c => c.type !== 'Location');
        const deck = [];
        for (let i = 0; i < 40; i++) {
            const card = pool[Math.floor(Math.random() * pool.length)];
            deck.push(this.createCardInstance(card, i));
        }
        return this.shuffle(deck);
    }

    /**
     * Create a card instance with unique ID
     */
    createCardInstance(cardData, index = 0) {
        return {
            ...cardData,
            instanceId: `${cardData.id}-${index}-${Math.random().toString(36).substr(2, 9)}`,
            currentEndurance: cardData.endurance,
            baseEndurance: cardData.endurance,
            hasGettingBearings: true,
            isSpent: false,
            // Ability tracking
            counters: { plusOne: 0 },  // +1/+1 counters
            tempBuffs: [],              // Temporary effects that expire
            dieRollBonus: 0,            // Cumulative die roll bonuses
            damageReduction: 0,         // Damage reduction
            protection: [],             // Protection from colors/types
            abilitiesDisabled: false,   // Logical Fallacy effect
            maxBlockers: null,          // Prime Numbers effect (null = unlimited)
            usedReroll: false           // For Statistics Enthusiast
        };
    }

    /**
     * Start a new game
     */
    startGame() {
        this.state = this.createInitialState();
        this.emitEvent('gameStarted', { state: this.state });
        return this.state;
    }

    // ==========================================
    // Cost Parsing & Resources
    // ==========================================

    /**
     * Parse cost string like "(1)(O)(O)"
     */
    parseCost(costStr) {
        if (!costStr) return { colors: {}, generic: 0, total: 0 };
        const colors = {};
        let generic = 0;
        const matches = costStr.match(/\(([^)]+)\)/g) || [];
        matches.forEach(m => {
            const val = m.replace(/[()]/g, '');
            if (/^\d+$/.test(val)) {
                generic += parseInt(val);
            } else {
                colors[val] = (colors[val] || 0) + 1;
            }
        });
        const total = generic + Object.values(colors).reduce((a, b) => a + b, 0);
        return { colors, generic, total };
    }

    /**
     * Get primary color from cost
     */
    getPrimaryColor(costStr) {
        const { colors } = this.parseCost(costStr);
        const keys = Object.keys(colors);
        return keys.length > 0 ? keys[0] : 'C';
    }

    /**
     * Get all colors from cost (for multicolor cards)
     */
    getAllColors(costStr) {
        const { colors } = this.parseCost(costStr);
        const keys = Object.keys(colors);
        return keys.length > 0 ? keys : ['C'];
    }

    /**
     * Check if a resource can provide a specific color
     */
    resourceProvidesColor(resource, color) {
        // Check if the resource has multiple colors (multicolor card)
        if (resource.colors && Array.isArray(resource.colors)) {
            return resource.colors.includes(color);
        }
        // Fallback to single color
        return resource.color === color;
    }

    /**
     * Check if player can afford a card
     */
    canAfford(card, player) {
        const cost = this.parseCost(card.cost);
        const available = player.resources.filter(r => !r.spent);

        // Track which resources are "used" in this check
        const usedIndices = new Set();

        // Check colored requirements first
        for (const [color, count] of Object.entries(cost.colors)) {
            let found = 0;
            for (let i = 0; i < available.length && found < count; i++) {
                if (!usedIndices.has(i) && this.resourceProvidesColor(available[i], color)) {
                    usedIndices.add(i);
                    found++;
                }
            }
            if (found < count) return false;
        }

        // Check if remaining resources can cover generic cost
        const remainingResources = available.length - usedIndices.size;
        return remainingResources >= cost.generic;
    }

    /**
     * Pay the cost for a card
     */
    payCost(card, player) {
        const cost = this.parseCost(card.cost);

        // Pay colored first
        for (const [color, count] of Object.entries(cost.colors)) {
            let paid = 0;
            for (const r of player.resources) {
                if (!r.spent && paid < count && this.resourceProvidesColor(r, color)) {
                    r.spent = true;
                    paid++;
                }
            }
        }

        // Pay generic
        let genericPaid = 0;
        for (const r of player.resources) {
            if (!r.spent && genericPaid < cost.generic) {
                r.spent = true;
                genericPaid++;
            }
        }
    }

    // ==========================================
    // Card Actions
    // ==========================================

    /**
     * Play a card from hand
     * @param {number} playerNum - Player number (1 or 2)
     * @param {string} instanceId - Card instance ID
     * @param {boolean} asResource - Play as resource instead
     */
    playCard(playerNum, instanceId, asResource = false) {
        const player = this.state.players[playerNum];
        const cardIndex = player.hand.findIndex(c => c.instanceId === instanceId);

        if (cardIndex === -1) {
            return { success: false, error: 'Card not in hand' };
        }

        const card = player.hand[cardIndex];

        if (asResource) {
            // Check if resource already played this turn
            if (player.resourcePlayedThisTurn) {
                return { success: false, error: 'Already played a resource this turn' };
            }

            // Play as resource - store full card data for preview
            // Get all colors the card can produce (for multicolored cards)
            const allColors = this.getAllColors(card.cost);
            const primaryColor = allColors.length > 0 ? allColors[0] : 'C';
            player.hand.splice(cardIndex, 1);
            player.resources.push({
                color: primaryColor,
                colors: allColors, // Store all colors for multicolor cards
                spent: false,
                id: card.instanceId,
                cardName: card.name,
                card: card  // Store full card for preview
            });

            // Mark that a resource was played this turn
            player.resourcePlayedThisTurn = true;

            this.emitEvent('cardPlayedAsResource', { player: playerNum, card, color: primaryColor });
            return { success: true, action: 'resource', color: primaryColor };
        }

        // Play normally
        if (!this.canAfford(card, player)) {
            return { success: false, error: 'Not enough resources' };
        }

        if (card.type === 'Interruption' && player.interruptionPlayed) {
            return { success: false, error: 'Already played an Interruption this turn' };
        }

        this.payCost(card, player);
        player.hand.splice(cardIndex, 1);

        if (card.type?.includes('Pupil')) {
            const hasImpulsive = card.ability?.toLowerCase().includes('impulsive');
            const newCard = {
                ...card,
                hasGettingBearings: !hasImpulsive,
                isSpent: false,
                counters: { plusOne: 0 },
                tempBuffs: [],
                dieRollBonus: 0,
                damageReduction: 0,
                protection: [],
                abilitiesDisabled: false,
                maxBlockers: null,
                usedReroll: false
            };
            player.field.push(newCard);

            // Trigger ETB abilities
            this.triggerETB(playerNum, newCard);

            // Trigger "when another pupil enters" abilities
            this.triggerPupilEntered(playerNum, newCard);

            // Recalculate aura effects
            this.recalculateAuras(playerNum);
        } else if (card.type === 'Interruption') {
            player.discard.push(card);
            player.interruptionPlayed = true;

            // Trigger "when you play an Interruption" effects
            this.triggerOnInterruption(playerNum, card);

            this.resolveInterruption(playerNum, card);
        } else {
            // Tool or Location
            player.field.push({ ...card, isSpent: false, hasGettingBearings: false });
            // Recalculate auras (Tools like Drafting Table have passive effects)
            this.recalculateAuras(playerNum);
        }

        // Anything the card did on entry (Alicia, Mad Scientist, Interruptions...) may
        // have killed something on either side
        this.checkStateBasedActions();

        this.emitEvent('cardPlayed', { player: playerNum, card });
        return { success: true, action: 'play', card };
    }

    /**
     * Resolve interruption effects
     */
    resolveInterruption(playerNum, card, target = null) {
        const ability = card.ability?.toLowerCase() || '';
        const player = this.state.players[playerNum];
        const opponent = this.getOpponent(playerNum);

        // Draw cards
        if (ability.includes('draw')) {
            const match = ability.match(/draw (\d+)/);
            const numCards = match ? parseInt(match[1]) : 1;
            for (let i = 0; i < numCards && player.deck.length > 0; i++) {
                player.hand.push(player.deck.shift());
            }
            this.emitEvent('cardsDrawn', { player: playerNum, count: numCards });
        }

        // Prevent damage - Calculated Risk (id 218)
        if (ability.includes('prevent') && ability.includes('damage')) {
            const match = ability.match(/prevent.*?(\d+)\s*damage/);
            const amount = match ? parseInt(match[1]) : 3;
            if (target) {
                target.tempBuffs.push({
                    type: 'damagePrevent',
                    amount: amount,
                    expiresAt: 'endOfTurn'
                });
                this.emitEvent('buffApplied', { card: target, effect: `Prevent ${amount} damage` });
            }
            return { needsTarget: !target, targetType: 'friendlyPupil', effect: 'damagePrevent', amount };
        }

        // Look at opponent's hand - Statistical Analysis (id 220)
        if (ability.includes("look at opponent's hand") || ability.includes('look at opponent')) {
            this.emitEvent('revealHand', { player: playerNum, targetPlayer: playerNum === 1 ? 2 : 1, hand: opponent.hand });
            return { success: true };
        }

        // Rearrange top cards - Order of Operations (id 221)
        if (ability.includes('rearrange') && ability.includes('top')) {
            const match = ability.match(/top (\d+)/);
            const count = match ? parseInt(match[1]) : 4;
            const topCards = player.deck.slice(0, count);
            this.emitEvent('rearrangeCards', { player: playerNum, cards: topCards, count });
            return { needsRearrange: true, cards: topCards, count };
        }

        // Disable abilities - Logical Fallacy (id 222)
        if (ability.includes('abilities are ignored') || ability.includes('abilities ignored')) {
            if (target) {
                target.abilitiesDisabled = true;
                target.tempBuffs.push({ type: 'abilitiesDisabled', expiresAt: 'endOfTurn' });
                this.emitEvent('abilitiesDisabled', { card: target });
            }
            return { needsTarget: !target, targetType: 'anyPupil', effect: 'disableAbilities' };
        }

        // Restore endurance - Balance Equation (id 223)
        if (ability.includes('equal to its starting endurance') || ability.includes('starting endurance')) {
            if (target) {
                target.currentEndurance = target.baseEndurance || target.endurance;
                this.emitEvent('enduranceRestored', { card: target, amount: target.currentEndurance });
            }
            return { needsTarget: !target, targetType: 'anyPupil', effect: 'restoreEndurance' };
        }

        // Limit blockers - Prime Numbers (id 224)
        if (ability.includes('cannot be blocked by more than one')) {
            if (target) {
                target.maxBlockers = 1;
                target.tempBuffs.push({ type: 'maxBlockers', value: 1, expiresAt: 'endOfTurn' });
                this.emitEvent('blockerLimited', { card: target });
            }
            return { needsTarget: !target, targetType: 'friendlyPupil', effect: 'limitBlockers' };
        }

        // Counter interruption - Proof of Concept (id 219)
        if (ability.includes('refute') || ability.includes('counter')) {
            // This would need a stack system to properly implement
            this.emitEvent('interruptionCountered', { player: playerNum });
            return { success: true };
        }

        // Look at top cards and choose - Hypothesis (id 258)
        if (ability.includes('look at the top') && ability.includes('put') && ability.includes('in your hand')) {
            const topMatch = ability.match(/top (\d+)/);
            const handMatch = ability.match(/put (\d+)/);
            const topCount = topMatch ? parseInt(topMatch[1]) : 5;
            const handCount = handMatch ? parseInt(handMatch[1]) : 2;
            const topCards = player.deck.slice(0, topCount);
            this.emitEvent('chooseFromTop', { player: playerNum, cards: topCards, choose: handCount, discardRest: true });
            return { needsChoice: true, cards: topCards, choose: handCount };
        }

        // Discard - Information Overload (id 256)
        if (ability.includes('discard')) {
            const match = ability.match(/discard.*?(\d+)?.*?card/);
            const count = match && match[1] ? parseInt(match[1]) : 1;
            this.emitEvent('forceDiscard', { targetPlayer: playerNum === 1 ? 2 : 1, count });
            return { needsOpponentDiscard: true, count };
        }

        // Die roll bonus - Structural Analysis (id 253)
        if (ability.includes('die rolls') && ability.includes('+')) {
            const match = ability.match(/\+(\d+)\s*to\s*die/);
            const bonus = match ? parseInt(match[1]) : 2;
            if (target) {
                target.dieRollBonus += bonus;
                target.tempBuffs.push({ type: 'dieRollBonus', value: bonus, expiresAt: 'endOfTurn' });
            }
            // Also check for damage prevention in same ability
            if (ability.includes('prevent all damage')) {
                if (target) {
                    target.tempBuffs.push({ type: 'damagePrevent', amount: 999, expiresAt: 'endOfTurn' });
                }
            }
            return { needsTarget: !target, targetType: 'friendlyPupil', effect: 'dieRollBonus', amount: bonus };
        }

        // === BLACK (Bk) INTERRUPTION EFFECTS ===

        // System Crash (id 226) - Spend target, doesn't ready next turn
        if (ability.includes('spend target') && ability.includes("doesn't ready")) {
            if (target) {
                target.isSpent = true;
                target.skipNextReady = true;
                target.tempBuffs.push({ type: 'skipReady', expiresAt: 'nextTurn' });
                this.emitEvent('systemCrash', { card: target });
            }
            return { needsTarget: !target, targetType: 'anyPupil', effect: 'systemCrash' };
        }

        // Data Breach (id 227) - Look at hand, they discard your choice
        if (ability.includes("look at opponent's hand") && ability.includes('discard') && ability.includes('your choice')) {
            this.emitEvent('dataBreach', {
                player: playerNum,
                targetPlayer: playerNum === 1 ? 2 : 1,
                hand: opponent.hand
            });
            return { needsOpponentDiscardChoice: true };
        }

        // Overclock (id 228) - +3 die rolls, deal 2 damage at end of turn
        if (ability.includes('+3 to die rolls') || (ability.includes('die rolls') && ability.includes('+3'))) {
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) + 3;
                target.tempBuffs.push({ type: 'dieRollBonus', value: 3, expiresAt: 'endOfTurn' });
                target.tempBuffs.push({ type: 'endOfTurnDamage', damage: 2, expiresAt: 'endOfTurn' });
                this.emitEvent('overclock', { card: target, bonus: 3, damage: 2 });
            }
            return { needsTarget: !target, targetType: 'anyPupil', effect: 'overclock' };
        }

        // Debugging (id 229) - Remove all counters
        if (ability.includes('remove all counters')) {
            if (target) {
                target.counters = { plusOne: 0 };
                this.emitEvent('countersRemoved', { card: target });
            }
            return { needsTarget: !target, targetType: 'anyPupilOrTool', effect: 'removeCounters' };
        }

        // Firmware Update (id 230) - Ready target, gains Relentless
        if (ability.includes('ready target') && ability.includes('relentless')) {
            if (target) {
                target.isSpent = false;
                target.tempBuffs.push({ type: 'keyword', keyword: 'relentless', expiresAt: 'endOfTurn' });
                target.tempRelentless = true;
                this.emitEvent('firmwareUpdate', { card: target });
            }
            return { needsTarget: !target, targetType: 'anyPupil', effect: 'firmwareUpdate' };
        }

        // Network Effect (id 231) - Draw for each Tool
        if (ability.includes('draw') && ability.includes('for each tool')) {
            const toolCount = player.field.filter(c => c.type === 'Tool').length;
            for (let i = 0; i < toolCount && player.deck.length > 0; i++) {
                player.hand.push(player.deck.shift());
            }
            this.emitEvent('networkEffect', { player: playerNum, cardsDrawn: toolCount });
            return { success: true };
        }

        // Malware (id 232) - Gain control of target Tool until end of turn
        if (ability.includes('gain control') && ability.includes('tool')) {
            if (target && target.type === 'Tool') {
                // Move tool to player's field temporarily
                const oppIndex = opponent.field.findIndex(c => c.instanceId === target.instanceId);
                if (oppIndex !== -1) {
                    const tool = opponent.field.splice(oppIndex, 1)[0];
                    tool.tempControlledBy = playerNum;
                    tool.originalOwner = playerNum === 1 ? 2 : 1;
                    player.field.push(tool);
                    this.emitEvent('malware', { tool, newController: playerNum });
                }
            }
            return { needsTarget: !target, targetType: 'enemyTool', effect: 'stealTool' };
        }

        // Hard Reset (id 233) - Return all Tools to hands
        if (ability.includes('return all tools') && ability.includes('hands')) {
            [player, opponent].forEach((p, idx) => {
                const tools = p.field.filter(c => c.type === 'Tool');
                tools.forEach(tool => {
                    p.field = p.field.filter(c => c.instanceId !== tool.instanceId);
                    p.hand.push(tool);
                });
            });
            this.emitEvent('hardReset', { player: playerNum });
            return { success: true };
        }

        // Viral Content (id 254) - Deal 3 damage, draw for each point dealt
        if (ability.includes('deal') && ability.includes('damage') && ability.includes('draw') && ability.includes('for each')) {
            const damageMatch = ability.match(/deal\s*(\d+)\s*damage/);
            const damage = damageMatch ? parseInt(damageMatch[1]) : 3;
            if (target) {
                const actualDamage = Math.min(damage, target.currentEndurance);
                target.currentEndurance -= damage;
                for (let i = 0; i < actualDamage && player.deck.length > 0; i++) {
                    player.hand.push(player.deck.shift());
                }
                this.emitEvent('viralContent', { target, damage: actualDamage, cardsDrawn: actualDamage });

                // Check if target died
                if (target.currentEndurance <= 0) {
                    this.emitEvent('pupilExhausted', { card: target });
                }
            }
            return { needsTarget: !target, targetType: 'anyPupil', effect: 'viralContent', damage };
        }

        // Laziness (id 190) - Spend all pupils you don't control
        if (ability.includes('spend all pupils') && ability.includes('do not control')) {
            opponent.field.forEach(card => {
                if (card.type?.includes('Pupil')) {
                    card.isSpent = true;
                }
            });
            this.emitEvent('laziness', { player: playerNum });
            return { success: true };
        }

        // === PURPLE (P) INTERRUPTION EFFECTS ===

        // Outburst (id 196) / Tirade (id 197) - Deal damage to target pupil
        if (ability.includes('deal') && ability.includes('damage to target pupil') && !ability.includes('draw')) {
            const match = ability.match(/deal\s*(\d+)\s*damage/);
            const damage = match ? parseInt(match[1]) : 2;
            if (target) {
                target.currentEndurance -= damage;
                this.emitEvent('damageDealt', { target, damage });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'dealDamage', amount: damage };
        }

        // Emotional Appeal (id 198) - Target pupil gets +2 to die rolls
        if (ability.includes('target pupil gets') && ability.includes('to die rolls until end of turn') && !ability.includes('-')) {
            const match = ability.match(/\+(\d+)\s*to die rolls/);
            const bonus = match ? parseInt(match[1]) : 2;
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) + bonus;
                target.tempBuffs.push({ type: 'dieRollBonus', value: bonus, expiresAt: 'endOfTurn' });
                this.emitEvent('dieRollBonusApplied', { card: target, bonus });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'dieRollBonus', amount: bonus };
        }

        // Performance Anxiety (id 206) - Target pupil gets -2 to die rolls
        if (ability.includes('target pupil gets') && ability.includes('-') && ability.includes('to die rolls')) {
            const match = ability.match(/-(\d+)\s*to die rolls/);
            const penalty = match ? parseInt(match[1]) : 2;
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) - penalty;
                target.tempBuffs.push({ type: 'dieRollPenalty', value: -penalty, expiresAt: 'endOfTurn' });
                this.emitEvent('dieRollPenaltyApplied', { card: target, penalty });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'dieRollPenalty', amount: penalty };
        }

        // Dramatic Exit (id 199) - Return target pupil you control to hand. Draw a card
        if (ability.includes('return target pupil you control') && ability.includes('draw a card')) {
            if (target) {
                this.bounceCard(target, playerNum);
                if (player.deck.length > 0) {
                    player.hand.push(player.deck.shift());
                }
                this.emitEvent('dramaticExit', { card: target, player: playerNum });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'friendlyPupil', effect: 'bounceAndDraw' };
        }

        // Heated Exchange (id 200) - Deal 2 damage to each pupil
        if (ability.includes('deal') && ability.includes('damage to each pupil')) {
            const match = ability.match(/deal\s*(\d+)\s*damage/);
            const damage = match ? parseInt(match[1]) : 2;
            player.field.forEach(p => {
                if (p.type?.includes('Pupil')) {
                    p.currentEndurance -= damage;
                }
            });
            opponent.field.forEach(p => {
                if (p.type?.includes('Pupil')) {
                    p.currentEndurance -= damage;
                }
            });
            this.emitEvent('heatedExchange', { player: playerNum, damage });
            return { success: true };
        }

        // Creative Spark (id 201) - Draw a card, discard a card
        if (ability.includes('draw a card') && ability.includes('discard a card') && !ability.includes('spend:')) {
            if (player.deck.length > 0) {
                player.hand.push(player.deck.shift());
            }
            this.emitEvent('needDiscard', { player: playerNum, count: 1, reason: 'Creative Spark' });
            return { success: true, needsDiscard: true };
        }

        // Wild Gesture (id 202) - Target pupil gets +3/-2 until end of turn
        if (ability.includes('+3/-2') || (ability.includes('+3') && ability.includes('-2'))) {
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) + 3;
                target.currentEndurance -= 2;
                target.tempBuffs.push({ type: 'wildGesture', expiresAt: 'endOfTurn' });
                this.emitEvent('wildGesture', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'wildGesture' };
        }

        // Mood Swing (id 203) - Switch target pupil's Endurance with another's
        if (ability.includes('switch') && ability.includes('endurance')) {
            // This needs two targets
            this.emitEvent('needTwoTargets', {
                player: playerNum,
                effect: 'switchEndurance'
            });
            return { success: true, needsTwoTargets: true };
        }

        // Passionate Defense (id 204) - Target pupil gets +4 Endurance until end of turn
        if (ability.includes('target pupil gets') && ability.includes('endurance until end of turn')) {
            const match = ability.match(/\+(\d+)\s*endurance/);
            const bonus = match ? parseInt(match[1]) : 4;
            if (target) {
                target.currentEndurance += bonus;
                target.tempBuffs.push({ type: 'enduranceBonus', value: bonus, expiresAt: 'endOfTurn' });
                this.emitEvent('enduranceBonusApplied', { card: target, bonus });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'enduranceBonus', amount: bonus };
        }

        // Improvisation (id 205) - Flip coin: heads draw 2, tails opponent draws 1
        if (ability.includes('flip a coin') && ability.includes('heads') && ability.includes('draw 2') && ability.includes('tails')) {
            const isHeads = Math.random() < 0.5;
            if (isHeads) {
                for (let i = 0; i < 2 && player.deck.length > 0; i++) {
                    player.hand.push(player.deck.shift());
                }
                this.emitEvent('improvisationHeads', { player: playerNum });
            } else {
                if (opponent.deck.length > 0) {
                    opponent.hand.push(opponent.deck.shift());
                }
                this.emitEvent('improvisationTails', { player: playerNum });
            }
            return { success: true };
        }

        // Standing Ovation (id 207) - Ready all your pupils, they gain Impulsive
        if (ability.includes('ready all pupils') && ability.includes('impulsive')) {
            player.field.forEach(card => {
                if (card.type?.includes('Pupil')) {
                    card.isSpent = false;
                    card.hasGettingBearings = false;
                    card.tempBuffs = card.tempBuffs || [];
                    card.tempBuffs.push({ type: 'keyword', keyword: 'impulsive', expiresAt: 'endOfTurn' });
                }
            });
            this.emitEvent('standingOvation', { player: playerNum });
            return { success: true };
        }

        // Abstract Thought (id 208) - Target pupil gains Non-Sequitur until end of turn
        if (ability.includes('gains non-sequitur')) {
            if (target) {
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'keyword', keyword: 'non-sequitur', expiresAt: 'endOfTurn' });
                this.emitEvent('nonSequiturGranted', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'grantNonSequitur' };
        }

        // Catharsis (id 209) - Deal damage equal to damage your pupils took this turn
        if (ability.includes('deal damage') && ability.includes('equal to') && ability.includes('taken this turn')) {
            if (target) {
                const damageTaken = player.damageTakenThisTurn || 0;
                target.currentEndurance -= damageTaken;
                this.emitEvent('catharsis', { target, damage: damageTaken });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'catharsis' };
        }

        // Explosive Results (id 255) - Send your pupil home, deal its Endurance as damage
        if (ability.includes('send') && ability.includes('home') && ability.includes('deal damage equal to its endurance')) {
            // This needs a source (your pupil) and a target
            this.emitEvent('needTwoTargets', {
                player: playerNum,
                effect: 'explosiveResults',
                sourceType: 'friendlyPupil',
                targetType: 'anyPupil'
            });
            return { success: true, needsTwoTargets: true };
        }

        // === GREEN (G) INTERRUPTION EFFECTS ===

        // Dissection (id 210) - Exhaust target pupil with Endurance 3 or less
        if (ability.includes('exhaust target pupil') && ability.includes('endurance') && ability.includes('or less')) {
            const match = ability.match(/endurance\s*(\d+)\s*or less/);
            const threshold = match ? parseInt(match[1]) : 3;
            if (target) {
                if (target.currentEndurance <= threshold) {
                    target.currentEndurance = 0;
                    this.emitEvent('dissection', { target });
                    return { success: true };
                }
                return { success: false, error: 'Target has too much Endurance' };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'dissection', maxEndurance: threshold };
        }

        // Natural Decay (id 211) - Put -1/-1 counters on all pupils
        if (ability.includes('-1/-1 counter') && ability.includes('all pupils')) {
            [player, opponent].forEach(p => {
                p.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.counters = card.counters || { plusOne: 0 };
                        card.counters.minusOne = (card.counters.minusOne || 0) + 1;
                        card.currentEndurance = Math.max(1, card.currentEndurance - 1);
                    }
                });
            });
            this.emitEvent('naturalDecay', { player: playerNum });
            return { success: true };
        }

        // Mutation (id 212) - Target +2/+2, another gets -1/-1 counter
        if (ability.includes('+2/+2') && ability.includes('-1/-1 counter') && ability.includes('another')) {
            this.emitEvent('needTwoTargets', {
                player: playerNum,
                effect: 'mutation',
                firstEffect: 'plusTwoPlusTwo',
                secondEffect: 'minusOneCounter'
            });
            return { success: true, needsTwoTargets: true };
        }

        // Controlled Experiment (id 213) - Look at top 4, put one in hand, rest on bottom
        if (ability.includes('look at the top') && ability.includes('put one in hand') && ability.includes('rest on bottom')) {
            const match = ability.match(/top\s*(\d+)\s*cards/);
            const count = match ? parseInt(match[1]) : 4;
            const topCards = player.deck.slice(0, count);
            this.emitEvent('chooseFromTop', {
                player: playerNum,
                topCards: topCards,
                choose: 1,
                putRestOnBottom: true
            });
            return { success: true, needsChoice: true };
        }

        // Symbiosis (id 214) - Target pupil gets +1/+1 for each other pupil you control
        if (ability.includes('+1/+1 for each other pupil')) {
            if (target) {
                const otherPupilCount = player.field.filter(c =>
                    c.type?.includes('Pupil') && c.instanceId !== target.instanceId
                ).length;
                target.dieRollBonus = (target.dieRollBonus || 0) + otherPupilCount;
                target.currentEndurance += otherPupilCount;
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'symbiosis', dieBonus: otherPupilCount, enduranceBonus: otherPupilCount, expiresAt: 'endOfTurn' });
                this.emitEvent('symbiosis', { card: target, bonus: otherPupilCount });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'friendlyPupil', effect: 'symbiosis' };
        }

        // Decomposition (id 215) - Exhaust target pupil. Controller gains resources equal to cost
        if (ability.includes('exhaust target pupil') && ability.includes('gains resources equal to')) {
            if (target) {
                const targetOwner = player.field.includes(target) ? player : opponent;
                // Parse cost to get resource count
                const costMatch = target.cost?.match(/\((\d+)\)/g) || [];
                const colorMatch = target.cost?.match(/\([A-Za-z]+\)/g) || [];
                const totalCost = costMatch.length + colorMatch.length;

                target.currentEndurance = 0;

                // Add colorless resources to the target's controller
                for (let i = 0; i < totalCost; i++) {
                    targetOwner.resources.push({
                        color: 'C',
                        spent: false,
                        id: `decomp-${Date.now()}-${i}`,
                        cardName: 'Decomposition'
                    });
                }
                this.emitEvent('decomposition', { target, resources: totalCost });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'decomposition' };
        }

        // Lab Accident (id 216) - Deal 3 damage. If exhausted, draw 2 cards
        if (ability.includes('deal') && ability.includes('damage') && ability.includes('if') && ability.includes('exhausted') && ability.includes('draw')) {
            const damageMatch = ability.match(/deal\s*(\d+)\s*damage/);
            const drawMatch = ability.match(/draw\s*(\d+)\s*cards?/);
            const damage = damageMatch ? parseInt(damageMatch[1]) : 3;
            const drawCount = drawMatch ? parseInt(drawMatch[1]) : 2;
            if (target) {
                target.currentEndurance -= damage;
                this.emitEvent('labAccidentDamage', { target, damage });
                if (target.currentEndurance <= 0) {
                    for (let i = 0; i < drawCount && player.deck.length > 0; i++) {
                        player.hand.push(player.deck.shift());
                    }
                    this.emitEvent('labAccidentDraw', { player: playerNum, count: drawCount });
                }
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'labAccident', damage, drawCount };
        }

        // Adaptation (id 217) - Target gains Grounded, Closed-Minded, or Relentless
        if (ability.includes('gains your choice of') && (ability.includes('grounded') || ability.includes('closed-minded') || ability.includes('relentless'))) {
            if (target) {
                this.emitEvent('needKeywordChoice', {
                    player: playerNum,
                    target: target,
                    choices: ['grounded', 'closed-minded', 'relentless']
                });
                return { success: true, needsKeywordChoice: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'adaptation' };
        }

        // === ORANGE (O) INTERRUPTION EFFECTS ===

        // Welding (id 22) - Target pupil gets another target pupil's die value
        if (ability.includes('target pupil gets') && ability.includes('other target') && ability.includes('die value')) {
            this.emitEvent('needTwoTargets', {
                player: playerNum,
                effect: 'copyDieValue',
                targetType: 'anyPupil'
            });
            return { success: true, needsTwoTargets: true };
        }

        // Anneal (id 23) - Target pupil gains shield counters
        if (ability.includes('gains') && ability.includes('shield counter')) {
            const match = ability.match(/(\d+)\s*shield counter/);
            const shields = match ? parseInt(match[1]) : 2;
            if (target) {
                target.counters = target.counters || { plusOne: 0 };
                target.counters.shield = (target.counters.shield || 0) + shields;
                this.emitEvent('shieldsAdded', { card: target, shields });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'addShields', amount: shields };
        }

        // Oil Spill (id 24) - +1/+1 on Mechanics OR -1/-1 on Non-Mechanics
        if (ability.includes('mechanics') && (ability.includes('+d1/+e1') || ability.includes('+1/+1')) && ability.includes('-1/-1')) {
            this.emitEvent('needChoiceOilSpill', {
                player: playerNum,
                choices: ['buffMechanics', 'debuffNonMechanics']
            });
            return { success: true, needsChoice: true };
        }

        // Break Down (id 25) - Remove target Tool from play
        if (ability.includes('remove target tool') || (ability.includes('remove') && ability.includes('tool') && ability.includes('from play'))) {
            if (target && target.type === 'Tool') {
                const targetOwner = player.field.includes(target) ? player : opponent;
                targetOwner.field = targetOwner.field.filter(c => c.instanceId !== target.instanceId);
                targetOwner.discard.push(target);
                this.emitEvent('toolDestroyed', { tool: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyTool', effect: 'destroyTool' };
        }

        // Cement (id 26) - Target pupil's attack is lethal until end of turn
        if (ability.includes('attack is lethal') || (ability.includes('lethal until end of turn') && !ability.includes('rebuttal'))) {
            if (target) {
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'keyword', keyword: 'lethal', expiresAt: 'endOfTurn' });
                target.tempLethal = true;
                this.emitEvent('lethalGranted', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'grantLethal' };
        }

        // Frame (id 27) - Send target pupil of cost 2 or less home
        if (ability.includes('send') && ability.includes('home') && ability.includes('cost') && ability.includes('or less')) {
            const match = ability.match(/cost.*?(\d+)\s*or less/);
            const maxCost = match ? parseInt(match[1]) : 2;
            if (target) {
                // Check cost
                const costMatch = target.cost?.match(/\((\d+)\)/);
                const numericCost = costMatch ? parseInt(costMatch[1]) : 0;
                const colorCost = (target.cost?.match(/\([A-Za-z]+\)/g) || []).length;
                const totalCost = numericCost + colorCost;
                if (totalCost <= maxCost) {
                    this.bounceCard(target, player.field.includes(target) ? playerNum : (playerNum === 1 ? 2 : 1));
                    return { success: true };
                }
                return { success: false, error: 'Target cost too high' };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'bounceIfCheap', maxCost };
        }

        // Cross Trains (id 30) - Put +1/+1 on target pupil
        if ((ability.includes('+d1/+e1') || ability.includes('+1/+1')) && ability.includes('on target pupil') && !ability.includes('-1/-1')) {
            if (target) {
                target.counters = target.counters || { plusOne: 0 };
                target.counters.plusOne++;
                target.currentEndurance++;
                this.emitEvent('counterAdded', { card: target, counterType: 'plusOne' });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'plusOneCounter' };
        }

        // Fabricate (id 32) - +2 die roll until EOT, then perpetually -1
        if (ability.includes('+d2') && ability.includes('perpetually') && ability.includes('-d1')) {
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) + 2;
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'dieRollBonus', value: 2, expiresAt: 'endOfTurn' });
                target.perpetualDieRollPenalty = (target.perpetualDieRollPenalty || 0) - 1;
                this.emitEvent('fabricate', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'fabricate' };
        }

        // Flash Point (id 33) - Refute target attack (cancel it)
        if (ability.includes('refute target attack') || ability.includes('cancel') && ability.includes('attack')) {
            this.emitEvent('refuteAttack', { player: playerNum });
            return { success: true, effect: 'cancelAttack' };
        }

        // Fix (id 34) - Target pupil regains Endurance
        if (ability.includes('target pupil') && ability.includes('regains') && ability.includes('endurance')) {
            const match = ability.match(/regains?\s*(\d+)\s*endurance/);
            const amount = match ? parseInt(match[1]) : 5;
            if (target) {
                target.currentEndurance = Math.min(
                    (target.baseEndurance || target.endurance) + (target.auraEnduranceBonus || 0) + (target.counters?.plusOne || 0),
                    target.currentEndurance + amount
                );
                this.emitEvent('enduranceRegained', { card: target, amount });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'regainEndurance', amount };
        }

        // Permeability (id 35) - Target cannot be blocked until end of turn
        if (ability.includes('cannot be blocked until end of turn')) {
            if (target) {
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'unblockable', expiresAt: 'endOfTurn' });
                target.isUnblockable = true;
                this.emitEvent('unblockableGranted', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'grantUnblockable' };
        }

        // Fasten (id 37) - Spend target, remains spent until its next turn
        if (ability.includes('spend') && ability.includes('remains spent')) {
            if (target) {
                target.isSpent = true;
                target.lockedSpent = true;
                this.emitEvent('fastenApplied', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'fasten' };
        }

        // Build Up (id 38) - +1 die rolls OR 2 shield counters
        if (ability.includes('pick 1') && ability.includes('+1 to die rolls') && ability.includes('shield')) {
            this.emitEvent('needChoiceBuildUp', {
                player: playerNum,
                choices: ['dieRollBonus', 'shields']
            });
            return { success: true, needsChoice: true };
        }

        // === COLORLESS (C) INTERRUPTION EFFECTS ===

        // Shield - Target pupil gains 2 shield counters
        if (ability.includes('target pupil gains') && ability.includes('shield counter') && !ability.includes('pick')) {
            const match = ability.match(/(\d+)\s*shield counter/);
            const shields = match ? parseInt(match[1]) : 2;
            if (target) {
                target.counters = target.counters || { plusOne: 0 };
                target.counters.shield = (target.counters.shield || 0) + shields;
                this.emitEvent('shieldsAdded', { card: target, shields });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'addShields', amount: shields };
        }

        // Tire Out / Weary - Target pupil gets -Dx until end of turn
        if (ability.includes('target pupil gets') && ability.includes('-d') && ability.includes('until end of turn')) {
            const match = ability.match(/-d(\d+)/i) || ability.match(/-(\d+)d/i);
            const penalty = match ? parseInt(match[1]) : 2;
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) - penalty;
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'dieRollPenalty', value: -penalty, expiresAt: 'endOfTurn' });
                this.emitEvent('dieRollPenalty', { card: target, penalty });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'dieRollPenalty', amount: penalty };
        }

        // Bunker Down - Target pupil gets 5 shields
        if (ability.includes('target pupil gets') && ability.includes('shields') && !ability.includes('counter')) {
            const match = ability.match(/(\d+)\s*shields/);
            const shields = match ? parseInt(match[1]) : 5;
            if (target) {
                target.counters = target.counters || { plusOne: 0 };
                target.counters.shield = (target.counters.shield || 0) + shields;
                this.emitEvent('shieldsAdded', { card: target, shields });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'addShields', amount: shields };
        }

        // Refute - Refute target attack (cancel it, attacker remains spent)
        if (ability.includes('refute target attack') && !ability.includes('flash point')) {
            this.emitEvent('refuteAttack', { player: playerNum });
            return { success: true, effect: 'cancelAttack' };
        }

        // Recover - Target pupil regains 5 Endurance (already covered by Fix, but adding specific match)
        if (ability.includes('regains') && ability.includes('endurance') && !ability.includes('spent')) {
            const match = ability.match(/regains?\s*(\d+)\s*endurance/i);
            const amount = match ? parseInt(match[1]) : 5;
            if (target) {
                const maxEnd = (target.baseEndurance || target.endurance) + (target.auraEnduranceBonus || 0) + (target.counters?.plusOne || 0);
                target.currentEndurance = Math.min(maxEnd, (target.currentEndurance || target.endurance) + amount);
                this.emitEvent('enduranceRegained', { card: target, amount });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'regainEndurance', amount };
        }

        // Pass Through - Target pupil cannot be blocked until end of turn (already covered by Permeability)

        // Reroll - Reroll any die roll
        if (ability.includes('reroll any die roll') || ability === 'reroll any die roll.') {
            this.emitEvent('rerollAvailable', { player: playerNum });
            player.hasReroll = true;
            return { success: true };
        }

        // End of Day - End the combat phase
        if (ability.includes('end the combat phase')) {
            if (this.state.phase === 'combat') {
                this.state.phase = 'end';
                this.state.combatStep = null;
                this.state.attackers = [];
                this.state.blockers = {};
                this.emitEvent('combatEnded', { reason: 'endOfDay' });
            }
            return { success: true };
        }

        // Knowledge is Power - Each player draws a card
        if (ability.includes('each player draws a card')) {
            if (player.deck.length > 0) {
                player.hand.push(player.deck.shift());
            }
            if (opponent.deck.length > 0) {
                opponent.hand.push(opponent.deck.shift());
            }
            this.emitEvent('bothPlayersDraw', {});
            return { success: true };
        }

        // Bounce Back - Return target pupil to its owner's hand
        if (ability.includes('return target pupil') && ability.includes('owner\'s hand')) {
            if (target) {
                const targetOwner = player.field.includes(target) ? playerNum : (playerNum === 1 ? 2 : 1);
                this.bounceCard(target, targetOwner);
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'bounce' };
        }

        // Study Session - Draw 2 cards
        if (ability.includes('draw 2 cards') && !ability.includes('spend')) {
            for (let i = 0; i < 2; i++) {
                if (player.deck.length > 0) {
                    player.hand.push(player.deck.shift());
                }
            }
            this.emitEvent('cardsDrawn', { player: playerNum, count: 2 });
            return { success: true };
        }

        // Rally - All your pupils get +1 to die rolls until end of turn
        if (ability.includes('all your pupils get +1 to die rolls until end of turn')) {
            player.field.forEach(card => {
                if (card.type?.includes('Pupil')) {
                    card.dieRollBonus = (card.dieRollBonus || 0) + 1;
                    card.tempBuffs = card.tempBuffs || [];
                    card.tempBuffs.push({ type: 'dieRollBonus', value: 1, expiresAt: 'endOfTurn' });
                }
            });
            this.emitEvent('rallyApplied', { player: playerNum });
            return { success: true };
        }

        return { success: true };
    }

    // ==========================================
    // ETB (Enter the Battlefield) Triggers
    // ==========================================

    /**
     * Trigger ETB abilities when a card enters play
     */
    triggerETB(playerNum, card) {
        const ability = card.ability?.toLowerCase() || '';
        const player = this.state.players[playerNum];
        const opponent = this.getOpponent(playerNum);

        // Analytics Enthusiast (id 101) - Look at top 3, put 1 in hand
        if (ability.includes('look at the top') && ability.includes('put one in your hand')) {
            const match = ability.match(/top (\d+)/);
            const count = match ? parseInt(match[1]) : 3;
            const topCards = player.deck.slice(0, count);
            this.emitEvent('etbChooseFromTop', {
                player: playerNum,
                card: card,
                topCards: topCards,
                choose: 1,
                putRestOnBottom: true
            });
        }

        // Data Analyst (id 243) - Look at top 3 of opponent's deck
        if (ability.includes("top") && ability.includes("opponent's deck") && ability.includes('look')) {
            const match = ability.match(/top (\d+)/);
            const count = match ? parseInt(match[1]) : 3;
            const topCards = opponent.deck.slice(0, count);
            this.emitEvent('etbRevealOpponentDeck', {
                player: playerNum,
                card: card,
                topCards: topCards
            });
        }

        // === BLACK (Bk) CARD ETB ABILITIES ===

        // The Gamer (id 119) - Draw a card when enters
        if (ability.includes('when') && ability.includes('enters') && ability.includes('draw a card') && !ability.includes('target')) {
            if (player.deck.length > 0) {
                player.hand.push(player.deck.shift());
                this.emitEvent('etbDraw', { player: playerNum, card, count: 1 });
            }
        }

        // The Hacker (id 120) - Look at opponent's hand, choose a pupil to discard
        if (ability.includes("opponent's hand") && ability.includes('choose') && ability.includes('discard')) {
            const opponentHand = opponent.hand;
            const pupils = opponentHand.filter(c => c.type?.includes('Pupil'));
            this.emitEvent('etbChooseDiscard', {
                player: playerNum,
                card: card,
                targetHand: opponentHand,
                filterPupils: true,
                validTargets: pupils
            });
        }

        // AI Enthusiast (id 126) - Return target pupil to hand (bounce)
        if (ability.includes('target pupil goes back to hand') || ability.includes('target pupil returns to hand')) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'bounce',
                targetType: 'anyPupil'
            });
        }

        // The Vlogger (id 127) - Target pupil gains Non-Sequitur
        if (ability.includes('gains non-sequitur')) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'grantNonSequitur',
                targetType: 'anyPupil'
            });
        }

        // Film Enthusiast (id 128) - Target becomes Spent and doesn't Ready
        if (ability.includes('becomes spent') && ability.includes("doesn't ready")) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'lockdown',
                targetType: 'anyPupil'
            });
        }

        // The QA Tester (id 130) - Endurance = number of Gamers
        if (ability.includes('endurance starts as the number of gamers')) {
            const gamerCount = player.field.filter(c =>
                c.subTypes?.toLowerCase().includes('gamer')
            ).length + opponent.field.filter(c =>
                c.subTypes?.toLowerCase().includes('gamer')
            ).length;
            card.currentEndurance = Math.max(1, gamerCount);
            card.baseEndurance = card.currentEndurance;
            this.emitEvent('dynamicEndurance', { card, endurance: card.currentEndurance });
        }

        // AI Instructor (id 135) - Create token copy of target pupil
        if (ability.includes('create') && ability.includes('token copy')) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'tokenCopy',
                targetType: 'anyPupil'
            });
        }

        // Resource Officer (id 137) - Lockdown: target student can't attack/block
        if (ability.includes('lockdown') && ability.includes('cannot attack or block')) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'lockdownStudent',
                targetType: 'anyStudent',
                sourceCard: card.instanceId
            });
        }

        // Traveling Missionary, Paul (id 251) - Each player draws 2 cards
        if (ability.includes('each player draws') && ability.includes('cards')) {
            const match = ability.match(/draws?\s*(\d+)\s*cards?/);
            const count = match ? parseInt(match[1]) : 2;
            for (let i = 0; i < count && player.deck.length > 0; i++) {
                player.hand.push(player.deck.shift());
            }
            for (let i = 0; i < count && opponent.deck.length > 0; i++) {
                opponent.hand.push(opponent.deck.shift());
            }
            this.emitEvent('etbBothDraw', { player: playerNum, card, count });
        }

        // Digital Artist (id 241) - Handled in combat (when deals damage, draw)

        // Biotech Intern (id 247) - Gets +1/+1 when another pupil exhausted (tracked via triggerPupilExhausted)

        // === PURPLE (P) CARD ETB ABILITIES ===

        // Selfie Girl (id 69) - Target pupil cannot block this turn
        if (ability.includes('when') && ability.includes('enters') && ability.includes('cannot block this turn')) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'cantBlock',
                targetType: 'anyPupil'
            });
        }

        // Emo Girl (id 72) - Do 2 damage to target pupil
        if (ability.includes('when') && ability.includes('enters') && ability.includes('do') && ability.includes('damage to target')) {
            const match = ability.match(/do\s*(\d+)\s*damage/);
            const damage = match ? parseInt(match[1]) : 2;
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'dealDamage',
                amount: damage,
                targetType: 'anyPupil'
            });
        }

        // Style Sevant (id 74) - Do 1 exhaust (damage) to all pupils
        if (ability.includes('when') && ability.includes('enters') && ability.includes('exhaust to all pupils')) {
            const match = ability.match(/(\d+)\s*exhaust/);
            const damage = match ? parseInt(match[1]) : 1;
            // Damage all pupils on both sides
            player.field.forEach(p => {
                if (p.type?.includes('Pupil') && p.instanceId !== card.instanceId) {
                    p.currentEndurance -= damage;
                }
            });
            opponent.field.forEach(p => {
                if (p.type?.includes('Pupil')) {
                    p.currentEndurance -= damage;
                }
            });
            this.emitEvent('etbDamageAll', { player: playerNum, card, damage });
        }

        // Compassionate Principal Alicia (id 91) - Do 5 damage to all other pupils
        if (ability.includes('when enter') && ability.includes('damage to all other pupils')) {
            const match = ability.match(/do\s*(\d+)\s*damage/);
            const damage = match ? parseInt(match[1]) : 5;
            player.field.forEach(p => {
                if (p.type?.includes('Pupil') && p.instanceId !== card.instanceId) {
                    p.currentEndurance -= damage;
                }
            });
            opponent.field.forEach(p => {
                if (p.type?.includes('Pupil')) {
                    p.currentEndurance -= damage;
                }
            });
            this.emitEvent('etbDamageAll', { player: playerNum, card, damage });
        }

        // Mad Scientist (id 242) - Flip coin: heads +3/+3, tails deal 3 damage to it
        if (ability.includes('volatile') || (ability.includes('flip a coin') && ability.includes('heads') && ability.includes('+3/+3'))) {
            const isHeads = Math.random() < 0.5;
            if (isHeads) {
                card.counters = card.counters || { plusOne: 0 };
                card.counters.plusOne += 3;
                card.currentEndurance += 3;
                this.emitEvent('madScientistHeads', { card, bonus: 3 });
            } else {
                card.currentEndurance -= 3;
                this.emitEvent('madScientistTails', { card, damage: 3 });
            }
        }

        // Set Designer (id 245) - Target pupil gets +2 Endurance
        if (ability.includes('when') && ability.includes('enters') && ability.includes('target pupil gets') && ability.includes('endurance')) {
            const match = ability.match(/\+(\d+)\s*endurance/);
            const bonus = match ? parseInt(match[1]) : 2;
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'grantEndurance',
                amount: bonus,
                targetType: 'anyPupil'
            });
        }

        // Inspirational Speaker Paul (id 262) - Each of your pupils gets +2 die rolls until end of turn
        if (ability.includes('when') && ability.includes('enters') && ability.includes('each of your pupils gets') && ability.includes('die rolls')) {
            const match = ability.match(/\+(\d+)\s*to die rolls/);
            const bonus = match ? parseInt(match[1]) : 2;
            player.field.forEach(p => {
                if (p.type?.includes('Pupil')) {
                    p.tempBuffs = p.tempBuffs || [];
                    p.tempBuffs.push({ type: 'dieRollBonus', value: bonus, expiresAt: 'endOfTurn' });
                    p.dieRollBonus = (p.dieRollBonus || 0) + bonus;
                }
            });
            this.emitEvent('inspirationalBoost', { player: playerNum, card, bonus });
        }

        // === GREEN (G) CARD ETB ABILITIES ===

        // Discovery Principal Dan (id 63) - Set aside card with 3 timer counters
        if (ability.includes('enter') && ability.includes('set aside') && ability.includes('timer counters')) {
            this.emitEvent('discoveryPrincipalTrigger', {
                player: playerNum,
                card: card,
                effect: 'setAsideWithTimers',
                counters: 3
            });
        }

        // Lab Technician (id 244) - Put +1/+1 counter on target pupil
        if (ability.includes('when') && ability.includes('enters') && ability.includes('+1/+1 counter')) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'plusOneCounter',
                targetType: 'anyPupil'
            });
        }

        // === ORANGE (O) CARD ETB ABILITIES ===

        // Grease Monkey (id 5) - Add a resource of your choice to your hand
        if (ability.includes('add a resource') && ability.includes('your choice') && ability.includes('hand')) {
            this.emitEvent('needColorChoice', {
                player: playerNum,
                card: card,
                effect: 'addResourceToHand'
            });
        }

        // The Fixer (id 10) - Target pupil restores up to 3 HP
        if (ability.includes('target pupil') && ability.includes('restores') && ability.includes('hp')) {
            const match = ability.match(/restores?\s*(?:up to\s*)?(\d+)\s*hp/);
            const amount = match ? parseInt(match[1]) : 3;
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'restoreHP',
                amount: amount,
                targetType: 'anyPupil'
            });
        }

        // Janitor (id 17) - Search for pupil with attack die lower than 1d6
        if (ability.includes('search') && ability.includes('deck') && ability.includes('lower than')) {
            this.emitEvent('janitorSearch', {
                player: playerNum,
                card: card,
                maxDie: 'd4'
            });
        }

        // Projects Constructor Mary (id 19) - When a Pupil enters they get +2 HP
        // This is handled as an aura in recalculateAuras

        // Slick Principal Mary (id 20) - Create 2 resources of your choice
        if (ability.includes('create') && ability.includes('resources of your choice')) {
            const match = ability.match(/create\s*(\d+)\s*resources?/);
            const count = match ? parseInt(match[1]) : 2;
            this.emitEvent('needMultipleColorChoice', {
                player: playerNum,
                card: card,
                effect: 'createResources',
                count: count
            });
        }

        // === COLORLESS (C) CARD ETB ABILITIES ===

        // Adoptive Parent - When enters, target pupil you control gets +2 Endurance
        if (ability.includes('when') && ability.includes('enters') && ability.includes('target pupil you control') && ability.includes('+2 endurance')) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'grantEndurance',
                amount: 2,
                targetType: 'friendlyPupil'
            });
        }

        // Shy kid - When enters, all opponent's attack die rolls get -1 until end of turn
        if (ability.includes('when') && ability.includes('enters') && ability.includes('opponent\'s attack die rolls get -1')) {
            opponent.field.forEach(c => {
                if (c.type?.includes('Pupil')) {
                    c.tempBuffs = c.tempBuffs || [];
                    c.tempBuffs.push({
                        type: 'dieRollPenalty',
                        amount: -1,
                        expires: 'endOfTurn'
                    });
                }
            });
            this.emitEvent('shyKidETB', {
                player: playerNum,
                card: card
            });
        }

        // Tinkerer - When enters, search deck for a Tool
        if (ability.includes('when') && ability.includes('enters') && ability.includes('search') && ability.includes('tool')) {
            this.emitEvent('tinkererSearch', {
                player: playerNum,
                card: card,
                searchType: 'Tool'
            });
        }

        // Influencer - When enters, target opponent's pupil cannot block this turn
        if (ability.includes('when') && ability.includes('enters') && ability.includes('target opponent\'s pupil cannot block')) {
            this.emitEvent('etbNeedsTarget', {
                player: playerNum,
                card: card,
                effect: 'cannotBlock',
                targetType: 'opponentPupil'
            });
        }

        // Run-away Parent - Impulsive and When exhausted draw a card (Impulsive handled by keyword)
        // Exhausted trigger is handled in triggerPupilExhausted
    }

    /**
     * State-based actions: any pupil at 0 or less endurance (counting aura bonuses)
     * leaves the field, goes to its owner's discard and fires "when a pupil is
     * exhausted" triggers exactly once. Called after every card play, ability and
     * combat. Before this, damage outside combat left dead pupils on the field, and
     * the combat sweep only removed pupils at NEGATIVE endurance (`!0` is true).
     */
    checkStateBasedActions() {
        const dead = [];
        [1, 2].forEach(playerNum => {
            const player = this.state.players[playerNum];
            player.field = player.field.filter(c => {
                if (!c.type?.includes('Pupil')) return true;      // Tools, Locations
                const endurance = (c.currentEndurance ?? c.endurance ?? 0) + (c.auraEnduranceBonus || 0);
                if (endurance > 0) return true;
                player.discard.push(c);
                dead.push({ card: c, owner: playerNum });
                return false;
            });
        });
        if (dead.length === 0) return dead;
        dead.forEach(({ card, owner }) => {
            this.emitEvent('pupilExhausted', { card, owner });
            this.triggerPupilExhausted(card, owner);
        });
        this.recalculateAuras(1);
        this.recalculateAuras(2);
        return dead;
    }

    /**
     * Trigger effects when a pupil is exhausted (destroyed/killed)
     */
    triggerPupilExhausted(exhaustedCard, ownerPlayerNum) {
        // Check both players for "when another pupil is exhausted" triggers
        [1, 2].forEach(playerNum => {
            const player = this.state.players[playerNum];

            player.field.forEach(card => {
                if (card.abilitiesDisabled) return;
                if (card.instanceId === exhaustedCard.instanceId) return; // Don't trigger on self
                const ability = card.ability?.toLowerCase() || '';

                // Biotech Intern (id 247) - Gets +1/+1 when another pupil is exhausted
                if (ability.includes('when another pupil is exhausted') && ability.includes('+1/+1')) {
                    card.counters = card.counters || { plusOne: 0 };
                    card.counters.plusOne++;
                    card.currentEndurance++;
                    this.emitEvent('biotechInternTrigger', {
                        card,
                        exhaustedPupil: exhaustedCard.name,
                        newCounters: card.counters.plusOne
                    });
                }

                // Gene Sequencer (id 261) - May pay (1) to draw when pupil exhausted
                if (ability.includes('when a pupil is exhausted') && ability.includes('pay') && ability.includes('draw')) {
                    const availableResources = player.resources.filter(r => !r.spent);
                    if (availableResources.length > 0) {
                        this.emitEvent('geneSequencerTrigger', {
                            player: playerNum,
                            card,
                            exhaustedPupil: exhaustedCard.name,
                            canPay: true
                        });
                    }
                }

                // The Amphitheater (id 93) - When a pupil is exhausted, its controller draws
                if (card.type === 'Location' && ability.includes('when a pupil is exhausted') && ability.includes('controller draws')) {
                    const exhaustedOwner = this.state.players[ownerPlayerNum];
                    if (exhaustedOwner.deck.length > 0) {
                        exhaustedOwner.hand.push(exhaustedOwner.deck.shift());
                        this.emitEvent('amphitheaterDraw', {
                            player: ownerPlayerNum,
                            exhaustedCard: exhaustedCard.name
                        });
                    }
                }

                // Traveling Missionary Paul (id 251) - May pay (1) to recover 2 Endurance on another pupil
                if (ability.includes('whenever a pupil is exhausted') && ability.includes('pay') && ability.includes('recover')) {
                    const availableResources = player.resources.filter(r => !r.spent);
                    if (availableResources.length > 0) {
                        this.emitEvent('paulRecoveryTrigger', {
                            player: playerNum,
                            card,
                            exhaustedPupil: exhaustedCard.name,
                            canPay: true
                        });
                    }
                }

                // Biology Teacher (id 58) - Natural Selection: +1 die roll until EOT when pupil exhausted
                if (ability.includes('natural selection') || (ability.includes('when another pupil is exhausted') && ability.includes('+1 to die rolls'))) {
                    card.tempBuffs = card.tempBuffs || [];
                    card.tempBuffs.push({ type: 'dieRollBonus', value: 1, expiresAt: 'endOfTurn' });
                    card.dieRollBonus = (card.dieRollBonus || 0) + 1;
                    this.emitEvent('naturalSelection', { card, bonus: 1 });
                }

                // === COLORLESS (C) EXHAUSTED TRIGGERS ===

                // Observant Parent - When another pupil you control is exhausted, you may draw a card
                if (ability.includes('when another pupil you control is exhausted') && ability.includes('draw a card')) {
                    if (playerNum === ownerPlayerNum) { // Only trigger for owner's puppils
                        this.emitEvent('observantParentTrigger', {
                            player: playerNum,
                            card,
                            exhaustedPupil: exhaustedCard.name
                        });
                    }
                }
            });
        });

        // Check if the exhausted card itself has a self-exhaust trigger
        const exhaustedAbility = exhaustedCard.ability?.toLowerCase() || '';

        // Run-away Parent - When Run-away Parent is exhausted, draw a card
        if (exhaustedAbility.includes('when') && exhaustedAbility.includes('is exhausted') && exhaustedAbility.includes('draw a card') && !exhaustedAbility.includes('another')) {
            const owner = this.state.players[ownerPlayerNum];
            if (owner.deck.length > 0) {
                owner.hand.push(owner.deck.shift());
                this.emitEvent('runawayParentDraw', {
                    player: ownerPlayerNum,
                    card: exhaustedCard
                });
            }
        }
    }

    /**
     * Trigger effects when a pupil enters the battlefield
     */
    triggerPupilEntered(playerNum, enteredCard) {
        const player = this.state.players[playerNum];

        // Check for "when another pupil enters" triggers
        player.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            if (card.instanceId === enteredCard.instanceId) return; // Don't trigger on self
            const ability = card.ability?.toLowerCase() || '';

            // Bugati - When another pupil enters under your control, gets +1/+1 until end of turn
            if (ability.includes('when another pupil enters') && ability.includes('+1/+1 until end of turn')) {
                card.tempBuffs = card.tempBuffs || [];
                card.tempBuffs.push({
                    type: 'dieRollBonus',
                    value: 1,
                    expiresAt: 'endOfTurn'
                });
                card.tempBuffs.push({
                    type: 'enduranceBonus',
                    value: 1,
                    expiresAt: 'endOfTurn'
                });
                card.dieRollBonus = (card.dieRollBonus || 0) + 1;
                card.currentEndurance = (card.currentEndurance || card.endurance) + 1;
                this.emitEvent('bugatiTrigger', {
                    card,
                    enteredPupil: enteredCard.name
                });
            }
        });
    }

    /**
     * Pay for Gene Sequencer triggered ability
     */
    payGeneSequencerTrigger(playerNum) {
        const player = this.state.players[playerNum];
        const availableResource = player.resources.find(r => !r.spent);

        if (!availableResource) {
            return { success: false, error: 'No available resources' };
        }

        availableResource.spent = true;

        if (player.deck.length > 0) {
            player.hand.push(player.deck.shift());
            this.emitEvent('geneSequencerDraw', { player: playerNum });
        }

        return { success: true };
    }

    /**
     * Handle drawing cards with trigger checks (Confusion Matrix)
     * @param {number} playerNum - Player drawing cards
     * @param {number} count - Number of cards to draw
     * @param {boolean} skipTriggers - Whether to skip draw triggers (to prevent infinite loops)
     */
    drawCards(playerNum, count, skipTriggers = false) {
        const player = this.state.players[playerNum];
        let cardsDrawn = 0;

        for (let i = 0; i < count && player.deck.length > 0; i++) {
            player.hand.push(player.deck.shift());
            cardsDrawn++;
        }

        // Check for Confusion Matrix trigger (opponent's tool)
        if (!skipTriggers && cardsDrawn > 0) {
            this.triggerOnOpponentDraw(playerNum, cardsDrawn);
        }

        return cardsDrawn;
    }

    /**
     * Trigger effects when a player draws (Confusion Matrix)
     */
    triggerOnOpponentDraw(drawingPlayerNum, cardsDrawn) {
        const opponentNum = drawingPlayerNum === 1 ? 2 : 1;
        const opponent = this.state.players[opponentNum];

        opponent.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';

            // Confusion Matrix (id 141): "Draw a card when an opponent draws a card"
            if (ability.includes('when an opponent draws')) {
                // Draw without triggering (to prevent infinite loop)
                if (opponent.deck.length > 0) {
                    opponent.hand.push(opponent.deck.shift());
                    this.emitEvent('confusionMatrixTrigger', {
                        player: opponentNum,
                        card,
                        triggeredBy: drawingPlayerNum
                    });
                }
            }
        });
    }

    /**
     * Handle bounce effect (return pupil to hand)
     */
    bounceCard(targetCard, targetPlayerNum) {
        const targetPlayer = this.state.players[targetPlayerNum];
        const cardIndex = targetPlayer.field.findIndex(c => c.instanceId === targetCard.instanceId);
        if (cardIndex === -1) return { success: false, error: 'Card not on field' };

        const card = targetPlayer.field.splice(cardIndex, 1)[0];
        // Reset card state
        card.currentEndurance = card.baseEndurance || card.endurance;
        card.isSpent = false;
        card.hasGettingBearings = true;
        card.counters = { plusOne: 0 };
        card.tempBuffs = [];
        card.dieRollBonus = 0;

        targetPlayer.hand.push(card);
        this.emitEvent('cardBounced', { card, player: targetPlayerNum });
        return { success: true };
    }

    /**
     * Create a token copy of a card
     */
    createTokenCopy(sourceCard, ownerPlayerNum) {
        const player = this.state.players[ownerPlayerNum];
        const token = {
            ...sourceCard,
            instanceId: `token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            currentEndurance: sourceCard.endurance,
            baseEndurance: sourceCard.endurance,
            hasGettingBearings: true,
            isSpent: false,
            counters: { plusOne: 0 },
            tempBuffs: [],
            dieRollBonus: 0,
            damageReduction: 0,
            protection: [],
            isToken: true
        };
        player.field.push(token);
        this.recalculateAuras(ownerPlayerNum);
        this.emitEvent('tokenCreated', { player: ownerPlayerNum, token, copiedFrom: sourceCard.name });
        return { success: true, token };
    }

    /**
     * Apply lockdown effect (can't attack or block while source is in play)
     */
    applyLockdown(targetCard, sourceCardInstanceId) {
        targetCard.lockedBy = sourceCardInstanceId;
        targetCard.cannotAttack = true;
        targetCard.cannotBlock = true;
        this.emitEvent('lockdownApplied', { target: targetCard, source: sourceCardInstanceId });
    }

    /**
     * Check and remove lockdown when source card leaves
     */
    checkLockdownRemoval(removedCardInstanceId) {
        // Check all players' fields for locked cards
        [1, 2].forEach(playerNum => {
            const player = this.state.players[playerNum];
            player.field.forEach(card => {
                if (card.lockedBy === removedCardInstanceId) {
                    card.lockedBy = null;
                    card.cannotAttack = false;
                    card.cannotBlock = false;
                    this.emitEvent('lockdownRemoved', { card });
                }
            });
        });
    }

    /**
     * Trigger effects when an Interruption is played
     */
    triggerOnInterruption(playerNum, interruptionCard) {
        const player = this.state.players[playerNum];

        player.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';

            // Calculus Teacher (id 110) - Draw a card when you play an Interruption
            if (ability.includes('when you play an interruption') && ability.includes('draw')) {
                if (player.deck.length > 0) {
                    player.hand.push(player.deck.shift());
                    this.emitEvent('triggerDraw', { card: card, reason: 'Calculus Teacher' });
                }
            }

            // Music Theory Student (id 248) - Give -1 die rolls to target
            if (ability.includes('whenever you play an interruption') && ability.includes('-1 to die rolls')) {
                this.emitEvent('needTargetForDebuff', {
                    player: playerNum,
                    card: card,
                    effect: 'dieRollPenalty',
                    amount: -1
                });
            }

            // Dancer (id 68) - When you play an idea card, deal 1 exhaust to target pupil
            if (ability.includes('when you play an idea') && ability.includes('deal') && ability.includes('exhaust')) {
                const match = ability.match(/deal\s*(\d+)\s*exhaust/);
                const damage = match ? parseInt(match[1]) : 1;
                this.emitEvent('needTargetForDamage', {
                    player: playerNum,
                    card: card,
                    effect: 'dealDamage',
                    amount: damage,
                    reason: 'Dancer'
                });
            }

            // STEM Initiative Director Mary (id 252) - Target pupil gets +1/+1 until end of turn
            if (ability.includes('when you play an interruption') && ability.includes('+1/+1')) {
                this.emitEvent('needTargetForBuff', {
                    player: playerNum,
                    card: card,
                    effect: 'plusOnePlusOne',
                    amount: 1
                });
            }
        });
    }

    // ==========================================
    // Aura Effects (Passive Stat Modifications)
    // ==========================================

    /**
     * Recalculate all aura effects for a player
     */
    recalculateAuras(playerNum) {
        // Auras cross the table (Authoritarian Parent penalises the opponent's pupils),
        // so both fields are reset together and both players' auras re-applied;
        // resetting one side at a time either lost or doubled the cross-table ones.
        [1, 2].forEach(p => this.state.players[p].field.forEach(card => {
            card.auraEnduranceBonus = 0;
            card.auraDamageBonus = 0;
            card.auraDamageReduction = 0;
            card.auraProtection = [];
            card.auraDieRollBonus = 0;
            card.auraDieRollPenalty = 0;
            card.toolCostReduction = 0;
            card.interruptionCostReduction = 0;
            card.hasComfortAura = false;
        }));
        this._applyAurasFrom(1);
        this._applyAurasFrom(2);
    }

    _applyAurasFrom(playerNum) {
        const player = this.state.players[playerNum];
        const opponent = this.getOpponent(playerNum);

        // Apply auras from each card
        player.field.forEach(sourceCard => {
            if (sourceCard.abilitiesDisabled) return;
            const ability = sourceCard.ability?.toLowerCase() || '';

            // Structural Design Teacher (id 15) - Other pupils get +2 Endurance
            if (ability.includes('other pupils') && ability.includes('+') && ability.includes('endurance')) {
                const match = ability.match(/\+(\d+)\s*endurance/);
                const bonus = match ? parseInt(match[1]) : 2;
                player.field.forEach(card => {
                    if (card.instanceId !== sourceCard.instanceId && card.type?.includes('Pupil')) {
                        card.auraEnduranceBonus = (card.auraEnduranceBonus || 0) + bonus;
                    }
                });
            }

            // Applied Mathematics Teacher (id 112) - Other pupils get +1/+0
            if (ability.includes('other pupils') && ability.includes('+1/+0')) {
                player.field.forEach(card => {
                    if (card.instanceId !== sourceCard.instanceId && card.type?.includes('Pupil')) {
                        card.auraDamageBonus = (card.auraDamageBonus || 0) + 1;
                    }
                });
            }

            // Authoritative Principal Jordan (id 115) - All your pupils take 2 less damage
            if (ability.includes('your pupils take') && ability.includes('less damage')) {
                const match = ability.match(/(\d+)\s*less damage/);
                const reduction = match ? parseInt(match[1]) : 2;
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDamageReduction = (card.auraDamageReduction || 0) + reduction;
                    }
                });
            }

            // Trigonometry Teacher (id 109) - Protection from Arts
            if (ability.includes('protection from arts')) {
                player.field.forEach(card => {
                    if (card.instanceId !== sourceCard.instanceId && card.type?.includes('Pupil')) {
                        if (!card.auraProtection) card.auraProtection = [];
                        if (!card.auraProtection.includes('P')) card.auraProtection.push('P'); // Purple = Arts
                    }
                });
            }

            // Drafting Table (id 260) - Your pupils get +1 Endurance
            if (sourceCard.type === 'Tool' && ability.includes('your pupils get') && ability.includes('endurance')) {
                const match = ability.match(/\+(\d+)\s*endurance/);
                const bonus = match ? parseInt(match[1]) : 1;
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraEnduranceBonus = (card.auraEnduranceBonus || 0) + bonus;
                    }
                });
            }

            // === BLACK (Bk) AURA EFFECTS ===

            // Backend Principal, Luke (id 139) - -1 to all opponent's attack rolls
            if (ability.includes('-1 to all opponent') && ability.includes('attack')) {
                opponent.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDieRollPenalty = (card.auraDieRollPenalty || 0) - 1;
                    }
                });
            }

            // Robotics Professor (id 134) - Tool cards cost (1) less
            if (ability.includes('tool cards cost') && ability.includes('less')) {
                player.toolCostReduction = (player.toolCostReduction || 0) + 1;
            }

            // Robotics Club Captain (id 249) - Your Tools cost (1) less
            if (ability.includes('your tools cost') && ability.includes('less')) {
                player.toolCostReduction = (player.toolCostReduction || 0) + 1;
            }

            // STEM Initiative Director, Mary (id 252) - Interruptions and Tools cost (1) less
            if (ability.includes('interruptions and tools cost') && ability.includes('less')) {
                player.toolCostReduction = (player.toolCostReduction || 0) + 1;
                player.interruptionCostReduction = (player.interruptionCostReduction || 0) + 1;
            }

            // === PURPLE (P) AURA EFFECTS ===

            // Popular Kid (id 81) - +1 die roll for each other Popular pupil in play
            if (ability.includes('+1 to die roll') && ability.includes('for each other popular')) {
                const popularCount = player.field.filter(c =>
                    c.instanceId !== sourceCard.instanceId &&
                    c.subTypes?.toLowerCase().includes('popular')
                ).length + opponent.field.filter(c =>
                    c.subTypes?.toLowerCase().includes('popular')
                ).length;
                if (popularCount > 0) {
                    sourceCard.auraDieRollBonus = (sourceCard.auraDieRollBonus || 0) + popularCount;
                }
            }

            // Music Room (id 92) - Purple pupils get +1 to die rolls
            if (sourceCard.type === 'Location' && ability.includes('purple pupils') && ability.includes('+1 to die rolls')) {
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        const cardColor = this.getPrimaryColor(card.cost);
                        if (cardColor === 'P') {
                            card.auraDieRollBonus = (card.auraDieRollBonus || 0) + 1;
                        }
                    }
                });
            }

            // === GREEN (G) AURA EFFECTS ===

            // The Lab (id 66) - Green pupils gain roll advantage
            if (sourceCard.type === 'Location' && ability.includes('green pupils') && ability.includes('roll advantage')) {
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        const cardColor = this.getPrimaryColor(card.cost);
                        if (cardColor === 'G') {
                            card.hasAdvantage = true;
                        }
                    }
                });
            }

            // === ORANGE (O) LOCATION AURA EFFECTS ===

            // Parking Lot (id 39) - All pupils have Impulsive
            if (sourceCard.type === 'Location' && ability.includes('all pupils have impulsive')) {
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.hasImpulsive = true;
                    }
                });
                opponent.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.hasImpulsive = true;
                    }
                });
            }

            // The Workshop (id 40) - Tool cards cost (1) less to play
            if (sourceCard.type === 'Location' && ability.includes('tool cards cost') && ability.includes('less')) {
                player.toolCostReduction = (player.toolCostReduction || 0) + 1;
            }

            // Field (id 41) - All attack die rolls get +1
            if (sourceCard.type === 'Location' && ability.includes('all attack die rolls get +1')) {
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDieRollBonus = (card.auraDieRollBonus || 0) + 1;
                    }
                });
                opponent.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDieRollBonus = (card.auraDieRollBonus || 0) + 1;
                    }
                });
            }

            // Gym/Weights Room (id 42) - Pupils with Endurance 6+ get +1 to die rolls
            if (sourceCard.type === 'Location' && ability.includes('endurance 6 or more') && ability.includes('+1 to die rolls')) {
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        const effectiveEndurance = (card.currentEndurance || card.endurance || 0) +
                            (card.auraEnduranceBonus || 0) + (card.counters?.plusOne || 0);
                        if (effectiveEndurance >= 6) {
                            card.auraDieRollBonus = (card.auraDieRollBonus || 0) + 1;
                        }
                    }
                });
                opponent.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        const effectiveEndurance = (card.currentEndurance || card.endurance || 0) +
                            (card.auraEnduranceBonus || 0) + (card.counters?.plusOne || 0);
                        if (effectiveEndurance >= 6) {
                            card.auraDieRollBonus = (card.auraDieRollBonus || 0) + 1;
                        }
                    }
                });
            }

            // === COLORLESS (C) AURA EFFECTS ===

            // Authoritative Parent - Your pupils get +1 to die rolls while in play
            if (ability.includes('your pupils get +1 to die rolls') && ability.includes('in play')) {
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDieRollBonus = (card.auraDieRollBonus || 0) + 1;
                    }
                });
            }

            // Authoritarian Parent - Opponent's pupils get -1 to die rolls while in play
            if (ability.includes('opponent\'s pupils get -1 to die rolls') && ability.includes('in play')) {
                opponent.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDieRollPenalty = (card.auraDieRollPenalty || 0) - 1;
                    }
                });
            }

            // Encouraging Parent - Your pupils may attack the turn they enter (grants Impulsive)
            if (ability.includes('your pupils may attack the turn they enter')) {
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.hasImpulsive = true;
                    }
                });
            }

            // Janitor (id 17) - Your pupils get +1 to die rolls
            if (ability.includes('your pupils get +1 to die rolls') && !ability.includes('in play') && !ability.includes('until')) {
                player.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDieRollBonus = (card.auraDieRollBonus || 0) + 1;
                    }
                });
            }

            // Pocket Watch (Tool) - Your Interruptions cost (1) less to play
            if (sourceCard.type === 'Tool' && ability.includes('your interruptions cost') && ability.includes('less')) {
                player.interruptionCostReduction = (player.interruptionCostReduction || 0) + 1;
            }

            // Atlas (Class Pet) - Comfort: Pupils cannot have Endurance reduced below 1 by opponent effects
            if (ability.includes('comfort') && ability.includes('cannot have their endurance reduced below 1')) {
                player.hasComfortAura = true;
            }

            // Detached Parent - Cannot block, cannot be blocked (handled in combat)
            if (ability.includes('cannot block') && ability.includes('cannot be blocked')) {
                sourceCard.cannotBlock = true;
                sourceCard.cannotBeBlocked = true;
            }

            // Lolly - Die rolls get +1 for each damage taken
            if (ability.includes('die rolls get +1 for each damage') && ability.includes('taken')) {
                const damageTaken = (sourceCard.endurance || 0) - (sourceCard.currentEndurance || sourceCard.endurance || 0);
                if (damageTaken > 0) {
                    sourceCard.auraDieRollBonus = (sourceCard.auraDieRollBonus || 0) + damageTaken;
                }
            }
        });

        // Also reset opponent aura penalties
        opponent.field.forEach(card => {
            card.auraDieRollPenalty = 0;
        });

        // Re-apply opponent debuffs from this player's cards
        player.field.forEach(sourceCard => {
            if (sourceCard.abilitiesDisabled) return;
            const ability = sourceCard.ability?.toLowerCase() || '';

            if (ability.includes('-1 to all opponent') && ability.includes('attack')) {
                opponent.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDieRollPenalty = (card.auraDieRollPenalty || 0) - 1;
                    }
                });
            }

            // Re-apply Authoritarian Parent penalty
            if (ability.includes('opponent\'s pupils get -1 to die rolls') && ability.includes('in play')) {
                opponent.field.forEach(card => {
                    if (card.type?.includes('Pupil')) {
                        card.auraDieRollPenalty = (card.auraDieRollPenalty || 0) - 1;
                    }
                });
            }
        });

        this.emitEvent('aurasRecalculated', { player: playerNum });
    }

    /**
     * Activate a card's spend ability
     */
    activateAbility(playerNum, instanceId, target = null) {
        const player = this.state.players[playerNum];
        const card = player.field.find(c => c.instanceId === instanceId);

        if (!card) {
            return { success: false, error: 'Card not on field' };
        }

        if (card.isSpent) {
            return { success: false, error: 'Card is already spent' };
        }

        // Pupils with Getting Bearings can't use spend abilities (summoning sickness)
        if (card.hasGettingBearings && card.type?.includes('Pupil') && !card.hasImpulsive) {
            return { success: false, error: 'Has Getting Bearings - wait a turn' };
        }

        // "Spend:" and "Spend, <extra cost>:" (Rex, Pen) are both spend abilities
        const hasSpend = /\bspend\s*[:,]/.test(card.ability?.toLowerCase() || '');
        if (!hasSpend) {
            return { success: false, error: 'Card has no Spend ability' };
        }

        const ability = card.ability.toLowerCase();

        // Parse and execute the spend ability
        const result = this.executeSpendAbility(playerNum, card, ability, target);

        if (result.needsTarget && !target) {
            // Return info about what target is needed
            return { success: false, needsTarget: true, targetType: result.targetType, card, ability: result };
        }

        card.isSpent = true;

        // Spend abilities deal damage (Pencil, Illustration, Anarchist...) - resolve deaths
        this.checkStateBasedActions();

        this.emitEvent('abilityActivated', { player: playerNum, card, result });
        return { success: true, card, result };
    }

    /**
     * Execute a spend ability with optional target
     */
    executeSpendAbility(playerNum, card, ability, target) {
        const player = this.state.players[playerNum];
        const opponent = this.getOpponent(playerNum);

        // Counselor (id 87) - Target pupil recovers 2 Endurance
        if (ability.includes('recovers') && ability.includes('endurance')) {
            const match = ability.match(/recovers?\s*(\d+)\s*endurance/i);
            const amount = match ? parseInt(match[1]) : 2;
            if (target) {
                target.currentEndurance = Math.min(
                    (target.baseEndurance || target.endurance) + (target.auraEnduranceBonus || 0),
                    target.currentEndurance + amount
                );
                this.emitEvent('enduranceRecovered', { card: target, amount });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'heal', amount };
        }

        // Classic Nerd (id 98) - Spend/Ready target pupil
        if (ability.includes('spend/ready') || (ability.includes('spend') && ability.includes('ready') && ability.includes('target'))) {
            if (target) {
                target.isSpent = !target.isSpent;
                this.emitEvent('cardToggled', { card: target, isSpent: target.isSpent });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'toggleSpent' };
        }

        // Statistics Enthusiast (id 97) - Reroll any die
        if (ability.includes('reroll')) {
            // This sets a flag that the player can use a reroll
            player.canReroll = true;
            this.emitEvent('rerollAvailable', { player: playerNum });
            return { success: true, effect: 'rerollEnabled' };
        }

        // Number Theory Enthusiast (id 106) - Create 1/1 token
        if (ability.includes('create') && ability.includes('1/1')) {
            const token = {
                id: 9999,
                instanceId: `token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: 'Average Joe',
                type: 'Basic Pupil',
                subTypes: 'Token',
                cost: '(0)',
                dice: '1d4',
                ad: 1,
                endurance: 1,
                baseEndurance: 1,
                currentEndurance: 1,
                ability: null,
                hasGettingBearings: true,
                isSpent: false,
                counters: { plusOne: 0 },
                tempBuffs: [],
                dieRollBonus: 0,
                damageReduction: 0,
                protection: [],
                isToken: true
            };
            player.field.push(token);
            this.recalculateAuras(playerNum);
            this.emitEvent('tokenCreated', { player: playerNum, token });
            return { success: true, token };
        }

        // Receptionist (id 111) - Give protection from color
        if (ability.includes('protection from') && ability.includes('color')) {
            if (target) {
                // This would need UI to select a color
                return { needsColorChoice: true, target, effect: 'giveProtection' };
            }
            return { needsTarget: true, targetType: 'friendlyPupil', effect: 'giveProtection' };
        }

        // Calculator (id 116) - +1 die roll, if 6+ draw
        if (ability.includes('die rolls') && ability.includes('+1')) {
            if (target) {
                target.dieRollBonus += 1;
                target.tempBuffs.push({ type: 'dieRollBonus', value: 1, expiresAt: 'endOfTurn' });
                // The "if 6+ draw" is checked during combat resolution
                target.calculatorBonus = true;
                this.emitEvent('dieRollBonusApplied', { card: target, bonus: 1 });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'friendlyPupil', effect: 'dieRollBonus' };
        }

        // Drafting Table (id 260) - Prevent 2 damage
        if (ability.includes('prevent') && ability.includes('damage') && ability.includes('target')) {
            const match = ability.match(/prevent.*?(\d+)\s*damage/);
            const amount = match ? parseInt(match[1]) : 2;
            if (target) {
                target.tempBuffs.push({ type: 'damagePrevent', amount, expiresAt: 'endOfTurn' });
                this.emitEvent('damagePreventionApplied', { card: target, amount });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'friendlyPupil', effect: 'damagePrevent', amount };
        }

        // Game Theory Enthusiast (id 107) - If Support, spend for any resource
        if (ability.includes('spend for any resource')) {
            // Check if in support position (blocking)
            // For now, just add a wildcard resource
            player.resources.push({
                color: 'C',
                spent: false,
                isWildcard: true,
                id: `wildcard-${Date.now()}`,
                cardName: 'Wildcard'
            });
            this.emitEvent('wildcardResourceAdded', { player: playerNum });
            return { success: true };
        }

        // === BLACK (Bk) SPEND ABILITIES ===

        // Librarian (id 88) - Draw a card, then discard a card
        if (ability.includes('draw a card') && ability.includes('discard a card') && ability.includes('spend:')) {
            if (player.deck.length > 0) {
                player.hand.push(player.deck.shift());
            }
            this.emitEvent('needDiscard', {
                player: playerNum,
                card: card,
                count: 1,
                reason: 'Librarian'
            });
            return { success: true, needsDiscard: true };
        }

        // The Server Fanatic (id 131) - Spend/Ready target pupil (same as Classic Nerd)
        // Already handled above

        // Electronics Enthusiast (id 125) - Prevent a pupil from entering
        if (ability.includes('prevent') && ability.includes('from entering')) {
            player.preventNextEntry = true;
            this.emitEvent('entryPrevented', { player: playerNum });
            return { success: true };
        }

        // Robotics Professor (id 134) - Ready target Tool
        if (ability.includes('ready target tool')) {
            if (target && target.type === 'Tool') {
                target.isSpent = false;
                this.emitEvent('toolReadied', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'friendlyTool', effect: 'readyTool' };
        }

        // Robotics Club Captain (id 249) - Ready target Tool (same as above)

        // Battery (id 142) - Put charge counter OR remove to gain resource
        if (ability.includes('charge counter')) {
            if (ability.includes('put') && ability.includes('on battery')) {
                card.counters = card.counters || {};
                card.counters.charge = (card.counters.charge || 0) + 1;
                this.emitEvent('counterAdded', { card, counterType: 'charge', count: card.counters.charge });
                return { success: true };
            }
            if (ability.includes('remove') && ability.includes('gain resource')) {
                if (card.counters?.charge > 0) {
                    card.counters.charge--;
                    // Need to choose a color
                    this.emitEvent('needColorChoice', {
                        player: playerNum,
                        card: card,
                        effect: 'gainResource'
                    });
                    return { success: true, needsColorChoice: true };
                }
                return { success: false, error: 'No charge counters' };
            }
        }

        // Journal (id 195) - Look at top 3, put 1 in hand, rest on bottom
        if (ability.includes('look at the top') && ability.includes('put one in your hand') && ability.includes('rest on bottom')) {
            const topCards = player.deck.slice(0, 3);
            this.emitEvent('spendChooseFromTop', {
                player: playerNum,
                card: card,
                topCards: topCards,
                choose: 1,
                putRestOnBottom: true
            });
            return { success: true, needsChoice: true };
        }

        // Synthesizer (id 259) - Target +2 die rolls OR draw then discard
        if (ability.includes('+2 to die rolls')) {
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) + 2;
                target.tempBuffs.push({ type: 'dieRollBonus', value: 2, expiresAt: 'endOfTurn' });
                this.emitEvent('dieRollBonusApplied', { card: target, bonus: 2 });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'dieRollBonus', amount: 2 };
        }

        // Gene Sequencer (id 261) - Put -1/-1 counter on target
        if (ability.includes('-1/-1 counter')) {
            if (target) {
                target.counters = target.counters || { plusOne: 0 };
                target.counters.minusOne = (target.counters.minusOne || 0) + 1;
                // Apply the stat reduction
                target.currentEndurance = Math.max(1, target.currentEndurance - 1);
                this.emitEvent('counterAdded', { card: target, counterType: 'minusOne' });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'minusCounter' };
        }

        // === PURPLE (P) SPEND ABILITIES ===

        // The Anarchist (id 76) - Spend: Fights target pupil
        if (ability.includes('spend:') && ability.includes('fights target')) {
            if (target && target.type?.includes('Pupil')) {
                // Both roll dice and deal damage to each other
                const anarchistRoll = this.rollAttackDice(card);
                const targetRoll = this.rollDice(target.dice);
                card.currentEndurance -= targetRoll;
                target.currentEndurance -= anarchistRoll;
                this.emitEvent('fightResolved', {
                    attacker: card,
                    defender: target,
                    attackerRoll: anarchistRoll,
                    defenderRoll: targetRoll
                });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'fight' };
        }

        // Musician (id 77) - Spend: -1 to opponent die rolls OR +1 to your die rolls
        if (ability.includes('spend:') && ability.includes('-1 to opponent')) {
            opponent.field.forEach(p => {
                if (p.type?.includes('Pupil')) {
                    p.tempBuffs = p.tempBuffs || [];
                    p.tempBuffs.push({ type: 'dieRollPenalty', value: -1, expiresAt: 'endOfTurn' });
                    p.dieRollBonus = (p.dieRollBonus || 0) - 1;
                }
            });
            this.emitEvent('musicianDebuff', { player: playerNum });
            return { success: true };
        }

        if (ability.includes('spend:') && ability.includes('+1 to your die rolls')) {
            player.field.forEach(p => {
                if (p.type?.includes('Pupil')) {
                    p.tempBuffs = p.tempBuffs || [];
                    p.tempBuffs.push({ type: 'dieRollBonus', value: 1, expiresAt: 'endOfTurn' });
                    p.dieRollBonus = (p.dieRollBonus || 0) + 1;
                }
            });
            this.emitEvent('musicianBuff', { player: playerNum });
            return { success: true };
        }

        // Pottery Teacher (id 83) - Spend: Move up to 2 Endurance from one pupil to another
        if (ability.includes('spend:') && ability.includes('move') && ability.includes('endurance')) {
            // This needs two targets - source and destination
            this.emitEvent('needTwoTargets', {
                player: playerNum,
                card: card,
                effect: 'transferEndurance',
                amount: 2
            });
            return { success: true, needsTwoTargets: true };
        }

        // Illustration (id 194) - Spend: Deal 1 damage to target pupil
        if (ability.includes('spend:') && ability.includes('deal') && ability.includes('damage to target')) {
            const match = ability.match(/deal\s*(\d+)\s*damage/);
            const damage = match ? parseInt(match[1]) : 1;
            if (target) {
                target.currentEndurance -= damage;
                this.emitEvent('illustrationDamage', { target, damage });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'dealDamage', amount: damage };
        }

        // === GREEN (G) SPEND ABILITIES ===

        // Botany Enthusiast (id 44) - Spend: Create 1 resource of any color
        if (ability.includes('spend:') && ability.includes('create') && ability.includes('resource of any color')) {
            this.emitEvent('needColorChoice', {
                player: playerNum,
                card: card,
                effect: 'createResource'
            });
            return { success: true, needsColorChoice: true };
        }

        // Psychology Enthusiast (id 47) - Spend: Target pupil fights another target pupil
        if (ability.includes('spend:') && ability.includes('target pupil fights another')) {
            this.emitEvent('needTwoTargets', {
                player: playerNum,
                card: card,
                effect: 'fight',
                targetType: 'anyPupil'
            });
            return { success: true, needsTwoTargets: true };
        }

        // Geology Enthusiast (id 51) - Put +1/+1 on self
        if (ability.includes('+d1/+e1') || (ability.includes('put') && ability.includes('+1') && ability.includes('on') && ability.includes('enthusiast'))) {
            card.counters = card.counters || { plusOne: 0 };
            card.counters.plusOne++;
            card.currentEndurance++;
            this.emitEvent('counterAdded', { card, counterType: 'plusOne', count: card.counters.plusOne });
            return { success: true };
        }

        // Psychology Teacher (id 59) - Spend: Target opponent's pupil cannot attack/block until next turn
        if (ability.includes('spend:') && ability.includes('cannot attack or block') && ability.includes('until')) {
            if (target) {
                target.cannotAttack = true;
                target.cannotBlock = true;
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'manipulation', expiresAt: 'nextTurn', owner: playerNum });
                this.emitEvent('manipulationApplied', { card: target, controller: playerNum });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'enemyPupil', effect: 'manipulation' };
        }

        // Chemistry Enthusiast (id 43) - Send home: Counter target ability
        if (ability.includes('send') && ability.includes('home') && ability.includes('counter target ability')) {
            // This is a sacrifice ability
            this.emitEvent('sacrificeToCounter', {
                player: playerNum,
                card: card,
                effect: 'counterAbility'
            });
            return { success: true, needsSacrifice: true };
        }

        // === COLORLESS (C) SPEND ABILITIES ===

        // Raven (Class Pet) - Spend: Target pupil recovers 1 Endurance
        if (ability.includes('spend:') && ability.includes('target pupil recovers') && ability.includes('endurance')) {
            const match = ability.match(/recovers?\s*(\d+)\s*endurance/);
            const amount = match ? parseInt(match[1]) : 1;
            if (target) {
                target.currentEndurance = Math.min(target.endurance, (target.currentEndurance || target.endurance) + amount);
                this.emitEvent('enduranceRecovered', { card: target, amount });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'recover' };
        }

        // Remy (Class Pet) - Spend: Add one colorless resource until end of turn
        if (ability.includes('spend:') && ability.includes('add one colorless resource')) {
            player.tempResources = player.tempResources || [];
            player.tempResources.push({ color: 'C', expiresAt: 'endOfTurn' });
            this.emitEvent('tempResourceAdded', { player: playerNum, color: 'C' });
            return { success: true };
        }

        // Princess (Class Pet) - Spend: Add a cute counter. Spend, remove cute counter: Score 1 point.
        if (ability.includes('add a cute counter')) {
            card.counters = card.counters || { cute: 0 };
            card.counters.cute = (card.counters.cute || 0) + 1;
            this.emitEvent('counterAdded', { card, counterType: 'cute', count: card.counters.cute });
            return { success: true };
        }
        if (ability.includes('remove cute counter') && ability.includes('score')) {
            if (card.counters?.cute > 0) {
                card.counters.cute--;
                player.points++;
                this.emitEvent('pointScored', { player: playerNum, card, source: 'Princess' });
                this.checkWinCondition();
                return { success: true };
            }
            return { success: false, error: 'No cute counters to remove' };
        }

        // Whiskers (Class Pet) - Spend: Target pupil you control attacks first this turn
        if (ability.includes('spend:') && ability.includes('attacks first this turn')) {
            if (target) {
                target.hasFirstStrike = true;
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'firstStrike', expiresAt: 'endOfTurn' });
                this.emitEvent('firstStrikeGranted', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'friendlyPupil', effect: 'firstStrike' };
        }

        // Rex (Class Pet) - Spend, pay (1): Rex recovers 2 Endurance
        if (ability.includes('spend, pay') && ability.includes('recovers') && ability.includes('endurance')) {
            const costMatch = ability.match(/pay\s*\((\d+)\)/);
            const cost = costMatch ? parseInt(costMatch[1]) : 1;
            const amountMatch = ability.match(/recovers?\s*(\d+)\s*endurance/);
            const amount = amountMatch ? parseInt(amountMatch[1]) : 2;

            const availableResources = player.resources.filter(r => !r.spent);
            if (availableResources.length >= cost) {
                for (let i = 0; i < cost; i++) {
                    availableResources[i].spent = true;
                }
                card.currentEndurance = Math.min(card.endurance, (card.currentEndurance || card.endurance) + amount);
                this.emitEvent('selfRecovery', { card, amount });
                return { success: true };
            }
            return { success: false, error: `Need ${cost} resources to activate` };
        }

        // Gold Coin (Tool) - Spend: Send Gold Coin home. Gain a resource of any color.
        if (ability.includes('spend:') && ability.includes('send') && ability.includes('home') && ability.includes('gain a resource of any color')) {
            this.emitEvent('needColorChoice', {
                player: playerNum,
                card: card,
                effect: 'goldCoin'
            });
            return { success: true, needsColorChoice: true, sendHome: true };
        }

        // Bell (Tool) - Spend: Target pupil gets +1 to die rolls until end of turn
        if (ability.includes('spend:') && ability.includes('target pupil gets +1 to die rolls')) {
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) + 1;
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'dieRollBonus', value: 1, expiresAt: 'endOfTurn' });
                this.emitEvent('dieRollBonusGranted', { card: target, amount: 1 });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'dieRollBonus' };
        }

        // Ribbon (Tool) - Spend: Target pupil gets +1 to die rolls. If that pupil scores, draw a card.
        if (ability.includes('spend:') && ability.includes('+1 to die rolls') && ability.includes('if that pupil scores, draw')) {
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) + 1;
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'dieRollBonus', value: 1, expiresAt: 'endOfTurn' });
                target.ribbonBonusActive = true;
                this.emitEvent('ribbonApplied', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'ribbonBonus' };
        }

        // Pencil (Tool) - Spend: Target pupil gets +2/-1 until end of turn
        if (ability.includes('spend:') && ability.includes('+2/-1')) {
            if (target) {
                target.dieRollBonus = (target.dieRollBonus || 0) + 2;
                target.currentEndurance = Math.max(0, (target.currentEndurance || target.endurance) - 1);
                target.tempBuffs = target.tempBuffs || [];
                target.tempBuffs.push({ type: 'dieRollBonus', value: 2, expiresAt: 'endOfTurn' });
                this.emitEvent('pencilApplied', { card: target });
                return { success: true };
            }
            return { needsTarget: true, targetType: 'anyPupil', effect: 'pencil' };
        }

        // Pen (Tool) - Spend, send Pen home: Draw 2 cards
        if (ability.includes('spend') && ability.includes('send') && ability.includes('home') && ability.includes('draw 2 cards')) {
            // Remove Pen from field
            const idx = player.field.findIndex(c => c.instanceId === card.instanceId);
            if (idx !== -1) {
                player.field.splice(idx, 1);
                player.discard.push(card);
            }
            // Draw 2 cards
            for (let i = 0; i < 2; i++) {
                if (player.deck.length > 0) {
                    player.hand.push(player.deck.shift());
                }
            }
            this.emitEvent('penActivated', { player: playerNum });
            return { success: true };
        }

        // Multicolor Marker (Tool) - Spend: Change target resource to produce any color
        if (ability.includes('spend:') && ability.includes('change target resource') && ability.includes('any color')) {
            this.emitEvent('markerNeedsResourceAndColor', {
                player: playerNum,
                card: card
            });
            return { success: true, needsResourceAndColor: true };
        }

        // Recruiter - Spend: Send Home, then Search for a basic pupil and put it into play spent
        if (ability.includes('spend:') && ability.includes('send home') && ability.includes('search for a basic pupil')) {
            // Remove Recruiter from field
            const idx = player.field.findIndex(c => c.instanceId === card.instanceId);
            if (idx !== -1) {
                player.field.splice(idx, 1);
                player.discard.push(card);
            }
            this.emitEvent('recruiterSearch', {
                player: playerNum,
                card: card,
                searchType: 'basicPupil'
            });
            return { success: true, needsSearch: true };
        }

        // Obie (Class Pet) - Send Obie home: Opponent cannot play any cards this turn
        if (ability.includes('send') && ability.includes('home') && ability.includes('opponent cannot play any cards')) {
            // Remove Obie from field (sacrifice)
            const idx = player.field.findIndex(c => c.instanceId === card.instanceId);
            if (idx !== -1) {
                player.field.splice(idx, 1);
                player.discard.push(card);
            }
            // Lock opponent from playing cards this turn
            opponent.cannotPlayCards = true;
            opponent.lockExpiresAt = 'endOfTurn';
            this.emitEvent('obieLock', { player: playerNum });
            return { success: true };
        }

        // Scare-E-Crow (Class Pet) - Pay (3): Flip a coin. Heads: target opponent skips their next turn.
        if (ability.includes('pay') && ability.includes('flip a coin') && ability.includes('skip')) {
            const costMatch = ability.match(/pay\s*\((\d+)\)/);
            const cost = costMatch ? parseInt(costMatch[1]) : 3;
            const availableResources = player.resources.filter(r => !r.spent);
            if (availableResources.length >= cost) {
                for (let i = 0; i < cost; i++) {
                    availableResources[i].spent = true;
                }
                // Flip a coin (50/50)
                const heads = Math.random() < 0.5;
                if (heads) {
                    opponent.skipNextTurn = true;
                    this.emitEvent('scarecrowSuccess', { player: playerNum, heads: true });
                } else {
                    this.emitEvent('scarecrowFail', { player: playerNum, heads: false });
                }
                return { success: true, coinFlip: heads };
            }
            return { success: false, error: `Need ${cost} resources to activate` };
        }

        return { success: true };
    }

    /**
     * Give protection from a specific color to a card
     */
    giveProtection(card, color) {
        if (!card.protection) card.protection = [];
        if (!card.protection.includes(color)) {
            card.protection.push(color);
        }
        card.tempBuffs.push({ type: 'protection', color, expiresAt: 'endOfTurn' });
        this.emitEvent('protectionGranted', { card, color });
    }

    // ==========================================
    // Combat
    // ==========================================

    /**
     * Enter combat phase
     */
    startCombat(playerNum) {
        if (this.state.currentPlayer !== playerNum) {
            return { success: false, error: 'Not your turn' };
        }

        this.state.phase = 'combat';
        this.state.combatStep = 'declare-attackers';
        this.state.attackers = [];
        this.state.blockers = {};

        this.emitEvent('combatStarted', { player: playerNum });
        return { success: true };
    }

    /**
     * Toggle attacker
     */
    toggleAttacker(playerNum, instanceId) {
        if (this.state.combatStep !== 'declare-attackers') {
            return { success: false, error: 'Not in attacker declaration' };
        }

        const player = this.state.players[playerNum];
        const card = player.field.find(c => c.instanceId === instanceId);

        if (!card) {
            return { success: false, error: 'Card not found' };
        }

        if (!card.type?.includes('Pupil')) {
            return { success: false, error: 'Only pupils can attack' };
        }

        if (card.hasGettingBearings && !card.hasImpulsive) {
            return { success: false, error: 'Card has Getting Bearings' };
        }

        // Grounded - cannot attack
        const isGrounded = card.ability?.toLowerCase().includes('grounded');
        if (isGrounded && !card.abilitiesDisabled) {
            return { success: false, error: 'Card is Grounded and cannot attack' };
        }

        // Cannot Attack text (e.g., The Loner)
        const cannotAttack = card.ability?.toLowerCase().includes('cannot attack');
        if (cannotAttack && !card.abilitiesDisabled) {
            return { success: false, error: 'This card cannot attack' };
        }

        // Locked down by Resource Officer
        if (card.cannotAttack) {
            return { success: false, error: 'Card is locked down and cannot attack' };
        }

        const isRelentless = card.ability?.toLowerCase().includes('relentless');
        if (card.isSpent && !isRelentless) {
            return { success: false, error: 'Card is spent' };
        }

        const idx = this.state.attackers.findIndex(a => a.instanceId === instanceId);
        if (idx !== -1) {
            this.state.attackers.splice(idx, 1);
        } else {
            this.state.attackers.push(card);
        }

        this.emitEvent('attackerToggled', { card, attacking: idx === -1 });
        return { success: true };
    }

    /**
     * Confirm attackers and move to blocker step
     */
    confirmAttackers(playerNum) {
        if (this.state.combatStep !== 'declare-attackers') {
            return { success: false, error: 'Not in attacker declaration' };
        }

        // Spend attackers (except relentless)
        const player = this.state.players[playerNum];
        this.state.attackers.forEach(att => {
            const card = player.field.find(c => c.instanceId === att.instanceId);
            if (card) {
                const isRelentless = att.ability?.toLowerCase().includes('relentless') || card.tempRelentless;
                if (!isRelentless) card.isSpent = true;
            }
        });

        if (this.state.attackers.length === 0) {
            // No attackers, skip to end
            this.state.combatStep = null;
            this.state.phase = 'end';
            this.emitEvent('combatSkipped', {});
            return { success: true, skipped: true };
        }

        // === ATTACK TRIGGERS ===

        // The Techno (id 124) - When he attacks, other attacking pupils get +1 to die rolls
        // Singer (id 67) - When Singer attacks, other attacking pupils get +1 to die rolls
        this.state.attackers.forEach(att => {
            const ability = att.ability?.toLowerCase() || '';
            if (ability.includes('when') && ability.includes('attacks') && ability.includes('other attacking') && ability.includes('+1')) {
                this.state.attackers.forEach(otherAtt => {
                    if (otherAtt.instanceId !== att.instanceId) {
                        const otherCard = player.field.find(c => c.instanceId === otherAtt.instanceId);
                        if (otherCard) {
                            otherCard.tempBuffs = otherCard.tempBuffs || [];
                            otherCard.tempBuffs.push({ type: 'dieRollBonus', value: 1, expiresAt: 'endOfCombat' });
                            otherCard.dieRollBonus = (otherCard.dieRollBonus || 0) + 1;
                        }
                    }
                });
                this.emitEvent('attackBonus', { card: att, bonus: 1 });
            }
        });

        // Arts and Crafts Teacher Alicia (id 90) - When attacks, flip coin: heads = endurance damage
        this.state.attackers.forEach(att => {
            const ability = att.ability?.toLowerCase() || '';
            if (ability.includes('when') && ability.includes('attacks') && ability.includes('flip a coin') && ability.includes('endurance')) {
                const isHeads = Math.random() < 0.5;
                if (isHeads) {
                    att.useEnduranceAsDamage = true;
                    this.emitEvent('aliciaHeads', { card: att, damage: att.currentEndurance });
                } else {
                    this.emitEvent('aliciaTails', { card: att });
                }
            }
        });

        // === ORANGE (O) ATTACK TRIGGERS ===

        // The Journeyman (id 12) - Apprenticeship: When attacks, may put +1/+1 counter on another pupil
        this.state.attackers.forEach(att => {
            const ability = att.ability?.toLowerCase() || '';
            if (ability.includes('apprenticeship') || (ability.includes('when') && ability.includes('attacks') && ability.includes('+1/+1 counter on another'))) {
                this.emitEvent('apprenticeshipTrigger', {
                    player: playerNum,
                    card: att,
                    effect: 'plusOneCounter'
                });
            }
        });

        // The Tool (id 11) / Must be blocked - Mark attackers that must be blocked
        this.state.attackers.forEach(att => {
            const ability = att.ability?.toLowerCase() || '';
            if (ability.includes('must be') && (ability.includes('blocked') || ability.includes('defended'))) {
                att.mustBeBlocked = true;
            }
        });

        this.state.combatStep = 'declare-blockers';
        this.emitEvent('attackersDeclared', { attackers: this.state.attackers });
        return { success: true };
    }

    /**
     * Toggle blocker assignment
     */
    toggleBlocker(defenderNum, blockerInstanceId, attackerInstanceId) {
        if (this.state.combatStep !== 'declare-blockers') {
            return { success: false, error: 'Not in blocker declaration' };
        }

        const defender = this.state.players[defenderNum];
        const blocker = defender.field.find(c => c.instanceId === blockerInstanceId);
        const attackingCard = this.state.attackers.find(a => a.instanceId === attackerInstanceId);

        if (!blocker) {
            return { success: false, error: 'Blocker not found' };
        }

        if (!blocker.type?.includes('Pupil')) {
            return { success: false, error: 'Only pupils can block' };
        }

        if (blocker.isSpent) {
            return { success: false, error: 'Blocker is spent' };
        }

        // Flags set by Uninvolved Parent, Manipulation, Permeability, Selfie Girl,
        // Influencer... were written and never checked here.
        if (blocker.cannotBlock) {
            return { success: false, error: `${blocker.name} cannot block` };
        }
        if (attackingCard && (attackingCard.cannotBeBlocked || attackingCard.isUnblockable)) {
            return { success: false, error: `${attackingCard.name} cannot be blocked` };
        }

        // Check The Tool (id 11) - Must be blocked if possible
        // This is a UI hint, not enforced here

        // Check if already blocking something
        const existing = Object.entries(this.state.blockers).find(([_, bId]) => bId === blockerInstanceId);
        if (existing) {
            delete this.state.blockers[existing[0]];
        } else {
            this.state.blockers[attackerInstanceId] = blockerInstanceId;
        }

        this.emitEvent('blockerToggled', { blocker, attackerId: attackerInstanceId });
        return { success: true };
    }

    /**
     * Confirm blockers and resolve combat
     */
    confirmBlockers() {
        if (this.state.combatStep !== 'declare-blockers') {
            return { success: false, error: 'Not in blocker declaration' };
        }

        return this.resolveCombat();
    }

    /**
     * Resolve combat damage
     */
    resolveCombat() {
        const attackingPlayer = this.state.currentPlayer;
        const defendingPlayer = attackingPlayer === 1 ? 2 : 1;

        const attacker = this.state.players[attackingPlayer];
        const defender = this.state.players[defendingPlayer];

        let pointsScored = 0;
        let defenderPointsLost = 0;
        const combatLog = [];

        // Check Authoritative Principal Jordan - opponent loses 1 point per attacker
        defender.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';
            if (ability.includes('opponent loses') && ability.includes('point') && ability.includes('attack')) {
                const match = ability.match(/loses?\s*(\d+)\s*point/);
                const pointsPerAttacker = match ? parseInt(match[1]) : 1;
                defenderPointsLost += this.state.attackers.length * pointsPerAttacker;
            }
        });

        this.state.attackers.forEach(att => {
            const attCard = attacker.field.find(c => c.instanceId === att.instanceId);
            if (!attCard) return; // Card might have been removed

            // Calculate attack roll with bonuses
            let roll = this.rollAttackDice(attCard);

            // Arts and Crafts Teacher Alicia - use endurance as damage if coin was heads
            if (attCard.useEnduranceAsDamage) {
                roll = attCard.currentEndurance + (attCard.auraEnduranceBonus || 0);
                delete attCard.useEnduranceAsDamage;
            }

            const blockerId = this.state.blockers[att.instanceId];

            if (blockerId) {
                const blocker = defender.field.find(c => c.instanceId === blockerId);
                if (blocker) {
                    let blockerRoll = this.rollDice(blocker.dice);
                    if (blocker.hasAdvantage) {
                        blockerRoll = Math.max(blockerRoll, this.rollDice(blocker.dice));
                    }
                    // Same modifiers the attacker gets; never below zero (a negative roll
                    // used to inflate the attacker's damage-prevention buffs)
                    blockerRoll += (blocker.dieRollBonus || 0)
                        + (blocker.auraDieRollBonus || 0) + (blocker.auraDieRollPenalty || 0)
                        + (blocker.counters?.plusOne || 0) + (blocker.auraDamageBonus || 0);
                    blockerRoll = Math.max(0, blockerRoll);

                    const logEntry = {
                        attacker: att.name,
                        attackRoll: roll,
                        blocker: blocker.name,
                        blockerRoll: blockerRoll
                    };

                    // Calculate damage with reductions
                    let damageToBlocker = roll;
                    let damageToAttacker = blockerRoll;

                    // Protection from a color: no damage from cards of that color
                    // (hasProtectionFrom existed but nothing called it)
                    const attColors = this.getAllColors(attCard.cost);
                    const blkColors = this.getAllColors(blocker.cost);
                    if (attColors.some(c => this.hasProtectionFrom(blocker, c))) {
                        damageToBlocker = 0;
                        logEntry.blockerProtected = true;
                    }
                    if (blkColors.some(c => this.hasProtectionFrom(attCard, c))) {
                        damageToAttacker = 0;
                        logEntry.attackerProtected = true;
                    }

                    // Drama Queen (id 78) - First Strike: deals damage before combat
                    const hasFirstStrike = attCard.ability?.toLowerCase().includes('damage first') ||
                        attCard.ability?.toLowerCase().includes('first strike') ||
                        attCard.hasFirstStrike === true;   // granted by Snail's ability
                    if (hasFirstStrike && !attCard.abilitiesDisabled) {
                        // Apply attacker damage first
                        blocker.currentEndurance -= damageToBlocker;
                        logEntry.firstStrike = true;
                        // If blocker dies from first strike, no damage back
                        if (blocker.currentEndurance <= 0) {
                            damageToAttacker = 0;
                            logEntry.firstStrikeKill = true;
                        }
                        damageToBlocker = 0; // Already applied
                    }

                    // Apply damage reduction from auras and abilities
                    const blockerReduction = this.calculateDamageReduction(blocker);
                    const attackerReduction = this.calculateDamageReduction(attCard);

                    // Geometry Teacher (id 108) - Takes 4 less damage
                    if (blocker.ability?.toLowerCase().includes('takes') && blocker.ability?.toLowerCase().includes('less damage')) {
                        const match = blocker.ability.match(/(\d+)\s*less damage/);
                        const selfReduction = match ? parseInt(match[1]) : 4;
                        damageToBlocker = Math.max(0, damageToBlocker - selfReduction);
                        logEntry.blockerReduction = selfReduction;
                    }

                    // Apply temp damage prevention
                    const blockerPrevention = this.consumeDamagePrevention(blocker, damageToBlocker);
                    damageToBlocker = Math.max(0, damageToBlocker - blockerPrevention);

                    const attackerPrevention = this.consumeDamagePrevention(attCard, damageToAttacker);
                    damageToAttacker = Math.max(0, damageToAttacker - attackerPrevention);

                    // Apply aura damage reduction
                    damageToBlocker = Math.max(0, damageToBlocker - blockerReduction);
                    damageToAttacker = Math.max(0, damageToAttacker - attackerReduction);

                    // Check Lethal - any damage exhausts
                    const hasLethal = attCard.ability?.toLowerCase().includes('lethal') ||
                        attCard.tempLethal === true;      // granted by Cement
                    if (hasLethal && damageToBlocker > 0) {
                        blocker.isSpent = true;
                        logEntry.lethal = true;
                    }

                    // Check Rebuttal - damage back to attacker
                    const rebuttalMatch = blocker.ability?.match(/rebuttal\s*(\d+)?/i);
                    if (rebuttalMatch && damageToBlocker > 0 && !blocker.abilitiesDisabled) {
                        const rebuttalDamage = rebuttalMatch[1] ? parseInt(rebuttalMatch[1]) : damageToBlocker;
                        damageToAttacker += rebuttalDamage;
                        logEntry.rebuttal = rebuttalDamage;
                    }

                    // Apply damage
                    blocker.currentEndurance -= damageToBlocker;

                    // Stubborn - cannot be exhausted by damage
                    const hasStubborn = attCard.ability?.toLowerCase().includes('stubborn');
                    if (!hasStubborn) {
                        attCard.currentEndurance -= damageToAttacker;
                    } else {
                        logEntry.stubborn = true;
                    }

                    logEntry.finalDamageToBlocker = damageToBlocker;
                    logEntry.finalDamageToAttacker = damageToAttacker;
                    combatLog.push(logEntry);

                    // Check Overwhelm / Trample
                    const hasOverwhelm = att.ability?.toLowerCase().includes('overwhelm') ||
                        att.ability?.toLowerCase().includes('over blocker becomes');
                    if (hasOverwhelm && blocker.currentEndurance <= 0) {
                        const excess = Math.abs(blocker.currentEndurance);
                        if (excess > 0) {
                            pointsScored += excess;
                            combatLog[combatLog.length - 1].overwhelm = excess;
                        }
                    }

                    // Physics Enthusiast (id 246) - Draw when exhaust opponent
                    if (blocker.currentEndurance <= 0 || blocker.isSpent) {
                        if (attCard.ability?.toLowerCase().includes('exhausts') && attCard.ability?.toLowerCase().includes('draw')) {
                            if (attacker.deck.length > 0) {
                                attacker.hand.push(attacker.deck.shift());
                                logEntry.drewCard = true;
                            }
                        }
                    }

                    // Latin Professor (id 86) - Rampage: if exhausts defender, damage another or gain points
                    if (blocker.currentEndurance <= 0 && !attCard.abilitiesDisabled) {
                        const attAbility = attCard.ability?.toLowerCase() || '';
                        if (attAbility.includes('rampage') || (attAbility.includes('exhaust') && attAbility.includes('same damage') && attAbility.includes('another'))) {
                            const rampageDamage = logEntry.finalDamageToBlocker || roll;
                            // Find another defending pupil to damage
                            const otherDefenders = defender.field.filter(c =>
                                c.type?.includes('Pupil') && c.instanceId !== blocker.instanceId && c.currentEndurance > 0
                            );
                            if (otherDefenders.length > 0) {
                                // Apply damage to next defender (in simple implementation, first available)
                                const nextTarget = otherDefenders[0];
                                nextTarget.currentEndurance -= rampageDamage;
                                logEntry.rampage = { target: nextTarget.name, damage: rampageDamage };
                                this.emitEvent('rampageDamage', { attacker: attCard, target: nextTarget, damage: rampageDamage });
                            } else {
                                // No more defenders, gain points
                                pointsScored += rampageDamage;
                                logEntry.rampagePoints = rampageDamage;
                            }
                        }
                    }

                    // Calculator bonus - if roll was 6+, draw a card
                    if (attCard.calculatorBonus && roll >= 6) {
                        if (attacker.deck.length > 0) {
                            attacker.hand.push(attacker.deck.shift());
                            logEntry.calculatorDraw = true;
                        }
                        delete attCard.calculatorBonus;
                    }

                    // Digital Artist (id 241) - Draw when deals damage
                    if (damageToBlocker > 0 && !attCard.abilitiesDisabled) {
                        const attAbility = attCard.ability?.toLowerCase() || '';
                        if (attAbility.includes('when') && attAbility.includes('deals damage') && attAbility.includes('draw')) {
                            if (attacker.deck.length > 0) {
                                attacker.hand.push(attacker.deck.shift());
                                logEntry.digitalArtistDraw = true;
                            }
                        }
                    }
                }
            } else {
                // Unblocked - deal points
                pointsScored += roll;
                combatLog.push({ attacker: att.name, attackRoll: roll, unblocked: true, points: roll });

                // Digital Artist (id 241) - Draw when deals damage (unblocked damage counts)
                if (!attCard.abilitiesDisabled) {
                    const attAbility = attCard.ability?.toLowerCase() || '';
                    if (attAbility.includes('when') && attAbility.includes('deals damage') && attAbility.includes('draw')) {
                        if (attacker.deck.length > 0) {
                            attacker.hand.push(attacker.deck.shift());
                            combatLog[combatLog.length - 1].digitalArtistDraw = true;
                        }
                    }
                }

                // Unblocked creature abilities - Shop Teacher recovers full HP
                if (attCard.ability?.toLowerCase().includes('if unblocked') && attCard.ability?.toLowerCase().includes('recover')) {
                    attCard.currentEndurance = attCard.baseEndurance || attCard.endurance;
                }
            }
        });

        // Remove dead pupils and fire their exhaust triggers (once each)
        this.checkStateBasedActions();

        // End-of-combat effects (Chemistry Teacher heal, "+1 until end of combat")
        // ran nowhere before: processEndOfCombat had no caller.
        this.processEndOfCombat(attackingPlayer);

        // Gerbil damage prevention - Prevent 1 damage each time opponent would score a point
        if (pointsScored > 0) {
            defender.field.forEach(card => {
                if (card.abilitiesDisabled) return;
                const ability = card.ability?.toLowerCase() || '';
                if (ability.includes('prevent') && ability.includes('damage') && ability.includes('opponent') && ability.includes('score')) {
                    const match = ability.match(/prevent\s*(\d+)\s*damage/);
                    const preventAmount = match ? parseInt(match[1]) : 1;
                    const actualPrevention = Math.min(pointsScored, preventAmount);
                    pointsScored -= actualPrevention;
                    this.emitEvent('gerbilPrevention', { card, prevented: actualPrevention });
                }
            });
        }

        // Award points
        attacker.points += pointsScored;

        // Handle Jock scoring (die upgrade on point scored)
        if (pointsScored > 0) {
            this.handleJockScoring(attackingPlayer, pointsScored);
            this.triggerOnPointsScored(attackingPlayer, pointsScored);
        }

        // Apply defender point loss (Principal Jordan ability)
        if (defenderPointsLost > 0) {
            defender.points = Math.max(0, defender.points - defenderPointsLost);
            this.emitEvent('pointsLost', { player: defendingPlayer, amount: defenderPointsLost, reason: 'Authoritative Principal' });
        }

        // Check win condition (both players - defender point loss can matter too)
        this.checkWinCondition();

        // Reset combat state
        this.state.combatStep = null;
        this.state.attackers = [];
        this.state.blockers = {};
        this.state.phase = 'end';

        this.emitEvent('combatResolved', { pointsScored, defenderPointsLost, combatLog });
        return { success: true, pointsScored, defenderPointsLost, combatLog };
    }

    /**
     * Check if either player has reached the win condition (25 points)
     */
    checkWinCondition() {
        for (const playerNum of [1, 2]) {
            const player = this.state.players[playerNum];
            if (player && player.points >= this.winCondition) {
                this.state.gameOver = true;
                this.state.winner = playerNum;
                this.emitEvent('gameOver', { winner: playerNum, points: player.points });
                return true;
            }
        }
        return false;
    }

    /**
     * Roll attack dice with all bonuses
     */
    rollAttackDice(card) {
        const ability = card.ability?.toLowerCase() || '';

        // Probability Enthusiast (id 105) - Flip 4 coins
        if (ability.includes('flip') && ability.includes('coin')) {
            const match = ability.match(/flip\s*(\d+)\s*coins?/);
            const numCoins = match ? parseInt(match[1]) : 4;
            let heads = 0;
            for (let i = 0; i < numCoins; i++) {
                if (Math.random() < 0.5) heads++;
            }
            this.emitEvent('coinsFlipped', { card, numCoins, heads });
            return heads + (card.dieRollBonus || 0);
        }

        // Normal dice roll
        let roll = this.rollDice(card.dice);

        // The Lab: roll twice, keep the higher (flag was set and never read)
        if (card.hasAdvantage) {
            roll = Math.max(roll, this.rollDice(card.dice));
        }

        // Add die roll bonus from abilities, buffs, and auras
        roll += (card.dieRollBonus || 0);

        // Add damage bonus from +1/+1 counters and auras
        roll += (card.counters?.plusOne || 0);
        roll += (card.auraDamageBonus || 0);

        // Calculus Enthusiast cumulative bonus
        roll += (card.cumulativeDieBonus || 0);

        // Aura die-roll modifiers (Popular Kid, Music Room, Gym, Authoritarian Parent...)
        // were written by recalculateAuras and never added to any roll
        roll += (card.auraDieRollBonus || 0) + (card.auraDieRollPenalty || 0);

        return Math.max(0, roll);
    }

    /**
     * Calculate total damage reduction for a card
     */
    calculateDamageReduction(card) {
        let reduction = 0;
        reduction += (card.auraDamageReduction || 0);
        reduction += (card.damageReduction || 0);
        return reduction;
    }

    /**
     * Consume damage prevention from temp buffs
     */
    consumeDamagePrevention(card, incomingDamage) {
        let prevented = 0;
        const newBuffs = [];

        for (const buff of (card.tempBuffs || [])) {
            if (buff.type === 'damagePrevent' && buff.amount > 0) {
                const toPrevent = Math.min(buff.amount, incomingDamage - prevented);
                prevented += toPrevent;
                buff.amount -= toPrevent;
                if (buff.amount > 0) {
                    newBuffs.push(buff);
                }
            } else {
                newBuffs.push(buff);
            }
        }

        card.tempBuffs = newBuffs;
        return prevented;
    }

    // ==========================================
    // Turn Management
    // ==========================================

    /**
     * End the current turn
     */
    endTurn(playerNum) {
        if (this.state.currentPlayer !== playerNum) {
            return { success: false, error: 'Not your turn' };
        }

        // Cannot end turn during combat - must resolve combat first
        if (this.state.combatStep) {
            return { success: false, error: 'Must resolve combat before ending turn' };
        }

        const nextPlayer = playerNum === 1 ? 2 : 1;

        // Regen, "until end of turn" buffs on the ending player's own pupils, Overclock
        // damage - processEndOfTurn existed but nothing ever called it
        this.processEndOfTurn(playerNum);

        // Increment turn counter when player 2 ends their turn
        if (playerNum === 2) {
            this.state.turn++;
        }

        this.state.currentPlayer = nextPlayer;
        this.state.phase = 'draw';
        this.state.combatStep = null;
        this.state.attackers = [];
        this.state.blockers = {};
        this.state.selectedCard = null;
        this.state.selectedFieldCard = null;

        // Begin next player's turn
        this.beginTurn(nextPlayer);

        this.emitEvent('turnEnded', { player: playerNum, nextPlayer });
        return { success: true, nextPlayer };
    }

    /**
     * Begin a player's turn (draw, ready, etc.)
     */
    beginTurn(playerNum) {
        const player = this.state.players[playerNum];

        // Clear end-of-turn effects from previous turn
        this.clearExpiredEffects(playerNum);

        // "Cannot attack or block until your next turn" (Psychology Teacher) expires
        // when the controller's next turn begins; it used to be permanent.
        [1, 2].forEach(p => this.state.players[p].field.forEach(card => {
            const buffs = card.tempBuffs || [];
            const expiring = buffs.filter(b => b.expiresAt === 'nextTurn' && b.owner === playerNum);
            if (expiring.length === 0) return;
            card.tempBuffs = buffs.filter(b => !expiring.includes(b));
            if (!card.tempBuffs.some(b => b.type === 'manipulation') && !card.lockedBy) {
                card.cannotAttack = false;
                card.cannotBlock = false;
            }
        }));

        // Draw phase
        let cardsToDraw = 1;

        // Cinematography Instructor, Luke (id 140) - Draw extra card
        player.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';
            if (ability.includes('draw an extra card') && ability.includes('when you would draw')) {
                cardsToDraw++;
            }
        });

        // Draw cards (triggers Confusion Matrix for opponent if applicable)
        this.drawCards(playerNum, cardsToDraw);

        // Ready phase - untap everything (except System Crashed cards)
        player.field.forEach(c => {
            // Check for System Crash effect - skip ready
            if (c.skipNextReady) {
                c.skipNextReady = false;
                // Keep spent
            } else {
                c.isSpent = false;
            }
            c.hasGettingBearings = false;
            c.usedReroll = false;
            c.tempRelentless = false;
        });
        player.resources.forEach(r => r.spent = false);
        player.interruptionPlayed = false;
        player.resourcePlayedThisTurn = false;
        player.canReroll = false;

        // Return temporarily controlled Tools
        player.field.forEach(card => {
            if (card.tempControlledBy && card.originalOwner !== playerNum) {
                // Return to original owner
                const originalOwner = this.state.players[card.originalOwner];
                player.field = player.field.filter(c => c.instanceId !== card.instanceId);
                delete card.tempControlledBy;
                delete card.originalOwner;
                originalOwner.field.push(card);
            }
        });

        // Start of turn triggers
        this.triggerStartOfTurn(playerNum);

        this.state.phase = 'main';

        this.emitEvent('turnStarted', { player: playerNum, handSize: player.hand.length });
    }

    /**
     * Clear effects that expire at end of turn
     */
    clearExpiredEffects(playerNum) {
        const player = this.state.players[playerNum];

        player.field.forEach(card => {
            // Clear temp buffs that expired
            card.tempBuffs = (card.tempBuffs || []).filter(buff => buff.expiresAt !== 'endOfTurn');

            // Reset temporary flags
            card.abilitiesDisabled = false;
            card.maxBlockers = null;
            card.dieRollBonus = 0;
            card.calculatorBonus = false;

            // Reset protection from temp buffs (keep aura protection)
            card.protection = card.auraProtection ? [...card.auraProtection] : [];
        });
    }

    /**
     * Trigger start of turn abilities
     */
    triggerStartOfTurn(playerNum) {
        const player = this.state.players[playerNum];

        player.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';

            // Calculus Enthusiast (id 104) - Cumulative +1 to die rolls
            if (ability.includes('start of your turn') && ability.includes('+1 to die rolls')) {
                card.cumulativeDieBonus = (card.cumulativeDieBonus || 0) + 1;
                this.emitEvent('cumulativeBonusIncreased', { card, bonus: card.cumulativeDieBonus });
            }

            // The Apprentice (id 2) - Generate full HP at end of turn (we do it at start of next)
            if (ability.includes('generates full hp') || ability.includes('full hp at end of turn')) {
                card.currentEndurance = card.baseEndurance || card.endurance;
                this.emitEvent('enduranceRegenerated', { card });
            }

            // Free Spirit (id 79) - During upkeep flip coin: heads gain point, tails lose point
            if (ability.includes('during upkeep') && ability.includes('flip a coin')) {
                const isHeads = Math.random() < 0.5;
                if (isHeads) {
                    player.points += 1;
                    this.emitEvent('freeSpiritHeads', { card, player: playerNum });
                } else {
                    player.points = Math.max(0, player.points - 1);
                    this.emitEvent('freeSpiritTails', { card, player: playerNum });
                }
            }

            // The Counselor's Office (id 94) - May discard to recover 3 Endurance on target
            if (card.type === 'Location' && ability.includes('start of your turn') && ability.includes('discard') && ability.includes('recover')) {
                if (player.hand.length > 0) {
                    this.emitEvent('counselorsOfficePrompt', {
                        player: playerNum,
                        card: card,
                        canActivate: true
                    });
                }
            }

            // === GREEN (G) START OF TURN ABILITIES ===

            // Lunch Lady (id 60) - Nurture: Recover 1 Endurance on each pupil you control
            if (ability.includes('nurture') || (ability.includes('start of your turn') && ability.includes('recover') && ability.includes('each pupil'))) {
                player.field.forEach(p => {
                    if (p.type?.includes('Pupil')) {
                        p.currentEndurance = Math.min(
                            (p.baseEndurance || p.endurance) + (p.auraEnduranceBonus || 0) + (p.counters?.plusOne || 0),
                            p.currentEndurance + 1
                        );
                    }
                });
                this.emitEvent('nurtureHealing', { player: playerNum, card });
            }

            // Gardening Teacher Dan (id 64) - During upkeep add +1/+1 on each other pupil
            if (ability.includes('during your upkeep') && ability.includes('+1') && ability.includes('each other pupil')) {
                player.field.forEach(p => {
                    if (p.type?.includes('Pupil') && p.instanceId !== card.instanceId) {
                        p.counters = p.counters || { plusOne: 0 };
                        p.counters.plusOne++;
                        p.currentEndurance++;
                    }
                });
                this.emitEvent('gardeningBuff', { player: playerNum, card });
            }

            // Discovery Principal Dan (id 63) - Remove timer counter, play card if 0
            if (card.timerCard && card.timerCounters !== undefined) {
                card.timerCounters--;
                if (card.timerCounters <= 0) {
                    this.emitEvent('timerCardReady', {
                        player: playerNum,
                        card: card.timerCard
                    });
                }
            }

            // Cafeteria (id 65) - May pay (1) to recover 2 Endurance
            if (card.type === 'Location' && ability.includes('start of') && ability.includes('pay') && ability.includes('recover') && ability.includes('endurance')) {
                const availableResources = player.resources.filter(r => !r.spent);
                if (availableResources.length > 0) {
                    this.emitEvent('cafeteriaTrigger', {
                        player: playerNum,
                        card: card,
                        canPay: true
                    });
                }
            }
        });

        // Recalculate auras in case anything changed
        this.recalculateAuras(playerNum);
    }

    /**
     * End of turn processing
     */
    processEndOfTurn(playerNum) {
        const player = this.state.players[playerNum];

        player.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';

            // Jock (id 8) - Die roll increases when scoring points (handled in combat)

            // Chirography Enthusiast (id 53) - Regen: Regain all endurance at end of turn
            if (ability.includes('regen')) {
                card.currentEndurance = (card.baseEndurance || card.endurance) +
                    (card.auraEnduranceBonus || 0) + (card.counters?.plusOne || 0);
                this.emitEvent('regenHealing', { card });
            }
        });

        // Overclock: damage at end of turn, then the mark is cleared
        player.field.forEach(card => {
            if (card.endOfTurnDamage) {
                card.currentEndurance -= card.endOfTurnDamage;
                this.emitEvent('endOfTurnDamage', { card, damage: card.endOfTurnDamage });
                card.endOfTurnDamage = 0;
            }
        });

        // Clear end of turn temp buffs
        player.field.forEach(card => {
            if (card.tempBuffs) {
                card.tempBuffs = card.tempBuffs.filter(buff => buff.expiresAt !== 'endOfTurn');
            }
            // Reset die roll bonus from expired buffs
            card.dieRollBonus = 0;
            // Granted-for-the-turn flags
            card.isUnblockable = false;
            card.tempLethal = false;
            card.hasFirstStrike = false;
            card.calculatorBonus = false;
        });

        this.checkStateBasedActions();
    }

    /**
     * Process end of combat (called after combat resolution)
     */
    processEndOfCombat(attackingPlayer) {
        const attacker = this.state.players[attackingPlayer];

        // Chemistry Teacher (id 57) - All your pupils regain 1 endurance at end of combat
        attacker.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';

            if (ability.includes('end of combat') && ability.includes('regain') && ability.includes('endurance')) {
                const match = ability.match(/regain\s*(\d+)\s*endurance/);
                const amount = match ? parseInt(match[1]) : 1;
                attacker.field.forEach(p => {
                    if (p.type?.includes('Pupil')) {
                        p.currentEndurance = Math.min(
                            (p.baseEndurance || p.endurance) + (p.auraEnduranceBonus || 0) + (p.counters?.plusOne || 0),
                            p.currentEndurance + amount
                        );
                    }
                });
                this.emitEvent('combatHealing', { card, amount });
            }
        });

        // Clear end of combat temp buffs, taking their die bonus back with them
        attacker.field.forEach(card => {
            if (card.tempBuffs) {
                card.tempBuffs.forEach(buff => {
                    if (buff.expiresAt === 'endOfCombat' && buff.type === 'dieRollBonus') {
                        card.dieRollBonus = (card.dieRollBonus || 0) - (buff.value || 0);
                    }
                });
                card.tempBuffs = card.tempBuffs.filter(buff => buff.expiresAt !== 'endOfCombat');
            }
        });
    }

    // ==========================================
    // Dice Rolling
    // ==========================================

    /**
     * Roll dice from string like "1d6", "2d4 adv"
     */
    rollDice(diceStr) {
        if (!diceStr) return 0;
        const match = diceStr.match(/(\d*)d(\d+)/);
        if (!match) return 0;

        const count = parseInt(match[1]) || 1;
        const sides = parseInt(match[2]);
        const results = [];

        for (let i = 0; i < count; i++) {
            results.push(Math.floor(Math.random() * sides) + 1);
        }

        // Advantage: take highest
        if (diceStr.includes('adv') || count > 1) {
            return Math.max(...results);
        }

        return results.reduce((a, b) => a + b, 0);
    }

    // ==========================================
    // Utility
    // ==========================================

    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    /**
     * Get opponent of a player
     */
    getOpponent(playerNum) {
        return this.state.players[playerNum === 1 ? 2 : 1];
    }

    /**
     * Check if it's a specific player's turn
     */
    isPlayerTurn(playerNum) {
        return this.state.currentPlayer === playerNum;
    }

    /**
     * Use a reroll (Statistics Enthusiast ability)
     */
    useReroll(playerNum, originalRoll, diceStr) {
        const player = this.state.players[playerNum];

        if (!player.canReroll) {
            return { success: false, error: 'No reroll available' };
        }

        player.canReroll = false;
        const newRoll = this.rollDice(diceStr);

        this.emitEvent('diceRerolled', { player: playerNum, original: originalRoll, newRoll });
        return { success: true, originalRoll, newRoll };
    }

    /**
     * Upgrade a card's die (Jock ability)
     */
    upgradeDie(card) {
        if (!card.dice) return;

        const diceMap = {
            '1d4': '1d6',
            '1d6': '1d8',
            '1d8': '1d10',
            '1d10': '1d12',
            '1d12': '1d20',
            '2d4': '2d6',
            '2d6': '2d8'
        };

        const baseDice = card.dice.split(' ')[0]; // Handle "1d4 (adv)" format
        const suffix = card.dice.includes('adv') ? ' (adv)' : '';

        if (diceMap[baseDice]) {
            card.dice = diceMap[baseDice] + suffix;
            this.emitEvent('dieUpgraded', { card, newDice: card.dice });
        }
    }

    /**
     * Handle Jock scoring (die upgrade)
     */
    handleJockScoring(attackingPlayer, pointsScored) {
        if (pointsScored <= 0) return;

        const player = this.state.players[attackingPlayer];
        player.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';

            // Jock (id 8) - Die roll goes up when scoring
            if (ability.includes('scores a point') && ability.includes('die roll goes up')) {
                this.upgradeDie(card);
            }
        });
    }

    /**
     * Trigger abilities when points are scored
     */
    triggerOnPointsScored(playerNum, pointsScored) {
        const player = this.state.players[playerNum];

        player.field.forEach(card => {
            if (card.abilitiesDisabled) return;
            const ability = card.ability?.toLowerCase() || '';

            // Inspirational Speaker Paul (id 262) - Whenever you score, deal 1 damage to target
            if (ability.includes('whenever you score') && ability.includes('deal') && ability.includes('damage')) {
                const match = ability.match(/deal\s*(\d+)\s*damage/);
                const damage = match ? parseInt(match[1]) : 1;
                // For each point scored, can deal damage
                for (let i = 0; i < pointsScored; i++) {
                    this.emitEvent('scoreDamageTrigger', {
                        player: playerNum,
                        card: card,
                        damage: damage
                    });
                }
            }

            // Goldie (Class Pet) - When you score 1 or more points, recover 1 Endurance on target pupil
            if (ability.includes('when you score') && ability.includes('recover') && ability.includes('endurance on target')) {
                const match = ability.match(/recover\s*(\d+)\s*endurance/);
                const amount = match ? parseInt(match[1]) : 1;
                this.emitEvent('goldieRecoveryTrigger', {
                    player: playerNum,
                    card: card,
                    amount: amount,
                    pointsScored: pointsScored
                });
            }

            // Ribbon effect - If pupil with ribbon bonus scores, draw a card
            if (card.ribbonBonusActive && this.state.attackers?.some(a => a.instanceId === card.instanceId)) {
                if (player.deck.length > 0) {
                    player.hand.push(player.deck.shift());
                    this.emitEvent('ribbonDraw', { player: playerNum, card });
                }
                card.ribbonBonusActive = false;
            }
        });
    }

    /**
     * Check if a card has protection from a color
     */
    hasProtectionFrom(card, color) {
        const allProtection = [
            ...(card.protection || []),
            ...(card.auraProtection || [])
        ];
        return allProtection.includes(color);
    }

    /**
     * Rearrange top cards of deck (Order of Operations)
     */
    rearrangeTopCards(playerNum, newOrder) {
        const player = this.state.players[playerNum];
        const count = newOrder.length;

        // Verify all cards are from the top of the deck
        const topCards = player.deck.slice(0, count);
        const topIds = topCards.map(c => c.instanceId);

        if (!newOrder.every(id => topIds.includes(id))) {
            return { success: false, error: 'Invalid card order' };
        }

        // Reorder
        const reordered = newOrder.map(id => topCards.find(c => c.instanceId === id));
        player.deck.splice(0, count, ...reordered);

        this.emitEvent('deckRearranged', { player: playerNum, count });
        return { success: true };
    }

    /**
     * Choose cards from top of deck (Analytics Enthusiast, Hypothesis)
     */
    chooseFromTop(playerNum, chosenIds, putRestOnBottom = true, discardRest = false, lookCount = 5) {
        const player = this.state.players[playerNum];

        const topCards = [];
        const remaining = [];

        // Only the cards that were actually revealed
        player.deck.slice(0, lookCount).forEach(card => {
            if (chosenIds.includes(card.instanceId)) {
                topCards.push(card);
            } else {
                remaining.push(card);
            }
        });

        // Remove chosen cards from deck
        player.deck = player.deck.filter(c => !chosenIds.includes(c.instanceId));

        // Add chosen to hand
        topCards.forEach(card => player.hand.push(card));

        // Handle remaining cards
        if (discardRest) {
            remaining.forEach(card => {
                player.deck = player.deck.filter(c => c.instanceId !== card.instanceId);
                player.discard.push(card);
            });
        } else if (putRestOnBottom) {
            remaining.forEach(card => {
                player.deck = player.deck.filter(c => c.instanceId !== card.instanceId);
                player.deck.push(card);
            });
        }

        this.emitEvent('cardsChosen', { player: playerNum, chosen: topCards.length });
        return { success: true, chosenCards: topCards };
    }

    /**
     * Force opponent to discard (Information Overload)
     */
    forceDiscard(playerNum, cardInstanceId) {
        const player = this.state.players[playerNum];
        const cardIndex = player.hand.findIndex(c => c.instanceId === cardInstanceId);

        if (cardIndex === -1) {
            return { success: false, error: 'Card not in hand' };
        }

        const card = player.hand.splice(cardIndex, 1)[0];
        player.discard.push(card);

        this.emitEvent('cardDiscarded', { player: playerNum, card });
        return { success: true, card };
    }

    /**
     * Emit game event
     */
    emitEvent(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    /**
     * Get serializable state for multiplayer sync
     */
    getSerializableState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    /**
     * Load state from serialized data
     */
    loadState(serializedState) {
        this.state = JSON.parse(JSON.stringify(serializedState));
        this.emitEvent('stateLoaded', { state: this.state });
    }
}

// Export
window.RiutizGame = RiutizGame;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizGame };
}
