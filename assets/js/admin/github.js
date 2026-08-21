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

   Files must land in ONE commit, or a crash between two calls leaves the tree
   and its changelog describing different things. The contents API writes one
   file per call, so this uses the lower-level Git Data API: blobs -> tree ->
   commit -> move the ref. More calls, but atomic.

   Three files, and which of them are written depends on what changed:

     data/family.js               the tree            } together, or not at all
     data/changes.jsonl           what changed in it  }
     data/proposals-reviewed.json review decisions      independently

   Review decisions are their own axis because turning a proposal DOWN changes no
   tree and produces no changelog entry. That is why rejections used to be
   unpublishable — this refused to commit with an empty changelog, so a rejection
   never left the browser and reappeared as pending on any other device.
============================================================================ */

// A lost race for the branch tip, as opposed to a real failure. GitHub answers
// 422 "Update is not a fast forward" when the ref moved between our read and
// our write. Matched on the message as well as the status because 422 covers
// plenty of other things, and only this one is worth retrying.
function isFastForwardRace(err) {
  const m = String((err && err.message) || '');
  return /not a fast forward/i.test(m) || (/\b422\b/.test(m) && /refs\/heads/.test(m));
}

// Every error out of api() carries the HTTP status, because callers must be able to
// tell "absent" (404, genuinely empty before the first publish) from "unreadable"
// (anything else) — treating the second as empty is what silently deleted committed
// history. Only the fallback throw carried it before.
function withStatus(status, err) {
  err.status = status;
  return err;
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

  const FAMILY_PATH   = 'data/family.js';
  // A ~90-byte sidecar carrying the same publishedAt as family.js.
  //
  // family.js is loaded by a plain <script src> — no query string, so no cache
  // busting — and both the browser and the Pages CDN hold it for a long time. That
  // has now cost the owner three separate debugging rounds: a person was published,
  // the file in the browser predated it, and the site looked broken. 300KB is far too
  // big to re-fetch on every load just to check, so publish the stamp separately and
  // compare that instead.
  const PUBLISHED_PATH = 'data/published.json';
  const LOG_PATH      = 'data/changes.jsonl';
  const REVIEWED_PATH = 'data/proposals-reviewed.json';

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

  // EVERY GET here must be answered by GitHub, not by the browser's own cache.
  //
  // Measured, not assumed: `GET /git/ref/heads/main` and `GET /contents/...` both
  // come back with `cache-control: public, max-age=60, s-maxage=60`. So for a full
  // minute after any read, the browser answers the next identical read itself,
  // without a request. Three separate things in this file were built on the
  // assumption that a re-read sees the current branch, and all three were defeated
  // by that one header:
  //
  //   · the retry loop. It re-reads the ref precisely because the branch may have
  //     moved — and got the same cached sha every time. Observed 2026-08-20: four
  //     attempts across 12s all built on a parent that was already stale, so all
  //     four were correctly refused, and the owner was told the publish failed
  //     while their commit (ee9270b) was sitting on main.
  //   · the landed-write probe, which re-reads the ref to ask "did we already
  //     win?" — from the cache, so it answered with the pre-move sha.
  //   · fetchExistingLog. This is the dangerous one: reading a 60-second-stale
  //     changes.jsonl and appending to it DROPS whatever another commit added in
  //     between, which is the exact data loss its own comment promises to prevent.
  //
  // A query parameter, not a request header: `Cache-Control: no-cache` is not
  // CORS-safelisted, and GitHub does not list it in Access-Control-Allow-Headers,
  // so adding it makes the browser refuse the request before sending it — Safari
  // reports that as an opaque "Load failed". GitHub ignores unrecognised query
  // params (verified: 200 with `?_cb=…` on both endpoints).
  //
  // The tag must be unique per PAGE LOAD as well as per call. A plain counter
  // restarts at 1 on reload, so a fresh page's first read collides with the
  // previous page's first read and is served from cache — which is precisely the
  // reload-then-press-COMMIT-again path in the incident above. A wall-clock stamp
  // alone is not enough either: two loads inside the same millisecond collide.
  const LOAD_TAG = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  let cbSeq = 0;
  function bust(path) {
    const tag = LOAD_TAG + '-' + (++cbSeq);
    return path + (path.indexOf('?') === -1 ? '?' : '&') + '_cb=' + tag;
  }

  async function api(path, options) {
    let res;
    const method = (options && options.method) || 'GET';
    try {
      // Only GETs are cacheable, and only `path` is busted — every error message
      // below quotes the clean path, so they stay readable.
      res = await fetch(API + (method === 'GET' ? bust(path) : path), Object.assign({}, options, {
        headers: Object.assign({
          'Authorization': 'Bearer ' + token(),
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }, (options && options.headers) || {}),
      }));
    } catch (e) {
      // fetch rejects — as opposed to returning a non-ok response — only when
      // the request never completed: offline, DNS, or a CORS preflight refusal.
      // Safari words that "Load failed" and Chrome "Failed to fetch", neither of
      // which suggests where to look, so name the candidates. A CORS refusal
      // here means a request header was added that GitHub does not allow.
      throw new Error('Could not reach api.github.com (' + (e && e.message) + '). ' +
        'Check the connection; if it persists, the request was blocked before ' +
        'being sent — see the browser console for a CORS error.');
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* body not json */ }

      // GitHub names the exact permission a fine-grained token was missing in
      // this header. Far more useful than the generic message body.
      const needs = res.headers.get('x-accepted-github-permissions') || '';

      if (res.status === 401) {
        throw withStatus(res.status, new Error('Token rejected (401). It is invalid or expired. ' + detail));
      }
      if (res.status === 403) {
        throw withStatus(res.status, new Error(
          'Token lacks permission (403) for ' + path + '. ' +
          (needs ? 'GitHub requires: ' + needs + '. ' : '') +
          'Fine-grained tokens need Repository permissions → Contents: Read and write, ' +
          'with this repository selected. ' + detail));
      }
      if (res.status === 404) {
        throw withStatus(res.status, new Error(
          'Not found (404) for ' + path + '. Either the token does not list ' +
          OWNER + '/' + REPO + ' under its selected repositories, or the branch ' +
          BRANCH + ' does not exist. ' + detail));
      }
      if (res.status === 422) {
        // Kept verbatim: publish() matches on this text to detect a lost race
        // for the branch tip and retry from a fresh read.
        throw withStatus(res.status, new Error('GitHub 422 on ' + path + '. ' + detail));
      }
      // The status is carried on the error because "absent" and "unreadable" must
      // be distinguishable: one is safe to treat as empty, the other must abort.
      const err = new Error('GitHub ' + res.status + ' on ' + path + '. ' + detail);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  // The changelog is append-only across publishes, so the existing file has to
  // be read before writing. Absent on the first publish, which is not an error.
  // ABSENT and UNREADABLE are not the same thing.
  //
  // These both returned empty on ANY throw — a 403, a network blip, a torn
  // response. The caller then rebuilds the file from empty + local, so one failed
  // GET silently deleted every previously committed line: all of data/changes.jsonl,
  // or every decision in data/proposals-reviewed.json. The old comment even said
  // "a hand-edit we should not clobber" while doing precisely that.
  //
  // 404 alone means the file does not exist yet, which is genuinely empty and only
  // true before the first publish. Anything else aborts the publish: the local
  // draft is untouched, so refusing costs a retry, while proceeding costs history.
  async function fetchExistingLog() {
    try {
      const r = await api('/repos/' + OWNER + '/' + REPO + '/contents/' +
                          LOG_PATH + '?ref=' + BRANCH, { method: 'GET' });
      return r && r.content ? base64ToUtf8(r.content) : '';
    } catch (e) {
      if (e && e.status === 404) return '';
      throw new Error('Refusing to publish: could not read ' + LOG_PATH + ' (' +
        e.message + '). Continuing would rewrite it from scratch and drop every ' +
        'committed line. Your edits are safe in the draft — try again.');
    }
  }

  // The committed decisions, needed before writing so the file stays append-only
  // across publishes. Absent on the first one, which is not an error.
  async function fetchExistingReviewed() {
    try {
      const r = await api('/repos/' + OWNER + '/' + REPO + '/contents/' +
                          REVIEWED_PATH + '?ref=' + BRANCH, { method: 'GET' });
      const doc = JSON.parse(base64ToUtf8(r.content));
      // Malformed is NOT empty either: a hand-edit that broke the JSON must not be
      // silently replaced by whatever this browser happens to hold locally.
      if (!doc || !Array.isArray(doc.decisions)) {
        throw new Error(REVIEWED_PATH + ' is not in the expected shape');
      }
      return doc.decisions;
    } catch (e) {
      if (e && e.status === 404) return [];
      throw new Error('Refusing to publish: could not read ' + REVIEWED_PATH + ' (' +
        e.message + '). Continuing would rewrite it from scratch and drop every ' +
        'committed decision. Your decisions are safe locally — try again.');
    }
  }

  /* ---------------------------------------------------------------------------
     IS THIS WORK ALREADY ON THE BRANCH?

     Asked by identity of the work, NOT by tree sha — that distinction is the
     whole point, and getting it wrong is why the false failure came back after
     it had supposedly been fixed.

     The old probe compared the tip's tree sha against the tree we just built, on
     the reasoning that identical content means identical trees. It cannot work
     here: familyFileBody() stamps `publishedAt: new Date()` into data/family.js,
     and the sidecar carries the same stamp. Two publishes of a byte-identical
     TREE therefore produce two different blobs and two different tree shas, so
     the comparison can only ever match for a decisions-only publish — which is
     exactly the one case (332dedd, "Record 2 rejections") it was tested against.
     Any publish carrying an edit slipped straight past it.

     A changelog entry's `ts` is assigned once in FTChangeLog.record() and stored,
     so it survives a reload and appears verbatim in the committed line. That makes
     it a durable identity for the edit, which is what we actually want to ask
     about: not "is the repo in the state I built" but "is my work in the repo".
  --------------------------------------------------------------------------- */
  function logFingerprint(e) {
    return [e && e.ts, e && e.op, e && e.target, e && e.id].join('|');
  }

  function landedLogKeys(existing) {
    const keys = new Set();
    for (const line of String(existing || '').split('\n')) {
      if (!line.trim()) continue;
      // A hand-edited or truncated line is skipped rather than throwing: treating
      // it as "not landed" is the safe direction, since it leads to a publish
      // attempt rather than to silently dropping an edit.
      try { keys.add(logFingerprint(JSON.parse(line))); } catch (e) { /* skip */ }
    }
    return keys;
  }

  // Every axis we mean to publish is already committed. Deliberately AND, not OR:
  // a publish that landed its changelog but not its decisions is not done.
  //
  // Reads are allowed to throw. fetchExistingLog/fetchExistingReviewed refuse on
  // anything but a 404, and if we cannot read the branch we must not guess in
  // either direction — the publish would fail on the same read seconds later.
  async function alreadyPublished(logEntries, decisions) {
    let editsLanded = true;
    let decisionsLanded = true;

    if (logEntries.length > 0) {
      const keys = landedLogKeys(await fetchExistingLog());
      editsLanded = logEntries.every(e => keys.has(logFingerprint(e)));
    }
    if (decisions.length > 0) {
      const committed = await fetchExistingReviewed();
      // FTReview owns the key format. Duplicating the formula here is how the
      // id@at-versus-id@at#decision bug happened once already.
      const keys = new Set(committed.map(FTReview.decisionKey));
      decisionsLanded = decisions.every(d => keys.has(FTReview.decisionKey(d)));
    }
    return editsLanded && decisionsLanded;
  }

  // The commit subject has to describe whichever axis actually changed, or a
  // rejection-only commit reads as "Update family data" and the log lies about
  // what happened.
  function commitMessageFor(edits, decisions) {
    const rejected  = decisions.filter(d => d.decision === 'rejected').length;
    const reinstated = decisions.filter(d => d.decision === 'reinstated').length;

    const parts = [];
    if (rejected)   parts.push(rejected + (rejected === 1 ? ' rejection' : ' rejections'));
    if (reinstated) parts.push(reinstated + (reinstated === 1 ? ' reinstatement' : ' reinstatements'));
    const decisionText = parts.join(' and ');

    if (edits === 0) {
      // The ids, so the commit is self-describing without opening the JSON. Not
      // the notes: they are free text from the reviewer and belong in the file,
      // not in a subject line that tooling parses.
      const body = decisions
        .map(d => '  ' + (d.decision === 'rejected' ? '✕' : '↺') + ' ' + d.id)
        .join('\n');
      return 'Record ' + decisionText + '\n\n' + body + '\n\nPublished from admin.html';
    }

    const msg = FTChangeLog.commitMessage();
    if (!decisionText) return msg;
    // Append rather than rebuild, so the edit description stays the subject.
    return msg.replace(/\n\nPublished from admin\.html$/,
                       '\n\nAlso recorded ' + decisionText + '\n\nPublished from admin.html');
  }

  // One stamp per publish, shared by family.js and the sidecar.
  let familyStamp = null;

  function familyFileBody() {
    familyStamp = new Date().toISOString();
    const out = {
      people: state.people,
      partnerships: state.partnerships,
      loggedInUser: state.loggedInUser,
      root: state.root || 'p1',
      // When this data was published, so the UI can say how old a local copy is
      // relative to it. Note for tools/rebuild_from_excel.py: this field is added at
      // publish time and will not appear in a rebuild, so a byte-identical comparison
      // must ignore it.
      publishedAt: familyStamp,
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

      // Either axis alone is a reason to commit. Requiring a changelog entry is
      // what made rejections unpublishable.
      const edits = FTChangeLog.count();
      const pendingDecisions =
        typeof FTReview !== 'undefined' ? FTReview.uncommitted() : [];
      if (edits === 0 && pendingDecisions.length === 0) {
        throw new Error('No changes to publish.');
      }

      // Layer 2 of the stale-draft guard. familyFileBody() is written from state,
      // so a draft hiding committed people turns a publish into a deletion with no
      // changelog entry naming it. Checked here as well as in commitFamily because
      // this is the function that actually moves the ref.
      // A rejected localStorage write leaves state holding a mutation the changelog
      // has no entry for, and familyFileBody() serialises state regardless.
      if (edits > 0 && typeof FTChangeLog.saveFailed === 'function' && FTChangeLog.saveFailed()) {
        throw new Error('Refusing to publish: this browser could not save the draft, so ' +
          'the tree may contain an edit with no changelog line. Reload and redo it.');
      }

      if (edits > 0 && typeof FTChangeLog.draftDivergence === 'function') {
        const hidden = FTChangeLog.draftDivergence();
        if (hidden.missing.length > 0) {
          throw new Error('Refusing to publish: this browser\'s draft is hiding ' +
            hidden.missing.length + ' person(s) present in data/family.js (' +
            hidden.names.join(', ') + '). Publishing would delete them. Discard the ' +
            'stale draft and reload first.');
        }
      }

      const base = '/repos/' + OWNER + '/' + REPO;
      const ATTEMPTS = 4;

      if (typeof FTLog !== 'undefined') {
        FTLog.emit('publish.commit.start', { edits: edits, decisions: pendingDecisions.length, branch: BRANCH });
      }

      // ---- BEFORE building anything: has this already been published? --------
      //
      // The landed-write probe inside the catch below can only rescue a race that
      // happens within one call to publish(). It cannot help the case that actually
      // keeps happening, which is one page load further out:
      //
      //   the PATCH succeeds server-side → the client never registers it (slow
      //   response, closed tab, reload) → commitFamily therefore never clears the
      //   log → the edit is still pending after the reload → COMMIT is pressed
      //   again → and now the branch is genuinely ahead of everything this page
      //   knows, so all four attempts are refused and the owner is told the
      //   publish failed for a second time.
      //
      // That is the 2026-08-20 Rola1 incident exactly: ee9270b landed at 23:43:06,
      // a fresh page load started a second publish of the same edit at 23:43:25,
      // and it failed four times. Nothing was lost and nothing was duplicated, but
      // the only reason it was not duplicated is that the stale ref read made the
      // PATCH fail — had the cache expired first, the same delete would have been
      // committed twice.
      //
      // So ask first. This is also the only guard that makes pressing COMMIT twice
      // safe, which is what every previous error message asked the owner to reason
      // about by hand.
      const logEntries = FTChangeLog.entries();
      say('checking the branch…');
      if (await alreadyPublished(logEntries, pendingDecisions)) {
        const ref = await api(base + '/git/ref/heads/' + BRANCH, { method: 'GET' });
        say('already published');
        if (typeof FTLog !== 'undefined') {
          FTLog.emit('publish.commit.ok', { _kind: 'commit', _id: ref.object.sha.slice(0, 7),
            edits: edits, decisions: pendingDecisions.length, attempts: 0,
            via: 'already_on_branch' });
        }
        // Flagging them is what lets commitFamily clear the log and the draft, so
        // the pending work stops being pending. Skipping this is what left the same
        // edit staged for a third attempt.
        if (pendingDecisions.length > 0) FTReview.markCommitted(pendingDecisions);
        return { sha: ref.object.sha, count: edits, decisions: pendingDecisions.length,
                 branch: BRANCH, attempts: 0, alreadyLanded: true };
      }

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
        // Deliberately NO Cache-Control header. It is not a CORS-safelisted
        // request header, so asking for it makes the preflight negotiate it —
        // and GitHub's Access-Control-Allow-Headers does not list it, so the
        // browser blocks the request before it is sent and fetch rejects with
        // Safari's opaque "Load failed". It bought nothing either way: the
        // staleness this retry works around is GitHub's own read-after-write
        // lag on the server, which no request header can affect. The backoff
        // above is the actual fix.
        const ref = await api(base + '/git/ref/heads/' + BRANCH, { method: 'GET' });
        const headSha = ref.object.sha;
        const headCommit = await api(base + '/git/commits/' + headSha, { method: 'GET' });

        // Both append-only files are re-read inside the loop, for the same
        // reason: the commit we lost the race to may have appended to either,
        // and reusing a stale copy would silently drop its lines.
        say('uploading files…');
        const entries = [];

        if (edits > 0) {
          const existing = await fetchExistingLog();
          // APPEND ONLY WHAT IS NOT ALREADY THERE.
          //
          // Blind concatenation is the last way left to duplicate published history
          // permanently, and it has already done so: data/changes.jsonl carries four
          // distinct ops written three times each, 9 of 25 lines redundant, from an
          // approval that was retried after a commit the client thought had failed.
          // git cannot tell those apart from three real edits, so the changelog —
          // the file whose whole job is to say what happened — misreports it.
          //
          // Keyed on the same durable fingerprint as alreadyPublished(), so a
          // partially-landed publish appends its remainder and nothing more.
          const already = landedLogKeys(existing);
          const fresh = logEntries.filter(e => !already.has(logFingerprint(e)));
          const appended = (existing ? existing.replace(/\n*$/, '\n') : '') +
                           (fresh.length ? fresh.map(e => JSON.stringify(e)).join('\n') + '\n' : '');
          const familyBlob = await api(base + '/git/blobs', {
            method: 'POST',
            body: JSON.stringify({ content: utf8ToBase64(familyFileBody()), encoding: 'base64' }),
          });
          const logBlob = await api(base + '/git/blobs', {
            method: 'POST',
            body: JSON.stringify({ content: utf8ToBase64(appended), encoding: 'base64' }),
          });
          // Never one without the other: a tree whose changelog does not describe
          // it is worse than either file being a commit behind.
          // The sidecar carries the SAME stamp as the family blob, or a freshness check
          // would compare two different publishes and cry wolf.
          const stampedAt = familyStamp;
          const sidecar = await api(base + '/git/blobs', {
            method: 'POST',
            body: JSON.stringify({ content: utf8ToBase64(JSON.stringify({
              publishedAt: stampedAt,
              people: Object.keys(state.people).length,
              partnerships: state.partnerships.length,
            }, null, 2) + '\n'), encoding: 'base64' }),
          });
          entries.push({ path: FAMILY_PATH,    mode: '100644', type: 'blob', sha: familyBlob.sha });
          entries.push({ path: LOG_PATH,       mode: '100644', type: 'blob', sha: logBlob.sha });
          entries.push({ path: PUBLISHED_PATH, mode: '100644', type: 'blob', sha: sidecar.sha });
        }

        if (pendingDecisions.length > 0) {
          const committedNow = await fetchExistingReviewed();
          const body = FTReview.reviewedFileBody(committedNow);
          const reviewedBlob = await api(base + '/git/blobs', {
            method: 'POST',
            body: JSON.stringify({ content: utf8ToBase64(body), encoding: 'base64' }),
          });
          entries.push({ path: REVIEWED_PATH, mode: '100644', type: 'blob', sha: reviewedBlob.sha });
        }

        say('building commit…');
        // base_tree keeps every other file in the repo untouched.
        const tree = await api(base + '/git/trees', {
          method: 'POST',
          body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries }),
        });

        const commit = await api(base + '/git/commits', {
          method: 'POST',
          body: JSON.stringify({
            message: commitMessageFor(edits, pendingDecisions),
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
          // DID OUR OWN WRITE ALREADY LAND?
          //
          // This produced a FALSE FAILURE with real consequences. The REST API is
          // read-after-write eventually consistent, so: attempt 1's PATCH succeeds
          // server-side, the client does not register it, attempt 2 re-reads the ref
          // and is handed the PRE-MOVE sha, builds a commit on that stale parent, and
          // is correctly refused as not a fast forward. Attempts 3 and 4 repeat. The
          // user is told it failed while their commit is sitting on the branch.
          //
          // Observed: 332dedd landed at 02:44:36 carrying both decisions while the UI
          // reported four failed attempts. The old advice — "press COMMIT again" —
          // would then have recorded the same decisions twice, because the client
          // still had them flagged uncommitted.
          //
          // Asked by the identity of the work, not by tree sha. See alreadyPublished():
          // family.js embeds a per-publish `publishedAt`, so the tree sha of an
          // identical publish differs every time and the old comparison could not
          // match for anything carrying an edit. It matched for 332dedd only because
          // that commit was decisions-only.
          if (isFastForwardRace(e)) {
            try {
              if (await alreadyPublished(logEntries, pendingDecisions)) {
                const fresh = await api(base + '/git/ref/heads/' + BRANCH, { method: 'GET' });
                say('already published');
                if (typeof FTLog !== 'undefined') {
                  FTLog.emit('publish.commit.ok', { _kind: 'commit',
                    _id: fresh.object.sha.slice(0, 7), edits: edits,
                    decisions: pendingDecisions.length, attempts: attempt,
                    via: 'race_but_landed' });
                }
                if (pendingDecisions.length > 0) FTReview.markCommitted(pendingDecisions);
                return { sha: fresh.object.sha, count: edits,
                         decisions: pendingDecisions.length, branch: BRANCH,
                         attempts: attempt, alreadyLanded: true };
              }
            } catch (probe) { /* fall through to retry / failure */ }
          }

          if (isFastForwardRace(e) && attempt < ATTEMPTS) {
            if (typeof FTLog !== 'undefined') {
              FTLog.emit('publish.commit.fail', { reason: 'fast_forward_race',
                attempt: attempt, edits: edits, decisions: pendingDecisions.length });
            }
            continue;
          }
          if (isFastForwardRace(e)) {
            if (typeof FTLog !== 'undefined') {
              FTLog.emit('publish.commit.fail', { reason: 'fast_forward_exhausted',
                attempts: ATTEMPTS, edits: edits, decisions: pendingDecisions.length });
            }
            // Retrying is now SAFE, so say so. The old wording asked the owner to
            // reload, read the indicator and infer whether their own commit had
            // landed — a judgement the code can make and now does, both before the
            // first attempt and after each lost race. Pressing COMMIT again either
            // detects the work on the branch and clears it, or appends only the
            // lines that are genuinely missing.
            throw new Error('The branch kept moving while publishing (' + ATTEMPTS +
              ' attempts). Nothing was lost — your edits are still in the draft, and ' +
              'nothing was committed twice. Wait a moment and press COMMIT again: if ' +
              'the work did land, it will be recognised rather than repeated.');
          }
          if (typeof FTLog !== 'undefined') {
            FTLog.emit('publish.commit.fail', {
              reason: String((e && e.message) || '').slice(0, 120),
              edits: edits, decisions: pendingDecisions.length, attempt: attempt });
          }
          throw e;
        }

        // Only after the ref moved: until then nothing is durable, and flagging
        // early would leave a decision looking committed when it was not.
        if (pendingDecisions.length > 0) FTReview.markCommitted(pendingDecisions);

        if (typeof FTLog !== 'undefined') {
          FTLog.emit('publish.commit.ok', { _kind: 'commit', _id: commit.sha.slice(0, 7),
            edits: edits, decisions: pendingDecisions.length, attempts: attempt });
        }
        return { sha: commit.sha, count: edits, decisions: pendingDecisions.length,
                 branch: BRANCH, attempts: attempt };
      }
    },
  };
})();
