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

// =============================================================================
// 3. STATE
// =============================================================================

const state = {
  people: {},
  partnerships: [],
  loggedInUser: null,

  visibleNodes: new Set(),
  expandedNodes: new Set(),

  layout: {},

  selectedNodeId: null,
  highlightedNodeId: null,
  selectedPathIds: new Set(),

  _idCounter: 100,
  generateId()   { return "p"  + (++this._idCounter); },
  generatePPId() { return "pp" + (++this._idCounter); },
};

function initState() {
  state.people = {};
  for (const [id, p] of Object.entries(familyData.people)) {
    state.people[id] = { ...p };
  }
  state.partnerships = familyData.partnerships.map(pp => ({
    ...pp,
    children: [...pp.children],
    partners: [...pp.partners],
  }));
  state.loggedInUser = familyData.loggedInUser;

  // Set ID counter past the highest imported ID to avoid collisions
  const maxId = Math.max(...Object.keys(familyData.people).map(id => parseInt(id.replace('p','')) || 0));
  const maxPPId = Math.max(...familyData.partnerships.map(pp => parseInt(pp.id.replace('pp','')) || 0));
  state._idCounter = Math.max(maxId, maxPPId) + 1;

  state.visibleNodes = new Set([state.loggedInUser]);
  state.expandedNodes = new Set([state.loggedInUser]);
  expandNode(state.loggedInUser, true);
}

// =============================================================================
// 4. LAYOUT ENGINE
// =============================================================================

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
    // Bottom-up: re-center each parent over its visible children
    for (let gi = sortedGens.length - 2; gi >= 0; gi--) {
      const gen = sortedGens[gi];
      for (const id of genGroups[gen]) {
        if (!layout[id]) continue;
        const childXs = getVisibleChildrenXs(id, layout);
        if (childXs.length > 0) {
          layout[id].x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
        }
      }
    }
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
    let startX = idealX !== null ? idealX - halfW : cursor;
    // Prevent this cluster from overlapping the previous one
    if (startX < cursor) startX = cursor;

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

function resolveOverlaps(ids, layout) {
  const minDist = NODE_W + H_GAP;

  const sorted = ids
    .filter(id => layout[id])
    .sort((a, b) => layout[a].x - layout[b].x);

  if (sorted.length < 2) return;

  // Forward sweep: push each node right if too close to its left neighbour
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (layout[b].x - layout[a].x < minDist) {
      layout[b].x = layout[a].x + minDist;
    }
  }

  // Backward sweep: push each node left if too close to its right neighbour
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (layout[b].x - layout[a].x < minDist) {
      layout[a].x = layout[b].x - minDist;
    }
  }
}

// =============================================================================
// 5. RENDERER
// =============================================================================

let svg, zoomGroup, zoomBehavior;

function initSVG() {
  svg = d3.select('#tree-svg');

  zoomBehavior = d3.zoom()
    .scaleExtent([0.2, 3])
    .on('zoom', (event) => {
      zoomGroup.attr('transform', event.transform);
    });

  svg.call(zoomBehavior);

  zoomGroup = svg.append('g').attr('id', 'zoom-group');
  zoomGroup.append('g').attr('id', 'links-layer');
  zoomGroup.append('g').attr('id', 'nodes-layer');
}

function render(animate = false) {
  const layout = computeLayout();
  state.layout = layout;
  renderLinks(layout, animate);
  renderNodes(layout, animate);
  // Update status bar
  const total = Object.keys(state.people).length;
  const el = document.getElementById('status-nodes');
  if (el) el.textContent = `NODES: ${total}`;
}

