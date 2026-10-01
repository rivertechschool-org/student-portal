// shared/game-session.js - one GAME_SESSION_SUMMARY per session, from every
// assignable game.
//
// Teachers assign games as homework (portal/index.html launches them as
// /games/<id>.html?homework=<id>&subject=...). The portal turns these
// summaries into assignment progress, so every assignable game has to report
// the SAME shape at the end of every session / run / round:
//
//   { type: 'GAME_SESSION_SUMMARY', gameId, subject, homeworkId,
//     score,            // integer 0-100, or null when the game has no score
//     correct, total,   // integers (0 when the game does not count answers)
//     durationSeconds,  // ACTIVE play seconds in this session (see below)
//     endedAt }         // ISO timestamp
//
// It lives here rather than being pasted into thirteen games because the
// shape is a contract with the portal: one copy cannot drift.
//
// Usage, in a game:
//   const summary = GameSessionReporter.create('mathspire', { subject: 'Math' });
//   summary.begin();                         // a session / run / round starts
//   summary.report({ score, correct, total }); // it ends
//
// report() is idempotent per begun session: a game with several "game over"
// paths can call it from each of them and only the first one is sent. The next
// begin() opens a new session. A game that never calls begin() is treated as
// having begun when the page loaded.
//
// "Active" seconds: the clock only runs while the tab is visible AND the
// student has touched the keyboard/mouse/screen in the last IDLE_MS. A game
// left open on a hidden tab, or abandoned on the pause screen, does not earn
// minutes toward a "10 minutes of play" homework goal.
(function (global) {
    'use strict';

    const IDLE_MS = 90 * 1000;   // no input for this long = not playing
    const TICK_MS = 1000;

    function toInt(n) {
        const v = Number(n);
        return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
    }

    // Score is an integer 0-100, or null when the game truly has no score.
    // Anything non-numeric becomes null rather than 0: a 0 would read as
    // "the student scored nothing", which is a different statement.
    function normaliseScore(score) {
        if (score === null || score === undefined || score === '') return null;
        const v = Number(score);
        if (!Number.isFinite(v)) return null;
        return Math.max(0, Math.min(100, Math.round(v)));
    }

    // Pure builder, separate from posting, so tests can check the shape
    // without a window. `params` is a URLSearchParams-like object.
    function buildSummary(gameId, opts, params, result, durationSeconds, endedAt) {
        const hw = params && params.get ? params.get('homework') : null;
        return {
            type: 'GAME_SESSION_SUMMARY',
            gameId: String(gameId),
            subject: (result && result.subject) || (params && params.get && params.get('subject')) ||
                (opts && opts.subject) || null,
            homeworkId: hw ? String(hw) : null,
            score: normaliseScore(result ? result.score : null),
            correct: toInt(result ? result.correct : 0),
            total: toInt(result ? result.total : 0),
            durationSeconds: toInt(durationSeconds),
            endedAt: endedAt || new Date().toISOString()
        };
    }

    function create(gameId, opts) {
        opts = opts || {};
        const win = opts.window || global;
        const doc = win.document;
        const now = opts.now || (() => Date.now());
        const params = new URLSearchParams((win.location && win.location.search) || '');

        let activeMs = 0;
        let lastTick = now();
        let lastInput = now();
        let open = true;          // a session is in progress and not yet reported

        const visible = () => !doc || doc.visibilityState !== 'hidden';

        // Accumulate active time since the last tick. Called on a timer and
        // again right before a report so the final partial second counts.
        function tick() {
            const t = now();
            const dt = t - lastTick;
            lastTick = t;
            if (!open) return;
            if (dt > 0 && visible() && (t - lastInput) <= IDLE_MS) {
                // Clamp: a throttled background timer can deliver one huge dt.
                activeMs += Math.min(dt, TICK_MS * 5);
            }
        }

        const markInput = () => { lastInput = now(); };
        if (doc && doc.addEventListener) {
            ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'wheel'].forEach(ev =>
                doc.addEventListener(ev, markInput, { passive: true, capture: true }));
            doc.addEventListener('visibilitychange', () => { tick(); lastTick = now(); });
        }
        if (!opts.noTimer && win.setInterval) win.setInterval(tick, TICK_MS);

        const api = {
            gameId: String(gameId),
            homeworkId: params.get('homework') || null,

            // A new session / run / round starts: reset the clock.
            begin() {
                activeMs = 0;
                lastTick = now();
                lastInput = now();
                open = true;
            },

            activeSeconds() { tick(); return Math.round(activeMs / 1000); },

            // The session ended. Returns the message (or null if this session
            // was already reported) and posts it to the host page.
            report(result) {
                tick();
                if (!open) return null;
                open = false;
                const msg = buildSummary(gameId, opts, params, result, activeMs / 1000);
                try {
                    if (win.parent && win.parent !== win) {
                        // Same-origin hosts only (index.html, portal/index.html).
                        win.parent.postMessage(msg, win.location.origin);
                    }
                } catch (e) {
                    // file:// pages have origin "null", which postMessage rejects.
                    // Nothing to report to in that case.
                }
                return msg;
            }
        };
        return api;
    }

    global.GameSessionReporter = { create, buildSummary, normaliseScore, IDLE_MS };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.GameSessionReporter;
})(typeof window !== 'undefined' ? window : globalThis);
