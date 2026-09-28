// shared/arcade/ArcadeManager.js
// Core arcade system for player profiles, statistics, and cross-game functionality

// RTC for beating the computer, by difficulty, and the most a student can
// earn that way in a day (decided with Jordan, 2026-09-28).
const RIUTIZ_AI_RTC = { easy: 0, normal: 3, hard: 8 };
const AI_RTC_DAILY_CAP = 40;

class ArcadeManager {
    constructor() {
        this.firebase = null;
        this.player = null;
        this.currentGame = null;
        this._playerListeners = [];
        this._initialized = false;
    }

    /**
     * Initialize the arcade manager
     * @param {Object} options - Configuration options
     * @param {Object} options.firebaseConfig - Firebase configuration
     * @returns {Promise<ArcadeManager>}
     */
    async initialize(options = {}) {
        if (this._initialized) return this;

        try {
            // Initialize Firebase manager
            this.firebase = new FirebaseManager();

            // Load firebase config
            let config = options.firebaseConfig;
            if (!config) {
                // Try to load from global config
                config = window.FIREBASE_CONFIG || null;
            }

            await this.firebase.initialize(config);

            // Load or create player profile
            if (this.firebase.isAuthenticated) {
                this.player = await this._loadOrCreatePlayer();
            }

            this._initialized = true;
            console.log('ArcadeManager initialized');

        } catch (error) {
            console.error('ArcadeManager initialization failed:', error);
            // Continue in offline mode
            this._initialized = true;
        }

        return this;
    }

    /**
     * Load existing player or create new profile
     * @returns {Promise<Object>}
     */
    async _loadOrCreatePlayer() {
        const userId = this.firebase.supabaseUserId;
        const playerRef = this.firebase.playerRef();

        if (!playerRef) {
            return this._createLocalPlayer();
        }

        try {
            const snapshot = await playerRef.once('value');

            if (snapshot.exists()) {
                const player = snapshot.val();
                // Update last seen and sync display name from Supabase
                const currentDisplayName = this.firebase.displayName;
                const updateData = {
                    last_seen: this.firebase.serverTimestamp,
                    status: 'online'
                };

                // Sync display name (username) if it changed in Supabase
                if (currentDisplayName && currentDisplayName !== player.display_name) {
                    updateData.display_name = currentDisplayName;
                    player.display_name = currentDisplayName;
                    console.log('Synced username from Supabase:', currentDisplayName);
                }

                await playerRef.update(updateData);
                console.log('Loaded existing player profile');
                return player;
            }

            // Create new player
            const newPlayer = {
                supabase_user_id: userId,
                display_name: this.firebase.displayName,
                created_at: this.firebase.serverTimestamp,
                last_seen: this.firebase.serverTimestamp,
                status: 'online',
                current_match: null,
                total_games_played: 0,
                achievements: [],
                verified: true
            };

            await playerRef.set(newPlayer);
            console.log('Created new player profile');
            return newPlayer;

        } catch (error) {
            console.error('Error loading/creating player:', error);
            return this._createLocalPlayer();
        }
    }

    /**
     * Create a local-only player (offline mode)
     */
    _createLocalPlayer() {
        return {
            supabase_user_id: 'local_' + Date.now(),
            display_name: this.firebase?.displayName || 'Player',
            created_at: Date.now(),
            last_seen: Date.now(),
            status: 'offline',
            current_match: null,
            total_games_played: 0,
            achievements: [],
            verified: false
        };
    }

    /**
     * Update player profile
     * @param {Object} updates - Fields to update
     */
    async updatePlayer(updates) {
        if (this.player) {
            Object.assign(this.player, updates);
        }

        const playerRef = this.firebase?.playerRef();
        if (playerRef) {
            try {
                await playerRef.update({
                    ...updates,
                    last_seen: this.firebase.serverTimestamp
                });
            } catch (error) {
                console.error('Error updating player:', error);
            }
        }

        this._notifyPlayerListeners();
    }

    /**
     * Set player's current game
     * @param {string} gameId - Game identifier
     */
    async setCurrentGame(gameId) {
        this.currentGame = gameId;
        await this.updatePlayer({ current_game: gameId });
    }

    /**
     * Set player's current match
     * @param {string} matchId - Match identifier or null
     */
    async setCurrentMatch(matchId) {
        await this.updatePlayer({
            current_match: matchId,
            status: matchId ? 'in_game' : 'online'
        });
    }

