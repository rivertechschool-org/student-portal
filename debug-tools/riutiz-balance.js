// RIUTIZ balance: every starter deck against every other, from both seats,
// AI against AI, under a seeded Math.random so a run is reproducible.
//
//   node debug-tools/riutiz-balance.js [games per pairing per seat] [decks.json]
//
// Prints each deck's overall win rate, the pairing matrix, how long games run
// and how lopsided they end. A second decks file can be passed to try a change
// before writing it into games/Data/Riutiz/starter-decks.json.
//
// The AI is the same one students play against, so this measures the decks as
// that AI plays them - a strong human will do better with some than others.
// It is a floor under balance, not the whole of it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const G = path.join(__dirname, '..', 'games');
const CARDS = JSON.parse(fs.readFileSync(path.join(G, 'Data', 'Riutiz', 'cards.json'), 'utf8'));
const SRC = ['RiutizCards.js', 'RiutizGame.js', 'RiutizAI.js']
  .map(f => fs.readFileSync(path.join(G, 'riutiz', f), 'utf8')).join('\n');

const N = parseInt(process.argv[2], 10) || 20;
const deckFile = process.argv[3] || path.join(G, 'Data', 'Riutiz', 'starter-decks.json');
const DECKS = JSON.parse(fs.readFileSync(deckFile, 'utf8')).starter_decks;

function boot(seed) {
  const timers = [];
  const errors = [];
  let s = (seed >>> 0) || 1;
  const rnd = () => {                      // mulberry32
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sandbox = {
    console: { log() {}, info() {}, debug() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')) },
    setTimeout: (fn, ms, ...args) => { timers.push({ fn, args }); return timers.length; },
    clearTimeout() {},
    EventTarget, CustomEvent, Event,
    __rnd: rnd,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC + '\nMath.random = __rnd;', ctx, { filename: 'riutiz.js' });
  return {
    RiutizGame: vm.runInContext('RiutizGame', ctx),
    RiutizAI: vm.runInContext('RiutizAI', ctx),
    errors,
    // Schedule on the same queue drain() watches, so a turn handed over is
    // never mistaken for the game going idle.
    later(fn) { timers.push({ fn, args: [] }); },
    async drain() {
      for (let n = 0; n < 200000; n++) {
        await new Promise(r => setImmediate(r));
        if (!timers.length) { await new Promise(r => setImmediate(r)); if (!timers.length) return; }
        const t = timers.shift(); t.fn(...t.args);
      }
      throw new Error('drain limit');
    }
  };
}

async function play(seed, d1, d2) {
  const env = boot(seed);
  const game = new env.RiutizGame({ mode: 'vs-ai', cardData: CARDS, player1Deck: [...d1.deck_list], player2Deck: [...d2.deck_list] });
  const ai = { 1: new env.RiutizAI(game, 1, { thinkingDelay: 0, actionDelay: 0 }), 2: new env.RiutizAI(game, 2, { thinkingDelay: 0, actionDelay: 0 }) };
  game.addEventListener('turnEnded', e => {
    if (!game.state.gameOver && game.state.turn <= 80) env.later(() => ai[e.detail.nextPlayer].takeTurn());
  });
  game.addEventListener('attackersDeclared', () => {
    const d = game.state.currentPlayer === 1 ? 2 : 1;
    env.later(() => ai[d].declareBlockers());
  });
  game.startGame();
  ai[1].takeTurn();
  await env.drain();
  for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r));
  await env.drain();
  const p = game.state.players;
  // RIUTIZ_BAL_DEBUG=1 describes games that did not finish
  if (process.env.RIUTIZ_BAL_DEBUG && !game.state.gameOver) {
    const st = game.state;
    console.log(`  unfinished seed ${seed}: turn ${st.turn} player ${st.currentPlayer} phase ${st.phase}/${st.combatStep} ` +
      `pending ${JSON.stringify(st.pending.map(q => [q.player, q.kind, q.prompt]))} decks ${p[1].deck.length}/${p[2].deck.length} ` +
      `running ${ai[1].isRunning}/${ai[2].isRunning} last: ${st.log.slice(-3).join(' | ')}`);
  }
  return { over: game.state.gameOver, winner: game.state.winner, turn: game.state.turn, s1: p[1].points, s2: p[2].points, errors: env.errors.length };
}

(async () => {
  const names = DECKS.map(d => d.name);
  const wins = {}, games = {}, matrix = {};
  let turns = [], margins = [], capped = 0, errs = 0, seatWins = { 1: 0, 2: 0 };
  names.forEach(a => { wins[a] = 0; games[a] = 0; matrix[a] = {}; names.forEach(b => { matrix[a][b] = [0, 0]; }); });

  let seed = 1;
  for (let i = 0; i < DECKS.length; i++) {
    for (let j = 0; j < DECKS.length; j++) {
      if (i === j) continue;
      for (let k = 0; k < N; k++) {
        const r = await play(seed++, DECKS[i], DECKS[j]);
        errs += r.errors;
        if (!r.over) { capped++; continue; }
        const a = DECKS[i].name, b = DECKS[j].name;
        games[a]++; games[b]++;
        const w = r.winner === 1 ? a : b;
        wins[w]++; seatWins[r.winner]++;
        matrix[a][b][1]++; matrix[b][a][1]++;
        if (r.winner === 1) matrix[a][b][0]++; else matrix[b][a][0]++;
        turns.push(r.turn); margins.push(Math.abs(r.s1 - r.s2));
      }
    }
  }
  const pct = (w, g) => g ? Math.round(100 * w / g) + '%' : '-';
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : '-'; };

  console.log(`\n${N} games per pairing per seat, ${turns.length} finished, ${capped} hit the turn cap, ${errs} engine errors`);
  console.log(`seat 1 won ${seatWins[1]}, seat 2 won ${seatWins[2]}`);
  console.log(`turns: avg ${avg(turns)}, median ${median(turns)}   final margin: avg ${avg(margins)}, median ${median(margins)}\n`);
  const w = Math.max(...names.map(n => n.length));
  console.log('overall'.padEnd(w + 2) + '  ' + names.map(n => n.slice(0, 8).padStart(9)).join(''));
  for (const a of names) {
    console.log(`${a.padEnd(w)}  ${pct(wins[a], games[a]).padStart(5)}  ` +
      names.map(b => (a === b ? '·' : pct(...matrix[a][b])).padStart(9)).join(''));
  }
  const rates = names.map(n => wins[n] / (games[n] || 1));
  console.log(`\nspread: ${Math.round(100 * Math.min(...rates))}% – ${Math.round(100 * Math.max(...rates))}%`);
})();
