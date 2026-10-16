// Fright Space, as a student meets it in the games panel: the game page inside the portal's iframe
// (debug-tools/fright-space-host.html: the same sandbox and permissions as index.html), in headless
// Chrome with WebGPU at its default limits. Walks the journey: the menu draws, a click on Play loads
// level 1, holding D moves the player - and fails on any page error or WebGPU validation error.
//
//   python -m http.server 8780 &            (from the repo root; 8765 is someone else's port here)
//   node debug-tools/fright-space-journey.mjs [--port 8780] [--cdp 9370] [--shot out.png]
//
// The game itself lives in games/fright-space/ (built from the fright-space repo; see HANDOFF.md).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const port = +opt("--port", 8780), cdpPort = +opt("--cdp", 9370), shot = opt("--shot", "");
// --direct: the game page on its own, no iframe (to tell the iframe from the game when something differs)
const direct = argv.includes("--direct");
// --origin https://rivertech.me: the live site instead of a local server
const origin = opt("--origin", "");
const chrome = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "fs-journey-"));
const proc = spawn(chrome, ["--headless=new", "--enable-unsafe-webgpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1280,800", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
  // JOURNEY_FLAGS: more Chrome switches, e.g. "--use-webgpu-adapter=swiftshader" for another GPU backend
  ...(process.env.JOURNEY_FLAGS || "").split(" ").filter(Boolean), "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 60 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(); } catch { await sleep(500); } }
if (!version) { console.log("FAIL chrome did not come up"); proc.kill(); process.exit(2); }
const pageT = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map(), lines = [], errors = [], tickAt = [];   // tickAt: [wall ms, game tick] from the log
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === "Runtime.consoleAPICalled") {
    const l = d.params.args.map((a) => a.value ?? a.description).join(" ");
    lines.push(l);
    const m = / fs t(\d+) c=/.exec(l);
    if (m) tickAt.push([Date.now(), +m[1]]);
  }
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
// the game's own window: the iframe's, reached through the host (same origin)
const inGame = async (expr) => (await send("Runtime.evaluate", { expression: `(() => { const w = ${direct ? "window" : "document.getElementById(\"game-iframe\").contentWindow"}; return ${expr}; })()`, returnByValue: true, awaitPromise: true })).result?.result?.value;
const results = [];
const screenshot = async () => (await send("Page.captureScreenshot", { format: "png" })).result.data;
const check = (ok, what) => { results.push([ok, what]); console.log(`${ok ? "ok  " : "FAIL"} ${what}`); };
const done = async (code) => { try { ws.send(JSON.stringify({ id: ++id, method: "Browser.close" })); } catch {} await sleep(800); process.exit(code); };

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: (origin || `http://127.0.0.1:${port}`) + (direct ? "/games/fright-space/web/fright-space.html?set=FS_DEBUG=1" : "/debug-tools/fright-space-host.html?set=FS_DEBUG=1") });
// the menu: the first frame drawn
let ready = false;
for (let i = 0; i < 120 && !ready; i++) { await sleep(500); ready = await inGame("!!(w.dr && w.dr.ready)"); }
check(ready, "the game's first frame drew inside the portal's iframe");
await sleep(500);
const menuShot = await screenshot();
if (!ready) { console.log(lines.slice(-10).join("\n")); await done(1); }
check((await inGame("w.dr.wgpuErrors ? w.dr.wgpuErrors() : 0")) === 0, "no WebGPU validation errors on the menu");
// a click where the game draws something, in its 1280 x 720 canvas units
const clickCanvas = async (cx, cy) => {
  const at = await inGame(`(() => { const f = ${direct ? "{ left: 0, top: 0 }" : "document.getElementById(\"game-iframe\").getBoundingClientRect()"}; const c = w.document.getElementById("view").getBoundingClientRect();
    return { x: f.left + c.left + c.width * ${cx} / 1280, y: f.top + c.top + c.height * ${cy} / 720 }; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
};
const menuLoads = () => lines.filter((l) => /loaded games\/fright-space\/worlds\/menu\.ron/.test(l)).length;
// Instructions (its button's centre 640, 600) and back with Main Menu - which Unity's layout put
// past the right edge (1330), and the game now draws (and takes clicks) inside it, centre 1109, 673
const m0 = menuLoads();
await clickCanvas(640, 600);
for (let i = 0; i < 40 && menuLoads() <= m0; i++) await sleep(250);
await sleep(1000);
const instrShot = await screenshot();
if (shot) writeFileSync(shot.replace(/\.png$/, "-instructions.png"), Buffer.from(instrShot, "base64"));
check(menuLoads() > m0 && instrShot !== menuShot, "Instructions opened");
const m1 = menuLoads();
await clickCanvas(1109, 673);
for (let i = 0; i < 40 && menuLoads() <= m1; i++) await sleep(250);
await sleep(1000);
check(menuLoads() > m1, "Main Menu, inside the screen now, went back to the menu");
// a click on Play, where the menu draws it (the button's centre 640, 327)
await clickCanvas(640, 327);
let loaded = false;
for (let i = 0; i < 120 && !loaded; i++) { await sleep(500); loaded = lines.some((l) => /loaded games\/fright-space\/worlds\/level1\.ron/.test(l)); }
check(loaded, "Play loaded level 1");
// walking: D held for a second and a half. Keys go to the frame with focus; a student's click on the
// game gives it that, a synthetic one may not, so the frame is focused as the click leaves it
// the first frames after a world loads compile its shaders: wait until the game is ticking there
const ticks = () => lines.filter((l) => / fs t\d+ c=/.test(l)).length;
for (let i = 0; i < 60 && ticks() < 2; i++) await sleep(250);
await inGame(`(w.focus(), w.document.getElementById("view").focus(), true)`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 });
const before = ticks();
for (let i = 0; i < 60 && ticks() < before + 2; i++) await sleep(250);
const walkShot1 = await screenshot();
for (let i = 0; i < 60 && ticks() < before + 4; i++) await sleep(250);
const walkShot2 = await screenshot();
// the screen itself, not the log: level 1 on it (not the menu's last picture) and moving. A level
// once loaded without its canvas: the game played on and the screen kept the menu
check(walkShot1 !== menuShot && walkShot2 !== menuShot && walkShot1 !== walkShot2, "the screen shows level 1 and changes as the player walks");
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 });
check((await inGame("w.dr.wgpuErrors ? w.dr.wgpuErrors() : 0")) === 0, "no WebGPU validation errors in level 1");
// the game's own log (FS_DEBUG): where the player is - it starts at x 4.63 and D walks it toward -x
const xs = lines.map((l) => /fs t\d+ c=\(([-\d.]+),/.exec(l)).filter(Boolean).map((m) => +m[1]);
check(xs.length > 1 && xs[xs.length - 1] < xs[0] - 1, `D walked the player (x ${xs[0]} -> ${xs[xs.length - 1]})`);
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
// the frame rate once level 1 is running (the viewer keeps the last frames' intervals)
await sleep(4000);
const raf = (await inGame("(w.dr.rafTimes || []).slice(-120)")) || [];
const med = raf.slice().sort((a, b) => a - b)[raf.length >> 1];
const audio = await inGame("w.dr.audio ? w.dr.audio.blocks : -1");
// the game's tick and the frames drawn, two seconds apart, from the page itself
const probe = async () => inGame("({ g: w.dr.game(), f: w.dr.viewer.frames(), t: w.performance.now() })");
const p0 = await probe(); await sleep(2000); const p1 = await probe();
// a page whose engine has stopped (a panic leaves the viewer unusable) answers nothing: say so, with
// the log, rather than die on the probe
if (!p0 || !p1) {
  console.log("FAIL the page stopped answering (the engine panicked?)");
  for (const l of lines) console.log("       " + l.slice(0, 400));
  await done(1);
}
console.log(`     probe: ${(p1.f - p0.f) / ((p1.t - p0.t) / 1000)} frames/s; game ${JSON.stringify(p0.g).slice(0, 120)} -> ${JSON.stringify(p1.g).slice(0, 120)}`);
// the game's clock against the wall's: 60 ticks a second whatever the screen's rate (a 120 Hz
// MacBook ran it at twice the speed when the engine ticked once a frame)
const [a, b] = [tickAt[Math.max(0, tickAt.length - 12)], tickAt[tickAt.length - 1]];
const tps = a && b && b[0] > a[0] ? (b[1] - a[1]) / ((b[0] - a[0]) / 1000) : 0;
check(tps > 50 && tps < 70, `the game ran at ${tps.toFixed(0)} ticks a second (60 is real time)`);
console.log(`     level 1: median ${med ? med.toFixed(1) : "?"} ms between frames (${med ? (1000 / med).toFixed(0) : "?"} fps) over ${raf.length} frames; sound blocks played: ${audio}`);
// a restart (R, once the ghost has caught the idle player): level 1 again, with Bolchie's sheet
// registered again - it once was not, and the restarted level had no player on screen
const loads = () => lines.filter((l) => /loaded games\/fright-space\/worlds\/level1\.ron/.test(l)).length;
const sheets = () => lines.filter((l) => /sheet "bolchie"/.test(l)).length;
await inGame(`(w.focus(), w.document.getElementById("view").focus(), true)`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "r", code: "KeyR", windowsVirtualKeyCode: 82 });
await sleep(200);
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "r", code: "KeyR", windowsVirtualKeyCode: 82 });
for (let i = 0; i < 80 && loads() < 2; i++) await sleep(250);
await sleep(1000);
check(loads() >= 2 && sheets() >= 2, `R restarted level 1 with the player's sprite (${loads()} loads, ${sheets()} sprite sheets)`);
if (shot) {
  const s = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shot, Buffer.from(s.result.data, "base64"));
  console.log(`     screenshot: ${shot}`);
}
const failed = results.filter(([ok]) => !ok).length;
// JOURNEY_LOG=1: the page's whole log
if (process.env.JOURNEY_LOG) for (const l of lines) console.log("       " + l.slice(0, 220));
else if (failed) {
  console.log("     the page's last lines:");
  for (const l of lines.slice(-15)) console.log("       " + l.slice(0, 220));
}
console.log(failed ? `FAIL (${failed})` : "PASS");
await done(failed ? 1 : 0);
