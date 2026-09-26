// Which cards win RIUTIZ games? For each starter deck, the win rate in games
// where a card was PLAYED (from hand, not as a resource) against the deck's
// overall win rate. A card well above its deck's line is carrying it; one
// well below is dead weight - the first places to look when rebalancing.
//
//   node debug-tools/riutiz-card-impact.js [games per pairing per seat] [decks.json]

const fs = require('fs');
const path = require('path');
const { play } = require('./riutiz-balance.js');

const N = parseInt(process.argv[2], 10) || 10;
const file = process.argv[3] || path.join(__dirname, '..', 'games', 'Data', 'Riutiz', 'starter-decks.json');
const DECKS = JSON.parse(fs.readFileSync(file, 'utf8')).starter_decks;
const CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'games', 'Data', 'Riutiz', 'cards.json'), 'utf8'));
const name = id => (CARDS.find(c => String(c.id) === String(id)) || {}).name || id;

(async () => {
  const stats = {};   // deck -> card -> { played, wins }
  const overall = {};
  let seed = 7000;
  for (let i = 0; i < DECKS.length; i++) for (let j = 0; j < DECKS.length; j++) {
    if (i === j) continue;
    for (let k = 0; k < N; k++) {
      const played = { 1: new Set(), 2: new Set() };
      const r = await play(seed++, DECKS[i], DECKS[j], g => {
        g.addEventListener('cardPlayed', e => played[e.detail.player].add(String(e.detail.card.id)));
      });
      if (!r.over) continue;
      for (const [seat, deck] of [[1, DECKS[i]], [2, DECKS[j]]]) {
        const won = r.winner === seat;
        const o = overall[deck.name] = overall[deck.name] || { g: 0, w: 0 };
        o.g++; if (won) o.w++;
        const st = stats[deck.name] = stats[deck.name] || {};
        for (const id of new Set(deck.deck_list.map(String))) {
          const s = st[id] = st[id] || { played: 0, wins: 0 };
          if (played[seat].has(id)) { s.played++; if (won) s.wins++; }
        }
      }
    }
  }
  for (const deck of DECKS) {
    const o = overall[deck.name];
    const base = o.w / o.g;
    console.log(`\n${deck.name}: ${Math.round(100 * base)}% overall`);
    const rows = Object.entries(stats[deck.name]).filter(([, s]) => s.played >= 5)
      .map(([id, s]) => ({ id, name: name(id), n: s.played, wr: s.wins / s.played }))
      .sort((a, b) => b.wr - a.wr);
    for (const r of rows) console.log(`  ${String(Math.round(100 * r.wr)).padStart(3)}%  ${(r.wr - base >= 0 ? '+' : '') + Math.round(100 * (r.wr - base))}  ${r.name} (${r.n})`);
  }
})();
