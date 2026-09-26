// shared/arcade/MatchmakingManager.js
// Handles matchmaking queues, lobbies, and match creation

class MatchmakingManager {
    constructor(arcade, gameId) {
        this.arcade = arcade;
        this.gameId = gameId;
        this.firebase = arcade.firebase;

        this.currentLobby = null;
        this.currentMatch = null;
        this.inQueue = false;

        this._queueRef = null;
        this._lobbyRef = null;
        this._matchRef = null;
        this._lobbyListeners = [];
        this._matchListeners = [];
        this._queueCallback = null;
    }

    // ==========================================
    // Queue System
    // ==========================================

    /**
     * Join the matchmaking queue
     * @param {Object} options - Queue options
     * @param {string} options.mode - 'casual' or 'ranked'
     * @param {string} options.deckId - Selected deck ID
     * @returns {Promise<string>} Match ID when found
     */
    // What a player publishes about their deck. deck_cards is a comma-joined
    // list of card ids - the opponent's client cannot read your saved decks,
    // and a plain string survives the database untouched.
    static deckFields(options = {}) {
        const d = options.deck || null;
        return {
            deck_id: (d && d.id) || options.deckId || null,
            deck_name: (d && d.name) || null,
            deck_cards: d && Array.isArray(d.cards) ? d.cards.map(String).join(',') : null
        };
    }

    async joinQueue(options = {}) {
        if (this.inQueue) {
            throw new Error('Already in queue');
        }

        const userId = this.firebase.supabaseUserId;
        if (!userId) {
            throw new Error('Not authenticated');
        }

        const mode = options.mode || 'casual';

        // Get player rating for matchmaking
        const stats = await this.arcade.getStats(this.gameId);

        this._queueRef = this.firebase.ref(`arcade/matchmaking/${this.gameId}/queue/${userId}`);

        await this._queueRef.set({
            user_id: userId,
            display_name: this.arcade.player?.display_name || 'Player',
            mode: mode,
            ...MatchmakingManager.deckFields(options),
            rating: stats.ranked_rating || 1000,
            joined_at: this.firebase.serverTimestamp
        });

        // Clean up queue entry on disconnect
        this._queueRef.onDisconnect().remove();

        this.inQueue = true;
        console.log('Joined matchmaking queue');

        // Start looking for a match
        return this._findMatch(mode);
    }

    /**
     * Leave the matchmaking queue
     */
    async leaveQueue() {
        if (!this.inQueue) return;

        if (this._queueRef) {
            this._queueRef.onDisconnect().cancel();
            await this._queueRef.remove();
            this._queueRef = null;
        }

        if (this._queueCallback) {
            this._queueCallback = null;
        }

        this.inQueue = false;
        console.log('Left matchmaking queue');
    }

