/* ============================================================================
   github.js — commit data/family.js and data/changes.jsonl from the browser.

   Replaces "download a file, find the repo, replace it, commit, push" with one
   button. Git stays the source of truth, so history, diffs and revert keep
   working exactly as they do now; this only changes who types the commit.

   TOKEN, HONESTLY: this needs a GitHub personal access token, and unlike
   ADMIN_HASH in auth.js — which is a hash, is useless to an attacker, and is
   published on purpose — a token is a real credential. Whoever holds it can
   write to the repo.

   What limits the damage:
     - Fine-grained token, Contents: read+write, THIS REPOSITORY ONLY. It
       cannot touch other repos, settings, or your account.
     - Kept in localStorage on one device. Never committed, never exported,
       never put in a URL or a commit message.
     - Revocable instantly at github.com/settings/tokens, which invalidates it
       everywhere at once.
     - Give it an expiry. A token that dies on its own is one you cannot
       forget about.

   Do not enter it on a shared or untrusted machine.

   Two files must land in ONE commit, or a crash between two calls leaves the
   tree and its changelog describing different things. The contents API writes
   one file per call, so this uses the lower-level Git Data API: blobs -> tree
   -> commit -> move the ref. More calls, but atomic.
============================================================================ */

// A lost race for the branch tip, as opposed to a real failure. GitHub answers
// 422 "Update is not a fast forward" when the ref moved between our read and
// our write. Matched on the message as well as the status because 422 covers
// plenty of other things, and only this one is worth retrying.
function isFastForwardRace(err) {
  const m = String((err && err.message) || '');
  return /not a fast forward/i.test(m) || (/\b422\b/.test(m) && /refs\/heads/.test(m));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

var FTGitHub = window.FTGitHub = (function () {
  const OWNER  = 'sramij-code';
  const REPO   = 'jayyusifamiytree';
  const BRANCH = 'main';               // never release: publishing stays a
                                       // deliberate promotion, as it is today
  const API    = 'https://api.github.com';
  const TOKEN_KEY = 'ftGitHubToken';

  const FAMILY_PATH = 'data/family.js';
  const LOG_PATH    = 'data/changes.jsonl';

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t.trim());
      else localStorage.removeItem(TOKEN_KEY);
      return true;
    } catch (e) { return false; }
  }

  // btoa() throws on any code point above 0xFF, so it cannot encode a single
  // Arabic name. Encode to UTF-8 bytes first, then to base64.
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function api(path, options) {
    const res = await fetch(API + path, Object.assign({}, options, {
      headers: Object.assign({
        'Authorization': 'Bearer ' + token(),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }, (options && options.headers) || {}),
    }));

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* body not json */ }

      // GitHub names the exact permission a fine-grained token was missing in
      // this header. Far more useful than the generic message body.
      const needs = res.headers.get('x-accepted-github-permissions') || '';

      if (res.status === 401) {
        throw new Error('Token rejected (401). It is invalid or expired. ' + detail);
      }
      if (res.status === 403) {
        throw new Error(
          'Token lacks permission (403) for ' + path + '. ' +
          (needs ? 'GitHub requires: ' + needs + '. ' : '') +
          'Fine-grained tokens need Repository permissions → Contents: Read and write, ' +
          'with this repository selected. ' + detail);
      }
      if (res.status === 404) {
        throw new Error(
          'Not found (404) for ' + path + '. Either the token does not list ' +
          OWNER + '/' + REPO + ' under its selected repositories, or the branch ' +
          BRANCH + ' does not exist. ' + detail);
      }
      if (res.status === 422) {
        // Kept verbatim: publish() matches on this text to detect a lost race
        // for the branch tip and retry from a fresh read.
        throw new Error('GitHub 422 on ' + path + '. ' + detail);
      }
      throw new Error('GitHub ' + res.status + ' on ' + path + '. ' + detail);
    }
    return res.status === 204 ? null : res.json();
  }

  // The changelog is append-only across publishes, so the existing file has to
  // be read before writing. Absent on the first publish, which is not an error.
  async function fetchExistingLog() {
    try {
      const r = await api('/repos/' + OWNER + '/' + REPO + '/contents/' +
                          LOG_PATH + '?ref=' + BRANCH, { method: 'GET' });
      return r && r.content ? base64ToUtf8(r.content) : '';
    } catch (e) {
      return '';   // 404 on first publish
    }
  }

  function familyFileBody() {
    const out = {
      people: state.people,
      partnerships: state.partnerships,
      loggedInUser: state.loggedInUser,
      root: state.root || 'p1',
    };
    // Byte-for-byte the shape data/family.js already has, so the committed
    // diff is a data diff and not a reformat of the whole file.
    return 'window.FT_FAMILY = ' + JSON.stringify(out, null, 2) + ';\n' +
           '// Top-level `var` so the binding exists for classic scripts, not just as a\n' +
           '// window property. Keeps the data layer swappable without touching core.\n' +
           'var familyData = window.FT_FAMILY;\n';
  }

  return {
    hasToken: function () { return !!token(); },
    setToken: setToken,
    clearToken: function () { setToken(''); },
    branch: BRANCH,

    // Verify by calling what publish actually calls first.
    //
    // The obvious check — GET /repos and read .permissions.push — is worthless
    // here: that field describes the authenticated USER's access to the repo,
    // not the permissions granted to the token. As the repo owner it is always
    // true, so a token with no Contents permission passed verification and
    // then failed at publish with a 403.
    //
    // Reading a git ref requires Contents, so this catches that. Write cannot
    // be proven without writing, so it is named as unverified rather than
    // implied.
    verify: async function () {
      const base = '/repos/' + OWNER + '/' + REPO;
      await api(base + '/git/ref/heads/' + BRANCH, { method: 'GET' });
      return OWNER + '/' + REPO + ' (' + BRANCH + ')';
    },

    // blobs -> tree -> commit -> ref. Both files in one commit.
    //
    // Retries once if the branch moves mid-flight. That is not hypothetical: it
    // happened the first time two commits landed close together — the ref was
    // read, then main advanced, and the PATCH was correctly refused with
    // "Update is not a fast forward". The edits were safe in the draft but the
    // only way forward was to reload and start over.
    //
    // Rebuilding on the fresh tip is the whole fix. These are file-level
    // writes, so a moved branch is not a content conflict: re-read the ref,
    // rebase the tree onto the new commit, and the update fast-forwards. The
    // one thing that must be re-read rather than reused is data/changes.jsonl,
    // since the commit we lost the race to may have appended to it — reusing
    // the stale copy would silently drop its lines.
    publish: async function (progress) {
      const say = progress || function () {};
      if (!token()) throw new Error('No GitHub token set.');
      if (FTChangeLog.count() === 0) throw new Error('No changes to publish.');

      const base = '/repos/' + OWNER + '/' + REPO;
      const ATTEMPTS = 4;

      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        if (attempt > 1) {
          // Wait before re-reading, and lengthen each time.
          //
          // Retrying instantly was useless against the actual cause. GitHub's
          // REST API is read-after-write eventually consistent: for a second or
          // two after a commit, GET /git/ref can still answer with the previous
          // sha. An immediate retry re-reads that same stale value and fails
          // identically, so all attempts burned in under a second and the user
          // saw the 422 anyway. The delay is what lets the read catch up.
          const waitMs = 600 * Math.pow(2, attempt - 2);   // 600, 1200, 2400
          say('branch moved, retrying in ' + Math.round(waitMs / 100) / 10 + 's…');
          await sleep(waitMs);
        }

        say('reading branch…');
        // no-cache so neither the browser nor a CDN hands back a ref we have
        // already seen be wrong.
        const ref = await api(base + '/git/ref/heads/' + BRANCH, {
          method: 'GET', headers: { 'Cache-Control': 'no-cache' },
        });
        const headSha = ref.object.sha;
        const headCommit = await api(base + '/git/commits/' + headSha, { method: 'GET' });

        // Inside the loop deliberately: see the note above about changes.jsonl.
        say('reading changelog…');
        const existing = await fetchExistingLog();
        const appended = (existing ? existing.replace(/\n*$/, '\n') : '') +
                         FTChangeLog.toJSONL() + '\n';

        say('uploading files…');
        const familyBlob = await api(base + '/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: utf8ToBase64(familyFileBody()), encoding: 'base64' }),
        });
        const logBlob = await api(base + '/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: utf8ToBase64(appended), encoding: 'base64' }),
        });

        say('building commit…');
        // base_tree keeps every other file in the repo untouched.
        const tree = await api(base + '/git/trees', {
          method: 'POST',
          body: JSON.stringify({
            base_tree: headCommit.tree.sha,
            tree: [
              { path: FAMILY_PATH, mode: '100644', type: 'blob', sha: familyBlob.sha },
              { path: LOG_PATH,    mode: '100644', type: 'blob', sha: logBlob.sha },
            ],
          }),
        });

        const commit = await api(base + '/git/commits', {
          method: 'POST',
          body: JSON.stringify({
            message: FTChangeLog.commitMessage(),
            tree: tree.sha,
            parents: [headSha],
          }),
        });

        say('moving branch…');
        try {
          // Still no force: losing the race must never discard someone else's
          // commit. Retrying from a fresh read is the safe way to win it.
          await api(base + '/git/refs/heads/' + BRANCH, {
            method: 'PATCH',
            body: JSON.stringify({ sha: commit.sha, force: false }),
          });
        } catch (e) {
          if (isFastForwardRace(e) && attempt < ATTEMPTS) continue;
          if (isFastForwardRace(e)) {
            // Out of attempts. Nothing is lost — the draft is untouched — but
            // say what to do, because the raw GitHub wording explains nothing.
            throw new Error('The branch kept moving while publishing (' + ATTEMPTS +
              ' attempts). Your edits are safe in the draft — reload the page ' +
              'and press COMMIT again.');
          }
          throw e;
        }

        return { sha: commit.sha, count: FTChangeLog.count(), branch: BRANCH, attempts: attempt };
      }
    },
  };
})();
