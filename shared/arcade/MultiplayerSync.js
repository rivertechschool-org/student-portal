// shared/arcade/MultiplayerSync.js
// Real-time game state synchronization for multiplayer matches

class MultiplayerSync {
    constructor(arcade, gameId) {
        this.arcade = arcade;
        this.gameId = gameId;
        this.firebase = arcade.firebase;

        this.matchId = null;
        this.match = null;
        this.localPlayerNumber = null;
        this.opponentPlayerNumber = null;

        this._matchRef = null;
        this._gameStateRef = null;
        this._actionLogRef = null;
        this._actionQueue = [];
        this._stateListeners = [];
        this._actionListeners = [];
        this._statusListeners = [];
        this._reconnectTimeout = null;
        this._turnTimer = null;
        this._turnTimeLimit = 60000; // 60 seconds per turn

        this.isConnected = false;
        this.lastActionTime = null;
    }

    /**
     * Initialize sync for a match
     * @param {string} matchId - Match ID to sync
     * @returns {Promise<Object>} Initial match state
     */
    async initialize(matchId) {
        this.matchId = matchId;
        this._matchRef = this.firebase.ref(`arcade/matches/${this.gameId}/${matchId}`);

        // Load initial match state
        const snapshot = await this._matchRef.once('value');
        if (!snapshot.exists()) {
            throw new Error('Match not found');
        }

        this.match = snapshot.val();

        // Determine which player we are
        const userId = this.firebase.supabaseUserId;
        if (this.match.players['1'].supabase_user_id === userId) {
            this.localPlayerNumber = 1;
            this.opponentPlayerNumber = 2;
        } else if (this.match.players['2'].supabase_user_id === userId) {
            this.localPlayerNumber = 2;
            this.opponentPlayerNumber = 1;
        } else {
            throw new Error('You are not a player in this match');
        }

        // Mark as connected
        await this._matchRef.child(`players/${this.localPlayerNumber}`).update({
            connected: true,
            last_action: this.firebase.serverTimestamp
        });

        // Set disconnection handler
        this._matchRef.child(`players/${this.localPlayerNumber}/connected`).onDisconnect().set(false);

        // Set up listeners
        this._setupListeners();

        // Update arcade manager
        await this.arcade.setCurrentMatch(matchId);

        this.isConnected = true;
        console.log('MultiplayerSync initialized for match:', matchId, 'as player', this.localPlayerNumber);

        return this.match;
    }

