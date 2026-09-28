// RIUTIZ cards you own, and the RTC a game pays.
//
//   - A student who chose a starter before the 2026-09-26 rebuild owns the OLD
//     list; the starter shown to them (and any ranked deck from it) needed
//     cards they did not have. Loading the collection tops up the missing
//     copies of the starter they chose, once, without taking any away.
//   - A collection that could not be READ used to come back as an empty one:
//     the starter picker reappeared and the next save wrote the empty
//     collection over the real one. Now it is marked unavailable and never
//     saved.
//   - Against the computer only a win pays - Easy 0, Normal 3, Hard 8 - up to
//     40 RTC a day, and conceding pays nothing (decided with Jordan,
//     2026-09-28; the real limit belongs server-side, this is the browser's).
//
// Run: node tests/riutiz-collection-rtc.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const STARTERS = JSON.parse(read('games/Data/Riutiz/starter-decks.json')).starter_decks;

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log(`pass  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};

function sandbox(extra = {}) {
    const store = {};
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
        fetch: async () => ({ ok: true, json: async () => JSON.parse(read('games/Data/Riutiz/starter-decks.json')) }),
        Date, Promise, JSON, Math, ...extra
    };
    sb.window = sb;
    vm.createContext(sb);
    return { sb, store };
}

(async () => {
    console.log('\n== an old starter is topped up ==\n');
    {
        const { sb } = sandbox();
        vm.runInContext(read('games/riutiz/RiutizCollection.js'), sb);
        const deck = STARTERS.find(d => d.id === 'purple_drama');
        // What an old grant looked like: some of today's cards, some not
        const oldCards = { 68: 3, 71: 2, 70: 2, 72: 2, 196: 1 };
        let saves = 0;
        const arcade = {
            isOnline: true,
            getCollection: async () => ({ cards: Object.fromEntries(Object.entries(oldCards).map(([id, n]) => [id, { quantity: n }])),
                                          starter_deck_claimed: true, chosen_starter: 'purple_drama' }),
            saveCollection: async () => { saves++; }
        };
        const c = new sb.RiutizCollection(arcade, []);
        await c.load();
        const missing = Object.entries(deck.cards).filter(([id, n]) => (c.collection.cards[id]?.quantity || 0) < n);
        check('after loading, they own every card of today\'s starter', missing, []);
        check('  nothing they owned was taken away', Object.entries(oldCards).every(([id, n]) => c.collection.cards[id].quantity >= n), true);
        check('  and it was saved once', saves, 1);
        await c.topUpStarter();
        check('a second load changes nothing', saves, 1);
    }

    console.log('\n== a collection that could not be read is never overwritten ==\n');
    {
        const { sb } = sandbox();
        vm.runInContext(read('games/riutiz/RiutizCollection.js'), sb);
        let saves = 0;
        const arcade = { isOnline: true, getCollection: async () => { throw new Error('network'); }, saveCollection: async () => { saves++; } };
        const c = new sb.RiutizCollection(arcade, []);
        await c.load();
        check('it is marked unavailable', c.unavailable, true);
        check('  the starter picker is not offered again', c.needsStarterDeck(), false);
        await c.save();
        check('  and saving does nothing', saves, 0);
    }

    console.log('\n== RTC for a game ==\n');
    {
        const calls = [];
        const { sb, store } = sandbox({
            portalAuth: { supabase: { rpc: async (name, args) => { calls.push(args.p_amount); return { data: null, error: null }; } } }
        });
        vm.runInContext(read('shared/arcade/ArcadeManager.js'), sb);
        const am = Object.create(sb.ArcadeManager.prototype);
        am.firebase = { supabaseUserId: 'student-1' };
        const pay = async (result) => { const before = calls.length; await am._awardRtcForGame('riutiz', result); return calls.slice(before); };
        check('beating Easy pays nothing', await pay({ won: true, vsAI: true, difficulty: 'easy' }), []);
        check('beating Normal pays 3', await pay({ won: true, vsAI: true, difficulty: 'normal' }), [3]);
        check('beating Hard pays 8', await pay({ won: true, vsAI: true, difficulty: 'hard' }), [8]);
        check('losing to the computer pays nothing', await pay({ won: false, vsAI: true, difficulty: 'hard' }), []);
        let day = [];
        for (let i = 0; i < 6; i++) day = day.concat(await pay({ won: true, vsAI: true, difficulty: 'hard' }));
        check('the day tops out at 40 RTC from the computer (3 + 8 so far, then 8s, then the rest)', day, [8, 8, 8, 5]);
        check('  after which a win pays nothing', await pay({ won: true, vsAI: true, difficulty: 'hard' }), []);
        check('conceding an online match pays nothing', await pay({ won: false, forfeit: true }), []);
        check('an online win still pays 10', await pay({ won: true }), [10]);
    }

    console.log('\n== a result is added to the record, never written over it ==\n');
    {
        const { sb } = sandbox({ portalAuth: null });
        vm.runInContext(read('shared/arcade/ArcadeManager.js'), sb);
        const am = Object.create(sb.ArcadeManager.prototype);
        // Like the real transaction: the first guess is from the local cache
        // (often nothing), and it runs again with what the server holds.
        let stored = { wins: 12, losses: 7, total_games: 19, ranked_games: 4, ranked_rating: 1130, best_streak: 5, current_streak: 2 };
        const ref = {
            once: async () => { throw new Error('read failed'); },      // the read that used to wipe the record
            transaction: async fn => {
                const guess = fn(null);
                if (guess !== undefined && stored === null) stored = guess;
                else stored = fn(JSON.parse(JSON.stringify(stored)));
                return { committed: true, snapshot: { val: () => stored } };
            }
        };
        am.firebase = { supabaseUserId: 'student-1', serverTimestamp: 0, gameRef: () => ref, playerRef: () => null };
        am._awardRtcForGame = async () => {};
        const s = await am.recordGameResult('riutiz', { won: true });
        check('a win adds to what was there', [s.wins, s.losses, s.total_games, s.current_streak], [13, 7, 20, 3]);
        check('  and the rating and best streak survive', [s.ranked_rating, s.best_streak], [1130, 5]);
        await Promise.all([am.recordGameResult('riutiz', { won: false }), am.recordGameResult('riutiz', { won: true })]);
        check('two tabs finishing together both count', [stored.wins, stored.losses, stored.total_games], [14, 8, 22]);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
