/* ============================================================================
   changelog.js — draft persistence and the per-edit audit trail. BOTH pages.

   Two jobs:

   1. DRAFT. Structural edits used to live in one tab's memory and nothing
      else. Closing the tab lost them, and there was no dirty indicator to
      warn you. The theme layer already solved this (FTAdminDraft in
      publish.js keeps a localStorage draft); family data never got the same
      treatment. This mirrors it.

      For a proposer the draft does more than protect work: it IS how they see
      their own suggestion rendered on the tree while it waits for review.

   2. CHANGELOG. Every edit appends one line to a log. In admin.html that log
      is committed as data/changes.jsonl; in index.html the same entries are
      the payload of a proposal.

   The changelog is DESCRIPTIVE, NOT AUTHORITATIVE. data/family.js remains the
   rendered truth; nothing ever replays this log to reconstruct the tree. That
   distinction is the whole reason it is cheap: a replayed log has to answer
   what happens when two edits conflict, whether ops are commutative, and how
   revert composes — none of which apply to a log that is only ever read by
   humans and the review UI.

   Why it exists at all, given git: a commit records a whole publish. Add five
   relatives, publish once, and git shows one diff of a 190KB file. It cannot
   tell you the order the five happened in, and `git revert` is all-or-nothing.
   Per-edit chronology has to be recorded as it happens or it is gone.
============================================================================ */

