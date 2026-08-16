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

  // Supabase project. The publishable key is MEANT to be public — it ships in
  // this file to every visitor — and its power is bounded entirely by the RLS
  // policies in tools/proposals.sql: insert and select on one table, nothing
  // else. The secret/service_role key bypasses RLS and must never appear here.
  const SUPABASE_URL = 'https://swwukbafkibgazlzshkr.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_aqFdEvUtLRPlCCnEgaSp6A_1G6r80hE';

  // The dashboard shows the REST endpoint (…/rest/v1/) rather than the bare
  // project URL, and this code appends the path itself. Normalise instead of
  // relying on which one got pasted — otherwise the mistake surfaces as a
  // baffling 404 on /rest/v1/rest/v1/proposals.
  function apiBase() {
    return String(SUPABASE_URL).replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  }

  function configured() { return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }

  // Supabase has two key formats and they want different headers.
  //
  // The legacy `anon` key is a JWT (starts 'eyJ') whose payload carries the
  // role, and the convention is to send it as BOTH apikey and a Bearer token.
  // The newer publishable key ('sb_publishable_…') is an opaque string, not a
  // JWT — the gateway resolves it to the anon role — so presenting it as a
  // Bearer token asks the server to parse it as one, which it is not.
  //
  // Detect rather than pick, so either key works and switching between them
  // needs no code change. Supabase is steering people to publishable keys and
  // offers a button to disable the legacy ones, so this will matter.
  function apiHeaders() {
    const h = { 'apikey': SUPABASE_ANON_KEY };
    if (/^eyJ/.test(SUPABASE_ANON_KEY)) {
      h['Authorization'] = 'Bearer ' + SUPABASE_ANON_KEY;
    }
    return h;
  }

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

      const res = await fetch(apiBase() + '/rest/v1/proposals', {
        method: 'POST',
        headers: Object.assign(apiHeaders(), {
          'Content-Type': 'application/json',
          // Ask for the inserted row back, so we can record its id.
          'Prefer': 'return=representation',
        }),
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
