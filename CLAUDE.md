# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, dependency-free family tree viewer for the Jayyousi family (آل الجيوسي), ~1,750 people
recovered from a 1999 Excel workbook. Arabic RTL UI with English transliterations. Deployed as a
GitHub Pages site (`.nojekyll`, no build step).

## Running it

There is no build, no package manager and no lint config. Open the HTML directly or serve the
directory:

```sh
python3 -m http.server 8000    # then http://localhost:8000/index.html
```

## Verification

```sh
node tools/test/run.js          # 210 checks, exit 1 on any failure
node tools/test/run.js mobile   # one suite
```

Four suites — `static`, `domain`, `proposals`, `mobile` — with no dependencies, run in a Node vm
against the real data. See `tools/test/README.md`. The oracle is `invariants(ctx)`: assert it after
every mutation.

It cannot see rendering. Anything depending on font metrics or real layout still needs a device, and
the GitHub and Supabase paths are stubbed, so changes there need one manual run.

All JS is loaded as **classic scripts, not ES modules** — this is deliberate, so the site also works
over `file://`. Do not introduce `import`/`export` in `assets/js/**` without also accepting the loss
of `file://` support. Script order in the two HTML files is the dependency graph; adding a new core
file means adding a `<script>` tag to **both** `index.html` and `admin.html`.

## The viewer/admin split (the central architectural idea)

Two entry points share one core:

- `index.html` → loads `assets/js/core/*` + `assets/js/viewer.js`. Read-only.
- `admin.html` → loads the same core + `assets/js/admin/*` + `admin.css`. Editing and theming.

The editing and customisation code is **not hidden from visitors, it is never shipped to them**.
There is no mode flag inside the core to flip. `viewer.js` and `admin/admin.js` are parallel
bootstraps that both define `initEventListeners()` and `init()`; `viewer.js` additionally defines a
no-op `startEditName()` because the shared renderer calls it on name click.

Consequence for any new feature: if it is admin-only, it belongs in `assets/js/admin/` and must not
be referenced unconditionally from `assets/js/core/`.

### The password gate is not access control

`assets/js/admin/auth.js` ships a SHA-256 hash to the browser and sets a `localStorage` flag. Anyone
can bypass it in DevTools; the file says so itself. **Git is the real access control.** Admin edits
live only in that browser's memory/`localStorage` until a generated file is downloaded via the
publish bar and committed. Do not "harden" this gate as if it were security; the honest limitation
is documented on purpose.

### Publishing flow

`assets/js/admin/publish.js` never writes to disk directly. It generates a file and triggers a
browser download; a human then replaces the repo file and commits.

- `PUBLISH THEME` → downloads `theme.js` → replaces `data/theme.js`
- `EXPORT FAMILY DATA` → downloads `family.js` → replaces `data/family.js`

`isDirty()` compares the local draft against `window.FT_THEME` (the committed theme), which is what
drives the `● UNPUBLISHED CHANGES` indicator.

`COMMIT TO MAIN` (`assets/js/admin/github.js`) is the exception: it writes to the repo directly via
the Git Data API. It commits up to three files in **one** commit, and which ones depends on what
changed:

| file | written when |
| --- | --- |
| `data/family.js` + `data/changes.jsonl` | there are changelog entries — always together |
| `data/proposals-reviewed.json` | there are uncommitted review decisions |

**Review decisions are a second, independent axis of "unpublished work."** Rejecting a proposal
mutates no tree and produces no changelog entry, so anything that gates publishing on
`FTChangeLog.count()` alone makes rejections unpublishable — which is exactly why they used to live
only in `localStorage` and reappeared as pending on every other device. Three places must therefore
count both: `markFamilyDirty()` (the indicator and the COMMIT button), `commitFamily()`, and
`FTGitHub.publish()`.

### Previewing a deletion

`FTReview.preview()` applies additions for real but only **marks** a `delete_person` op
(`state.markedForRemovalIds` → `.node-marked-removal`, drawn struck through in red).
`FTReview.approve()` performs the deletion.

This asymmetry is load-bearing, not an inconsistency. `preview()` reveals, highlights and frames each
touched person by looking them up in `state.people`, so deleting first made all three silently skip:
no highlight, and an empty frame meant `fitToNodes` fell back to every visible node, zooming *out*
instead of to the change. A deletion was the one op that could not be seen — the one that most needs
to be. Leaving the person in place fixes reveal, highlight and framing at once.

Consequences to preserve: `dismiss()` must clear the marks explicitly (nothing was mutated, so the
undo snapshot does not cover them), and `approve()` re-checks with `deletePerson` rather than trusting
the mark, since a ⌘Z or an admin edit can invalidate it between marking and approving.