function renderNodes(layout, animate) {
  const nodesLayer = d3.select('#nodes-layer');
  const visibleIds = [...state.visibleNodes].filter(id => state.people[id] && layout[id]);

  const nodeData = visibleIds.map(id => ({
    id,
    person: state.people[id],
    cx: layout[id].x,
    cy: layout[id].y,
  }));

  const groups = nodesLayer.selectAll('.node-group')
    .data(nodeData, d => d.id);

  // EXIT
  groups.exit()
    .transition().duration(animate ? 300 : 0)
    .style('opacity', 0)
    .remove();

  // ENTER
  const entered = groups.enter()
    .append('g')
    .attr('class', d => {
      let cls = 'node-group';
      if (d.id === state.loggedInUser) cls += ' node-logged-in';
      if (d.id === state.highlightedNodeId) cls += ' node-highlighted';
      if (state.selectedPathIds.has(d.id)) cls += ' node-on-path';
      if (d.id === state.selectedNodeId) cls += ' node-selected';
      return cls;
    })
    .attr('transform', d => `translate(${d.cx}, ${d.cy})`)
    .style('opacity', 0)
    .on('click', (event, d) => {
      event.stopPropagation();
      onNodeClick(d.id, event);
    });

  entered.append('rect')
    .attr('class', 'node-rect')
    .attr('x', -NODE_W / 2)
    .attr('y', -NODE_H / 2)
    .attr('width', NODE_W)
    .attr('height', NODE_H)
    .attr('rx', 16)
    .attr('ry', 16)
    .attr('fill', () => window.activeNodeColor || '#ede8ff')
    .attr('stroke', d => d.id === state.loggedInUser ? '#7c3aed' : 'none')
    .attr('stroke-width', d => d.id === state.loggedInUser ? 2 : 0);

  // Generation accent pill
  entered.append('rect')
    .attr('class', 'gen-pill')
    .attr('x', -NODE_W / 2 + 10)
    .attr('y', -16)
    .attr('width', 5)
    .attr('height', 32)
    .attr('rx', 2.5)
    .attr('ry', 2.5)
    .attr('fill', d => getGenColor(d.person.generation))
    .attr('pointer-events', 'none');

  // Name text — left-aligned, positioned after the pill
  // pill left edge = -NODE_W/2 + 10, pill width = 5, gap = 8 → text starts at -NODE_W/2 + 23
  const TEXT_X = -NODE_W / 2 + 23;

  entered.append('text')
    .attr('class', 'node-text')
    .attr('x', TEXT_X)
    .attr('y', -7)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .style('fill', () => window.activeFontColor || '#5b21b6')
    .text(d => d.person.name)
    .on('click', (event, d) => {
      event.stopPropagation();
      startEditName(d.id);
    });

  // Sub text — generation label
  entered.append('text')
    .attr('class', 'node-sub-text')
    .attr('x', TEXT_X)
    .attr('y', 9)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .attr('font-family', "'Share Tech Mono', monospace")
    .attr('font-size', '9px')
    .attr('fill', '#9575c4')
    .attr('pointer-events', 'none')
    .text(d => `${d.id} · G${d.person.generation} · ${d.person.gender === 'male' ? '♂' : '♀'}`);

  entered.append('text')
    .attr('class', 'expand-indicator')
    .attr('x', NODE_W / 2 - 12)
    .attr('y', -NODE_H / 2 + 13)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', '13px')
    .attr('fill', '#9575c4')
    .attr('font-weight', 'bold')
    .text(d => hasHiddenRelatives(d.id) ? '+' : '');

  // UPDATE — one single transition handles both position and opacity so a second
  // unnamed transition doesn't cancel the fade-in of newly entered nodes
  const allGroups = entered.merge(groups);

  allGroups.attr('class', d => {
    let cls = 'node-group';
    if (d.id === state.loggedInUser) cls += ' node-logged-in';
    if (d.id === state.highlightedNodeId) cls += ' node-highlighted';
    if (state.selectedPathIds.has(d.id)) cls += ' node-on-path';
    if (d.id === state.selectedNodeId) cls += ' node-selected';
    return cls;
  });

  const posUpdate = animate ? allGroups.transition().duration(400) : allGroups;
  posUpdate
    .attr('transform', d => `translate(${d.cx}, ${d.cy})`)
    .style('opacity', 1);

  allGroups.select('.node-rect')
    .attr('fill', () => window.activeNodeColor || '#ede8ff')
    .attr('stroke', d => d.id === state.loggedInUser ? '#7c3aed' : 'none')
    .attr('stroke-width', d => d.id === state.loggedInUser ? 2 : 0);

  allGroups.select('.gen-pill')
    .attr('fill', d => getGenColor(d.person.generation));

  allGroups.select('.node-text')
    .attr('x', -NODE_W / 2 + 23)
    .attr('y', -7)
    .attr('text-anchor', 'start')
    .style('fill', () => window.activeFontColor || '#5b21b6')
    .text(d => d.person.name);

  allGroups.select('.node-sub-text')
    .text(d => `${d.id} · G${d.person.generation} · ${d.person.gender === 'male' ? '♂' : '♀'}`);

  allGroups.select('.expand-indicator')
    .text(d => hasHiddenRelatives(d.id) ? '+' : '');
}

