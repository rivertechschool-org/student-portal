# RIUTIZ journey: plays whole games against the AI the way a student would -
# pick a starter deck, Play vs AI, pick a deck, then each turn a resource, the
# first card it can afford, attack with everything, Done Blocking on the AI's
# turn - using ONLY clicks on what is on screen. A click the page intercepts is
# reported, not worked around silently, which is how the unclickable hand was
# found; so is a game that stops changing for 25 seconds.
#
#   python -m http.server 8765 &          (from the repo root)
#   python debug-tools/riutiz-journey.py [games] [screenshot dir]
#
# Needs Python Playwright. Uses installed Chrome; set RIUTIZ_CHROMIUM to a
# Chromium binary instead (e.g. /opt/pw-browsers/.../chrome).
# Signed out, so the two "not authenticated" errors at load are expected.
import asyncio, sys, json, time, os, tempfile
from playwright.async_api import async_playwright
GAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 3
OUT = sys.argv[2] if len(sys.argv) > 2 else tempfile.mkdtemp(prefix='riutiz-')

STATE_JS = """() => { if (typeof game === 'undefined' || !game) return null; const s = game.state;
  return { turn: s.turnNumber ?? s.turn, cur: s.currentPlayer, phase: s.phase, step: s.combatStep || null,
    over: !!s.gameOver, p1: s.players[1].points, p2: s.players[2].points,
    hand: s.players[1].hand.length, deck: s.players[1].deck.length,
    field1: s.players[1].field.length, field2: s.players[2].field.length,
    res1: s.players[1].resources.length,
    msg: document.getElementById('message')?.textContent || '',
    victory: !document.getElementById('victory-screen').classList.contains('hidden'),
    btns: [...document.querySelectorAll('#action-buttons button')].map(b => b.textContent.trim()) }; }"""

async def click_btn(pg, prefix):
    for b in await pg.query_selector_all('#action-buttons button'):
        t = (await b.text_content() or '').strip()
        if t.startswith(prefix):
            await b.click(); await pg.wait_for_timeout(250); return True
    return False

