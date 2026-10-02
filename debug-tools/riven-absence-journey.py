#!/usr/bin/env python3
# Riven, putting a student down as away - typed into the real panel.
#
# debug-tools/absence-command-matrix.js holds the routing and date reading to
# 1,600+ phrasings in Node. This walks the last step a teacher sees: the
# confirmation Riven shows, with the dates it is about to save, for the exact
# sentences reported on 2026-10-01 ("set X missing 5-8", "...the 5th-8th",
# "...the 5th through the 8th") and a few more.
#
# Boots the same stubbed portal as riven-practice-journey.py (its BOOT_JS is
# read from that file, so the two cannot drift) with invented students only.
#
# Run:  python -m http.server 8783 &   (repo root)
#       python debug-tools/riven-absence-journey.py
import asyncio, os, re, sys, datetime
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('RIVEN_URL', 'http://localhost:8783/portal/index.html')
CHROME = os.environ.get('RIVEN_CHROME', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
BOOT_JS = re.search(r'BOOT_JS = r?"""(.*?)"""', open(os.path.join(HERE, 'riven-practice-journey.py'), encoding='utf-8').read(), re.S).group(1)

def next_day_of_month(day):
    """The first date on or after tomorrow that falls on this day of the month."""
    d = datetime.date.today()
    y, m = d.year, d.month
    if day < d.day or (day == d.day):
        m += 1
        if m == 13: y, m = y + 1, 1
    return datetime.date(y, m, day)

s5 = next_day_of_month(5)
e8 = s5.replace(day=8)
RANGE = f'{s5.isoformat()} to {e8.isoformat()}'

JOURNEY = [
    ('set Masterson missing 5-8', ['Put Masterson Stucky down as away', RANGE, '4 days']),
    ('Set Masterson missing the 5th-8th', ['Masterson Stucky', RANGE]),
    ('set masterson missing the 5th through the 8th', ['Masterson Stucky', RANGE]),
    ('mark masterson absent from the 5th to the 8th', ['Masterson Stucky', RANGE]),
    ('masterson will be out the 5th thru 8th for a family trip', ['Masterson Stucky', RANGE, 'family trip']),
    ('put masterson down as away 5-8', ['Masterson Stucky', RANGE]),
]

LAST_JS = """() => { const b = [...document.querySelectorAll('#terminal-output .riven-msg-riven')];
  return b.length ? b[b.length - 1].innerText.replace(/\\s+/g, ' ').trim() : ''; }"""

async def main():
    ok = bad = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
        page = await browser.new_page(viewport={'width': 1300, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_function('() => window.app && window.app.auth', timeout=20000)
        await page.evaluate(BOOT_JS)
        await page.wait_for_timeout(300)
        await page.click('#riven-launcher')
        await page.wait_for_timeout(300)
        for q, must in JOURNEY:
            before = await page.evaluate("() => document.querySelectorAll('#terminal-output .riven-msg-riven').length")
            await page.fill('#terminal-input', q)
            await page.press('#terminal-input', 'Enter')
            ans = ''
            for _ in range(40):
                await page.wait_for_timeout(100)
                n = await page.evaluate("() => document.querySelectorAll('#terminal-output .riven-msg-riven').length")
                if n > before:
                    await page.wait_for_timeout(200)
                    ans = await page.evaluate(LAST_JS)
                    break
            missing = [m for m in must if m not in ans]
            good = not missing
            ok += good; bad += (not good)
            print(f"  {'ok  ' if good else 'FAIL'} {q!r}\n        -> {ans[:220]}" + (f"\n        missing: {missing}" if missing else ''))
            # Answer the confirmation with "no", so nothing is queued.
            await page.fill('#terminal-input', 'no')
            await page.press('#terminal-input', 'Enter')
            await page.wait_for_timeout(250)
        rel = [e for e in errors if 'riven' in e.lower() or 'absence' in e.lower()]
        if rel:
            bad += 1; print('  FAIL page errors:', rel[:3])
        await browser.close()
    print(f'\n{ok} pass, {bad} fail')
    sys.exit(1 if bad else 0)

asyncio.run(main())
