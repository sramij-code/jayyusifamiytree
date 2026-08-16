/* ============================================================================
   publish.js — turn a local draft into committable files.

   The admin/viewer boundary in one function: nothing you do in admin.html is
   visible to anyone else until one of these files is committed to the repo.
============================================================================ */

var FTAdminDraft = window.FTAdminDraft = (function () {
  let draft = Object.assign({}, FTTheme.published(), FTTheme.draft() || {});
  return {
    all: function () { return Object.assign({}, draft); },
    set: function (key, value) {
      draft[key] = value;
      FTTheme.saveDraft(draft);
      markDirty();
    },
    reset: function () {
      draft = FTTheme.published();
      FTTheme.clearDraft();
      FTTheme.apply(draft);
      if (typeof render === 'function') render(false);
      markDirty();
    }
  };
})();

function isDirty() {
  const pub = FTTheme.published(), d = FTAdminDraft.all();
  return Object.keys(pub).some(k => String(pub[k]) !== String(d[k]));
}

function markDirty() {
  const el = document.getElementById('publish-state');
  if (!el) return;
  const dirty = isDirty();
  el.textContent = dirty ? '● UNPUBLISHED CHANGES' : '○ IN SYNC WITH SITE';
  el.className = dirty ? 'dirty' : '';
  const btn = document.getElementById('btn-publish');
  if (btn) btn.disabled = !dirty;
}

// Family data has its own watermark. Theme dirtiness and tree dirtiness are
// independent — you can restyle without editing anyone, and vice versa — and
// before this the tree had no indicator at all, so unsaved edits were
// invisible right up until the tab closed on them.
function markFamilyDirty() {
  const n = typeof FTChangeLog === 'undefined' ? 0 : FTChangeLog.count();

  const el = document.getElementById('family-state');
  if (el) {
    el.textContent = n === 0
      ? '○ TREE IN SYNC'
      : '● ' + n + (n === 1 ? ' EDIT' : ' EDITS') + ' UNPUBLISHED';
    el.className = n === 0 ? '' : 'dirty';
  }

  const commitBtn = document.getElementById('btn-commit-family');
  if (commitBtn) {
    const connected = FTGitHub.hasToken();
    commitBtn.textContent = connected
      ? 'COMMIT TO ' + FTGitHub.branch.toUpperCase() + ' ↑'
      : 'CONNECT GITHUB …';
    // Without a token the button's job is to collect one, so it stays live
    // even with nothing to publish.
    commitBtn.disabled = connected && n === 0;
  }

  const discardBtn = document.getElementById('btn-discard-family');
  if (discardBtn) discardBtn.disabled = n === 0;

  const undoBtn = document.getElementById('btn-undo');
  if (undoBtn) {
    const can = FTChangeLog.canUndo();
    undoBtn.disabled = !can;
    undoBtn.title = can
      ? 'Undo: ' + FTChangeLog.undoLabel() + ' · ⌘Z · ' + FTChangeLog.undoDepth() + ' step(s) available'
      : 'Nothing to undo this session';
  }
}

// Session undo. Restores the snapshot taken before the last edit and drops the
// changelog entries that edit added.
function undoEdit() {
  if (!FTChangeLog.undo()) return;
  render(true);
  renderSearchResults(
    document.getElementById('search-input').value,
    document.getElementById('search-results'));
  markFamilyDirty();
  setFamilyStatus(FTChangeLog.count() === 0
    ? '○ TREE IN SYNC · undone'
    : '● ' + FTChangeLog.count() + ' unpublished · undone',
    FTChangeLog.count() === 0 ? '' : 'dirty');
}

// Throw away the draft and every unpublished edit, back to the committed
// data/family.js. Two clicks rather than window.confirm(), which Safari can
// suppress — and a suppressed confirm returns false, so the button would look
// dead exactly like CONNECT GITHUB did.
let _discardArmed = false;

