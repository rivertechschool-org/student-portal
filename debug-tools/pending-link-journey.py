#!/usr/bin/env python3
# A portal link survives the sign-in it needs.
#
# Links from the student site and the reminders (/portal/?go=...) open one
# thing. Signed out, the portal sends the person to log in on the student site,
# which used to forget the link: they signed in and stayed on the student site.
# Now the portal remembers it (shared/config.js rtPendingLink) and the student
# site goes back to it after a fresh sign-in. This walks both halves in Chrome
# with an invented student, offline (no real session exists, so the portal
# always shows "please log in" - which is the case under test).
#
# Run:  python -m http.server 8788 &   (repo root)
#       python debug-tools/pending-link-journey.py
import os, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SITE_URL', 'http://localhost:8788')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    ctx = b.new_context()
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))

    # 1. Signed out, a link to one homework: the portal asks to log in and keeps the link.
    pg.goto(f'{BASE}/portal/index.html?go=homework&id=abc12345-0000-4000-8000-00000000beef&junk=<script>')
    pg.wait_for_selector('#auth-required:not(.hidden)', timeout=30000)
    kept = pg.evaluate("JSON.parse(localStorage.getItem('rt-pending-portal-link') || 'null')")
    ok('signed out: the portal shows "please log in"', True)
    ok('  and remembers just the link fields', kept and kept['search'] == '?go=homework&id=abc12345-0000-4000-8000-00000000beef', str(kept))

    # 2. The student signs in on the student site: it goes back to the link.
    pg.goto(f'{BASE}/index.html')
    pg.wait_for_function("window.portal && typeof window.portal.handleAuthStateChange === 'function'", timeout=30000)
    pg.wait_for_timeout(500)
    with pg.expect_navigation(timeout=15000):
        pg.evaluate("window.portal.handleAuthStateChange({ event: 'SIGNED_IN', user: { id: 'u-ivy' }, profile: { id: 'u-ivy', user_type: 'student', first_name: 'Ivy' } })")
    ok('after signing in the student is sent back to the link', '/portal/' in pg.url and 'go=homework' in pg.url and 'junk' not in pg.url, pg.url)
    ok('  and the link is used up', pg.evaluate("localStorage.getItem('rt-pending-portal-link')") is None)

    # 3. A teacher signing in is not redirected (the links are student links).
    pg.evaluate("window.rtPendingLink.remember('?go=grades&class=c0ffee00-1111')")
    pg.goto(f'{BASE}/index.html')
    pg.wait_for_function("window.portal && typeof window.portal.handleAuthStateChange === 'function'", timeout=30000)
    pg.evaluate("window.rtPendingLink.remember('?go=grades&class=c0ffee00-1111')")
    pg.evaluate("window.portal.handleAuthStateChange({ event: 'SIGNED_IN', user: { id: 'u-t' }, profile: { id: 'u-t', user_type: 'teacher', first_name: 'Tom' } })")
    pg.wait_for_timeout(800)
    ok('a teacher signing in stays where they are', pg.url.endswith('/index.html'), pg.url)

    # 4. Old links expire; junk is never kept.
    res = pg.evaluate("""() => {
      const r = window.rtPendingLink;
      localStorage.setItem(r.KEY, JSON.stringify({ search: '?go=homework&id=abc12345', at: Date.now() - 31 * 60 * 1000 }));
      const expired = r.take();
      r.remember('?go=evil&id=abc'); const badGo = localStorage.getItem(r.KEY);
      r.remember('?go=assignment&id=../../x&class=c1'); const cleaned = r.take();
      return { expired, badGo, cleaned };
    }""")
    ok('a link older than 30 minutes is ignored', res['expired'] == '')
    ok('an unknown destination is never kept', res['badGo'] is None)
    ok('odd characters in an id are dropped', res['cleaned'] == '?go=assignment&class=c1', res['cleaned'])

    ok('no page errors from the link code', not [e for e in errs if 'PendingLink' in e or 'pending' in e.lower()], '; '.join(errs[:2]))
    b.close()
print('FAILS:', fails); sys.exit(1 if fails else 0)
