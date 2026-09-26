// games/riutiz/RiutizMultiplayer.js
// RIUTIZ online matches: the game engine on each side, one shared state in
// Firebase between them.
//
// Rewritten 2026-09. It used to do two things at once: replay the opponent's
// actions into the local engine (re-rolling their dice and coin flips on
// this side) AND load the opponent's full state, so each side briefly showed
// a different game until the next write stomped it. And the state went into
// the Realtime Database as an object, which silently drops empty arrays - the
// guest's first render read `field` off a player that had none.
//
// Now the state is the only thing that travels:
//
//   - whoever acts publishes the whole state as ONE JSON string, with a
//     sequence number and who wrote it;
//   - the other side loads any state newer than the one it has, and ignores
//     the echo of its own writes;
//   - the engine allows only one player to act at a time (the defender blocks
//     while the attacker waits; a choice belongs to one player), so there is
//     never a second writer to race.
//
// Each seat plays the deck its player chose: the card list is published with
// the queue/lobby entry and copied into the match, and the host (seat 1)
// validates both and deals. A list that fails validation falls back to a
// random deck for that seat, and the match says so.

class RiutizMultiplayer {
    constructor(game, arcade) {
        this.game = game;
        this.arcade = arcade;
        this.sync = null;
        this.matchmaking = null;

        this.matchId = null;
        this.localPlayerNumber = null;
        this.isHost = false;

        this.seq = 0;                 // newest state seen or written
        this._publishQueued = false;
        this._resultRecorded = false;
        this.deckNotes = {};          // seat -> why its deck was replaced, if it was

        this._onMatchStart = null;
        this._onMatchEnd = null;
        this._onOpponentAction = null;
        this._onStatusChange = null;
    }

    async initialize() {
        if (!this.arcade || !this.arcade.isInitialized) throw new Error('Arcade not initialized');
        this.matchmaking = new MatchmakingManager(this.arcade, 'riutiz');
        this.sync = new MultiplayerSync(this.arcade, 'riutiz');

        this._lobbyHandler = (data) => {
            if (data && data.event === 'match_started') this.joinMatch(data.matchId);
        };

        // Anything the local player does is published once it settles.
        ['cardPlayed', 'cardPlayedAsResource', 'abilityActivated', 'choiceResolved', 'combatStarted',
         'attackerToggled', 'attackersDeclared', 'blockerToggled', 'combatSkipped', 'combatResolved',
         'turnEnded', 'gameOver'].forEach(t => this.game.addEventListener(t, () => this.schedulePublish()));
    }

    // ==========================================
    // Matchmaking
    // ==========================================

    async joinQueue(options = {}) {
        const matchId = await this.matchmaking.joinQueue(options);
        await this.joinMatch(matchId);
        return matchId;
    }

    async leaveQueue() { await this.matchmaking.leaveQueue(); }

    async createLobby(options = {}) {
        const result = await this.matchmaking.createLobby(options);
        this.isHost = true;
        this.matchmaking.offLobbyChange(this._lobbyHandler);
        this.matchmaking.onLobbyChange(this._lobbyHandler);
        return result;
    }

    async joinLobby(lobbyIdOrCode, options = {}) {
        const lobby = await this.matchmaking.joinLobby(lobbyIdOrCode, options);
        this.isHost = false;
        this.matchmaking.offLobbyChange(this._lobbyHandler);
        this.matchmaking.onLobbyChange(this._lobbyHandler);
        return lobby;
    }

    // deck: { id, name, cards } (or an id, from older callers)
    async setReady(ready, deck) { await this.matchmaking.setReady(ready, deck); }

    async startMatchFromLobby() {
        const matchId = await this.matchmaking.startMatch();
        await this.joinMatch(matchId);
        return matchId;
    }

    async leaveLobby() {
        await this.matchmaking.leaveLobby();
        this.matchmaking._lobbyListeners = [];
    }

    // ==========================================
    // Decks
    // ==========================================

    // A published deck list, checked the way the deck builder checks one:
    // at least 40 cards, no more than 4 of any, every id a real card.
    // Returns { cards } or { error }.
    static validateDeck(deckCards, cardData, minSize = 40, maxCopies = 4) {
        if (!deckCards) return { error: 'no deck was sent' };
        const ids = String(deckCards).split(',').map(x => x.trim()).filter(Boolean);
        const known = new Set(cardData.map(c => String(c.id)));
        const unknown = ids.filter(id => !known.has(id));
        if (unknown.length) return { error: `${unknown.length} unknown card${unknown.length > 1 ? 's' : ''}` };
        if (ids.length < minSize) return { error: `only ${ids.length} cards` };
        const counts = {};
        for (const id of ids) counts[id] = (counts[id] || 0) + 1;
        const over = Object.entries(counts).find(([, n]) => n > maxCopies);
        if (over) return { error: `${over[1]} copies of one card` };
        // Ids in the card data are numbers or strings depending on the file;
        // hand the engine the exact values it looks up by.
        const byStr = new Map(cardData.map(c => [String(c.id), c.id]));
        return { cards: ids.map(id => byStr.get(id)) };
    }

    // ==========================================
    // The match
    // ==========================================

