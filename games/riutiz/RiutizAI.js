// games/riutiz/RiutizAI.js
// AI opponent logic for RIUTIZ with personality system

class RiutizAI {
    constructor(game, playerNum = 2) {
        this.game = game;
        this.playerNum = playerNum;
        this.thinkingDelay = 800;
        this.actionDelay = 1000;
        this.isRunning = false;

        // Personality system
        this.personality = null;
        this.setRandomPersonality();
    }

    // ==========================================
    // PERSONALITY DEFINITIONS
    // ==========================================

    static get PERSONALITIES() {
        return {
            aggressive: {
                name: 'Aggressive',
                description: 'Attacks relentlessly, plays fast and loose',
                attackThreshold: 0.2,      // Low threshold = attacks more often
                blockThreshold: 0.6,       // Higher = less likely to block
                riskTolerance: 0.8,        // High = takes more risks
                preferCreatures: true,     // Prioritizes playing creatures
                holdResources: false,      // Doesn't save resources
                quotes: [
                    "No mercy!",
                    "Attack!",
                    "Full assault!",
                    "Charge!",
                    "You can't hide forever!"
                ]
            },
            defensive: {
                name: 'Defensive',
                description: 'Plays cautiously, builds up before attacking',
                attackThreshold: 0.7,      // High threshold = attacks less
                blockThreshold: 0.2,       // Low = blocks more often
                riskTolerance: 0.3,        // Low = avoids risks
                preferCreatures: true,     // Builds board presence
                holdResources: true,       // Saves resources for responses
                quotes: [
                    "Patience is key...",
                    "I'll wait for the right moment.",
                    "Defense wins games.",
                    "Your move.",
                    "I'm not falling for that."
                ]
            },
            strategic: {
                name: 'Strategic',
                description: 'Calculates trades carefully, plays optimally',
                attackThreshold: 0.5,      // Balanced
                blockThreshold: 0.4,       // Balanced
                riskTolerance: 0.5,        // Moderate risks
                preferCreatures: false,    // Values all card types
                holdResources: false,      // Uses resources efficiently
                quotes: [
                    "Interesting move...",
                    "Let me think...",
                    "Calculated.",
                    "As expected.",
                    "All according to plan."
                ]
            },
            chaotic: {
                name: 'Chaotic',
                description: 'Unpredictable, makes surprising plays',
                attackThreshold: 0.4,      // Somewhat random
                blockThreshold: 0.5,       // Random blocking
                riskTolerance: 0.6,        // Takes random risks
                preferCreatures: null,     // Random preference
                holdResources: null,       // Random
                quotes: [
                    "Surprise!",
                    "Bet you didn't see that coming!",
                    "Why not?",
                    "Let's make this interesting!",
                    "Chaos reigns!"
                ]
            },
            controlFreak: {
                name: 'Control',
                description: 'Focuses on disruption and card advantage',
                attackThreshold: 0.6,      // Only attacks when ahead
                blockThreshold: 0.3,       // Protects life total
                riskTolerance: 0.4,        // Conservative
                preferCreatures: false,    // Prefers spells
                holdResources: true,       // Holds mana for responses
                quotes: [
                    "Not so fast.",
                    "I'll allow it... for now.",
                    "Everything under control.",
                    "You're playing into my hands.",
                    "Denied."
                ]
            }
        };
    }

    /**
     * Set a random personality
     */
    setRandomPersonality() {
        const personalities = Object.keys(RiutizAI.PERSONALITIES);
        const randomKey = personalities[Math.floor(Math.random() * personalities.length)];
        this.setPersonality(randomKey);
    }

    /**
     * Set specific personality
     */
    setPersonality(personalityKey) {
        this.personality = RiutizAI.PERSONALITIES[personalityKey] || RiutizAI.PERSONALITIES.strategic;
        console.log(`AI personality: ${this.personality.name}`);
    }

    /**
     * Execute AI turn
     */
    async takeTurn() {
        if (this.isRunning) return;
        if (this.game.state.currentPlayer !== this.playerNum) return;
        if (this.game.state.gameOver) return;

        this.isRunning = true;

        try {
            await this.delay(this.thinkingDelay);

            // Play a resource
            await this.playResource();
            await this.delay(this.actionDelay);

            // Play creatures/spells based on personality
            await this.playCards();
            await this.delay(this.actionDelay);

            // Combat decisions based on personality
            await this.doCombat();

            // Wait for combat to resolve if attackers were declared
            if (this.game.state.combatStep) {
                // Combat is in progress - wait for player to declare blockers
                // and for combat to resolve before ending turn
                await this.waitForCombatResolution();
            }

            // End turn (only if combat is resolved or was skipped)
            await this.delay(500);
            if (!this.game.state.combatStep) {
                this.game.endTurn(this.playerNum);
            }

        } catch (error) {
            console.error('AI error:', error);
            // An engine exception used to strand the game on the AI's turn: the human's
            // buttons are gated on it being their turn, so nothing could ever move again.
            if (!this.game.state.gameOver && this.game.state.currentPlayer === this.playerNum) {
                this.game.state.combatStep = null;
                this.game.state.attackers = [];
                this.game.state.blockers = {};
                this.game.endTurn(this.playerNum);
            }
        }

        this.isRunning = false;
    }