function discardFamilyDraft() {
  const btn = document.getElementById('btn-discard-family');
  const n = FTChangeLog.count();
  if (n === 0) return;

  if (!_discardArmed) {
    _discardArmed = true;
    if (btn) {
      btn.textContent = 'CONFIRM: LOSE ' + n + ' ↺';
      btn.classList.add('danger');
    }
    // Disarm on its own, so a stray click cannot sit primed indefinitely.
    setTimeout(() => {
      _discardArmed = false;
      if (btn) { btn.textContent = 'DISCARD EDITS'; btn.classList.remove('danger'); }
    }, 4000);
    return;
  }

  FTChangeLog.clearDraft();
  FTChangeLog.clearLog();

  // Reload rather than unpicking the mutations: window.FT_FAMILY still holds
  // the pristine committed data, and re-deriving from it is exact where
  // reversing edits by hand would not be.
  window.location.reload();
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function publishTheme() {
  const d = FTAdminDraft.all();
  const body = [
    '/* ============================================================================',
    '   PUBLISHED THEME — what every visitor sees.',
    '   Generated by admin.html. Commit this file to publish.',
    '============================================================================ */',
    '',
    'window.FT_THEME = {',
    '  bg:         ' + JSON.stringify(d.bg) + ',',
    '  nodeFill:   ' + JSON.stringify(d.nodeFill) + ',',
    '  fontColor:  ' + JSON.stringify(d.fontColor) + ',',
    '  lineColor:  ' + JSON.stringify(d.lineColor) + ',',
    '  lineWidth:  ' + Number(d.lineWidth) + ',',
    '  marriage:   ' + JSON.stringify(d.marriage || '#b45309'),
    '};',
    ''
  ].join('\n');
  download('theme.js', body);
}

// Structural edits (wives, children, renames) are in-memory too. Same contract.
// Kept as the offline path: it works with no token and no network, so it is
// also the fallback if a commit fails and you need the work off this device.
function publishFamily() {
  const out = {
    people: state.people,
    partnerships: state.partnerships,
    loggedInUser: state.loggedInUser,
    root: state.root || 'p1'
  };
  download('family.js',
    'window.FT_FAMILY = ' + JSON.stringify(out, null, 2) + ';\n' +
    'window.familyData = window.FT_FAMILY;\n');
  // The changelog goes with it, or the downloaded tree arrives with no record
  // of how it got that way.
  if (FTChangeLog.count() > 0) download('changes.jsonl', FTChangeLog.toJSONL() + '\n');
}

// ---------------------------------------------------------------------------
// Commit straight to the repo.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GitHub token modal.
//
// Not window.prompt(): Safari suppresses native dialogs in several situations
// and does it silently, so the button simply looked dead. A prompt also shows
// a credential as plain text.
// ---------------------------------------------------------------------------

function initTokenModal() {
  const overlay = document.getElementById('token-modal-overlay');
  if (!overlay) return;

  document.getElementById('token-submit').addEventListener('click', submitToken);
  document.getElementById('token-cancel').addEventListener('click', closeTokenModal);
  document.getElementById('token-forget').addEventListener('click', () => {
    FTGitHub.clearToken();
    closeTokenModal();
    setFamilyStatus('○ github disconnected');
    markFamilyDirty();
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTokenModal(); });

  const input = document.getElementById('token-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); submitToken(); }
    if (e.key === 'Escape') closeTokenModal();
  });
}

function openTokenModal() {
  const overlay = document.getElementById('token-modal-overlay');
  if (!overlay) return;
  document.getElementById('token-input').value = '';
  document.getElementById('token-error').textContent = '';
  document.getElementById('token-forget').style.display =
    FTGitHub.hasToken() ? '' : 'none';
  overlay.classList.add('visible');
  setTimeout(() => document.getElementById('token-input').focus(), 200);
}

function closeTokenModal() {
  const overlay = document.getElementById('token-modal-overlay');
  if (overlay) overlay.classList.remove('visible');
  // Never leave a credential sitting in the DOM.
  const input = document.getElementById('token-input');
  if (input) input.value = '';
}

async function submitToken() {
  const input = document.getElementById('token-input');
  const err = document.getElementById('token-error');
  const btn = document.getElementById('token-submit');
  const t = input.value.trim();
  if (!t) { err.textContent = 'Paste a token, or press Disconnect.'; return; }

  btn.disabled = true;
  err.textContent = 'checking…';
  FTGitHub.setToken(t);
  try {
    const repo = await FTGitHub.verify();
    closeTokenModal();
    // markFamilyDirty rewrites #family-state, so it has to run BEFORE the
    // confirmation or it silently erases it and the connect looks like a no-op.
    markFamilyDirty();
    setFamilyStatus('✓ connected to ' + repo);
  } catch (e) {
    // Don't keep a credential that just proved it does not work.
    FTGitHub.clearToken();
    err.textContent = e.message;
    markFamilyDirty();
  }
  btn.disabled = false;
}

function setFamilyStatus(text, kind) {
  const el = document.getElementById('family-state');
  if (!el) return;
  el.textContent = text;
  el.className = kind || '';
}

async function commitFamily() {
  if (!FTGitHub.hasToken()) { openTokenModal(); return; }
  if (FTChangeLog.count() === 0) return;

  const btn = document.getElementById('btn-commit-family');
  if (btn) btn.disabled = true;

  try {
    const r = await FTGitHub.publish(msg => setFamilyStatus('· ' + msg));
    // Only now is the work safely off this device, so only now is it safe to
    // drop the draft that was protecting it.
    FTChangeLog.clearLog();
    FTChangeLog.clearDraft();
    // Before the status, which markFamilyDirty would otherwise overwrite.
    markFamilyDirty();
    setFamilyStatus('✓ committed ' + r.count + ' to ' + r.branch + ' · ' + r.sha.slice(0, 7));
  } catch (e) {
    // The draft and log are deliberately untouched on failure — a network
    // blip must not cost the edits.
    markFamilyDirty();
    setFamilyStatus('✕ ' + e.message, 'dirty');
  }
}
