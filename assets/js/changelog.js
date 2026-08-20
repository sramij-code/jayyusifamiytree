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
    // A cheap fingerprint of the COMMITTED data a draft was built on.
    //
    // Counts alone are not enough: one person approved and one deleted between two
    // publishes leaves the count identical while the membership differs. Summing
    // over the ids catches that, and it is one pass over ~1,700 short strings at
    // boot — cheaper than the JSON.parse of the draft itself.
    baselineStamp: function () {
      if (typeof familyData === 'undefined' || !familyData || !familyData.people) return null;
      const ids = Object.keys(familyData.people);
      let h = 0;
      for (const id of ids) {
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
      }
      return { people: ids.length, partnerships: familyData.partnerships.length, hash: h };
    },

    // True when the last saveDraft() could not write.
    //
    // write() swallows the exception and returns false, and NO caller checked it, so a
    // full or blocked localStorage meant the tree carried edits that would vanish on
    // the next reload with nothing said. Surfaced now, because losing an edit silently
    // is worse than any warning.
    _saveFailed: false,
    saveFailed: function () { return this._saveFailed; },

    saveDraft: function () {
      const ok = write(DRAFT_KEY, {
        people: state.people,
        partnerships: state.partnerships,
        savedAt: new Date().toISOString(),
        // WHICH published tree this draft was built on. Without it a draft saved
        // before someone was approved is indistinguishable from a current one, and
        // applyDraft silently hides them — the Mona1 failure. Recorded on every
        // save, so it tracks forward as the baseline moves.
        baseline: this.baselineStamp(),
        // Deletions recorded so far, carried IN THE DRAFT.
        //
        // applyDraft derives "stays deleted" from the changelog, but propose.js's
        // submit() clears the log while deliberately keeping the draft. So after
        // submitting a deletion, reconciliation found no delete_person entry and
        // RESTORED the person: the proposer's own card read "− X · قيد المراجعة"
        // while X was visibly back on their tree. Measured before this line existed.
        deletedIds: this.entries()
          .filter(e => e && e.op === 'delete_person' && e.target)
          .map(e => e.target),
      });
      this._saveFailed = !ok;
      if (!ok && typeof FTLog !== 'undefined') {
        FTLog.emit('error', { message: 'saveDraft failed — localStorage rejected the write',
                              kind: 'storage' });
      }
      return ok;
    },

    draft: function () { return read(DRAFT_KEY, null); },
    hasDraft: function () { return this.draft() !== null; },

    // What the LIVE TREE is missing relative to the committed data.
    //
    // applyDraft replaces state.people wholesale, so a draft saved before someone
    // was committed keeps them off this browser's tree — and every write path
    // (COMMIT, EXPORT) serialises state.people verbatim, so publishing then
    // DELETES them with no changelog entry naming it.
    //
    // MEASURED AGAINST state.people, NOT THE SAVED DRAFT. That distinction is the
    // whole point: this used to read the draft, and undo() calls clearDraft() as
    // soon as the log empties while restoring a snapshot that is itself the stale
    // tree. So undoing the last edit made the draft null, this reported "clean",
    // both publish guards passed, and EXPORT happily wrote a family.js with the
    // person deleted. Verified: 1746 people serialised over a committed 1747.
    //
    // Only the committed-but-missing direction is a problem. Extra people in the
    // tree are normal — unpublished admin edits, or a proposer's own suggestion,
    // which their draft exists to keep on screen.
    draftDivergence: function () {
      const none = { missing: [], names: [], extra: [], extraNames: [] };
      if (typeof familyData === 'undefined' || !familyData || !familyData.people) return none;
      if (typeof state === 'undefined' || !state || !state.people) return none;
      // hasOwnProperty, not truthiness: state.people['toString'] is a function and
      // would mask a genuinely missing person. See personExists in core/state.js.
      const has = id => Object.prototype.hasOwnProperty.call(state.people, id);

      // An UNPUBLISHED DELETION is not staleness. Someone the reviewer removed on
      // purpose is committed-but-absent for a perfectly good reason, and the whole
      // point of the next commit is to publish that removal. Without this the guard
      // fired on every pending deletion and blocked the commit that would apply it —
      // it would have blocked the delete-Mona1 workflow outright.
      //
      // The local changelog is what accounts for it: delete_person names the target.
      // Anything missing WITHOUT such an entry is unexplained, and unexplained is
      // exactly the hazard — a draft built on an older published tree.
      const accounted = new Set(
        this.entries().filter(e => e && e.op === 'delete_person').map(e => e.target));
      const missing = Object.keys(familyData.people)
        .filter(id => !has(id) && !accounted.has(id));

      // AND THE OTHER DIRECTION: people in the tree that nothing accounts for.
      //
      // This half was absent, and it is the mirror of the same failure. A draft saved
      // BEFORE someone was deleted still holds them, applyDraft applies the draft
      // wholesale, and reconciliation only ever ADDS people back — so the person
      // reappears on that browser's tree. Measured: with a pre-deletion draft,
      // `missing` was 0, commitBlockedReason() was null, and publishing would have
      // written the deleted person back into family.js with no changelog line
      // describing it, silently undoing a committed deletion.
      //
      // "Accounted for" means a local changelog entry ADDS them. A genuine
      // unpublished addition therefore never trips this; only a leftover does.
      const added = new Set(
        this.entries()
          .filter(e => e && e.id && (e.op === 'add_child' || e.op === 'add_wife' || e.op === 'add_father'))
          .map(e => e.id));
      const extra = Object.keys(state.people)
        .filter(id => !Object.prototype.hasOwnProperty.call(familyData.people, id) && !added.has(id));

      return {
        missing: missing,
        names: missing.slice(0, 5).map(id => familyData.people[id].name),
        extra: extra,
        extraNames: extra.slice(0, 5).map(id => state.people[id].name),
      };
    },

    clearDraft: function () {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to undo */ }
    },

    // Replace the in-memory tree with the saved draft. Deliberately does NOT
    // touch visibleNodes/expandedNodes — the caller decides what the viewport
    // does, because on boot that is "open on the home node" and after a
    // discard it is "leave the view alone".
    // Apply the draft, then RECONCILE it against the committed data.
    //
    // Applying alone was the bug: it replaces state wholesale, so anyone approved
    // and published after the draft was saved vanished from this browser — and
    // every write path serialises state verbatim, so publishing then deleted them.
    // Discarding the draft fixed the view but threw away the unpublished edits.
    //
    // Reconciling keeps both. A person present in the committed data but absent
    // from the draft is added back, along with any partnership the draft has never
    // heard of (matched by id — the draft never renames one). Where both hold the
    // same partnership id, the draft's version wins, because that is the edit.
    //
    // THE ONE EXCEPTION is an unpublished deletion, which looks exactly like "never
    // had them". The local changelog is what tells them apart: anyone named by a
    // delete_person entry stays deleted. Without that check, reconciliation would
    // silently resurrect people the reviewer had removed but not yet published.
    applyDraft: function () {
      const d = this.draft();
      if (!d || !d.people || !d.partnerships) return false;
      state.people = d.people;
      state.partnerships = d.partnerships;

      const report = {
        baselineMatched: true,
        restored: [],
        keptDeleted: [],
        savedAt: d.savedAt || null,
      };
      if (typeof familyData !== 'undefined' && familyData && familyData.people) {
        const now = this.baselineStamp();
        const was = d.baseline || null;
        // A draft written before baselines were stamped has `was === null`. Treat it
        // as a mismatch rather than as current: it is the older, riskier case.
        report.baselineMatched = !!(was && now && was.people === now.people &&
                                    was.partnerships === now.partnerships && was.hash === now.hash);

        // The union of what the log still says and what the draft remembers. The log
        // is cleared on submit; the draft is not.
        const deleted = new Set(
          this.entries().filter(e => e && e.op === 'delete_person').map(e => e.target));
        for (const id of (Array.isArray(d.deletedIds) ? d.deletedIds : [])) deleted.add(id);
        const has = id => Object.prototype.hasOwnProperty.call(state.people, id);

        for (const id of Object.keys(familyData.people)) {
          if (has(id)) continue;
          if (deleted.has(id)) { report.keptDeleted.push(id); continue; }
          state.people[id] = Object.assign({}, familyData.people[id]);
          report.restored.push(id);
        }

        if (report.restored.length) {
          const restored = new Set(report.restored);
          const byId = new Map(state.partnerships.map(pp => [pp.id, pp]));

          // Repair SLOTS in partnerships the draft already has. Restoring the person
          // alone left a partnership recorded as [null, …] — no partners at all —
          // which breaks the tree invariants and renders as an orphan node. Gated on
          // `restored`, so a slot the draft deliberately emptied (an unpublished
          // deletion, which is in keptDeleted) is left empty.
          for (const cpp of familyData.partnerships) {
            const mine = byId.get(cpp.id);
            if (!mine) continue;
            for (let i = 0; i < cpp.partners.length; i++) {
              const who = cpp.partners[i];
              if (who && restored.has(who) && mine.partners[i] !== who) mine.partners[i] = who;
            }
            for (const c of cpp.children) {
              if (c && restored.has(c) && mine.children.indexOf(c) === -1) mine.children.push(c);
            }
          }

          const known = new Set(state.partnerships.map(pp => pp.id));
          for (const pp of familyData.partnerships) {
            if (known.has(pp.id)) continue;
            // Only bring back a partnership that actually involves someone restored,
            // so an unrelated structural edit in the draft is left alone.
            const touches = pp.partners.some(x => x && report.restored.indexOf(x) !== -1) ||
                            pp.children.some(c => c && report.restored.indexOf(c) !== -1);
            if (!touches) continue;
            state.partnerships.push({
              id: pp.id,
              partners: pp.partners.slice(),
              children: pp.children.slice(),
            });
          }
        }
      }
      this._draftReport = report;

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

    // ANOTHER TAB WROTE OUR KEYS.
    //
    // Two admin tabs share one origin and one set of keys, with no coordination, so
    // the last saveDraft wins. Measured: tab 2 overwrote tab 1's draft while the
    // CHANGELOG kept both entries — the log then described an edit the tree did not
    // contain, which is the same divergence class the publish guards exist for.
    //
    // The storage event fires only in OTHER tabs, which is exactly the signal needed.
    // This does not coordinate the tabs — that would need locks and is more machinery
    // than one reviewer needs — it makes the collision visible instead of silent.
    _foreignWrite: null,
    foreignWrite: function () { return this._foreignWrite; },

    initTabWatch: function () {
      try {
        const self = this;
        window.addEventListener('storage', function (e) {
          if (!e || (e.key !== DRAFT_KEY && e.key !== LOG_KEY)) return;
          self._foreignWrite = { key: e.key, at: new Date().toISOString() };
          if (typeof FTLog !== 'undefined') {
            FTLog.emit('error', { message: 'another tab wrote ' + e.key, kind: 'multi_tab' });
          }
          if (typeof markFamilyDirty === 'function') markFamilyDirty();
          if (typeof markProposeState === 'function') markProposeState();
        });
      } catch (e) { /* no window, or no storage events: nothing to watch */ }
    },

    // ---- escape hatches -------------------------------------------------

    // Has the URL asked for a clean slate?
    //
    // A HARD RELOAD CANNOT BE DETECTED. PerformanceNavigationTiming.type returns
    // 'reload' for Cmd+R and Option+Cmd+R alike, and no API exposes the modifier —
    // so "clear on hard reload" could only ever mean "clear on ANY reload", which
    // would delete a relative's twenty minutes of work the first time they pressed
    // Cmd+R out of habit. Surviving a reload is the entire reason this store exists.
    //
    // An explicit URL is the honest substitute, and it is better in one way that
    // matters: it is SENDABLE. When a relative says the site looks wrong, the owner
    // replies with a link instead of talking them through DevTools, and it works even
    // when the UI itself is too confused to offer a button.
    freshRequested: function () {
      try {
        return /(^|[?&])fresh=1(&|$)/.test(location.search) || location.hash === '#fresh';
      } catch (e) { return false; }
    },

    // Throw away this role's local state. Used by ?fresh=1 and by the DISCARD
    // controls on both pages.
    discardLocal: function () {
      this.clearDraft();
      this.clearLog();
      this._draftReport = null;
      this._saveFailed = false;
      return true;
    },

    // Where the local state lives and when it was written, for display.
    //
    // Item two of the review's list, and the highest value per line: two pages keep
    // two independent stores, and NOTHING on screen named which one you were looking
    // at. An owner and I both read the wrong key for several minutes over a person
    // who was not there. A tooltip would have ended it immediately.
    storageInfo: function () {
      const d = this.draft();
      return {
        role: ROLE,
        draftKey: DRAFT_KEY,
        logKey: LOG_KEY,
        savedAt: d && d.savedAt ? d.savedAt : null,
        hasDraft: !!d,
        edits: this.count(),
        publishedAt: (typeof familyData !== 'undefined' && familyData && familyData.publishedAt) || null,
      };
    },

    // A one-line, human summary of the above.
    storageSummary: function () {
      const i = this.storageInfo();
      const bits = ['store: ' + i.draftKey];
      bits.push(i.hasDraft ? 'saved ' + String(i.savedAt || 'unknown').replace('T', ' ').slice(0, 16)
                           : 'no local copy');
      if (i.edits) bits.push(i.edits + ' unsent edit' + (i.edits === 1 ? '' : 's'));
      bits.push('published data: ' + (i.publishedAt
        ? String(i.publishedAt).replace('T', ' ').slice(0, 16) : 'unstamped'));
      return bits.join(' · ');
    },

    // What the last applyDraft() had to do. Null until one runs.
    draftReport: function () { return this._draftReport || null; },
    _draftReport: null,

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