var FTChangeLog = window.FTChangeLog = (function () {
  // Storage is per ORIGIN, so index.html and admin.html share it — and they mean
  // different things by a draft. For a proposer it is "my suggestion, still
  // showing on my own tree while it waits for review", which is why submit()
  // keeps it after clearing the log. For the admin it is "unpublished edits,
  // about to be committed". Under one key the proposer's draft was applied by
  // admin.html on boot, so the admin saw an unapproved proposal as part of the
  // tree — with an empty log, so nothing said the tree was local. One unrelated
  // admin edit would then have enabled COMMIT, which serialises state wholesale.
  //
  // The role is read off the page rather than set by a call: index.html has the
  // propose bar and admin.html does not, and propose-ui.js already treats that
  // element's presence as "this is the propose page". Deriving it removes an
  // ordering requirement that could be silently violated by any future script
  // that reads the draft before the setter ran.
  const ROLE = (typeof document !== 'undefined' &&
                document.getElementById('propose-bar')) ? 'propose' : 'admin';

  const DRAFT_KEY = 'ftFamilyDraft:' + ROLE;  // the mutated tree, so a tab close is survivable
  const LOG_KEY   = 'ftChangeLog:' + ROLE;    // edits not yet committed to the repo

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      // Private browsing, quota, or a half-written value. Losing the draft is
      // bad; throwing on boot and showing no tree at all is worse.
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    // ---- draft ----------------------------------------------------------

    // Full state, not a list of deltas to replay. For a short-lived
    // single-author draft that is simpler and has no replay semantics to get
    // wrong. The tradeoff: if data/family.js is regenerated from the Excel
    // source while a draft is open, saving the draft overwrites the rebuild.
    // hasDraft() is what the publish bar uses to make that visible.
    saveDraft: function () {
      return write(DRAFT_KEY, {
        people: state.people,
        partnerships: state.partnerships,
        savedAt: new Date().toISOString(),
      });
    },

    draft: function () { return read(DRAFT_KEY, null); },
    hasDraft: function () { return this.draft() !== null; },

    clearDraft: function () {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to undo */ }
    },

    // Replace the in-memory tree with the saved draft. Deliberately does NOT
    // touch visibleNodes/expandedNodes — the caller decides what the viewport
    // does, because on boot that is "open on the home node" and after a
    // discard it is "leave the view alone".
    applyDraft: function () {
      const d = this.draft();
      if (!d || !d.people || !d.partnerships) return false;
      state.people = d.people;
      state.partnerships = d.partnerships;

      // initState set the id counter from the BASE data, so it sits below any
      // id the draft already contains — the next generateId() would hand out
      // an id a drafted person is already using. Advance past the draft.
      let max = state._idCounter;
      const num = id => parseInt(String(id).replace(/^\D+/, ''), 10) || 0;
      for (const id of Object.keys(d.people)) max = Math.max(max, num(id));
      for (const pp of d.partnerships) max = Math.max(max, num(pp.id));
      state._idCounter = max;

      invalidateParentIndex();
      invalidateCoupleMap();
      invalidateChildIndex();
      return true;
    },

    // ---- editor identity -------------------------------------------------

    // Git attributes every API commit to the token's owner, so commit metadata
    // cannot say who actually made an edit. This field carries it instead.
    //
    // Derived rather than stored. It used to read a localStorage key that
    // nothing ever wrote, so it always answered 'admin' — including for a
    // proposer's own ops, which then travelled to the inbox claiming to be from
    // the owner. On the propose page the answer is the identity the visitor
    // claimed; on admin it is the owner.
    who: function () {
      if (typeof FTPropose !== 'undefined') {
        try {
          const me = FTPropose.me();
          if (me && me.name) return me.name;
        } catch (e) { /* identity not resolvable yet */ }
      }
      return 'admin';
    },

    // ---- log -------------------------------------------------------------

    entries: function () { return read(LOG_KEY, []); },
    count: function () { return this.entries().length; },

    // One line per edit. `describe` is precomputed here rather than derived at
    // read time because it needs the tree as it was when the edit happened —
    // a later edit can change a parent's name or move a node.
    record: function (entry) {
      const log = this.entries();
      log.push(Object.assign({
        ts: new Date().toISOString(),
        by: this.who(),
      }, entry));
      write(LOG_KEY, log);
      this.saveDraft();
      this.notify();
    },

    // Refresh whichever status bar this page has. admin.html owns
    // markFamilyDirty, index.html owns markProposeState, and neither knows
    // about the other — so ask for both and take what exists. Without this the
    // viewer's SEND button stayed disabled after an edit, because nothing told
    // the propose bar its count had changed.
    notify: function () {
      if (typeof markFamilyDirty === 'function') markFamilyDirty();
      if (typeof markProposeState === 'function') markProposeState();
    },

    clearLog: function () {
      try { localStorage.removeItem(LOG_KEY); } catch (e) { /* nothing to undo */ }
    },

    // JSON Lines: one object per line, appended forever. Chosen over a JSON
    // array so appending never rewrites earlier bytes and a truncated write
    // costs one line instead of the whole file.
    toJSONL: function () {
      return this.entries().map(e => JSON.stringify(e)).join('\n');
    },

    // A commit message git log can actually be read from: subject line, then
    // one bullet per edit in the order they happened.
    commitMessage: function () {
      const log = this.entries();
      if (log.length === 0) return 'Update family data';

      const subject = log.length === 1
        ? log[0].describe
        : `${log.length} edits to the family tree`;

      const body = log.map(e => '  ' + e.describe).join('\n');
      return subject + '\n\n' + body + '\n\nPublished from admin.html';
    },
    // ---- undo -----------------------------------------------------------

    // Snapshot-based, not inverse operations.
    //
    // Reversing an edit by hand means answering what the inverse of each op is
    // and how inverses compose when edits touch the same person — the problem
    // that made add_wife's slot-filling unrevertable. A snapshot has no such
    // question: restore the bytes and the tree is exactly what it was.
    //
    // Memory only, capped, and deliberately not persisted: this is session
    // undo. A reload starts from the saved draft with an empty stack, which is
    // honest about what it can and cannot take back.
    _undo: [],
    UNDO_LIMIT: 30,

    // Call BEFORE mutating.
    pushUndo: function (label) {
      this._undo.push({
        label: label || 'edit',
        people: JSON.parse(JSON.stringify(state.people)),
        partnerships: JSON.parse(JSON.stringify(state.partnerships)),
        logLength: this.entries().length,
        counter: state._idCounter,
      });
      if (this._undo.length > this.UNDO_LIMIT) this._undo.shift();
    },

    canUndo: function () { return this._undo.length > 0; },
    undoDepth: function () { return this._undo.length; },
    undoLabel: function () {
      const top = this._undo[this._undo.length - 1];
      return top ? top.label : '';
    },

    undo: function () {
      const snap = this._undo.pop();
      if (!snap) return false;

      state.people = snap.people;
      state.partnerships = snap.partnerships;
      // Restore the counter too, or ids already handed out get reissued.
      state._idCounter = snap.counter;

      // Truncate the log to its length at snapshot time. Truncate rather than
      // pop-one: a single action can record more than one entry.
      const log = this.entries().slice(0, snap.logLength);
      write(LOG_KEY, log);

      invalidateParentIndex();
      invalidateCoupleMap();
      invalidateChildIndex();

      // An undone person may still be in visibleNodes.
      for (const id of Array.from(state.visibleNodes)) {
        if (!state.people[id]) state.visibleNodes.delete(id);
      }
      for (const id of Array.from(state.expandedNodes)) {
        if (!state.people[id]) state.expandedNodes.delete(id);
      }
      if (state.selectedNodeId && !state.people[state.selectedNodeId]) {
        state.selectedNodeId = null;
      }

      if (log.length === 0) this.clearDraft(); else this.saveDraft();
      return true;
    },

    // Discard the most recent snapshot WITHOUT restoring it: the change it was
    // protecting is being kept deliberately.
    //
    // Approving a proposal must not wipe the admin's undo history for their own
    // unrelated edits made earlier in the session.
    dropUndo: function () { this._undo.pop(); },
  };
})();