function renderLinks(layout, animate) {
  const linksLayer = d3.select('#links-layer');
  const paths = buildLinkPaths(layout);

  const lines = linksLayer.selectAll('.link-line')
    .data(paths, d => d.id);

  lines.exit()
    .transition().duration(animate ? 250 : 0)
    .style('opacity', 0)
    .remove();

  const entered = lines.enter()
    .append('path')
    .attr('class', 'link-line')
    .attr('d', d => d.path)
    .attr('stroke', d => d.color)
    .style('opacity', 0);

  // One transition for both path and opacity
  const allLines = entered.merge(lines);
  const linesUpdate = animate ? allLines.transition().duration(400) : allLines;
  linesUpdate
    .attr('d', d => d.path)
    .attr('stroke', d => d.onPath ? '#f59e0b' : d.color)
    .style('stroke-width', d => d.onPath ? `${(window.activeLineWidth||1.5)*1.6}px` : `${window.activeLineWidth||1.5}px`)
    .style('opacity', d => d.onPath ? 0.9 : 0.6);
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
        color,
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
      const busLeft  = Math.min(...childXs);
      const busRight = Math.max(...childXs);

      paths.push({
        id: `drop-${pp.id}`,
        path: `M ${midX} ${midY + NODE_H / 2} V ${dropY}`,
        color,
        onPath,
      });

      paths.push({
        id: `bus-${pp.id}`,
        path: `M ${busLeft} ${dropY} H ${busRight}`,
        color,
        onPath,
      });

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

// =============================================================================
// 6. INTERACTIONS — COLLAPSE / EXPAND
// =============================================================================

function getDirectRelatives(personId) {
  const relatives = new Set();

  for (const pp of state.partnerships) {
    const [pA, pB] = pp.partners;

    if (pp.children.includes(personId)) {
      if (pA) relatives.add(pA);
      if (pB) relatives.add(pB);
      for (const sib of pp.children) {
        if (sib && sib !== personId) relatives.add(sib);
      }
    }

    if (pA === personId || pB === personId) {
      const other = pA === personId ? pB : pA;
      if (other) relatives.add(other);
      for (const child of pp.children) {
        if (child) relatives.add(child);
      }
    }
  }

  return relatives;
}

function getAncestorPath(personId) {
  const pathIds = new Set();
  let current = personId;
  const visited = new Set();
  while (current && !visited.has(current)) {
    pathIds.add(current);
    visited.add(current);
    let parent = null;
    for (const pp of state.partnerships) {
      if (pp.children.includes(current)) {
        const [pA, pB] = pp.partners;
        parent = (pA && state.people[pA]) ? pA
               : (pB && state.people[pB]) ? pB : null;
        break;
      }
    }
    current = parent;
  }
  return pathIds;
}

function hasHiddenRelatives(personId) {
  const relatives = getDirectRelatives(personId);
  for (const id of relatives) {
    if (!state.visibleNodes.has(id)) return true;
  }
  return false;
}

function expandNode(personId, silent = true) {
  state.expandedNodes.add(personId);
  const relatives = getDirectRelatives(personId);
  for (const id of relatives) {
    state.visibleNodes.add(id);
  }
  if (!silent) render(true);
}

function collapseNode(personId) {
  state.expandedNodes.delete(personId);
  recomputeVisibleNodes();
  render(true);
}

function expandAll() {
  for (const id of Object.keys(state.people)) {
    state.expandedNodes.add(id);
    state.visibleNodes.add(id);
  }
  render(true);
}

function collapseAll() {
  state.expandedNodes.clear();
  state.expandedNodes.add(state.loggedInUser);
  state.visibleNodes = new Set([state.loggedInUser]);
  expandNode(state.loggedInUser, true);
  render(true);
  setTimeout(() => centerOnNode(state.loggedInUser, true), 50);
}

function recomputeVisibleNodes() {
  const newVisible = new Set();

  newVisible.add(state.loggedInUser);

  for (const expandedId of state.expandedNodes) {
    if (!state.people[expandedId]) continue;
    newVisible.add(expandedId);
    const relatives = getDirectRelatives(expandedId);
    for (const id of relatives) {
      newVisible.add(id);
    }
  }

  state.visibleNodes = newVisible;
}

function onNodeClick(personId, event) {
  state.selectedNodeId = personId;
  state.selectedPathIds = getAncestorPath(personId);
  showNodePanel(personId);
  if (event && (event.metaKey || event.ctrlKey)) {
    expandSubtree(personId);
  } else {
    toggleExpandCollapse(personId);
  }
}

function expandSubtree(personId) {
  const queue = [personId];
  const visited = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    state.expandedNodes.add(id);
    state.visibleNodes.add(id);
    // Find children of this person
    for (const pp of state.partnerships) {
      const [pA, pB] = pp.partners;
      if (pA === id || pB === id) {
        // Also show the partner
        const other = pA === id ? pB : pA;
        if (other) state.visibleNodes.add(other);
        for (const childId of pp.children) {
          if (childId && !visited.has(childId)) {
            queue.push(childId);
          }
        }
      }
    }
  }
  render(true);
}

