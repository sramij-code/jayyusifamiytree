# RESUME — 2026-08-20 (late)

Written to survive a session compaction. `CLAUDE.md` covers architecture;
`HANDOFF.md` covers the older 2026-08-15 state. This file is **only** the
in-flight work and the traps that cost real time today.

---

## 1. Where we stopped

Working through a **design review's ranked plan** for one recurring class of bug:
*local state in localStorage silently shadows published data*. The owner hit it
five separate times over two days, each time reporting it as a site bug.

| # | item | state |
|---|---|---|
| 1 | `?fresh=1` + a DISCARD control on the viewer | **done** — `fedecf8` |
| 2 | Name the source of truth (store key, savedAt, publishedAt) | **done** — `fedecf8` |
| 3 | Draw unpublished people as unpublished (`.node-local`, dashed) | **done** — `fedecf8` |
| 4 | **Replay: stop storing a copy of the tree** | **NOT STARTED** ← resume here |

Plus one unplanned fix on top: a stale **`data/family.js`** (plain `<script src>`,
uncacheable-bustable) is now detected via a ~90-byte sidecar `data/published.json`
and announced with a banner — `b6aa38c`.

## 2. Item 4, in enough detail to start

**The problem.** `applyDraft()` replaces `state.people` / `state.partnerships`
wholesale from `ftFamilyDraft:<role>`. That is a **cache of derived data with no
cache key**: `state = f(published, ops)`, and we store `state` while `published`
moves underneath. Every painful thing in `changelog.js` is an epicycle around it —
`baselineStamp`, `deletedIds`, the ~90-line reconcile in `applyDraft`, and
`draftDivergence`'s two directions.

**The change.** Keep the **ops**, replay them over freshly loaded published data
at boot. The engine already exists and is hardened: `FTReview.applyOp()` handles
all five ops, derives gender/generation rather than trusting them, enforces
`isTerminal` / `hasFather` / the generation floor, and is idempotent in every case
(additions refuse an existing id, `rename` refuses a no-op, `delete_person`
refuses via `canDelete`). It sits in `assets/js/admin/` for historical reasons
only.

Steps:
1. move `applyOp` to `assets/js/core/ops.js`, add the `<script>` to **both** pages
2. `applyDraft()` → `replay(FTChangeLog.entries())`; `DRAFT_KEY` disappears
3. rewire `propose.js submit()`: today it clears the log and keeps the draft
   (`propose.js` ~line 335). Under replay, clearing the log erases the proposer's
   own suggestion from their tree. **Move** the ops to `ftSentOps:<proposalId>`,
   replay them in a visibly "قيد المراجعة" state, and let
   `FTProposalStatus.stateOf()` drop the bucket once approved/declined
4. build the one genuinely new surface: **"2 of your 3 pending edits no longer
   apply"**, listing `describe` strings with per-op discard. This is not new risk —
   `FTReview.preview()` already collects exactly this into `failed` — the
   difference is the person who made the edit finally sees it
5. then delete: `baselineStamp`, `deletedIds`, `draftDivergence`, the reconcile
   loop, most of the publish guards, and the dead `_idCounter` advance in
   `applyDraft` (ids are random now; `state.js` documents `_idCounter` vestigial)

**Net line count goes down.** Four of the five incidents become
*unrepresentable* rather than detected.

Known costs, accepted:
- `add_child`'s partnership choice is not stable under replay for a **polygynous**
  man (`review.js` / `edit.js` pick "a partnership the target already fathers").
  Cosmetic; document it.
- replay cost is noise: the 1,746-person clone `initState` already does is ~0.5ms.
  The 162KB `JSON.stringify` that `saveDraft` writes on *every* edit goes away,
  which is the larger number.
- **heavy test churn**: `proposals.test.js` and `ui.test.js` are deeply invested in
  `draftDivergence`.

**Do NOT fold in** snapshot undo (`changelog.js` `_undo`). The admin preview flow
depends on pop-the-stack semantics and that dependency is load-bearing and
documented.

