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

  // Set these once the Supabase table exists. Until then the UI works end to
  // end and submitting reports that it is not configured, which keeps the whole
  // flow testable with no backend.
  const SUPABASE_URL = '';              // e.g. https://xxxx.supabase.co
  const SUPABASE_ANON_KEY = '';

  function configured() { return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }

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

      const res = await fetch(SUPABASE_URL + '/rest/v1/proposals', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          // Ask for the inserted row back, so we can record its id.
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).message || ''; } catch (e) { /* not json */ }
        // The row-count trigger raises for flooding; say so plainly.
        if (res.status === 429 || /too many/i.test(detail)) {
          throw new Error('Too many proposals just now. Please try again later.');
        }
        throw new Error('Could not send (' + res.status + '). ' + detail);
      }

      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      this.rememberSent({ id: row.id, created_at: row.created_at, ops: ops });

      // The pending log is now in the inbox, so it is no longer pending. The
      // DRAFT deliberately stays: it is the only thing keeping this visitor's
      // suggestion on their own tree until an approval lands in family.js.
      FTChangeLog.clearLog();
      FTChangeLog.notify();
      return row;
    },
  };
})();
