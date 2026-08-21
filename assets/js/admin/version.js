/* ============================================================================
   version.js — which BUILD is this page running? Admin only.

   WHY THIS EXISTS. Four separate rounds of debugging in two days ended with "hard
   reload and try again", and in every one of them neither of us could state which
   version of the code was in the browser. GitHub Pages serves assets with
   `cache-control: max-age=600` and rebuilds 10s–2min behind a push, so "I pushed a
   fix" and "the admin is running that fix" are different facts separated by an
   unknown interval. The publish bar could say what the DATA was
   (data/published.json) and nothing at all about the CODE.

   HOW IT ANSWERS EXACTLY, not approximately. A build timestamp would only ever be a
   heuristic — clock skew, an unchanged file, a rebuild with no content change. So
   instead compute the **git blob sha** of the deployed file this page actually
   loaded, and compare it with the blob sha git has for that path at the branch tip.
   Git's object id is defined as sha1("blob <bytelength>\0" + bytes), which a browser
   can compute, so the comparison is byte-exact and needs no build step — which
   matters, because this project deliberately has none.

   Equal shas mean the running copy IS the tip's copy. Different shas mean it is not.
   There is no third answer that looks like either: a read that failed is `unknown`
   and says so, for the same reason FTProposalStatus refuses to collapse "could not
   ask" into "nothing pending".

   NOT SECURITY, and not a guarantee about the whole site. It compares ONE probe
   file. A page could in principle be running a stale copy of some other file while
   the probe matches; the probe is chosen as the file that changes when the admin
   publish logic changes, which is what has actually gone wrong. It is a debugging
   instrument, like opslog.js, and it also finally sets window.FT_BUILD so ops_log
   rows stop recording a null version.

   Classic script (no ES modules) so the site still works over file://.
============================================================================ */

