/* ============================================================================
   edit.js — Structural editing. Loaded by admin.html ONLY — the user view
   cannot add or rename anyone because this file is never fetched.
   Classic script (no ES modules) so the site still works over file://.
============================================================================ */


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
  // Layer 2 of the guard: even if the button were somehow clickable.
  if (isTerminal(personId)) return;

  state._modalTargetId = personId;
  document.getElementById('modal-name').value = '';

  // Only offer relations that are legal for this person. A father can only be
  // added to someone who does not already have one; polygyny means a wife is
  // always offerable.
  const sel = document.getElementById('modal-relation');
  const allowFather = !hasFather(personId);
  for (const opt of sel.options) {
    const legal = opt.value !== 'father' || allowFather;
    opt.disabled = !legal;
    opt.hidden = !legal;
  }
  sel.value = 'son';

  document.getElementById('modal-overlay').classList.add('visible');
  setTimeout(() => document.getElementById('modal-name').focus(), 300);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
  state._modalTargetId = null;
}

// Relation -> (structural op, gender). Gender is implied, never chosen, so a
// combination like "wife, male" cannot be expressed.
const RELATIONS = {
  son:      { kind: 'child',   gender: 'male',   dGen:  1 },
  daughter: { kind: 'child',   gender: 'female', dGen:  1 },
  wife:     { kind: 'partner', gender: 'female', dGen:  0 },
  father:   { kind: 'parent',  gender: 'male',   dGen: -1 },
};

function saveRelative() {
  const targetId = state._modalTargetId;
  if (!targetId) return;

  // Layer 3 of the guard.
  if (isTerminal(targetId)) { closeModal(); return; }

  const name = document.getElementById('modal-name').value.trim();
  if (!name) { document.getElementById('modal-name').focus(); return; }

  const rel = RELATIONS[document.getElementById('modal-relation').value];
  if (!rel) return;
  if (rel.kind === 'parent' && hasFather(targetId)) { closeModal(); return; }

  const targetPerson = state.people[targetId];
  const newId  = state.generateId();
  const newGen = targetPerson.generation + rel.dGen;

  state.people[newId] = { id: newId, name, gender: rel.gender, generation: newGen };

  if (rel.kind === 'child') {
    // Prefer a partnership the target already fathers, so new children join
    // their existing siblings under the same couple.
    let pp = state.partnerships.find(p => p.partners[0] === targetId || p.partners[1] === targetId);
    if (pp) {
      pp.children.push(newId);
    } else {
      state.partnerships.push({ id: state.generatePPId(), partners: [targetId, null], children: [newId] });
    }

  } else if (rel.kind === 'partner') {
    // Fill an empty second slot if there is one: that instantly re-hangs this
    // man's existing children from the couple's midpoint. Otherwise he already
    // has a wife, so this is a second marriage and gets its own partnership.
    const openPP = state.partnerships.find(p =>
      (p.partners[0] === targetId && p.partners[1] === null) ||
      (p.partners[1] === targetId && p.partners[0] === null));
    if (openPP) {
      openPP.partners[openPP.partners.indexOf(null)] = newId;
    } else {
      state.partnerships.push({ id: state.generatePPId(), partners: [targetId, newId], children: [] });
    }

  } else if (rel.kind === 'parent') {
    state.partnerships.push({ id: state.generatePPId(), partners: [newId, null], children: [targetId] });
  }

  state.visibleNodes.add(newId);
  invalidateParentIndex();
  invalidateCoupleMap();
  invalidateChildIndex();
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
        .call(setNodeLabel);
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
