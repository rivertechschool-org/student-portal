# RIUTIZ journey: plays whole games against the AI the way a student would,
# using ONLY clicks on what is on screen:
#
#   pick a starter deck, Play vs AI, pick a deck; then each turn play a
#   resource, play whatever it can afford (tapping the highlighted target
#   when a card asks for one, and answering the choice dialog when one
#   appears), use an ability now and then, attack with everything, and on
#   the AI's turn block by tapping a pupil and then an attacker.
#
# A click the page intercepts is reported rather than worked around, which
# is how an unclickable hand was found; so is a game that stops changing for
# 25 seconds, and every console error.
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
URL = os.environ.get('RIUTIZ_URL', 'http://localhost:8765/games/riutiz.html')

STATE_JS = """() => { if (typeof game === 'undefined' || !game || !game.state) return null; const s = game.state;
  return { turn: s.turn, cur: s.currentPlayer, phase: s.phase, step: s.combatStep || null,
    over: !!s.gameOver, p1: s.players[1].points, p2: s.players[2].points,
    hand: s.players[1].hand.length, field1: s.players[1].field.length, field2: s.players[2].field.length,
    res1: s.players[1].resources.length, pending: s.pending.length ? [s.pending[0].player, s.pending[0].kind] : null,
    acting: !!(ui && (ui.action || ui.pickingMode)), combatDone: !!s.players[1].flags.combatDone,
    resPlayed: !!s.players[1].resourcePlayedThisTurn,
    choice: !!document.getElementById('riutiz-choice'),
    victory: !document.getElementById('victory-screen').classList.contains('hidden'),
    msg: document.getElementById('message')?.textContent || '',
    btns: [...document.querySelectorAll('#action-buttons button')].map(b => b.textContent.trim()) }; }"""


async def click(pg, loc, log, what):
    try:
        await loc.click(timeout=3000)
        await pg.wait_for_timeout(150)
        return True
    except Exception as ex:
        log.append(f'UNCLICKABLE {what}: {str(ex).splitlines()[0][:120]}')
        return False


async def click_btn(pg, prefix, log):
    btns = pg.locator('#action-buttons button')
    for i in range(await btns.count()):
        b = btns.nth(i)
        t = (await b.text_content() or '').strip()
        if t.startswith(prefix) and await b.is_enabled():
            return await click(pg, b, log, f'button {t}')
    return False


async def answer_choice(pg, log):
    q = await pg.evaluate("() => { const q = game.pendingChoice; return q && q.player === 1 ? { kind: q.kind, min: q.min, max: q.max, n: q.options.length, reveal: !!q.reveal } : null; }")
    if not q:
        return False
    dlg = pg.locator('#riutiz-choice')
    if q['kind'] == 'order':
        want = q['n']
    elif q['reveal'] or q['max'] == 0:
        want = 0
    else:
        want = max(q['min'], 1 if q['max'] > 0 else 0)
    # option elements: cards or buttons inside the grid (the last row holds Confirm)
    opts = dlg.locator('div > div:nth-child(3) > *')
    for i in range(min(want, await opts.count())):
        await click(pg, opts.nth(i), log, 'choice option')
    confirm = dlg.locator('button').last
    await click(pg, confirm, log, 'choice confirm')
    return True


async def pick_target(pg, log):
    tgt = pg.locator('#your-field .card.targetable, #opp-field .card.targetable, #your-artifacts .card.targetable, '
                     '#opp-artifacts .card.targetable, #your-resources .resource-token.targetable, #opp-resources .resource-token.targetable')
    if await tgt.count():
        return await click(pg, tgt.first, log, 'target')
    if await click_btn(pg, 'Skip', log):
        return True
    return await click_btn(pg, '✕', log)


async def my_main(pg, st, log, gi, turn_state):
    # resource once
    if not st['resPlayed'] and st['hand']:
        cards = pg.locator('#your-hand .card')
        if await cards.count():
            await click(pg, cards.last, log, 'hand card')
            if await click_btn(pg, '🔋', log):
                return True
            await click_btn(pg, '✕', log)
    # a playable card
    playable = await pg.evaluate("""() => game.state.players[1].hand.map((c, i) => [i, game.getPlayOptions(1, c.instanceId).canPlay]).filter(x => x[1]).map(x => x[0])""")
    tried = turn_state.setdefault('tried', set())
    for idx in playable:
        key = (st['turn'], idx, st['hand'])
        if key in tried:
            continue
        tried.add(key)
        cards = pg.locator('#your-hand .card')
        if idx < await cards.count():
            await click(pg, cards.nth(idx), log, 'hand card')
            if await click_btn(pg, '▶', log):
                turn_state['played'] = turn_state.get('played', 0) + 1
                return True
            await click_btn(pg, '✕', log)
    # an ability, once per turn at most
    if not turn_state.get('ability'):
        turn_state['ability'] = True
        usable = await pg.evaluate("""() => game.state.players[1].field.filter(c => game.getAbilities(1, c.instanceId).some(a => a.canUse)).map(c => c.instanceId)""")
        if usable:
            el = pg.locator(f'#your-field .card, #your-artifacts .card').filter(has_text='')
            # tap the card by its position among field/artifact cards
            idx = await pg.evaluate(f"""() => {{ const all = [...document.querySelectorAll('#your-field .card, #your-artifacts .card')];
                const f = game.state.players[1].field; const pupils = f.filter(c => c.type !== 'Tool' && c.type !== 'Location'), tools = f.filter(c => c.type === 'Tool');
                const order = [...pupils, ...tools].map(c => c.instanceId); return order.indexOf({json.dumps(usable[0])}); }}""")
            cards = pg.locator('#your-field .card, #your-artifacts .card')
            if 0 <= idx < await cards.count():
                await click(pg, cards.nth(idx), log, 'card with ability')
                if await click_btn(pg, '⚡', log):
                    turn_state['abilities'] = turn_state.get('abilities', 0) + 1
                    return True
                await click_btn(pg, '✕', log)
    # combat
    if not st['combatDone']:
        if await click_btn(pg, '⚔', log):
            await pg.wait_for_timeout(200)
            n = await pg.locator('#your-field .card.targetable').count()
            for k in range(n):
                cards = pg.locator('#your-field .card.targetable:not(.attacker)')
                if await cards.count():
                    await click(pg, cards.first, log, 'attacker')
            if not await click_btn(pg, '✓ Attack', log):
                await click_btn(pg, 'No attack', log)
            return True
    return await click_btn(pg, 'End Turn', log)


