/* ============================================================================
   proposal-status.js — where a proposal stands, for BOTH pages.

   Loaded by index.html and admin.html. It exists because the proposer needs the
   same answer the reviewer does: this used to live inside admin/review.js, so a
   visitor could only be told "you have sent N proposals" — a number that never
   went down, because nothing on the proposer's side could see that a proposal had
   been approved or declined months ago.

   STATUS IS NEVER STORED. It is derived from two committed files:

     approved -> data/changes.jsonl        has a line with fromProposal: <id>
     declined -> data/proposals-reviewed.json  latest decision for <id> is 'rejected'

   A status column in Supabase would need UPDATE, and UPDATE via the publishable
   key lets any visitor rewrite any proposal — including flipping their own to
   approved. Deriving it from git is what makes that unnecessary. See
   tools/proposals.sql.

   Both fetches are best effort and REPORT whether they succeeded. A failed read
   makes an approved proposal look pending, which is an over-count: the safe
   direction, because it prompts a look rather than hiding work. Callers surface
   the `ok` flags rather than presenting a guess as exact.

   Classic script (no ES modules) so the site still works over file://.
============================================================================ */

var FTProposalStatus = window.FTProposalStatus = (function () {
  const LOG_PATH      = 'data/changes.jsonl';
  const REVIEWED_PATH = 'data/proposals-reviewed.json';

  // Cache-busted: both files change on every publish and would otherwise be
  // served stale for minutes. This project has already lost hours to a cached
  // data file, so it is not left to chance.
  function bust(path) {
    return path + '?t=' + Date.now();
  }

  // Ids whose ops are already in the tree.
  //
  // A 404 is normal before the first publish and is NOT a failure; any other
  // non-ok status means the file could not be read and the caller's pending count
  // is an over-count.
  async function fetchApplied() {
    const ids = new Set();
    try {
      const res = await fetch(bust(LOG_PATH), { cache: 'no-store' });
      if (!res.ok) return { ids: ids, ok: res.status === 404 };
      const text = await res.text();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.fromProposal) ids.add(e.fromProposal);
        } catch (err) { /* skip a torn line rather than abandon the file */ }
      }
      return { ids: ids, ok: true };
    } catch (e) {
      return { ids: ids, ok: false };   // offline, or file:// with no fetch
    }
  }

  // Review decisions committed to the repo. Absent until the first one is
  // committed, which is also not a failure.
  async function fetchDecisions() {
    try {
      const res = await fetch(bust(REVIEWED_PATH), { cache: 'no-store' });
      if (!res.ok) return { list: [], ok: res.status === 404 };
      const doc = JSON.parse(await res.text());
      const list = Array.isArray(doc && doc.decisions) ? doc.decisions : [];
      return {
        list: list
          .filter(d => d && typeof d === 'object' && typeof d.id === 'string')
          .map(d => Object.assign({}, d, { committed: true })),
        ok: true,
      };
    } catch (e) {
      return { list: [], ok: false };
    }
  }

  // Is the data/family.js this page loaded still the current one?
  //
  // family.js comes in via a plain <script src> with no query string, so neither the
  // browser nor the Pages CDN can be told to revalidate it. A stale copy looks exactly
  // like a broken site: a person was published, the file in the browser predates it,
  // and they are simply absent. That has cost three separate debugging rounds.
  //
  // Checked against a ~90-byte sidecar rather than by re-fetching 300KB. Returns
  // 'fresh' | 'stale' | 'unknown' — 'unknown' over file://, offline, or before the
  // sidecar has ever been published, and 'unknown' must never be presented as stale.
  async function checkFreshness() {
    const mine = (typeof familyData !== 'undefined' && familyData && familyData.publishedAt) || null;
    try {
      const res = await fetch('data/published.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return { state: 'unknown', mine: mine, latest: null };
      const doc = JSON.parse(await res.text());
      const latest = doc && doc.publishedAt ? String(doc.publishedAt) : null;
      if (!latest) return { state: 'unknown', mine: mine, latest: null };
      // An unstamped local copy with a stamped sidecar IS stale: the stamp was added at
      // publish time, so a file without one necessarily predates that publish.
      if (!mine) return { state: 'stale', mine: null, latest: latest, people: doc.people || null };
      return { state: mine === latest ? 'fresh' : 'stale', mine: mine, latest: latest,
               people: doc.people || null };
    } catch (e) {
      return { state: 'unknown', mine: mine, latest: null };
    }
  }

  return {
    checkFreshness: checkFreshness,
    fetchApplied: fetchApplied,
    fetchDecisions: fetchDecisions,

    // The latest decision per id, by timestamp.
    //
    // Ordered by `at`, never by position: the file is committed JSON that a human
    // can hand-edit and git can merge, so array order says nothing. Array.sort is
    // stable, so decisions sharing a millisecond keep input order.
    latestPerId: function (all) {
      const byId = new Map();
      const sorted = (all || []).slice()
        .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      for (const d of sorted) byId.set(d.id, d);
      return byId;
    },

    // Approval outranks any decision record: the ops are IN data/family.js, which
    // is a fact about the tree rather than a note about the proposal.
    stateOf: function (id, applied, decisionMap) {
      if (applied && applied.has(id)) return 'approved';
      const d = decisionMap && decisionMap.get(id);
      return d && d.decision === 'rejected' ? 'rejected' : 'pending';
    },
  };
})();
