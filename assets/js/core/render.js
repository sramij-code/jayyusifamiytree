/* ============================================================================
   render.js — SVG rendering and the zoom/viewport surface.
   Classic script (no ES modules) so the site still works over file://.
============================================================================ */


// =============================================================================
// 5. RENDERER
// =============================================================================

let svg, zoomGroup, zoomBehavior;

function initSVG() {
  svg = d3.select('#tree-svg');

  zoomBehavior = d3.zoom()
    .scaleExtent([0.2, 3])
    // live-repo behaviour: a small drag must not register as a click
    .clickDistance(5)
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

// Node label: the Arabic name plus its English transliteration in parentheses.
// Two tspans rather than one string, so the English can be smaller and dimmer,
// and so each script stays its own bidi run — a mixed Arabic/Latin string
// reorders unpredictably depending on which character comes first.
function setNodeLabel(sel) {
  sel.each(function (d) {
    const t = d3.select(this);
    t.text(null);
    t.selectAll('tspan').remove();
    t.append('tspan')
      .attr('class', 'node-text-ar')
      .text(d.person.name);
    const en = typeof englishName === 'function' ? englishName(d.person.name) : null;
    if (en) {
      t.append('tspan')
        .attr('class', 'node-text-en')
        .attr('dx', 5)
        .text('(' + en + ')');
    }
  });
}

// Generation pill. Solid bar for men, hollow outline for women — the generation
// hue moves from fill to stroke, so the pill carries gender AND generation at
// once rather than trading one for the other. The female pill is 2px wider so
// the hollow interior is actually visible at a 5px bar width.
function styleGenPill(sel) {
  const female = d => d.person.gender === 'female';
  sel
    .attr('x', d => female(d) ? -NODE_W / 2 + 9 : -NODE_W / 2 + 10)
    .attr('width', d => female(d) ? 7 : 5)
    .attr('fill', d => female(d) ? 'none' : getGenColor(d.person.generation))
    .attr('stroke', d => female(d) ? getGenColor(d.person.generation) : 'none')
    .attr('stroke-width', d => female(d) ? 1.5 : 0);
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
      if (state.markedForRemovalIds.has(d.id)) cls += ' node-marked-removal';
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
    // Stadium corners for women, so gender reads in silhouette at any zoom.
    // The generation pill is deliberately left alone: it already encodes generation.
    .attr('rx', d => d.person.gender === 'female' ? NODE_H / 2 : 16)
    .attr('ry', d => d.person.gender === 'female' ? NODE_H / 2 : 16)
    .attr('fill', () => window.activeNodeColor || '#ede8ff')
    .attr('stroke', d => d.id === state.loggedInUser ? '#7c3aed' : 'none')
    .attr('stroke-width', d => d.id === state.loggedInUser ? 2 : 0);

  // Generation accent pill
  entered.append('rect')
    .attr('class', 'gen-pill')
    .attr('y', -16)
    .attr('height', 32)
    .attr('rx', 2.5)
    .attr('ry', 2.5)
    .attr('pointer-events', 'none')
    .call(styleGenPill);

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
    .call(setNodeLabel)
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
    if (state.markedForRemovalIds.has(d.id)) cls += ' node-marked-removal';
    if (d.id === state.selectedNodeId) cls += ' node-selected';
    return cls;
  });

  const posUpdate = animate ? allGroups.transition().duration(400) : allGroups;
  posUpdate
    .attr('transform', d => `translate(${d.cx}, ${d.cy})`)
    .style('opacity', 1);

  allGroups.select('.node-rect')
    .attr('rx', d => d.person.gender === 'female' ? NODE_H / 2 : 16)
    .attr('ry', d => d.person.gender === 'female' ? NODE_H / 2 : 16)
    .attr('fill', () => window.activeNodeColor || '#ede8ff')
    .attr('stroke', d => d.id === state.loggedInUser ? '#7c3aed' : 'none')
    .attr('stroke-width', d => d.id === state.loggedInUser ? 2 : 0);

  allGroups.select('.gen-pill')
    .call(styleGenPill);

  allGroups.select('.node-text')
    .attr('x', -NODE_W / 2 + 23)
    .attr('y', -7)
    .attr('text-anchor', 'start')
    .style('fill', () => window.activeFontColor || '#5b21b6')
    .call(setNodeLabel);

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
    // The marriage bar sits at the couple's own row height, not at dropY, so it
    // can never be mistaken for a sibling bus. Drawn a touch heavier.
    .style('stroke-width', d => d.marriage
      ? `${(window.activeLineWidth || 1.5) * 1.8}px`
      : (d.onPath ? `${(window.activeLineWidth || 1.5) * 1.6}px`
                  : `${window.activeLineWidth || 1.5}px`))
    .style('opacity', d => d.marriage ? 1 : (d.onPath ? 0.9 : 0.6));
}

