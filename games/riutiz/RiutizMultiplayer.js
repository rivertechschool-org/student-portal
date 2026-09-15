// games/riutiz/RiutizMultiplayer.js
// Multiplayer adapter for RIUTIZ - bridges game logic with Firebase sync

class RiutizMultiplayer {
    constructor(game, arcade) {
        this.game = game;
        this.arcade = arcade;
        this.sync = null;
        this.matchmaking = null;

        this.matchId = null;
        this.localPlayerNumber = null;
        this.isHost = false;

        this._pendingActions = [];
        this._onMatchStart = null;
        this._onMatchEnd = null;
        this._onOpponentAction = null;
        this._onStatusChange = null;
    }

    /**
     * Initialize multiplayer systems
     */
    async initialize() {
        if (!this.arcade || !this.arcade.isInitialized) {
            throw new Error('Arcade not initialized');
        }

        this.matchmaking = new MatchmakingManager(this.arcade, 'riutiz');
        this.sync = new MultiplayerSync(this.arcade, 'riutiz');

        // One lobby listener for the life of this session (create/leave/join used to
        // stack a new closure each time, so a later match start joined N times)
        this._lobbyHandler = (data) => {
            if (data && data.event === 'match_started') this.joinMatch(data.matchId);
        };

        // Hook into game events
        this.game.addEventListener('cardPlayed', (e) => this.onLocalAction('play_card', e.detail));
        this.game.addEventListener('cardPlayedAsResource', (e) => this.onLocalAction('play_resource', e.detail));
        this.game.addEventListener('attackerToggled', (e) => this.onLocalAction('toggle_attacker', e.detail));
        this.game.addEventListener('blockerToggled', (e) => this.onLocalAction('toggle_blocker', e.detail));
        this.game.addEventListener('combatResolved', (e) => this.onLocalAction('combat_resolved', e.detail));
        this.game.addEventListener('turnEnded', (e) => this.onLocalEndTurn(e.detail));
        this.game.addEventListener('abilityActivated', (e) => this.onLocalAction('activate_ability', e.detail));
    }

    // ==========================================
    // Matchmaking
    // ==========================================

    /**
     * Join matchmaking queue
     */
    async joinQueue(options = {}) {
        const matchId = await this.matchmaking.joinQueue(options);
        await this.joinMatch(matchId);
        return matchId;
    }

    /**
     * Leave matchmaking queue
     */
    async leaveQueue() {
        await this.matchmaking.leaveQueue();
    }

    /**
     * Create a private lobby
     */
    async createLobby(options = {}) {
        const result = await this.matchmaking.createLobby(options);
        this.isHost = true;

        // Listen for match start
        this.matchmaking.offLobbyChange(this._lobbyHandler);
        this.matchmaking.onLobbyChange(this._lobbyHandler);

        return result;
    }

    /**
     * Join a lobby
     */
    async joinLobby(lobbyIdOrCode, options = {}) {
        const lobby = await this.matchmaking.joinLobby(lobbyIdOrCode, options);
        this.isHost = false;

        // Listen for match start
        this.matchmaking.offLobbyChange(this._lobbyHandler);
        this.matchmaking.onLobbyChange(this._lobbyHandler);

        return lobby;
    }

    /**
     * Set ready status in lobby
     */
    async setReady(ready, deckId) {
        await this.matchmaking.setReady(ready, deckId);
    }

    /**
     * Start match from lobby (host only)
     */
    async startMatchFromLobby() {
        const matchId = await this.matchmaking.startMatch();
        await this.joinMatch(matchId);
        return matchId;
    }

    /**
     * Leave current lobby
     */
    async leaveLobby() {
        await this.matchmaking.leaveLobby();
        // MatchmakingManager.leaveLobby detaches the Firebase ref but keeps every
        // callback; the next lobby would notify all of them.
        this.matchmaking._lobbyListeners = [];
    }

    // ==========================================
    // Match Handling
    // ==========================================

