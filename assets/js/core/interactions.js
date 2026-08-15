/* ============================================================================
   interactions.js — Visibility model: expand, collapse, selection, node panel.
   Classic script (no ES modules) so the site still works over file://.
============================================================================ */


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
  // A big branch can shift the clicked node thousands of px, so keep it in view.
  setTimeout(() => centerOnNode(personId, true), 60);
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

function showNodePanel(personId) {
  const person = state.people[personId];
  if (!person) return;
  const en = typeof englishName === 'function' ? englishName(person.name) : null;
  document.getElementById('panel-name').textContent =
    en ? person.name + ' (' + en + ')' : person.name;

  // Disabled rather than hidden: hiding it makes the panel resize under the cursor.
  // Absent in the user view by design — that page never renders an add button.
  // Core must not assume the admin DOM exists.
  const btn = document.getElementById('btn-add-relative');
  if (btn) {
    const terminal = isTerminal(personId);
    btn.disabled = terminal;
    btn.textContent = terminal ? 'عقدة نهائية' : 'إضافة قريب';
    btn.title = terminal ? 'لا يمكن إضافة أقارب إلى عقدة أنثى' : '';
  }

  // Subtree expand, labelled with what it will actually reveal, so a 1,178-person
  // branch is not one indistinguishable click away from a 3-person one.
  const sub = document.getElementById('btn-expand-subtree');
  const n = descendantCount(personId);
  sub.disabled = n === 0;
  sub.textContent = n === 0 ? 'لا فروع' : `توسيع الفرع (${n})`;
  sub.title = n === 0
    ? 'لا يوجد أبناء لهذه العقدة'
    : `توسيع ${n} من الأبناء والأحفاد · ⌘-click على العقدة يفعل نفس الشيء`;

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
