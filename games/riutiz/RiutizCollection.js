// games/riutiz/RiutizCollection.js
// Card collection management for RIUTIZ

class RiutizCollection {
    constructor(arcade, cardData) {
        this.arcade = arcade;
        this.cardData = cardData;
        this.collection = { cards: {}, starter_deck_claimed: false, chosen_starter: null };
        this.gameId = 'riutiz';
        this.starterDecks = null;
    }

    /**
     * Load collection from Firebase
     */
    async load() {
        this.unavailable = false;
        if (this.arcade && this.arcade.isOnline) {
            try {
                this.collection = await this.arcade.getCollection(this.gameId);
            } catch (e) {
                // Could not read it: say so, and never save over the real one
                console.error('Could not load the card collection:', e);
                this.unavailable = true;
                this.collection = { cards: {}, starter_deck_claimed: true, chosen_starter: null };
            }
        } else {
            // Load from localStorage for offline play
            const saved = localStorage.getItem('riutiz_collection');
            if (saved) {
                this.collection = JSON.parse(saved);
            }
        }

        // Load starter deck definitions
        await this.loadStarterDecks();
        this.collection.cards = this.collection.cards || {};
        await this.topUpStarter();

        return this.collection;
    }

    // The starter decks were rebuilt on 2026-09-26. A student who chose one
    // before then owns the OLD list, so the starter shown to them - and any
    // ranked deck built from it - needed cards they did not have. Grant the
    // missing copies of the starter they chose, once; nobody loses a card.
    async topUpStarter() {
        if (this.unavailable || !this.collection.starter_deck_claimed) return false;
        const deck = (this.starterDecks || []).find(d => d.id === this.collection.chosen_starter);
        if (!deck || !deck.cards) return false;
        let changed = false;
        for (const [cardId, n] of Object.entries(deck.cards)) {
            const have = this.collection.cards[cardId]?.quantity || 0;
            if (have < n) {
                this.collection.cards[cardId] = { ...(this.collection.cards[cardId] || {}), quantity: n, earned_at: Date.now() };
                changed = true;
            }
        }
        if (changed) {
            this.collection.total_cards = this.getTotalCards();
            await this.save();
        }
        return changed;
    }

    /**
     * Check if player needs to choose a starter deck
     */
    needsStarterDeck() {
        return !this.collection.starter_deck_claimed;
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
        return this.starterDecks;
    }

    /**
     * Get available starter decks
     */
    getStarterDecks() {
        return this.starterDecks || [];
    }

    /**
     * Save collection
     */
    async save() {
        if (this.unavailable) return;     // never overwrite a collection we could not read
        if (this.arcade && this.arcade.isOnline) {
            await this.arcade.saveCollection(this.gameId, this.collection);
        } else {
            localStorage.setItem('riutiz_collection', JSON.stringify(this.collection));
        }
    }

    /**
     * Grant starter collection from chosen deck
     */
    async grantStarterDeck(deckId) {
        const deck = this.starterDecks?.find(d => d.id === deckId);
        if (!deck) {
            console.error('Starter deck not found:', deckId);
            return false;
        }

        // Grant cards from the chosen deck
        for (const [cardId, quantity] of Object.entries(deck.cards)) {
            this.collection.cards[cardId] = {
                quantity: quantity,
                earned_at: Date.now()
            };
        }

        this.collection.starter_deck_claimed = true;
        this.collection.chosen_starter = deckId;
        this.collection.total_cards = this.getTotalCards();

        await this.save();
        console.log('Starter deck granted:', deck.name);
        return true;
    }

    /**
     * Get the chosen starter deck's deck list (for auto-creating a deck)
     */
    getStarterDeckList(deckId) {
        const deck = this.starterDecks?.find(d => d.id === deckId);
        return deck?.deck_list || [];
    }

    /**
     * Get quantity of a specific card owned
     */
    getQuantity(cardId) {
        return this.collection.cards[cardId]?.quantity || 0;
    }

    /**
     * Check if player owns at least one copy of a card
     */
    owns(cardId) {
        return this.getQuantity(cardId) > 0;
    }

    /**
     * Add cards to collection
     */
    async addCards(cardsToAdd) {
        for (const [cardId, quantity] of Object.entries(cardsToAdd)) {
            if (!this.collection.cards[cardId]) {
                this.collection.cards[cardId] = { quantity: 0, earned_at: Date.now() };
            }
            this.collection.cards[cardId].quantity += quantity;
        }

        this.collection.total_cards = this.getTotalCards();
        await this.save();
    }

    /**
     * Get total number of cards in collection
     */
    getTotalCards() {
        return Object.values(this.collection.cards)
            .reduce((sum, c) => sum + (c.quantity || 0), 0);
    }

}

// Export
window.RiutizCollection = RiutizCollection;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizCollection };
}