### Proposal status is derived, on BOTH sides

`assets/js/proposal-status.js` (`FTProposalStatus`) is loaded by `index.html` and `admin.html`. It
answers "where does this proposal stand" from the two committed files and nothing else:

```
approved -> data/changes.jsonl has a line with fromProposal: <id>
declined -> latest decision for <id> in data/proposals-reviewed.json is 'rejected'
pending  -> neither
```

It exists because the **proposer** needs the same answer the reviewer does. The propose bar used to
read `FTPropose.sent().length` — a localStorage list nothing ever removes from — so it announced
`N اقتراحات قيد المراجعة` permanently, including proposals approved months earlier.

Both fetches return an `ok` flag. A failed read makes an approved proposal look pending, i.e. an
**over-count**: the safe direction, since it prompts a look rather than hiding work. Callers surface
it (`partial`) instead of presenting a guess as exact. A 404 is *not* a failure — neither file exists
before the first publish.

`FTPropose.barState()` and `FTReview.buttonState()` both distinguish **four** states, and `clean`/
`settled` is unreachable without a successful fetch. `FTReview.load()` sets `loadState = 'error'`
before its first `await` for exactly this reason. Never collapse "could not ask" into "nothing
pending" — that is the same defect as the publish bar claiming `TREE IN SYNC`.

### Withdrawing a proposal (`withdraws` column)

A proposer cannot delete or edit what they sent: `tools/proposals.sql` grants **insert and select
only**. So withdrawing is an INSERT of a row whose `withdraws` points at the target. Such a row is not
a proposal — both UIs filter it out of the list and use it to annotate its target.

**It is a request, never automatic.** There is no login, so `withdraws` is client-asserted: anyone
could post one against anyone's proposal. Honouring it silently would let any visitor suppress
someone else's suggestion, so the target stays `pending` and keeps counting on the review button. The
reviewer decides; a forged withdrawal costs a line on a card.

`FTPropose.mine()` is the union of an `author_node=eq.<me>` query and the local sent-id list, deduped.
Neither alone suffices: the query survives cleared storage and works across devices but is spoofable
and misses proposals sent as another node; the local list is exact for this browser but does not
travel. `author_node` serves display, never ownership.

### Proposal decisions (`data/proposals-reviewed.json`)

```json
{ "version": 1,
  "decisions": [ { "id": "<proposal uuid>", "decision": "rejected" | "reinstated",
                   "at": "<ISO>", "note": null, "by": "admin" } ] }
```

Append-only, and **the latest decision for an id wins.** Reinstating a proposal appends
`reinstated` rather than deleting the rejection, so "turned down, then changed my mind" stays legible
in git. Ordering is by `at`, never by position in the array — the file is committed JSON that a human
can hand-edit and git can merge. `decisionKey()` includes the decision, not just `id@at`, because a
reject followed immediately by a reinstate can share a millisecond.

A decision is **local until committed** (`FTReview.uncommitted()`); the drawer says
`بانتظار COMMIT` versus `محفوظ في المستودع` rather than implying every rejection is durable.
`markCommitted()` flags local entries instead of deleting them, because the committed file is served
over HTTP and lags the commit by minutes — deleting would make a decision vanish from the UI in
between. Approval still outranks any decision, since approved ops are a fact about `data/family.js`.

The history list is capped (`HISTORY_PAGE`, 20) and pages with المزيد. The Supabase inbox only ever
grows, so an uncapped list would eventually render every proposal ever sent on every refresh.

## Data model

`data/family.js` defines `window.FT_FAMILY` and aliases it to a top-level `var familyData`.
Schema:

```js
{
  people: { p1: { id, name, gender, generation }, ... },   // Arabic name, generation = depth
  partnerships: [ { id: "pp1", partners: [fatherId, motherIdOrNull], children: [ids] } ],
  loggedInUser: "p1",   // the node the view centers on at boot
  root: "p1"
}
```

**All relationships live in `partnerships` only.** People carry no parent/child pointers. `partners`
is always `[father, wifeOrNull]` — index 0 being the husband is load-bearing (it keeps him
deterministically on the left instead of letting an x-order tie decide).

Domain rules encoded in the code, not just convention:

- Women are **terminal nodes** (`isTerminal()` in `core/state.js`): nothing extends from a wife or a
  daughter. The add-relative modal enforces this in two layers (button guard + `openModal` guard).
- Gender is **implied by the chosen relation**, never picked separately, so "wife, male" is
  unrepresentable. The gender radios remain in the DOM but hidden.
- Polygyny is supported, so "add wife" is always legal for a male; "add father" is offered only when
  `hasFather()` is false.

### Derived indexes

