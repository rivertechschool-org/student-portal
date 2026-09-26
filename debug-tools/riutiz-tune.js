// RIUTIZ starter-deck tuner: nudge the five decks toward winning half their
// games against each other, one card at a time.
//
//   node debug-tools/riutiz-tune.js [iterations] [games per pairing per seat]
//
// Starts from debug-tools/riutiz-starter-lists.js. Each iteration takes the
// deck furthest from 50%, proposes swapping one of its cards for another of
// its colour (or colourless) - never below 20 pupils or 6 Interruptions,
// never touching its Location, never more than 4 of a card - and replays the
// deck's games on the SAME seeds (so a change is judged against the same
// dice, not against luck). A swap that brings it closer to 50% is kept.
// Prints the tuned lists, ready to paste into riutiz-starter-lists.js.
//
// Balance is measured with the AI the students play against, both sides.
// It is a floor under balance: a good human may still prefer one deck.

const fs = require('fs');
const path = require('path');
const { play } = require('./riutiz-balance.js');
const { LISTS, build } = require('./riutiz-starter-lists.js');

const ITER = parseInt(process.argv[2], 10) || 30;
const N = parseInt(process.argv[3], 10) || 10;
const ROOT = path.join(__dirname, '..', 'games', 'Data', 'Riutiz');
const CARDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf8'));
const byId = new Map(CARDS.map(c => [String(c.id), c]));
const colorsOf = c => new Set((String(c.cost || '').match(/\(([^)]+)\)/g) || []).map(x => x.slice(1, -1)).filter(x => !/^\d+$/.test(x)));
const kind = c => c.type === 'Interruption' ? 'I' : c.type === 'Tool' ? 'T' : c.type === 'Location' ? 'L' : 'P';

const DECK_COLOR = { orange_workers: 'O', green_science: 'G', purple_drama: 'P', blue_math: 'B', black_tech: 'Bk' };
const lists = JSON.parse(JSON.stringify(LISTS));
const ids = Object.keys(lists);

function pool(deckId) {
    const col = DECK_COLOR[deckId];
    return CARDS.filter(c => c.type !== 'Location' && [...colorsOf(c)].every(x => x === col)).map(c => String(c.id));
}

function deckList(list) {
    const out = [];
    for (const [id, n] of Object.entries(list)) for (let i = 0; i < n; i++) out.push(byId.get(String(id)).id);
    return out;
}

function counts(list) {
    const t = { P: 0, I: 0, T: 0, L: 0 };
    for (const [id, n] of Object.entries(list)) t[kind(byId.get(String(id)))] += n;
    return t;
}

// Win rate of one deck against the other four, both seats, fixed seeds.
async function rateOf(deckId, current) {
    let wins = 0, games = 0;
    let seed = 100000 + ids.indexOf(deckId) * 10000;
    for (const other of ids) {
        if (other === deckId) continue;
        for (let k = 0; k < N; k++) {
            for (const seat of [1, 2]) {
                const me = { deck_list: deckList(current[deckId]) }, them = { deck_list: deckList(current[other]) };
                const r = await play(seed++, seat === 1 ? me : them, seat === 1 ? them : me);
                if (!r.over) continue;
                games++;
                if (r.winner === seat) wins++;
            }
        }
    }
    return games ? wins / games : 0.5;
}

function propose(deckId, list, strengthen) {
    const current = Object.entries(list).filter(([id]) => kind(byId.get(id)) !== 'L');
    const t = counts(list);
    const p = pool(deckId);
    for (let tries = 0; tries < 50; tries++) {
        const [outId] = current[Math.floor(Math.random() * current.length)];
        const inId = p[Math.floor(Math.random() * p.length)];
        if (inId === outId || (list[inId] || 0) >= 4) continue;
        const ko = kind(byId.get(outId)), ki = kind(byId.get(inId));
        const nt = { ...t }; nt[ko]--; nt[ki]++;
        if (nt.P < 20 || nt.I < 6 || nt.T < 1) continue;
        const next = { ...list };
        next[outId]--; if (!next[outId]) delete next[outId];
        next[inId] = (next[inId] || 0) + 1;
        return { next, label: `-${byId.get(outId).name} +${byId.get(inId).name}` };
    }
    return null;
}

(async () => {
    const t0 = Date.now();
    const rates = {};
    for (const id of ids) rates[id] = await rateOf(id, lists);
    const show = () => ids.map(id => `${id.split('_')[0]} ${Math.round(rates[id] * 100)}%`).join('  ');
    console.log(`start: ${show()}   (${Math.round((Date.now() - t0) / 1000)}s)`);

    for (let it = 1; it <= ITER; it++) {
        const target = ids.slice().sort((a, b) => Math.abs(rates[b] - 0.5) - Math.abs(rates[a] - 0.5))[0];
        const before = rates[target];
        if (Math.abs(before - 0.5) < 0.04) { console.log('all within 4 points of 50%'); break; }
        let accepted = false;
        for (let tryN = 0; tryN < 4 && !accepted; tryN++) {
            const prop = propose(target, lists[target], before < 0.5);
            if (!prop) break;
            const trial = { ...lists, [target]: prop.next };
            const r = await rateOf(target, trial);
            if (Math.abs(r - 0.5) + 0.015 < Math.abs(before - 0.5)) {
                lists[target] = prop.next;
                rates[target] = r;
                accepted = true;
                // the others' rates shift too; re-measure the rest cheaply next round
                for (const id of ids) if (id !== target) rates[id] = await rateOf(id, lists);
                console.log(`#${it} ${target}: ${prop.label}  ${Math.round(before * 100)}% -> ${Math.round(r * 100)}%   | ${show()}`);
            }
        }
        if (!accepted) console.log(`#${it} ${target}: no swap helped (${Math.round(before * 100)}%)`);
    }
    console.log(`\nfinal: ${show()}   (${Math.round((Date.now() - t0) / 60000)} min)\n`);
    console.log('const LISTS = ' + JSON.stringify(lists, null, 4).replace(/"(\d+)":/g, '$1:') + ';');
    fs.writeFileSync(path.join(__dirname, '..', '.riutiz-tuned.json'), JSON.stringify(lists));
})();
