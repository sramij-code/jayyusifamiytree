/* ============================================================================
   admin.js — admin bootstrap. Mirrors viewer.js and adds the editing wiring.
============================================================================ */

function initEventListeners() {
  // Watch for another tab writing the same draft keys.
  FTChangeLog.initTabWatch();
  // Keep the centre when the window is resized. See core/render.js.
  // typeof-guarded like the other optional wiring here: render.js owns it, and
  // the test harness deliberately never loads the renderer.
  if (typeof initViewportWatch === 'function') initViewportWatch();
  // Publish-bar wiring first. These are the controls that get the work off
  // this device, so they must survive a failure in the tree wiring below —
  // otherwise a bug in the canvas means unpublished edits cannot be saved.
  document.getElementById('btn-publish').addEventListener('click', publishTheme);
  document.getElementById('btn-publish-family').addEventListener('click', publishFamily);
  document.getElementById('btn-commit-family').addEventListener('click', commitFamily);
  document.getElementById('btn-undo').addEventListener('click', undoEdit);
  document.getElementById('btn-discard-family').addEventListener('click', discardFamilyDraft);

  // The indicator is what a reviewer stares at when confused about what is
  // unpublished, so make it answer them: open the drawer with history shown,
  // where a rejected proposal's card reads بانتظار COMMIT. Pending cards alone
  // cannot explain a decision, because deciding removes it from pending.
  const familyState = document.getElementById('family-state');
  if (familyState) {
    familyState.addEventListener('click', () => {
      // Gated on the same class that styles it. markFamilyDirty toggles
      // .clickable only when there is something to explain, and without this
      // check clicking a plain "○ TREE IN SYNC" opened the drawer anyway — the
      // affordance said inert while the behaviour was not.
      if (!familyState.classList.contains('clickable')) return;
      if (typeof openReviewHistory === 'function') openReviewHistory();
    });
  }
  document.getElementById('btn-reset-draft').addEventListener('click', () => FTAdminDraft.reset());
  initTokenModal();
  initReviewUI();

  // ⌘Z / Ctrl+Z, admin-only. Skipped while typing, where the browser's own
  // undo belongs to the text field.
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    undoEdit();
  });

  document.getElementById('tree-svg').addEventListener('click', () => hideNodePanel());
  document.getElementById('btn-close-panel').addEventListener('click', () => hideNodePanel());
  document.getElementById('btn-expand-all').addEventListener('click', expandAll);
  document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);
  document.getElementById('btn-reset-view').addEventListener('click', resetView);
  document.getElementById('btn-full-tree').addEventListener('click', showFullTree);
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
  document.getElementById('btn-delete-person').addEventListener('click', () => {
    if (state.selectedNodeId) requestDeletePerson(state.selectedNodeId);
  });
}

function init() {
  // Preview the local draft if there is one, otherwise the published theme.
  const draft = FTTheme.draft();
  if (draft) FTTheme.apply(draft);

  initState();

  // Unpublished tree edits from a previous session replace the committed data.
  // After initState, so the id counter and indexes exist to be corrected;
  // before initSVG, so no render is attempted yet — reseed the visible set
  // directly rather than via resetView, which renders and would run before
  // the SVG layers exist.
  if (FTChangeLog.hasDraft()) {
    FTChangeLog.applyDraft();
    // What reconciliation had to do — the row that pins which published tree this
    // browser was working from.
    if (typeof FTLog !== 'undefined') {
      const rep = FTChangeLog.draftReport() || {};
      FTLog.emit('draft.reconciled', { _kind: 'draft',
        baseline_matched: rep.baselineMatched, restored: (rep.restored || []).length,
        kept_deleted: (rep.keptDeleted || []).length, draft_saved_at: rep.savedAt });
    }
    const home = homeNodeId();
    state.visibleNodes = new Set([home]);
    state.expandedNodes = new Set([home]);
    expandNode(home, true);
  }

  // Publish-bar state before any rendering. It only reads localStorage, so it
  // cannot fail on tree data — and running it here means a later failure in
  // render or search still leaves the bar usable instead of stranding its
  // buttons in their markup state.
  markDirty();
  markFamilyDirty();

  initSVG();
  initEventListeners();
  initSearch();
  initKeyboardShortcuts();
  initModal();
  render(false);
  renderSearchResults('', document.getElementById('search-results'));
  setTimeout(() => fitToNodes([...state.visibleNodes], true), 100);
}

document.addEventListener('DOMContentLoaded', init);