    /**
     * Join an existing match
     */
    async joinMatch(matchId) {
        // The host reaches here twice (its own startMatch call and the lobby listener);
        // a second join duplicated every Firebase listener and every UI.
        if (this.matchId === matchId && this.sync && this.sync.isConnected) {
            return this.sync.match;
        }
        this.matchId = matchId;
        this._resultRecorded = false;

        // Initialize sync
        const match = await this.sync.initialize(matchId);
        this.localPlayerNumber = this.sync.localPlayerNumber;

        // Set up listeners
        this.sync.onStateChange((state) => this.onRemoteStateChange(state));
        this.sync.onAction((action) => this.onRemoteAction(action));
        this.sync.onStatusChange((status, data) => this.onMatchStatusChange(status, data));

        // Initialize game if we're player 1 (host initializes state)
        if (this.localPlayerNumber === 1) {
            await this.initializeGameState(match);
        } else {
            // Wait for game state from host
            if (match.game_state) {
                this.game.loadState(match.game_state);
            }
        }

        // Update match status
        await this.sync.updateMatch({ status: 'active', started_at: Date.now() });

        if (this._onMatchStart) {
            this._onMatchStart(match);
        }

        return match;
    }

    /**
     * Initialize game state (host only)
     */
    async initializeGameState(match) {
        // Both seats' chosen decks (match.players[n].deck_id) are still ignored: the
        // host would have to read the guest's deck node from Firebase, which the
        // database rules do not allow yet. Random 40-card decks for now.
        this.game.player1Deck = null;
        this.game.player2Deck = null;

        // Start game
        this.game.startGame();

        // Sync initial state
        await this.syncState();
    }

    /**
     * Sync current game state to Firebase
     */
    async syncState() {
        if (!this.sync.isConnected) return;

        const state = this.game.getSerializableState();
        state.current_player = state.currentPlayer;      // the key MultiplayerSync gates on
        state.lastWriter = this.localPlayerNumber;
        await this.sync.updateGameState(state);
    }

    /**
     * Handle local player action
     */
    async onLocalAction(actionType, detail) {
        if (!this.sync || !this.sync.isConnected) return;

        const isOurTurn = this.game.isPlayerTurn(this.localPlayerNumber);
        // The defender acts off-turn: declaring blockers and resolving the combat
        const isDefending = !isOurTurn &&
            (this.game.state.combatStep === 'declare-blockers' || actionType === 'combat_resolved');

        if (!isOurTurn && !isDefending) return;

        try {
            if (isOurTurn) {
                await this.sync.submitAction({ type: actionType, ...detail });
                await this.syncState();
            } else {
                // MultiplayerSync refuses off-turn actions and state writes, so the
                // defender's blockers and the combat result never reached the attacker.
                // Write the state directly: it is what the attacker loads.
                const state = this.game.getSerializableState();
                state.current_player = state.currentPlayer;
                state.lastWriter = this.localPlayerNumber;
                await this.sync.updateMatch({ game_state: state });
            }
        } catch (error) {
            console.error('Failed to sync action:', error);
        }
    }

    /**
     * Hand the turn over. MultiplayerSync.endTurn() was never called, so
     * match.current_player stayed at 1 for the whole match and player 2 could
     * never submit anything.
     */
    async onLocalEndTurn(detail) {
        if (!this.sync || !this.sync.isConnected) return;
        if (!detail || detail.player !== this.localPlayerNumber) return;
        try {
            const state = this.game.getSerializableState();
            state.current_player = state.currentPlayer;
            state.lastWriter = this.localPlayerNumber;
            await this.sync.updateGameState(state);          // still our turn: allowed
            await this.sync.updateMatch({
                current_player: detail.nextPlayer,
                turn: this.game.state.turn,
                phase: 'draw'
            });
        } catch (error) {
            console.error('Failed to hand the turn over:', error);
        }
    }

