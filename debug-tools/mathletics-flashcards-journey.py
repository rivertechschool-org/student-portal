#!/usr/bin/env python3
# Mathletics flashcards, played in a real browser.
#
# Asked for 2026-10-20: "a flashcard style that isn't timed and does your
# weakest ones, and you can override and pick anything".
#
# This plays it standalone (no portal, nothing saved) and checks:
#   - the weakest deck starts with the fact missed last time, then the slow one
#   - there is no clock: an answer after a long wait still counts as right
#   - a missed card comes back later in the deck; a right one leaves it
#   - Show answer counts as a miss
#   - results name the cards to practise again
#   - flashcards never touch the timed medal record, but do change "weakest"
#   - picking by hand: one square, a whole times table, beyond the range
#   - on a phone the page does not scroll sideways
#
# Run:  python -m http.server 8784 &   (repo root)
#       python debug-tools/mathletics-flashcards-journey.py
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('MATHLETICS_URL', 'http://localhost:8784/games/mathletics.html')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
OUT = os.environ.get('SHOT_DIR', os.environ.get('TEMP', '.'))
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

CARD = "() => { const f = window.mathletics.flash; return f && f.card ? { k: f.card.k, a: f.card.a, b: f.card.b, left: f.deck.length } : null; }"

def answer_card(pg, right=True):
    c = pg.evaluate(CARD)
    pg.fill('#flash-input', str(c['a'] * c['b'] + (0 if right else 1)))
    pg.press('#flash-input', 'Enter')
    return c

