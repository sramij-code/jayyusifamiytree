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

  initProposeUI();
}

function init() {
  initState();

  // A visitor's own pending suggestions, which render from their local draft
  // until an approval reaches data/family.js. Before initSVG, so nothing tries
  // to draw yet; the visible set is reseeded directly rather than via
  // resetView, which renders.
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

document.addEventListener('DOMContentLoaded', init);