    /**
     * Declare blockers when being attacked
     */
    async declareBlockers() {
        if (this.game.state.combatStep !== 'declare-blockers') return;
        if (this.game.state.currentPlayer === this.playerNum) return;

        await this.delay(this.thinkingDelay);

        const player = this.game.state.players[this.playerNum];
        const availableBlockers = player.field.filter(c =>
            c.type?.includes('Pupil') && !c.isSpent
        );

        const attackers = [...this.game.state.attackers];

        // Personality affects blocking decision
        const blockThreshold = this.personality?.blockThreshold ?? 0.4;

        // Chaotic might not block at all sometimes
        if (this.personality?.name === 'Chaotic' && Math.random() > 0.7) {
            console.log('AI (Chaotic): Letting attacks through for fun!');
            await this.delay(this.actionDelay);
            this.game.confirmBlockers();
            return;
        }

        // Sort attackers by threat level
        const sortedAttackers = attackers.sort((a, b) => {
            return this.evaluateCardValue(b) - this.evaluateCardValue(a);
        });

        for (const attacker of sortedAttackers) {
            if (availableBlockers.length === 0) break;

            // Check if we should even try to block based on personality
            const shouldTryBlock = Math.random() > blockThreshold;
            if (!shouldTryBlock && this.personality?.name !== 'Defensive') continue;

            const blocker = this.findBestBlocker(attacker, availableBlockers);
            if (blocker) {
                this.game.toggleBlocker(this.playerNum, blocker.instanceId, attacker.instanceId);
                availableBlockers.splice(availableBlockers.indexOf(blocker), 1);
            }
        }

        await this.delay(this.actionDelay);

        // The defender resolves combat. The human attacker used to be handed a
        // "Done Blocking" button (and could even assign the AI's blockers) instead.
        if (this.game.state.combatStep === 'declare-blockers') {
            this.game.confirmBlockers();
        }
    }

    /**
     * Find best blocker for an attacker
     */
    findBestBlocker(attacker, availableBlockers) {
        const riskTolerance = this.personality?.riskTolerance ?? 0.5;

        // Try to find a blocker that can survive
        const survivors = availableBlockers.filter(b => {
            const avgAttackRoll = this.estimateRoll(attacker.dice);
            return b.currentEndurance > avgAttackRoll;
        });

        if (survivors.length > 0) {
            // Defensive personality picks best survivor, others pick weakest
            if (this.personality?.name === 'Defensive') {
                return survivors.sort((a, b) => this.evaluateCardValue(b) - this.evaluateCardValue(a))[0];
            }
            return survivors.sort((a, b) => this.evaluateCardValue(a) - this.evaluateCardValue(b))[0];
        }

        // No survivors - decide based on personality
        const attackerValue = this.evaluateCardValue(attacker);
        const tradeThreshold = 2 + (riskTolerance * 3); // 2-5 based on risk tolerance

        if (attackerValue >= tradeThreshold) {
            // Trade away weakest blocker
            return availableBlockers.sort((a, b) =>
                this.evaluateCardValue(a) - this.evaluateCardValue(b)
            )[0];
        }

        // Aggressive personality might chump block anyway
        if (this.personality?.name === 'Aggressive' && Math.random() > 0.7) {
            return null; // Let it through, we'll attack back harder
        }

        return null;
    }

