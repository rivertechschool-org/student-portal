// RIUTIZ online: two real clients, one fake Firebase, a whole match.
//
// Online play had never been seen working end to end - it needs two signed-in
// accounts - and the 2026-09 trace of it found both seats dealt random decks
// (the chosen deck was dropped when the match was set up), the guest's first
// screen reading `field` off a player the database had emptied, and each side
// replaying the other's actions with its own dice.
//
// This runs the REAL MatchmakingManager, MultiplayerSync, RiutizMultiplayer,
// engine and AI twice over, in two separate sandboxes - two browsers - that
// share only a fake Realtime Database. The fake does what the real one does
// that has bitten before: it drops empty arrays and objects, hands numbered
// keys back as arrays, turns server timestamps into numbers, applies
// multi-path updates, and delivers listeners asynchronously.
//
// A host creates a lobby with one deck, a guest joins with another, both ready
// up, the host starts; then each side's own AI plays its own seat, on its own
// engine, until the match ends. Checked: each seat played the deck its player
// chose, both clients end on the same state, both record their own result,
// the host sits in seat 1 and the names are right; and a bad deck list is
// refused rather than dealt.
//
// Run: node tests/riutiz-multiplayer.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CARDS = JSON.parse(read('games/Data/Riutiz/cards.json'));
const DECKS = JSON.parse(read('games/Data/Riutiz/starter-decks.json')).starter_decks;
const SRC = ['shared/arcade/MatchmakingManager.js', 'shared/arcade/MultiplayerSync.js',
             'games/riutiz/RiutizCards.js', 'games/riutiz/RiutizGame.js', 'games/riutiz/RiutizAI.js',
             'games/riutiz/RiutizMultiplayer.js'].map(read).join('\n');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log(`pass  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ------------------------------------------------------------- fake database
class FakeDB {
    constructor() { this.root = {}; this.listeners = []; this.n = 0; }

    static parts(p) { return String(p).split('/').filter(Boolean); }

    // What the Realtime Database keeps: no undefined, no null, no empty
    // arrays or objects; arrays become numbered keys; timestamps become numbers.
    static store(v) {
        if (v === undefined || v === null) return null;
        if (v && typeof v === 'object' && v['.sv'] === 'timestamp') return Date.now();
        if (Array.isArray(v)) v = Object.fromEntries(v.map((x, i) => [String(i), x]));
        if (v && typeof v === 'object') {
            const out = {};
            for (const [k, x] of Object.entries(v)) {
                if (x === undefined) throw new Error(`undefined at ${k} (the real database refuses this)`);
                const s = FakeDB.store(x);
                if (s !== null) out[k] = s;
            }
            return Object.keys(out).length ? out : null;
        }
        return v;
    }

    // What it hands back: objects with keys 0..n look like arrays.
    static load(v) {
        if (!v || typeof v !== 'object') return v === undefined ? null : v;
        const keys = Object.keys(v);
        const out = {};
        for (const k of keys) out[k] = FakeDB.load(v[k]);
        const ints = keys.every(k => /^\d+$/.test(k));
        if (ints && keys.length) {
            const max = Math.max(...keys.map(Number));
            if (keys.length > max / 2) {
                const arr = [];
                for (let i = 0; i <= max; i++) arr.push(out[String(i)] ?? null);
                return arr;
            }
        }
        return out;
    }

    get(p) {
        let node = this.root;
        for (const part of FakeDB.parts(p)) {
            if (!node || typeof node !== 'object') return null;
            node = node[part];
        }
        return node === undefined ? null : JSON.parse(JSON.stringify(node));
    }

    put(p, value) {
        const parts = FakeDB.parts(p);
        const stored = FakeDB.store(value);
        if (!parts.length) { this.root = stored || {}; return; }
        let node = this.root;
        for (const part of parts.slice(0, -1)) {
            if (!node[part] || typeof node[part] !== 'object') node[part] = {};
            node = node[part];
        }
        const last = parts[parts.length - 1];
        if (stored === null) delete node[last]; else node[last] = stored;
        this.prune();
    }

    prune(node = this.root) {
        for (const [k, v] of Object.entries(node)) {
            if (v && typeof v === 'object') { this.prune(v); if (!Object.keys(v).length) delete node[k]; }
        }
    }

    changed(p) {
        // every listener at, above or below the changed path hears about it
        const cp = FakeDB.parts(p).join('/');
        for (const l of [...this.listeners]) {
            const lp = FakeDB.parts(l.path).join('/');
            if (cp === lp || cp.startsWith(lp + '/') || lp.startsWith(cp + '/') || lp === '') {
                setTimeout(() => this.fire(l), 0);
            }
        }
    }

    fire(l) {
        if (!this.listeners.includes(l)) return;
        const val = this.get(l.path);
        if (l.event === 'value') {
            l.cb(snap(l.path, val));
        } else if (l.event === 'child_added') {
            const kids = val && typeof val === 'object' ? Object.keys(val) : [];
            for (const k of kids) if (!l.seen.has(k)) { l.seen.add(k); l.cb(snap(l.path + '/' + k, val[k])); }
        } else if (l.event === 'child_removed') {
            const kids = new Set(val && typeof val === 'object' ? Object.keys(val) : []);
            for (const k of [...l.seen]) if (!kids.has(k)) { l.seen.delete(k); l.cb(snap(l.path + '/' + k, null)); }
            for (const k of kids) l.seen.add(k);
        }
    }
}

function snap(p, val) {
    const v = FakeDB.load(val);
    return { key: FakeDB.parts(p).pop() || null, val: () => v, exists: () => v !== null && v !== undefined,
             forEach(fn) { if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => fn(snap(p + '/' + k, x))); } };
}

function makeRef(db, p, query = null) {
    const ref = {
        key: FakeDB.parts(p).pop() || null,
        child: (c) => makeRef(db, `${p}/${c}`),
        async set(v) { db.put(p, v); db.changed(p); },
        async update(obj) {
            for (const [k, v] of Object.entries(obj)) db.put(`${p}/${k}`, v);
            db.changed(p);
        },
        async remove() { db.put(p, null); db.changed(p); },
        push(v) {
            const k = `k${String(++db.n).padStart(6, '0')}`;
            const r = makeRef(db, `${p}/${k}`);
            if (v !== undefined) { db.put(`${p}/${k}`, v); db.changed(p); }
            return r;
        },
        async once() {
            let val = db.get(p);
            if (query && val && typeof val === 'object') {
                val = Object.fromEntries(Object.entries(val).filter(([, x]) => x && x[query.child] === query.equals));
                if (!Object.keys(val).length) val = null;
            }
            return snap(p, val);
        },
        on(event, cb) {
            const l = { path: p, event, cb, seen: new Set() };
            if (event !== 'value') {
                // child_added delivers what exists now as well
                const val = db.get(p);
                if (event === 'child_removed' && val) Object.keys(val).forEach(k => l.seen.add(k));
            }
            db.listeners.push(l);
            setTimeout(() => db.fire(l), 0);
            return cb;
        },
        off(event, cb) { db.listeners = db.listeners.filter(l => !(l.path === p && (!event || l.event === event) && (!cb || l.cb === cb))); },
        async transaction(fn) { const v = fn(db.get(p)); if (v !== undefined) { db.put(p, v); db.changed(p); } return { committed: true, snapshot: snap(p, db.get(p)) }; },
        onDisconnect: () => ({ set: async () => {}, remove: async () => {}, cancel: () => {} }),
        orderByChild: (c) => ({ equalTo: (v) => makeRef(db, p, { child: c, equals: v }) }),
        orderByKey: () => ({ limitToLast: () => ref, on: ref.on }),
        limitToLast: () => ref
    };
    return ref;
}

// ------------------------------------------------------------- one browser
function client(db, userId, name, results) {
    const errors = [];
    const sb = {
        console: { log() {}, info() {}, warn() {}, error: (...a) => errors.push(a.map(x => (x && x.stack) || String(x)).join(' ')) },
        setTimeout, clearTimeout, setInterval, clearInterval, EventTarget, CustomEvent, Event, Promise, JSON, Math, Date
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC, sb);
    const arcade = {
        isInitialized: true,
        isOnline: true,
        player: { display_name: name },
        firebase: {
            supabaseUserId: userId,
            serverTimestamp: { '.sv': 'timestamp' },
            generateId: () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
            ref: (p) => makeRef(db, p)
        },
        getStats: async () => ({ ranked_rating: 1000 }),
        setCurrentMatch: async () => {},
        recordGameResult: async (game, r) => { results.push({ userId, ...r }); }
    };
    const RiutizGame = vm.runInContext('RiutizGame', sb);
    const RiutizMultiplayer = vm.runInContext('RiutizMultiplayer', sb);
    const RiutizAI = vm.runInContext('RiutizAI', sb);
    const game = new RiutizGame({ mode: 'online-pvp', cardData: CARDS });
    const mp = new RiutizMultiplayer(game, arcade);
    return { game, mp, RiutizAI, errors, userId, name };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 20000, step = 20) {
    const t0 = Date.now();
    while (!pred()) { if (Date.now() - t0 > ms) return false; await wait(step); }
    return true;
}

// Drive each side with its own AI: act when it is this side's move.
function autopilot(c) {
    const ai = new c.RiutizAI(c.game, c.mp.localPlayerNumber, { thinkingDelay: 0, actionDelay: 0 });
    const tick = () => {
        const s = c.game.state;
        if (!s || s.gameOver) return;
        const me = c.mp.localPlayerNumber;
        if (s.pending.length && s.pending[0].player === me) { ai.answerChoice(); return; }
        if (s.pending.length) return;
        if (s.currentPlayer === me && !s.combatStep && !ai.isRunning) ai.takeTurn();
        else if (s.combatStep === 'declare-blockers' && s.currentPlayer !== me) ai.declareBlockers();
    };
    const timer = setInterval(tick, 30);
    return { stop: () => clearInterval(timer) };
}

const deckOf = (i) => ({ id: `deck-${i}`, name: DECKS[i].name, cards: [...DECKS[i].deck_list] });

function cardsSeen(state, seat) {
    const pl = state.players[seat];
    const inPlay = [...state.players[1].field, ...state.players[2].field].filter(c => (c.owner || seat) === seat && !c.isToken);
    return [...pl.hand, ...pl.deck, ...pl.discard, ...inPlay, ...pl.resources.map(r => r.card).filter(Boolean)]
        .map(c => String(c.id));
}

(async () => {
    console.log('\n== a lobby match, each player bringing their own deck ==\n');
    {
        const db = new FakeDB();
        const results = [];
        const host = client(db, 'user-host', 'Hosting Hannah', results);
        const guest = client(db, 'user-guest', 'Guest Gus', results);
        await host.mp.initialize();
        await guest.mp.initialize();
        let hostStarted = false, guestStarted = false;
        host.mp.onMatchStartCallback(() => { hostStarted = true; });
        guest.mp.onMatchStartCallback(() => { guestStarted = true; });
        const ended = {};
        host.mp.onMatchEndCallback((won) => { ended.host = won; });
        guest.mp.onMatchEndCallback((won) => { ended.guest = won; });

        const { joinCode } = await host.mp.createLobby({ mode: 'casual', deck: deckOf(1) });   // Lab Experiment
        await guest.mp.joinLobby(joinCode, { deck: deckOf(3) });                              // Math League
        await host.mp.setReady(true, deckOf(1));
        await guest.mp.setReady(true, deckOf(3));
        await wait(50);
        await host.mp.startMatchFromLobby();
        ok('both clients join the match', await until(() => hostStarted && guestStarted));
        check('the host sits in seat 1', [host.mp.localPlayerNumber, guest.mp.localPlayerNumber], [1, 2]);
        ok('the guest receives the opening state', await until(() => !!guest.game.state));
        const match = db.get(`arcade/matches/riutiz/${host.mp.matchId}`);
        check('each seat is named after its player', [match.players['1'].display_name, match.players['2'].display_name], ['Hosting Hannah', 'Guest Gus']);
        check('the state travels as one JSON string with a sequence number', typeof match.game_state.json + ':' + typeof match.game_state.seq, 'string:number');

        const s0 = guest.game.state;
        const labIds = new Set(DECKS[1].deck_list.map(String)), mathIds = new Set(DECKS[3].deck_list.map(String));
        ok('seat 1 was dealt the host\'s deck (Lab Experiment)', cardsSeen(s0, 1).every(id => labIds.has(id)) && cardsSeen(s0, 1).length === 40);
        ok('seat 2 was dealt the guest\'s deck (Math League)', cardsSeen(s0, 2).every(id => mathIds.has(id)) && cardsSeen(s0, 2).length === 40);
        ok('the guest\'s first screen has every zone, empty or not', ['field', 'resources', 'discard', 'hand', 'deck'].every(k => Array.isArray(s0.players[1][k]) && Array.isArray(s0.players[2][k])));

        const a = autopilot(host), b = autopilot(guest);
        const finished = await until(() => host.game.state?.gameOver && guest.game.state?.gameOver, 240000, 50);
        a.stop(); b.stop();
        ok('the match plays to the end', finished);
        await wait(300);
        const hs = host.game.state, gs = guest.game.state;
        check('both clients agree on the winner and the score', [gs.winner, gs.players[1].points, gs.players[2].points], [hs.winner, hs.players[1].points, hs.players[2].points]);
        ok('both clients end on the same board', JSON.stringify(hs.players) === JSON.stringify(gs.players));
        ok(`it took real turns (turn ${hs.turn}, ${hs.players[1].points}-${hs.players[2].points})`, hs.turn > 4);
        ok('seat 1 only ever held Lab Experiment cards', cardsSeen(hs, 1).every(id => labIds.has(id)));
        ok('seat 2 only ever held Math League cards', cardsSeen(hs, 2).every(id => mathIds.has(id)));
        await until(() => results.length >= 2, 3000);
        check('each side records its own result, once', results.map(r => [r.userId, r.won]).sort(),
              [['user-guest', hs.winner === 2], ['user-host', hs.winner === 1]].sort());
        check('and each side is told how it went', [ended.host, ended.guest], [hs.winner === 1, hs.winner === 2]);
        check('the match is marked completed', db.get(`arcade/matches/riutiz/${host.mp.matchId}/status`), 'completed');
        check('no errors on either side', [host.errors.slice(0, 2), guest.errors.slice(0, 2)], [[], []]);
    }

    console.log('\n== a deck that is not a legal deck ==\n');
    {
        const Mp = client(new FakeDB(), 'x', 'x', []).mp.constructor;
        const ids = DECKS[0].deck_list.map(String);
        check('40 real cards are accepted', !!Mp.validateDeck(ids.join(','), CARDS).cards, true);
        check('39 are refused', Mp.validateDeck(ids.slice(0, 39).join(','), CARDS).error, 'only 39 cards');
        check('a made-up card is refused', Mp.validateDeck([...ids.slice(0, 39), '9999'].join(','), CARDS).error, '1 unknown card');
        const others = ids.filter(id => id !== ids[0]).slice(0, 35);
        check('five of one card is refused', Mp.validateDeck([...Array(5).fill(ids[0]), ...others].join(','), CARDS).error, '5 copies of one card');
        check('no deck at all is refused', Mp.validateDeck(null, CARDS).error, 'no deck was sent');

        const db = new FakeDB();
        const host = client(db, 'h2', 'H', []), guest = client(db, 'g2', 'G', []);
        await host.mp.initialize(); await guest.mp.initialize();
        let started = false;
        guest.mp.onMatchStartCallback(() => { started = true; });
        const { joinCode } = await host.mp.createLobby({ deck: deckOf(0) });
        const bad = { id: 'bad', name: 'Too small', cards: DECKS[2].deck_list.slice(0, 30) };
        await guest.mp.joinLobby(joinCode, { deck: bad });
        await host.mp.setReady(true, deckOf(0)); await guest.mp.setReady(true, bad);
        await wait(50);
        await host.mp.startMatchFromLobby();
        await until(() => started && !!guest.game.state);
        const notes = db.get(`arcade/matches/riutiz/${host.mp.matchId}/deck_notes`);
        check('the host refuses the short deck and says why', notes && notes['2'], 'only 30 cards');
        check('that seat still gets 40 cards to play with', cardsSeen(guest.game.state, 2).length, 40);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