function toggleExpandCollapse(personId) {
  if (state.expandedNodes.has(personId)) {
    // Collapse: remove from expanded and recompute visibility
    state.expandedNodes.delete(personId);
    recomputeVisibleNodes();
  } else {
    // Expand: add to expanded and make relatives visible
    state.expandedNodes.add(personId);
    const relatives = getDirectRelatives(personId);
    for (const id of relatives) {
      state.visibleNodes.add(id);
    }
  }
  render(true);
}

// =============================================================================
// 7. NODE PANEL
// =============================================================================

function showNodePanel(personId) {
  const person = state.people[personId];
  if (!person) return;
  document.getElementById('panel-name').textContent = person.name;
  document.getElementById('node-panel').classList.add('visible');
}

function hideNodePanel() {
  document.getElementById('node-panel').classList.remove('visible');
  state.selectedNodeId = null;
  state.selectedPathIds = new Set();
  d3.select('#nodes-layer').selectAll('.node-group')
    .attr('class', d => {
      let cls = 'node-group';
      if (d.id === state.loggedInUser) cls += ' node-logged-in';
      return cls;
    });
  d3.select('#links-layer').selectAll('.link-line')
    .attr('stroke', d => d.color)
    .style('stroke-width', `${window.activeLineWidth||1.5}px`)
    .style('opacity', 0.6);
}

// =============================================================================
// 8. SEARCH
// =============================================================================


function initSearch() {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  input.addEventListener('input', () => {
    renderSearchResults(input.value, results);
  });
}

