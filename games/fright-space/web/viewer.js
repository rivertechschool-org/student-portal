// The web viewer's loader (roadmap E3, docs/PLATFORMS.md).
//
//   /web/?world=solids[&w=960&h=540&frames=9&stop=N&set=KNOB=VALUE,...&limits=defaults]
//
// Fetches web/manifests/<world>.json (tools/web/pack.py), every file it lists, hands them to the
// runtime's in-memory file system, sets the knobs, builds the world on a WebGPU device on the
// canvas, and renders a frame per animation frame. `stop=N` renders frames 0..N-1 and holds the
// last one (what a comparison with `densarender world N W H` wants). Drag to orbit, wheel to zoom.
//
// `limits=defaults` opens the device with exactly WebGPU's default limits (DENSA_GPU_WEB=defaults),
// what the lite tier (WORLD_TIER=lite) is made to fit.
//
// window.dr is left for automation: dr.viewer, dr.time(n), dr.capture(), dr.psnr(url), dr.save(name),
// dr.wgpuErrors() (validation errors raised), dr.heapMB(), dr.timing, dr.fetched, dr.vr (WebXR, V4).
//
// Where the browser offers immersive-vr, an "Enter VR" button runs the world in a headset (V4; see
// the WebXR section below and docs/PLATFORMS.md, VR).
import init, * as wasm from "./pkg/densarender.js?v=9e8612667a89";

const q = new URLSearchParams(location.search);
const world = q.get("world") || "solids";
const W = +(q.get("w") || 960), H = +(q.get("h") || 540), FRAMES = +(q.get("frames") || 9);
const STOP = q.has("stop") ? +q.get("stop") : Infinity;
const statusEl = document.getElementById("status");
const say = (s, err) => { statusEl.textContent = s; statusEl.className = err ? "err" : ""; console.log("[viewer] " + s); };

// a panic's stack whole: the default ten frames stop inside the standard library
Error.stackTraceLimit = 64;
const dr = (window.dr = { ready: false, error: null, log: [] });

// A compressed sound (anything the browser decodes) as a 16-bit PCM WAV, at its own rate and channels.
async function audioToWav(bytes) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const ch = buf.numberOfChannels, n = buf.length, rate = buf.sampleRate;
  const out = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(out.buffer);
  const tag = (o, t) => { for (let k = 0; k < 4; k++) out[o + k] = t.charCodeAt(k); };
  tag(0, "RIFF"); v.setUint32(4, 36 + n * ch * 2, true); tag(8, "WAVE"); tag(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true); o += 2; }
  return out;
}

