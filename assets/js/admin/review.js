/* ============================================================================
   review.js — the admin side of proposals. admin.html only.

   Lists what family members have suggested, applies one to the tree so it can
   be SEEN rather than read as JSON, then commits it or records a rejection.

   WHY THERE IS NO STATUS COLUMN. The obvious schema puts status on the row,
   but that needs UPDATE, and UPDATE via the publishable key lets any visitor
   rewrite any proposal — including flipping their own to approved. So the
   inbox only ever grows and the decision lives in git:

     approved -> the ops land in data/changes.jsonl carrying fromProposal
     rejected -> a decision is appended to data/proposals-reviewed.json

   Pending is therefore computed, not stored: every row, minus the ids named in
   those two committed files. Versioned, diffable, and it never requires
   trusting the database.

   DECISIONS ARE APPEND-ONLY, AND A REJECTION IS REVERSIBLE. The reviewed file
   holds a list of decisions, not a set of rejected ids, and the LAST decision
   for an id wins. Reinstating therefore appends {decision:'reinstated'} rather
   than deleting the rejection — so "I turned this down in March and changed my
   mind in August" stays legible in the file and in git, instead of looking like
   it was never rejected.

   A DECISION IS NOT DURABLE UNTIL IT IS COMMITTED. It lands in localStorage
   first and the repo only on the next COMMIT, exactly like a tree edit. That gap
   is why a rejection made on a laptop used to reappear as pending on a phone.
   The UI must therefore distinguish the two states rather than implying every
   rejection is saved — see `committed` on each decision.

   PREVIEW IS A SNAPSHOT, NOT A SIMULATION. Applying a proposal really does
   mutate state — that is the point, it is how you see it laid out with the rest
   of the tree. FTChangeLog.pushUndo is taken first, so dismissing restores the
   exact prior tree rather than attempting to reverse each op.
============================================================================ */