function renderSearchResults(query, container) {
  container.innerHTML = '';
  const all = Object.values(state.people);

  const label = document.getElementById('results-label');

  const exactId = query.endsWith(' ');
  const q = query.trim().toLowerCase();

  if (!q) {
    if (label) label.textContent = `> INDEX [${all.length} ENTRIES]`;
    container.innerHTML = '<div class="search-empty">اكتب اسماً للبحث...</div>';
    return;
  }

  const filtered = all.filter(p => {
    if (exactId) {
      return p.id.toLowerCase() === q;
    }
    if (p.name.toLowerCase().includes(q)) return true;
    if (p.id.toLowerCase().includes(q)) return true;
    return false;
  });

  if (label) label.textContent = `> INDEX [${filtered.length} RESULTS]`;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="search-empty">لا توجد نتائج</div>';
    return;
  }

  // Show max 50 results to keep DOM fast
  const toShow = filtered.slice(0, 50);
  for (const person of toShow) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `
      <span class="result-gen">${person.id}</span>
      <span>${person.name}</span>
    `;
    item.addEventListener('click', () => navigateToNode(person.id));
    container.appendChild(item);
  }
  if (filtered.length > 50) {
    const more = document.createElement('div');
    more.className = 'search-empty';
    more.textContent = `... و${filtered.length - 50} آخرين`;
    container.appendChild(more);
  }
}

function navigateToNode(personId) {
  ensureNodeVisible(personId);
  state.highlightedNodeId = personId;
  render(true);

  setTimeout(() => {
    centerOnNode(personId, true);
    setTimeout(() => {
      state.highlightedNodeId = null;
      d3.select('#nodes-layer').selectAll('.node-group')
        .attr('class', d => {
          let cls = 'node-group';
          if (d.id === state.loggedInUser) cls += ' node-logged-in';
          return cls;
        });
    }, 3500);
  }, 450);
}

function ensureNodeVisible(personId) {
  if (state.visibleNodes.has(personId)) return;

  for (const pp of state.partnerships) {
    if (pp.children.includes(personId)) {
      const [pA, pB] = pp.partners;
      if (pA && !state.visibleNodes.has(pA)) ensureNodeVisible(pA);
      if (pB && !state.visibleNodes.has(pB)) ensureNodeVisible(pB);
      if (pA && state.visibleNodes.has(pA)) expandNode(pA, true);
      else if (pB && state.visibleNodes.has(pB)) expandNode(pB, true);
      break;
    }

    const [pA, pB] = pp.partners;
    if (pA === personId || pB === personId) {
      const other = pA === personId ? pB : pA;
      if (other && state.visibleNodes.has(other)) expandNode(other, true);
    }
  }

  if (!state.visibleNodes.has(personId)) {
    state.visibleNodes.add(personId);
  }
}

function centerOnNode(personId, smooth = false) {
  const layout = state.layout;
  if (!layout[personId]) return;

  const svgEl = document.getElementById('tree-svg');
  const W = svgEl.clientWidth;
  const H = svgEl.clientHeight;

  const scale = 1.0;
  const tx = W / 2 - scale * layout[personId].x;
  const ty = H / 2 - scale * layout[personId].y;
  const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);

  if (smooth) {
    d3.select('#tree-svg')
      .transition().duration(700).ease(d3.easeCubicInOut)
      .call(zoomBehavior.transform, transform);
  } else {
    d3.select('#tree-svg').call(zoomBehavior.transform, transform);
  }
}

// =============================================================================
// 9. MODAL — ADD RELATIVE
// =============================================================================

function initModal() {
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-save-relative').addEventListener('click', saveRelative);
}

function openModal(personId) {
  state._modalTargetId = personId;
  document.getElementById('modal-name').value = '';
  document.querySelector('input[name="modal-gender"][value="male"]').checked = true;
  document.getElementById('modal-relation').value = 'child';
  document.getElementById('modal-overlay').classList.add('visible');
  setTimeout(() => document.getElementById('modal-name').focus(), 300);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
  state._modalTargetId = null;
}

