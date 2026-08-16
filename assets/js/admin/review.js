/* ============================================================================
   review.js — the admin side of proposals. admin.html only.

   Lists what family members have suggested, applies one to the tree so it can
   be SEEN rather than read as JSON, then commits it or records a rejection.

   WHY THERE IS NO STATUS COLUMN. The obvious schema puts status on the row,
   but that needs UPDATE, and UPDATE via the publishable key lets any visitor
   rewrite any proposal — including flipping their own to approved. So the
   inbox only ever grows and the decision lives in git:

     approved -> the ops land in data/changes.jsonl carrying fromProposal
     rejected -> the id is listed in data/proposals-reviewed.json

   Pending is therefore computed, not stored: every row, minus the ids named in
   those two committed files. Versioned, diffable, and it never requires
   trusting the database.

   PREVIEW IS A SNAPSHOT, NOT A SIMULATION. Applying a proposal really does
   mutate state — that is the point, it is how you see it laid out with the rest
   of the tree. FTChangeLog.pushUndo is taken first, so dismissing restores the
   exact prior tree rather than attempting to reverse each op.
============================================================================ */

var FTReview = window.FTReview = (function () {
  const REJECTED_KEY = 'ftRejectedProposals';   // local until committed

  let rows = [];          // everything fetched from the inbox
  let previewing = null;  // the row currently applied to the tree

  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  // Ids already committed, read from data/changes.jsonl as SERVED. Best effort:
  // over file:// there is no fetch, and a brand new repo has no such file yet.
  // Failing to read it only risks re-offering something already approved, which
  // is visible and harmless — far better than blocking review entirely.
  async function appliedIds() {
    const ids = new Set();
    try {
      // Cache-bust: this file changes on every publish and would otherwise be
      // served stale for minutes.
      const res = await fetch('data/changes.jsonl?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return ids;
      const text = await res.text();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.fromProposal) ids.add(e.fromProposal);
        } catch (err) { /* skip a torn line rather than abandon the file */ }
      }
    } catch (e) { /* file:// or offline */ }
    return ids;
  }

  function rejectedIds() {
    return new Set(readLocal(REJECTED_KEY, []).map(r => r.id));
  }

  return {
    all: function () { return rows.slice(); },
    previewing: function () { return previewing; },
    rejected: function () { return readLocal(REJECTED_KEY, []); },

    // ---- fetch -----------------------------------------------------------

    load: async function () {
      if (!FTSupa.configured()) throw new Error('Supabase is not configured.');
      const fetched = await FTSupa.select('proposals', 'select=*&order=created_at.desc');
      const applied = await appliedIds();
      const rejected = rejectedIds();
      rows = (fetched || []).map(r => Object.assign({}, r, {
        _state: applied.has(r.id) ? 'approved'
              : rejected.has(r.id) ? 'rejected'
              : 'pending',
      }));
      return rows;
    },

    pending: function () { return rows.filter(r => r._state === 'pending'); },

    // ---- preview ---------------------------------------------------------

    // Apply one op to state. Mirrors saveRelative's structural choices, but
    // headless: it reuses the proposer's own id rather than minting a new one,
    // so the id a family member saw on their screen is the id that gets
    // committed. Random ids make that safe — a proposer cannot collide with us
    // or with each other.
    applyOp: function (op) {
      if (!op || !op.op) return false;

      if (op.op === 'rename') {
        const p = state.people[op.target];
        if (!p) return false;
        p.name = op.to;
        return true;
      }

      if (op.op === 'delete_person') {
        return deletePerson(op.target);
      }

      // The three additions.
      const target = state.people[op.target];
      if (!target || !op.id) return false;
      if (state.people[op.id]) return false;        // already applied

      state.people[op.id] = {
        id: op.id,
        name: op.name,
        gender: op.gender || 'male',
        generation: typeof op.generation === 'number' ? op.generation : target.generation,
      };

      if (op.op === 'add_child') {
        const pp = state.partnerships.find(
          p => p.partners[0] === op.target || p.partners[1] === op.target);
        if (pp) pp.children.push(op.id);
        else state.partnerships.push({
          id: state.generatePPId(), partners: [op.target, null], children: [op.id],
        });

      } else if (op.op === 'add_wife') {
        // Always its own partnership — never filling an empty slot, which would
        // declare her mother of every child he already had.
        state.partnerships.push({
          id: state.generatePPId(), partners: [op.target, op.id], children: [],
        });

      } else if (op.op === 'add_father') {
        state.partnerships.push({
          id: state.generatePPId(), partners: [op.id, null], children: [op.target],
        });

      } else {
        delete state.people[op.id];
        return false;
      }

      invalidateParentIndex();
      invalidateCoupleMap();
      invalidateChildIndex();
      return true;
    },

    // Show a proposal on the tree: snapshot, apply, reveal, frame, highlight.
    preview: function (row) {
      if (previewing) this.dismiss();

      FTChangeLog.pushUndo('preview proposal');
      previewing = row;

      const touched = [];
      const failed = [];
      for (const op of (row.ops || [])) {
        if (this.applyOp(op)) touched.push(op.id || op.target);
        else failed.push(op.describe || op.op);
      }

      // Reveal the affected people — a proposal usually lands deep in a
      // collapsed branch, and reviewing it must not require hunting for it.
      for (const id of touched) {
        if (!state.people[id]) continue;
        ensureNodeVisible(id);
        for (const c of partnersOf(id)) if (!c.first) expandNode(c.other, true);
        const father = parentIndex()[id];
        if (father) expandNode(father, true);
        state.visibleNodes.add(id);
      }
      recomputeVisibleNodes();
      for (const id of touched) if (state.people[id]) state.visibleNodes.add(id);

      // Reuse the ancestor-path highlight so the change is obvious in context.
      state.selectedPathIds = new Set(touched.filter(id => state.people[id]));

      render(true);
      const frame = touched.filter(id => state.layout[id]);
      setTimeout(() => fitToNodes(frame.length ? frame : [...state.visibleNodes], true), 60);

      return { touched, failed };
    },

    // Put the tree back exactly as it was before the preview.
    dismiss: function () {
      if (!previewing) return;
      previewing = null;
      state.selectedPathIds = new Set();
      FTChangeLog.undo();
      render(true);
    },

    // ---- decide ----------------------------------------------------------

    // Keep the previewed mutations and record them as real edits, tagged with
    // the proposal they came from — that tag is what makes this proposal count
    // as applied on every future load, on any device.
    approve: function (row) {
      if (!previewing || previewing.id !== row.id) return false;
      previewing = null;
      state.selectedPathIds = new Set();

      for (const op of (row.ops || [])) {
        if (!op.id && !op.target) continue;
        // Skip anything that did not actually apply, so the changelog cannot
        // claim an edit the tree does not have.
        if (op.op !== 'delete_person' && op.id && !state.people[op.id]) continue;
        FTChangeLog.record(Object.assign({}, op, {
          by: row.author_name || 'proposal',
          fromProposal: row.id,
        }));
      }
      // Drop only the preview snapshot, so ⌘Z cannot silently un-approve. Not
      // clearUndo — that would also throw away snapshots from the admin's own
      // edits earlier in the session, which have nothing to do with this
      // proposal.
      FTChangeLog.dropUndo();
      return true;
    },

    // Rejection is local until committed. Stored per-device, which is enough
    // while one person reviews; committing data/proposals-reviewed.json is what
    // would make it durable and shared across devices.
    //
    // Returns false if the write failed, so the caller can say so — a silent
    // failure here means the rejection reappears on the next load and looks
    // like the button did nothing.
    reject: function (row, note) {
      if (previewing && previewing.id === row.id) this.dismiss();
      const all = readLocal(REJECTED_KEY, []);
      all.push({ id: row.id, at: new Date().toISOString(), note: note || null });
      let stored = true;
      try { localStorage.setItem(REJECTED_KEY, JSON.stringify(all)); }
      catch (e) { stored = false; }
      const r = rows.find(x => x.id === row.id);
      if (r) r._state = 'rejected';
      return stored;
    },

    unreject: function (id) {
      const kept = readLocal(REJECTED_KEY, []).filter(r => r.id !== id);
      try { localStorage.setItem(REJECTED_KEY, JSON.stringify(kept)); } catch (e) { /* ignore */ }
      const r = rows.find(x => x.id === id);
      if (r) r._state = 'pending';
    },
  };
})();
