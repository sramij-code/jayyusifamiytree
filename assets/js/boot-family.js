/* ============================================================================
   boot-family.js — load data/family.js so a commit is actually SEEN.

   THE BUG THIS FIXES, stated plainly. The tree was delivered as a plain
   `<script src="data/family.js">`. That URL never changes between publishes, and
   GitHub Pages stamps every asset `cache-control: max-age=600` with the browser's
   own disk cache layered on top. So after the admin commits new data, the file on
   the branch is new but the URL is not, and a `<script src>` gives no way to force
   a refetch — the browser and the CDN keep serving the OLD bytes. `initState()`
   reads the frozen global once at boot, so the staleness is permanent for the life
   of the page. Every prior fix (the published.json sidecar, checkFreshness, the
   stale banner, the BUILD readout) only DETECTED this; none reloaded the data.
   Measured: an admin's tab sat two hours behind the committed tree.

   THE FIX. A ~90-byte sidecar, data/published.json, already carries a `publishedAt`
   stamp written on every publish. Read it first (it is tiny, and fetched with a
   unique query so it is never itself cached), then load
   `data/family.js?v=<publishedAt>`. The query is:
     · STABLE within a publish  → repeat loads hit cache, no 300KB re-download;
     · DIFFERENT after a publish → a URL the browser and CDN have never seen, so it
       is fetched fresh exactly once.
   Both the browser cache and the Pages CDN key on the full URL including the query,
   so `?v=` genuinely invalidates both. This does NOT defeat the Pages *build* lag
   (for the 10s–2min before Pages redeploys, the sidecar still returns the old
   stamp — nothing can fix that, the new file is not deployed yet); it defeats the
   CACHING that made a normal reload stay stale for up to ten minutes AFTER the
   deploy and effectively demand a hard reload. Once Pages has deployed, an ordinary
   Cmd+R is fresh.

   WHY THIS IS SAFE despite the "synchronous familyData" reputation. Nothing reads
   `familyData` at parse time — every reference is inside a function first called
   from init() (verified: state.js initState, changelog.js, proposal-status.js). So
   the real contract is only "familyData exists before init() runs", not "before the
   next <script> parses". This module exposes that as window.FT_BOOT, a promise the
   two boot scripts await before calling init().

   FILE:// AND OFFLINE. A query string on a file:// URL resolves to a missing path,
   and fetch() cannot read the sidecar there anyway. Both cases fall straight back
   to the plain `data/family.js`, i.e. exactly today's behaviour — no regression,
   and freshness there was already `unknown` by design.

   Classic script (no ES modules) so the site still works over file://. Loaded in
   BOTH index.html and admin.html, in place of the old family.js <script> tag.
============================================================================ */

window.FT_BOOT = (function () {
  var resolve;
  var promise = new Promise(function (r) { resolve = r; });

  // Resolve at most once, and NEVER reject: a boot that hangs is worse than one
  // that proceeds and fails the same way today would if family.js were missing.
  // init() awaits this promise; if the data truly could not load, letting init run
  // reproduces today's visible failure rather than a silent blank page.
  var settled = false;
  function done() { if (!settled) { settled = true; resolve(); } }

  function inject(url, onFail) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = done;
    s.onerror = onFail || done;
    // documentElement, not document.head: this runs before <head> is guaranteed
    // parsed on some engines, and documentElement always exists by now.
    (document.head || document.documentElement).appendChild(s);
  }

  function injectPlain() {
    // Last resort, and the file:// / offline path. No query, so file:// resolves.
    inject('data/family.js', done);
  }

  function injectStamped(stamp) {
    // If the stamped URL somehow fails (it should not — Pages serves the file and
    // ignores the query), fall back to the plain URL rather than leaving no data.
    inject('data/family.js?v=' + encodeURIComponent(stamp), function () {
      injectPlain();
    });
  }

  try {
    if (location.protocol === 'file:' || typeof fetch !== 'function') {
      injectPlain();
    } else {
      // Unique query + no-store: the sidecar itself must never be served stale, or
      // it would hand us an old stamp and we would load an old family.js.
      fetch('data/published.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (doc) {
          if (doc && doc.publishedAt) injectStamped(String(doc.publishedAt));
          else injectPlain();   // no sidecar yet (before the first publish): plain.
        })
        .catch(function () { injectPlain(); });
    }
  } catch (e) {
    injectPlain();
  }

  return promise;
})();