    /**
     * Set up Firebase listeners
     */
    _setupListeners() {
        // Listen for full match state changes
        this._matchRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                const newMatch = snapshot.val();
                const oldMatch = this.match;
                this.match = newMatch;

                // Check for status changes
                if (oldMatch?.status !== newMatch.status) {
                    this._notifyStatusListeners(newMatch.status, newMatch);
                }

                // Notify state listeners
                this._notifyStateListeners(newMatch.game_state);
            }
        });

        // Listen for new actions
        this._actionLogRef = this._matchRef.child('action_log');
        this._actionLogRef.orderByKey().limitToLast(1).on('child_added', (snapshot) => {
            const action = snapshot.val();
            if (action && action.player !== this.localPlayerNumber) {
                // Received opponent's action
                this._notifyActionListeners(action);
            }
        });

        // Listen for opponent connection status
        this._matchRef.child(`players/${this.opponentPlayerNumber}/connected`).on('value', (snapshot) => {
            const connected = snapshot.val();
            if (!connected) {
                this._handleOpponentDisconnect();
            } else {
                this._handleOpponentReconnect();
            }
        });
    }

    /**
     * Submit a game action
     * @param {Object} action - Action data
     * @returns {Promise<void>}
     */
    async submitAction(action) {
        if (!this.isConnected) {
            throw new Error('Not connected to match');
        }

        if (!this.isMyTurn()) {
            throw new Error('Not your turn');
        }

        const actionWithMeta = {
            ...action,
            player: this.localPlayerNumber,
            turn: this.match.turn,
            timestamp: this.firebase.serverTimestamp,
            sequence: Date.now()
        };

        // Add to action log
        const newActionRef = this._matchRef.child('action_log').push();
        await newActionRef.set(actionWithMeta);

        // Update last action time
        await this._matchRef.child(`players/${this.localPlayerNumber}/last_action`).set(this.firebase.serverTimestamp);

        this.lastActionTime = Date.now();

        console.log('Submitted action:', action.type);
    }

    /**
     * Update the game state
     * @param {Object} gameState - New game state
     */
    async updateGameState(gameState) {
        if (!this.isMyTurn() && gameState.current_player !== this.localPlayerNumber) {
            // Only allow state updates on your turn (except when it becomes your turn)
            console.warn('Cannot update state - not your turn');
            return;
        }

        await this._matchRef.child('game_state').set(gameState);
    }

    /**
     * Publish the whole game state, as the game's adapter wraps it, plus a
     * little metadata for listings. Not gated on whose turn it is: the
     * defender writes while blocking, and a choice can belong to either
     * player - the game engine is what decides who may act.
     * @param {Object} wrapper - { seq, writer, json, ... }
     * @param {Object} meta - extra match fields (multi-path keys allowed)
     */
    async publishState(wrapper, meta = {}) {
        await this._matchRef.update({ game_state: wrapper, ...meta });
        this.lastActionTime = Date.now();
    }

    /**
     * Update match metadata (turn, phase, etc.)
     * @param {Object} updates - Fields to update
     */
    async updateMatch(updates) {
        await this._matchRef.update(updates);
    }

    /**
     * End the current turn
     * @param {Object} endState - State at end of turn
     */
    async endTurn(endState) {
        const nextPlayer = this.localPlayerNumber === 1 ? 2 : 1;
        const newTurn = this.localPlayerNumber === 2 ? this.match.turn + 1 : this.match.turn;

        await this._matchRef.update({
            current_player: nextPlayer,
            turn: newTurn,
            phase: 'draw'
        });

        if (endState) {
            await this.updateGameState(endState);
        }

        await this.submitAction({ type: 'end_turn' });

        this._resetTurnTimer();
    }

    /**
     * End the match
     * @param {number} winner - Winning player number (1 or 2)
     * @param {Object} finalState - Final game state
     */
    async endMatch(winner, finalState) {
        // Cancel pending timers to prevent stale callbacks
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
        this._resetTurnTimer();

        // Leave the published state alone unless given one: writing null here
        // deleted it, and the other seat and any spectators lost the board.
        await this._matchRef.update({
            status: 'completed',
            winner: winner,
            ended_at: this.firebase.serverTimestamp,
            ...(finalState ? { game_state: finalState } : {})
        });

        // Record result
        const won = winner === this.localPlayerNumber;
        await this.arcade.recordGameResult(this.gameId, {
            won,
            opponent: this.match.players[this.opponentPlayerNumber].display_name,
            ranked: this.match.mode === 'ranked',
            opponentRating: this.match.players[this.opponentPlayerNumber].rating
        });

        await this.arcade.setCurrentMatch(null);

        this._notifyStatusListeners('completed', { winner, finalState });
    }

    /**
     * Abandon the match (forfeit)
     */
    async abandonMatch() {
        const winner = this.opponentPlayerNumber;

        // Cancel any pending reconnect timeout to prevent race with timeout handler
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
        this._resetTurnTimer();

        await this._matchRef.update({
            status: 'abandoned',
            winner: winner,
            abandoned_by: this.localPlayerNumber,
            ended_at: this.firebase.serverTimestamp
        });

        await this.arcade.recordGameResult(this.gameId, {
            won: false,
            opponent: this.match.players[this.opponentPlayerNumber].display_name,
            ranked: this.match.mode === 'ranked',
            forfeit: true
        });

        await this.arcade.setCurrentMatch(null);

        this._notifyStatusListeners('abandoned', { winner });
    }

    /**
     * Check if it's the local player's turn
     */
    isMyTurn() {
        return this.match?.current_player === this.localPlayerNumber;
    }

    /**
     * Get opponent info
     */
    getOpponent() {
        if (!this.match) return null;
        return this.match.players[this.opponentPlayerNumber];
    }

    /**
     * Get local player info
     */
    getLocalPlayer() {
        if (!this.match) return null;
        return this.match.players[this.localPlayerNumber];
    }

    // ==========================================
    // Disconnect Handling
    // ==========================================

    _handleOpponentDisconnect() {
        console.log('Opponent disconnected');
        this._notifyStatusListeners('opponent_disconnected');

        // Start reconnect timeout
        this._reconnectTimeout = setTimeout(() => {
            this._handleOpponentTimeout();
        }, 120000); // 2 minute timeout
    }

    _handleOpponentReconnect() {
        console.log('Opponent reconnected');
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
        this._notifyStatusListeners('opponent_reconnected');
    }

    async _handleOpponentTimeout() {
        console.log('Opponent timed out');

        // Local player wins by timeout
        await this._matchRef.update({
            status: 'completed',
            winner: this.localPlayerNumber,
            win_reason: 'opponent_timeout',
            ended_at: this.firebase.serverTimestamp
        });

        await this.arcade.recordGameResult(this.gameId, {
            won: true,
            opponent: this.match.players[this.opponentPlayerNumber].display_name,
            ranked: this.match.mode === 'ranked',
            timeout: true
        });

        this._notifyStatusListeners('completed', {
            winner: this.localPlayerNumber,
            reason: 'opponent_timeout'
        });
    }

    // ==========================================
    // Turn Timer
    // ==========================================

    /**
     * Start turn timer
     * @param {Function} onTimeout - Callback when timer expires
     */
    startTurnTimer(onTimeout) {
        if (this._turnTimer) {
            clearTimeout(this._turnTimer);
        }

        this._turnTimer = setTimeout(() => {
            if (this.isMyTurn()) {
                console.log('Turn timer expired');
                onTimeout();
            }
        }, this._turnTimeLimit);
    }

    _resetTurnTimer() {
        if (this._turnTimer) {
            clearTimeout(this._turnTimer);
            this._turnTimer = null;
        }
    }

    /**
     * Get remaining turn time
     */
    getRemainingTurnTime() {
        if (!this.lastActionTime) return this._turnTimeLimit;
        return Math.max(0, this._turnTimeLimit - (Date.now() - this.lastActionTime));
    }

    // ==========================================
    // Listeners
    // ==========================================

    /**
     * Subscribe to game state changes
     */
    onStateChange(callback) {
        this._stateListeners.push(callback);
        if (this.match?.game_state) {
            callback(this.match.game_state);
        }
    }

    offStateChange(callback) {
        this._stateListeners = this._stateListeners.filter(cb => cb !== callback);
    }

    _notifyStateListeners(state) {
        this._stateListeners.forEach(cb => cb(state));
    }

    /**
     * Subscribe to opponent actions
     */
    onAction(callback) {
        this._actionListeners.push(callback);
    }

    offAction(callback) {
        this._actionListeners = this._actionListeners.filter(cb => cb !== callback);
    }

    _notifyActionListeners(action) {
        this._actionListeners.forEach(cb => cb(action));
    }

    /**
     * Subscribe to match status changes
     */
    onStatusChange(callback) {
        this._statusListeners.push(callback);
    }

    offStatusChange(callback) {
        this._statusListeners = this._statusListeners.filter(cb => cb !== callback);
    }

    _notifyStatusListeners(status, data = {}) {
        this._statusListeners.forEach(cb => cb(status, data));
    }

    // ==========================================
    // Spectator Support
    // ==========================================

    /**
     * Join as spectator
     * @param {string} matchId - Match to spectate
     */
    async spectate(matchId) {
        this.matchId = matchId;
        this._matchRef = this.firebase.ref(`arcade/matches/${this.gameId}/${matchId}`);

        const snapshot = await this._matchRef.once('value');
        if (!snapshot.exists()) {
            throw new Error('Match not found');
        }

        this.match = snapshot.val();

        if (!this.match.allow_spectators) {
            throw new Error('Spectating not allowed for this match');
        }

        // Register as spectator
        const userId = this.firebase.supabaseUserId;
        const spectatorRef = this.firebase.ref(`arcade/spectating/${matchId}/spectators/${userId}`);
        await spectatorRef.set({
            user_id: userId,
            display_name: this.arcade.player?.display_name || 'Spectator',
            joined_at: this.firebase.serverTimestamp
        });
        spectatorRef.onDisconnect().remove();

        // Increment spectator count
        await this._matchRef.child('spectator_count').transaction(count => (count || 0) + 1);

        // Set up read-only listeners
        this._matchRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                this.match = snapshot.val();
                this._notifyStateListeners(this.match.game_state);
            }
        });

        this.localPlayerNumber = null; // Spectator
        console.log('Spectating match:', matchId);

        return this.match;
    }

    /**
     * Stop spectating
     */
    async stopSpectating() {
        if (!this.matchId) return;

        const userId = this.firebase.supabaseUserId;

        // Remove spectator entry
        await this.firebase.ref(`arcade/spectating/${this.matchId}/spectators/${userId}`).remove();

        // Decrement spectator count
        await this._matchRef.child('spectator_count').transaction(count => Math.max(0, (count || 0) - 1));

        this.destroy();
    }

    // ==========================================
    // Cleanup
    // ==========================================

    destroy() {
        if (this._matchRef) {
            this._matchRef.off();
        }

        if (this._actionLogRef) {
            this._actionLogRef.off();
        }

        this._resetTurnTimer();

        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
        }

        this._stateListeners = [];
        this._actionListeners = [];
        this._statusListeners = [];

        this.isConnected = false;
        this.match = null;
        this.matchId = null;
    }
}

// Export
window.MultiplayerSync = MultiplayerSync;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MultiplayerSync };
}
