// games/riutiz/RiutizDeckBuilder.js
// Deck building system for RIUTIZ

class RiutizDeckBuilder {
    constructor(collection, cardData, options = {}) {
        this.collection = collection;
        this.cardData = cardData;
        this.arcade = options.arcade || null;
        this.gameId = 'riutiz';

        this.mode = 'casual'; // 'casual' or 'ranked'
        this.deckType = 'casual'; // Explicit deck type for saving
        this.currentDeck = [];
        this.deckName = 'New Deck';
        this.deckId = null;

        this.minDeckSize = 40;
        this.maxCopies = 4;

        this.savedDecks = {};
        this.starterDecks = [];

        // Filter state
        this.filters = {
            color: null,
            type: null,
            rarity: null,
            search: ''
        };
    }

    /**
     * Load saved decks
     */
    async loadDecks() {
        if (this.arcade && this.arcade.isOnline) {
            this.savedDecks = await this.arcade.getDecks(this.gameId);
        } else {
            const saved = localStorage.getItem('riutiz_decks');
            if (saved) {
                this.savedDecks = JSON.parse(saved);
            }
        }

        // Load starter decks
        await this.loadStarterDecks();

        return this.savedDecks;
    }

    /**
     * Load starter deck definitions
     */
    async loadStarterDecks() {
        try {
            const response = await fetch('Data/Riutiz/starter-decks.json');
            if (response.ok) {
                const data = await response.json();
                this.starterDecks = data.starter_decks || [];
            }
        } catch (e) {
            console.warn('Could not load starter decks');
            this.starterDecks = [];
        }
    }

    /**
     * Set deck building mode
     */
    setMode(mode) {
        this.mode = mode;
        // Clear deck if switching to ranked and cards aren't owned
        if (mode === 'ranked' && this.collection) {
            this.currentDeck = this.currentDeck.filter(cardId =>
                this.collection.getQuantity(cardId) > 0
            );
        }
    }

    /**
     * Get available cards based on mode
     */
    getAvailableCards() {
        if (this.mode === 'casual' || !this.collection) {
            return this.cardData;
        }

        // Ranked mode: only owned cards
        return this.cardData.filter(card => this.collection.owns(card.id));
    }

    /**
     * Get filtered cards
     */
    getFilteredCards() {
        let cards = this.getAvailableCards();

        // Apply filters
        if (this.filters.color) {
            cards = cards.filter(card => this.hasColor(card.cost, this.filters.color));
        }

        if (this.filters.type) {
            cards = cards.filter(card => card.type?.toLowerCase().includes(this.filters.type.toLowerCase()));
        }

        if (this.filters.rarity) {
            cards = cards.filter(card => card.rarity === this.filters.rarity);
        }

        if (this.filters.search) {
            const search = this.filters.search.toLowerCase();
            cards = cards.filter(card =>
                card.name.toLowerCase().includes(search) ||
                card.ability?.toLowerCase().includes(search) ||
                card.type?.toLowerCase().includes(search)
            );
        }

        return cards;
    }

    /**
     * Set a filter
     */
    setFilter(key, value) {
        this.filters[key] = value;
    }

    /**
     * Get count of a specific card in current deck
     */
    getCardCount(cardId) {
        return this.currentDeck.filter(id => id === cardId).length;
    }

    /**
     * Check if can add more copies of a card
     */
    canAddCard(cardId) {
        const currentCount = this.getCardCount(cardId);

        // Max copies limit
        if (currentCount >= this.maxCopies) {
            return { can: false, reason: `Maximum ${this.maxCopies} copies per card` };
        }

        // Check ownership in ranked mode
        if (this.mode === 'ranked' && this.collection) {
            const owned = this.collection.getQuantity(cardId);
            if (currentCount >= owned) {
                return { can: false, reason: `You only own ${owned} copies` };
            }
        }

        return { can: true };
    }

    /**
     * Add a card to the deck
     */
    addCard(cardId) {
        const check = this.canAddCard(cardId);
        if (!check.can) {
            return { success: false, error: check.reason };
        }

        this.currentDeck.push(cardId);
        return { success: true, deckSize: this.currentDeck.length };
    }

    /**
     * Remove a card from the deck
     */
    removeCard(cardId) {
        const index = this.currentDeck.indexOf(cardId);
        if (index === -1) {
            return { success: false, error: 'Card not in deck' };
        }

        this.currentDeck.splice(index, 1);
        return { success: true, deckSize: this.currentDeck.length };
    }

    /**
     * Clear the current deck
     */
    clearDeck() {
        this.currentDeck = [];
        this.deckName = 'New Deck';
        this.deckId = null;
    }

    /**
     * Full reset for creating a new deck
     */
    clear() {
        this.currentDeck = [];
        this.deckName = 'New Deck';
        this.deckId = null;
        this.deckType = 'casual';
        this.mode = 'casual';
    }