    /**
     * Increment total games played
     */
    async incrementGamesPlayed() {
        if (this.player) {
            this.player.total_games_played = (this.player.total_games_played || 0) + 1;
        }

        const playerRef = this.firebase?.playerRef();
        if (playerRef) {
            try {
                await playerRef.child('total_games_played').transaction(count => (count || 0) + 1);
            } catch (error) {
                console.error('Error incrementing games played:', error);
            }
        }
    }

    // ==========================================
    // Game-Specific Data
    // ==========================================

    /**
     * Get collection for a specific game
     * @param {string} gameId - Game identifier
     * @returns {Promise<Object>}
     */
    async getCollection(gameId) {
        const ref = this.firebase?.gameRef(gameId, `collections/${this.firebase.supabaseUserId}`);
        if (!ref) return { cards: {}, starter_deck_claimed: false };

        // A failed read is NOT an empty collection. Reporting it as one showed
        // the student the starter picker again, and the next save wrote the
        // empty collection over their real one. Let the caller tell them apart.
        const snapshot = await ref.once('value');
        return snapshot.val() || { cards: {}, starter_deck_claimed: false };
    }

    /**
     * Update collection for a specific game
     * @param {string} gameId - Game identifier
     * @param {Object} collection - Collection data
     */
    async saveCollection(gameId, collection) {
        const ref = this.firebase?.gameRef(gameId, `collections/${this.firebase.supabaseUserId}`);
        if (!ref) return;

        try {
            await ref.set({
                ...collection,
                last_updated: this.firebase.serverTimestamp
            });
        } catch (error) {
            console.error('Error saving collection:', error);
        }
    }

    /**
     * Add cards to collection
     * @param {string} gameId - Game identifier
     * @param {Object} cardsToAdd - { cardId: quantity }
     */
    async addToCollection(gameId, cardsToAdd) {
        const collection = await this.getCollection(gameId);

        for (const [cardId, qty] of Object.entries(cardsToAdd)) {
            if (!collection.cards[cardId]) {
                collection.cards[cardId] = { quantity: 0, earned_at: Date.now() };
            }
            collection.cards[cardId].quantity += qty;
        }

        await this.saveCollection(gameId, collection);
        return collection;
    }

    /**
     * Get saved decks for a game
     * @param {string} gameId - Game identifier
     * @returns {Promise<Object>}
     */
    async getDecks(gameId) {
        const ref = this.firebase?.gameRef(gameId, `decks/${this.firebase.supabaseUserId}`);
        if (!ref) return {};

        try {
            const snapshot = await ref.once('value');
            return snapshot.val() || {};
        } catch (error) {
            console.error('Error loading decks:', error);
            return {};
        }
    }

    /**
     * Save a deck
     * @param {string} gameId - Game identifier
     * @param {Object} deck - Deck data
     * @returns {Promise<string>} Deck ID
     */
    async saveDeck(gameId, deck) {
        const ref = this.firebase?.gameRef(gameId, `decks/${this.firebase.supabaseUserId}`);
        if (!ref) return null;

        try {
            const deckId = deck.id || this.firebase.generateId();
            await ref.child(deckId).set({
                ...deck,
                id: deckId,
                updated_at: this.firebase.serverTimestamp,
                created_at: deck.created_at || this.firebase.serverTimestamp
            });
            return deckId;
        } catch (error) {
            console.error('Error saving deck:', error);
            return null;
        }
    }

    /**
     * Delete a deck
     * @param {string} gameId - Game identifier
     * @param {string} deckId - Deck ID
     */
    async deleteDeck(gameId, deckId) {
        const ref = this.firebase?.gameRef(gameId, `decks/${this.firebase.supabaseUserId}/${deckId}`);
        if (!ref) return;

        try {
            await ref.remove();
            return true;
        } catch (error) {
            console.error('Error deleting deck:', error);
            return false;
        }
    }

    /**
     * Get player statistics for a game
     * @param {string} gameId - Game identifier
     * @returns {Promise<Object>}
     */
    async getStats(gameId) {
        const ref = this.firebase?.gameRef(gameId, `stats/${this.firebase.supabaseUserId}`);
        if (!ref) return this._getDefaultStats();

        try {
            const snapshot = await ref.once('value');
            return snapshot.val() || this._getDefaultStats();
        } catch (error) {
            console.error('Error loading stats:', error);
            return this._getDefaultStats();
        }
    }

