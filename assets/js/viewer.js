/* ============================================================================
   viewer.js — the public bootstrap.

   Same tree, same search, same expand/collapse as admin. What is absent is the
   ability to change the published site: no auth gate, no colour pickers, no
   presets, and above all no github.js, so there is no credential here and no
   write path to the repo.

   What IS present, since visitors can now suggest changes, is the editing UI
   from edit.js. It only ever mutates this browser's own draft. Turning propose
   mode on is deliberate — the page opens read-only and looks exactly as it did
   before — and submitting puts a row in a review queue, not on the site.
============================================================================ */

function initEventListeners() {
  // Watch for another tab writing the same draft keys.
  FTChangeLog.initTabWatch();
  // Keep the centre when the window is resized. See core/render.js.
  // typeof-guarded like the other optional wiring here: render.js owns it, and
  // the test harness deliberately never loads the renderer.
  if (typeof initViewportWatch === 'function') initViewportWatch();
  // Tell the user if this page is showing older data than what is published.
  if (typeof initStaleDataCheck === 'function') initStaleDataCheck();
  document.getElementById('tree-svg').addEventListener('click', () => hideNodePanel());
  document.getElementById('btn-close-panel').addEventListener('click', () => hideNodePanel());
  document.getElementById('btn-expand-subtree').addEventListener('click', () => {
    if (state.selectedNodeId) expandSubtree(state.selectedNodeId);
  });
  // ⌘↓ is the only other way to reach expandOneLevel, so without this button
  // the feature does not exist on a touch device.
  document.getElementById('btn-expand-level').addEventListener('click', () => {
    if (state.selectedNodeId) expandOneLevelFromPanel(state.selectedNodeId);
  });
  document.getElementById('btn-expand-all').addEventListener('click', expandAll);
  document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);
  document.getElementById('btn-reset-view').addEventListener('click', resetView);
  document.getElementById('btn-full-tree').addEventListener('click', showFullTree);
  document.getElementById('btn-propose-discard').addEventListener('click', discardMyCopy);

  initProposeUI();
  initMineUI();
}

function init() {
  initState();

  // A visitor's own pending suggestions, which render from their local draft
  // until an approval reaches data/family.js. Before initSVG, so nothing tries
  // to draw yet; the visible set is reseeded directly rather than via
  // resetView, which renders.
  // ?fresh=1 (or #fresh) throws away this browser's local copy before it can be
  // applied. The sendable escape hatch — see freshRequested() for why a hard reload
  // cannot be used for this.
  if (FTChangeLog.freshRequested()) FTChangeLog.discardLocal();

  if (FTChangeLog.hasDraft()) {
    FTChangeLog.applyDraft();
    const home = homeNodeId();
    state.visibleNodes = new Set([home]);
    state.expandedNodes = new Set([home]);
    expandNode(home, true);
  }

  initSVG();
  initEventListeners();
  initSearch();
  initKeyboardShortcuts();
  initModal();
  FTPropose.setOn(FTPropose.isOn());
  render(false);
  renderSearchResults('', document.getElementById('search-results'));
  markProposeState();
  setTimeout(() => fitToNodes([...state.visibleNodes], true), 100);
}

// init() reads familyData (via initState), which boot-family.js now loads
// ASYNCHRONOUSLY so a commit is not served stale. So wait for BOTH: the DOM, and
// window.FT_BOOT (the family-data load). Still hung off DOMContentLoaded — the test
// harness drives init() directly and never fires that event, so this stays inert
// there. FT_BOOT is absent over a bare file open with no boot-family.js in play;
// Promise.resolve() then falls through to today's behaviour.
document.addEventListener('DOMContentLoaded', function () {
  var ready = (window.FT_BOOT && typeof window.FT_BOOT.then === 'function')
    ? window.FT_BOOT : Promise.resolve();
  ready.then(init, init);   // init on either outcome; FT_BOOT never rejects, but be safe
});