## 3. State of the repo

- `main` = the publish-idempotence fix, pushed, working tree clean, **920 checks green**
- `release` = `f894be1`, **deliberately behind** — the owner said "only work on main
  from now on, later I will ask you to move stuff to release"
- Pages builds from **`main`**, so main pushes are live immediately
- data snapshot: tag `data-snapshot-2026-08-20-b`, plus `/tmp/ft-data-snapshot/`
  with SHA256s. Re-baseline after any legitimate data commit.
- run the suite: `node tools/test/run.js` (or one suite: `… run.js ui`)
- live data is **1,746 people / 659 partnerships** again: Mona2 and Rola1 were
  proposal-added (`a69a270`) and then deleted (`dd524fc`, `ee9270b`)

## 4. Owner actions still outstanding

- the stale-data banner appears only after a publish creates `data/published.json`;
  it now exists, so this is live
- nothing else outstanding — the caching and duplicate-publish incidents below are
  fixed in code, not waiting on a reload

## 4a. The publish-idempotence incident (2026-08-20 23:43) — settled, read once

The owner saw "the branch kept moving while publishing (4 attempts)" while approving
a delete of Rola1. **The commit had already landed** (`ee9270b`). Four separate
defects, all in one causal chain, all now fixed and mutation-tested:

1. **GitHub's API is cacheable and the browser was caching it.**
   `GET /git/ref` and `GET /contents/…` both answer `cache-control: public,
   max-age=60`. So the retry loop's "re-read the ref" read Safari's cache, not
   GitHub — all four attempts built on the same stale parent and were correctly
   refused. `fetchExistingLog` had the same hole, which is a data-loss path: append
   to a 60-second-stale changelog and you drop whatever landed in between.
   Fixed with a `_cb=<per-load-tag>-<seq>` query param on every GET. **A query
   param, not a `Cache-Control` header** — that header is not CORS-safelisted and
   GitHub does not allow it, so adding it makes Safari refuse the request before
   sending ("Load failed"). The tag must vary per page LOAD; a bare counter
   restarts at 1 and collides with the previous load's first read.

2. **The landed-write probe could never fire for an edit.** It compared the branch
   tip's tree sha against the tree just built. `familyFileBody()` stamps
   `publishedAt: new Date()` into `data/family.js` and the sidecar, so two publishes
   of identical content produce different trees. It only ever worked for the
   decisions-only commit it was tested against (`332dedd`).
   Now asks by the **identity of the work**: is each changelog entry's `ts` already
   in `data/changes.jsonl`, and each decision's `decisionKey` already in
   `data/proposals-reviewed.json`. `ts` is assigned once in `record()` and survives
   a reload, which is what makes it usable.

3. **A lost success response left the edit pending forever.** The in-call probe
   cannot help one page load later: PATCH lands → client misses it → the log is
   never cleared → COMMIT is pressed again. `alreadyPublished()` now also runs
   **before** the first attempt, so pressing COMMIT twice is safe by construction
   rather than by asking the owner to reason about the indicator.

4. **Blind append.** `data/changes.jsonl` carries four distinct ops written three
   times each (9 of 25 lines redundant) from an older retry. The append is now
   keyed on the same fingerprint, so it adds only missing lines.

Consequence for the error message: it now invites a retry, because a retry is safe.
Do not "restore" the old don't-retry wording without also reverting 3.

## 4b. Check freshness BEFORE assuming staleness

Three rounds were spent chasing a cached file when the data was fine. One line settles
it, and it should be the first thing run for any "I cannot see X" report:

```js
console.log(location.href, familyData.publishedAt, !!familyData.people['<id>']);
FTProposalStatus.checkFreshness().then(r => console.log(r));
```

`fresh` + the id present means it is a VISIBILITY question, not a data one. Also check
which page: `admin` and `index.html` keep separate drafts and I chased the wrong one.

## 5. Traps that cost time today — do not relearn these

