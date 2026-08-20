/* ============================================================================
   layout.js — Generation-row layout engine. Owns all geometry.
   Classic script (no ES modules) so the site still works over file://.
============================================================================ */

/* =============================================================================
   FAMILY TREE APP — app.js
   Sections:
     1. DATA
     2. CONSTANTS & CONFIG
     3. STATE
     4. LAYOUT ENGINE
     5. RENDERER
     6. INTERACTIONS
     7. NODE PANEL
     8. SEARCH
     9. MODAL
    10. INIT
============================================================================= */

// =============================================================================
// 1. DATA  (loaded from family_data.js)
// =============================================================================
// familyData is defined in family_data.js, loaded before this script.

// =============================================================================
// 2. CONSTANTS & CONFIG
// =============================================================================

const NODE_W = 178;
const NODE_H = 68;
const H_GAP  = 80;   // minimum horizontal gap between nodes
const V_GAP  = 76;   // vertical gap between generations

// Generation pill colors (left accent bar on each node)
const GEN_COLORS = [
  "#7c3aed", // gen 0 — violet
  "#4f46e5", // gen 1 — indigo
  "#c026d3", // gen 2 — fuchsia
  "#059669", // gen 3 — emerald
  "#d97706", // gen 4 — amber
  "#6d28d9", // gen 5 — deep violet
];

// =============================================================================
// 4. LAYOUT ENGINE
// =============================================================================

// A husband and wife sit closer together than two unrelated people in the same
// row, so the pair reads as a couple. Everything else keeps NODE_W + H_GAP.
const COUPLE_GAP = NODE_W + 24;

function computeLayout() {
  const visiblePeople = [...state.visibleNodes]
    .filter(id => state.people[id])
    .map(id => state.people[id]);

  if (visiblePeople.length === 0) return {};

  const genGroups = {};
  for (const p of visiblePeople) {
    const g = p.generation;
    if (!genGroups[g]) genGroups[g] = [];
    genGroups[g].push(p.id);
  }

  const sortedGens = Object.keys(genGroups).map(Number).sort((a, b) => a - b);
  const layout = {};

  // Place root generation centered at x=0
  const firstGen = sortedGens[0];
  const rootIds = genGroups[firstGen];
  for (let i = 0; i < rootIds.length; i++) {
    layout[rootIds[i]] = {
      x: (i - (rootIds.length - 1) / 2) * (NODE_W + H_GAP),
      y: firstGen * (NODE_H + V_GAP) + 60,
    };
  }

  // Top-down: place each child generation centered under parents
  for (let gi = 1; gi < sortedGens.length; gi++) {
    const gen = sortedGens[gi];
    const y = gen * (NODE_H + V_GAP) + 60;
    const placed = placePeopleInRow(genGroups[gen], gen, layout);
    for (const { id, x } of placed) {
      layout[id] = { x, y };
    }
    resolveOverlaps(genGroups[gen], layout);
  }

  // Iterative relaxation: alternate centering-over-children with spreading
  // until the layout converges (or we hit the round limit)
  for (let round = 0; round < 12; round++) {
    // Bottom-up: re-center each parent over its visible children. A couple is
    // centered as a unit — centering both partners individually would collapse
    // them onto the same x, since they share the same children.
    for (let gi = sortedGens.length - 2; gi >= 0; gi--) {
      const gen = sortedGens[gi];
      for (const id of genGroups[gen]) {
        if (!layout[id]) continue;

        const wives = visiblePartnersOf(id, layout);
        if (wives.length > 0) {
          // Only the husband (partners[0], `first`) drives placement, so the
          // group is positioned once rather than once per member.
          if (!wives[0].first) continue;

          let childXs = getVisibleChildrenXs(id, layout);
          for (const w of wives) childXs = childXs.concat(getVisibleChildrenXs(w.other, layout));

          if (childXs.length > 0) {
            // The husband sits in the middle of his marriages (see
            // tightenMarriages), so centring HIM centres the block.
            const mid = (Math.min(...childXs) + Math.max(...childXs)) / 2;
            layout[id].x = mid;
          }
          continue;   // wives are seated by tightenMarriages
        }

        // A wife whose husband is off screen, or anyone unmarried.
        if (partnersOf(id).length > 0 && !isHusbandOf(id)) continue;

        const childXs = getVisibleChildrenXs(id, layout);
        if (childXs.length > 0) {
          layout[id].x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
        }
      }
    }

    // Seat every visible wife beside her husband, on EVERY row.
    //
    // Two reasons this cannot live in the loop above. That loop skips the
    // deepest generation (it centres parents over children, and the last row
    // has none), so a marriage there was never positioned at all — which is
    // exactly the newly-added-wife case. And resolveOverlaps only enforces a
    // MINIMUM gap; it never pulls nodes closer, so a wife left adrift by the
    // initial pass stayed adrift.
    tightenMarriages(genGroups, sortedGens, layout);
    // Top-down: enforce minimum spacing on every row
    for (const gen of sortedGens) {
      resolveOverlaps(genGroups[gen], layout);
    }
  }

  // Shift entire tree so the root generation is centered at x=0
  const laidOutRoots = rootIds.filter(id => layout[id]);
  if (laidOutRoots.length > 0) {
    const rootCenter = laidOutRoots.reduce((s, id) => s + layout[id].x, 0) / laidOutRoots.length;
    for (const id of Object.keys(layout)) {
      layout[id].x -= rootCenter;
    }
  }

  return layout;
}

