/* =====================================================================
   guidelines.js — Host bridge for diagnostic-algorithms.html
   ---------------------------------------------------------------------
   This file does NOT render anything. All rendering, filtering,
   flip-card logic, search, bookmarking, highlighting, and self-test
   mode live inside the HTML itself.

   What this file DOES:
     1. Detect if we're embedded in the Zona host (iframe).
     2. Sync the theme from the host (Tailwind `dark` class).
     3. Hydrate bookmarks and highlights from the host via postMessage.
     4. Broadcast local changes (bookmark toggle, highlight toggle)
        back to the host through window.ZonaBridge.
     5. Fall back to localStorage when running standalone.

   The HTML exposes state-change hooks by calling window.ZonaBridge.*
   The HTML listens for a `zona:hydrated` custom event to re-render.
   ===================================================================== */
(function () {
  'use strict';

  // ─────────── environment ───────────
  var THEMES = ['dark', 'light', 'oled', 'midnight', 'solarized'];
  var ORIGIN = location.origin === 'null' ? '*' : location.origin;
  var embedded = window.parent && window.parent !== window;
  if (embedded) document.documentElement.classList.add('embedded');

  // ─────────── storage keys (must match the HTML) ───────────
  var LS_BOOKMARKS = 'diagnostic_algorithms_bookmarks';
  var LS_HIGHLIGHTS = 'diagnostic_algorithms_highlights';

  // ─────────── helpers ───────────
  function post(type, payload) {
    if (!embedded) return;
    try {
      window.parent.postMessage(
        { source: 'guidelines', type: type, payload: payload },
        ORIGIN
      );
    } catch (e) { /* ignore */ }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /**
   * Map a Zona theme name to Tailwind's `dark` class + a data-theme
   * attribute for any future CSS that uses it.
   */
  function setTheme(t) {
    if (THEMES.indexOf(t) === -1) return;
    var root = document.documentElement;
    if (t === 'light' || t === 'solarized') root.classList.remove('dark');
    else root.classList.add('dark');
    root.setAttribute('data-theme', t);
  }

  // ─────────── public bridge API ───────────
  // The inline script in the HTML calls these whenever local state changes.
  window.ZonaBridge = {
    embedded: embedded,

    onBookmarksChanged: function (bookmarks) {
      writeJSON(LS_BOOKMARKS, bookmarks);
      post('bookmarksChanged', { bookmarks: bookmarks });
    },

    onHighlightsChanged: function (highlights) {
      writeJSON(LS_HIGHLIGHTS, highlights);
      post('highlightsChanged', { highlights: highlights });
    },

    ready: function () {
      post('ready', {});
    }
  };

  // ─────────── host → page message handling ───────────
  window.addEventListener('message', function (e) {
    if (!embedded) return;
    if (e.source !== window.parent) return;
    if (ORIGIN !== '*' && e.origin !== ORIGIN) return;

    var d = e.data;
    if (!d || d.source !== 'zona') return;

    // Theme sync
    if (d.type === 'theme' && d.theme) {
      setTheme(d.theme);
      return;
    }

    // Full hydration payload from the host
    if (d.type === 'hydrate') {
      if (d.theme) setTheme(d.theme);

      var p = d.payload || {};

      // Bookmarks
      if (Array.isArray(p.bookmarks)) {
        writeJSON(LS_BOOKMARKS, p.bookmarks);
        document.dispatchEvent(new CustomEvent('zona:hydrated', {
          detail: { kind: 'bookmarks', value: p.bookmarks }
        }));
      }

      // Highlights
      if (p.highlights && typeof p.highlights === 'object') {
        writeJSON(LS_HIGHLIGHTS, p.highlights);
        document.dispatchEvent(new CustomEvent('zona:hydrated', {
          detail: { kind: 'highlights', value: p.highlights }
        }));
      }
    }
  });

  // ─────────── announce readiness ───────────
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    window.ZonaBridge.ready();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      window.ZonaBridge.ready();
    });
  }
})();
