// The RIUTIZ deck builder keeps a student's decks straight.
//
// From the 2026-09-28 audit:
//   - Clear, re-add, Save made a SECOND deck (Clear reset the id and name);
//   - a save that failed online still said "Deck saved!", and was gone on reload;
//   - where decks were stored was asked on every save, so a wifi blip sent one
//     save to this browser and the next online load did not have it;
//   - switching a deck to Ranked kept more copies than the student owned;
//   - every edit reset the deck's creation date.
//
// Run: node tests/riutiz-deckbuilder.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const G = path.join(__dirname, '..', 'games');
const CARDS = JSON.parse(fs.readFileSync(path.join(G, 'Data', 'Riutiz', 'cards.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log(`pass  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};

function builder(arcade, owned = () => 4) {
    const store = {};
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
        fetch: async () => ({ ok: false }), Date, Promise, JSON, Math
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(G, 'riutiz', 'RiutizDeckBuilder.js'), 'utf8'), sb);
    return { db: new sb.RiutizDeckBuilder({ getQuantity: owned }, CARDS, { arcade }), store };
}

const forty = CARDS.filter(c => c.type !== 'Location').slice(0, 40).map(c => c.id);

(async () => {
    {
        const { db } = builder(null);
        await db.loadDecks();
        db.currentDeck = [...forty];
        await db.saveDeck('Fire');
        const id = db.deckId;
        db.clearDeck();
        db.currentDeck = [...forty];
        await db.saveDeck('Fire');
        check('Clear, re-add, Save updates the same deck (it used to make a second)', [db.getSavedDecks().length, db.deckId], [1, id]);
        check('  and the deck keeps its name', db.deckName, 'Fire');
    }
    {
        const cloud = { isOnline: true, getDecks: async () => ({}), saveDeck: async () => null };
        const { db } = builder(cloud);
        await db.loadDecks();
        db.currentDeck = [...forty];
        const r = await db.saveDeck('Water');
        check('a save the server refused is reported, not "saved"', [r.success, /server/.test(r.errors[0])], [false, true]);
        check('  and no deck appears that will be gone on reload', db.getSavedDecks().length, 0);
    }
    {
        let cloudSaves = 0;
        const cloud = { isOnline: true, getDecks: async () => ({}), saveDeck: async (g, d) => { cloudSaves++; return d.id; } };
        const { db, store } = builder(cloud);
        await db.loadDecks();
        cloud.isOnline = false;              // a wifi blip after loading
        db.currentDeck = [...forty];
        await db.saveDeck('Earth');
        check('a blip after loading does not divert a save to this browser only', [cloudSaves, store.riutiz_decks === undefined], [1, true]);
    }
    {
        const owned = id => (id === forty[0] ? 2 : 4);
        const { db } = builder(null, owned);
        await db.loadDecks();
        db.currentDeck = [forty[0], forty[0], forty[0], forty[0], ...forty.slice(1)];
        db.setMode('ranked');
        check('Ranked keeps only as many copies as are owned (2 of 4)', db.currentDeck.filter(x => x === forty[0]).length, 2);
    }
    {
        const { db } = builder(null);
        await db.loadDecks();
        db.currentDeck = [...forty];
        await db.saveDeck('Air');
        const born = db.savedDecks[db.deckId].created_at;
        await new Promise(r => setTimeout(r, 5));
        await db.saveDeck('Air');
        check('editing a deck keeps its creation date', db.savedDecks[db.deckId].created_at, born);
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
