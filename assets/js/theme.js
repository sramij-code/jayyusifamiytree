/* ============================================================================
   theme.js — applies the published theme to CSS custom properties.

   Runs before the first render. Everything downstream reads the CSS variables,
   which replaces the old window.activeNodeColor / activeFontColor globals that
   had to be remembered as fallbacks in five separate places (and were silently
   ignored by any new element that forgot them).
============================================================================ */

(function () {
  const DEFAULTS = {
    bg: '#f4f3ef', nodeFill: '#ede8ff', fontColor: '#5b21b6',
    lineColor: '#9575c4', lineWidth: 1.5, marriage: '#b45309'
  };

  const VAR = {
    bg: '--bg', nodeFill: '--node-fill', fontColor: '--font-color',
    lineColor: '--line-color', marriage: '--marriage-color'
  };

  function apply(theme) {
    const t = Object.assign({}, DEFAULTS, theme || {});
    const root = document.documentElement;
    for (const key in VAR) root.style.setProperty(VAR[key], t[key]);
    root.style.setProperty('--line-width', t.lineWidth);
    // The renderer still reads these for per-element attributes that cannot be
    // expressed as CSS variables (SVG stroke-width on individual paths).
    window.activeNodeColor = t.nodeFill;
    window.activeFontColor = t.fontColor;
    window.activeLineColor = t.lineColor;
    window.activeLineWidth = t.lineWidth;
    return t;
  }

  const DRAFT_KEY = 'ftThemeDraft';

  window.FTTheme = {
    defaults: DEFAULTS,
    published: function () { return Object.assign({}, DEFAULTS, window.FT_THEME || {}); },
    apply: apply,
    // Admin-only: a local preview that never leaves this browser.
    draft: function () {
      try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; }
      catch (e) { return null; }
    },
    saveDraft: function (t) { localStorage.setItem(DRAFT_KEY, JSON.stringify(t)); },
    clearDraft: function () { localStorage.removeItem(DRAFT_KEY); }
  };

  // The user view applies the published theme and nothing else. admin.html
  // overrides this afterwards with its draft, if one exists.
  apply(window.FT_THEME);
})();

// Expose as a real binding for the classic scripts that consume it.
var FTTheme = window.FTTheme;

// The stale-data banner. Here because both pages load theme.js and neither owns it.
//
// It asks the user to reload rather than reloading for them: an automatic reload
// during an edit would lose unsent work, and this state is reached precisely when
// something unexpected is on screen.
function initStaleDataCheck() {
  const el = document.getElementById('stale-data-banner');
  if (!el || typeof FTProposalStatus === 'undefined') return;
  FTProposalStatus.checkFreshness().then(r => {
    if (r.state !== 'stale') return;   // 'unknown' must never read as stale
    el.hidden = false;
    el.textContent = 'بياناتك قديمة · this page is showing older data (' +
      (r.mine ? String(r.mine).replace('T', ' ').slice(0, 16) : 'unstamped') +
      ' vs ' + String(r.latest).replace('T', ' ').slice(0, 16) +
      ') — أعد التحميل بالكامل · hard-reload to get the current tree';
    el.title = 'A plain <script src> cannot be cache-busted, so the browser or the ' +
               'CDN may hold data/family.js. Reload with Shift/Option held.';
  }).catch(() => { /* never break a boot over a freshness check */ });
}