    /**
     * Handle remote state change
     */
    onRemoteStateChange(state) {
        if (!state) return;

        // Load whatever the OTHER seat wrote (its turn, its blockers, its combat
        // result) and skip the echo of our own writes. The old check read
        // `state.current_player`, a key the serialized state never had.
        const writer = state.lastWriter !== undefined ? state.lastWriter : state.currentPlayer;
        if (writer !== this.localPlayerNumber) {
            this.game.loadState(state);
        }
    }

    /**
     * Handle remote action from opponent
     */
    onRemoteAction(action) {
        if (!action) return;

        // Skip our own actions
        if (action.player === this.localPlayerNumber) return;

        const opponentNum = this.localPlayerNumber === 1 ? 2 : 1;

        // Apply opponent's action to local game
        switch (action.type) {
            case 'play_card':
                this.game.playCard(opponentNum, action.card.instanceId, false);
                break;

            case 'play_resource':
                this.game.playCard(opponentNum, action.card.instanceId, true);
                break;

            case 'toggle_attacker':
                this.game.toggleAttacker(opponentNum, action.card.instanceId);
                break;

            case 'toggle_blocker':
                this.game.toggleBlocker(opponentNum, action.blocker?.instanceId, action.attackerId);
                break;

            case 'activate_ability':
                this.game.activateAbility(opponentNum, action.card.instanceId);
                break;

            case 'end_turn':
                // State should already be synced
                break;

            case 'combat_resolved':
                // Combat results should be reflected in state sync
                break;
        }

        if (this._onOpponentAction) {
            this._onOpponentAction(action);
        }
    }

    /**
     * Handle match status changes
     */
    onMatchStatusChange(status, data) {
        switch (status) {
            case 'opponent_disconnected':
                // Show warning to player
                break;

            case 'opponent_reconnected':
                // Clear warning
                break;

            case 'completed':
                this.onMatchEnd(data.winner === this.localPlayerNumber, data);
                break;

            case 'abandoned':
                this.onMatchEnd(data.winner === this.localPlayerNumber, data);
                break;
        }

        if (this._onStatusChange) {
            this._onStatusChange(status, data);
        }
    }

    /**
     * Handle match end
     */
    onMatchEnd(won, data) {
        // Record result is handled by MultiplayerSync
        if (this._onMatchEnd) {
            this._onMatchEnd(won, data);
        }
    }

    /**
     * Forfeit the current match
     */
    async forfeit() {
        if (this.sync) {
            await this.sync.abandonMatch();
        }
    }

    // ==========================================
    // Spectating
    // ==========================================

    /**
     * Spectate a match
     */
    async spectateMatch(matchId) {
        this.matchId = matchId;
        this.localPlayerNumber = null;

        const match = await this.sync.spectate(matchId);

        // Set up read-only listeners
        this.sync.onStateChange((state) => {
            if (state) {
                this.game.loadState(state);
            }
        });

        return match;
    }

    /**
     * Stop spectating
     */
    async stopSpectating() {
        if (this.sync) {
            await this.sync.stopSpectating();
        }
    }

    // ==========================================
    // Event Callbacks
    // ==========================================

    onMatchStartCallback(callback) {
        this._onMatchStart = callback;
    }

    onMatchEndCallback(callback) {
        this._onMatchEnd = callback;
    }

    onOpponentActionCallback(callback) {
        this._onOpponentAction = callback;
    }

    onStatusChangeCallback(callback) {
        this._onStatusChange = callback;
    }

    // ==========================================
    // Utility
    // ==========================================

    /**
     * Get lobby info
     */
    get currentLobby() {
        return this.matchmaking?.currentLobby;
    }

    /**
     * Clean up
     */
    destroy() {
        if (this.sync) {
            this.sync.destroy();
        }
        if (this.matchmaking) {
            this.matchmaking.destroy();
        }
    }
}

// Export
window.RiutizMultiplayer = RiutizMultiplayer;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizMultiplayer };
}
