/* ============================================================================
   opslog.js — fire-and-forget diagnostic breadcrumbs. Loaded by BOTH pages.

   WHY. git records only what was published. It cannot record what a browser
   BELIEVED — which published tree its draft was built on, what it refused to do,
   what it could not reach. Reconstructing one such incident took a git-archaeology
   session; a single `boot` row carrying the baseline fingerprint answers it.

   THE CONTRACT, in order of importance:

     1. This can never break or block the UI. Every call is a bare statement,
        never awaited, and the whole body is inside one try/catch that swallows.
        A hung network must not delay an edit, and a bug in here must not stop a
        commit. If FTSupa is absent (file://, script order), it no-ops.

     2. It records ids and counts, never secrets and never names. See EXCLUDED
        below — SELECT is public to every visitor, so a logged token is a leaked
        token and a logged unpublished name is a published one.

     3. It is honest about its own gaps. Drops are counted and reported in the
        next successful batch as `log.gap`, so silence is never mistaken for "did
        not happen".

   WHAT IT CANNOT DO. It cannot prove anything. There is no login, so role,
   author_node and client_ts are self-asserted, and anyone can post rows claiming
   whatever the constraints allow. Absence is not evidence: offline, capped, or a
   closed tab all produce silence. It is a debugging aid, not an audit trail.

   Classic script (no ES modules) so the site still works over file://.
============================================================================ */

