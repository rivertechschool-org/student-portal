/* =========================================================================
   WORD LAB — English Lyceum's adaptive vocabulary system
   -------------------------------------------------------------------------
   Built to Caitlin's design (2026-10-13). Four modes:

     📝 Assessment   placement: an adaptive test of meaning, spelling and
                     words in context that finds the grade to start at
     📖 Learning     the words of a level, listed: part of speech, meaning,
                     example, how to say it, read aloud
     🎯 Practice     mixed activities on the current level plus whatever is
                     due for review; flashcards; immediate explanations
     🏅 Evaluation   the level test: pass it (80%) to move to the next level

   The word bank is data/vocab/grade-*.json (K–12, easiest first). A grade is
   cut into levels of 12 words in that order.

   MEMORY IS PER WORD. Every answer goes to the database (via the host page,
   shared/vocab-bridge.js), which keeps a Leitner box and a due time for each
   word: right moves a word up a box only when it is due, wrong drops it to
   box 1, box 4 is mastered. This file mirrors that rule so the screen can
   update straight away; the database's copy wins on the next load.

   Runs inside Lyceum and borrows its look and its show(), USER_ID and
   SUMMARY. No microphone: listening uses the browser's own voice, which stays
   on the device.
   ========================================================================= */
(function () {
  'use strict';

  const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  const LEVEL_SIZE = 12;
  const PASS_PCT = 80;
  const DAY = 86400000;
  const BOX_DAYS = [0, 1, 3, 7, 14, 30];
  const BANK_VERSION = '5';

  const gradeLabel = (g) => (g === 'K' ? 'Kindergarten' : `Grade ${g}`);
  const gradeShort = (g) => (g === 'K' ? 'K' : `Gr ${g}`);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const key = (w) => String(w).toLowerCase();
  const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRx = (w) => new RegExp(`(^|[^A-Za-z'-])(${rxEsc(w)})(?=$|[^A-Za-z'-])`, 'i');

  /* ---------------------------------------------------------------------
     Word bank
     --------------------------------------------------------------------- */
  const BANK = {};
  async function loadGrade(g) {
    if (BANK[g]) return BANK[g];
    const r = await fetch(`../data/vocab/grade-${g}.json?v=${BANK_VERSION}`);
    if (!r.ok) throw new Error(`Could not load ${gradeLabel(g)} words`);
    const j = await r.json();
    // A short remainder (under 7 words) joins the level before it: a 1-word
    // last level made a 1-question Evaluation.
    const n = (j.words || []).length, rem = n % LEVEL_SIZE;
    const nLv = Math.max(1, rem && rem < 7 ? Math.floor(n / LEVEL_SIZE) : Math.ceil(n / LEVEL_SIZE));
    BANK[g] = (j.words || []).map((w, i) => Object.assign({}, w, {
      grade: g, idx: i, level: Math.min(Math.floor(i / LEVEL_SIZE) + 1, nLv), k: key(w.w),
    }));
    return BANK[g];
  }

  // Every word the bank uses anywhere (data/vocab/real-words.json, made by
  // add-ipa.js). A made-up misspelling must not be a real word, and a typed
  // real anagram or sound-alike earns "try again", not a mark against them.
  let REAL = null;
  async function loadReal() {
    if (REAL) return REAL;
    try { const r = await fetch(`../data/vocab/real-words.json?v=${BANK_VERSION}`); REAL = new Set(r.ok ? await r.json() : []); }
    catch (_) { REAL = new Set(); }
    return REAL;
  }
  const isReal = (w) => !!REAL && REAL.has(String(w).toLowerCase());
  // The levels loadGrade made - not length / 12, which counted a merged
  // remainder as a level of its own (an empty last level).
  const levelCount = (g) => (BANK[g] || []).reduce((m, e) => Math.max(m, e.level), 0);
  const levelWords = (g, n) => (BANK[g] || []).filter(e => e.level === n);
  function findWord(k, g) {
    if (g && BANK[g]) { const e = BANK[g].find(x => x.k === k); if (e) return e; }
    for (const gg of GRADES) { const e = (BANK[gg] || []).find(x => x.k === k); if (e) return e; }
    return null;
  }

  /* ---------------------------------------------------------------------
     Talking to the host (shared/vocab-bridge.js)
     --------------------------------------------------------------------- */
  const inHost = !!(window.parent && window.parent !== window);
  let seq = 0;
  const waiting = {};
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const d = e.data;
    if (d && d.reqId && waiting[d.reqId]) { waiting[d.reqId](d); delete waiting[d.reqId]; }
  });
  function ask(type, body, ms) {
    return new Promise((resolve) => {
      if (!inHost) return resolve(null);
      const reqId = 'wl' + (++seq) + '-' + Date.now();
      waiting[reqId] = resolve;
      try { window.parent.postMessage(Object.assign({ type, reqId }, body || {}), location.origin); }
      catch (_) { delete waiting[reqId]; return resolve(null); }
      setTimeout(() => { if (waiting[reqId]) { delete waiting[reqId]; resolve(null); } }, ms || 8000);
    });
  }

  /* ---------------------------------------------------------------------
     The student's state: profile + per-word memory
     --------------------------------------------------------------------- */
  const LS_KEY = 'wordlab:' + (typeof USER_ID !== 'undefined' && USER_ID ? USER_ID : 'guest');
  const S = { profile: null, words: {}, loaded: false, synced: false };
  let queue = [];       // answers not yet batched
  let pending = [];     // batches not yet confirmed saved: [{ id, results }]

  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ owner: LS_KEY, profile: S.profile, words: S.words, queue, pending })); } catch (_) {}
  }
  function loadLocal() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (j && j.owner === LS_KEY) {
        S.profile = j.profile || null; S.words = j.words || {};
        // Answers that never reached the database last time are sent now.
        if (Array.isArray(j.queue)) queue = j.queue.concat(queue);
        if (Array.isArray(j.pending)) pending = j.pending.filter(b => b && b.id && Array.isArray(b.results)).concat(pending);
      }
    } catch (_) {}
  }

  async function loadState() {
    loadLocal();
    loadReal();
    // Send anything left over first, so the state loaded next includes it.
    if (queue.length || pending.length) await flush();
    const res = await ask('VOCAB_LOAD', {}, 10000);
    if (res && res.ok && res.state) {
      const st = res.state;
      const serverNow = st.now ? new Date(st.now).getTime() : Date.now();
      const skew = Date.now() - serverNow;
      S.profile = st.profile || null;
      S.words = {};
      (st.words || []).forEach(w => {
        S.words[key(w.word)] = {
          grade: w.grade, box: w.box, due: new Date(w.due_at).getTime() + skew,
          seen: w.seen, right: w.right, wrong: w.wrong, mastered: !!w.mastered,
        };
      });
      S.synced = true;
      saveLocal();
    } else {
      S.synced = false;
    }
    S.loaded = true;
  }

  // Same rule as rt_vocab_record, so the screen moves at once. A miss is due
  // again in 10 minutes (not straight away, or the next right answer would
  // count as a spaced review), and a self-rated flashcard stops at box 2.
  function applyResult(e, right, self) {
    const now = Date.now();
    const r = S.words[e.k] || { grade: e.grade, box: 0, due: now, seen: 0, right: 0, wrong: 0, mastered: false };
    if (right) {
      if ((r.box === 0 || r.due <= now) && !(self && r.box >= 2)) { r.box = Math.min(r.box + 1, 5); r.due = now + BOX_DAYS[r.box] * DAY; }
      r.right++;
    } else { r.box = 1; r.due = now + 10 * 60000; r.wrong++; }
    r.seen++; r.grade = e.grade; r.mastered = r.box >= 4;
    S.words[e.k] = r;
    queue.push(Object.assign({ word: e.k, grade: e.grade, right: !!right }, self ? { self: true } : {}));
    saveLocal();
    if (queue.length >= 6) flush();
  }
  let flushing = null;
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      if (queue.length) {
        pending.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), results: queue.splice(0, queue.length) });
        saveLocal();
      }
      // Each batch keeps its id across retries; the database ignores an id it
      // has already recorded, so a slow save is never counted twice.
      while (pending.length && inHost) {
        const b = pending[0];
        const res = await ask('VOCAB_RECORD', { results: b.results, batchId: b.id });
        if (!res || !res.ok) break;
        pending.shift();
        saveLocal();
      }
      if (pending.length > 50) pending = pending.slice(-50);
    })();
    try { await flushing; } finally { flushing = null; }
  }
  window.addEventListener('pagehide', () => { flush(); });

  const memOf = (e) => S.words[e.k] || null;
  const isDue = (m) => !!m && m.box > 0 && m.due <= Date.now();
  const statusOf = (e) => {
    const m = memOf(e);
    if (!m) return 'new';
    if (m.mastered) return isDue(m) ? 'review' : 'mastered';
    return isDue(m) ? 'review' : 'learning';
  };
  const STATUS_LABEL = { new: '🆕 New', learning: '🌱 Learning', review: '🔁 Review now', mastered: '⭐ Mastered' };

  function current() {
    const p = S.profile || {};
    return { grade: p.current_grade || null, level: p.current_level || 1 };
  }

  /* ---------------------------------------------------------------------
     Read aloud (browser voice, on the device)
     --------------------------------------------------------------------- */
  const hasSpeechApi = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  // The API without any voice (some managed Chromebooks, Linux) is silence.
  let canSpeak = hasSpeechApi;
  function refreshCanSpeak() { try { canSpeak = hasSpeechApi && speechSynthesis.getVoices().length > 0; } catch (_) { canSpeak = false; } }
  let voice = null;
  function pickVoice() {
    if (!canSpeak) return;
    const vs = speechSynthesis.getVoices() || [];
    voice = vs.find(v => /en[-_]US/i.test(v.lang) && /natural|google|samantha|aria|jenny/i.test(v.name))
         || vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  if (hasSpeechApi) { pickVoice(); refreshCanSpeak(); speechSynthesis.onvoiceschanged = () => { pickVoice(); refreshCanSpeak(); }; }
  function speak(text, rate) {
    if (!hasSpeechApi || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = (voice && voice.lang) || 'en-US';
      u.rate = rate || 0.85;
      speechSynthesis.speak(u);
    } catch (_) {}
  }
  const speakBtn = (text, label) => canSpeak
    ? `<button type="button" class="btn ghost wl-say" onclick="WordLab.say(${esc(JSON.stringify(text))})" title="Hear it">🔊${label ? ' ' + esc(label) : ''}</button>` : '';

  /* ---------------------------------------------------------------------
     Screens (built once, inside Lyceum's .wrap)
     --------------------------------------------------------------------- */
  const WL_CSS = `
    .mode.wordlab { background:linear-gradient(135deg,var(--rust),#c9774f); }
    .wl-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:12px 0; }
    @media(max-width:560px){ .wl-stats{ grid-template-columns:repeat(2,1fr); } }
    .wl-stat { background:var(--paper-100); border:1px solid var(--line); border-radius:12px; padding:10px; text-align:center; }
    .wl-stat .n { font-family:'Fraunces',serif; font-size:1.6rem; color:var(--gold); line-height:1.1; }
    .wl-stat .l { font-size:.78rem; color:var(--muted); }
    .wl-modes .mode.assess { background:linear-gradient(135deg,var(--gold),var(--gold-light)); }
    .wl-modes .mode.learn { background:linear-gradient(135deg,var(--moss),var(--moss-light)); }
    .wl-modes .mode.practice { background:linear-gradient(135deg,var(--teal),var(--teal-light)); }
    .wl-modes .mode.evaluate { background:linear-gradient(135deg,var(--plum),var(--plum-light)); }
    .wl-word { background:#fffdf6; border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:10px; }
    .wl-word .hw { font-family:'Fraunces',serif; font-size:1.3rem; color:var(--ink-900); }
    .wl-word .pos { font-style:italic; color:var(--muted); font-size:.9rem; margin-left:6px; }
    .wl-word .pron { color:var(--muted); font-size:.85rem; margin-top:2px; }
    .wl-word .def { margin-top:6px; }
    .wl-word .ex { margin-top:4px; font-style:italic; color:var(--ink-700); }
    .wl-word .syn { margin-top:4px; font-size:.85rem; color:var(--muted); }
    .wl-word .top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
    .wl-tag { font-size:.72rem; padding:2px 9px; border-radius:999px; font-weight:700; white-space:nowrap; background:#eee; color:var(--muted); }
    .wl-tag.mastered { background:#e8f6e9; color:var(--ok); }
    .wl-tag.review { background:#fff3d6; color:#9a6b00; }
    .wl-tag.learning { background:#e7f0fb; color:#2b5d99; }
    .wl-say { padding:6px 10px; font-size:.95rem; }
    .wl-blank { display:inline-block; min-width:80px; border-bottom:2px solid var(--ink-700); }
    .wl-hint { color:var(--muted); font-size:.92rem; margin:-6px 0 12px; }
    .wl-scramble { font-family:'Fraunces',serif; font-size:1.6rem; letter-spacing:6px; text-align:center; margin:6px 0 12px; color:var(--rust); }
    .wl-match { display:grid; grid-template-columns:1fr 1.6fr; gap:10px; }
    .wl-match .col { display:grid; gap:8px; align-content:start; }
    .wl-match .ans { padding:10px 12px; font-size:.95rem; }
    .wl-match .ans.sel { border-color:var(--gold); box-shadow:0 0 0 2px rgba(184,134,11,.3) inset; }
    .wl-match .ans.done { background:#e8f6e9; border-color:var(--ok); cursor:default; }
    .wl-flash { min-height:200px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; cursor:pointer; }
    .wl-flash .hw { font-family:'Fraunces',serif; font-size:2.2rem; color:var(--ink-900); }
    .wl-list { max-height:60vh; overflow:auto; }
    .wl-note { background:#fff7e6; border:1px solid var(--gold-light); border-radius:10px; padding:10px 12px; font-size:.9rem; margin-top:10px; }
  `;

  const HTML = `
  <section id="wl-home" class="screen">
    <div class="backbar"><button class="btn ghost" onclick="Game.toModes()">← Lyceum</button><span class="crumb">Word Lab</span></div>
    <div class="brand"><div class="quill">📖</div><h1>Word Lab</h1><p>Learn words that stick — level by level.</p></div>
    <div class="card" id="wl-where"></div>
    <div class="wl-stats" id="wl-stats"></div>
    <div class="modes wl-modes">
      <div class="mode assess" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}" onclick="WordLab.startAssessment()"><div class="ic">📝</div><h3>Assessment</h3><p>Find your starting level: meanings, spelling and words in sentences.</p></div>
      <div class="mode learn" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}" onclick="WordLab.openLearning()"><div class="ic">📖</div><h3>Learning</h3><p>See your level's words: what they mean, how to say them, how to use them.</p></div>
      <div class="mode practice" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}" onclick="WordLab.openPractice()"><div class="ic">🎯</div><h3>Practice</h3><p>Games and flashcards. Words you miss come back until they stick.</p></div>
      <div class="mode evaluate" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}" onclick="WordLab.startEvaluation()"><div class="ic">🏅</div><h3>Evaluation</h3><p>The level test. Score ${PASS_PCT}% to move up a level.</p></div>
    </div>
    <div class="spacer"></div>
    <div class="card" id="wl-trouble"></div>
  </section>

  <section id="wl-learn" class="screen">
    <div class="backbar"><button class="btn ghost" onclick="WordLab.home()">← Word Lab</button><span class="crumb">Learning</span></div>
    <div class="card">
      <div class="row">
        <div style="flex:1;min-width:140px"><label class="field">Grade</label><select id="wl-learn-grade" onchange="WordLab.learnGradeChanged()"></select></div>
        <div style="flex:1;min-width:140px"><label class="field">Level</label><select id="wl-learn-level" onchange="WordLab.renderLearning()"></select></div>
      </div>
      <div class="spacer"></div>
      <div id="wl-learn-list" class="wl-list"></div>
      <div class="spacer"></div>
      <div class="row">
        <button class="btn gold" style="flex:1" onclick="WordLab.practiceThisLevel()">🎯 Practise these words</button>
        <button class="btn ghost" style="flex:1" id="wl-make-mine" onclick="WordLab.makeMyLevel()">Make this my level</button>
      </div>
    </div>
  </section>

  <section id="wl-practice" class="screen">
    <div class="backbar"><button class="btn ghost" onclick="WordLab.home()">← Word Lab</button><span class="crumb">Practice</span></div>
    <div class="card">
      <h2>🎯 Practice</h2>
      <p class="muted" id="wl-practice-sub"></p>
      <div class="grid2" style="margin-top:12px">
        <div class="opt-card" onclick="WordLab.startPractice('mix')"><div class="t">🎲 Mixed practice</div><div class="d">Your level's words, plus any due for review, in different games.</div></div>
        <div class="opt-card" onclick="WordLab.startPractice('review')"><div class="t">🔁 Review due words</div><div class="d" id="wl-due-d">Words the schedule says to check today.</div></div>
        <div class="opt-card" onclick="WordLab.startFlashcards()"><div class="t">🃏 Flashcards</div><div class="d">Flip each card. Say if you knew it.</div></div>
        <div class="opt-card" onclick="WordLab.startPractice('spelling')"><div class="t">✏️ Spelling</div><div class="d">Listen, unscramble and spot the right spelling.</div></div>
        <div class="opt-card" onclick="WordLab.startPractice('meaning')"><div class="t">💡 Meanings &amp; sentences</div><div class="d">Match words to meanings, fill blanks, pick the right sentence.</div></div>
        <div class="opt-card" onclick="WordLab.startPractice('listen')"><div class="t">👂 Listening</div><div class="d">Hear a word and find it.</div></div>
      </div>
    </div>
  </section>

  <section id="wl-q" class="screen">
    <div class="backbar"><button class="btn ghost" onclick="WordLab.endSession()">✕ End</button><span class="crumb" id="wl-q-crumb"></span></div>
    <div class="card">
      <div class="qmeta"><span class="pill" id="wl-q-kind"></span><span id="wl-q-count"></span></div>
      <div class="progressbar"><div class="progressfill" id="wl-q-bar"></div></div>
      <div id="wl-q-body"></div>
      <div class="feedback" id="wl-q-fb" role="status" aria-live="polite"><div class="verdict" id="wl-q-verdict"></div><div class="why" id="wl-q-why"></div></div>
      <div class="spacer"></div>
      <button class="btn gold block hidden" id="wl-q-next" onclick="WordLab.next()">Next →</button>
    </div>
  </section>

  <section id="wl-results" class="screen">
    <div class="card">
      <h2 class="center" id="wl-res-title"></h2>
      <div class="bigstat"><div class="n" id="wl-res-score"></div><div class="l" id="wl-res-sub"></div></div>
      <div id="wl-res-body"></div>
      <div class="spacer"></div>
      <button class="btn gold block" onclick="WordLab.home()">Back to Word Lab</button>
    </div>
  </section>`;

  // Styles go in at load, not on first open: Lyceum's menu shows the Word Lab
  // card before anyone opens it.
  { const st = document.createElement('style'); st.textContent = WL_CSS; document.head.appendChild(st); }

  let built = false;
  function build() {
    if (built) return;
    const wrap = document.querySelector('.wrap');
    const holder = document.createElement('div'); holder.innerHTML = HTML;
    while (holder.firstElementChild) wrap.appendChild(holder.firstElementChild);
    built = true;
  }

  /* ---------------------------------------------------------------------
     Home
     --------------------------------------------------------------------- */
  async function open() {
    build();
    show('wl-home');
    document.getElementById('wl-where').innerHTML = '<span class="muted">Loading your words…</span>';
    await loadState();
    const cur = current();
    if (cur.grade) { try { await loadGrade(cur.grade); } catch (_) {} }
    // Words being reviewed can come from any grade; load the ones that hold them.
    const gradesInMemory = [...new Set(Object.values(S.words).map(w => w.grade))];
    await Promise.all(gradesInMemory.map(g => loadGrade(g).catch(() => null)));
    renderHome();
  }

  function renderHome() {
    const cur = current();
    const where = document.getElementById('wl-where');
    if (!cur.grade) {
      where.innerHTML = `<h3>Welcome to Word Lab</h3>
        <p class="muted" style="margin-top:4px">Start with the <b>Assessment</b> to find your level. Or open <b>Learning</b> and choose a level yourself.</p>`;
    } else {
      const total = levelCount(cur.grade) || 0;
      const words = levelWords(cur.grade, cur.level);
      const done = words.filter(e => statusOf(e) === 'mastered').length;
      where.innerHTML = `<div class="muted" style="font-size:.85rem">You are on</div>
        <h2 style="margin:2px 0">${esc(gradeLabel(cur.grade))} · Level ${cur.level}${total ? ` <span class="muted" style="font-size:1rem">of ${total}</span>` : ''}</h2>
        <div class="muted">${done} of ${words.length} words mastered on this level.
        ${S.profile && S.profile.placement_grade ? ` Placed at ${esc(gradeLabel(S.profile.placement_grade))}.` : ''}</div>
        ${!S.synced && inHost ? '<div class="wl-note">Your saved progress could not be loaded just now. What you do will still be saved when the connection is back.</div>' : ''}
        ${!inHost ? '<div class="wl-note">Open Word Lab from your RiverTech page to save your progress.</div>' : ''}`;
    }
    const vals = Object.values(S.words);
    const mastered = vals.filter(m => m.mastered).length;
    const due = vals.filter(isDue).length;
    const passed = ((S.profile && S.profile.levels_passed) || []).length;
    document.getElementById('wl-stats').innerHTML = [
      [vals.length, 'words met'], [mastered, 'mastered'], [due, 'due for review'], [passed, 'levels passed'],
    ].map(([n, l]) => `<div class="wl-stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');

    const trouble = Object.entries(S.words)
      .filter(([, m]) => m.seen >= 2 && m.wrong > m.right)
      .sort((a, b) => (b[1].wrong - b[1].right) - (a[1].wrong - a[1].right)).slice(0, 10);
    const tEl = document.getElementById('wl-trouble');
    if (trouble.length) {
      tEl.style.display = '';
      tEl.innerHTML = `<h3>Words to work on</h3><p class="muted" style="font-size:.88rem">You've missed these more than you've got them. Practice brings them back.</p>
        <div class="chips">${trouble.map(([k]) => `<span class="chip" role="button" tabindex="0" onclick="WordLab.showWord(${esc(JSON.stringify(k))})">${esc(k)}</span>`).join('')}</div>`;
    } else tEl.style.display = 'none';
  }

  function showWord(k) {
    const e = findWord(k);
    if (!e) return;
    say(e.w);
    openLearning(e.grade, e.level);
  }

  /* ---------------------------------------------------------------------
     Learning: the words of a level, listed
     --------------------------------------------------------------------- */
  async function openLearning(g, lv) {
    build();
    const cur = current();
    g = g || cur.grade || 'K';
    lv = lv || (g === cur.grade ? cur.level : 1);
    show('wl-learn');
    const gs = document.getElementById('wl-learn-grade');
    gs.innerHTML = GRADES.map(x => `<option value="${x}" ${x === g ? 'selected' : ''}>${esc(gradeLabel(x))}</option>`).join('');
    await fillLevels(g, lv);
    renderLearning();
  }
  async function fillLevels(g, lv) {
    const ls = document.getElementById('wl-learn-level');
    ls.innerHTML = '<option>Loading…</option>';
    try { await loadGrade(g); } catch (e) { ls.innerHTML = ''; document.getElementById('wl-learn-list').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const n = levelCount(g);
    ls.innerHTML = Array.from({ length: n }, (_, i) => {
      const words = levelWords(g, i + 1);
      const m = words.filter(e => statusOf(e) === 'mastered').length;
      return `<option value="${i + 1}" ${i + 1 === lv ? 'selected' : ''}>Level ${i + 1}${m ? ` (${m}/${words.length} ⭐)` : ''}</option>`;
    }).join('');
  }
  async function learnGradeChanged() {
    const g = document.getElementById('wl-learn-grade').value;
    await fillLevels(g, 1);
    renderLearning();
  }
  function selectedLevel() {
    return { grade: document.getElementById('wl-learn-grade').value, level: Number(document.getElementById('wl-learn-level').value) || 1 };
  }
  function wordCard(e) {
    const st = statusOf(e);
    const ex = esc(e.ex).replace(wordRx(e.w), (m, a, b) => `${a}<b>${b}</b>`);
    return `<div class="wl-word">
      <div class="top"><div><span class="hw">${esc(e.w)}</span><span class="pos">${esc(e.pos)}</span></div>
        <div style="display:flex;gap:6px;align-items:center"><span class="wl-tag ${st}">${STATUS_LABEL[st]}</span>${speakBtn(e.w)}</div></div>
      <div class="pron">say it: <b>${esc(e.say)}</b>${e.ipa ? ` · /${esc(e.ipa)}/` : ''}</div>
      <div class="def">${esc(e.def)}</div>
      <div class="ex">“${ex}” ${speakBtn(e.ex, '')}</div>
      ${e.syn && e.syn.length ? `<div class="syn">Means about the same as: ${e.syn.map(esc).join(', ')}</div>` : ''}
    </div>`;
  }
  function renderLearning() {
    const { grade, level } = selectedLevel();
    const words = levelWords(grade, level);
    document.getElementById('wl-learn-list').innerHTML = words.length ? words.map(wordCard).join('') : '<p class="muted">No words here.</p>';
    const cur = current();
    const mine = cur.grade === grade && cur.level === level;
    const b = document.getElementById('wl-make-mine');
    b.disabled = mine;
    b.textContent = mine ? '✓ This is your level' : 'Make this my level';
  }
  async function makeMyLevel() {
    const { grade, level } = selectedLevel();
    S.profile = Object.assign({}, S.profile || {}, { current_grade: grade, current_level: level });
    saveLocal();
    renderLearning();
    const r = await ask('VOCAB_SET_LEVEL', { grade, level });
    if (inHost && (!r || !r.ok)) toast('Could not save your level just now.');
  }
  function practiceThisLevel() {
    const { grade, level } = selectedLevel();
    startPractice('mix', { grade, level });
  }

  /* ---------------------------------------------------------------------
     Questions
     --------------------------------------------------------------------- */
  // Two words too close to set against each other: one lists the other as a
  // synonym, they share a synonym, they have the same definition, one
  // contains the other (here/there), or their definitions mostly overlap.
  const STOP = new Set('a an the of to and or in on at for with by is are be that this it its as from your you someone something thing things way who which when what very'.split(' '));
  const synSet = (x) => new Set((x.syn || []).map(key));
  const defWords = (d) => new Set(String(d).toLowerCase().split(/[^a-z]+/).filter(t => t.length > 2 && !STOP.has(t)));
  function related(a, b) {
    // `near`: true synonyms the data marks as too close to set against each
    // other (thrive / flourish), though neither lists the other as a synonym.
    if ((a.near || []).some(w => key(w) === b.k) || (b.near || []).some(w => key(w) === a.k)) return true;
    const sa = synSet(a), sb = synSet(b);
    if (sa.has(b.k) || sb.has(a.k)) return true;
    for (const x of sa) if (sb.has(x)) return true;
    if (String(a.def).toLowerCase() === String(b.def).toLowerCase()) return true;
    if (a.k.length >= 4 && b.k.length >= 4 && (a.k.includes(b.k) || b.k.includes(a.k))) return true;
    const da = defWords(a.def), db = defWords(b.def);
    if (da.size && db.size) {
      let both = 0; for (const t of da) if (db.has(t)) both++;
      if (both / (da.size + db.size - both) >= 0.6) return true;
    }
    return false;
  }
  // Other words to offer beside the right one: same grade, same part of
  // speech when there are enough (or a DIFFERENT one when asked), never the
  // word itself or a word too close to it.
  function others(e, n, test, posMode) {
    const pool = (BANK[e.grade] || []).filter(x => x.k !== e.k && !related(e, x) && (!test || test(x)));
    const pref = posMode === 'other' ? pool.filter(x => x.pos !== e.pos) : pool.filter(x => x.pos === e.pos);
    const src = pref.length >= n ? pref : pool;
    return shuffle(src).slice(0, n);
  }
  // The blank, with "a"/"an" in front of it shown as "a(n)": the article
  // would otherwise rule out the options that start with the other sound.
  function blankOut(e) {
    const rx = new RegExp(`(^|[^A-Za-z'-])(?:(an?)\\s+)?(${rxEsc(e.w)})(?=$|[^A-Za-z'-])`, 'i');
    const m = rx.exec(e.ex);
    if (!m) return esc(e.ex);
    const start = m.index + m[1].length;
    const art = m[2] ? (/^A/.test(m[2]) ? 'A(n) ' : 'a(n) ') : '';
    return esc(e.ex.slice(0, start)) + art + '<span class="wl-blank">&nbsp;</span>' + esc(e.ex.slice(m.index + m[0].length));
  }
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const vowelSound = (e) => e.ipa ? /^[ˈˌ]?[aeiouɑæʌɔɛɪʊəɝɚ]/.test(e.ipa) : /^[aeiou]/i.test(e.w);
  // A sentence that uses `e` where another word belongs: the other word's own
  // example with its headword swapped for this one, and its "a"/"an" fixed.
  function misuse(e, other) {
    const rx = new RegExp(`(^|[^A-Za-z'-])(?:(an?)\\s+)?(${rxEsc(other.w)})(?=$|[^A-Za-z'-])`, 'i');
    return other.ex.replace(rx, (m, a, art, b) => {
      if (!art) return a + (/^[A-Z]/.test(b) ? cap(e.w) : e.w);
      const na = vowelSound(e) ? 'an' : 'a';
      return a + (/^A/.test(art) ? cap(na) : na) + ' ' + e.w;
    });
  }
  // British/American and other accepted variants are not misspellings.
  function altSpelling(w, v) {
    const n = (x) => x.replace(/our\b/g, 'or').replace(/is(e|ed|ing|ation)\b/g, 'iz$1').replace(/ys(e|ed|ing)\b/g, 'yz$1')
      .replace(/re$/, 'er').replace(/ll(?=(ed|ing|er|ful)\b)/g, 'l').replace(/lful/, 'ful').replace(/ogue$/, 'og')
      .replace(/gement/, 'gment').replace(/ence$/, 'ense').replace(/^grey$/, 'gray').replace(/^mum$/, 'mom').replace(/efact/, 'ifact');
    return n(w) === n(v);
  }
  function misspellings(w) {
    const out = new Set();
    if (w.length < 3) return [];
    const vowels = 'aeiou';
    const tries = [
      () => { if (w.length < 3) return null; const i = 1 + Math.floor(Math.random() * (w.length - 2)); return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2); },
      () => { const m = w.match(/([b-df-hj-np-tv-z])\1/); return m ? w.replace(m[0], m[1]) : null; },
      () => { const idx = [...w].map((c, i) => (/[b-df-hj-np-tv-z]/.test(c) && i > 0 && i < w.length - 1 ? i : -1)).filter(i => i >= 0); if (!idx.length) return null; const i = idx[Math.floor(Math.random() * idx.length)]; return w.slice(0, i) + w[i] + w.slice(i); },
      () => { const idx = [...w].map((c, i) => (vowels.includes(c) ? i : -1)).filter(i => i >= 0); if (!idx.length) return null; const i = idx[Math.floor(Math.random() * idx.length)]; const alt = vowels.replace(w[i], ''); return w.slice(0, i) + alt[Math.floor(Math.random() * alt.length)] + w.slice(i + 1); },
      () => w.replace(/tion$/, 'sion').replace(/ible$/, 'able').replace(/ence$/, 'ance').replace(/ie/, 'ei'),
      () => w.replace(/c(?=[eiy])/, 's').replace(/ph/, 'f').replace(/ck/, 'k'),
      () => (w.length > 4 ? w.slice(0, -2) + w.slice(-1) : null),
    ];
    const hyphens = [...w].map((c, i) => (c === '-' ? i : -1)).filter(i => i >= 0).join(',');
    for (let n = 0; n < 80 && out.size < 3; n++) {
      const v = tries[n % tries.length]();
      if (!v || v === w || !/^[a-z'-]+$/i.test(v)) continue;
      if ([...v].map((c, i) => (c === '-' ? i : -1)).filter(i => i >= 0).join(',') !== hyphens) continue;   // never move a hyphen
      if (isReal(v) || altSpelling(w.toLowerCase(), v.toLowerCase())) continue;                         // dessert, traveller
      out.add(v);
    }
    return [...out].slice(0, 3);
  }
  // A scramble that keeps hyphens where they are, and for young grades or
  // long words keeps the first letter too. Never the word itself, never
  // another real word.
  function scrambleOf(e, letFirstMove) {
    const w = e.w;
    const keepFirst = !letFirstMove && (W_GRADES_YOUNG.has(e.grade) || w.length >= 8);
    const fixed = (c, i) => c === '-' || (keepFirst && i === 0);
    const movable = [...w].map((c, i) => (fixed(c, i) ? null : c)).filter(c => c !== null);
    let best = w;
    for (let t = 0; t < 20; t++) {
      const sh = shuffle(movable); let j = 0;
      const out = [...w].map((c, i) => (fixed(c, i) ? c : sh[j++])).join('');
      if (out.toLowerCase() !== w.toLowerCase() && !isReal(out)) return out;
      if (out !== w) best = out;
    }
    // "see", "egg": with the first letter held, the rest can't move. Let it.
    if (best.toLowerCase() === w.toLowerCase() && keepFirst) return scrambleOf(e, true);
    return best;
  }
  const W_GRADES_YOUNG = new Set(['K', '1', '2', '3', '4']);

  const KIND_LABEL = {
    meaning: 'Meaning', word: 'Which word?', blank: 'Fill the blank', usage: 'Use it right', synonym: 'Same meaning',
    spellpick: 'Spelling', listen: 'Listen & spell', scramble: 'Unscramble', hear: 'Listening', match: 'Matching',
  };

  // Builds one question for a word. Returns { kind, e, html, options? , typed? , say? }.
  function makeQuestion(e, kind) {
    const q = { kind, e };
    if (kind === 'synonym' && !(e.syn && e.syn.length)) kind = q.kind = 'meaning';
    if ((kind === 'listen' || kind === 'hear') && !canSpeak) kind = q.kind = (kind === 'listen' ? 'scramble' : 'meaning');
    // Too short to scramble or misspell ("I", "go").
    if ((kind === 'scramble' || kind === 'spellpick') && e.w.replace(/-/g, '').length < 3) kind = q.kind = 'meaning';
    switch (kind) {
      case 'meaning': {
        const opts = [{ t: e.def, ok: true }, ...others(e, 3, x => x.def !== e.def).map(x => ({ t: x.def }))];
        q.html = `<div class="qprompt">What does <b>${esc(e.w)}</b> mean? ${speakBtn(e.w)}</div>`;
        q.options = shuffle(opts);
        break;
      }
      case 'word': {
        q.html = `<div class="qprompt">Which word means <i>“${esc(e.def)}”</i>?</div>`;
        q.options = shuffle([{ t: e.w, ok: true }, ...others(e, 3).map(x => ({ t: x.w }))]);
        break;
      }
      case 'blank': {
        q.html = `<div class="qprompt">Which word fits the blank?</div><div class="passage">${blankOut(e)}</div>`;
        q.options = shuffle([{ t: e.w, ok: true }, ...others(e, 3).map(x => ({ t: x.w }))]);
        break;
      }
      case 'usage': {
        // Wrong sentences come from words of a DIFFERENT part of speech, so
        // they really are wrong; same-POS swaps were often fine sentences.
        // Two words with the same example frame ("Wearing a helmet is ___")
        // would make the same wrong sentence twice, so repeats are dropped.
        const seenT = new Set([e.ex]);
        const wrong = others(e, 3, x => wordRx(x.w).test(x.ex), 'other').map(x => ({ t: misuse(e, x) }))
          .filter(o => !seenT.has(o.t) && seenT.add(o.t));
        q.html = `<div class="qprompt">Which sentence uses <b>${esc(e.w)}</b> correctly?</div>`;
        q.options = shuffle([{ t: e.ex, ok: true }, ...wrong]);
        break;
      }
      case 'synonym': {
        const syns = new Set(e.syn.map(key));
        // The wrong options are other words' SYNONYMS too, so the answer is
        // not "the one that isn't on my list".
        const wrongs = others(e, 6, x => !syns.has(x.k) && x.syn && x.syn.length)
          .map(x => x.syn[0]).filter(t => !syns.has(key(t)) && key(t) !== e.k);
        const uniq = [...new Set(wrongs)].slice(0, 3);
        if (uniq.length < 3) others(e, 3 - uniq.length, x => !syns.has(x.k) && !uniq.includes(x.w)).forEach(x => uniq.push(x.w));
        q.html = `<div class="qprompt">Which word means about the same as <b>${esc(e.w)}</b>?</div>`;
        q.options = shuffle([{ t: e.syn[Math.floor(Math.random() * e.syn.length)], ok: true }, ...uniq.map(t => ({ t }))]);
        break;
      }
      case 'spellpick': {
        const bad = misspellings(e.w);
        if (bad.length < 2) return makeQuestion(e, 'scramble');
        q.html = `<div class="qprompt">Which is the right spelling of this word? ${speakBtn(e.w)}</div><div class="wl-hint">It means: ${esc(e.def)}</div>`;
        q.options = shuffle([{ t: e.w, ok: true }, ...bad.map(t => ({ t }))]);
        break;
      }
      case 'listen': {
        // The word, then its sentence: a sound-alike (see / sea) is told apart
        // by the sentence.
        const said = `${e.w}. ${e.ex}`;
        q.html = `<div class="qprompt">Listen, then type the word. ${speakBtn(said, 'Play')}</div><div class="wl-hint">It means: ${esc(e.def)}</div>`;
        q.typed = e.w; q.say = said; q.soundAlike = true;
        break;
      }
      case 'scramble': {
        const s = scrambleOf(e);
        q.html = `<div class="qprompt">Unscramble the word.</div><div class="wl-scramble">${esc(s.toUpperCase())}</div><div class="wl-hint">It means: ${esc(e.def)}</div>`;
        q.typed = e.w; q.anagram = true;
        break;
      }
      case 'hear': {
        q.html = `<div class="qprompt">Listen. Which word did you hear? ${speakBtn(e.w, 'Play')}</div>`;
        q.options = shuffle([{ t: e.w, ok: true }, ...others(e, 3).map(x => ({ t: x.w }))]);
        q.say = e.w;
        break;
      }
    }
    return q;
  }

  // Which activity a word gets, from how well it is known: recognise first,
  // then use it, then produce it.
  function kindFor(e, focus) {
    const m = memOf(e);
    const box = m ? m.box : 0;
    const pickFrom = (list) => list[Math.floor(Math.random() * list.length)];
    if (focus === 'spelling') return pickFrom(box < 2 ? ['spellpick', 'scramble'] : ['listen', 'scramble', 'spellpick']);
    if (focus === 'meaning') return pickFrom(box < 2 ? ['meaning', 'word', 'blank'] : ['usage', 'synonym', 'blank', 'word']);
    if (focus === 'listen') return pickFrom(box < 2 ? ['hear'] : ['hear', 'listen']);
    if (box === 0) return pickFrom(['meaning', 'word', 'blank']);
    if (box <= 2) return pickFrom(['blank', 'usage', 'synonym', 'spellpick', 'hear', 'word']);
    return pickFrom(['listen', 'usage', 'scramble', 'blank']);
  }

  /* ---------------------------------------------------------------------
     A session (practice, assessment step, evaluation)
     --------------------------------------------------------------------- */
  let Q = null;   // { title, items:[q], i, mode, results:[], onDone, feedback }

  let lockUntil = 0;   // a double-tap must not answer the next question too

  function runSession(opts) {
    if (!opts.items || !opts.items.length) { toast('No words to practise here yet.'); home(); return; }
    Q = Object.assign({ i: 0, results: [], answered: false }, opts);
    if (Q.summary !== false && typeof SUMMARY !== 'undefined') { try { SUMMARY.begin(); } catch (_) {} }
    show('wl-q');
    renderQ();
  }

  function renderQ() {
    const q = Q.items[Q.i];
    Q.answered = false;
    lockUntil = Date.now() + 350;
    document.getElementById('wl-q-crumb').textContent = Q.title;
    document.getElementById('wl-q-kind').textContent = KIND_LABEL[q.kind] || '';
    document.getElementById('wl-q-count').textContent = `${Q.i + 1} / ${Q.items.length}`;
    document.getElementById('wl-q-bar').style.width = `${Math.round(Q.i / Q.items.length * 100)}%`;
    const fb = document.getElementById('wl-q-fb'); fb.className = 'feedback';
    document.getElementById('wl-q-next').classList.add('hidden');
    const body = document.getElementById('wl-q-body');

    if (q.kind === 'match') { renderMatch(q, body); return; }

    let html = q.html;
    if (q.options) {
      html += `<div class="answers">${q.options.map((o, i) => `<button class="ans" data-i="${i}" onclick="WordLab.choose(${i})">${esc(o.t)}</button>`).join('')}</div>`;
    } else {
      html += `<div class="typedrow"><input type="text" id="wl-typed" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Type the word"
                 onkeydown="if(event.key==='Enter'){event.preventDefault();WordLab.enterTyped();}"><button class="btn gold" onclick="WordLab.submitTyped()">Check</button></div>`;
    }
    if (q.say && Q.mode !== 'assess') html += `<div style="margin-top:8px"><button class="btn ghost" onclick="WordLab.cantHear()">🔇 Can't hear it</button></div>`;
    if (Q.mode === 'assess') html += `<div style="margin-top:10px"><button class="btn ghost block" onclick="WordLab.dontKnow()">🤷 I don't know this one</button></div>`;
    body.innerHTML = html;
    const t = document.getElementById('wl-typed'); if (t) t.focus();
    if (q.say) setTimeout(() => say(q.say), 250);
  }

  function choose(i) {
    if (!Q || Q.over || Q.answered || Date.now() < lockUntil) return;
    const q = Q.items[Q.i];
    const right = !!q.options[i].ok;
    document.querySelectorAll('#wl-q-body .ans').forEach((b, j) => {
      b.disabled = true;
      if (q.options[j].ok && Q.feedback !== 'none') b.classList.add('correct');
      else if (j === i && !right) b.classList.add(Q.feedback === 'none' ? 'dim' : 'wrong');
      else b.classList.add('dim');
    });
    answer(right, q.options[i].t);
  }
  const normTyped = (x) => String(x).normalize('NFKC').toLowerCase().replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, '-').replace(/[\s-]+/g, '').replace(/[.!?,"“”]+$/, '').trim();
  function submitTyped() {
    if (!Q || Q.over || Q.answered || Date.now() < lockUntil) return;
    const q = Q.items[Q.i];
    const el = document.getElementById('wl-typed');
    const got = String(el.value || '').trim().replace(/[.!?,]+$/, '');
    if (!got) { el.focus(); return; }
    const right = normTyped(got) === normTyped(q.typed);
    // A real word that isn't this one: the other way to unscramble the letters
    // (silent/listen), or a word that sounds the same (sea/see). Not wrong -
    // just not the word meant. One more try, nothing recorded.
    const sameLetters = (a, b) => normTyped(a).split('').sort().join('') === normTyped(b).split('').sort().join('');
    if (!right && !q.retried && isReal(got) && ((q.anagram && sameLetters(got, q.typed)) || q.soundAlike)) {
      q.retried = true;
      const fb = document.getElementById('wl-q-fb');
      fb.className = 'feedback show';
      document.getElementById('wl-q-verdict').textContent = `"${got}" is a real word, but not the one we mean.`;
      document.getElementById('wl-q-why').innerHTML = `Look at the meaning again: <i>${esc(q.e.def)}</i>. Try once more.`;
      el.value = ''; el.focus();
      return;
    }
    el.disabled = true;
    answer(right, got);
  }
  // Enter: check the answer, or go on once it has been checked.
  function enterTyped() { if (Q && Q.answered) next(); else submitTyped(); }
  function dontKnow() { if (!Q || Q.over || Q.answered || Date.now() < lockUntil) return; answer(false, null, true); }
  // The sound didn't play: the same word, asked a way that needs no sound.
  function cantHear() {
    if (!Q || Q.over || Q.answered) return;
    const q = Q.items[Q.i];
    Q.items[Q.i] = makeQuestion(q.e, q.kind === 'listen' ? 'scramble' : 'meaning');
    renderQ();
  }

  function answer(right, given, skipped) {
    Q.answered = true;
    const q = Q.items[Q.i];
    Q.results.push({ e: q.e, kind: q.kind, right, given, skipped: !!skipped, retention: !!q.retention });
    if (Q.record !== false) applyResult(q.e, right);
    const fb = document.getElementById('wl-q-fb');
    if (Q.feedback === 'none') {
      next();
      return;
    }
    if (typeof q.typed === 'string') { const t = document.getElementById('wl-typed'); if (t) t.disabled = true; }
    fb.className = 'feedback show ' + (right ? 'good' : 'bad');
    document.getElementById('wl-q-verdict').textContent = right ? '✓ Correct!' : (skipped ? 'Here it is:' : '✗ Not quite.');
    const e = q.e;
    const ex = esc(e.ex).replace(wordRx(e.w), (m, a, b) => `${a}<b>${b}</b>`);
    let why = `<b>${esc(e.w)}</b> <i>(${esc(e.pos)})</i> — ${esc(e.def)}.<br><i>“${ex}”</i> ${speakBtn(e.w)}`;
    if (!right && q.typed && given) why = `You typed <b>${esc(given)}</b>; the word is <b>${esc(e.w)}</b>.<br>` + why;
    if (Q.feedback === 'brief') why = right ? '' : `The answer was <b>${esc(q.typed || (q.options || []).find(o => o.ok)?.t || e.w)}</b>.`;
    document.getElementById('wl-q-why').innerHTML = why;
    document.getElementById('wl-q-next').classList.remove('hidden');
  }

  function next() {
    if (!Q || Q.over || !Q.answered) return;
    if (Q.i + 1 < Q.items.length) { Q.i++; renderQ(); return; }
    finish();
  }
  function finish() {
    flush();
    const right = Q.results.filter(r => r.right).length;
    const total = Q.results.length;
    if (Q.summary !== false && typeof SUMMARY !== 'undefined') {
      try { SUMMARY.report({ score: total ? Math.round(right / total * 100) : 0, correct: right, total }); } catch (_) {}
    }
    const done = Q.onDone; Q = Object.assign(Q, { over: true });
    done && done(Q.results);
  }
  // ✕ End. Practice keeps what was done. An Evaluation or Assessment left
  // part-way is dropped unscored: quitting must never pass a level.
  function endSession() {
    if (Q && !Q.over && Q.mode === 'practice' && Q.results.length) { finish(); return; }
    if (Q && !Q.over && Q.mode === 'flash' && Q.results.length) { WordLab._flashEnd(); return; }
    if (Q && !Q.over && Q.summary !== false && typeof SUMMARY !== 'undefined' && Q.results.length) {
      try { const r = Q.results.filter(x => x.right).length; SUMMARY.report({ score: Math.round(r / Q.results.length * 100), correct: r, total: Q.results.length }); } catch (_) {}
    }
    flush();
    Q = null;
    home();
  }

  /* ---- matching round: four words, four meanings ---- */
  function renderMatch(q, body) {
    const left = shuffle(q.words), right = shuffle(q.words);
    q.state = { sel: null, done: new Set(), misses: new Set() };
    body.innerHTML = `<div class="qprompt">Match each word to its meaning.</div>
      <div class="wl-match"><div class="col">${left.map(e => `<button class="ans" data-k="${esc(e.k)}" data-side="w" onclick="WordLab.matchTap(this)">${esc(e.w)}</button>`).join('')}</div>
      <div class="col">${right.map(e => `<button class="ans" data-k="${esc(e.k)}" data-side="d" onclick="WordLab.matchTap(this)">${esc(e.def)}</button>`).join('')}</div></div>`;
  }
  function matchTap(btn) {
    if (!Q || Q.over || Date.now() < lockUntil) return;
    const q = Q.items[Q.i], st = q.state;
    if (Q.answered || btn.classList.contains('done')) return;
    if (!st.sel || st.sel.dataset.side === btn.dataset.side) {
      document.querySelectorAll('#wl-q-body .ans.sel').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel'); st.sel = btn; return;
    }
    const a = st.sel, k = btn.dataset.k;
    st.sel = null; a.classList.remove('sel');
    if (a.dataset.k === k) {
      document.querySelectorAll(`#wl-q-body .ans[data-k="${CSS.escape(k)}"]`).forEach(b => b.classList.add('done'));
      st.done.add(k);
      if (st.done.size === q.words.length) {
        Q.answered = true;
        q.words.forEach(e => {
          const right = !st.misses.has(e.k);
          Q.results.push({ e, kind: 'match', right });
          if (Q.record !== false) applyResult(e, right);
        });
        const fb = document.getElementById('wl-q-fb');
        const missed = q.words.filter(e => st.misses.has(e.k));
        fb.className = 'feedback show ' + (missed.length ? 'bad' : 'good');
        document.getElementById('wl-q-verdict').textContent = missed.length ? 'All matched — a few took more than one try.' : '✓ All matched first time!';
        document.getElementById('wl-q-why').innerHTML = missed.map(e => `<b>${esc(e.w)}</b> — ${esc(e.def)}`).join('<br>');
        document.getElementById('wl-q-next').classList.remove('hidden');
      }
    } else {
      st.misses.add(a.dataset.side === 'w' ? a.dataset.k : k);
      [a, btn].forEach(b => { b.classList.add('wrong'); setTimeout(() => b.classList.remove('wrong'), 500); });
    }
  }

  /* ---------------------------------------------------------------------
     Practice
     --------------------------------------------------------------------- */
  async function openPractice() {
    build();
    if (!S.loaded) await loadState();
    const cur = current();
    if (!cur.grade) { toast('Take the Assessment, or choose a level in Learning, first.'); openLearning(); return; }
    await loadGrade(cur.grade);
    show('wl-practice');
    const due = dueWords();
    document.getElementById('wl-practice-sub').textContent = `${gradeLabel(cur.grade)} · Level ${cur.level}`;
    document.getElementById('wl-due-d').textContent = due.length
      ? `${due.length} word${due.length === 1 ? '' : 's'} due today.` : 'Nothing is due right now. 🎉';
  }

  function dueWords() {
    return Object.entries(S.words).filter(([, m]) => isDue(m))
      .sort((a, b) => a[1].due - b[1].due)
      .map(([k, m]) => findWord(k, m.grade)).filter(Boolean);
  }

  // A saved level past the end of a grade (the bank changed) means its last level.
  function clampLevel(cur) {
    const n = levelCount(cur.grade);
    return n ? Object.assign({}, cur, { level: Math.max(1, Math.min(cur.level || 1, n)) }) : cur;
  }
  async function startPractice(focus, at) {
    build();
    if (!S.loaded) await loadState();
    let cur = at || current();
    if (!cur.grade) { openLearning(); return; }
    await Promise.all([loadGrade(cur.grade), loadReal()]);
    cur = clampLevel(cur);
    const due = dueWords();
    let words;
    if (focus === 'review') {
      if (!due.length) { toast('Nothing is due for review right now.'); return; }
      words = due.slice(0, 15);
    } else {
      const lvl = levelWords(cur.grade, cur.level);
      // Not-yet-mastered first, then the rest; a few due words from elsewhere.
      const notYet = shuffle(lvl.filter(e => statusOf(e) !== 'mastered'));
      const rest = shuffle(lvl.filter(e => statusOf(e) === 'mastered'));
      const fromElsewhere = due.filter(e => !(e.grade === cur.grade && e.level === cur.level)).slice(0, 4);
      words = [...fromElsewhere, ...notYet, ...rest].slice(0, 14);
    }
    const items = words.map(e => makeQuestion(e, kindFor(e, focus === 'mix' || focus === 'review' ? null : focus)));
    // One matching round in mixed/meaning practice when there are four words for it.
    if ((focus === 'mix' || focus === 'meaning') && words.length >= 6) {
      const four = shuffle(words).slice(0, 4);
      items.splice(Math.min(5, items.length), 0, { kind: 'match', words: four, e: four[0] });
      // those four words are practised in the round; drop their single questions
      for (let i = items.length - 1; i >= 0; i--) if (items[i].kind !== 'match' && four.includes(items[i].e)) items.splice(i, 1);
    }
    runSession({
      title: focus === 'review' ? 'Review' : `${gradeShort(cur.grade)} · Level ${cur.level}`,
      mode: 'practice', items: shuffleKeepMatch(items), feedback: 'full',
      onDone: (results) => showResults('Practice done', results, practiceNote(results)),
    });
  }
  function shuffleKeepMatch(items) {
    const m = items.filter(i => i.kind === 'match');
    const rest = shuffle(items.filter(i => i.kind !== 'match'));
    m.forEach(x => rest.splice(Math.min(4, rest.length), 0, x));
    return rest;
  }
  function practiceNote(results) {
    const missed = [...new Set(results.filter(r => !r.right).map(r => r.e.w))];
    return missed.length
      ? `<p class="muted">These will come back in your next practice until they stick:</p><div class="chips">${missed.map(w => `<span class="chip">${esc(w)}</span>`).join('')}</div>`
      : `<p class="center">Every one right. 🌟</p>`;
  }

  /* ---- flashcards: self-rated ---- */
  async function startFlashcards() {
    if (!S.loaded) await loadState();
    let cur = current();
    if (!cur.grade) { openLearning(); return; }
    await loadGrade(cur.grade);
    cur = clampLevel(cur);
    const due = dueWords();
    const lvl = levelWords(cur.grade, cur.level);
    const words = [...due.slice(0, 6), ...shuffle(lvl.filter(e => !due.includes(e)))].slice(0, 15);
    let i = 0, flipped = false;
    const results = [];
    if (typeof SUMMARY !== 'undefined') { try { SUMMARY.begin(); } catch (_) {} }
    Q = { title: 'Flashcards', mode: 'flash', items: words, results, over: false, onDone: null };
    show('wl-q');
    const draw = () => {
      const e = words[i];
      document.getElementById('wl-q-crumb').textContent = 'Flashcards';
      document.getElementById('wl-q-kind').textContent = 'Flashcard';
      document.getElementById('wl-q-count').textContent = `${i + 1} / ${words.length}`;
      document.getElementById('wl-q-bar').style.width = `${Math.round(i / words.length * 100)}%`;
      document.getElementById('wl-q-fb').className = 'feedback';
      document.getElementById('wl-q-next').classList.add('hidden');
      const ex = esc(e.ex).replace(wordRx(e.w), (m, a, b) => `${a}<b>${b}</b>`);
      document.getElementById('wl-q-body').innerHTML = flipped
        ? `<div class="wl-flash card"><div class="hw">${esc(e.w)}</div><div class="muted"><i>${esc(e.pos)}</i> · ${esc(e.say)}</div>
             <div style="margin-top:10px;font-size:1.1rem">${esc(e.def)}</div><div class="ex" style="margin-top:6px;font-style:italic">“${ex}”</div></div>
           <div class="row" style="margin-top:12px"><button class="btn ghost" style="flex:1" onclick="WordLab._flash(false)">🤔 Not yet</button>
             <button class="btn gold" style="flex:1" onclick="WordLab._flash(true)">✓ I knew it</button></div>`
        : `<div class="wl-flash card" onclick="WordLab._flip()"><div class="hw">${esc(e.w)}</div>${speakBtn(e.w)}
             <div class="muted" style="margin-top:12px">Think of what it means, then tap to flip.</div></div>`;
      if (!flipped) say(e.w);
    };
    WordLab._flip = () => { flipped = true; draw(); };
    let flashLock = 0;
    const flashEnd = () => {
      flush();
      if (typeof SUMMARY !== 'undefined' && results.length) { try { SUMMARY.report({ score: Math.round(results.filter(r => r.right).length / results.length * 100), correct: results.filter(r => r.right).length, total: results.length }); } catch (_) {} }
      Q.over = true;
      showResults('Flashcards done', results, practiceNote(results));
    };
    WordLab._flashEnd = flashEnd;
    WordLab._flash = (knew) => {
      if (!Q || Q.over || Date.now() < flashLock) return;
      flashLock = Date.now() + 350;
      const e = words[i];
      results.push({ e, kind: 'flash', right: knew });
      // Self-rated: it can't take a word past box 2 on its own.
      applyResult(e, knew, true);
      flipped = false;
      if (++i < words.length) draw();
      else flashEnd();
    };
    if (!words.length) { toast('No words to show yet.'); home(); return; }
    draw();
  }

  /* ---------------------------------------------------------------------
     Assessment: placement
     --------------------------------------------------------------------- */
  // Eight questions a grade - meaning, spelling, words in context - drawn
  // from across the whole grade. 6 of 8 passes it (four questions let a
  // student who knows 80% of a grade fail it nearly one time in five). Start a grade below
  // the student's own, climb while passing, step down while failing. They are
  // placed at the first grade they do not pass (the highest passed, plus one).
  async function startAssessment() {
    build();
    if (!S.loaded) await loadState();
    show('wl-results');
    document.getElementById('wl-res-title').textContent = '📝 Assessment';
    document.getElementById('wl-res-score').textContent = '';
    document.getElementById('wl-res-sub').textContent = '';
    document.getElementById('wl-res-body').innerHTML = `
      <p>This finds the right level for you. You'll see words from easier and harder grades — it's fine not to know some.
         Choose <b>I don't know</b> rather than guessing.</p>
      <label class="field">What grade are you in?</label>
      <select id="wl-my-grade">${GRADES.map(g => `<option value="${g}" ${g === ((S.profile && S.profile.placement_grade) || '4') ? 'selected' : ''}>${esc(gradeLabel(g))}</option>`).join('')}</select>
      <div class="spacer"></div>
      <button class="btn gold block" onclick="WordLab._beginAssessment()">Start</button>`;
  }
  async function beginAssessment() {
    const mine = GRADES.indexOf(document.getElementById('wl-my-grade').value);
    const A = { scores: {}, tested: [], start: Math.max(0, mine - 1) };
    if (typeof SUMMARY !== 'undefined') { try { SUMMARY.begin(); } catch (_) {} }
    let gi = A.start, direction = 0, steps = 0;
    const step = async () => {
      const g = GRADES[gi];
      try { await loadGrade(g); } catch (e) { toast(e.message); home(); return; }
      await loadReal();
      const pool = shuffle(BANK[g]).slice(0, 8);
      const kinds = ['meaning', 'spellpick', 'blank', 'meaning', 'word', 'blank', 'spellpick', 'meaning'];
      const items = kinds.map((k, i) => makeQuestion(pool[i % pool.length], k));
      runSession({
        title: `Assessment · ${gradeLabel(g)}`, mode: 'assess', items, feedback: 'none', record: false, summary: false,
        onDone: (res) => {
          const right = res.filter(r => r.right).length;
          A.scores[g] = right; A.tested.push(g); steps++;
          const passed = right >= Math.ceil(items.length * 0.75);
          let nextGi = null;
          if (direction >= 0 && passed) { direction = 1; if (gi < GRADES.length - 1) nextGi = gi + 1; }
          else if (direction <= 0 && !passed) { direction = -1; if (gi > 0) nextGi = gi - 1; }
          // Turned round: a pass after failing, or a fail after passing, ends it.
          if (nextGi === null || steps >= GRADES.length || A.scores[GRADES[nextGi]] !== undefined) return placeAssessment(A);
          gi = nextGi; step();
        },
      });
    };
    step();
  }
  async function placeAssessment(A) {
    const passed = GRADES.filter(g => A.scores[g] >= 6);
    const highest = passed.length ? Math.max(...passed.map(g => GRADES.indexOf(g))) : -1;
    const place = GRADES[Math.min(highest + 1, GRADES.length - 1)];
    const answered = Object.values(A.scores).reduce((t, n) => t + n, 0);
    const total = A.tested.length * 8;
    if (typeof SUMMARY !== 'undefined') { try { SUMMARY.report({ score: total ? Math.round(answered / total * 100) : 0, correct: answered, total }); } catch (_) {} }
    S.profile = Object.assign({}, S.profile || {}, { placement_grade: place, current_grade: place, current_level: 1, placed_at: new Date().toISOString() });
    saveLocal();
    const res = await ask('VOCAB_PLACEMENT', { grade: place, detail: A.scores });
    await loadGrade(place).catch(() => null);
    show('wl-results');
    document.getElementById('wl-res-title').textContent = '📝 Your starting level';
    document.getElementById('wl-res-score').textContent = gradeShort(place);
    document.getElementById('wl-res-sub').textContent = `${gradeLabel(place)}, Level 1`;
    document.getElementById('wl-res-body').innerHTML = `
      <div>${A.tested.slice().sort((a, b) => GRADES.indexOf(a) - GRADES.indexOf(b)).map(g =>
        `<div class="skillrow"><span>${esc(gradeLabel(g))}</span><span>${A.scores[g]} / 8 ${A.scores[g] >= 6 ? '✓' : ''}</span></div>`).join('')}</div>
      <p class="muted" style="margin-top:10px">Next: open <b>Learning</b> to meet your first 12 words, then <b>Practice</b>.</p>
      ${inHost && (!res || !res.ok) ? '<div class="wl-note">Your level could not be saved just now. Try the Assessment again later.</div>' : ''}`;
  }

  /* ---------------------------------------------------------------------
     Evaluation: the level test
     --------------------------------------------------------------------- */
  async function startEvaluation() {
    build();
    if (!S.loaded) await loadState();
    let cur = current();
    if (!cur.grade) { toast('Take the Assessment first, so we know which level to test.'); return; }
    await Promise.all([loadGrade(cur.grade), loadReal()]);
    cur = clampLevel(cur);
    const words = shuffle(levelWords(cur.grade, cur.level));
    // One question a word, a spread of kinds, several asking the student to
    // produce the word rather than spot it - except in K and 1, where it is
    // all choosing: five-year-olds are not tested on their typing.
    const young = cur.grade === 'K' || cur.grade === '1';
    const kinds = young
      ? ['hear', 'blank', 'meaning', 'word', 'hear', 'blank', 'meaning', 'word', 'spellpick', 'blank', 'meaning', 'hear']
      : ['listen', 'blank', 'meaning', 'usage', 'scramble', 'word', 'listen', 'blank', 'meaning', 'usage', 'spellpick', 'synonym'];
    const items = words.map((e, i) => makeQuestion(e, kinds[i % kinds.length]));
    // Retention: a few mastered words from earlier levels that are due. They
    // move the schedule but are not part of the pass mark.
    const back = dueWords().filter(e => memOf(e) && memOf(e).mastered && !words.includes(e)).slice(0, 3);
    back.forEach(e => { const q = makeQuestion(e, 'blank'); q.retention = true; items.push(q); });
    runSession({
      title: `Evaluation · ${gradeShort(cur.grade)} · Level ${cur.level}`, mode: 'eval', items: shuffle(items), feedback: 'brief',
      onDone: (results) => evaluate(cur, results, words.length),
    });
  }
  async function evaluate(cur, results, need) {
    const scored = results.filter(r => !r.retention);
    const right = scored.filter(r => r.right).length;
    // Out of every word on the level, never just the ones answered.
    const out = Math.max(need || 0, scored.length);
    const pct = out ? Math.round(right / out * 100) : 0;
    const passed = pct >= PASS_PCT;
    let note = '';
    if (passed) {
      let ng = cur.grade, nl = cur.level + 1;
      if (nl > levelCount(cur.grade)) {
        const gi = GRADES.indexOf(cur.grade);
        if (gi < GRADES.length - 1) { ng = GRADES[gi + 1]; nl = 1; } else { nl = cur.level; }
      }
      const finishedAll = ng === cur.grade && nl === cur.level;
      const already = ((S.profile && S.profile.levels_passed) || []).some(x => x.grade === cur.grade && x.level === cur.level);
      const passedList = ((S.profile && S.profile.levels_passed) || []);
      S.profile = Object.assign({}, S.profile || {}, { current_grade: ng, current_level: nl,
        levels_passed: (finishedAll && passedList.some(x => x.grade === cur.grade && x.level === cur.level)) ? passedList : passedList.concat([{ grade: cur.grade, level: cur.level, score: pct }]) });
      saveLocal();
      // Passing the very last level again adds nothing to "levels passed".
      const r = finishedAll && already ? { ok: true } : await ask('VOCAB_PASS_LEVEL', { grade: cur.grade, level: cur.level, score: pct, nextGrade: ng, nextLevel: nl });
      await loadGrade(ng).catch(() => null);
      note = finishedAll
        ? `<p class="center">You've passed the last level in Word Lab. 🏆</p>`
        : `<p class="center">On to <b>${esc(gradeLabel(ng))}, Level ${nl}</b>.</p>`;
      if (inHost && (!r || !r.ok)) note += '<div class="wl-note">Your pass could not be saved just now. Take the Evaluation again later to record it.</div>';
    } else {
      const missed = [...new Set(scored.filter(r => !r.right).map(r => r.e.w))];
      note = `<p>You need ${PASS_PCT}% to pass. Practise these, then try again:</p><div class="chips">${missed.map(w => `<span class="chip">${esc(w)}</span>`).join('')}</div>`;
    }
    const back = results.filter(r => r.retention);
    if (back.length) note += `<p class="muted" style="margin-top:10px">Memory check on earlier words: ${back.filter(r => r.right).length} of ${back.length} still remembered.</p>`;
    showResults(passed ? '🏅 Level passed!' : 'Not passed yet', results.filter(r => !r.retention), note, `${pct}%`);
  }

  /* ---------------------------------------------------------------------
     Results
     --------------------------------------------------------------------- */
  function showResults(title, results, note, big) {
    show('wl-results');
    const right = results.filter(r => r.right).length;
    document.getElementById('wl-res-title').textContent = title;
    document.getElementById('wl-res-score').textContent = big || `${right}/${results.length}`;
    document.getElementById('wl-res-sub').textContent = big ? `${right} of ${results.length} right` : 'right';
    document.getElementById('wl-res-body').innerHTML = note || '';
  }

  function home() { build(); flush(); renderHome(); show('wl-home'); }

  function say(text) { speak(text); }

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('wl-toast');
    if (!t) {
      t = document.createElement('div'); t.id = 'wl-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink-800);color:var(--paper-50);padding:10px 16px;border-radius:10px;z-index:99;font-size:.95rem;max-width:90vw;text-align:center';
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3200);
  }

  window.WordLab = {
    open, home, say, showWord,
    openLearning, learnGradeChanged, renderLearning, makeMyLevel, practiceThisLevel,
    openPractice, startPractice, startFlashcards,
    startAssessment, _beginAssessment: beginAssessment,
    startEvaluation,
    choose, submitTyped, enterTyped, dontKnow, cantHear, next, endSession, matchTap,
    // for tests
    _q: () => Q,
    _internals: { makeQuestion, misspellings, misuse, blankOut, applyResult, S, BANK, loadGrade, levelWords, levelCount, kindFor, wordRx, GRADES, LEVEL_SIZE, related, scrambleOf, loadReal, altSpelling },
  };
})();