    /**
     * Record a game result.
     *
     * Against the computer (result.vsAI): kept in ai_stats, which the player
     * writes themselves - it is not on the leaderboard. RTC is paid through
     * the portal's own session, so it works even when Firebase does not.
     *
     * Online (result.matchId): the server adds the match to both players'
     * records (arcade-record-result), reading the match to see who won.
     *
     * @param {string} gameId - Game identifier
     * @param {Object} result - { won, ranked, vsAI, difficulty, matchId, forfeit }
     */
    async recordGameResult(gameId, result) {
        let stats = null;
        const online = !!this.firebase?.isAuthenticated;

        if (result.vsAI && online) {
            // One transaction: a failed read can never replace the record
            // with a single game, and two tabs cannot overwrite each other.
            try {
                const ref = this.firebase.gameRef(gameId, `ai_stats/${this.firebase.supabaseUserId}`);
                const tx = await ref.transaction(cur => {
                    const next = this._applyResult({ ...this._getDefaultStats(), ...(cur || {}) }, { ...result, ranked: false });
                    next.last_updated = this.firebase.serverTimestamp;
                    return next;
                });
                stats = tx && tx.snapshot ? tx.snapshot.val() : null;
            } catch (error) {
                console.error('Error recording game result:', error);
            }
        } else if (result.matchId) {
            stats = await this._recordMatchOnServer(gameId, result.matchId);
        }
        if (online) await this.incrementGamesPlayed();

        // Award RTC for playing arcade games (non-blocking)
        this._awardRtcForGame(gameId, result).catch(err => {
            console.warn('RTC award failed (non-blocking):', err);
        });

        return stats || this._applyResult(this._getDefaultStats(), { ...result, ranked: result.vsAI ? false : result.ranked });
    }