var FTVersion = window.FTVersion = (function () {
  // Deliberately NOT imported from FTGitHub: this must work before CONNECT GITHUB,
  // and duplicating three constants is cheaper than making a diagnostic depend on
  // the module whose failures it exists to diagnose.
  const OWNER  = 'sramij-code';
  const REPO   = 'jayyusifamiytree';
  const BRANCH = 'main';

  // The probe. Chosen because it is the file that changes when the publish and
  // commit logic changes, which is the code whose version has actually mattered
  // every time. Keep it a file that is edited often; a rarely-touched file would
  // report "current" through a dozen real changes elsewhere.
  const PROBE = 'assets/js/admin/github.js';

  let last = null;   // the most recent report, for the console and the title

  function bust(path) {
    // Same reasoning as github.js: Pages sends max-age=600 on assets, so without
    // this the probe reads whatever the browser cached — which would make the
    // freshness check itself stale, the most useless possible failure.
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return path + (path.indexOf('?') === -1 ? '?' : '&') + '_cb=' + tag;
  }

  /* Git's object id for a blob: sha1("blob " + bytelength + "\0" + bytes).
     BYTE length, not string length — every Arabic name in this repo is multi-byte,
     so using str.length would produce a wrong header and a sha that never matches. */
  async function blobShaOf(text) {
    try {
      if (!(window.crypto && crypto.subtle && crypto.subtle.digest)) return null;
      const body = new TextEncoder().encode(text);
      const head = new TextEncoder().encode('blob ' + body.length + '\0');
      const buf = new Uint8Array(head.length + body.length);
      buf.set(head, 0);
      buf.set(body, head.length);
      const digest = await crypto.subtle.digest('SHA-1', buf);
      return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // No secure context (file://), or SHA-1 unavailable. `unknown`, never a guess.
      return null;
    }
  }

  // Unauthenticated when there is no token: the repo is public, so a version readout
  // must not require CONNECT GITHUB. With a token the rate limit is 5000/hr instead
  // of 60, which is the only difference.
  async function gh(path) {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    try {
      const t = localStorage.getItem('ftGitHubToken');
      if (t) headers['Authorization'] = 'Bearer ' + t;
    } catch (e) { /* storage blocked; unauthenticated is fine */ }
    const res = await fetch('https://api.github.com' + bust(path), { headers: headers });
    if (!res.ok) {
      const err = new Error('GitHub ' + res.status + ' on ' + path);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /* The pure part, so the interesting logic is testable without a network.

     `unknown` whenever either side is missing. The temptation is to fall back to
     comparing timestamps when a sha is unavailable, which would reintroduce exactly
     the guess this module exists to avoid. */
  function classify(runningSha, branchSha) {
    if (!runningSha || !branchSha) return 'unknown';
    return runningSha === branchSha ? 'current' : 'behind';
  }

  function subjectOf(message) {
    return String(message || '').split('\n')[0].slice(0, 90);
  }

  return {
    probe: function () { return PROBE; },
    classify: classify,
    blobShaOf: blobShaOf,
    subjectOf: subjectOf,
    last: function () { return last ? Object.assign({}, last) : null; },

    /* Everything the readout needs, in one call.

       Each half is independently allowed to fail: the tip commit is what a human
       wants to READ ("which change am I looking at"), the blob comparison is what
       decides current-versus-behind. Losing one must not blank the other, because a
       readout that goes empty on any error is a readout nobody trusts. */
    check: async function () {
      const out = {
        state: 'unknown', running: null, branch: null,
        sha: null, subject: null, date: null, deployedAt: null, reason: null,
      };

      // 1. The bytes this page is actually running.
      try {
        const res = await fetch(bust(PROBE), { cache: 'no-store' });
        if (res.ok) {
          out.deployedAt = res.headers.get('last-modified') || null;
          out.running = await blobShaOf(await res.text());
          if (!out.running) out.reason = 'this browser cannot compute a sha (no secure context?)';
        } else {
          out.reason = 'could not re-read ' + PROBE + ' (' + res.status + ')';
        }
      } catch (e) {
        out.reason = 'could not re-read ' + PROBE + ' (' + (e && e.message) + ')';
      }

      // 2. What git has at the tip, for the same path and for the commit itself.
      try {
        const [blob, commit] = await Promise.all([
          gh('/repos/' + OWNER + '/' + REPO + '/contents/' + PROBE + '?ref=' + BRANCH),
          gh('/repos/' + OWNER + '/' + REPO + '/commits/' + BRANCH),
        ]);
        out.branch  = (blob && blob.sha) || null;
        out.sha     = (commit && commit.sha) || null;
        out.subject = subjectOf(commit && commit.commit && commit.commit.message);
        out.date    = (commit && commit.commit && commit.commit.committer &&
                       commit.commit.committer.date) || null;
      } catch (e) {
        // Rate limiting is the common one and deserves naming, since it resolves on
        // its own and is not a bug in the site.
        out.reason = (e && e.status === 403)
          ? 'api.github.com refused the read (rate limit?) — press CONNECT GITHUB to raise it'
          : 'could not read the branch (' + (e && e.message) + ')';
      }

      out.state = classify(out.running, out.branch);
      last = out;

      // Now ops_log rows can name the code that produced them. A blob sha of a file
      // that is public anyway, so this leaks nothing: see the exclusions in opslog.js.
      if (out.running) window.FT_BUILD = out.running.slice(0, 12);
      return out;
    },

    /* Paint it. Separate from check() so a test can drive either alone, and so a
       failed render can never swallow the report. */
    render: function (report) {
      const el = document.getElementById('version-state');
      if (!el) return;
      const r = report || last;
      if (!r) { el.textContent = '⋯ CHECKING BUILD'; el.className = ''; return; }

      const tip = (r.sha ? r.sha.slice(0, 7) : '???') +
                  (r.subject ? ' “' + r.subject + '”' : '');

      if (r.state === 'current') {
        el.textContent = '○ BUILD CURRENT · ' + tip;
        el.className = '';
      } else if (r.state === 'behind') {
        // Names the remedy, because this state is always the same remedy and the
        // owner has had to be told it four times.
        el.textContent = '▲ BUILD BEHIND · running older code · main is ' + tip;
        el.className = 'dirty';
      } else {
        // Must not read as either of the above. "Unknown" is a third thing.
        el.textContent = '? BUILD UNKNOWN' + (r.sha ? ' · main is ' + tip : '');
        el.className = '';
      }

      const lines = [];
      if (r.state === 'behind') {
        lines.push('This page is running an OLDER copy of ' + PROBE + ' than ' + BRANCH +
                   ' has. Hard-reload (⌥⌘R). If it persists, GitHub Pages has not ' +
                   'finished deploying — it runs 10s to ~2min behind a push.');
      }
      if (r.subject) lines.push('main tip: ' + (r.sha || '') + '\n  ' + r.subject);
      if (r.date) lines.push('committed: ' + r.date);
      if (r.deployedAt) lines.push('this copy served: ' + r.deployedAt);
      if (r.running) lines.push('running blob:  ' + r.running);
      if (r.branch)  lines.push('branch blob:   ' + r.branch);
      if (r.reason)  lines.push('note: ' + r.reason);
      lines.push('compared file: ' + PROBE);
      el.title = lines.join('\n');
    },

    // Called once at boot, and cheap enough to re-run from the console after a push.
    // Never awaited by init(): a version readout must not delay or break the page.
    init: function () {
      this.render(null);
      const self = this;
      this.check().then(r => self.render(r), () => self.render(null));
    },
  };
})();
