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

  // Review decisions are the second thing a commit can carry, and the only one
  // for a session spent turning proposals down. Counting only edits left COMMIT
  // disabled after a rejection, so the decision stayed in this browser and the
  // proposal came back as pending on every other device.
  const d = typeof FTReview === 'undefined' ? 0 : FTReview.uncommitted().length;

  // A stale draft hiding committed people is NOT "in sync", and saying so sent a
  // reviewer looking for a person their own draft was hiding.
  const hidden = typeof FTChangeLog === 'undefined' ? { missing: [] }
                                                    : FTChangeLog.draftDivergence();

  // Two states that must shout, because both mean "what you see is not what is
  // stored": a draft that could not be written, and another tab that overwrote it.
  const saveFailed = typeof FTChangeLog !== 'undefined' && FTChangeLog.saveFailed();
  const foreign = typeof FTChangeLog !== 'undefined' && FTChangeLog.foreignWrite();

  const el = document.getElementById('family-state');
  if (el) {
    const bits = [];
    if (n) bits.push(n + (n === 1 ? ' EDIT' : ' EDITS'));
    if (d) bits.push(d + (d === 1 ? ' DECISION' : ' DECISIONS'));
    if (saveFailed || foreign) {
      el.textContent = saveFailed ? '✕ DRAFT NOT SAVED — THIS BROWSER REFUSED THE WRITE'
                                  : '▲ ANOTHER TAB CHANGED THE DRAFT — RELOAD';
      el.className = 'dirty';
      el.title = saveFailed
        ? 'localStorage rejected the write, so edits made now will be lost on reload. ' +
          'Commit what you have, or free space and try again.'
        : 'Another tab wrote the same draft. This tab\'s view may be stale, and the ' +
          'changelog can end up describing an edit the tree does not contain. Reload ' +
          'this tab, or close the other one.';
    } else if (hidden.extra.length && !hidden.missing.length) {
      // A leftover from a draft older than a committed deletion. Publishing would put
      // them back, so it reads as an addition nobody asked for.
      el.textContent = '▲ ' + hidden.extra.length + ' STALE EXTRA IN DRAFT' +
                       (bits.length ? ' · ' + bits.join(' + ') + ' UNPUBLISHED' : '');
      el.className = 'dirty';
      el.title = 'This browser\'s draft still contains ' + hidden.extra.length +
        ' person(s) that are NOT in data/family.js: ' + hidden.extraNames.join(', ') +
        '. They were most likely removed by a commit made elsewhere. Publishing would ' +
        'add them back with no changelog line. Press DISCARD EDITS, then reload.' +
        (bits.length ? '\n\n' + FTReview.unpublishedManifest() : '');
    } else if (hidden.missing.length) {
      el.textContent = '▲ ' + hidden.missing.length + ' HIDDEN BY STALE DRAFT' +
                       (bits.length ? ' · ' + bits.join(' + ') + ' UNPUBLISHED' : '');
      el.className = 'dirty';
      el.title = 'This browser\'s draft is missing ' + hidden.missing.length +
        ' person(s) that are in data/family.js: ' + hidden.names.join(', ') +
        (hidden.missing.length > hidden.names.length ? ', …' : '') +
        '. Publishing would DELETE them. Press DISCARD EDITS, then reload.' +
        // NOT "commit your pending edits first": committing edits is exactly what
        // is blocked here, so that instruction was impossible. The button is also
        // called DISCARD EDITS, not DISCARD DRAFT (admin.html).

        // Still say WHAT is pending: this is the state where knowing matters
        // most, because the publish guard will refuse the edits.
        (bits.length ? '\n\n' + FTReview.unpublishedManifest() : '');
    } else {
      el.textContent = bits.length === 0
        ? '○ TREE IN SYNC'
        : '● ' + bits.join(' + ') + ' UNPUBLISHED';
      el.className = bits.length === 0 ? '' : 'dirty';
      // A count with no manifest is unactionable: "1 DECISION UNPUBLISHED" does
      // not say about what. List exactly what COMMIT would publish.
      el.title = bits.length === 0 ? '' : FTReview.unpublishedManifest();
    }
    el.classList.toggle('clickable',
                        bits.length > 0 || hidden.missing.length > 0 || hidden.extra.length > 0);
  }

  const commitBtn = document.getElementById('btn-commit-family');
  if (commitBtn) {
    const connected = FTGitHub.hasToken();
    commitBtn.textContent = connected
      ? 'COMMIT TO ' + FTGitHub.branch.toUpperCase() + ' ↑'
      : 'CONNECT GITHUB …';
    // Without a token the button's job is to collect one, so it stays live
    // even with nothing to publish.
    //
    // Also disabled when commitFamily would REFUSE, rather than left live to set
    // a status message: clicking produced identical text every time, so it read
    // as broken at exactly the moment the user is least sure what is happening.
    // Mirrors the guard's condition — only an edit writes family.js, so a
    // decisions-only commit stays available.
    // Either direction is wrong to publish: a missing person would be DELETED, an
    // unaccounted extra would be RESURRECTED — both with no changelog line.
    const blockedByStaleDraft = n > 0 && (hidden.missing.length > 0 || hidden.extra.length > 0);
    // A failed localStorage write means the tree holds a mutation the changelog has
    // no line for: familyFileBody() serialises live state regardless, so publishing
    // would commit a person with nothing in changes.jsonl describing them. Only the
    // text warned about this before; it did not gate the button.
    commitBtn.disabled = connected && ((n === 0 && d === 0) || blockedByStaleDraft || saveFailed);
    commitBtn.title = blockedByStaleDraft
      ? 'Blocked: this browser\'s draft hides ' + hidden.missing.length +
        ' person(s) that are in data/family.js (' + hidden.names.join(', ') +
        '). Publishing would delete them. Press DISCARD EDITS, then reload.'
      : '';
  }

  // EXPORT serialises state.people the same way COMMIT does, and publishFamily
  // refuses on a stale draft — so it must not look live either.
  const exportBtn = document.getElementById('btn-publish-family');
  if (exportBtn) {
    exportBtn.disabled = hidden.missing.length > 0 || hidden.extra.length > 0;
    exportBtn.title = hidden.missing.length > 0
      ? 'Blocked: the draft hides ' + hidden.missing.length + ' person(s) in data/family.js (' +
        hidden.names.join(', ') + '). This export would delete them.'
      : '';
  }

  const discardBtn = document.getElementById('btn-discard-family');
  if (discardBtn) {
    // Enabled for a stale draft with NO edits too. That combination was a dead
    // end: the button was disabled and discardFamilyDraft returned early, so a
    // draft hiding committed people could only be cleared from DevTools.
    // BOTH directions, or an extras-only draft is a dead end: the tooltip says
    // "Press DISCARD EDITS" while the button is disabled and the handler returns
    // early. That is incident 3 reopened in the mirror direction by the guard added
    // for incident 4 — which is the argument against adding a seventh guard.
    discardBtn.disabled = n === 0 && hidden.missing.length === 0 && hidden.extra.length === 0;
  }

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
  // While a proposal preview is live, ⌘Z means "back out of this preview" —
  // that is what the user is looking at, and it is the only snapshot they can
  // coherently undo.
  //
  // Undoing past it left `previewing` set with the tree already restored, and
  // approve() then recorded entries for edits no longer present: changes.jsonl
  // asserting people family.js lacks, with fromProposal marking the proposal
  // applied forever so it could never be reviewed again.
  if (typeof FTReview !== 'undefined' && FTReview.previewing()) {
    FTReview.dismiss();
    markFamilyDirty();
    setFamilyStatus('أُلغيت المعاينة');
    return;
  }
  if (!FTChangeLog.undo()) return;
  render(true);
  renderSearchResults(
    document.getElementById('search-input').value,
    document.getElementById('search-results'));
  markFamilyDirty();
  // Do NOT recompute the indicator from count() alone. That dropped the decisions
  // count and the stale-draft warning markFamilyDirty had just worked out, so
  // undoing the last edit printed "TREE IN SYNC" with a decision still unpublished
  // and a draft still hiding someone. Report the undo in the transient status line
  // and leave the indicator to the one function that owns it.
  setFamilyStatus('↩ undone', '');
}