    /**
     * Find a match in the queue
     * @param {string} mode - Game mode
     * @returns {Promise<string>} Match ID
     */
    async _findMatch(mode) {
        const queueRef = this.firebase.ref(`arcade/matchmaking/${this.gameId}/queue`);
        const userId = this.firebase.supabaseUserId;
        const myStats = await this.arcade.getStats(this.gameId);
        const myRating = myStats.ranked_rating || 1000;
        const queueStartTime = Date.now();

        return new Promise((resolve, reject) => {
            let resolved = false;
            let checkInterval = null;

            const checkForMatch = async () => {
                if (resolved || !this.inQueue) return;

                try {
                    const snapshot = await queueRef.once('value');
                    const queue = snapshot.val() || {};

                    // Calculate wait time for matchmaking range expansion
                    const waitTime = Math.floor((Date.now() - queueStartTime) / 1000);
                    const ratingRange = window.ratingManager
                        ? window.ratingManager.getMatchmakingRange(myRating, waitTime)
                        : { minRating: myRating - 200, maxRating: myRating + 200 };

                    // Find other players in the same mode within rating range
                    const candidates = Object.entries(queue)
                        .filter(([id, data]) => {
                            if (id === userId) return false;
                            if (data.mode !== mode) return false;

                            // For ranked, filter by rating range
                            if (mode === 'ranked') {
                                const theirRating = data.rating || 1000;
                                return theirRating >= ratingRange.minRating &&
                                       theirRating <= ratingRange.maxRating;
                            }
                            return true;
                        })
                        .map(([id, data]) => ({
                            id,
                            ...data,
                            ratingDiff: Math.abs((data.rating || 1000) - myRating),
                            matchQuality: window.ratingManager
                                ? window.ratingManager.getMatchQuality(myRating, data.rating || 1000)
                                : 100 - Math.abs((data.rating || 1000) - myRating) / 10
                        }))
                        // Sort by match quality (highest first), then by rating difference
                        .sort((a, b) => {
                            if (b.matchQuality !== a.matchQuality) {
                                return b.matchQuality - a.matchQuality;
                            }
                            return a.ratingDiff - b.ratingDiff;
                        });

                    if (candidates.length > 0) {
                        // Found a match! Create the game
                        const opponent = candidates[0];

                        // Only the player who joined first creates the match
                        // (determined by who has the lower timestamp or alphabetically lower ID)
                        const myData = queue[userId];
                        const shouldCreate =
                            (myData.joined_at < opponent.joined_at) ||
                            (myData.joined_at === opponent.joined_at && userId < opponent.id);

                        if (shouldCreate) {
                            resolved = true;
                            clearInterval(checkInterval);

                            const matchId = await this._createMatch(
                                { ...myData, id: userId, rating: myRating },
                                { ...opponent, id: opponent.id, rating: opponent.rating || 1000 },
                                mode
                            );

                            // Clean up queue entries
                            await queueRef.child(userId).remove();
                            await queueRef.child(opponent.id).remove();

                            this.inQueue = false;
                            resolve(matchId);
                        }
                    }
                } catch (error) {
                    console.error('Error checking for match:', error);
                }
            };

            // Check immediately and then every 2 seconds
            checkForMatch();
            checkInterval = setInterval(checkForMatch, 2000);

            // Also listen for being matched by another player
            this._queueRef.on('child_removed', () => {
                // Queue entry was removed - either we matched or left
                if (!resolved && !this.inQueue) {
                    clearInterval(checkInterval);
                }
            });

            // Listen for match assignment
            this._queueRef.on('value', async (snapshot) => {
                const data = snapshot.val();
                if (data?.match_id && !resolved) {
                    resolved = true;
                    clearInterval(checkInterval);
                    this.inQueue = false;
                    resolve(data.match_id);
                }
            });

            // Store callback for cancellation
            this._queueCallback = () => {
                resolved = true;
                clearInterval(checkInterval);
                reject(new Error('Queue cancelled'));
            };
        });
    }

    /**
     * Create a new match
     */
    // seat1/seat2: { id, display_name, deck_id, deck_name, deck_cards, rating }.
    // Each seat keeps its own name - the second seat used to be "Opponent" and
    // the first the local player, whoever that was.
    async _createMatch(seat1, seat2, mode) {
        const player1Id = seat1.id, player2Id = seat2.id;
        const matchId = this.firebase.generateId();
        const matchRef = this.firebase.ref(`arcade/matches/${this.gameId}/${matchId}`);

        const match = {
            id: matchId,
            game: this.gameId,
            mode: mode,
            status: 'starting',
            created_at: this.firebase.serverTimestamp,
            started_at: null,
            ended_at: null,
            turn: 1,
            current_player: 1,
            phase: 'draw',
            combat_step: null,
            players: {
                1: {
                    supabase_user_id: player1Id,
                    display_name: seat1.display_name || 'Player 1',
                    deck_id: seat1.deck_id || null,
                    deck_name: seat1.deck_name || null,
                    deck_cards: seat1.deck_cards || null,
                    rating: seat1.rating || 1000,
                    connected: true,
                    last_action: this.firebase.serverTimestamp,
                    points: 0
                },
                2: {
                    supabase_user_id: player2Id,
                    display_name: seat2.display_name || 'Player 2',
                    deck_id: seat2.deck_id || null,
                    deck_name: seat2.deck_name || null,
                    deck_cards: seat2.deck_cards || null,
                    rating: seat2.rating || 1000,
                    connected: false,
                    last_action: null,
                    points: 0
                }
            },
            game_state: null,
            action_log: [],
            spectator_count: 0,
            allow_spectators: true
        };

        await matchRef.set(match);

        // Also notify the other player
        await this.firebase.ref(`arcade/matchmaking/${this.gameId}/queue/${player2Id}`).update({
            match_id: matchId
        });

        console.log('Created match:', matchId);
        return matchId;
    }