- **A hard reload cannot be detected.** `PerformanceNavigationTiming.type` is
  `'reload'` for `Cmd+R` and `Option+Cmd+R` alike; no API exposes the modifier. So
  "clear on hard reload" can only mean "clear on every reload", which would delete
  a relative's unsent work. `?fresh=1` is the substitute, and it is *sendable*.
- **`ROLE` is derived from a DOM probe** for `#propose-bar` (`changelog.js`), an
  element defined in another file's markup. One browser therefore holds two
  divergent trees (`:propose` and `:admin`) and nothing on screen said which — the
  owner and I both read the wrong key for several minutes. The review recommends
  `data-ft-role` on `<html>` instead. Not done.
- **`render.js` builds the node class list TWICE** (enter + update). Patching one
  and missing the other has now happened twice. The static guard checks every
  provenance class in both builders; keep it that way.
- **Source greps over comments lie.** Two tests failed because the fix's own
  comment mentioned the string being asserted absent. `codeOnly()` in
  `tools/test/dom.js` strips comments with a state machine (so `https://` survives).
- **An oracle that shares the implementation's assumption cannot catch the
  implementation's bug.** `uiConsistent()` read only `draftDivergence().missing`,
  so it passed while an extras-only dead end shipped. It now sums both directions.
- **A skipped check reads as a pass.** A class rename made a mobile touch-target
  assertion silently `~ skip`. Watch the skip count, not just failures.
- **A fixture FOUND in `data/family.js` is a fixture that can be deleted.** The
  wife-reachability test scanned the live tree for "a wife with no father"; deleting
  Mona2 and Rola1 turned the suite red with no change to the code under test. Build
  the shape the test needs — through the real op — instead of hoping the data still
  contains it.
- **`api.github.com` responses are cacheable** (`max-age=60`), and the browser
  honours it across page loads. Any code here that re-reads to see a change needs
  the `_cb` buster. See §4a.

## 6. Open findings from the two role reviews, not yet acted on

Both agents' full findings are in the session transcript. Still open:

- ~~`github.js` **dedupe on append**~~ — **done**, see §4a item 4. The nine
  redundant lines already in `data/changes.jsonl` are history and were left alone;
  new publishes cannot add more.
- **unsnapshotted publish inputs**: `publish()` snapshots `edits`/`pendingDecisions`
  once but re-reads them live when building the bodies; `commitFamily` then clears
  the log unconditionally, so an edit made mid-publish is wiped unsent.
- **revoked token is a dead end**: `openTokenModal()` has exactly one caller, the
  `!hasToken()` branch, so a 401 mid-session leaves an unfixable button. Clear the
  token on 401.
- **inbox truncation reads as clean**: the proposals select sends no `limit`, so
  Supabase's server-side max-rows silently truncates and the badge prints a green ✓
  with an exact count.
- proposer side: a quota-blocked write strands the edit with SEND greyed out
  forever (`saveFailed()` exists but only admin reads it); the "only you can see
  this" disclosure is `.propose-only`, so it vanishes exactly when the visitor
  leaves propose mode; `foreignWrite()` is collected by the viewer and never shown.
- **note-only proposals**: supported by `submit()` and the schema but unreachable
  from the UI. Do **not** enable them until the admin has a closing decision (an
  `acknowledged` value) — otherwise you manufacture permanently pending rows.

## 7. Ground truth confirmed today, so it need not be re-derived

- Supabase RLS verified against the live DB: `UPDATE` on `proposals` is refused
  (a same-value PATCH with `return=representation` came back `[]`). insert+select
  only, as designed.
- the inbox holds 7 rows; all decided. `0b5aeaa4` (+ Mona2, + Rola1) approved and
  committed in `a69a270`.
- all six earlier proposals carry `author_name: مقلد` — identity is self-asserted,
  and `me()` used to fall back to the patriarch, so some of those may be anyone.
- `data/published.json` currently claims 1748 people / 661 partnerships.