function placePeopleInRow(ids, gen, existingLayout) {
  const idSet = new Set(ids);

  // --- Step 1: group siblings (same parent partnership) into family clusters ---
  const ppSiblingGroups = {};   // ppId -> [child ids in this row]
  const assignedToSibGroup = new Set();

  for (const pp of state.partnerships) {
    const sibs = pp.children.filter(c => idSet.has(c));
    if (sibs.length > 1) {
      ppSiblingGroups[pp.id] = sibs;
      sibs.forEach(s => assignedToSibGroup.add(s));
    }
  }

  // --- Step 2: within each sibling group, honour intra-gen partner adjacency ---
  const intraGenPartnerOf = {};
  for (const pp of state.partnerships) {
    const [pA, pB] = pp.partners;
    if (pA && pB && idSet.has(pA) && idSet.has(pB)) {
      intraGenPartnerOf[pA] = pB;
      intraGenPartnerOf[pB] = pA;
    }
  }

  const visited = new Set();
  const clusters = [];

  // Build clusters from sibling groups first (keeps siblings together)
  for (const sibs of Object.values(ppSiblingGroups)) {
    const groupVisited = new Set();
    const groupClusters = [];
    for (const id of sibs) {
      if (groupVisited.has(id)) continue;
      groupVisited.add(id);
      visited.add(id);
      const partner = intraGenPartnerOf[id];
      if (partner && idSet.has(partner) && !groupVisited.has(partner)) {
        groupVisited.add(partner);
        visited.add(partner);
        groupClusters.push([id, partner]);
      } else {
        groupClusters.push([id]);
      }
    }
    // Merge all sub-clusters of this sibling group into one flat cluster
    clusters.push(groupClusters.flat());
  }

  // Remaining ids (only-children or nodes without a parent in this view)
  for (const id of ids) {
    if (visited.has(id)) continue;
    visited.add(id);
    const partner = intraGenPartnerOf[id];
    if (partner && !visited.has(partner)) {
      visited.add(partner);
      clusters.push([id, partner]);
    } else {
      clusters.push([id]);
    }
  }

  // --- Step 3: compute idealX and sort clusters ---
  const clusterInfo = clusters.map(cluster => {
    let idealX = null;
    if (existingLayout) {
      const parentXs = [];
      for (const id of cluster) {
        const parentMidX = getParentMidX(id, existingLayout);
        if (parentMidX !== null) parentXs.push(parentMidX);
      }
      if (parentXs.length > 0) {
        idealX = parentXs.reduce((a, b) => a + b, 0) / parentXs.length;
      }
    }
    const clusterWidth = cluster.length * NODE_W + (cluster.length - 1) * (H_GAP / 2);
    return { cluster, idealX, width: clusterWidth };
  });

  clusterInfo.sort((a, b) => {
    if (a.idealX === null && b.idealX === null) return 0;
    if (a.idealX === null) return 1;
    if (b.idealX === null) return -1;
    return a.idealX - b.idealX;
  });

  // --- Step 4: place clusters without overlap ---
  // First pass: compute each cluster's desired startX (centred on idealX)
  // Second pass: enforce left-to-right non-overlap (cursor = right edge of prev cluster)
  let cursor = -Infinity;
  const result = [];

  for (const { cluster, idealX, width } of clusterInfo) {
    const halfW = width / 2;
    // A cluster with no visible parent falls back to the running cursor. On the
    // FIRST such cluster in a row the cursor is still -Infinity, which used to
    // propagate into every x and silently collapse the whole row onto the origin
    // with no lines drawn. Anchor that case at 0 instead.
    let startX;
    if (idealX !== null) {
      startX = idealX - halfW;
    } else if (Number.isFinite(cursor)) {
      startX = cursor;
    } else {
      startX = -halfW;
    }
    // Prevent this cluster from overlapping the previous one
    if (Number.isFinite(cursor) && startX < cursor) startX = cursor;

    for (let j = 0; j < cluster.length; j++) {
      const x = startX + j * (NODE_W + H_GAP / 2) + NODE_W / 2;
      result.push({ id: cluster[j], x });
    }

    cursor = startX + width + H_GAP;
  }

  return result;
}