function centerOnNode(personId, smooth = false) {
  const layout = state.layout;
  if (!layout[personId]) return;
  // expandSubtree centres on a timer, so this can in principle fire before
  // initSVG has run.
  if (!zoomBehavior) return;

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

// Wire the watcher. Called from both bootstraps.
function initViewportWatch() {
  try {
    initViewportWatchUnsafe();
  } catch (e) {
    // A view convenience must never stop the page from booting.
  }
}

function initViewportWatchUnsafe() {
  const el = document.getElementById('tree-svg');
  if (!el || typeof window === 'undefined' || !window.addEventListener) return;

  let prev = { w: el.clientWidth, h: el.clientHeight };
  let timer = null;

  function settle() {
    timer = null;
    const W = el.clientWidth, H = el.clientHeight;
    const active = document.activeElement ? document.activeElement.tagName : null;
    if (!shouldRecentre(prev, W, H, active)) {
      // Still record the size, or a later resize would be measured from a stale
      // baseline and the tree would jump by the accumulated difference.
      if (W > 0 && H > 0) prev = { w: W, h: H };
      return;
    }
    if (zoomBehavior) {
      const cur = d3.zoomTransform(el);
      const next = recentreTransform(cur, W - prev.w, H - prev.h);
      d3.select('#tree-svg').call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(next.x, next.y).scale(next.k));
    }
    prev = { w: W, h: H };
  }

  // Debounced: a window drag fires resize continuously, and re-applying a transform
  // per event fights the drag and thrashes layout.
  window.addEventListener('resize', function () {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(settle, 150);
  });
}

// Frame a set of nodes, zooming out if they do not fit at 1:1.
//
// centerOnNode pins scale at 1.0, which is right on a desktop but clips on a
// phone: two siblings sit NODE_W + H_GAP = 258px apart and need 436px of span,
// where a 375px screen has 375. The first thing a mobile visitor saw was three
// oversized boxes with both children cut off at the edges. Never zooms IN past
// 1:1 — a lone root node filling the screen looks broken, not welcoming.
function fitToNodes(ids, smooth = false, pad = 48) {
  if (!zoomBehavior) return;
  const layout = state.layout;
  const pts = ids.map(id => layout[id]).filter(Boolean);
  if (pts.length === 0) return;

  const svgEl = document.getElementById('tree-svg');
  const W = svgEl.clientWidth;
  const H = svgEl.clientHeight;
  if (!W || !H) return;

  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  // Node coordinates are centres, so a full node's worth of box spans the edges.
  const spanW = (maxX - minX) + NODE_W + pad * 2;
  const spanH = (maxY - minY) + NODE_H + pad * 2;

  const [minScale] = zoomBehavior.scaleExtent();
  const scale = Math.max(Math.min(W / spanW, H / spanH, 1), minScale);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const transform = d3.zoomIdentity
    .translate(W / 2 - scale * cx, H / 2 - scale * cy)
    .scale(scale);

  if (smooth) {
    d3.select('#tree-svg')
      .transition().duration(700).ease(d3.easeCubicInOut)
      .call(zoomBehavior.transform, transform);
  } else {
    d3.select('#tree-svg').call(zoomBehavior.transform, transform);
  }
}