    // ==========================================
    // Lobby System
    // ==========================================

    /**
     * Create a new lobby
     * @param {Object} options - Lobby options
     * @returns {Promise<string>} Lobby ID
     */
    async createLobby(options = {}) {
        const userId = this.firebase.supabaseUserId;
        if (!userId) {
            throw new Error('Not authenticated');
        }

        const lobbyId = this.firebase.generateId();
        const lobbyRef = this.firebase.ref(`arcade/matchmaking/${this.gameId}/lobbies/${lobbyId}`);

        // Generate a short join code
        const joinCode = this._generateJoinCode();

        const lobby = {
            id: lobbyId,
            join_code: joinCode,
            host_id: userId,
            host_name: this.arcade.player?.display_name || 'Host',
            mode: options.mode || 'casual',
            allow_spectators: options.allowSpectators !== false,
            status: 'waiting',
            max_players: 2,
            players: {
                [userId]: {
                    user_id: userId,
                    display_name: this.arcade.player?.display_name || 'Host',
                    ready: false,
                    ...MatchmakingManager.deckFields(options),
                    is_host: true,
                    joined_at: this.firebase.serverTimestamp
                }
            },
            created_at: this.firebase.serverTimestamp
        };

        await lobbyRef.set(lobby);

        // Clean up lobby on disconnect
        lobbyRef.onDisconnect().remove();

        this.currentLobby = lobby;
        this._lobbyRef = lobbyRef;
        this._setupLobbyListeners();

        console.log('Created lobby:', lobbyId, 'Join code:', joinCode);
        return { lobbyId, joinCode };
    }

    /**
     * Get lobby info without joining (peek at mode, player count, etc.)
     * @param {string} lobbyIdOrCode - Lobby ID or join code
     * @returns {Promise<Object|null>} Lobby info or null if not found
     */
    async getLobbyInfo(lobbyIdOrCode) {
        try {
            let lobby;

            // Check if it's a join code (6 characters) or full ID
            if (lobbyIdOrCode.length <= 8) {
                // Search by join code
                const lobbiesRef = this.firebase.ref(`arcade/matchmaking/${this.gameId}/lobbies`);
                const snapshot = await lobbiesRef.orderByChild('join_code').equalTo(lobbyIdOrCode.toUpperCase()).once('value');

                if (!snapshot.exists()) return null;

                const lobbies = snapshot.val();
                const lobbyId = Object.keys(lobbies)[0];
                lobby = lobbies[lobbyId];
            } else {
                // Full lobby ID
                const lobbyRef = this.firebase.ref(`arcade/matchmaking/${this.gameId}/lobbies/${lobbyIdOrCode}`);
                const snapshot = await lobbyRef.once('value');

                if (!snapshot.exists()) return null;

                lobby = snapshot.val();
            }

            return {
                id: lobby.id,
                mode: lobby.mode,
                host_name: lobby.host_name,
                player_count: Object.keys(lobby.players || {}).length,
                max_players: lobby.max_players,
                status: lobby.status
            };
        } catch (error) {
            console.error('Error getting lobby info:', error);
            return null;
        }
    }

