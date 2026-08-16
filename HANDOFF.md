# HANDOFF — 2026-08-15

Written at the end of a long session that moved development here from
`~/work/projects/familytree` (now retired). `CLAUDE.md` covers architecture and
conventions; this file covers **state, decisions, and traps** — the things a
fresh session cannot infer from the code.

---

## 1. Do this first

**Nothing is pushed.** Seven commits sit on local `main`, unpushed.

**GitHub Pages currently builds from `main`.** So pushing `main` right now
publishes everything immediately — the opposite of the branch model below.

Correct order:

1. GitHub → Settings → Pages → set source branch to **`release`**
2. then `git push origin main release`

Do not reverse these.

---

## 2. Branch model

| branch | holds |
|---|---|
| `release` | exactly what is published. Pinned to `9bf6ff2`, the pre-restructure site. |
| `main` | active development. 7 commits ahead. |

Publishing = `git checkout release && git merge main && git push`.

`restructure-admin-viewer` is a leftover pointing into `main`'s history; safe to
delete.

### `release` is deliberately stale

It still serves the **uncorrected** tree. This is not a bug:

| | `main` | `release` |
|---|---|---|
| people | 1,746 | 1,747 |
| partnerships | 659 | 738 |
| max depth | **18** | **64** |
| `p1131` | absent (it is a section heading) | present as a person |
| layout | `index.html` + `admin.html` + `assets/**` | flat `app.js` + `family_data.js` |
| d3 | vendored | cdnjs |

Verified: `main`'s data is byte-identical to the retired directory's rebuilt
data (matching hash over all 1,745 edges).

**Merging `main` → `release` changes what relatives see.** 20.3% of parent-child
edges change, the tree drops from 64 generations to 18, and one "person"
disappears. All better-evidenced than what is live, but it is visible family
history that people may already have read. Treat as a deliberate publish, not a
routine merge.

---

## 3. The one thing to understand about this codebase

**Descent in the 1999 source is encoded in 3,990 drawn Escher line shapes, not
by cell position.** Every earlier attempt inferred parentage from *proximity*
using chart screenshots, and was wrong in a specific, systematic way: where a man
had too many sons to fit across the page, the chart used a **vertical bracket** —
one long bus down the page with a short stub into each son's cell. Read
positionally, 16 brothers look like 16 generations.

That single misreading produced the 64-generation tree. Three independent methods
converged on the same nodes: graph statistics (a null model with the same degree
multiset never once reached depth 64 in 200 trials), the drawn geometry, and
rendered row occupancy (the spurious links show as near-empty bands).

If you ever revisit parentage, start from the drawing layer, never the
screenshots.

---

## 4. Decided product rules (settled, do not relitigate)

Women are **terminal nodes**:

1. The patrilineal tree stays dominant and unchanged.
2. A man can be given a wife. Nothing extends from her.
3. A man can be given a daughter. Nothing extends from her.
4. A couple's children render from the **midpoint** between the parents.

Rule 5 falls out of 2 and 3: **gender alone tells you a node is terminal**, so no
membership marker, no dashed borders. Gender is corner radius (stadium) plus a
hollow generation pill.

Rule 6: this was already 90% built. Every partnership in `data/family.js` (659 of 659) is
`[father, null]`;
filling that null slot activates a `visA && visB` branch in `buildLinkPaths` that
had never executed.

Rule 7: these rules make cousin marriage impossible, so the graph stays a tree.
`getAncestorPath` and the search ancestor-chains stay valid. Allowing daughters'
children would make it a DAG and break four assumptions.

Enforcement is in three layers: the panel button, `openModal`, and
`saveRelative`. Invalid combinations are unrepresentable — the relation dropdown
is `ابن / ابنة / زوجة / أب` and gender is derived, so "wife, male" cannot be
expressed.

---

## 5. Known-broken / unverified

- **Nothing in this session was ever visually verified.** Headless Chrome cannot
  run in the agent sandbox (it fails to bind its singleton socket). Every check
  was structural or a runtime boot test. **CSS regressions are invisible to that
  method** and three shipped because of it. If something looks wrong, suspect CSS
  before logic.

- **68% of parent-child links are visually attributable to the wrong father.**
  `dropY` (defined in `assets/js/core/links.js`, also referenced in `render.js`) depends only on
  the parent's generation, so
  every sibling bus in a corridor shares one y, one colour, one width, and they
  fuse into rails up to 127,577px wide. The corrected data made this *worse*
  (39% → 68%) because 19 rows are more crowded than 65. **Fix: make `dropY`
  per-partnership and give buses distinguishable colours.** This is the highest-
  value outstanding work.

- **Children are not centred under their parents.** `resolveOverlaps` enforces
  258px between every same-row neighbour and wins over the relaxation rounds that
  try to centre parents over children. Pre-existing, affects single fathers too.

- **Cousins render as brothers.** Uniform 258px spacing regardless of
  relationship; 676 of 956 non-sibling neighbour gaps are exactly 258.
  Uncle/nephew cannot be confused (144px vertical separation).

- **`CLAUDE.md`'s "Known broken" minimap section** — the minimap was dropped in
  the restructure, not fixed.

---

## 6. Traps that already bit

- **`git add -A` here sweeps in local working material.** It once added ~60 files
  of design mockups and chart screenshots to a website commit.

- **Two copies of the auth gate existed.** `pickers.js` carried a full duplicate
  of `initAdmin` that loaded *after* `auth.js` and re-bound the same listeners
  against its own hash. Changing the password in `auth.js` alone would have left
  the old one working. Removed — but check for duplicates when editing admin JS.

- **Moving files breaks path-dependent tooling silently.**
  `tools/rebuild_from_excel.py` was broken for several commits: `REPO` resolved
  to `tools/` and it still parsed the old `const familyData =` wrapper. Run any
  tool after moving it.

- **The at-rule flattening.** The CSS split used a regex that did not understand
  at-rules, so `@media` and both `@keyframes` had their wrappers stripped and
  their contents promoted to top level. The media query then applied at all
  widths, pinning the sidebar to 56px. Validate CSS with a brace-depth walk, not
  a regex.

---

## 7. Admin model in one line

Admin changes are **local until committed**. Pickers write a `localStorage`
draft; `PUBLISH` downloads a file you commit. The password gate is not access
control (the hash ships to the browser, `admin.html` is publicly fetchable) —
**git is the access control.** Do not present the gate as security.

---

## 8. Outstanding, roughly by value

1. Per-partnership `dropY` + bus colours (the 68% problem)
2. Push, after repointing Pages to `release`
3. Decide when to publish the corrected tree to relatives
4. Children not centred under parents (needs real layout work)
5. Directional `+` indicators — `hasHiddenRelatives` merges parents, siblings,
   partner and children into one flat set, so today's corner marker cannot say
   which direction the hidden relative lies
6. Delete the `restructure-admin-viewer` branch
7. Persistence: added wives and children are in-memory only; `EXPORT FAMILY
   DATA` is the only way out

---

## 9. Outside the repo

- **Source workbook:** `~/Downloads/jioussy_family_tree_Jayyousi.xls` (1999, by
  Wajeeh Jayyusi). A newer `.numbers` sits beside it; if it has been edited, it
  is the real source of truth and the `.xls` is stale.
- **Archives:** `~/Desktop/familytree-designs-archive.tgz` (35 style mockups),
  `~/Desktop/familytree-transcription-archive.tgz` (superseded transcription +
  chart screenshots).
- **`~/work/projects/familytree`** is retired. Apple-internal remote, not the
  live site. Do not develop there.