    /**
     * Load a saved deck for editing
     */
    loadDeck(deckId) {
        const deck = this.savedDecks[deckId];
        if (!deck) {
            return { success: false, error: 'Deck not found' };
        }

        this.currentDeck = [...deck.cards];
        this.deckName = deck.name;
        this.deckId = deckId;

        return { success: true, deck };
    }

    /**
     * Load a starter deck
     */
    loadStarterDeck(starterDeckId) {
        const starter = this.starterDecks.find(d => d.id === starterDeckId);
        if (!starter) {
            return { success: false, error: 'Starter deck not found' };
        }

        // Use deck_list array if available, otherwise convert cards object to array
        if (starter.deck_list && Array.isArray(starter.deck_list)) {
            this.currentDeck = [...starter.deck_list];
        } else if (starter.cards && typeof starter.cards === 'object') {
            // Convert {cardId: quantity} to array of card IDs
            this.currentDeck = [];
            for (const [cardId, qty] of Object.entries(starter.cards)) {
                for (let i = 0; i < qty; i++) {
                    this.currentDeck.push(parseInt(cardId));
                }
            }
        } else {
            return { success: false, error: 'Invalid starter deck format' };
        }

        this.deckName = starter.name + ' (Copy)';
        this.deckId = null;

        return { success: true };
    }

