// Practice Pilot steering, as a tablet player and as a desktop player.
//
//   python3 -m http.server 8765 &
//   node debug-tools/pilot-touch-journeys.mjs
//
// Written after "on iPads the cursor is stuck and the ship only goes one way".
// Three causes, each replayed here on an emulated iPad:
//   - a new run drifted downwards before anyone touched the screen
//   - tapping a key on the on-screen keyboard dragged the cursor onto the
//     keyboard (the browser's emulated mouse events after a tap)
//   - holding a steering finger while the other hand typed froze steering
// plus the desktop mouse, so the fix for touch cannot quietly break it.
//
// Exits non-zero if any check fails.

let chromium, devices;
{
  const CANDIDATES = [
    'playwright',
    'playwright-core',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/opt/node22/lib/node_modules/playwright-core/index.mjs',
  ];
  for (const spec of CANDIDATES) {
    try { ({ chromium, devices } = await import(spec)); break; } catch (_) { /* try the next */ }
  }
  if (!chromium) {
    console.error('pilot-touch-journeys needs Playwright.\n  npm i -g playwright && npx playwright install chromium');
    process.exit(2);
  }
}

const URL = process.env.PILOT_URL || 'http://localhost:8765/games/practice-pilot.html';
const browser = await chromium.launch({
  executablePath: process.env.PILOT_CHROME ||
    ((await import('fs')).existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
});

let failed = 0;
const check = (ok, what, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failed++;
};

// Open the game and start a math run straight from the practice menu.
async function openRun(contextOpts) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  PAGE ERROR', e.message); failed++; });
  await page.goto(URL);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.getElementById('add-check').checked = true;
    document.querySelectorAll('#add-options input').forEach(i => { i.checked = true; });
    document.getElementById('startMenu').style.display = 'none';
    startPracticeGame('math');
  });
  await page.waitForTimeout(200);
  const state = () => page.evaluate(() => ({
    mx: Math.round(game.mouse.x), my: Math.round(game.mouse.y),
    pressed: game.isPressed, answer: game.currentAnswer,
    px: game.player.x, py: game.player.y,
  }));
  return { ctx, page, state };
}

// ---- Tablet --------------------------------------------------------------
console.log('iPad, landscape');
{
  const { ctx, page, state } = await openRun({ ...devices['iPad (gen 7) landscape'] });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  // Computed here rather than via the page's helper, so the harness also runs
  // against older copies of the game and shows what they got wrong.
  const ship = await page.evaluate(() => ({ x: canvas.width / 2, y: canvas.height / 3 }));

  // 1. Nobody has touched anything: the ship should sit still.
  let s0 = await state();
  check(s0.mx === Math.round(ship.x) && s0.my === Math.round(ship.y), 'a new run parks the cursor on the ship', { s0, ship });
  await page.waitForTimeout(400);
  let s1 = await state();
  check(Math.hypot(s1.px - s0.px, s1.py - s0.py) < 1, 'and the ship does not drift before a touch', { s0, s1 });

  // 2. Tap a key: the answer gets the digit, the cursor stays put.
  const key = await page.locator('#mobileKeyboard button', { hasText: '7' }).boundingBox();
  await page.touchscreen.tap(key.x + key.width / 2, key.y + key.height / 2);
  await page.waitForTimeout(150);
  let s2 = await state();
  check(s2.answer === '7', 'tapping the 7 key types 7', s2);
  check(s2.mx === s0.mx && s2.my === s0.my, 'and does not drag the cursor onto the keyboard', { before: s0, after: s2 });

  // 3. Drag with one finger: the cursor follows and the ship boosts.
  await touch('touchStart', [{ x: 200, y: 200, id: 1 }]);
  await touch('touchMove', [{ x: 260, y: 220, id: 1 }]);
  let s3 = await state();
  check(s3.mx === 260 && s3.my === 220 && s3.pressed, 'a dragged finger steers and boosts', s3);

  // 4. Keep that finger down, type with the other hand, then keep steering.
  const k5 = await page.locator('#mobileKeyboard button', { hasText: '5' }).boundingBox();
  const A = { x: 260, y: 220, id: 1 }, B = { x: k5.x + k5.width / 2, y: k5.y + k5.height / 2, id: 2 };
  await touch('touchStart', [A, B]);
  // CDP touchEnd releases every finger; leaving B out of a move lifts only B.
  await touch('touchMove', [A]);
  let s4 = await state();
  check(s4.pressed && s4.mx === 260 && s4.my === 220, 'a second finger on the keyboard leaves steering alone', s4);
  await touch('touchMove', [{ x: 900, y: 600, id: 1 }]);
  let s5 = await state();
  check(s5.mx === 900 && s5.my === 600 && s5.pressed, 'the held finger still steers after the other hand typed', s5);

  // 5. Lift the steering finger: boost stops, cursor stays where it was.
  await touch('touchEnd', []);
  let s6 = await state();
  check(!s6.pressed && s6.mx === 900 && s6.my === 600, 'lifting the finger ends the boost', s6);

  // 6. A cancelled touch (system gesture, alert) must not leave it boosting.
  await touch('touchStart', [{ x: 300, y: 300, id: 3 }]);
  await touch('touchCancel', []);
  let s7 = await state();
  check(!s7.pressed, 'a cancelled touch ends the boost', s7);

  // 7. Steering actually moves the ship in the dragged direction.
  const before = await state();
  await touch('touchStart', [{ x: ship.x + 300, y: ship.y, id: 4 }]);
  await page.waitForTimeout(400);
  await touch('touchMove', [{ x: ship.x, y: ship.y + 300, id: 4 }]);
  const mid = await state();
  await page.waitForTimeout(400);
  const after = await state();
  await touch('touchEnd', []);
  check(mid.px - before.px > 5, 'dragging right flies right', { before, mid });
  check(after.py - mid.py > 5, 'then dragging down flies down', { mid, after });

  await ctx.close();
}

// ---- Desktop -------------------------------------------------------------
console.log('Desktop, mouse');
{
  const { ctx, page, state } = await openRun({ viewport: { width: 1280, height: 800 } });
  await page.mouse.move(900, 300);
  let s1 = await state();
  check(s1.mx === 900 && s1.my === 300 && !s1.pressed, 'the mouse moves the cursor', s1);
  await page.mouse.down();
  let s2 = await state();
  check(s2.pressed, 'holding the button boosts', s2);
  await page.mouse.up();
  let s3 = await state();
  check(!s3.pressed, 'releasing it stops the boost', s3);
  await page.keyboard.press('4');
  let s4 = await state();
  check(s4.answer === '4', 'typing still answers', s4);
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
