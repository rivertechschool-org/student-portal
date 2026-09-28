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
        this._ended = false;
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

        // Claim the seat for THIS tab. The same student with the match open in
        // a second tab (or on a second computer) used to have two copies both
        // writing as one player; now the newest one holds the seat and the
        // other stands down (see _standDown).
        this._session = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        this._takenOver = false;

        // Mark as connected
        await this._matchRef.child(`players/${this.localPlayerNumber}`).update({
            connected: true,
            session_id: this._session,
            last_action: this.firebase.serverTimestamp
        });

        // Set disconnection handler
        this._armDisconnect();

        // ...and say so again every time the connection comes back. It used to
        // be written once: a Chromebook lid closed for 30 seconds set it false
        // for good, and the opponent "won by timeout" two minutes later while
        // this player was back and playing.
        const info = this.firebase.db?.ref?.('.info/connected');
        if (info) {
            this._connectedRef = info;
            this._onConnected = (snap) => {
                if (snap.val() !== true || !this._matchRef) return;
                this._armDisconnect();
                this._matchRef.child(`players/${this.localPlayerNumber}/connected`).set(true);
            };
            info.on('value', this._onConnected);
        }

        // Set up listeners
        this._setupListeners();

        // Update arcade manager
        await this.arcade.setCurrentMatch(matchId);

        this.isConnected = true;
        console.log('MultiplayerSync initialized for match:', matchId, 'as player', this.localPlayerNumber);

        return this.match;
    }

    // What the database does for this seat if the connection drops: marks it
    // gone and stamps when.
    _armDisconnect() {
        const seat = this._matchRef.child(`players/${this.localPlayerNumber}`);
        seat.child('connected').onDisconnect().set(false);
        seat.child('left_at').onDisconnect().set(this.firebase.serverTimestamp);
    }

    /**
     * Set up Firebase listeners
     */
    _setupListeners() {
        // Listen for full match state changes
        this._matchRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                const newMatch = snapshot.val();
                const seat = newMatch.players?.[this.localPlayerNumber]?.session_id;
                if (seat && this._session && seat !== this._session) {
                    this._standDown();
                    return;
                }
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
        if (this._takenOver) return;
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
        if (this._takenOver || !this._matchRef) return;
        await this._matchRef.update({ game_state: wrapper, ...meta });
        this.lastActionTime = Date.now();
    }

    // The board as the database holds it now
    async readGameState() {
        if (!this._matchRef) return null;
        return (await this._matchRef.child('game_state').once('value')).val();
    }

    /**
     * Update match metadata (turn, phase, etc.)
     * @param {Object} updates - Fields to update
     */
    async updateMatch(updates) {
        if (this._takenOver || !this._matchRef) return;
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
        if (this._takenOver) return;     // the other tab records it
        this._ended = true;
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
            // This seat's own copy of the result, read when the match is recorded
            [`players/${this.localPlayerNumber}/result`]: winner,
            ended_at: this.firebase.serverTimestamp,
            ...(finalState ? { game_state: finalState } : {})
        });

        // Record result
        const won = winner === this.localPlayerNumber;
        await this.arcade.recordGameResult(this.gameId, {
            matchId: this.matchId,
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
        if (this._takenOver) return;
        const winner = this.opponentPlayerNumber;
        this._ended = true;

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
            [`players/${this.localPlayerNumber}/conceded`]: true,     // see endMatch
            ended_at: this.firebase.serverTimestamp
        });

        await this.arcade.recordGameResult(this.gameId, {
            matchId: this.matchId,
            won: false,
            opponent: this.match.players[this.opponentPlayerNumber].display_name,
            ranked: this.match.mode === 'ranked',
            opponentRating: this.match.players[this.opponentPlayerNumber].rating,
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

    // Is there still a match to win or lose?
    _matchLive() {
        return !!this.match && this.match.status === 'active' && !this._ended;
    }

    _handleOpponentDisconnect() {
        if (!this._matchLive()) return;      // after the match, leaving is not forfeiting
        console.log('Opponent disconnected');
        this._notifyStatusListeners('opponent_disconnected');

        // One timer at a time: a second disconnect used to orphan the first,
        // which then fired even after a reconnect cancelled the second.
        if (this._reconnectTimeout) clearTimeout(this._reconnectTimeout);
        this._reconnectTimeout = setTimeout(() => {
            this._reconnectTimeout = null;
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
        // Re-check at the moment it fires: the match may have finished, or the
        // opponent come back, in the two minutes since.
        if (!this._matchLive()) return;
        if (this.match.players?.[this.opponentPlayerNumber]?.connected) return;
        this._ended = true;
        console.log('Opponent timed out');

        // Local player wins by timeout
        await this._matchRef.update({
            status: 'completed',
            winner: this.localPlayerNumber,
            win_reason: 'opponent_timeout',
            ended_at: this.firebase.serverTimestamp
        });

        await this.arcade.recordGameResult(this.gameId, {
            matchId: this.matchId,
            won: true,
            opponent: this.match.players[this.opponentPlayerNumber].display_name,
            ranked: this.match.mode === 'ranked',
            opponentRating: this.match.players[this.opponentPlayerNumber].rating,
            timeout: true
        });

        await this.arcade.setCurrentMatch(null);

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

    // Another tab or computer signed in as this player took the seat. Stop
    // everything WITHOUT writing: no result, no forfeit, and the "I've gone"
    // handler is cancelled - otherwise closing this tab later would tell the
    // opponent the player left while they are still playing in the other one.
    _standDown() {
        if (this._takenOver) return;
        this._takenOver = true;
        for (const f of ['connected', 'left_at']) {
            try { this._matchRef.child(`players/${this.localPlayerNumber}/${f}`).onDisconnect().cancel(); } catch (e) {}
        }
        const listeners = this._statusListeners.slice();
        this.destroy();
        listeners.forEach(cb => { try { cb('taken_over', {}); } catch (e) { console.error(e); } });
    }

    destroy() {
        this._ended = true;
        if (this._matchRef) {
            this._matchRef.off();
            // off() on the match does not reach listeners on its children
            for (const n of [this.localPlayerNumber, this.opponentPlayerNumber]) {
                try { this._matchRef.child(`players/${n}/connected`).off(); } catch (e) {}
            }
        }
        if (this._connectedRef && this._onConnected) {
            this._connectedRef.off('value', this._onConnected);
            this._connectedRef = null;
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
