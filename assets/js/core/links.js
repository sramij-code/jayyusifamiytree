/* ============================================================================
   links.js — Connector path construction: stems, sibling buses, marriage bars.
   Classic script (no ES modules) so the site still works over file://.
============================================================================ */


// All connector lines use the same muted indigo
const GEN_LINE_COLORS = [
  "#9575c4",
  "#9575c4",
  "#9575c4",
  "#9575c4",
  "#9575c4",
  "#9575c4",
];

function getGenColor(gen) {
  return GEN_COLORS[gen % GEN_COLORS.length];
}

function getLineColor(gen) {
  return window.activeLineColor || GEN_LINE_COLORS[gen % GEN_LINE_COLORS.length];
}

function buildLinkPaths(layout) {
  const paths = [];

  for (const pp of state.partnerships) {
    const [pA, pB] = pp.partners;
    const visA = pA && state.visibleNodes.has(pA) && layout[pA];
    const visB = pB && state.visibleNodes.has(pB) && layout[pB];

    const visibleChildren = pp.children.filter(
      cId => cId && state.visibleNodes.has(cId) && layout[cId]
    );

    if (!visA && !visB) continue;

    const partnerGen = visA
      ? state.people[pA].generation
      : state.people[pB].generation;
    const color = getLineColor(partnerGen);

    // Flag whether this partnership is on the selected ancestor path
    const childOnPath = pp.children.some(cId => state.selectedPathIds.has(cId));
    const partnerOnPath = (pA && state.selectedPathIds.has(pA)) ||
                          (pB && state.selectedPathIds.has(pB));
    const onPath = childOnPath && partnerOnPath;

    let midX, midY;

    if (visA && visB) {
      const ax = layout[pA].x;
      const bx = layout[pB].x;
      const ay = layout[pA].y;
      midX = (ax + bx) / 2;
      midY = ay;

      const leftX  = Math.min(ax, bx) + NODE_W / 2;
      const rightX = Math.max(ax, bx) - NODE_W / 2;

      paths.push({
        id: `pp-line-${pp.id}`,
        path: `M ${leftX} ${midY} H ${rightX}`,
        color: '#b45309',
        marriage: true,
        onPath,
      });
    } else if (visA) {
      midX = layout[pA].x;
      midY = layout[pA].y;
    } else {
      midX = layout[pB].x;
      midY = layout[pB].y;
    }

    if (visibleChildren.length === 0) continue;

    const dropY = midY + NODE_H / 2 + (V_GAP * 0.35);

    if (visibleChildren.length === 1) {
      const cId = visibleChildren[0];
      const cx = layout[cId].x;
      const childY = layout[cId].y - NODE_H / 2;
      paths.push({
        id: `drop-${pp.id}`,
        path: `M ${midX} ${midY + NODE_H / 2} V ${dropY} H ${cx} V ${childY}`,
        color,
        onPath,
      });
    } else {
      const childXs = visibleChildren.map(cId => layout[cId].x);
      // The bus must reach the stem, not just span the children. Once children
      // drop from a couple's midpoint that midpoint can sit outside the
      // children's own x-range, and a bus drawn only across the children leaves
      // the stem dangling in mid-air (by exactly COUPLE_GAP/2 in the worst case).
      const busLeft  = Math.min(midX, ...childXs);
      const busRight = Math.max(midX, ...childXs);

      paths.push({
        id: `drop-${pp.id}`,
        path: `M ${midX} ${midY + NODE_H / 2} V ${dropY}`,
        color,
        onPath,
      });

      // The ancestor path travels along only PART of the sibling bus: from the
      // parent's stem across to the one child it descends through. Highlighting
      // the whole bus lit up the run out to every other sibling as well, so the
      // trail appeared to continue into branches it never enters.
      //
      // Drawn as two paths — the plain full bus, then a highlighted overlay of
      // just the traversed span. Splitting into three segments instead would
      // leave visible seams where the round line caps meet.
      const onPathChild = onPath
        ? visibleChildren.find(cId => state.selectedPathIds.has(cId))
        : undefined;

      paths.push({
        id: `bus-${pp.id}`,
        path: `M ${busLeft} ${dropY} H ${busRight}`,
        color,
        onPath: onPath && onPathChild === undefined,
      });

      if (onPathChild !== undefined) {
        const px = layout[onPathChild].x;
        // Pushed after the full bus so it paints on top: paths render in array
        // order.
        paths.push({
          id: `bus-onpath-${pp.id}`,
          path: `M ${Math.min(midX, px)} ${dropY} H ${Math.max(midX, px)}`,
          color,
          onPath: true,
        });
      }

      for (const cId of visibleChildren) {
        const cx = layout[cId].x;
        const childY = layout[cId].y - NODE_H / 2;
        const childOnPathSegment = onPath && state.selectedPathIds.has(cId);
        paths.push({
          id: `child-drop-${pp.id}-${cId}`,
          path: `M ${cx} ${dropY} V ${childY}`,
          color,
          onPath: childOnPathSegment,
        });
      }
    }
  }

  return paths;
}