async def defend(pg, log):
    # assign each free pupil to an attacker: tap ours, then (if asked) theirs
    for _ in range(6):
        mine = pg.locator('#your-field .card.targetable:not(.blocker)')
        if not await mine.count():
            break
        await click(pg, mine.first, log, 'blocker')
        theirs = pg.locator('#opp-field .card.attacker.targetable')
        if await theirs.count():
            await click(pg, theirs.first, log, 'attacker to block')
        await pg.wait_for_timeout(100)
        if await pg.locator('#your-field .card.blocker').count() >= await pg.locator('#opp-field .card.attacker').count():
            break
    return await click_btn(pg, '✓ Done Blocking', log)


async def play_one(pg, gi, log):
    await pg.click('text=Play vs AI')
    await pg.wait_for_timeout(700)
    if await pg.is_visible('#deck-select-screen'):
        await pg.click('.deck-select-card >> nth=0')
        await pg.click('#confirm-deck-btn')
        await pg.wait_for_timeout(700)
    last_sig, last_change, t0 = None, time.time(), time.time()
    turn_states = {}
    shots = set()
    stats = {'played': 0, 'abilities': 0, 'choices': 0, 'blocks': 0}
    while time.time() - t0 < 900:
        st = await pg.evaluate(STATE_JS)
        if st is None:
            return 'no game object', stats
        sig = json.dumps({k: st[k] for k in ('turn', 'cur', 'phase', 'step', 'p1', 'p2', 'hand', 'field1', 'field2', 'res1', 'pending', 'acting', 'btns')})
        if sig != last_sig:
            last_sig, last_change = sig, time.time()
        if st['victory'] or st['over']:
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=f'{OUT}/g{gi}-end.png')
            return f"over p1={st['p1']} p2={st['p2']} turn={st['turn']} victory_screen={st['victory']}", stats
        if time.time() - last_change > 25:
            await pg.screenshot(path=f'{OUT}/g{gi}-stall.png')
            return f'STALL {json.dumps(st)}', stats
        if st['turn'] in (3, 9) and st['turn'] not in shots and st['cur'] == 1:
            shots.add(st['turn'])
            await pg.screenshot(path=f"{OUT}/g{gi}-t{st['turn']}.png")
        ts = turn_states.setdefault(st['turn'], {})
        if st['choice']:
            if await answer_choice(pg, log):
                stats['choices'] += 1
        elif st['acting']:
            if await pg.locator('#action-buttons button').count() and await pg.evaluate('() => !!ui.pickingMode'):
                await pg.locator('#action-buttons button').first.click()
            else:
                await pick_target(pg, log)
        elif st['cur'] == 1 and st['phase'] == 'main' and not st['step'] and not st['pending']:
            await my_main(pg, st, log, gi, ts)
        elif st['cur'] == 1 and st['phase'] == 'end' and not st['step'] and not st['pending']:
            await click_btn(pg, 'End Turn', log)
        elif st['step'] == 'declare-attackers' and st['cur'] == 1:
            if not await click_btn(pg, '✓ Attack', log):
                await click_btn(pg, 'No attack', log)
        elif st['step'] == 'declare-blockers' and st['cur'] == 2:
            if await defend(pg, log):
                stats['blocks'] += 1
        for k in ('played', 'abilities'):
            stats[k] = sum(v.get(k, 0) for v in turn_states.values())
        await pg.wait_for_timeout(250)
    return 'TIMEOUT', stats


async def main():
    async with async_playwright() as p:
        exe = os.environ.get('RIUTIZ_CHROMIUM')
        b = await (p.chromium.launch(executable_path=exe, headless=True) if exe
                   else p.chromium.launch(channel='chrome', headless=True))
        pg = await b.new_page(viewport={'width': 1400, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(f'[PAGEERROR] {e}'))
        pg.on('console', lambda m: m.type in ('error', 'warning') and errs.append(f'[{m.type}] {m.text[:300]}'))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(URL)
        await pg.wait_for_timeout(3000)
        if await pg.is_visible('#starter-deck-screen'):
            await pg.click('.starter-deck-card >> nth=3')
            await pg.wait_for_timeout(2000)
        for gi in range(GAMES):
            log = []
            r, stats = await play_one(pg, gi, log)
            print(f'GAME {gi}: {r}  {json.dumps(stats)}')
            for l in log[:15]:
                print('   ', l)
            if await pg.is_visible('#victory-screen'):
                await pg.click('#victory-screen button')
                await pg.wait_for_timeout(800)
            else:
                await pg.evaluate('showMenu()')
                await pg.wait_for_timeout(500)
        print(f'screenshots: {OUT}')
        print('--- errors/warnings (deduped) ---')
        seen = {}
        for e in errs:
            k = e.split('\n')[0][:200]
            seen[k] = seen.get(k, 0) + 1
        for k, n in seen.items():
            print(f'{n:4}x {k}')
        await b.close()

asyncio.run(main())
