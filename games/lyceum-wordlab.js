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
  const BANK_VERSION = '1';

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
    BANK[g] = (j.words || []).map((w, i) => Object.assign({}, w, {
      grade: g, idx: i, level: Math.floor(i / LEVEL_SIZE) + 1, k: key(w.w),
    }));
    return BANK[g];
  }
  const levelCount = (g) => Math.ceil((BANK[g] || []).length / LEVEL_SIZE);
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
  let queue = [];

  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ owner: LS_KEY, profile: S.profile, words: S.words })); } catch (_) {}
  }
  function loadLocal() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (j && j.owner === LS_KEY) { S.profile = j.profile || null; S.words = j.words || {}; }
    } catch (_) {}
  }

  async function loadState() {
    loadLocal();
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

  // Same rule as rt_vocab_record, so the screen moves at once.
  function applyResult(e, right) {
    const now = Date.now();
    const r = S.words[e.k] || { grade: e.grade, box: 0, due: now, seen: 0, right: 0, wrong: 0, mastered: false };
    if (right) {
      if (r.box === 0 || r.due <= now) { r.box = Math.min(r.box + 1, 5); r.due = now + BOX_DAYS[r.box] * DAY; }
      r.right++;
    } else { r.box = 1; r.due = now; r.wrong++; }
    r.seen++; r.grade = e.grade; r.mastered = r.box >= 4;
    S.words[e.k] = r;
    queue.push({ word: e.k, grade: e.grade, right: !!right });
    saveLocal();
    if (queue.length >= 6) flush();
  }
  async function flush() {
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    const res = await ask('VOCAB_RECORD', { results: batch });
    if (!res || !res.ok) {
      // Not saved (offline, or not in a host): keep them for the next try.
      if (inHost) queue = batch.concat(queue).slice(-200);
    }
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
  const canSpeak = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  let voice = null;
  function pickVoice() {
    if (!canSpeak) return;
    const vs = speechSynthesis.getVoices() || [];
    voice = vs.find(v => /en[-_]US/i.test(v.lang) && /natural|google|samantha|aria|jenny/i.test(v.name))
         || vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  if (canSpeak) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text, rate) {
    if (!canSpeak || !text) return;
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
      <div class="mode assess" onclick="WordLab.startAssessment()"><div class="ic">📝</div><h3>Assessment</h3><p>Find your starting level: meanings, spelling and words in sentences.</p></div>
      <div class="mode learn" onclick="WordLab.openLearning()"><div class="ic">📖</div><h3>Learning</h3><p>See your level's words: what they mean, how to say them, how to use them.</p></div>
      <div class="mode practice" onclick="WordLab.openPractice()"><div class="ic">🎯</div><h3>Practice</h3><p>Games and flashcards. Words you miss come back until they stick.</p></div>
      <div class="mode evaluate" onclick="WordLab.startEvaluation()"><div class="ic">🏅</div><h3>Evaluation</h3><p>The level test. Score ${PASS_PCT}% to move up a level.</p></div>
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
      <div class="feedback" id="wl-q-fb"><div class="verdict" id="wl-q-verdict"></div><div class="why" id="wl-q-why"></div></div>
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
        <div class="chips">${trouble.map(([k]) => `<span class="chip" onclick="WordLab.showWord('${esc(k)}')">${esc(k)}</span>`).join('')}</div>`;
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
  // Other words to offer beside the right one: same grade, same part of
  // speech when there are enough, never the word itself or a twin of it.
  function others(e, n, test) {
    const pool = (BANK[e.grade] || []).filter(x => x.k !== e.k && (!test || test(x)));
    const same = pool.filter(x => x.pos === e.pos);
    const src = same.length >= n ? same : pool;
    const out = [], seenText = new Set();
    for (const x of shuffle(src)) {
      if (out.length >= n) break;
      out.push(x);
    }
    return out;
  }
  function blankOut(e) {
    return esc(e.ex).replace(wordRx(e.w), (m, a) => `${a}<span class="wl-blank">&nbsp;</span>`);
  }
  // A sentence that uses `e` where another word belongs: the other word's own
  // example with its headword swapped for this one.
  function misuse(e, other) {
    return other.ex.replace(wordRx(other.w), (m, a, b) => {
      const w = /^[A-Z]/.test(b) ? e.w.charAt(0).toUpperCase() + e.w.slice(1) : e.w;
      return a + w;
    });
  }
  function misspellings(w) {
    const out = new Set();
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
    for (let n = 0; n < 60 && out.size < 3; n++) {
      const v = tries[n % tries.length]();
      if (v && v !== w && /^[a-z'-]+$/i.test(v)) out.add(v);
    }
    return [...out].slice(0, 3);
  }

  const KIND_LABEL = {
    meaning: 'Meaning', word: 'Which word?', blank: 'Fill the blank', usage: 'Use it right', synonym: 'Same meaning',
    spellpick: 'Spelling', listen: 'Listen & spell', scramble: 'Unscramble', hear: 'Listening', match: 'Matching',
  };

  // Builds one question for a word. Returns { kind, e, html, options? , typed? , say? }.
  function makeQuestion(e, kind) {
    const q = { kind, e };
    if (kind === 'synonym' && !(e.syn && e.syn.length)) kind = q.kind = 'meaning';
    if ((kind === 'listen' || kind === 'hear') && !canSpeak) kind = q.kind = (kind === 'listen' ? 'scramble' : 'meaning');
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
        const wrong = others(e, 3, x => wordRx(x.w).test(x.ex)).map(x => ({ t: misuse(e, x) }));
        q.html = `<div class="qprompt">Which sentence uses <b>${esc(e.w)}</b> correctly?</div>`;
        q.options = shuffle([{ t: e.ex, ok: true }, ...wrong]);
        break;
      }
      case 'synonym': {
        const syns = new Set(e.syn.map(key));
        q.html = `<div class="qprompt">Which word means about the same as <b>${esc(e.w)}</b>?</div>`;
        q.options = shuffle([{ t: e.syn[0], ok: true }, ...others(e, 3, x => !syns.has(x.k)).map(x => ({ t: x.w }))]);
        break;
      }
      case 'spellpick': {
        const bad = misspellings(e.w);
        if (bad.length < 2) return makeQuestion(e, 'scramble');
        q.html = `<div class="qprompt">Which is spelled correctly? ${speakBtn(e.w)}</div><div class="wl-hint">It means: ${esc(e.def)}</div>`;
        q.options = shuffle([{ t: e.w, ok: true }, ...bad.map(t => ({ t }))]);
        break;
      }
      case 'listen': {
        q.html = `<div class="qprompt">Listen, then type the word. ${speakBtn(e.w, 'Play')}</div><div class="wl-hint">It means: ${esc(e.def)}</div>`;
        q.typed = e.w; q.say = e.w;
        break;
      }
      case 'scramble': {
        let s = e.w;
        for (let i = 0; i < 8 && s === e.w; i++) s = shuffle([...e.w]).join('');
        q.html = `<div class="qprompt">Unscramble the word.</div><div class="wl-scramble">${esc(s.toUpperCase())}</div><div class="wl-hint">It means: ${esc(e.def)}</div>`;
        q.typed = e.w;
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

  function runSession(opts) {
    Q = Object.assign({ i: 0, results: [], answered: false }, opts);
    if (Q.summary !== false && typeof SUMMARY !== 'undefined') { try { SUMMARY.begin(); } catch (_) {} }
    show('wl-q');
    renderQ();
  }

  function renderQ() {
    const q = Q.items[Q.i];
    Q.answered = false;
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
      html += `<div class="typedrow"><input type="text" id="wl-typed" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type the word"
                 onkeydown="if(event.key==='Enter')WordLab.submitTyped()"><button class="btn gold" onclick="WordLab.submitTyped()">Check</button></div>`;
    }
    if (Q.mode === 'assess') html += `<div style="margin-top:10px"><button class="btn ghost block" onclick="WordLab.dontKnow()">🤷 I don't know this one</button></div>`;
    body.innerHTML = html;
    const t = document.getElementById('wl-typed'); if (t) t.focus();
    if (q.say) setTimeout(() => say(q.say), 250);
  }

  function choose(i) {
    if (Q.answered) return;
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
  function submitTyped() {
    if (Q.answered) return;
    const q = Q.items[Q.i];
    const el = document.getElementById('wl-typed');
    const got = String(el.value || '').trim().replace(/[.!?,]+$/, '');
    if (!got) { el.focus(); return; }
    el.disabled = true;
    answer(got.toLowerCase() === q.typed.toLowerCase(), got);
  }
  function dontKnow() { if (!Q.answered) answer(false, null, true); }

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
    fb.className = 'feedback show ' + (right ? 'good' : 'bad');
    document.getElementById('wl-q-verdict').textContent = right ? '✓ Correct!' : (skipped ? 'Here it is:' : '✗ Not quite.');
    const e = q.e;
    const ex = esc(e.ex).replace(wordRx(e.w), (m, a, b) => `${a}<b>${b}</b>`);
    let why = `<b>${esc(e.w)}</b> <i>(${esc(e.pos)})</i> — ${esc(e.def)}.<br><i>“${ex}”</i> ${speakBtn(e.w)}`;
    if (!right && q.typed && given) why = `You typed <b>${esc(given)}</b>; it's spelled <b>${esc(e.w)}</b>.<br>` + why;
    if (Q.feedback === 'brief') why = right ? '' : `The answer was <b>${esc(q.typed || (q.options || []).find(o => o.ok)?.t || e.w)}</b>.`;
    document.getElementById('wl-q-why').innerHTML = why;
    document.getElementById('wl-q-next').classList.remove('hidden');
  }

  function next() {
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
  function endSession() {
    if (Q && !Q.over && Q.results.length && Q.mode !== 'assess') { finish(); return; }
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

  async function startPractice(focus, at) {
    build();
    if (!S.loaded) await loadState();
    const cur = at || current();
    if (!cur.grade) { openLearning(); return; }
    await loadGrade(cur.grade);
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
    const cur = current();
    await loadGrade(cur.grade);
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
    WordLab._flash = (knew) => {
      const e = words[i];
      results.push({ e, kind: 'flash', right: knew });
      applyResult(e, knew);
      flipped = false;
      if (++i < words.length) draw();
      else {
        flush();
        if (typeof SUMMARY !== 'undefined') { try { SUMMARY.report({ score: Math.round(results.filter(r => r.right).length / results.length * 100), correct: results.filter(r => r.right).length, total: results.length }); } catch (_) {} }
        Q.over = true;
        showResults('Flashcards done', results, practiceNote(results));
      }
    };
    if (!words.length) { toast('No words to show yet.'); home(); return; }
    draw();
  }

  /* ---------------------------------------------------------------------
     Assessment: placement
     --------------------------------------------------------------------- */
  // Four questions a grade - meaning, spelling, a word in context, meaning -
  // drawn from across the whole grade. 3 of 4 passes it. Start a grade below
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
      <select id="wl-my-grade">${GRADES.map(g => `<option value="${g}" ${g === '4' ? 'selected' : ''}>${esc(gradeLabel(g))}</option>`).join('')}</select>
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
      const pool = shuffle(BANK[g]).slice(0, 8);
      const kinds = ['meaning', 'spellpick', 'blank', 'meaning'];
      const items = kinds.map((k, i) => makeQuestion(pool[i], k));
      runSession({
        title: `Assessment · ${gradeLabel(g)}`, mode: 'assess', items, feedback: 'none', record: false, summary: false,
        onDone: (res) => {
          const right = res.filter(r => r.right).length;
          A.scores[g] = right; A.tested.push(g); steps++;
          const passed = right >= 3;
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
    const passed = GRADES.filter(g => A.scores[g] >= 3);
    const highest = passed.length ? Math.max(...passed.map(g => GRADES.indexOf(g))) : -1;
    const place = GRADES[Math.min(highest + 1, GRADES.length - 1)];
    const answered = Object.values(A.scores).reduce((t, n) => t + n, 0);
    const total = A.tested.length * 4;
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
        `<div class="skillrow"><span>${esc(gradeLabel(g))}</span><span>${A.scores[g]} / 4 ${A.scores[g] >= 3 ? '✓' : ''}</span></div>`).join('')}</div>
      <p class="muted" style="margin-top:10px">Next: open <b>Learning</b> to meet your first 12 words, then <b>Practice</b>.</p>
      ${inHost && (!res || !res.ok) ? '<div class="wl-note">Your level could not be saved just now. Try the Assessment again later.</div>' : ''}`;
  }

  /* ---------------------------------------------------------------------
     Evaluation: the level test
     --------------------------------------------------------------------- */
  async function startEvaluation() {
    build();
    if (!S.loaded) await loadState();
    const cur = current();
    if (!cur.grade) { toast('Take the Assessment first, so we know which level to test.'); return; }
    await loadGrade(cur.grade);
    const words = shuffle(levelWords(cur.grade, cur.level));
    // One question a word, a spread of kinds, several asking the student to
    // produce the word rather than spot it.
    const kinds = ['listen', 'blank', 'meaning', 'usage', 'scramble', 'word', 'listen', 'blank', 'meaning', 'usage', 'spellpick', 'synonym'];
    const items = words.map((e, i) => makeQuestion(e, kinds[i % kinds.length]));
    // Retention: a few mastered words from earlier levels that are due. They
    // move the schedule but are not part of the pass mark.
    const back = dueWords().filter(e => memOf(e) && memOf(e).mastered && !words.includes(e)).slice(0, 3);
    back.forEach(e => { const q = makeQuestion(e, 'blank'); q.retention = true; items.push(q); });
    runSession({
      title: `Evaluation · ${gradeShort(cur.grade)} · Level ${cur.level}`, mode: 'eval', items: shuffle(items), feedback: 'brief',
      onDone: (results) => evaluate(cur, results),
    });
  }
  async function evaluate(cur, results) {
    const scored = results.filter(r => !r.retention);
    const right = scored.filter(r => r.right).length;
    const pct = scored.length ? Math.round(right / scored.length * 100) : 0;
    const passed = pct >= PASS_PCT;
    let note = '';
    if (passed) {
      let ng = cur.grade, nl = cur.level + 1;
      if (nl > levelCount(cur.grade)) {
        const gi = GRADES.indexOf(cur.grade);
        if (gi < GRADES.length - 1) { ng = GRADES[gi + 1]; nl = 1; } else { nl = cur.level; }
      }
      const finishedAll = ng === cur.grade && nl === cur.level;
      S.profile = Object.assign({}, S.profile || {}, { current_grade: ng, current_level: nl,
        levels_passed: ((S.profile && S.profile.levels_passed) || []).concat([{ grade: cur.grade, level: cur.level, score: pct }]) });
      saveLocal();
      const r = await ask('VOCAB_PASS_LEVEL', { grade: cur.grade, level: cur.level, score: pct, nextGrade: ng, nextLevel: nl });
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
    choose, submitTyped, dontKnow, next, endSession, matchTap,
    // for tests
    _q: () => Q,
    _internals: { makeQuestion, misspellings, misuse, blankOut, applyResult, S, BANK, loadGrade, levelWords, kindFor, wordRx, GRADES, LEVEL_SIZE },
  };
})();