async def play_one(pg, gi, log):
    await pg.click("text=Play vs AI"); await pg.wait_for_timeout(800)
    if await pg.is_visible('#deck-select-screen'):
        await pg.click('.deck-select-card >> nth=0'); await pg.wait_for_timeout(200)
        await pg.click('#confirm-deck-btn'); await pg.wait_for_timeout(800)
        chk = await pg.evaluate("""() => { const d = deckBuilder.getSavedDecks()[0]; const s = game.state.players[1];
            const ids = [...s.hand, ...s.deck, ...s.field, ...s.resources.map(r=>r.card).filter(Boolean)].map(c => String(c.id));
            const want = d.cards.map(String); return { deck: d.name, total: ids.length, allFromDeck: ids.every(i => want.includes(i)) }; }""")
        log.append(f"deck check: {chk}")
    else:
        log.append("NO DECK PICKER shown")
    last_sig, last_change = None, time.time(); played_res_turn = None; turns_seen = set()
    t0 = time.time()
    while time.time() - t0 < 600:
        st = await pg.evaluate(STATE_JS)
        if st is None: log.append("no game object"); return "nogame"
        sig = json.dumps({k: st[k] for k in ('turn','cur','phase','step','p1','p2','hand','field1','field2','res1','btns')})
        if sig != last_sig: last_sig, last_change = sig, time.time()
        if st['victory'] or st['over']:
            await pg.wait_for_timeout(800)
            await pg.screenshot(path=f"{OUT}/g{gi}-end.png")
            return f"over p1={st['p1']} p2={st['p2']} turn={st['turn']} victory_screen={st['victory']}"
        if time.time() - last_change > 25:
            await pg.screenshot(path=f"{OUT}/g{gi}-stall.png")
            return f"STALL {json.dumps(st)}"
        if st['turn'] not in turns_seen and st['cur'] == 1:
            turns_seen.add(st['turn'])
            if len(turns_seen) in (1, 3, 8): await pg.screenshot(path=f"{OUT}/g{gi}-t{st['turn']}.png")
        if st['cur'] == 1 and st['phase'] == 'main' and not st['step']:
            # one resource per turn, from the hand
            if played_res_turn != st['turn']:
                played_res_turn = st['turn']
                cards = await pg.query_selector_all('#your-hand > *')
                if cards:
                    try: await cards[-1].click(timeout=3000)
                    except Exception:
                        log.append(f"t{st['turn']} last hand card UNCLICKABLE")
                        await pg.evaluate("() => ui.handleHandCardClick(game.state.players[1].hand.at(-1))")
                    await pg.wait_for_timeout(200)
                    await click_btn(pg, '🔋')
                    continue
            # play the first affordable card, if any
            playable = await pg.evaluate("""() => game.state.players[1].hand
                 .filter(c => game.canAfford(c, game.state.players[1])).map(c => c.instanceId)""")
            tried = False
            for iid in playable[:1]:
                idx = await pg.evaluate(f"() => game.state.players[1].hand.findIndex(c => c.instanceId === {json.dumps(iid)})")
                cards = await pg.query_selector_all('#your-hand > *')
                if 0 <= idx < len(cards):
                    before = st['hand']
                    try:
                        await cards[idx].click(timeout=3000)
                    except Exception as ex:
                        box = await cards[idx].bounding_box()
                        log.append(f"t{st['turn']} HAND CARD {idx}/{len(cards)} UNCLICKABLE box={box}")
                        await pg.screenshot(path=f"{OUT}/g{gi}-covered-t{st['turn']}.png")
                        await pg.evaluate(f"() => ui.handleHandCardClick(game.state.players[1].hand[{idx}])")
                    await pg.wait_for_timeout(200)
                    await click_btn(pg, '▶')
                    await pg.wait_for_timeout(300)
                    st2 = await pg.evaluate(STATE_JS)
                    if st2['hand'] < before: tried = True
                    else: log.append(f"t{st['turn']} play refused: {st2['msg']}")
                    # targeting mode: pick the first opposing field card or cancel
                    if await pg.query_selector('#action-buttons button:has-text("Cancel")'):
                        tgt = await pg.query_selector('#opp-field > *') or await pg.query_selector('#your-field > *')
                        if tgt: await tgt.click(); await pg.wait_for_timeout(300)
                        if await pg.query_selector('#action-buttons button:has-text("Cancel")'):
                            await click_btn(pg, '✕'); log.append(f"t{st['turn']} targeting cancelled")
            if tried and len(playable) > 1: continue
            if not getattr(play_one, 'fought', {}).get((gi, st['turn'])):
                play_one.fought = getattr(play_one, 'fought', {}); play_one.fought[(gi, st['turn'])] = True
                if await click_btn(pg, '⚔'):
                    await pg.wait_for_timeout(300)
                    n = len(await pg.query_selector_all('#your-field > *'))
                    for k in range(n):
                        c = pg.locator('#your-field > *').nth(k)
                        try: await c.click(timeout=2000)
                        except Exception as ex:
                            hit = await pg.evaluate(f"""() => {{ const c = document.querySelectorAll('#your-field > *')[{k}]; if (!c) return 'gone';
                                const r = c.getBoundingClientRect(); const el = document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
                                return c.contains(el) ? 'ok?' : (el.closest('.hand-card-wrapper') ? 'HAND' : String(el.className||el.tagName).slice(0,40)); }}""")
                            log.append(f"t{st['turn']} field card {k} UNCLICKABLE: {hit}")
                        await pg.wait_for_timeout(120)
                    if not await click_btn(pg, '✓ Attack'): await click_btn(pg, 'Skip')
                    await pg.wait_for_timeout(2500)
                    continue
            await click_btn(pg, 'End Turn')
        elif st['cur'] == 1 and st['phase'] == 'end' and not st['step']:
            await click_btn(pg, 'End Turn')
        elif st['step'] == 'declare-attackers' and st['cur'] == 1:
            if not await click_btn(pg, '✓ Attack'): await click_btn(pg, 'Skip')
        elif st['step'] == 'declare-blockers' and st['cur'] == 2:
            await click_btn(pg, '✓ Done Blocking')
        await pg.wait_for_timeout(300)
    return "TIMEOUT"

async def main():
    async with async_playwright() as p:
        exe = os.environ.get('RIUTIZ_CHROMIUM')
        b = await (p.chromium.launch(executable_path=exe, headless=True) if exe
                   else p.chromium.launch(channel="chrome", headless=True))
        pg = await b.new_page(viewport={"width":1400,"height":900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(f"[PAGEERROR] {e}"))
        pg.on("console", lambda m: m.type in ("error","warning") and errs.append(f"[{m.type}] {m.text[:300]}"))
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto("http://localhost:8765/games/riutiz.html"); await pg.wait_for_timeout(3000)
        if await pg.is_visible('#starter-deck-screen'):
            await pg.click('.starter-deck-card >> nth=3'); await pg.wait_for_timeout(2000)
        for gi in range(GAMES):
            log = []
            r = await play_one(pg, gi, log)
            print(f"GAME {gi}: {r}")
            for l in log[:15]: print("   ", l)
            if await pg.is_visible('#victory-screen'):
                await pg.click('#victory-screen button'); await pg.wait_for_timeout(1000)
            else:
                await pg.evaluate("showMenu()"); await pg.wait_for_timeout(500)
        print(f"screenshots: {OUT}")
        print("--- errors/warnings (deduped) ---")
        seen = {}
        for e in errs:
            k = e.split('\n')[0][:160]; seen[k] = seen.get(k, 0) + 1
        for k, n in seen.items(): print(f"{n:4}x {k}")
        await b.close()
asyncio.run(main())