function getParentMidX(personId, layout) {
  for (const pp of state.partnerships) {
    if (!pp.children.includes(personId)) continue;
    const [pA, pB] = pp.partners;
    const visA = pA && state.visibleNodes.has(pA) && layout[pA];
    const visB = pB && state.visibleNodes.has(pB) && layout[pB];
    if (visA && visB) return (layout[pA].x + layout[pB].x) / 2;
    if (visA) return layout[pA].x;
    if (visB) return layout[pB].x;
  }
  return null;
}

function getVisibleChildrenXs(personId, layout) {
  const xs = [];
  for (const pp of state.partnerships) {
    if (!pp.partners.includes(personId)) continue;
    for (const cid of pp.children) {
      if (state.visibleNodes.has(cid) && layout[cid]) {
        xs.push(layout[cid].x);
      }
    }
  }
  return xs;
}

// Seat each visible wife next to her husband, alternating right then left so
// he sits in the middle of his marriages.
//
// Stacking every wife on one side keeps the husband's bar to the far wife
// running straight through the nearer one, which is what made a second wife
// read as married to the first. Alternating means one or two wives — the
// realistic case — produce no crossing at all. Three or more still cross, and
// there is no single-row layout that avoids it.
//
// Runs on every row including the deepest, which the centering pass skips.
function tightenMarriages(genGroups, sortedGens, layout) {
  for (const gen of sortedGens) {
    for (const id of genGroups[gen]) {
      if (!layout[id] || !isHusbandOf(id)) continue;
      const wives = visiblePartnersOf(id, layout);
      wives.forEach((w, k) => {
        const side = (k % 2 === 0) ? 1 : -1;         // right, left, right, …
        const rank = Math.floor(k / 2) + 1;          // how far out on that side
        layout[w.other].x = layout[id].x + side * COUPLE_GAP * rank;
      });
    }
  }
}

function resolveOverlaps(ids, layout) {
  const sorted = ids
    .filter(id => layout[id])
    .sort((a, b) => layout[a].x - layout[b].x);

  if (sorted.length < 2) return;

  // Spouses are allowed to sit closer than unrelated neighbours; without this
  // the couple gets pushed to the full 258px and stops reading as a pair.
  // Co-wives count too, or a husband's two wives get stranger spacing and his
  // marriage bar to the far one crosses the near one's node.
  const minGap = (a, b) => inSameMarriageGroup(a, b) ? COUPLE_GAP : NODE_W + H_GAP;

  // Forward sweep: push each node right if too close to its left neighbour
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const md = minGap(a, b);
    if (layout[b].x - layout[a].x < md) {
      layout[b].x = layout[a].x + md;
    }
  }

  // Backward sweep: push each node left if too close to its right neighbour
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const md = minGap(a, b);
    if (layout[b].x - layout[a].x < md) {
      layout[a].x = layout[b].x - md;
    }
  }
}

// ---------------------------------------------------------------------------
// VIEWPORT ARITHMETIC
//
// Here rather than in render.js because it is geometry, and render.js owns the
// SVG and the d3 zoom surface — the split this project keeps deliberately. It
// also means the arithmetic is unit-testable: the suite loads layout.js and
// never loads the renderer.
// ---------------------------------------------------------------------------

// Keep whatever is centred, centred, when the viewport changes size.
//
// PURE, so the arithmetic is testable without a browser. Given the current zoom
// transform and how much the viewport grew or shrank, return the new translation.
//
// The world point under the viewport centre is ((W/2 - x)/k, (H/2 - y)/k). Holding
// that point at the new centre with k unchanged reduces to shifting by half the
// size delta — the scale cancels out, which is why the zoom level is preserved
// exactly rather than approximately.
function recentreTransform(t, dW, dH) {
  return { k: t.k, x: t.x + dW / 2, y: t.y + dH / 2 };
}

// Should a resize event actually move the tree?
//
// The trap this exists for: on iOS the on-screen KEYBOARD fires resize. Re-framing
// then yanks the tree while someone is typing a name into the add-relative dialog —
// and this project has already shipped one bug where the keyboard covered that very
// dialog. So a resize while an editable element has focus is ignored outright.
//
// Also ignored: an event where the size did not actually change (some browsers fire
// resize on scroll or on a devicePixelRatio change), because re-applying a transform
// for no reason can interrupt a running d3 transition.
function shouldRecentre(prev, W, H, activeTag) {
  if (!prev) return false;                       // nothing to compare against yet
  if (W <= 0 || H <= 0) return false;            // hidden tab, or a display:none parent
  if (W === prev.w && H === prev.h) return false;
  const editing = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
  if (editing) return false;                     // the keyboard case
  return true;
}