    async joinMatch(matchId) {
        // The host reaches here twice (its own startMatch and the lobby listener)
        if (this.matchId === matchId && this.sync && this.sync.isConnected) return this.sync.match;
        this.matchId = matchId;
        this._resultRecorded = false;
        this.seq = 0;

        const match = await this.sync.initialize(matchId);
        this.localPlayerNumber = this.sync.localPlayerNumber;

        this.sync.onStateChange((wrapper) => this.onRemoteState(wrapper));
        this.sync.onStatusChange((status, data) => this.onMatchStatusChange(status, data));

        if (this.localPlayerNumber === 1) {
            await this.initializeGameState(match);
        } else if (match.game_state) {
            this.onRemoteState(match.game_state);
        }

        await this.sync.updateMatch({ status: 'active', started_at: Date.now() });
        if (this._onMatchStart) this._onMatchStart(match);
        return match;
    }

    // Host only: check both decks, deal, publish the opening state.
    async initializeGameState(match) {
        const cardData = this.game.cardData;
        const decks = {};
        this.deckNotes = {};
        for (const seat of [1, 2]) {
            const v = RiutizMultiplayer.validateDeck(match.players?.[seat]?.deck_cards, cardData);
            if (v.error) {
                decks[seat] = null;
                this.deckNotes[seat] = v.error;
                console.warn(`Seat ${seat} deck refused (${v.error}); dealing a random deck`);
            } else {
                decks[seat] = v.cards;
            }
        }
        this.game.player1Deck = decks[1];
        this.game.player2Deck = decks[2];
        this.game.startGame();
        if (Object.keys(this.deckNotes).length) {
            await this.sync.updateMatch({ deck_notes: this.deckNotes });
        }
        await this.publish();
    }

    // Coalesce everything one action fires into one write.
    schedulePublish() {
        if (!this.sync || !this.sync.isConnected || this._applyingRemote || this._publishQueued) return;
        if (!this.game.state) return;
        this._publishQueued = true;
        Promise.resolve().then(() => {
            this._publishQueued = false;
            this.publish().catch(err => console.error('Failed to publish state:', err));
        });
    }

    async publish() {
        if (!this.sync || !this.sync.isConnected || !this.game.state) return;
        const s = this.game.state;
        this.seq += 1;
        const wrapper = {
            seq: this.seq,
            writer: this.localPlayerNumber,
            current_player: s.currentPlayer,
            turn: s.turn,
            json: JSON.stringify(s)
        };
        await this.sync.publishState(wrapper, {
            current_player: s.currentPlayer,
            turn: s.turn,
            phase: s.combatStep ? 'combat' : s.phase,
            'players/1/points': s.players[1].points,
            'players/2/points': s.players[2].points
        });
        this.checkGameOver();
    }

    // The other seat's newest state. Our own echo, and anything older than
    // what we have, is ignored.
    onRemoteState(wrapper) {
        if (!wrapper || typeof wrapper.json !== 'string') return;
        if (wrapper.writer === this.localPlayerNumber) return;
        if (!(wrapper.seq > this.seq)) return;
        this.seq = wrapper.seq;
        let state;
        try { state = JSON.parse(wrapper.json); }
        catch (e) { console.error('Unreadable match state:', e); return; }
        this._applyingRemote = true;
        try { this.game.loadState(state); }
        finally { this._applyingRemote = false; }
        if (this._onOpponentAction) this._onOpponentAction(state);
        this.checkGameOver();
    }

    // Each side records its own result, once, whoever made the winning move.
    checkGameOver() {
        const s = this.game.state;
        if (!s || !s.gameOver || this._resultRecorded) return;
        this._resultRecorded = true;
        const won = s.winner === this.localPlayerNumber;
        this.sync.endMatch(s.winner, null)
            .catch(err => console.warn('Recording the match result failed:', err));
        if (this._onMatchEnd) this._onMatchEnd(won, { winner: s.winner, reason: s.endReason });
    }

    onMatchStatusChange(status, data) {
        if ((status === 'abandoned' || (status === 'completed' && data && data.win_reason === 'opponent_timeout'))
            && !this._resultRecorded) {
            this._resultRecorded = true;
            if (this._onMatchEnd) this._onMatchEnd(data.winner === this.localPlayerNumber, data);
        }
        if (this._onStatusChange) this._onStatusChange(status, data);
    }

    onMatchEnd(won, data) { if (this._onMatchEnd) this._onMatchEnd(won, data); }

    async forfeit() {
        if (this.sync && !this._resultRecorded) {
            this._resultRecorded = true;
            await this.sync.abandonMatch();
            if (this._onMatchEnd) this._onMatchEnd(false, { winner: this.localPlayerNumber === 1 ? 2 : 1, reason: 'forfeit' });
        }
    }

    // ==========================================
    // Spectating
    // ==========================================

    async spectateMatch(matchId) {
        this.matchId = matchId;
        this.localPlayerNumber = null;
        const match = await this.sync.spectate(matchId);
        this.sync.onStateChange((w) => {
            if (!w || typeof w.json !== 'string' || !(w.seq > this.seq)) return;
            this.seq = w.seq;
            this.game.loadState(JSON.parse(w.json));
        });
        return match;
    }

    async stopSpectating() { if (this.sync) await this.sync.stopSpectating(); }

    // ==========================================
    // Callbacks
    // ==========================================

    onMatchStartCallback(callback) { this._onMatchStart = callback; }
    onMatchEndCallback(callback) { this._onMatchEnd = callback; }
    onOpponentActionCallback(callback) { this._onOpponentAction = callback; }
    onStatusChangeCallback(callback) { this._onStatusChange = callback; }

    get currentLobby() { return this.matchmaking?.currentLobby; }

    destroy() {
        if (this.sync) this.sync.destroy();
        if (this.matchmaking) this.matchmaking.destroy();
    }
}

if (typeof window !== 'undefined') window.RiutizMultiplayer = RiutizMultiplayer;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizMultiplayer };
}
