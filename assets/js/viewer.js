/* ============================================================================
   viewer.js — read-only bootstrap.

   Same tree, same search, same expand/collapse as admin. What is absent:
   colour pickers, presets, add-relative, inline rename. Those live in
   assets/js/admin/ and this page never loads them, so there is no mode flag
   to flip and nothing to unlock.
============================================================================ */

function initEventListeners() {
  document.getElementById('tree-svg').addEventListener('click', () => hideNodePanel());
  document.getElementById('btn-close-panel').addEventListener('click', () => hideNodePanel());
  document.getElementById('btn-expand-subtree').addEventListener('click', () => {
    if (state.selectedNodeId) expandSubtree(state.selectedNodeId);
  });
  document.getElementById('btn-expand-all').addEventListener('click', expandAll);
  document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);
}

// Structural editing is admin-only; the renderer calls this on name click.
function startEditName() { /* no-op in the user view */ }

function init() {
  initState();
  initSVG();
  initEventListeners();
  initSearch();
  initKeyboardShortcuts();
  render(false);
  renderSearchResults('', document.getElementById('search-results'));
  setTimeout(() => centerOnNode(state.loggedInUser, true), 100);
}

document.addEventListener('DOMContentLoaded', init);
