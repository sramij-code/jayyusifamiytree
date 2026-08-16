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

  // Escape closed the admin gate and the inline name editor but not this one.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('modal-overlay').classList.contains('visible')) return;
    closeModal();
  });

  // On a phone the name field is the whole point of the dialog, and the
  // on-screen keyboard's Go/Enter key is the natural way to commit.
  document.getElementById('modal-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveRelative(); }
  });
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

  // Autofocus summons the on-screen keyboard, which on a short phone viewport
  // covers the dialog it was opened for. Let the user tap the field.
  if (!window.matchMedia('(max-width: 640px)').matches) {
    setTimeout(() => document.getElementById('modal-name').focus(), 300);
  }
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

  // Before the first mutation, so undo restores the exact prior tree.
  FTChangeLog.pushUndo('add ' + name);

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
    // A marriage is always its own partnership, never a fill of an existing
    // empty slot.
    //
    // Filling the slot looked tidier — it re-hung the man's children from the
    // couple's midpoint — but it declared the new wife the mother of every
    // child he already had. All 659 partnerships imported from the 1999 source
    // are [father, null], so that fired on the FIRST wife added to anyone.
    // Two people adding a wife to the same man then produced different trees
    // depending on which write landed first: on p11 (16 sons) whichever wife
    // was saved first became mother of all 16, and reverting her silently
    // rewrote the other person's edit.
    //
    // Adding a partnership instead is commutative — any order gives the same
    // tree — and reverting one drops a childless partnership that orphans
    // nothing. The cost is that children stay hung off the father rather than
    // the midpoint, which is a deliberate departure from the midpoint rule:
    // the source records no mothers, so the midpoint was asserting a fact we
    // do not have.
    state.partnerships.push({
      id: state.generatePPId(), partners: [targetId, newId], children: [],
    });

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

  // Record before rendering: `describe` needs the tree as it is now, and a
  // later edit could rename the target or move it.
  const OP = { child: 'add_child', partner: 'add_wife', parent: 'add_father' };
  const REL_AR = { son: 'ابن', daughter: 'ابنة', wife: 'زوجة', father: 'أب' };
  const relKey = document.getElementById('modal-relation').value;
  FTChangeLog.record({
    op: OP[rel.kind],
    target: targetId,
    targetName: targetPerson.name,
    id: newId,
    name: name,
    gender: rel.gender,
    generation: newGen,
    describe: `+ ${name} · ${REL_AR[relKey]} of ${targetPerson.name} (${targetId})`,
  });

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
    // A blur with the name unchanged is the common case — closing the editor
    // by clicking away. Only an actual change is worth a changelog line.
    if (newName && newName !== person.name) {
      const oldName = person.name;
      FTChangeLog.pushUndo('rename ' + oldName);
      state.people[personId].name = newName;
      FTChangeLog.record({
        op: 'rename',
        target: personId,
        from: oldName,
        to: newName,
        describe: `~ ${personId}: ${oldName} → ${newName}`,
      });
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