    /**
     * Join a lobby by ID or code
     * @param {string} lobbyIdOrCode - Lobby ID or join code
     * @param {Object} options - Join options
     * @param {string} options.deckId - Selected deck ID
     * @returns {Promise<Object>} Lobby data
     */
    async joinLobby(lobbyIdOrCode, options = {}) {
        const userId = this.firebase.supabaseUserId;
        if (!userId) {
            throw new Error('Not authenticated');
        }

        let lobbyRef;
        let lobby;

        // Check if it's a join code (6 characters) or full ID
        if (lobbyIdOrCode.length <= 8) {
            // Search by join code
            const lobbiesRef = this.firebase.ref(`arcade/matchmaking/${this.gameId}/lobbies`);
            const snapshot = await lobbiesRef.orderByChild('join_code').equalTo(lobbyIdOrCode.toUpperCase()).once('value');

            if (!snapshot.exists()) {
                throw new Error('Lobby not found');
            }

            const lobbies = snapshot.val();
            const lobbyId = Object.keys(lobbies)[0];
            lobby = lobbies[lobbyId];
            lobbyRef = this.firebase.ref(`arcade/matchmaking/${this.gameId}/lobbies/${lobbyId}`);
        } else {
            // Full lobby ID
            lobbyRef = this.firebase.ref(`arcade/matchmaking/${this.gameId}/lobbies/${lobbyIdOrCode}`);
            const snapshot = await lobbyRef.once('value');

            if (!snapshot.exists()) {
                throw new Error('Lobby not found');
            }

            lobby = snapshot.val();
        }

        // Check if lobby is full
        const playerCount = Object.keys(lobby.players || {}).length;
        if (playerCount >= lobby.max_players) {
            throw new Error('Lobby is full');
        }

        // Check if lobby is still waiting
        if (lobby.status !== 'waiting') {
            throw new Error('Lobby is no longer accepting players');
        }

        // Join the lobby
        await lobbyRef.child(`players/${userId}`).set({
            user_id: userId,
            display_name: this.arcade.player?.display_name || 'Player',
            ready: false,
            ...MatchmakingManager.deckFields(options),
            is_host: false,
            joined_at: this.firebase.serverTimestamp
        });

        // Remove self from lobby on disconnect
        lobbyRef.child(`players/${userId}`).onDisconnect().remove();

        this.currentLobby = lobby;
        this._lobbyRef = lobbyRef;
        this._setupLobbyListeners();

        console.log('Joined lobby:', lobby.id);
        return lobby;
    }

    /**
     * Leave current lobby
     */
    async leaveLobby() {
        if (!this.currentLobby || !this._lobbyRef) return;

        const userId = this.firebase.supabaseUserId;
        const isHost = this.currentLobby.host_id === userId;

        if (isHost) {
            // Host leaving - close the lobby
            await this._lobbyRef.remove();
        } else {
            // Player leaving
            this._lobbyRef.child(`players/${userId}`).onDisconnect().cancel();
            await this._lobbyRef.child(`players/${userId}`).remove();
        }

        this._cleanupLobbyListeners();
        this.currentLobby = null;
        this._lobbyRef = null;

        console.log('Left lobby');
    }

    /**
     * Set ready status in lobby
     * @param {boolean} ready - Ready state
     * @param {string} deckId - Selected deck ID
     */
    // deck: the { id, name, cards } being brought, or (older callers) a deck id.
    async setReady(ready, deck = null) {
        if (!this._lobbyRef) return;

        const userId = this.firebase.supabaseUserId;
        const fields = deck && typeof deck === 'object' ? MatchmakingManager.deckFields({ deck })
                                                        : { deck_id: deck };
        await this._lobbyRef.child(`players/${userId}`).update({ ready: ready, ...fields });
    }