function saveRelative() {
  const targetId = state._modalTargetId;
  if (!targetId) return;

  const name = document.getElementById('modal-name').value.trim();
  if (!name) { document.getElementById('modal-name').focus(); return; }

  const relation   = document.getElementById('modal-relation').value;
  const gender     = document.querySelector('input[name="modal-gender"]:checked').value;
  const targetPerson = state.people[targetId];

  const newId  = state.generateId();
  const newGen = relation === 'child'  ? targetPerson.generation + 1
               : relation === 'parent' ? targetPerson.generation - 1
               :                         targetPerson.generation;

  state.people[newId] = { id: newId, name, gender, generation: newGen };

  if (relation === 'child') {
    let pp = state.partnerships.find(p => p.partners.includes(targetId));
    if (pp) {
      pp.children.push(newId);
    } else {
      state.partnerships.push({ id: state.generatePPId(), partners: [targetId, null], children: [newId] });
    }

  } else if (relation === 'partner') {
    let pp = state.partnerships.find(p => p.partners.includes(targetId));
    if (pp) {
      const nullIdx = pp.partners.indexOf(null);
      if (nullIdx !== -1) {
        pp.partners[nullIdx] = newId;
      } else {
        state.partnerships.push({ id: state.generatePPId(), partners: [targetId, newId], children: [] });
      }
    } else {
      state.partnerships.push({ id: state.generatePPId(), partners: [targetId, newId], children: [] });
    }

  } else if (relation === 'parent') {
    let pp = state.partnerships.find(p => p.children.includes(targetId));
    if (pp) {
      const nullIdx = pp.partners.indexOf(null);
      if (nullIdx !== -1) {
        pp.partners[nullIdx] = newId;
      } else {
        state.partnerships.push({ id: state.generatePPId(), partners: [newId, null], children: [targetId] });
      }
    } else {
      state.partnerships.push({ id: state.generatePPId(), partners: [newId, null], children: [targetId] });
    }
  }

  state.visibleNodes.add(newId);
  expandNode(targetId, true);
  recomputeVisibleNodes();
  state.visibleNodes.add(newId);

  closeModal();
  render(true);

  const input = document.getElementById('search-input');
  renderSearchResults(input.value, document.getElementById('search-results'));
}

// =============================================================================
// INLINE NAME EDITING
// =============================================================================

function startEditName(personId) {
  const person = state.people[personId];
  if (!person) return;

  // Find the node-group DOM element for this person
  const nodeEl = d3.select('#nodes-layer').selectAll('.node-group')
    .filter(d => d.id === personId)
    .node();
  if (!nodeEl) return;

  // Get screen position of the node
  const rect = nodeEl.getBoundingClientRect();
  const svgRect = document.getElementById('tree-svg').getBoundingClientRect();

  // Remove any existing editor
  const existing = document.getElementById('inline-name-editor');
  if (existing) existing.remove();

  const input = document.createElement('input');
  input.id = 'inline-name-editor';
  input.type = 'text';
  input.value = person.name;
  input.style.left   = (rect.left - svgRect.left) + 'px';
  input.style.top    = (rect.top  - svgRect.top)  + 'px';
  input.style.width  = rect.width  + 'px';
  input.style.height = rect.height + 'px';

  document.getElementById('canvas-container').appendChild(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim();
    if (newName) {
      state.people[personId].name = newName;
      d3.select('#nodes-layer').selectAll('.node-group')
        .filter(d => d.id === personId)
        .select('.node-text')
        .text(newName);
      // Refresh search list to reflect new name
      const searchInput = document.getElementById('search-input');
      renderSearchResults(searchInput.value.trim(), document.getElementById('search-results'));
    }
    input.remove();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { input.remove(); }
  });
  input.addEventListener('blur', commit);
}

// =============================================================================
// 10. INIT
// =============================================================================

function initEventListeners() {
  document.getElementById('tree-svg').addEventListener('click', () => {
    hideNodePanel();
  });

  document.getElementById('btn-add-relative').addEventListener('click', () => {
    if (state.selectedNodeId) openModal(state.selectedNodeId);
  });

  document.getElementById('btn-close-panel').addEventListener('click', () => {
    hideNodePanel();
  });

  document.getElementById('btn-expand-all').addEventListener('click', expandAll);
  document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);
}

function init() {
  initState();
  initSVG();
  initEventListeners();
  initSearch();
  initModal();

  render(false);
  renderSearchResults('', document.getElementById('search-results'));

  setTimeout(() => centerOnNode(state.loggedInUser, true), 100);
}

document.addEventListener('DOMContentLoaded', init);