async function main() {
  const t0 = performance.now();
  const exports = await init({ module_or_path: new URL("./pkg/densarender_bg.wasm?v=9e8612667a89", import.meta.url) });
  // the module's memory: everything the world holds on the CPU side, in one wasm32 heap (4 GiB at most)
  dr.heapMB = () => exports.memory.buffer.byteLength / 2 ** 20;
  if (!navigator.gpu) throw new Error("this browser has no WebGPU (navigator.gpu is undefined)");
  const man = await (await fetch(`manifests/${world}.json?v=9e8612667a89`)).json();
  const base = man.base || "../";
  // a streamed piece (`"lazy"`, R2.5) is fetched when the world first asks for it, not now
  const eager = man.files.map((e, i) => [e, i]).filter(([e]) => !e.lazy);
  const lazy = man.files.map((e, i) => [e, i]).filter(([e]) => e.lazy);
  const eagerBytes = eager.reduce((n, [e]) => n + e.size, 0);
  say(`${world}: fetching ${eager.length} files, ${(eagerBytes / 1e6).toFixed(1)} MB${lazy.length ? ` (and ${lazy.length} streamed pieces, ${((man.bytes - eagerBytes) / 1e6).toFixed(1)} MB, when they are wanted)` : ""}`);
  let done = 0, bytes = 0, next = 0;
  const one = async (e, i) => {
    // `"decode": "audio"` (a game's music as OGG/MP3): fetched from `url`, decoded by the browser and
    // handed in as the 16-bit WAV at `path` that the engine reads (it reads WAV only) - a tenth of the bytes
    // a dropped connection (school Wi-Fi) is tried again, three times, before the load gives up
    let b;
    for (let tries = 0; ; tries++) {
      try {
        const r = await fetch(base + (e.url || e.path) + "?v=9e8612667a89");
        if (!r.ok) throw new Error(`${e.url || e.path}: HTTP ${r.status}`);
        b = new Uint8Array(await r.arrayBuffer());
        break;
      } catch (err) {
        if (tries >= 3) throw err;
        await new Promise((res) => setTimeout(res, 500 * 2 ** tries));
      }
    }
    if (e.decode === "audio") b = await audioToWav(b);
    wasm.vfs_insert(e.path, b, e.mtime_s, e.mtime_ns, i);
    done++; bytes += b.length;
    if (done % 8 === 0 || done === eager.length) say(`${world}: fetched ${done}/${eager.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
  };
  const worker = async () => { while (next < eager.length) { const [e, i] = eager[next++]; await one(e, i); } };
  await Promise.all(Array.from({ length: 8 }, worker));
  const tFetch = performance.now();
  for (const [k, v] of Object.entries(man.knobs)) wasm.set_knob(k, v);
  for (const kv of (q.get("set") || "").split(",").filter(Boolean)) { const i = kv.indexOf("="); wasm.set_knob(kv.slice(0, i), kv.slice(i + 1)); }
  if (q.get("limits") === "defaults") wasm.set_knob("DENSA_GPU_WEB", "defaults");
  dr.wgpuErrors = () => wasm.wgpu_errors();
  dr.fetched = { files: done, bytes };
  // the streamed pieces as the world asks for them: matched to the manifest by path, or for a cache
  // file by its name with the hashes taken out (as `vfs::pattern` matches a cache read), fetched
  // and handed over; the world passes a piece over until its file is here
  const pattern = (p) => p.replace(/[0-9a-fA-F]{8,}/g, "#");
  const lazyBy = new Map(lazy.map(([e, i]) => [e.path, [e, i]]));
  dr.streamed = { files: 0, bytes: 0, asked: 0, gone: 0, log: [] };
  const fetchLazy = async (want) => {
    let hit = lazyBy.get(want);
    if (!hit && want.startsWith("cache/")) {
      const pw = pattern(want);
      for (const [p, v] of lazyBy) if (p.startsWith("cache/") && pattern(p) === pw) { hit = v; break; }
    }
    if (!hit) { wasm.vfs_gone(want); dr.streamed.gone++; say(`${world}: the world asked for ${want}, which the manifest has not`, true); return; }
    lazyBy.delete(hit[0].path);
    const t = performance.now();
    try {
      const r = await fetch(base + hit[0].path);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = new Uint8Array(await r.arrayBuffer());
      wasm.vfs_insert(hit[0].path, b, hit[0].mtime_s, hit[0].mtime_ns, hit[1]);
      dr.streamed.files++; dr.streamed.bytes += b.length;
      dr.streamed.log.push([hit[0].path, b.length, Math.round(performance.now() - t)]);
    } catch (e) { wasm.vfs_gone(want); dr.streamed.gone++; say(`${world}: ${hit[0].path}: ${e}`, true); }
  };
  const pumpFetch = () => { for (const w of wasm.vfs_wanted()) { dr.streamed.asked++; fetchLazy(w); } };
  say(`${world}: building the world (fetch ${((tFetch - t0) / 1000).toFixed(1)} s)...`);
  await new Promise((r) => setTimeout(r, 0));
  // a game built as a crate of its own (docs/GAME_HOOKS.md) registers its games before the world opens
  if (typeof wasm.register_games === "function") { wasm.register_games(); say(`${world}: its own games registered`); }
  const viewer = await wasm.open("view", W, H, FRAMES);
  const tBuilt = performance.now();
  dr.viewer = viewer;
  // a game module's run (WORLD_BRAIN=game:<name>): its tick, its trace, the trace at every 600th tick
  dr.game = () => viewer.game_state();
  dr.misses = wasm.vfs_misses();
  dr.substituted = wasm.vfs_substituted();
  dr.timing = { fetch_s: (tFetch - t0) / 1000, build_s: (tBuilt - tFetch) / 1000, first_load_s: tBuilt / 1000 };   // from the navigation: the page, the module, the files and the build

  // --- automation ---
  // n frames, each waited for on the GPU: the time a whole frame takes, CPU then GPU
  // An async call into the viewer (a capture, waiting for the GPU) holds it until it settles; a
  // frame drawn meanwhile would be a second use of it, which Rust refuses ("recursive use of an
  // object"). So the loop waits while one is pending.
  let pending = 0;
  const held = async (p) => { pending++; try { return await p; } finally { pending--; } };
  dr.time = async (n = 30) => {
    const ts = [];
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      viewer.frame();
      await held(viewer.done());
      ts.push(performance.now() - a);
    }
    ts.sort((a, b) => a - b);
    const mean = ts.reduce((a, b) => a + b, 0) / n;
    return { n, mean_ms: mean, median_ms: ts[n >> 1], min_ms: ts[0], max_ms: ts[n - 1] };
  };
  dr.capture = async () => held(viewer.capture());
  // PSNR against a PNG at `url` over RGBA - the formula of `densarender psnr` (src/gate.rs)
  dr.psnr = async (url) => {
    const px = await viewer.capture();
    const img = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    if (img.width !== W || img.height !== H) return { error: `${url} is ${img.width}x${img.height}, the frame is ${W}x${H}` };
    const c = new OffscreenCanvas(W, H).getContext("2d", { colorSpace: "srgb" });
    c.drawImage(img, 0, 0);
    const ref = c.getImageData(0, 0, W, H).data;
    let se = 0;
    for (let i = 0; i < ref.length; i++) { const d = px[i] - ref[i]; se += d * d; }
    const mse = se / ref.length;
    return { db: mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse), mse };
  };
  // the last frame as a PNG in out/web/<name> (tools/web/serve.py), for `densarender psnr`
  dr.save = async (name) => {
    const px = await held(viewer.capture());
    const c = new OffscreenCanvas(W, H);
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.length), W, H), 0, 0);
    const blob = await c.convertToBlob({ type: "image/png" });
    const r = await fetch(`../out/${name}`, { method: "POST", body: blob });
    return await r.text();
  };

  // --- a game module's input (R0.9): keys as the desktop names them, clicks in canvas units, and
  // gamepads by the standard mapping, edge-detected each frame ---
  const keysDown = [], clicks = [];
  let typed = "";
  const keyName = (c) => c.startsWith("Digit") ? "Num" + c.slice(5) : c.startsWith("Numpad") && /\d$/.test(c) ? "Num" + c.slice(6)
    : c.startsWith("Key") ? c.slice(3) : c;
  // what is held, a state (B5): kept by key down and up, let go when the page loses the focus
  const keysHeld = new Set();
  addEventListener("keydown", (e) => {
    keysHeld.add(keyName(e.code));
    if (e.repeat) return;
    keysDown.push(keyName(e.code));
    if (e.key.length === 1) typed += e.key;
  });
  addEventListener("keyup", (e) => keysHeld.delete(keyName(e.code)));
  addEventListener("blur", () => keysHeld.clear());
  // a click, or a tap (R2.7): a touch let go within half a second, no more than 14 px from where it
  // touched - the same rule as the desktop's (gameui::is_tap) - lands where it lifted, in canvas units
  const TAP_SECS = 0.5, TAP_PX = 14;
  const toCanvas = (e) => { const r = document.getElementById("view").getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 1280, (e.clientY - r.top) / r.height * 720]; };
  const downs = new Map();
  const view = document.getElementById("view");
  view.style.touchAction = "none";   // the page must not scroll or zoom under a finger playing
  view.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") { if (e.button === 0) clicks.push(...toCanvas(e)); return; }
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  });
  view.addEventListener("pointerup", (e) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    if (!d || e.pointerType === "mouse") return;
    if ((performance.now() - d.t) / 1000 <= TAP_SECS && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_PX) clicks.push(...toCanvas(e));
  });
  view.addEventListener("pointercancel", (e) => downs.delete(e.pointerId));
  dr.taps = () => clicks.length / 2;
  const PAD = { 0: "South", 1: "East", 2: "West", 3: "North", 4: "LeftBumper", 5: "RightBumper", 6: "LeftTrigger", 7: "RightTrigger",
                8: "Select", 9: "Start", 12: "DPadUp", 13: "DPadDown", 14: "DPadLeft", 15: "DPadRight" };
  const padWas = {};
  const padPressed = () => {
    const out = [];
    for (const g of (navigator.getGamepads ? navigator.getGamepads() : [])) {
      if (!g) continue;
      g.buttons.forEach((b, i) => {
        const k = `${g.index}:${i}`;
        if (b.pressed && !padWas[k] && PAD[i]) out.push(PAD[i]);
        padWas[k] = b.pressed;
      });
    }
    return out;
  };
  // the pads held, the sticks and the triggers (B5), merged over every pad: the strongest push. The
  // standard mapping's y is down; the engine's is up, so the sticks' y are turned over.
  const padHold = () => {
    const held = new Set(), ax = { LeftX: 0, LeftY: 0, RightX: 0, RightY: 0, LeftTrigger: 0, RightTrigger: 0 };
    const push = (n, v) => { if (Math.abs(v) > Math.abs(ax[n])) ax[n] = v; };
    for (const g of (navigator.getGamepads ? navigator.getGamepads() : [])) {
      if (!g) continue;
      g.buttons.forEach((b, i) => { if (b.pressed && PAD[i]) held.add(PAD[i]); });
      if (g.buttons[10] && g.buttons[10].pressed) held.add("LeftStick");
      if (g.buttons[11] && g.buttons[11].pressed) held.add("RightStick");
      push("LeftX", g.axes[0] || 0); push("LeftY", -(g.axes[1] || 0)); push("RightX", g.axes[2] || 0); push("RightY", -(g.axes[3] || 0));
      push("LeftTrigger", g.buttons[6] ? g.buttons[6].value : 0); push("RightTrigger", g.buttons[7] ? g.buttons[7].value : 0);
    }
    const names = Object.keys(ax).filter((n) => Math.abs(ax[n]) > 1e-3);
    return [[...held], names, names.map((n) => ax[n])];
  };
  // a test may hold for the page as a person would (dr.hold(["W"], ["South"], {LeftX: 1})); null lets go
  let heldByTest = null;
  dr.hold = (keys = [], buttons = [], axes = {}) => { heldByTest = keys === null ? null : { keys, buttons, axes }; };
  // (a headset's controllers are not read here: in VR the page hands them to the engine with the
  // rest of the tracking, `set_tracking`, and vr.rs makes them the game's pad, as it does for OpenXR)
  const feed = () => {
    const buttons = padPressed();
    if (keysDown.length || typed || buttons.length || clicks.length) {
      viewer.game_input(keysDown.join("+"), typed, buttons.join("+"), new Float32Array(clicks));
      keysDown.length = 0; clicks.length = 0; typed = "";
    }
    let [held, names, vals] = padHold();
    let keys = [...keysHeld];
    if (heldByTest) {
      keys = keys.concat(heldByTest.keys); held = held.concat(heldByTest.buttons);
      for (const [n, v] of Object.entries(heldByTest.axes)) { const i = names.indexOf(n); if (i >= 0) vals[i] = v; else { names.push(n); vals.push(v); } }
    }
    viewer.game_hold(keys.join("+"), held.join("+"), names.join("+"), new Float32Array(vals));
  };
  dr.feed = feed;

  // --- sound (R2.6): the mix pulled from the engine a block at a time and scheduled as WebAudio
  // buffers a little ahead of the audio clock. A page may only start sound after the person has
  // touched it, so it starts at the first key, click or touch (or at once with ?audio=1, where the
  // browser allows it). dr.audio keeps what was played, for a check.
  const AHEAD = 0.12;
  let actx = null, nextT = 0;
  dr.audio = { scheduled_s: 0, blocks: 0, peak: 0, sumsq: 0, n: 0, peaks: [] };
  const startSound = () => {
    if (actx || q.get("mute")) return;
    try { actx = new AudioContext({ latencyHint: "interactive" }); } catch (e) { say(`no sound: ${e}`); return; }
    viewer.enable_audio(actx.sampleRate);
    actx.resume();
    nextT = actx.currentTime + 0.05;
    say(`sound at ${actx.sampleRate} Hz`);
  };
  if (q.get("audio") === "1") startSound();
  for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, startSound, { once: true });
  const pumpSound = () => {
    if (!actx) return;
    if (nextT < actx.currentTime) nextT = actx.currentTime + 0.02;
    while (nextT - actx.currentTime < AHEAD) {
      const s = viewer.audio_take(1024);
      const n = s.length >> 1;
      if (n === 0) break;
      const buf = actx.createBuffer(2, n, actx.sampleRate);
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      let pk = 0;
      for (let i = 0; i < n; i++) {
        l[i] = s[2 * i]; r[i] = s[2 * i + 1];
        const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
        if (a > pk) pk = a;
        dr.audio.sumsq += l[i] * l[i] + r[i] * r[i];
      }
      const src = actx.createBufferSource();
      src.buffer = buf;
      src.connect(actx.destination);
      src.start(nextT);
      nextT += n / actx.sampleRate;
      dr.audio.n += 2 * n; dr.audio.blocks++; dr.audio.scheduled_s += n / actx.sampleRate;
      dr.audio.peak = Math.max(dr.audio.peak, pk);
      dr.audio.peaks.push([viewer.frames(), pk]);
    }
    dr.audio.starved = viewer.audio_starved();
    dr.audio.rms = Math.sqrt(dr.audio.sumsq / Math.max(1, dr.audio.n));
  };

  // --- the loop ---
  const rafTimes = [];
  let last = performance.now(), running = true;
  dr.pause = () => { running = false; };
  dr.resume = () => { if (!running) { running = true; requestAnimationFrame(tick); } };
  dr.rafTimes = rafTimes;
  function tick(now) {
    if (!running) return;
    if (pending || dr.vr.active) { last = now; requestAnimationFrame(tick); return; }   // in VR the session's frames draw
    if (viewer.frames() < STOP) {
      feed();
      try { viewer.frame(); } catch (e) { dr.error = String(e); say(`frame ${viewer.frames()}: ${e}`, true); return; }
      pumpSound();
      pumpFetch();
      rafTimes.push(now - last); if (rafTimes.length > 240) rafTimes.shift();
      last = now;
      if (viewer.frames() % 30 === 0) {
        const s = rafTimes.slice(-60); const m = s.reduce((a, b) => a + b, 0) / s.length;
        say(`${world}: frame ${viewer.frames()}, ${m.toFixed(1)} ms between frames (${(1000 / m).toFixed(0)} fps); built in ${dr.timing.build_s.toFixed(1)} s after ${dr.timing.fetch_s.toFixed(1)} s of fetching`);
      }
    } else if (!dr.stopped) {
      dr.stopped = true;
      say(`${world}: stopped after ${viewer.frames()} frames (stop=${STOP}); built in ${dr.timing.build_s.toFixed(1)} s after ${dr.timing.fetch_s.toFixed(1)} s of fetching`);
    }
    requestAnimationFrame(tick);
  }

  // --- orbit: drag round the point the camera looks at (drag up to look down on it) ---
  const cv = document.getElementById("view");
  let orbit = null;
  const start = () => {
    const v = viewer.view();
    const eye = v.slice(0, 3), tgt = v.slice(3, 6);
    const d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
    const dist = Math.hypot(...d);
    orbit = { tgt, dist, yaw: Math.atan2(d[0], -d[2]), pitch: Math.asin(d[1] / dist) };
  };
  let drag = null;
  // two fingers pinch: the orbit's distance goes with the spread between them (R2.7)
  const fingers = new Map();
  let pinch = null;
  const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!orbit) start();
    if (fingers.size === 2) { pinch = { d: spread(), dist: orbit.dist }; drag = null; return; }
    drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId);
  });
  const lift = (e) => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
  cv.addEventListener("pointerup", lift);
  cv.addEventListener("pointercancel", lift);
  cv.addEventListener("pointermove", (e) => {
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && fingers.size === 2) {
      orbit.dist = Math.max(1, pinch.dist * pinch.d / Math.max(1, spread()));
      viewer.orbit(...orbit.tgt, orbit.yaw, orbit.pitch, orbit.dist);
      if (dr.stopped) viewer.frame();
      return;
    }
    if (!drag) return;
    orbit.yaw += (e.clientX - drag.x) * 0.005;
    orbit.pitch = Math.max(-1.4, Math.min(1.4, orbit.pitch + (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
    viewer.orbit(...orbit.tgt, orbit.yaw, orbit.pitch, orbit.dist);
    if (dr.stopped) viewer.frame();
  });
  cv.addEventListener("pointerup", () => { drag = null; });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault(); if (!orbit) start();
    orbit.dist = Math.max(1, orbit.dist * Math.exp(e.deltaY * 0.001));
    viewer.orbit(...orbit.tgt, orbit.yaw, orbit.pitch, orbit.dist);
    if (dr.stopped) viewer.frame();
  }, { passive: false });

  // --- WebXR (V4 to V9): the page in a headset. An "Enter VR" button when the browser offers
  // immersive-vr. In a session each XR frame hands the engine the whole frame's tracking
  // (`set_tracking`: both eyes, whether the space's 0 is the floor, both controllers' grip and aim
  // poses and buttons - the engine lays the space in the world and does the rest in vr.rs, as for
  // OpenXR), draws a stereo frame - the two eyes side by side on the
  // WebGPU canvas, 2W x H - and copies the canvas into the XR layer's framebuffer with WebGL: one
  // quad per eye viewport. The engine draws each eye through the centred frustum holding WebXR's
  // asymmetric one at the picture's shape (`Fov::centred_at`), and WebXR cannot be told to show
  // anything but its own, so each quad samples the part of its half that WebXR's frustum covers: in
  // tan-space (the same eye, the same direction) that is an affine map. Leaving VR is the mono page.
  // After the frame the buzzes the game asked for (`take_haptics`) pulse the controllers.
  // dr.vr is the state, for checks: active, frames, the space it got, the last crops, the GL objects,
  // the pulses sent.
  const vr = (dr.vr = { supported: false, active: false, frames: 0, space: null, error: null, crops: null, session: null, pulses: [] });
  vr.state = () => JSON.parse(viewer.vr_state());
  vr.captureEye = (i) => held(viewer.capture_eye(i));
  const vrButton = document.createElement("button");
  vrButton.id = "enter-vr";
  vrButton.textContent = "Enter VR";
  vrButton.style.cssText = "display:none;margin-top:8px;padding:6px 14px;font:inherit;background:#26303a;color:var(--fg);border:1px solid #3a4652;border-radius:4px;cursor:pointer";
  statusEl.after(vrButton);
  // a quad per eye, sampling the canvas texture through the eye's crop: uv in [0,1]^2 over the
  // viewport (v up) to the texture's (x, row-from-top), clamped half a texel inside the eye's half
  const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `#version 300 es
precision highp float;
uniform sampler2D tex; uniform vec4 crop; uniform vec2 clampx; in vec2 uv; out vec4 o;
void main() { vec2 t = vec2(crop.x + uv.x * crop.y, crop.z - uv.y * crop.w); t.x = clamp(t.x, clampx.x, clampx.y); o = vec4(texture(tex, t).rgb, 1.0); }`;
  const glSetup = (gl) => {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return { prog, vao, tex, uCrop: gl.getUniformLocation(prog, "crop"), uClamp: gl.getUniformLocation(prog, "clampx"), uTex: gl.getUniformLocation(prog, "tex") };
  };
  // a view's frustum from its projection matrix, as tangents: x = (m8 -+ 1) / m0, y = (m9 -+ 1) / m5
  const tans = (m) => ({ l: (m[8] - 1) / m[0], r: (m[8] + 1) / m[0], d: (m[9] - 1) / m[5], u: (m[9] + 1) / m[5] });
  // the crop of eye k's half: the centred frustum the engine drew (Fov::centred_at at W/H) is
  // [-TX, TX] x [-TY, TY] in tangents; WebXR's [l, r] x [d, u] inside it
  const cropOf = (t, k) => {
    const A = W / H;
    const ty = Math.max(Math.abs(t.u), Math.abs(t.d), Math.max(Math.abs(t.l), Math.abs(t.r)) / A), tx = ty * A;
    return { x0: (k + (t.l + tx) / (2 * tx)) / 2, sx: (t.r - t.l) / (2 * tx) / 2, y0: (ty - t.d) / (2 * ty), sy: (t.u - t.d) / (2 * ty) };
  };
  // the tracking's layout (src/web.rs, `Viewer::set_tracking`): eyes 0..22, floor and play area
  // 22..25, then per controller (left at 25, right at 48) 23 numbers: present, grip pos+quat, aim
  // pos+quat, stick x y (y up), trigger, squeeze, A/X, B/Y, stick pressed, menu
  // then (V13) per bare hand (left at 71, right at 150) 79 numbers: tracked, then OpenXR's 26 joints
  // x y z (src/hands.rs): the palm, the wrist, the thumb's 4, each finger's 5
  const TRACKING = 71, HAND = [25, 48], BARE = [71, 150], TRACKING_HANDS = 229;
  // WebXR's 25 joints (XRHand, no palm) in OpenXR's order after its palm: the same order, so OpenXR's
  // joint i is WebXR's i - 1. The palm is the middle of the middle finger's metacarpal bone, as OpenXR
  // defines it: halfway from "middle-finger-metacarpal" to "middle-finger-phalanx-proximal".
  const FINGER = (f) => [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`];
  const XR_JOINTS = ["wrist", "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
    ...FINGER("index-finger"), ...FINGER("middle-finger"), ...FINGER("ring-finger"), ...FINGER("pinky-finger")];
  const MID_META = 10, MID_PROX = 11;   // their places in XR_JOINTS
  // a bare hand's joints into the tail at `o` (true), or false where any joint is not tracked
  const putJoints = (out, o, frame, hand, space) => {
    if (!frame.getJointPose) return false;
    const got = [];
    for (const name of XR_JOINTS) {
      const js = hand.get(name), p = js ? frame.getJointPose(js, space) : null;
      if (!p) return false;
      const t = p.transform.position;
      got.push([t.x, t.y, t.z]);
    }
    const palm = [0, 1, 2].map((i) => (got[MID_META][i] + got[MID_PROX][i]) / 2);
    out[o] = 1;
    [palm, ...got].forEach((j, i) => out.set(j, o + 1 + 3 * i));
    return true;
  };
  // each controller (xr-standard mapping): trigger buttons[0], squeeze [1], thumbstick press [3],
  // A/X [4], B/Y [5]; the thumbstick axes[2], axes[3] (down positive in the mapping, so turned over).
  // The menu button is not exposed to pages by WebXR (the system keeps it), so it stays 0.
  const putHands = (out, frame, session, space) => {
    for (const src of session.inputSources || []) {
      const k = src.handedness === "left" ? 0 : src.handedness === "right" ? 1 : -1;
      if (k < 0) continue;
      // a bare hand (Quest Browser's hand tracking): its joints, and no controller - vr.rs reads the
      // pinch, the fist, the grip and the aim from them (`hands::as_controller`), as for OpenXR's
      if (src.hand) {
        if (out.length >= TRACKING_HANDS && putJoints(out, BARE[k], frame, src.hand, space)) continue;
        if (!src.gamepad) continue;   // no joints and no gamepad: absent
      }
      const o = HAND[k];
      const put = (at, xrSpace) => {
        const p = xrSpace ? frame.getPose(xrSpace, space) : null;
        if (!p) return;   // not tracked: the quaternion stays zero
        const t = p.transform.position, q = p.transform.orientation;
        out.set([t.x, t.y, t.z, q.x, q.y, q.z, q.w], at);
      };
      out[o] = 1;
      put(o + 1, src.gripSpace);
      put(o + 8, src.targetRaySpace);
      const g = src.gamepad;
      if (!g) continue;
      const b = (i) => g.buttons[i] || { pressed: false, value: 0 };
      const val = (i) => b(i).value || (b(i).pressed ? 1 : 0);
      out.set([g.axes[2] || 0, -(g.axes[3] || 0), val(0), val(1), b(4).pressed ? 1 : 0, b(5).pressed ? 1 : 0, b(3).pressed ? 1 : 0, 0], o + 15);
    }
  };
  // a buzz the game asked for, on that hand's controller: hapticActuators[0].pulse where there is one
  // (WebXR's gamepads), else the Gamepad's vibrationActuator
  const pulse = (session, hand, amp, secs) => {
    const want = hand === 0 ? "left" : "right";
    for (const src of session.inputSources || []) {
      if (src.handedness !== want || !src.gamepad) continue;
      const g = src.gamepad, ms = Math.max(1, Math.round(secs * 1000));
      try {
        const a = g.hapticActuators && g.hapticActuators[0];
        let r = null;
        if (a && a.pulse) r = a.pulse(amp, ms);
        else if (g.vibrationActuator && g.vibrationActuator.playEffect) r = g.vibrationActuator.playEffect("dual-rumble", { duration: ms, strongMagnitude: amp, weakMagnitude: amp });
        else continue;
        if (r && r.catch) r.catch(() => {});
        vr.pulses.push([hand, amp, ms]);
      } catch (e) { /* a controller that cannot buzz is not an error */ }
    }
  };
  const exitVR = () => {
    vr.active = false; vr.session = null;
    viewer.disable_stereo();
    vrButton.textContent = "Enter VR";
    // the canvas back to the one picture now, even when the mono loop has stopped
    if (dr.stopped && !pending) viewer.frame();
    say(`${world}: left VR after ${vr.frames} frames`);
  };
  const enterVR = async () => {
    if (vr.session) { await vr.session.end(); return; }
    const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] });
    let space;
    try { space = await session.requestReferenceSpace("local-floor"); vr.space = "local-floor"; }
    catch { space = await session.requestReferenceSpace("local"); vr.space = "local"; }
    const glc = document.createElement("canvas");
    const gl = glc.getContext("webgl2", { xrCompatible: true, alpha: false, antialias: false, depth: false });
    if (!gl) { await session.end(); throw new Error("no WebGL2 for the XR layer"); }
    const g = glSetup(gl);
    const layer = new XRWebGLLayer(session, gl, { antialias: false, depth: false });
    session.updateRenderState({ baseLayer: layer });
    vr.gl = gl; vr.layer = layer; vr.tex = g.tex; vr.frames = 0;
    viewer.enable_stereo(0.064);
    vr.session = session; vr.active = true;
    vrButton.textContent = "Exit VR";
    session.addEventListener("end", exitVR, { once: true });
    const cv = document.getElementById("view");
    const onFrame = (t, frame) => {
      if (!vr.active) return;
      session.requestAnimationFrame(onFrame);
      if (pending) return;
      const pose = frame.getViewerPose(space);
      if (!pose || pose.views.length < 1) return;
      const views = pose.views.length >= 2 ? [pose.views[0], pose.views[1]] : [pose.views[0], pose.views[0]];
      const track = new Float32Array(TRACKING_HANDS), crops = [];
      views.forEach((v, k) => {
        const p = v.transform.position, o = v.transform.orientation, tn = tans(v.projectionMatrix);
        track.set([p.x, p.y, p.z, o.x, o.y, o.z, o.w, Math.atan(tn.l), Math.atan(tn.r), Math.atan(tn.u), Math.atan(tn.d)], k * 11);
        crops.push(cropOf(tn, k));
      });
      // the floor: local-floor's 0 is the floor, local's is where the head began (the engine lifts it)
      track[22] = vr.space === "local-floor" ? 1 : 0;
      try {
        putHands(track, frame, session, space);
        viewer.set_tracking(track);
        feed();
        viewer.frame();
        const hz = viewer.take_haptics();
        for (let i = 0; i + 2 < hz.length; i += 3) pulse(session, hz[i], hz[i + 1], hz[i + 2]);
      } catch (e) { dr.error = String(e); say(`VR frame ${viewer.frames()}: ${e}`, true); session.end(); return; }
      pumpSound(); pumpFetch();
      // the canvas, both eyes, into the GL texture: in the same task as the frame, while the WebGPU
      // canvas still holds it; its bytes as they are (no colour-space conversion, no flip)
      gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.useProgram(g.prog); gl.bindVertexArray(g.vao);
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(g.uTex, 0);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      views.forEach((v, k) => {
        const vp = layer.getViewport(v);
        if (!vp) return;
        gl.viewport(vp.x, vp.y, vp.width, vp.height);
        const c = crops[k];
        gl.uniform4f(g.uCrop, c.x0, c.sx, c.y0, c.sy);
        gl.uniform2f(g.uClamp, k / 2 + 0.5 / (2 * W), (k + 1) / 2 - 0.5 / (2 * W));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      });
      vr.crops = crops; vr.frames++;
      if (vr.frames % 90 === 0) say(`${world}: VR frame ${vr.frames} (${vr.space}), both eyes ${W}x${H}`);
    };
    session.requestAnimationFrame(onFrame);
    say(`${world}: in VR (${vr.space}), both eyes ${W}x${H} side by side`);
  };
  vrButton.addEventListener("click", () => enterVR().catch((e) => { vr.error = String(e); say(`VR: ${e}`, true); }));
  // the canvas as the last XR frame copied it (RGBA, 2W x H, top row first): what the layer sampled
  vr.canvasPixels = () => {
    const gl = vr.gl, fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vr.tex, 0);
    const px = new Uint8Array(2 * W * H * 4);
    gl.readPixels(0, 0, 2 * W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
    return px;
  };
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported("immersive-vr").then((ok) => { vr.supported = ok; if (ok) vrButton.style.display = "block"; }).catch(() => {});
  }

  dr.ready = true;
  say(`${world}: built in ${dr.timing.build_s.toFixed(1)} s after ${dr.timing.fetch_s.toFixed(1)} s of fetching${dr.misses.length ? `; ${dr.misses.length} files asked for and not fetched` : ""}`);
  requestAnimationFrame(tick);
}

main().catch((e) => { dr.error = String(e && e.stack || e); say(String(e), true); console.error(e); });
