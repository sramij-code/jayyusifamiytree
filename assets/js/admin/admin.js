/* ============================================================================
   admin.js — admin bootstrap. Mirrors viewer.js and adds the editing wiring.
============================================================================ */

function initEventListeners() {
  document.getElementById('tree-svg').addEventListener('click', () => hideNodePanel());
  document.getElementById('btn-close-panel').addEventListener('click', () => hideNodePanel());
  document.getElementById('btn-expand-all').addEventListener('click', expandAll);
  document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);
  document.getElementById('btn-expand-subtree').addEventListener('click', () => {
    if (state.selectedNodeId) expandSubtree(state.selectedNodeId);
  });
  // ⌘↓ is the only other way to reach expandOneLevel, so without this button
  // the feature does not exist on a touch device.
  document.getElementById('btn-expand-level').addEventListener('click', () => {
    if (state.selectedNodeId) expandOneLevelFromPanel(state.selectedNodeId);
  });
  document.getElementById('btn-add-relative').addEventListener('click', () => {
    if (state.selectedNodeId && !isTerminal(state.selectedNodeId)) openModal(state.selectedNodeId);
  });

  document.getElementById('btn-publish').addEventListener('click', publishTheme);
  document.getElementById('btn-publish-family').addEventListener('click', publishFamily);
  document.getElementById('btn-reset-draft').addEventListener('click', () => FTAdminDraft.reset());
}

function init() {
  // Preview the local draft if there is one, otherwise the published theme.
  const draft = FTTheme.draft();
  if (draft) FTTheme.apply(draft);

  initState();
  initSVG();
  initEventListeners();
  initSearch();
  initKeyboardShortcuts();
  initModal();
  render(false);
  renderSearchResults('', document.getElementById('search-results'));
  markDirty();
  setTimeout(() => fitToNodes([...state.visibleNodes], true), 100);
}

document.addEventListener('DOMContentLoaded', init);