var FTReview = window.FTReview = (function () {
  const REJECTED_KEY  = 'ftRejectedProposals';   // local until committed
  const REVIEWED_PATH = 'data/proposals-reviewed.json';

  // How many proposals the history view offers at once. The inbox only ever
  // grows, so an uncapped list would eventually render every row ever sent on
  // every refresh.
  const HISTORY_PAGE = 20;

  let rows = [];              // everything fetched from the inbox
  let previewing = null;      // the row currently applied to the tree
  let previewApplied = new Set();  // op indices the live preview actually applied
  let decisions = new Map();  // id -> the latest decision, committed or local
  let committed = [];         // decisions read from the repo on the last load

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

  // Decisions committed to the repo. Best effort for the same reasons as
  // appliedIds: no fetch over file://, and the file may not exist yet.
  async function committedDecisions() {
    try {
      const res = await fetch(REVIEWED_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return [];
      const doc = JSON.parse(await res.text());
      const list = doc && Array.isArray(doc.decisions) ? doc.decisions : [];
      return list.filter(d => d && typeof d === 'object' && typeof d.id === 'string')
                 .map(d => Object.assign({}, d, { committed: true }));
    } catch (e) { return []; }   // file://, offline, or malformed
  }

  // Decisions made on THIS device, durable only in localStorage. Entries written
  // before this file existed carried no `decision` field and always meant a
  // rejection, so that is the default — which is the whole migration.
  function localDecisions() {
    return readLocal(REJECTED_KEY, [])
      .filter(d => d && typeof d === 'object' && typeof d.id === 'string')
      .map(d => Object.assign({ decision: 'rejected' }, d));
  }

  function writeLocalDecisions(list) {
    try { localStorage.setItem(REJECTED_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  // Identity of a decision, for deduping. The same decision exists twice after a
  // publish — flagged locally, and as a line in the committed file — and those
  // are one event.
  //
  // `decision` is part of the key, not just id+timestamp. ISO timestamps are
  // milliseconds, and a reject immediately followed by a reinstate can land
  // inside the same millisecond; keyed on id+at alone the second one vanished
  // and the trail showed a single decision. Two entries agreeing on all three
  // fields really are the same write.
  function decisionKey(d) {
    return d.id + '@' + d.at + '#' + d.decision;
  }

  // Committed and local decisions as one list, each decision once.
  function allDecisions() {
    const seen = new Set();
    const out = [];
    for (const d of committed.concat(localDecisions())) {
      const key = decisionKey(d);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
    return out;
  }

  // The effective decision per id: the latest one by timestamp.
  //
  // Ordered by `at` rather than "local always wins", so a rejection another
  // device committed AFTER a local reinstate still wins. Both are the owner's own
  // writes, so the timestamps are trusted.
  //
  // Two limits, both accepted. Clock skew between the owner's own devices
  // mis-orders decisions made on the same proposal within seconds of each other
  // on different machines. And Array.sort is stable, so decisions sharing a
  // millisecond keep list order — committed before local, each in write order —
  // which is the right answer here but is ordering by luck, not by record. A
  // monotonic sequence number would fix both; it would also have to be
  // per-device and merged, which is more machinery than a single reviewer needs.
  function decisionMap(all) {
    const byId = new Map();
    const sorted = all.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    for (const d of sorted) byId.set(d.id, d);
    return byId;
  }

  // Names arrive from whoever POSTed the proposal, and end up in the DOM, in
  // data/changes.jsonl (one JSON object per LINE) and in a git commit message.
  // JSON.stringify escapes control characters so the JSONL cannot actually be
  // torn, but a name carrying newlines would still wreck the commit message and
  // the review list, and an unbounded one would bloat both. Collapse whitespace
  // and cap the length; return '' for anything with nothing left, which the
  // callers treat as a refusal.
  const NAME_MAX = 80;

  // Zero-width and bidi-control characters, written as escapes rather than the
  // characters themselves so they are visible in this source. A name of two
  // zero-width spaces was accepted and rendered blank; one starting with U+202E
  // reordered its whole review row and its commit-message line in an RTL UI.
  const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

  function cleanName(raw) {
    if (typeof raw !== 'string') return '';
    const cleaned = raw
      .replace(INVISIBLE, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Array.from iterates code POINTS, so the cap cannot cut a surrogate pair in
    // half and leave a lone surrogate. slice() on the string would.
    return Array.from(cleaned).slice(0, NAME_MAX).join('');
  }

  // What the log and the commit message say an op DID.
  //
  // Never the proposer's own `describe`. That string is displayed to the
  // reviewer, written to data/changes.jsonl, and for a single-op proposal
  // becomes the commit SUBJECT — so a crafted one could read "+ فاطمة · ابنة of
  // X" while the op deleted someone else, and could inject newlines and a
  // `Co-authored-by:` trailer that GitHub acts on. Deriving it means the record
  // matches the operation by construction.
  const OP_AR = {
    add_child: 'ابن/ابنة', add_wife: 'زوجة', add_father: 'أب',
    rename: 'تغيير اسم', delete_person: 'حذف',
  };
  function describeOp(op) {
    const label = OP_AR[op.op] || op.op;
    const t = getPerson(op.target);
    const target = (t && t.name) || op.target;
    if (op.op === 'rename') {
      return '~ ' + op.target + ': ' + cleanName(op.from) + ' → ' + cleanName(op.to);
    }
    if (op.op === 'delete_person') {
      return '− ' + cleanName(op.name) + ' (' + op.target + ')';
    }
    return '+ ' + cleanName(op.name) + ' · ' + label + ' of ' + cleanName(target) + ' (' + op.target + ')';
  }

  return {
    all: function () { return rows.slice(); },
    previewing: function () { return previewing; },

    // ---- fetch -----------------------------------------------------------

    load: async function () {
      if (!FTSupa.configured()) throw new Error('Supabase is not configured.');
      const fetched = await FTSupa.select('proposals', 'select=*&order=created_at.desc');
      const applied = await appliedIds();
      committed = await committedDecisions();
      decisions = decisionMap(allDecisions());
      rows = (fetched || []).map(r => Object.assign({}, r, {
        // `ops` is a jsonb column, so neither it nor its elements need be what
        // we expect — and anyone can POST directly with the publishable key.
        //
        // Normalising only the container was not enough: ops:[null] passes
        // Array.isArray, and reviewCard's `op.describe` then threw during
        // RENDER, blanking the whole list including every legitimate pending
        // proposal. With no anon delete policy the only cure was the
        // service_role key in the dashboard. Filter the elements too, so
        // render, preview and approve are all safe from one place.
        ops: (Array.isArray(r.ops) ? r.ops : []).filter(o => o && typeof o === 'object'),
        // Approval outranks any decision record: the ops are IN data/family.js,
        // which is a fact about the tree rather than a note about the proposal.
        _state: applied.has(r.id) ? 'approved'
              : (decisions.get(r.id) || {}).decision === 'rejected' ? 'rejected'
              : 'pending',
        _decision: decisions.get(r.id) || null,
      }));
      return rows;
    },

    pending: function () { return rows.filter(r => r._state === 'pending'); },

    // The newest `limit` proposals whatever their state, for "what has been
    // suggested lately" — including things already approved or turned down.
    // Rows arrive newest-first from Supabase; sorting here as well means the
    // cap is still the newest N if that ever changes.
    history: function (limit) {
      const n = typeof limit === 'number' && limit > 0 ? limit : HISTORY_PAGE;
      return rows.slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, n);
    },

    historyPage: function () { return HISTORY_PAGE; },
    total: function () { return rows.length; },

    // ---- decisions -------------------------------------------------------

    // Decisions this device has made but not yet committed. This is what makes a
    // rejection publishable: without it, turning a proposal down produced no
    // changelog entry, so COMMIT stayed disabled and the decision never left the
    // browser.
    uncommitted: function () { return localDecisions().filter(d => !d.committed); },

    // Everything that belongs in data/proposals-reviewed.json: the committed
    // history plus this device's additions, append-only and time-ordered.
    reviewedFileBody: function (committed) {
      const merged = (committed || []).concat(this.uncommitted())
        .map(d => ({ id: d.id, decision: d.decision, at: d.at,
                     note: d.note || null, by: d.by || null }))
        .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      return JSON.stringify({ version: 1, decisions: merged }, null, 2) + '\n';
    },

    // Called after a successful publish. Flags rather than deletes: the entries
    // are tiny, and dropping them would make a decision vanish from the UI until
    // the committed file becomes readable — which, being served over HTTP, lags
    // the commit by minutes. Flagged entries keep showing the right state and
    // simply stop asking to be committed again.
    markCommitted: function (entries) {
      const keys = new Set((entries || []).map(decisionKey));
      writeLocalDecisions(localDecisions().map(d =>
        keys.has(decisionKey(d)) ? Object.assign({}, d, { committed: true }) : d));
      decisions = decisionMap(allDecisions());
    },

    // ---- preview ---------------------------------------------------------

    // Apply one op to state. Mirrors saveRelative's structural choices, but
    // headless: it reuses the proposer's own id rather than minting a new one,
    // so the id a family member saw on their screen is the id that gets
    // committed. Random ids make that safe — a proposer cannot collide with us
    // or with each other.
    applyOp: function (op) {
      if (!op || !op.op) return false;

      if (op.op === 'rename') {
        const p = getPerson(op.target);
        if (!p) return false;
        // A name is the one thing a proposer supplies freely, so it is bounded
        // and trimmed here rather than trusted.
        const name = cleanName(op.to);
        if (!name) return false;
        // Already carries this name, so there is nothing to do. The additions
        // self-heal on a second application (the id exists) and delete_person
        // does too (canDelete refuses someone already gone); rename did not, so
        // re-approving a proposal appended its changelog entry a second time and
        // data/changes.jsonl claimed one change happened twice.
        if (p.name === name) return false;
        p.name = name;
        return true;
      }

      if (op.op === 'delete_person') {
        // deletePerson refuses the root and anyone with children.
        return deletePerson(op.target);
      }

      // The three additions.
      //
      // getPerson/isValidNewId rather than a truthiness check on
      // state.people[...]: an inherited name like '__proto__' or 'toString' is
      // truthy, and assigning to state.people['__proto__'] would replace the
      // prototype instead of adding anyone. See the note in core/state.js.
      const target = getPerson(op.target);
      if (!target || !isValidNewId(op.id)) return false;
      if (personExists(op.id)) return false;        // already applied

      const name = cleanName(op.name);
      if (!name) return false;

      // The SAME domain guards saveRelative applies in the UI.
      //
      // They were missing here, and this is the path that matters: the Supabase
      // publishable key ships to every visitor, so anyone can POST an arbitrary
      // row straight to the proposals table without going near the modal that
      // enforces them. Approving such a row broke the invariants four things
      // depend on (getAncestorPath, ancestorChain, parentIndex, childIndex):
      //
      //   add_father on someone who already has one  -> two parents, a DAG
      //   add_child / add_wife on a woman            -> women stop being terminal,
      //                                                 or a female lands in partners[0]
      //
      // Verified reachable for all three before this guard existed.
      if (isTerminal(op.target)) return false;
      if (op.op === 'add_father' && hasFather(op.target)) return false;
      // An ancestor ABOVE the tree root would sit at generation -1, and there is
      // no row there: layout.js places rows straight off the number and
      // GEN_COLORS[-1 % 6] is undefined. The root is the only fatherless person
      // in the imported data, so this is the only way to reach it. Adding one
      // properly means renumbering all 1,746 people, which is a migration rather
      // than an edit.
      if (op.op === 'add_father' && target.generation <= 0) return false;

      // Gender follows from the op, never from what was sent — 'banana' was
      // accepted verbatim before, and gender drives both the terminal rule and
      // the node's shape.
      const gender = op.op === 'add_wife' ? 'female'
                   : op.op === 'add_father' ? 'male'
                   : (op.gender === 'female' ? 'female' : 'male');

      // Generation is derived from the target, not trusted: a sent value of -99
      // was stored as-is, and layout.js places rows straight off it while
      // GEN_COLORS[negative] is undefined.
      const dGen = op.op === 'add_father' ? -1 : op.op === 'add_wife' ? 0 : 1;

      state.people[op.id] = {
        id: op.id,
        name: name,
        gender: gender,
        generation: target.generation + dGen,
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
    //
    // A preview is EXCLUSIVE while it is live: edit.js refuses to edit and
    // undoEdit dismisses instead of undoing. That is not politeness, it is what
    // makes dismiss() correct. dismiss restores by popping the undo stack, and
    // the stack is a stack — an admin edit made during a preview pushes a newer
    // snapshot on top, so dismiss undid the ADMIN'S edit and left the
    // unapproved proposal applied, persisted into the draft by that edit's
    // saveDraft, with `previewing` cleared so the publish gate passed. Proven.
    preview: function (row) {
      if (previewing) this.dismiss();
      const ops = Array.isArray(row && row.ops) ? row.ops : [];

      FTChangeLog.pushUndo('preview proposal');
      previewing = row;
      // Which ops THIS preview actually applied, by index. approve() records
      // only these — see the note there.
      previewApplied = new Set();

      const touched = [];
      const failed = [];
      ops.forEach((op, i) => {
        if (this.applyOp(op)) { previewApplied.add(i); touched.push(op.id || op.target); }
        else failed.push((op && op.describe) || (op && op.op) || 'malformed op');
      });

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
      previewApplied = new Set();
      state.selectedPathIds = new Set();
      FTChangeLog.undo();
      render(true);
    },

    // ---- decide ----------------------------------------------------------

    // Keep the previewed mutations and record them as real edits, tagged with
    // the proposal they came from — that tag is what makes this proposal count
    // as applied on every future load, on any device.
    //
    // Returns the number of entries recorded, so the caller can tell "approved
    // 2 edits" from "approved but nothing applied" — which happens when the
    // targets no longer exist.
    approve: function (row) {
      if (!previewing || previewing.id !== row.id) return 0;
      previewing = null;
      state.selectedPathIds = new Set();

      let recorded = 0;
      (Array.isArray(row.ops) ? row.ops : []).forEach((op, i) => {
        // TWO conditions, because either alone has a hole.
        //
        // Index tracking alone: a ⌘Z during the preview restores the tree but
        // leaves the indices set, so approve recorded edits that are no longer
        // there — changes.jsonl asserting people family.js lacks, and
        // fromProposal marking the proposal applied forever so it can never be
        // re-reviewed.
        //
        // The state check alone: on a SECOND approval of the same proposal the
        // person exists again from the first, so it recorded the entry twice.
        if (!previewApplied.has(i)) return;
        if (op.op !== 'delete_person' && op.id && !state.people[op.id]) return;

        // Record a CLEANED entry, not the op as sent.
        //
        // Spreading the raw op looked harmless because the tree itself is
        // guarded — but the entry is what reaches data/changes.jsonl and, for a
        // single-op proposal, becomes the commit SUBJECT. So a 300-character
        // name was capped in family.js and uncapped in the log (the two then
        // disagreeing), and a proposer-supplied `describe` could put newlines
        // and a `Co-authored-by:` trailer into the owner's commit — a trailer
        // GitHub acts on. `describe` is now derived here rather than trusted at
        // all, so the log says what actually happened.
        const described = describeOp(op);
        FTChangeLog.record({
          op: op.op,
          target: op.target,
          id: op.id,
          name: op.name ? cleanName(op.name) : undefined,
          to: op.to ? cleanName(op.to) : undefined,
          from: op.from ? cleanName(op.from) : undefined,
          describe: described,
          by: cleanName(row.author_name) || 'proposal',
          fromProposal: row.id,
        });
        recorded++;
      });
      previewApplied = new Set();

      // The card must stop offering itself for review. Without this,
      // renderReviewList redrew an approved proposal as pending with a live
      // معاينة button and kept counting it in the badge — and approving again
      // duplicated the changelog entry for any op that re-applies cleanly,
      // `rename` being the one that does.
      if (recorded > 0) {
        const r = rows.find(x => x.id === row.id);
        if (r) r._state = 'approved';
        row._state = 'approved';
      }

      // Drop only the preview snapshot, so ⌘Z cannot silently un-approve — not
      // the whole stack, which would throw away snapshots from the admin's own
      // edits earlier in the session.
      FTChangeLog.dropUndo();
      return recorded;
    },

    // Record a decision. Local until the next COMMIT writes it to the repo.
    //
    // Returns false if the localStorage write failed, so the caller can say so —
    // a silent failure means the decision reappears undone on the next load and
    // looks like the button did nothing.
    decide: function (row, decision, note) {
      if (decision !== 'rejected' && decision !== 'reinstated') return false;
      const id = typeof row === 'string' ? row : row && row.id;
      if (!id) return false;
      if (previewing && previewing.id === id) this.dismiss();

      const entry = {
        id: id,
        decision: decision,
        at: new Date().toISOString(),
        note: note || null,
        by: (typeof FTChangeLog !== 'undefined' && FTChangeLog.who()) || null,
      };
      // Appended, never replacing the previous decision for this id: the earlier
      // one is the history the owner asked to keep.
      const stored = writeLocalDecisions(localDecisions().concat([entry]));

      decisions.set(id, entry);
      const r = rows.find(x => x.id === id);
      if (r) {
        r._state = decision === 'rejected' ? 'rejected' : 'pending';
        r._decision = entry;
      }
      return stored;
    },

    reject: function (row, note) { return this.decide(row, 'rejected', note); },

    // Undo a rejection I now think was a mistake. Appends a reinstatement rather
    // than erasing the rejection, so both survive in the committed file.
    reinstate: function (row, note) { return this.decide(row, 'reinstated', note); },

    // Every decision ever recorded for one proposal, oldest first — the audit
    // trail behind a row that says "rejected, then reinstated".
    //
    // Deduped on id+timestamp: after a publish the same decision exists both as a
    // local entry flagged committed and as a line in the repo, and counting it
    // twice drew the trail as "✕ → ✕".
    decisionsFor: function (id) {
      return allDecisions()
        .filter(d => d.id === id)
        .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    },
  };
})();