    /**
     * Start the match (host only)
     * @returns {Promise<string>} Match ID
     */
    async startMatch() {
        if (!this.currentLobby || !this._lobbyRef) {
            throw new Error('Not in a lobby');
        }

        const userId = this.firebase.supabaseUserId;
        if (this.currentLobby.host_id !== userId) {
            throw new Error('Only the host can start the match');
        }

        // Get current lobby state
        const snapshot = await this._lobbyRef.once('value');
        const lobby = snapshot.val();

        // Check all players are ready
        const players = Object.entries(lobby.players || {});
        if (players.length < 2) {
            throw new Error('Need at least 2 players');
        }

        const allReady = players.every(([_, p]) => p.ready);
        if (!allReady) {
            throw new Error('Not all players are ready');
        }

        // Create the match. The host is seat 1: object key order is id order,
        // which used to seat whoever happened to sort first.
        const seats = players.map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => (b.is_host ? 1 : 0) - (a.is_host ? 1 : 0));

        const matchId = await this._createMatch(seats[0], seats[1], lobby.mode);

        // Update lobby status
        await this._lobbyRef.update({
            status: 'started',
            match_id: matchId
        });

        return matchId;
    }

    /**
     * Kick a player from lobby (host only)
     * @param {string} playerId - Player to kick
     */
    async kickPlayer(playerId) {
        if (!this.currentLobby || !this._lobbyRef) return;

        const userId = this.firebase.supabaseUserId;
        if (this.currentLobby.host_id !== userId) {
            throw new Error('Only the host can kick players');
        }

        if (playerId === userId) {
            throw new Error('Cannot kick yourself');
        }

        await this._lobbyRef.child(`players/${playerId}`).remove();
    }

    /**
     * Generate a short join code
     */
    _generateJoinCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding similar chars
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    /**
     * Set up lobby listeners
     */
    _setupLobbyListeners() {
        if (!this._lobbyRef) return;

        this._lobbyRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                this.currentLobby = snapshot.val();
                this._notifyLobbyListeners();

                // Check if match started
                if (this.currentLobby.status === 'started' && this.currentLobby.match_id) {
                    this._notifyLobbyListeners({ event: 'match_started', matchId: this.currentLobby.match_id });
                }
            } else {
                // Lobby was deleted
                this._notifyLobbyListeners({ event: 'lobby_closed' });
                this.currentLobby = null;
            }
        });
    }

    _cleanupLobbyListeners() {
        if (this._lobbyRef) {
            this._lobbyRef.off();
        }
    }

    /**
     * Subscribe to lobby changes
     */
    onLobbyChange(callback) {
        this._lobbyListeners.push(callback);
        if (this.currentLobby) callback(this.currentLobby);
    }

    offLobbyChange(callback) {
        this._lobbyListeners = this._lobbyListeners.filter(cb => cb !== callback);
    }

    _notifyLobbyListeners(event = null) {
        const data = event || this.currentLobby;
        this._lobbyListeners.forEach(cb => cb(data));
    }

    // ==========================================
    // Active Matches Browser
    // ==========================================

    /**
     * Get list of active lobbies
     * @returns {Promise<Array>}
     */
    async getActiveLobbies() {
        const ref = this.firebase.ref(`arcade/matchmaking/${this.gameId}/lobbies`);
        const snapshot = await ref.orderByChild('status').equalTo('waiting').once('value');

        const lobbies = [];
        snapshot.forEach(child => {
            lobbies.push({ id: child.key, ...child.val() });
        });

        return lobbies;
    }

    /**
     * Get list of active matches (for spectating)
     * @returns {Promise<Array>}
     */
    async getActiveMatches() {
        const ref = this.firebase.ref(`arcade/matches/${this.gameId}`);
        const snapshot = await ref.orderByChild('status').equalTo('active').once('value');

        const matches = [];
        snapshot.forEach(child => {
            const match = child.val();
            if (match.allow_spectators) {
                matches.push({ id: child.key, ...match });
            }
        });

        return matches;
    }

    // ==========================================
    // Cleanup
    // ==========================================

    destroy() {
        this.leaveQueue();
        this.leaveLobby();
        this._lobbyListeners = [];
        this._matchListeners = [];
    }
}

// Export
window.MatchmakingManager = MatchmakingManager;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MatchmakingManager };
}