`core/state.js` maintains three lazily-built caches over `partnerships`, each with an
`invalidate*()` that **must** be called after any structural mutation:

- `parentIndex()` — child → father. Search runs on every keystroke; the raw scan is O(P) per lookup.
- `childIndex()` — parent → children, indexing **both** partners so a wife resolves to the couple's children.
- `coupleMap()` — person → `{ other, first }`.

`ancestorChain()` is cycle-guarded because the imported data is not guaranteed acyclic.

### Theming

`data/theme.js` (`window.FT_THEME`) is the published theme. `assets/js/theme.js` applies it to CSS
custom properties on `:root` at load. Everything downstream reads the CSS variables — this replaced
an older pattern of `window.activeNodeColor`-style globals. Those globals still exist and are still
set by `apply()`, but only because the SVG renderer needs per-element attribute values (e.g.
`stroke-width` on individual paths) that cannot come from a CSS variable. Prefer the CSS variables.

### Names and search

`data/names.js` maps **normalized** Arabic → English, keyed through `normalizeArabic()` (folds
tatweel, harakat, أإآ→ا, ى→ي). The 1:1 structural rule means adding a person with an existing Arabic
name needs no work here.

165 people are named محمد, so `core/search.js` computes, per hit, the **shortest ancestor chain that
makes that particular hit unique** among the current hits — different hits get different depths.

## Core module responsibilities

`core/layout.js` owns all geometry (generation-row layout, `NODE_W`/`H_GAP`/`V_GAP`, `COUPLE_GAP`).
`core/links.js` builds stems, sibling buses, and marriage bars. `core/render.js` owns SVG and the d3
zoom surface. `core/interactions.js` owns the visibility model (`visibleNodes` / `expandedNodes`,
expand/collapse, node panel). Keep geometry out of the renderer and rendering out of layout.

Node labels are two `tspan`s (Arabic + smaller English), not one string, so each script stays its own
bidi run — a mixed Arabic/Latin string reorders unpredictably based on its first character.

## Data provenance — important

The tree structure has a contested history. Read this before touching any `family_data.js` variant.

- `tools/rebuild_from_excel.py` is the **current, authoritative** pipeline. It derives descent from
  the workbook's 3,990 drawn Escher connector-line shapes (via `tree_analysis/derived_edges.json`,
  which IS tracked), falls back to the previous edge only where the drawing yields nothing, rejects
  cycle-closing fallbacks, and recomputes `generation` as true depth from the root. It writes
  `data/family.rebuilt.js` and a per-edge evidence report to `tree_analysis/rebuild_provenance.json`.
  It **never** overwrites its input.

  ```sh
  python3 tools/rebuild_from_excel.py     # regenerates data/family.rebuilt.js
  ```

  Verified 2026-08-15: it reproduces the shipped `data/family.js` byte-identically
  (1,746 people / 659 partnerships). Compare, then replace `data/family.js` deliberately.

  Its one external input is the source workbook, which is **outside the repo**:
  `~/Downloads/jioussy_family_tree_Jayyousi.xls`. Needs `xlrd` (`pip3 install xlrd`).

- **Deleted 2026-08-15, do not resurrect:** `app.js` and `family_data.js` (the pre-split monolith and
  its legacy 1,747-person dataset, loaded by neither page), `apply_corrections.py` (applied ~15
  hardcoded fixes from cell *proximity*, a premise the drawn lines refute — its very first correction
  reverses an edge the drawing gets right), and the screenshot-derived transcription under
  `tree_analysis/` (`S*.json`, `result_S*.json`, `review_R*.json`). `review_R3_spine.json` in
  particular asserted the col-106 spine is a linear chain, which is exactly the error that produced
  the 64-generation tree. Archived to `~/Desktop/familytree-transcription-archive.tgz`.

**Live data is `data/family.js` and nothing else.**

## Session state

`RESUME.md` carries in-flight work and the traps that cost time in the last session —
the things a fresh session cannot infer from the code. `HANDOFF.md` is the older
2026-08-15 equivalent. Both are **dev-only and must stay off `release`**, like this
file.

## Untracked directories

`designs/`, `designs2/`, `designs3/` are standalone visual-style explorations (glassmorphism,
brutalist, terminal, neumorphic variants) that are not wired into the app. `tree_analysis/`,
`tree_images/`, and `flagged_screenshots/` are artifacts of the Excel reconstruction and manual
review. None are in git.

## Known defect

`admin.html` contains the **add-relative modal twice** (two `<div id="modal-overlay">` blocks,
duplicate IDs throughout). `document.getElementById` binds only the first, so it happens to work,
but any fix touching the modal should delete the second copy rather than editing both.
