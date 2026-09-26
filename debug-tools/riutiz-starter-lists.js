// The five RIUTIZ starter decks, as card id -> copies, and the script that
// writes them into games/Data/Riutiz/starter-decks.json.
//
//   node debug-tools/riutiz-starter-lists.js [out.json]
//
// Each deck is one colour plus colourless cards - so a new player never holds
// a card their resources cannot pay for - and each carries every card type,
// so they meet Interruptions, Tools and a Location in their first game.
// Tuned against each other with debug-tools/riutiz-balance.js (card by card,
// guided by debug-tools/riutiz-card-impact.js). Last run, 2026-09-26, 800
// AI-vs-AI games, every pairing from both seats:
//   Workshop Warriors 53%  Lab Experiment 44%  Drama Club 46%
//   Math League 55%  Tech Club 51%   - seat 1 won 405, seat 2 won 395.
// Pen was left out while it cost (1) - "send home, draw 2" replayed for as long
// as you had resources. It costs (2) now. After the change to several blockers
// per attacker the same lists measured 44-54% (Workshop 52, Lab 44, Drama 47,
// Math 54, Tech 53).

const fs = require('fs');
const path = require('path');

const LISTS = {
    orange_workers: { // aggressive: fast pupils, Parking Lot, +1/+1 boosts
        1: 1, 4: 3, 2: 2, 11: 2, 17: 1, 3: 1, 10: 2, 9: 4, 15: 3, 13: 2, 20: 1, 179: 2, 18: 2, 113: 1,
        26: 2, 38: 3, 25: 1, 36: 1, 239: 3,
        160: 2,
        39: 1
    },
    green_science: { // big bodies, healing, Lethal, The Lab
        44: 3, 45: 3, 49: 1, 51: 2, 48: 1, 50: 2, 60: 2, 55: 2, 57: 2, 58: 1, 53: 2, 52: 2, 43: 1, 64: 1, 62: 2,
        216: 2, 210: 1, 212: 1, 214: 2, 213: 1, 34: 1, 217: 1,
        159: 1, 160: 1,
        66: 1, 65: 1
    },
    purple_drama: { // damage from hand, Music Room
        72: 2, 78: 3, 67: 2, 81: 2, 83: 2, 86: 2, 70: 2, 85: 2, 18: 2, 113: 2, 80: 1, 91: 1,
        196: 3, 197: 2, 198: 3, 206: 2, 200: 1, 207: 1, 204: 1, 239: 1,
        194: 1, 188: 1,
        92: 1
    },
    blue_math: { // defence, card draw, combat tricks, The Office
        100: 3, 102: 2, 96: 2, 103: 3, 87: 2, 97: 1, 101: 2, 104: 2, 108: 1, 109: 1, 110: 2, 112: 1, 106: 2, 115: 1, 113: 1,
        218: 2, 222: 1, 225: 1, 219: 1, 224: 1, 33: 1, 223: 1, 239: 1,
        116: 2, 160: 2,
        118: 1
    },
    black_tech: { // Tools, disruption, The Computer Lab
        121: 3, 122: 3, 129: 2, 131: 1, 132: 2, 119: 2, 124: 1, 127: 1, 126: 2, 137: 2, 134: 1, 135: 1, 139: 1, 185: 1, 128: 1,
        226: 2, 228: 2, 230: 1, 227: 1, 231: 1, 232: 1, 237: 1, 229: 1,
        195: 1, 141: 1, 142: 1, 160: 1, 161: 1,
        143: 1
    }
};

function build(lists = LISTS) {
    const root = path.join(__dirname, '..', 'games', 'Data', 'Riutiz');
    const cards = JSON.parse(fs.readFileSync(path.join(root, 'cards.json'), 'utf8'));
    const file = JSON.parse(fs.readFileSync(path.join(root, 'starter-decks.json'), 'utf8'));
    const byId = new Map(cards.map(c => [String(c.id), c]));
    for (const deck of file.starter_decks) {
        const list = lists[deck.id];
        if (!list) throw new Error('no list for ' + deck.id);
        const ids = [];
        for (const [id, n] of Object.entries(list)) {
            if (!n) continue;
            const c = byId.get(String(id));
            if (!c) throw new Error(`${deck.id}: no card ${id}`);
            if (n > 4) throw new Error(`${deck.id}: ${n} copies of ${c.name}`);
            // Same id type as cards.json uses
            for (let i = 0; i < n; i++) ids.push(c.id);
        }
        if (ids.length !== 40) throw new Error(`${deck.id} has ${ids.length} cards, not 40`);
        deck.cards = Object.fromEntries(Object.entries(list).filter(([, n]) => n).map(([id, n]) => [String(id), n]));
        deck.deck_list = ids;
    }
    return file;
}

if (require.main === module) {
    const out = process.argv[2] || path.join(__dirname, '..', 'games', 'Data', 'Riutiz', 'starter-decks.json');
    fs.writeFileSync(out, JSON.stringify(build(), null, 2) + '\n');
    console.log('wrote ' + out);
}

module.exports = { LISTS, build };