var FTLog = window.FTLog = (function () {
  const TABLE = 'ops_log';
  const QUEUE_MAX = 50;      // drop-oldest beyond this
  const FLUSH_MS = 2000;     // debounce, so a burst of edits is one insert
  const FAIL_MAX = 3;        // consecutive failures before the breaker opens

  /* ---------------------------------------------------------------------------
     EXCLUDED, permanently. Read is public; treat a row as published.

       · The GitHub PAT, in any form — not the token, not a prefix, not the last
         four, not its length, not a hash, not the Authorization header, not a
         fetch options object. It is a repo-write credential.
       · The admin password or anything derived from an attempt: not the input,
         not its length, not a "close?" flag. ADMIN_HASH is already public and
         unsalted, so logging attempts would give an offline run a confirmation
         oracle, and near-misses leak passwords reused elsewhere. Outcome only.
       · Names of people not yet in data/family.js. An unpublished or proposed
         name is an unapproved claim about a living person. Log ids.
       · Free text: notes, search queries, textarea contents.
       · The draft or the tree itself. 1,700 people is not a log row, and it would
         re-publish the tree into a public table.
       · userAgent, screen size, timezone, language — fingerprinting a small,
         identifiable family.
       · Absolute paths and file:// URLs, which carry the owner's home directory.
         Hence page_origin as a coarse enum.
  --------------------------------------------------------------------------- */

  // Per TAB, never persisted, never derived from ftHomeNode or author_node. A
  // stable id would turn a public log into a cross-visit tracker for relatives.
  const SESSION = (function () {
    try {
      const a = new Uint8Array(8);
      crypto.getRandomValues(a);
      return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return 'nocrypto';
    }
  })();

  let queue = [];
  let dropped = 0;
  let fails = 0;
  let open = true;           // false once the breaker trips
  let timer = null;

  function origin() {
    try {
      const h = String(location.protocol) === 'file:' ? 'file' : String(location.hostname || '');
      if (h === 'file') return 'file';
      if (/github\.io$/.test(h)) return 'pages';
      if (h === 'localhost' || h === '127.0.0.1') return 'localhost';
      return 'other';
    } catch (e) { return 'other'; }
  }

  function role() {
    try {
      if (typeof FTPropose === 'undefined') return 'admin';
      return FTPropose.isOn() ? 'propose' : 'viewer';
    } catch (e) { return null; }
  }

  function version() {
    try { return String(window.FT_BUILD || '').slice(0, 40) || null; } catch (e) { return null; }
  }

  function flush() {
    timer = null;
    if (!open || queue.length === 0) return;
    if (typeof FTSupa === 'undefined' || !FTSupa.configured()) { queue = []; return; }

    const batch = queue;
    queue = [];
    if (dropped > 0) {
      // Say so, rather than letting a hole look like nothing happening.
      batch.push(row('log.gap', { dropped: dropped, reason: 'queue overflow or breaker' }));
      dropped = 0;
    }

    // Never awaited by a caller, and its rejection is handled here so it cannot
    // surface as an unhandled rejection.
    FTSupa.insert(TABLE, batch).then(
      () => { fails = 0; },
      () => {
        fails++;
        dropped += batch.length;
        // Open the breaker rather than retrying forever: on a bad network, log
        // requests would otherwise compete with the one request that matters,
        // FTGitHub.publish.
        if (fails >= FAIL_MAX) open = false;
      });
  }

  function row(event, detail) {
    let who = { node: null, name: null };
    try { if (typeof FTPropose !== 'undefined') who = FTPropose.me(); } catch (e) {}
    return {
      client_ts: new Date().toISOString(),
      session: SESSION,
      role: role(),
      event: event,
      subject_kind: (detail && detail._kind) || null,
      subject_id: (detail && detail._id) ? String(detail._id).slice(0, 64) : null,
      author_node: who.node ? String(who.node).slice(0, 32) : null,
      author_name: who.name ? String(who.name).slice(0, 80) : null,
      app_version: version(),
      page_origin: origin(),
      detail: clean(detail),
    };
  }

  // Bounded, primitives only. An object or a long string here is either a secret
  // or a tree, and neither belongs in a public table.
  function clean(detail) {
    const out = {};
    if (!detail || typeof detail !== 'object') return out;
    let n = 0;
    for (const k of Object.keys(detail)) {
      if (k === '_kind' || k === '_id') continue;
      if (n++ >= 12) break;
      const v = detail[k];
      if (v == null) continue;
      if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
      if (typeof v === 'string') { out[k] = v.slice(0, 120); continue; }
      if (Array.isArray(v)) { out[k] = v.slice(0, 10).map(x => String(x).slice(0, 64)); continue; }
      // Anything else is dropped rather than serialised blindly.
    }
    return out;
  }

  return {
    session: function () { return SESSION; },
    pending: function () { return queue.length; },
    dropped: function () { return dropped; },
    isOpen: function () { return open; },

    // The single entry point. Returns nothing useful and never throws.
    emit: function (event, detail) {
      try {
        if (!open) { dropped++; return; }
        if (queue.length >= QUEUE_MAX) { queue.shift(); dropped++; }
        queue.push(row(event, detail));
        if (timer === null) timer = setTimeout(flush, FLUSH_MS);
      } catch (e) { /* a logger must not be a failure mode */ }
    },

    // Called once at boot. THE highest-value row: it pins which published tree
    // this browser is working from, which is the thing git cannot show.
    boot: function () {
      try {
        const stamp = FTChangeLog.baselineStamp();
        const rep = FTChangeLog.draftReport();
        const div = FTChangeLog.draftDivergence();
        this.emit('boot', {
          _kind: 'draft',
          base_people: stamp ? stamp.people : null,
          base_partnerships: stamp ? stamp.partnerships : null,
          base_hash: stamp ? stamp.hash : null,
          live_people: Object.keys(state.people).length,
          had_draft: !!rep,
          baseline_matched: rep ? rep.baselineMatched : null,
          restored: rep ? rep.restored.length : 0,
          kept_deleted: rep ? rep.keptDeleted.length : 0,
          draft_saved_at: rep ? rep.savedAt : null,
          divergence: div.missing.length,
          log_count: FTChangeLog.count(),
        });
      } catch (e) { /* never block a boot */ }
    },

    // Flush what is queued before the tab goes away. Best effort: FTSupa.request
    // does not set keepalive, so the last batch can still be lost — which is why
    // nothing depends on a row arriving.
    initUnload: function () {
      try {
        window.addEventListener('pagehide', flush);
        window.addEventListener('error', e => {
          // Basename only: a full path leaks the owner's home directory.
          const f = String((e && e.filename) || '').split('/').pop();
          this.emit('error', { message: String((e && e.message) || '').slice(0, 120),
                               file: f, line: (e && e.lineno) || null });
        });
        window.addEventListener('unhandledrejection', e => {
          const m = e && e.reason && e.reason.message ? e.reason.message : String(e && e.reason);
          this.emit('error', { message: String(m).slice(0, 120), kind: 'rejection' });
        });
      } catch (e) { /* ignore */ }
    },
  };
})();
