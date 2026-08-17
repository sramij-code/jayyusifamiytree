/* ============================================================================
   propose.js — the visitor's side of collaborative editing. index.html only.

   A visitor turns on propose mode, edits the tree, and submits. What they see
   is their own localStorage draft, so their suggestion renders immediately on
   their copy and survives a reload. What everyone else sees is unchanged: a
   proposal is a row in a database inbox, and only an approval in admin.html
   turns it into a commit.

   This file is why index.html can now ship edit.js at all. The boundary is no
   longer "who has the editing code" but "who has a write credential" — there
   is no token here and github.js is never loaded, so the worst a visitor can
   do to the published site is ask.

   Identity is the home node, on the honour system: you tap your own name in
   the tree and that is who your proposals are from. No accounts, no passwords.
   Appropriate for family, and every proposal is attributed and reviewable.
============================================================================ */

var FTPropose = window.FTPropose = (function () {
  const MODE_KEY = 'ftProposeMode';
  const SENT_KEY = 'ftProposalsSent';   // ids we posted, so we can report status

  // Cached answer for the bar, which renders synchronously. `mineState` starts at
  // 'unknown' on purpose: before a fetch we know something was sent but not
  // whether it is still pending.
  let lastMine = [];
  let lastMineOk = true;
  let mineState = 'unknown';   // 'unknown' | 'ok'

  function configured() { return FTSupa.configured(); }

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  return {
    configured: configured,

    // ---- mode ------------------------------------------------------------

    isOn: function () {
      try { return localStorage.getItem(MODE_KEY) === 'true'; } catch (e) { return false; }
    },

    setOn: function (on) {
      try {
        if (on) localStorage.setItem(MODE_KEY, 'true');
        else localStorage.removeItem(MODE_KEY);
      } catch (e) { /* mode just won't persist */ }
      document.body.classList.toggle('propose-mode', !!on);
    },

    // ---- who ------------------------------------------------------------

    // Reuses the home node: the person you have claimed as yourself. Falls back
    // to the tree root, which homeNodeId already validates against the loaded
    // data, so a retired id cannot leave us attributing to a ghost.
    me: function () {
      const id = typeof homeNodeId === 'function' ? homeNodeId() : null;
      const person = id && state.people[id];
      return {
        node: id || null,
        name: person ? person.name : 'زائر',
      };
    },

    // ---- sent proposals --------------------------------------------------

    sent: function () { return read(SENT_KEY, []); },

    // ---- my proposals, and where they stand -----------------------------
    //
    // The bar used to read `sent().length`, a list nothing ever removes from, so
    // it announced "N اقتراحات قيد المراجعة" forever — including proposals
    // approved or declined months earlier. Status is now derived from the same two
    // committed files the reviewer uses.

    mine: async function () {
      if (!configured()) throw new Error('Proposals are not connected to a server yet.');

      // The UNION of two sources, because neither alone is enough:
      //
      //   author_node=eq.<me>  survives cleared localStorage and works on another
      //                        device, but is self-asserted — there is no login —
      //                        and misses proposals sent as a different node.
      //   the local id list    is exactly what THIS browser sent, but is lost with
      //                        localStorage and does not travel.
      //
      // Deduped by id. Neither is an ownership claim; `select` is open to everyone,
      // so this is a convenience for display, not a permission check.
      const who = this.me();
      const byNode = who.node
        ? await FTSupa.select('proposals',
            'select=*&author_node=eq.' + encodeURIComponent(who.node) + '&order=created_at.desc')
        : [];

      const localIds = this.sent().map(x => x.id).filter(Boolean);
      const known = new Set((byNode || []).map(r => r.id));
      const missing = localIds.filter(id => !known.has(id));
      let byId = [];
      if (missing.length) {
        // PostgREST in.(…) — quoted, since uuids are fine but the values are not
        // ours to trust blindly.
        byId = await FTSupa.select('proposals',
          'select=*&id=in.(' + missing.map(encodeURIComponent).join(',') + ')') || [];
      }

      const app = await FTProposalStatus.fetchApplied();
      const dec = await FTProposalStatus.fetchDecisions();
      const decMap = FTProposalStatus.latestPerId(dec.list);

      const all = (byNode || []).concat(byId);

      // Withdrawal rows are requests about other rows, not proposals themselves.
      const withdrawn = new Set();
      for (const r of all) if (r && r.withdraws) withdrawn.add(r.withdraws);

      const out = all
        .filter(r => r && !r.withdraws)
        .map(r => Object.assign({}, r, {
          _state: FTProposalStatus.stateOf(r.id, app.ids, decMap),
          _withdrawn: withdrawn.has(r.id),
          _decision: decMap.get(r.id) || null,
        }))
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

      lastMine = out;
      lastMineOk = app.ok && dec.ok;
      mineState = 'ok';
      return out;
    },

    // Ask the reviewer to drop a proposal.
    //
    // An INSERT, because the table has no delete or update policy for the
    // publishable key — see tools/proposals.sql. Withdrawing therefore cannot
    // remove anything; it records a request the reviewer sees on the card.
    withdraw: async function (id) {
      if (!configured()) throw new Error('Proposals are not connected to a server yet.');
      if (!id) throw new Error('Nothing to withdraw.');
      const who = this.me();
      await FTSupa.insert('proposals', {
        author_node: who.node,
        author_name: who.name,
        ops: [],
        note: null,
        withdraws: id,
      });
      // Reflect it immediately rather than waiting for a refetch.
      for (const r of lastMine) if (r.id === id) r._withdrawn = true;
      return true;
    },

    // What the propose bar should say. Same three-state discipline as the admin
    // button: "never asked" must not render as "nothing pending".
    barState: function () {
      const unsent = typeof FTChangeLog !== 'undefined' ? FTChangeLog.count() : 0;
      if (unsent > 0) {
        return { state: 'unsent', unsent: unsent, pending: null, approved: null, rejected: null };
      }
      if (mineState !== 'ok') {
        // sent() is all we know before a fetch: enough to say something was sent,
        // not enough to claim it is still pending.
        const everSent = this.sent().length;
        return { state: everSent > 0 ? 'unknown' : 'none', unsent: 0,
                 pending: null, approved: null, rejected: null, everSent: everSent };
      }
      const count = st => lastMine.filter(r => r._state === st).length;
      const pending = count('pending');
      return {
        state: pending > 0 ? 'pending' : 'settled',
        unsent: 0,
        pending: pending,
        approved: count('approved'),
        rejected: count('rejected'),
        partial: !lastMineOk,
      };
    },

    lastMine: function () { return lastMine.slice(); },
    mineState: function () { return mineState; },

    rememberSent: function (row) {
      const all = this.sent();
      all.push({ id: row.id, ts: row.created_at, count: row.ops.length });
      write(SENT_KEY, all);
    },

    // ---- submit ----------------------------------------------------------

    // One row per submission, carrying the whole batch of pending edits. The
    // ops are FTChangeLog's own entries verbatim, so a proposal and a committed
    // changelog line are the same shape — nothing to translate on review.
    submit: async function (note) {
      const ops = FTChangeLog.entries();
      if (ops.length === 0 && !String(note || '').trim()) {
        throw new Error('Nothing to send. Add a relative, or write a note.');
      }
      if (!configured()) {
        throw new Error('Proposals are not connected to a server yet. ' +
          'Your changes are saved in this browser and nothing is lost.');
      }

      const who = this.me();
      const body = {
        author_node: who.node,
        author_name: who.name,
        ops: ops,
        note: String(note || '').trim() || null,
      };

      const rows = await FTSupa.insert('proposals', body);
      const row = Array.isArray(rows) ? rows[0] : rows;
      this.rememberSent({ id: row.id, created_at: row.created_at, ops: ops });

      // The pending log is now in the inbox, so it is no longer pending. The
      // DRAFT deliberately stays: it is the only thing keeping this visitor's
      // suggestion on their own tree until an approval lands in family.js.
      FTChangeLog.clearLog();
      FTChangeLog.notify();
      // The cached list no longer includes this submission, so stop presenting it
      // as current.
      mineState = 'unknown';
      return row;
    },
  };
})();