SEED = """() => { const m = window.mathletics;
    m.studentData.needs_placement = false; m.studentData.session_count = 3;
    m.studentData.current_range = { min: 0, max: 5 };
    m.studentData.problem_history = {};
    // 3x4 missed last time, 2x5 right but slow, every other fact from 0 to 5
    // except 4x5 mastered; 4x5 never tried.
    const facts = {};
    for (let a = 0; a <= 5; a++) for (let b = a; b <= 5; b++) facts[`${a}x${b}`] = { r: [1, 1] };
    facts['3x4'] = { r: [1, -1] }; facts['2x5'] = { r: [1, 0] }; delete facts['4x5'];
    m.studentData.mastery_progress = { facts };
    m.flashPicks = null; m.showMainMenu(); }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    pg = b.new_page(viewport={'width': 900, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.dismiss())
    pg.goto(URL)
    pg.wait_for_function("window.mathletics && window.mathletics.studentData", timeout=30000)
    pg.evaluate(SEED)

    print('\n== the menu and the weakest deck ==')
    ok('the main menu offers Flashcards', pg.locator('#main-menu button', has_text='Flashcards').count() == 1)
    pg.click('#main-menu button:has-text("Flashcards")')
    ok('the flashcard screen opens', pg.is_visible('#flash-setup'))
    pv = pg.inner_text('#flash-weak-preview')
    order = pv.split(': ', 1)[-1].split(', ')
    ok('weakest first: the fact missed last time', order[0] == '3 × 4', pv[:90])
    ok('  then the slow one, then the untried one', order[1:3] == ['2 × 5', '4 × 5'], ', '.join(order[:4]))
    pg.select_option('#flash-count', '10')
    ok('the preview follows the deck size', len(pg.inner_text('#flash-weak-preview').split(': ', 1)[-1].split(', ')) == 10)

    pg.click('button:has-text("Start my weakest")')
    ok('the card screen opens', pg.is_visible('#flash-screen'))
    ok('  with no clock on screen', not pg.is_visible('#timer'))
    c = pg.evaluate(CARD)
    ok('the first card is 3 × 4 (either way round)', c['k'] == '3x4', str(c))
    ok('  and says why it is there', 'Missed' in pg.inner_text('#flash-why'), pg.inner_text('#flash-why'))

    print('\n== untimed, misses come back ==')
    # Wrong first: the card goes back into the deck, three cards later.
    answer_card(pg, right=False)
    ok('a wrong answer shows the right one', '= 12' in pg.inner_text('#flash-back'))
    ok('  and says the card comes back', 'comes back' in pg.inner_text('#flash-why'))
    deck = pg.evaluate("window.mathletics.flash.deck.map(c => c.k)")
    ok('  and it sits three cards later', deck.index('3x4') == 3, str(deck[:5]))
    pg.press('#flash-next', 'Enter')
    # A long think is fine: no timer, the answer still counts.
    pg.wait_for_timeout(6000)
    c = answer_card(pg, right=True)
    ok('after a 6-second think, a right answer is right', 'Got it' in pg.inner_text('#flash-why'))
    pg.click('#flash-next')
    # Show answer on the next one: a miss. Not on 4 x 5, the untried fact,
    # which is answered right below to see "weakest" learn from a card.
    c = pg.evaluate(CARD)
    if c['k'] == '4x5':
        answer_card(pg, right=True); pg.click('#flash-next'); c = pg.evaluate(CARD)
    pg.click('button:has-text("Show answer")')
    ok('Show answer turns the card over', f"= {c['a'] * c['b']}" in pg.inner_text('#flash-back'))
    ok('  and counts as a miss', pg.evaluate(f"window.mathletics.flash.misses['{c['k']}']") == 1)
    revealed = c['k']
    pg.click('#flash-next')
    # Clear the rest of the deck, right every time.
    for _ in range(40):
        if not pg.evaluate(CARD) or not pg.is_visible('#flash-screen'): break
        answer_card(pg, right=True)
        pg.click('#flash-next')
    ok('clearing the deck shows the results', pg.is_visible('#flash-results'))
    res = pg.inner_text('#flash-summary')
    ok('results name the cards to practise again', '3 × 4' in res and revealed.replace('x', ' × ') in res, res.replace('\n', ' ')[:160])
    ok('  10 cards tried, 8 right first time', '10\nCards tried' in res and '8\nRight first time' in res, res.replace('\n', ' ')[:120])

    print('\n== the medal record is untouched; "weakest" learns ==')
    facts = pg.evaluate("window.mathletics.studentData.mastery_progress.facts")
    ok('3 × 4 timed record unchanged', facts['3x4']['r'] == [1, -1], str(facts['3x4']))
    ok('4 × 5 still has no timed record', '4x5' not in facts)
    cards = pg.evaluate("window.mathletics.studentData.mastery_progress.cards")
    ok('the card record holds the first try only', cards['3x4']['r'] == [-1], str(cards.get('3x4')))
    ok('  a right card is recorded right', cards['4x5']['r'] == [1], str(cards.get('4x5')))
    w = pg.evaluate("[window.mathletics.factWeakness('4x5'), window.mathletics.factWeakness('3x4')]")
    ok('a card got right makes that fact less weak than an untried one', w[0] < pg.evaluate("window.mathletics.factWeakness('9x9')"), str(w))
    ok('a card missed keeps the fact weakest', w[1] > w[0], str(w))

    print('\n== pick anything ==')
    pg.click('#flash-results button:has-text("More flashcards")')
    pg.select_option('#flash-size', '10')
    pg.click('#flash-grid [data-row="7"] >> nth=0')
    ok('a times-table number picks its whole table (beyond the range)', pg.evaluate("window.mathletics.flashPicks.size") == 11)
    pg.click('#flash-grid [data-k="7x7"]')
    ok('a square toggles one fact off', pg.evaluate("window.mathletics.flashPicks.size") == 10)
    pg.click('#flash-grid [data-k="2x3"] >> nth=0')
    ok('  and another on', pg.evaluate("window.mathletics.flashPicks.has('2x3')"))
    ok('the start button says how many', 'Start 11 picked cards' in pg.inner_text('#flash-start-picked'))
    pg.click('#flash-start-picked')
    keys = pg.evaluate("window.mathletics.flash.deck.map(c => c.k)")
    ok('the deck is exactly the picks', sorted(keys) == sorted(['0x7','1x7','2x7','3x7','4x7','5x7','6x7','7x8','7x9','7x10','2x3']), str(sorted(keys)))
    pg.click('button:has-text("Finish")')
    ok('Finish part-way shows results with what is left', 'Not finished' in pg.inner_text('#flash-summary'))
    pg.click('#flash-results button:has-text("More flashcards")')
    pg.click('#flash-grid [data-all="1"]')
    ok('× picks every fact shown (0-10: 66)', pg.evaluate("window.mathletics.flashPicks.size") == 66)
    pg.click('#flash-grid [data-all="1"]')
    ok('  and again unpicks them', pg.evaluate("window.mathletics.flashPicks.size") == 0)
    ok('nothing picked: start is disabled', pg.is_disabled('#flash-start-picked'))
    pg.screenshot(path=os.path.join(OUT, 'mathletics-flash-setup.png'), full_page=True)

    print('\n== on a phone ==')
    ph = b.new_page(viewport={'width': 390, 'height': 800})
    ph.on('pageerror', lambda e: errs.append(str(e)))
    ph.goto(URL)
    ph.wait_for_function("window.mathletics && window.mathletics.studentData", timeout=30000)
    ph.evaluate(SEED)
    ph.evaluate("window.mathletics.showFlashcards()")
    ph.select_option('#flash-size', '20')
    sw = ph.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    ok('the picker at 20 x 20 does not scroll the page sideways', sw[0] <= sw[1], str(sw))
    ph.screenshot(path=os.path.join(OUT, 'mathletics-flash-phone.png'), full_page=True)
    ph.evaluate("window.mathletics.startFlashWeakest()")
    sw = ph.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    ok('the card screen fits too', sw[0] <= sw[1], str(sw))
    ph.screenshot(path=os.path.join(OUT, 'mathletics-flash-card-phone.png'))

    ok('no page errors', not errs, '; '.join(errs[:3]))
    b.close()

print(f"\n{'ALL OK' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
