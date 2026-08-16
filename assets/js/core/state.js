/* ============================================================================
   state.js — People, partnerships, and the cached indexes derived from them.
   Classic script (no ES modules) so the site still works over file://.
============================================================================ */


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
  invalidateParentIndex();
  invalidateCoupleMap();
  invalidateChildIndex();

  // Open on the visitor's home node if they have set one. homeNodeId falls
  // back to loggedInUser, so the indexes above are already correct for the
  // default case; only a saved home changes what is on screen.
  const home = typeof homeNodeId === 'function' ? homeNodeId() : state.loggedInUser;
  if (home !== state.loggedInUser) {
    state.visibleNodes = new Set([home]);
    state.expandedNodes = new Set([home]);
  }
  expandNode(home, true);
}

let _coupleMap = null;

function invalidateCoupleMap() {
  _coupleMap = null;
}

// id -> [{ other, first }, ...], in partnership order.
//
// An array, not a single entry, because polygyny is supported: a man may appear
// in several partnerships. The old scalar form silently kept only the LAST one,
// so a second wife overwrote the first — the husband pointed at wife 2 while
// wife 1 still pointed back at him. That asymmetry made collapseSubtree strand
// earlier wives on the canvas and made expandOneLevel reveal only the last.
//
// `first` is true for partners[0], which keeps the husband on the left
// deterministically instead of letting an x-order tie decide.
function coupleMap() {
  if (_coupleMap) return _coupleMap;
  const m = Object.create(null);
  for (const pp of state.partnerships) {
    const [a, b] = pp.partners;
    if (a && b) {
      (m[a] ||= []).push({ other: b, first: true });
      (m[b] ||= []).push({ other: a, first: false });
    }
  }
  _coupleMap = m;
  return m;
}

// Every spouse of id. Callers that must act on the whole marriage set — showing
// or hiding wives along with their husband — want this, not just one.
function partnersOf(id) {
  return coupleMap()[id] || [];
}

// Symmetric spouse test. Asking coupleMap()[a] alone is not enough: with two
// wives, a's array contains both, but the answer must not depend on which of
// the pair is passed first.
function areSpouses(a, b) {
  if (!a || !b) return false;
  for (const c of partnersOf(a)) if (c.other === b) return true;
  return false;
}

// The one spouse to seat adjacent to id. First visible wins, so the pairing is
// stable as branches expand and collapse.
function visiblePartnerOf(id, layout) {
  for (const c of partnersOf(id)) {
    if (state.visibleNodes.has(c.other) && layout[c.other]) return c;
  }
  return null;
}

// Every visible spouse, in marriage order. Layout needs all of them: with two
// wives, positioning only the first leaves the second wherever the initial
// pass dropped her, which can be between her husband and his other wife.
function visiblePartnersOf(id, layout) {
  return partnersOf(id).filter(c => state.visibleNodes.has(c.other) && layout[c.other]);
}

// True when id is partners[0] in any marriage — the member layout positions the
// group from.
function isHusbandOf(id) {
  for (const c of partnersOf(id)) if (c.first) return true;
  return false;
}

// Same marriage group: married to each other, OR co-wives of one husband.
// resolveOverlaps needs the second case, or two wives get pushed to the full
// stranger gap and the cluster stops reading as one family.
function inSameMarriageGroup(a, b) {
  if (areSpouses(a, b)) return true;
  const pa = partnersOf(a), pb = partnersOf(b);
  for (const x of pa) for (const y of pb) if (x.other === y.other) return true;
  return false;
}

// =============================================================================
// 7. NODE PANEL
// =============================================================================

let _childIndex = null;

function invalidateChildIndex() {
  _childIndex = null;
}

// parent id -> child ids. Indexes BOTH partners, so a wife resolves to the
// couple's children — the same set expandSubtree would walk from her.
function childIndex() {
  if (_childIndex) return _childIndex;
  const idx = Object.create(null);
  for (const pp of state.partnerships) {
    for (const p of pp.partners) {
      if (!p) continue;
      if (!idx[p]) idx[p] = [];
      for (const c of pp.children) if (c) idx[p].push(c);
    }
  }
  _childIndex = idx;
  return idx;
}

// How many people a subtree expand would reveal. Cached index rather than a
// partnership rescan, because this runs on every node click.
function descendantCount(personId) {
  const idx = childIndex();
  const seen = new Set([personId]);
  const stack = [personId];
  let n = 0;
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const c of (idx[cur] || [])) {
      if (seen.has(c)) continue;
      seen.add(c);
      n++;
      stack.push(c);
    }
  }
  return n;
}

// Rules 2 and 3: women are terminal. Nothing extends from a wife or a daughter.
function isTerminal(personId) {
  const p = state.people[personId];
  return !!p && p.gender === 'female';
}

function hasFather(personId) {
  const idx = parentIndex();
  return !!idx[personId];
}

// -----------------------------------------------------------------------------
// Ancestor chains for disambiguating search hits.
//
// 165 people are named محمد, so a bare result list is useless. Each hit gets the
// SHORTEST ancestor chain that separates it from the other hits — different hits
// need different depths, so we grow the chain only until that particular hit is
// unique. Two brothers both named محمد need one ancestor; two unrelated محمد
// might need four.
// -----------------------------------------------------------------------------

let _parentIndex = null;

function invalidateParentIndex() {
  _parentIndex = null;
}

// child id -> father id. Built once; the raw partnership scan is O(P) per lookup
// and search runs on every keystroke.
function parentIndex() {
  if (_parentIndex) return _parentIndex;
  const idx = Object.create(null);
  for (const pp of state.partnerships) {
    const father = pp.partners[0] || pp.partners[1] || null;
    for (const c of pp.children) {
      if (c && !(c in idx)) idx[c] = father;
    }
  }
  _parentIndex = idx;
  return idx;
}

// Ancestor ids, nearest first. Guarded against a cycle in bad data.
function ancestorChain(id, maxDepth) {
  const idx = parentIndex();
  const out = [];
  const seen = new Set([id]);
  let cur = idx[id];
  while (cur && out.length < maxDepth && !seen.has(cur) && state.people[cur]) {
    out.push(cur);
    seen.add(cur);
    cur = idx[cur];
  }
  return out;
}
