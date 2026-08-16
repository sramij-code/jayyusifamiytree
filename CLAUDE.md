# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, dependency-free family tree viewer for the Jayyousi family (آل الجيوسي), ~1,750 people
recovered from a 1999 Excel workbook. Arabic RTL UI with English transliterations. Deployed as a
GitHub Pages site (`.nojekyll`, no build step).

## Running it

There is no build, no package manager, no test suite, and no lint config. Open the HTML directly or
serve the directory:

```sh
python3 -m http.server 8000    # then http://localhost:8000/index.html
```

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

## Untracked directories

`designs/`, `designs2/`, `designs3/` are standalone visual-style explorations (glassmorphism,
brutalist, terminal, neumorphic variants) that are not wired into the app. `tree_analysis/`,
`tree_images/`, and `flagged_screenshots/` are artifacts of the Excel reconstruction and manual
review. None are in git.

## Known defect

`admin.html` contains the **add-relative modal twice** (two `<div id="modal-overlay">` blocks,
duplicate IDs throughout). `document.getElementById` binds only the first, so it happens to work,
but any fix touching the modal should delete the second copy rather than editing both.