    // Ask the server to record a finished online match. Either player may ask,
    // any number of times: it counts once. Returns the caller's record.
    async _recordMatchOnServer(gameId, matchId) {
        try {
            const session = window.portalAuth?.supabase
                ? (await window.portalAuth.supabase.auth.getSession())?.data?.session : null;
            if (!session?.access_token) return null;
            const resp = await fetch(
                'https://joxvhzxkrcigknsdrusr.supabase.co/functions/v1/arcade-record-result', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                    body: JSON.stringify({ game_id: gameId, match_id: matchId })
                });
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) { console.warn('Recording the match failed:', body.error || resp.status); return null; }
            return body.stats || null;
        } catch (error) {
            console.warn('Recording the match failed:', error);
            return null;
        }
    }

    // One result added to a stats record (changes and returns it)
    _applyResult(stats, result) {
        if (result.won) {
            stats.wins = (stats.wins || 0) + 1;
            stats.current_streak = (stats.current_streak || 0) + 1;
            stats.best_streak = Math.max(stats.best_streak || 0, stats.current_streak);
        } else {
            stats.losses = (stats.losses || 0) + 1;
            stats.current_streak = 0;
        }

        stats.total_games = (stats.total_games || 0) + 1;
        stats.ranked_games = (stats.ranked_games || 0) + (result.ranked ? 1 : 0);
        stats.last_played = Date.now();

        // ELO rating calculation for ranked matches
        if (result.ranked) {
            const myRating = stats.ranked_rating || 1000;
            const opponentRating = result.opponentRating || 1000;
            const gamesPlayed = stats.ranked_games || 0;

            if (typeof window !== 'undefined' && window.ratingManager) {
                // Use proper ELO calculator
                const ratingResult = window.ratingManager.calculateNewRating(
                    myRating,
                    opponentRating,
                    result.won,
                    gamesPlayed
                );
                stats.ranked_rating = ratingResult.newRating;
                stats.last_rating_change = ratingResult.change;
            } else {
                // Fallback ELO calculation
                const k = gamesPlayed < 10 ? 40 : 24;
                const expected = 1 / (1 + Math.pow(10, (opponentRating - myRating) / 400));
                const actual = result.won ? 1 : 0;
                const change = Math.round(k * (actual - expected));
                stats.ranked_rating = Math.max(100, myRating + change);
                stats.last_rating_change = change;
            }

            // Track peak rating
            stats.peak_rating = Math.max(stats.peak_rating || 1000, stats.ranked_rating);
        }
        return stats;
    }

    _getDefaultStats() {
        return {
            wins: 0,
            losses: 0,
            total_games: 0,
            ranked_games: 0,
            current_streak: 0,
            best_streak: 0,
            ranked_rating: 1000,
            peak_rating: 1000,
            last_rating_change: 0,
            last_played: null
        };
    }

    /**
     * Award RTC currency for playing an arcade game
     * 5 RTC for playing, 10 for winning, 15 for ranked win
     */
    async _awardRtcForGame(gameId, result) {
        const supabase = window.portalAuth?.supabase;
        if (!supabase) return;

        // RTC belongs to the portal PROFILE: the balance is looked up by
        // profile id, which is not always the login id. And it must not need
        // Firebase - with the arcade offline, beating the computer paid nothing.
        const userId = window.portalAuth?.userProfile?.id || this.firebase?.supabaseUserId;
        if (!userId) return;

        // Conceding pays nothing: +5 for a forfeit let two friends take turns
        // conceding for RTC.
        if (result.forfeit) return;

        let amount = 5; // Base: played a game
        let desc = `Played ${gameId}`;

        if (result.vsAI) {
            // Against the computer only a win pays, by difficulty, up to a
            // daily limit - Easy is there to learn on, not to farm. (Checked
            // here in the browser only; the real limit belongs server-side.)
            if (!result.won) return;
            amount = RIUTIZ_AI_RTC[result.difficulty] || 0;
            if (!amount) return;
            const day = new Date().toISOString().slice(0, 10);
            const key = `arcade-ai-rtc-${userId}-${gameId}-${day}`;
            let earned = 0;
            try { earned = parseInt(localStorage.getItem(key), 10) || 0; } catch (e) {}
            amount = Math.min(amount, AI_RTC_DAILY_CAP - earned);
            if (amount <= 0) return;
            try { localStorage.setItem(key, String(earned + amount)); } catch (e) {}
            desc = `Beat the ${result.difficulty} computer in ${gameId}`;
        } else if (result.won && result.ranked) {
            amount = 15;
            desc = `Ranked win in ${gameId}`;
        } else if (result.won) {
            amount = 10;
            desc = `Won ${gameId}`;
        }

        // An online match pays once per player however often this runs (the
        // server refuses a second award with the same reference); a game
        // against the computer is its own session.
        const refId = result.matchId ? `arcade_${gameId}_${result.matchId}` : `arcade_${gameId}_${Date.now()}`;

        await supabase.rpc('process_rtc_transaction', {
            p_user_id: userId,
            p_amount: amount,
            p_transaction_type: 'earn_arcade',
            p_description: desc,
            p_reference_id: refId,
            p_reference_type: 'arcade_game'
        });
    }

    // ==========================================
    // Player Listeners
    // ==========================================

    /**
     * Subscribe to player profile changes
     * @param {Function} callback - Called when player data changes
     */
    onPlayerChange(callback) {
        this._playerListeners.push(callback);
        // Immediately call with current data
        if (this.player) callback(this.player);

        // Set up Firebase listener once (not per subscriber)
        if (!this._playerRefListener) {
            const playerRef = this.firebase?.playerRef();
            if (playerRef) {
                this._playerRefListener = (snapshot) => {
                    if (snapshot.exists()) {
                        this.player = snapshot.val();
                        this._notifyPlayerListeners();
                    }
                };
                playerRef.on('value', this._playerRefListener);
            }
        }
    }

    /**
     * Unsubscribe from player changes
     */
    offPlayerChange(callback) {
        this._playerListeners = this._playerListeners.filter(cb => cb !== callback);
    }

    _notifyPlayerListeners() {
        this._playerListeners.forEach(cb => cb(this.player));
    }

    // ==========================================
    // Utility
    // ==========================================

    /**
     * Check if arcade is online
     */
    get isOnline() {
        return this.firebase?.isOnline || false;
    }

    /**
     * Check if arcade is initialized
     */
    get isInitialized() {
        return this._initialized;
    }

    /**
     * Get current user's Supabase ID
     */
    get userId() {
        return this.firebase?.supabaseUserId || this.player?.supabase_user_id;
    }

    /**
     * Clean up resources
     */
    destroy() {
        // Remove Firebase player listener
        if (this._playerRefListener) {
            const playerRef = this.firebase?.playerRef();
            if (playerRef) playerRef.off('value', this._playerRefListener);
            this._playerRefListener = null;
        }
        this._playerListeners = [];
        this.firebase?.destroy();
    }
}

// Create global instance
window.ArcadeManager = ArcadeManager;

// Global arcade instance (initialized by games)
window.arcade = null;

/**
 * Helper function to initialize arcade system
 * @param {Object} options - Configuration options
 * @returns {Promise<ArcadeManager>}
 */
async function initializeArcade(options = {}) {
    if (window.arcade && window.arcade.isInitialized) {
        return window.arcade;
    }

    window.arcade = new ArcadeManager();
    await window.arcade.initialize(options);
    return window.arcade;
}

window.initializeArcade = initializeArcade;

// Export for ES6 modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ArcadeManager, initializeArcade };
}
