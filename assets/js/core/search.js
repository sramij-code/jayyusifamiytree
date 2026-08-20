/* ============================================================================
   search.js — Bilingual search and ancestor-chain disambiguation.
   Classic script (no ES modules) so the site still works over file://.
============================================================================ */


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

const CHAIN_MAX = 6;

// id -> how many ancestors are needed to make this hit unique (0 = name already
// unique among the hits).
function disambiguationDepths(hits) {
  const chains = new Map();
  for (const p of hits) chains.set(p.id, ancestorChain(p.id, CHAIN_MAX));

  const nameOf = id => {
    const p = state.people[id];
    if (!p) return '';
    return typeof normalizeArabic === 'function' ? normalizeArabic(p.name) : p.name;
  };
  const keyAt = (p, d) => {
    const anc = chains.get(p.id);
    let k = nameOf(p.id);
    for (let i = 0; i < d && i < anc.length; i++) k += '|' + nameOf(anc[i]);
    return k;
  };

  const pending = new Set(hits.map(p => p.id));
  const depth = new Map();
  // A hit unique at depth d is also unique at every deeper d, so once resolved
  // it can drop out of the comparison set.
  for (let d = 0; d <= CHAIN_MAX && pending.size > 0; d++) {
    const counts = new Map();
    for (const p of hits) {
      if (!pending.has(p.id)) continue;
      const k = keyAt(p, d);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const p of hits) {
      if (!pending.has(p.id)) continue;
      if (counts.get(keyAt(p, d)) === 1) {
        depth.set(p.id, d);
        pending.delete(p.id);
      }
    }
  }
  // Genuinely indistinguishable by name alone; the id column separates them.
  for (const id of pending) depth.set(id, CHAIN_MAX);
  return { depth, chains };
}

function renderSearchResults(query, container) {
  container.innerHTML = '';
  const all = Object.values(state.people);

  const label = document.getElementById('results-label');

  const exactId = query.endsWith(' ');
  const q = query.trim().toLowerCase();
  const qNorm = typeof normalizeArabic === 'function'
    ? normalizeArabic(q).toLowerCase()
    : q;

  if (!q) {
    if (label) label.textContent = `> INDEX [${all.length} ENTRIES]`;
    container.innerHTML = '<div class="search-empty">اكتب اسماً للبحث...</div>';
    return;
  }

  const filtered = all.filter(p => {
    if (exactId) {
      return p.id.toLowerCase() === q;
    }
    if (p.id.toLowerCase().includes(q)) return true;
    // Matches Arabic as typed, Arabic loosely spelled (أسعد finds اسعد), or English.
    const hay = typeof searchableName === 'function'
      ? searchableName(p.name)
      : p.name.toLowerCase();
    if (hay.includes(q)) return true;
    if (qNorm && hay.includes(qNorm)) return true;
    return false;
  });

  if (label) label.textContent = `> INDEX [${filtered.length} RESULTS]`;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="search-empty">لا توجد نتائج</div>';
    return;
  }

  // Show max 50 results to keep DOM fast
  const toShow = filtered.slice(0, 50);
  // Chain script follows the query: someone typing "Mohammad" gets a Latin
  // chain, someone typing محمد gets an Arabic one.
  const latinQuery = !/[؀-ۿ]/.test(q);
  const { depth, chains } = disambiguationDepths(toShow);
  const labelOf = (id) => {
    const p = state.people[id];
    if (!p) return '';
    if (!latinQuery) return p.name;
    const en = typeof englishName === 'function' ? englishName(p.name) : null;
    return en || p.name;
  };

  for (const person of toShow) {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const main = document.createElement('div');
    main.className = 'result-main';
    const idSpan = document.createElement('span');
    idSpan.className = 'result-gen';
    idSpan.textContent = person.id;
    const arSpan = document.createElement('span');
    arSpan.textContent = person.name;
    main.appendChild(idSpan);
    main.appendChild(arSpan);
    const en = typeof englishName === 'function' ? englishName(person.name) : null;
    if (en) {
      const enSpan = document.createElement('span');
      enSpan.className = 'result-en';
      enSpan.textContent = '(' + en + ')';
      main.appendChild(enSpan);
    }
    item.appendChild(main);

    const need = depth.get(person.id) || 0;
    if (need > 0) {
      const anc = (chains.get(person.id) || []).slice(0, need);
      if (anc.length > 0) {
        const chain = document.createElement('div');
        chain.className = 'result-chain';
        chain.textContent = anc.map(labelOf).join(' → ');
        if (anc.length < need) chain.textContent += ' → …';
        item.appendChild(chain);
      }
    }

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

// Reveal a person, opening whatever branches are needed to reach them.
//
// A WIFE USED TO BE UNREACHABLE. The partner branch only expanded her husband if he
// was ALREADY visible, and never recursed to make him visible — unlike the child
// branch, which does. So on a collapsed tree nothing happened, and the trailing
// `visibleNodes.add()` that papered over it does not survive the next
// recomputeVisibleNodes(), which rebuilds the set from expandedNodes.
//
// Measured: of the two people in the data with no father — both wives added through
// the app — this revealed neither, while 10 of 10 men with a father worked. It only
// affects 2 people today because all 1,746 imported people are recorded as male
// children; it affects EVERY wife added from here on, and this is the path a search
// hit and a proposal preview both use.
//
// Ancestry is tried first: a person's own parents are the better route when they have
// them. `seen` guards the cycle a spouse pair would otherwise make, since revealing
// her recurses to him and his partner is her.
function ensureNodeVisible(personId, _seen) {
  if (state.visibleNodes.has(personId)) return;
  const seen = _seen || new Set();
  if (seen.has(personId)) return;
  seen.add(personId);

  // As someone's child: reveal a parent, then expand them.
  for (const pp of state.partnerships) {
    if (!pp.children.includes(personId)) continue;
    const [pA, pB] = pp.partners;
    if (pA && !state.visibleNodes.has(pA)) ensureNodeVisible(pA, seen);
    if (pB && !state.visibleNodes.has(pB)) ensureNodeVisible(pB, seen);
    if (pA && state.visibleNodes.has(pA)) expandNode(pA, true);
    else if (pB && state.visibleNodes.has(pB)) expandNode(pB, true);
    return;
  }

  // As someone's spouse: reveal the SPOUSE first, then expand them. This recursion is
  // the fix; without it a wife on a collapsed tree could never be reached.
  for (const pp of state.partnerships) {
    const [pA, pB] = pp.partners;
    if (pA !== personId && pB !== personId) continue;
    const other = pA === personId ? pB : pA;
    if (!other) continue;
    if (!state.visibleNodes.has(other)) ensureNodeVisible(other, seen);
    if (state.visibleNodes.has(other)) {
      expandNode(other, true);
      return;
    }
  }

  // Last resort, for someone with no relatives at all. Kept, but note it does not
  // survive recomputeVisibleNodes — which is exactly why it was not a fix above.
  state.visibleNodes.add(personId);
}