    /**
     * Play a card as resource
     */
    async playResource() {
        const player = this.game.state.players[this.playerNum];
        if (player.hand.length === 0) return;

        // Control personality might skip resource to hold cards
        if (this.personality?.name === 'Control' && player.resources.length >= 4 && Math.random() > 0.6) {
            console.log('AI (Control): Holding cards for later');
            return;
        }

        let resCard;

        // Personality affects resource choice
        if (this.personality?.preferCreatures) {
            // Use non-creatures as resources first
            resCard = player.hand.find(c => !c.type?.includes('Pupil'));
            if (!resCard) {
                // Use weakest creature
                const sorted = [...player.hand].sort((a, b) =>
                    this.evaluateCardValue(a) - this.evaluateCardValue(b)
                );
                resCard = sorted[0];
            }
        } else {
            // Strategic: use lowest value card
            const sorted = [...player.hand].sort((a, b) =>
                this.evaluateCardValue(a) - this.evaluateCardValue(b)
            );
            resCard = sorted[0];
        }

        // Chaotic might pick randomly
        if (this.personality?.name === 'Chaotic' && Math.random() > 0.6) {
            resCard = player.hand[Math.floor(Math.random() * player.hand.length)];
        }

        if (resCard) {
            this.game.playCard(this.playerNum, resCard.instanceId, true);
        }
    }

    /**
     * Play cards from hand
     */
    async playCards() {
        const player = this.game.state.players[this.playerNum];

        // Defensive/Control might hold resources
        if (this.personality?.holdResources) {
            const availableResources = player.resources.filter(r => !r.spent).length;
            const holdCount = this.personality?.name === 'Defensive' ? 2 : 1;

            if (availableResources <= holdCount && player.hand.length > 2) {
                console.log(`AI (${this.personality.name}): Holding resources`);
                // Only play one card
                const playable = this.getPlayableCards();
                if (playable.length > 0) {
                    const card = playable[0];
                    if (this.game.canAfford(card, player)) {
                        this.game.playCard(this.playerNum, card.instanceId, false);
                    }
                }
                return;
            }
        }

        // Get playable cards sorted by priority
        const playable = this.getPlayableCards();

        for (const card of playable) {
            if (this.game.canAfford(card, player)) {
                const result = this.game.playCard(this.playerNum, card.instanceId, false);
                if (result.success) {
                    await this.delay(this.actionDelay);
                }
            }
        }
    }

    /**
     * Get list of playable cards sorted by priority
     */
    getPlayableCards() {
        const player = this.game.state.players[this.playerNum];
        const available = player.resources.filter(r => !r.spent);

        const playable = player.hand.filter(card => {
            // Skip interruptions in main phase
            if (card.type === 'Interruption') return false;

            const cost = this.game.parseCost(card.cost);
            if (available.length < cost.total) return false;

            for (const [color, count] of Object.entries(cost.colors)) {
                if (available.filter(r => r.color === color).length < count) return false;
            }

            return true;
        });

        // Sort based on personality
        return playable.sort((a, b) => {
            let aValue = this.evaluateCardValue(a);
            let bValue = this.evaluateCardValue(b);

            // Personality adjustments
            if (this.personality?.preferCreatures) {
                if (a.type?.includes('Pupil')) aValue += 2;
                if (b.type?.includes('Pupil')) bValue += 2;
            }

            if (this.personality?.name === 'Control') {
                // Prefer spells and tools
                if (!a.type?.includes('Pupil')) aValue += 1.5;
                if (!b.type?.includes('Pupil')) bValue += 1.5;
            }

            if (this.personality?.name === 'Aggressive') {
                // Prefer creatures with high dice
                if (a.dice) aValue += this.estimateRoll(a.dice);
                if (b.dice) bValue += this.estimateRoll(b.dice);
            }

            // Chaotic shuffles a bit
            if (this.personality?.name === 'Chaotic') {
                aValue += (Math.random() - 0.5) * 3;
                bValue += (Math.random() - 0.5) * 3;
            }

            return bValue - aValue;
        });
    }

    /**
     * Execute combat phase
     */
    async doCombat() {
        const player = this.game.state.players[this.playerNum];

        // Get available attackers
        const attackers = player.field.filter(c =>
            c.type?.includes('Pupil') &&
            !c.hasGettingBearings &&
            !c.isSpent
        );

        if (attackers.length === 0) return;

        // Defensive might skip combat entirely if opponent has blockers
        const opponent = this.game.getOpponent(this.playerNum);
        const opponentBlockers = opponent.field.filter(c => c.type?.includes('Pupil') && !c.isSpent);

        if (this.personality?.name === 'Defensive' && opponentBlockers.length >= attackers.length) {
            console.log('AI (Defensive): Skipping combat, unfavorable board');
            return;
        }

        // Start combat
        this.game.startCombat(this.playerNum);
        await this.delay(this.actionDelay);

        // Decide which creatures to attack with
        const shouldAttack = this.evaluateAttackDecision(attackers, opponent);

        if (shouldAttack.length === 0) {
            this.game.confirmAttackers(this.playerNum);
            return;
        }

        // Declare attackers
        for (const card of shouldAttack) {
            this.game.toggleAttacker(this.playerNum, card.instanceId);
        }

        await this.delay(this.actionDelay);
        this.game.confirmAttackers(this.playerNum);
    }