// Throw away the draft and every unpublished edit, back to the committed
// data/family.js. Two clicks rather than window.confirm(), which Safari can
// suppress — and a suppressed confirm returns false, so the button would look
// dead exactly like CONNECT GITHUB did.
let _discardArmed = false;

function discardFamilyDraft() {
  const btn = document.getElementById('btn-discard-family');
  const n = FTChangeLog.count();
  // A stale draft with no edits still has to be discardable: it hides people who
  // ARE in data/family.js, and until this it was unreachable from the UI — the
  // button was disabled and this returned early, leaving DevTools as the only way.
  const div = FTChangeLog.draftDivergence();
  const stale = div.missing.length + div.extra.length;
  if (n === 0 && stale === 0) return;

  if (!_discardArmed) {
    _discardArmed = true;
    if (btn) {
      // "LOSE 0" is nonsense, and resyncing a draft holding no edits loses
      // nothing — so name which of the two is actually happening.
      btn.textContent = n > 0 ? 'CONFIRM: LOSE ' + n + ' ↺' : 'CONFIRM: RESYNC ↺';
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
  // Same hazard as commitFamily: the export serialises state, so a live
  // preview would be baked into the downloaded file.
  if (previewBlockingPublish()) {
    setFamilyStatus('✕ اعتمد أو ألغِ المعاينة أولاً · a proposal preview is live', 'dirty');
    return;
  }
  // Same reasoning as commitFamily: this file is meant to replace data/family.js,
  // so exporting a tree that hides committed people hands over a deletion.
  const hidden = FTChangeLog.draftDivergence();
  if (hidden.missing.length > 0) {
    setFamilyStatus('✕ المسودة تُخفي ' + hidden.missing.length + ' شخصًا (' +
      hidden.names.join('، ') + ') · this export would delete them', 'dirty');
    return;
  }

  const out = {
    people: state.people,
    partnerships: state.partnerships,
    loggedInUser: state.loggedInUser,
    root: state.root || 'p1',
    publishedAt: new Date().toISOString(),   // see github.js familyFileBody
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
    err.textContent = '';
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

// A live proposal preview must never be published.
//
// Preview really mutates state — that is how you see it laid out — but records
// nothing in the changelog until you approve. Both publish paths serialise
// state.people/state.partnerships wholesale, so with any OTHER edit pending
// (which is what enables the button) a commit would carry the previewed
// proposal into data/family.js without it ever having been approved, and
// without appearing in the changelog that is supposed to describe the commit.
function previewBlockingPublish() {
  if (typeof FTReview === 'undefined') return false;
  return !!FTReview.previewing();
}

async function commitFamily() {
  if (!FTGitHub.hasToken()) { openTokenModal(); return; }

  // Two independent reasons to commit. Testing only the changelog here blocked a
  // rejection-only commit in the UI even once github.js allowed it, so a decision
  // still could not leave the browser.
  const edits = FTChangeLog.count();
  const decisions = typeof FTReview === 'undefined' ? 0 : FTReview.uncommitted().length;
  if (edits === 0 && decisions === 0) return;

  // See markFamilyDirty: a rejected write leaves the tree ahead of its own changelog.
  if (FTChangeLog.saveFailed()) {
    setFamilyStatus('✕ لا تنشر: هذا المتصفح رفض حفظ المسودة · an edit is in the tree ' +
      'with no changelog line — reload and redo it', 'dirty');
    return;
  }

  // NEVER publish a tree that is hiding committed people.
  //
  // familyFileBody() serialises state verbatim, so committing while a stale draft
  // hides someone DELETES them from data/family.js — silently, and the changelog
  // would not mention it because no edit removed them. Measured: an admin whose
  // draft predated Ola1 would have published 1,747 people over the committed
  // 1,748, dropping her with no record.
  //
  // Only gated on edits, because a decisions-only commit never writes family.js.
  const hidden = FTChangeLog.draftDivergence();
  if (edits > 0 && hidden.missing.length > 0) {
    if (typeof FTLog !== 'undefined') FTLog.emit('publish.commit.refused', {
      guard: 'stale_draft', missing_count: hidden.missing.length, edits: edits, decisions: decisions });
    setFamilyStatus('✕ لا تنشر: المسودة تُخفي ' + hidden.missing.length + ' شخصًا (' +
      hidden.names.join('، ') + ') · publishing now would DELETE them — ' +
      'discard the stale draft first', 'dirty');
    return;
  }

  if (previewBlockingPublish()) {
    setFamilyStatus('✕ اعتمد أو ألغِ المعاينة أولاً · a proposal preview is live', 'dirty');
    return;
  }

  const btn = document.getElementById('btn-commit-family');
  if (btn) btn.disabled = true;

  try {
    const r = await FTGitHub.publish(msg => setFamilyStatus('· ' + msg));
    // Only now is the work safely off this device, so only now is it safe to
    // drop the draft that was protecting it. Guarded on there having BEEN edits:
    // a rejection-only commit must not clear a draft it never published.
    // FTGitHub.publish has already flagged the decisions as committed.
    if (edits > 0) {
      FTChangeLog.clearLog();
      FTChangeLog.clearDraft();
    }
    // Before the status, which markFamilyDirty would otherwise overwrite.
    markFamilyDirty();
    if (typeof renderReviewList === 'function' && FTReview.all().length) renderReviewList();

    const what = [];
    if (r.count) what.push(r.count + (r.count === 1 ? ' edit' : ' edits'));
    if (r.decisions) what.push(r.decisions + (r.decisions === 1 ? ' decision' : ' decisions'));
    setFamilyStatus('✓ committed ' + what.join(' + ') + ' to ' + r.branch +
                    ' · ' + r.sha.slice(0, 7));
  } catch (e) {
    // The draft and log are deliberately untouched on failure — a network
    // blip must not cost the edits.
    markFamilyDirty();
    setFamilyStatus('✕ ' + e.message, 'dirty');
  }
}
