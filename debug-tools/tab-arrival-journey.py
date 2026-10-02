#!/usr/bin/env python3
# Moving between the student site and the portal lands on the tab you chose.
#
# Reported 2026-10-02: tapping a tab that lives on the other site "sometimes
# just defaults you to the main tab of that site". Two causes:
#   * the student site opened Home as soon as it saw a signed-in user, which set
#     the hash to #dashboard, and only THEN read the hash - so #games / #skills
#     from the portal's nav always became Home;
#   * the portal kept two copies of the sections a #hash may open, and Staff
#     Duties was in neither, so it landed on Home.
# Both sites now capture the hash on arrival and route from that.
#
# Offline there is no real session, so this drives each site's own sign-in
# handling with an invented student/teacher, from a fresh page per arrival.
#
# Run:  python -m http.server 8789 &   (repo root)
#       python debug-tools/tab-arrival-journey.py
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SITE_URL', 'http://localhost:8789')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

STUDENT = {'id': 'u-ivy', 'first_name': 'Ivy', 'last_name': 'Zz', 'user_type': 'student', 'account_status': 'activated'}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)

    # ---- student site: arriving on #games / #skills / #dashboard ----
    for tab, want_section in [('games', 'games-section'), ('skills', 'skills-section'), ('dashboard', 'dashboard-section'), ('grades', 'dashboard-section')]:
        pg = b.new_page()
        pg.goto(f'{BASE}/index.html#{tab}')
        pg.wait_for_function("window.portal && typeof window.portal.showAuthenticatedState === 'function' && window.portal.initialized", timeout=30000)
        # The arrival as init captured it, then the sign-in the real auth would fire.
        pg.evaluate("""(prof) => {
          const a = window.portalAuth;
          a.currentUser = { id: prof.id, email: 'ivy@example.invalid' };
          a.userProfile = prof;
          a.getUserInfo = () => ({ isAuthenticated: true, hasProfile: true, user: a.currentUser, profile: prof });
          a.isAuthenticated = () => true;
          window.portal.showAuthenticatedState();
          window.portal.handleHashNavigation();
        }""", STUDENT)
        pg.wait_for_timeout(600)
        shown = pg.evaluate("[...document.querySelectorAll('[id$=\"-section\"]')].filter(s => !s.classList.contains('hidden') && s.offsetParent !== null).map(s => s.id)")
        ok(f'student site #{tab} opens {want_section}', want_section in shown, ', '.join(shown))
        pg.close()

    # ---- portal: arriving on a tab, including Staff Duties ----
    pg = b.new_page()
    pg.goto(f'{BASE}/portal/index.html#messaging')
    pg.wait_for_function("window.app && typeof app._routableSections === 'function'", timeout=30000)
    r = pg.evaluate("""() => ({
      list: app._routableSections(),
      arrival: app._arrivalHash,
    })""")
    for s in ['home', 'classes', 'messaging', 'profile', 'documents', 'testing-center', 'activities',
              'my-students', 'admin-dashboard', 'admin-rtc-management', 'staff-duties']:
        ok(f'portal can open #{s} on arrival', s in r['list'])
    ok('the portal captured the tab it was opened on', r['arrival'] == '#messaging', r['arrival'])
    # The routing reads the captured hash even if something rewrote the URL since.
    pg.evaluate("history.replaceState(null, null, location.pathname)")
    called = pg.evaluate("""() => { const seen = []; const real = app.showSection.bind(app);
      app.showSection = (s) => seen.push(s);
      const hash = (app._arrivalHash || window.location.hash).substring(1);
      if (hash && app._routableSections().includes(hash)) app.showSection(hash);
      app.showSection = real; return seen; }""")
    ok('a URL rewritten during start-up still opens the tab chosen', called == ['messaging'], str(called))
    src = open(os.path.join(os.path.dirname(__file__), '..', 'portal', 'index.html'), encoding='utf-8').read()
    ok('init routes from the captured hash', 'const hash = (this._arrivalHash || window.location.hash).substring(1);' in src)
    ok('one list, used in both places', src.count('const validSections = this._routableSections();') == 2 and 'const validSections = [' not in src)
    b.close()
print('FAILS:', fails); sys.exit(1 if fails else 0)