    /**
     * Decide which creatures should attack
     */
    evaluateAttackDecision(attackers, opponent) {
        const shouldAttack = [];
        const attackThreshold = this.personality?.attackThreshold ?? 0.5;
        const riskTolerance = this.personality?.riskTolerance ?? 0.5;

        const blockers = opponent.field.filter(c => c.type?.includes('Pupil') && !c.isSpent);

        // Aggressive attacks with everything if opponent has fewer blockers
        if (this.personality?.name === 'Aggressive') {
            if (blockers.length < attackers.length || Math.random() > 0.3) {
                return attackers;
            }
        }

        // Chaotic might just send everyone
        if (this.personality?.name === 'Chaotic' && Math.random() > 0.5) {
            console.log('AI (Chaotic): All-out attack!');
            return attackers;
        }

        // If opponent has no blockers, attack with everything (all personalities)
        if (blockers.length === 0) {
            return attackers;
        }

        // Evaluate each attacker
        for (const att of attackers) {
            const isRelentless = att.ability?.toLowerCase().includes('relentless');
            const hasOverwhelm = att.ability?.toLowerCase().includes('overwhelm');

            // Relentless creatures always attack
            if (isRelentless) {
                shouldAttack.push(att);
                continue;
            }

            // Overwhelm creatures are valuable attackers
            if (hasOverwhelm) {
                shouldAttack.push(att);
                continue;
            }

            // Calculate attack decision based on personality
            const attackerValue = this.evaluateCardValue(att);
            const avgBlockerValue = blockers.reduce((sum, b) => sum + this.evaluateCardValue(b), 0) / blockers.length;

            // Attack if value comparison meets threshold
            const valueRatio = attackerValue / Math.max(avgBlockerValue, 1);
            const shouldSend = valueRatio < (1 + attackThreshold) || Math.random() > attackThreshold;

            if (shouldSend) {
                // Risk tolerance affects final decision
                if (Math.random() < riskTolerance || attackerValue <= avgBlockerValue) {
                    shouldAttack.push(att);
                }
            }
        }

        // Control only attacks when significantly ahead
        if (this.personality?.name === 'Control') {
            const myPoints = this.game.state.players[this.playerNum].points;
            // getOpponent() returns the player state itself; indexing players[] with it
            // was undefined, and this branch threw every time the AI was behind on points
            const oppPoints = this.game.getOpponent(this.playerNum).points;

            if (myPoints < oppPoints && shouldAttack.length < attackers.length) {
                // Only send safe attackers
                return shouldAttack.filter(att => {
                    const avgRoll = this.estimateRoll(att.dice);
                    return avgRoll > 3; // Only high-impact attackers
                });
            }
        }

        return shouldAttack;
    }

    /**
     * Evaluate a card's value for decision making
     */
    evaluateCardValue(card) {
        let value = 0;

        // Base value from cost
        const cost = this.game.parseCost(card.cost);
        value += cost.total;

        // Creature stats
        if (card.type?.includes('Pupil')) {
            value += (card.currentEndurance || card.endurance) / 2;
            value += (parseFloat(card.ad) || 0) / 2;   // ad is a string ("8x2", "?") for ~50 cards
        }

        // Keywords
        const ability = card.ability?.toLowerCase() || '';
        if (ability.includes('relentless')) value += 1;
        if (ability.includes('overwhelm')) value += 1.5;
        if (ability.includes('impulsive')) value += 0.5;
        if (ability.includes('draw')) value += 1.5;
        if (ability.includes('when') || ability.includes('enters')) value += 1; // ETB effects

        return value;
    }

    /**
     * Estimate average dice roll
     */
    estimateRoll(diceStr) {
        if (!diceStr) return 0;
        const match = diceStr.match(/(\d*)d(\d+)/);
        if (!match) return 0;
        const count = parseInt(match[1]) || 1;
        const sides = parseInt(match[2]);
        return count * (sides + 1) / 2;
    }

    /**
     * Wait for combat to be resolved (player must declare blockers first)
     */
    waitForCombatResolution() {
        return new Promise(resolve => {
            const checkCombat = () => {
                if (!this.game.state.combatStep) {
                    resolve();
                } else {
                    setTimeout(checkCombat, 200);
                }
            };
            // Initial check after a delay
            setTimeout(checkCombat, 200);
        });
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => { setTimeout(resolve, ms); });
    }
}

// Export
window.RiutizAI = RiutizAI;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizAI };
}