    /**
     * Validate the current deck
     */
    validate() {
        const errors = [];

        // Minimum size
        if (this.currentDeck.length < this.minDeckSize) {
            errors.push(`Deck needs at least ${this.minDeckSize} cards (currently ${this.currentDeck.length})`);
        }

        // Check card copy limits
        const counts = {};
        this.currentDeck.forEach(id => {
            counts[id] = (counts[id] || 0) + 1;
        });

        for (const [cardId, count] of Object.entries(counts)) {
            if (count > this.maxCopies) {
                const card = this.cardData.find(c => c.id === parseInt(cardId));
                errors.push(`${card?.name || 'Card'} has ${count} copies (max ${this.maxCopies})`);
            }

            // Check ownership in ranked
            if (this.mode === 'ranked' && this.collection) {
                const owned = this.collection.getQuantity(parseInt(cardId));
                if (count > owned) {
                    const card = this.cardData.find(c => c.id === parseInt(cardId));
                    errors.push(`You only own ${owned} copies of ${card?.name || 'a card'}`);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            size: this.currentDeck.length
        };
    }

    /**
     * Save the current deck
     */
    async saveDeck(name = null) {
        const validation = this.validate();
        if (!validation.valid) {
            return { success: false, errors: validation.errors };
        }

        if (name) this.deckName = name;

        const deck = {
            id: this.deckId || this.generateId(),
            name: this.deckName,
            cards: [...this.currentDeck],
            card_count: this.currentDeck.length,
            primary_color: this.getDeckPrimaryColor(),
            deck_type: this.deckType || this.mode, // 'casual' or 'ranked'
            is_valid: true,
            created_at: Date.now(),
            updated_at: Date.now()
        };

        this.deckId = deck.id;
        this.savedDecks[deck.id] = deck;

        // Save to backend
        if (this.arcade && this.arcade.isOnline) {
            await this.arcade.saveDeck(this.gameId, deck);
        } else {
            localStorage.setItem('riutiz_decks', JSON.stringify(this.savedDecks));
        }

        return { success: true, deckId: deck.id };
    }

    /**
     * Get all saved decks
     */
    getSavedDecks() {
        return Object.values(this.savedDecks);
    }

    /**
     * Get decks valid for a specific game mode
     * @param {string} gameMode - 'casual' or 'ranked'
     */
    getDecksForMode(gameMode) {
        const decks = this.getSavedDecks();

        if (gameMode === 'casual') {
            // All valid decks work for casual
            return decks.filter(deck => deck.is_valid && deck.card_count >= this.minDeckSize);
        }

        // For ranked, deck must use only owned cards
        return decks.filter(deck => {
            if (!deck.is_valid || deck.card_count < this.minDeckSize) return false;
            return this.isDeckValidForRanked(deck);
        });
    }

    /**
     * Check if a deck is valid for ranked play (all cards owned)
     */
    isDeckValidForRanked(deck) {
        if (!this.collection) return false;

        const cardCounts = {};
        deck.cards.forEach(id => {
            cardCounts[id] = (cardCounts[id] || 0) + 1;
        });

        for (const [cardId, count] of Object.entries(cardCounts)) {
            const owned = this.collection.getQuantity(parseInt(cardId));
            if (count > owned) {
                return false;
            }
        }
        return true;
    }

    /**
     * Get validation details for a deck in ranked mode
     */
    getRankedValidationErrors(deck) {
        const errors = [];
        if (!this.collection) {
            errors.push('Collection not available');
            return errors;
        }

        const cardCounts = {};
        deck.cards.forEach(id => {
            cardCounts[id] = (cardCounts[id] || 0) + 1;
        });

        for (const [cardId, count] of Object.entries(cardCounts)) {
            const owned = this.collection.getQuantity(parseInt(cardId));
            if (count > owned) {
                const card = this.cardData.find(c => c.id === parseInt(cardId));
                errors.push(`Need ${count}x ${card?.name || 'Unknown'} but only own ${owned}`);
            }
        }
        return errors;
    }

    /**
     * Delete a saved deck
     */
    async deleteDeck(deckId) {
        if (!this.savedDecks[deckId]) {
            return { success: false, error: 'Deck not found' };
        }

        delete this.savedDecks[deckId];

        if (this.arcade && this.arcade.isOnline) {
            await this.arcade.deleteDeck(this.gameId, deckId);
        } else {
            localStorage.setItem('riutiz_decks', JSON.stringify(this.savedDecks));
        }

        if (this.deckId === deckId) {
            this.clearDeck();
        }

        return { success: true };
    }

    /**
     * Get deck statistics
     */
    getDeckStats() {
        const cardCounts = {};
        this.currentDeck.forEach(id => {
            cardCounts[id] = (cardCounts[id] || 0) + 1;
        });

        // Mana curve (cost distribution)
        const curve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, '6+': 0 };
        // Color distribution
        const colors = { O: 0, G: 0, P: 0, B: 0, Bk: 0, C: 0 };
        // Type distribution
        const types = { Pupil: 0, Interruption: 0, Tool: 0, Location: 0 };

        this.currentDeck.forEach(cardId => {
            const card = this.cardData.find(c => c.id === cardId);
            if (!card) return;

            // Mana curve
            const cost = this.parseCost(card.cost);
            const bucket = cost.total >= 6 ? '6+' : cost.total;
            curve[bucket]++;

            // Color
            const color = this.getPrimaryColor(card.cost);
            colors[color]++;

            // Type
            if (card.type?.includes('Pupil')) types.Pupil++;
            else if (card.type === 'Interruption') types.Interruption++;
            else if (card.type === 'Tool') types.Tool++;
            else if (card.type === 'Location') types.Location++;
        });

        return {
            size: this.currentDeck.length,
            uniqueCards: Object.keys(cardCounts).length,
            curve,
            colors,
            types,
            primaryColor: this.getDeckPrimaryColor()
        };
    }

    /**
     * Get deck's primary color (most common)
     */
    getDeckPrimaryColor() {
        const colors = {};
        this.currentDeck.forEach(cardId => {
            const card = this.cardData.find(c => c.id === cardId);
            if (!card) return;
            const color = this.getPrimaryColor(card.cost);
            colors[color] = (colors[color] || 0) + 1;
        });

        let maxColor = 'C';
        let maxCount = 0;
        for (const [color, count] of Object.entries(colors)) {
            if (count > maxCount && color !== 'C') {
                maxColor = color;
                maxCount = count;
            }
        }
        return maxColor;
    }

    /**
     * Get cards in current deck with full data
     */
    getDeckCards() {
        const cardCounts = {};
        this.currentDeck.forEach(id => {
            cardCounts[id] = (cardCounts[id] || 0) + 1;
        });

        return Object.entries(cardCounts).map(([id, count]) => {
            const card = this.cardData.find(c => c.id === parseInt(id));
            return { ...card, count };
        }).sort((a, b) => {
            // Sort by cost, then name
            const costA = this.parseCost(a.cost).total;
            const costB = this.parseCost(b.cost).total;
            if (costA !== costB) return costA - costB;
            return a.name.localeCompare(b.name);
        });
    }

    // ==========================================
    // Utility Methods
    // ==========================================

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

    getPrimaryColor(costStr) {
        const { colors } = this.parseCost(costStr);
        const keys = Object.keys(colors);
        return keys.length > 0 ? keys[0] : 'C';
    }

    /**
     * Check if a card has a specific color in its cost
     * @param {string} costStr - Card cost string like "(O)(G)(2)"
     * @param {string} color - Color to check for ('O', 'G', 'P', 'B', 'Bk', 'C', 'M' for multicolor)
     * @returns {boolean} True if card has this color
     */
    hasColor(costStr, color) {
        const { colors } = this.parseCost(costStr);
        const colorKeys = Object.keys(colors);

        // Colorless check - card has no color symbols
        if (color === 'C') {
            return colorKeys.length === 0;
        }

        // Multicolor check - card has 2+ different colors
        if (color === 'M') {
            return colorKeys.length >= 2;
        }

        return colorKeys.includes(color);
    }

    generateId() {
        return 'deck_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

// Export
window.RiutizDeckBuilder = RiutizDeckBuilder;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizDeckBuilder };
}
