/* ============================================================================
   propose-ui.js — the propose-mode controls in index.html.

   Kept separate from propose.js (which owns state and the network call) so the
   DOM wiring can be read on its own, matching how admin.js relates to
   publish.js.
============================================================================ */

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

function markProposeState() {
  const bar = document.getElementById('propose-bar');
  if (!bar) return;

  const on = FTPropose.isOn();
  const n = FTChangeLog.count();
  const me = FTPropose.me();
  const sent = FTPropose.sent().length;

  document.getElementById('propose-toggle').textContent = on
    ? '✕ إنهاء الاقتراح'
    : '✎ اقتراح تعديل';

  const who = document.getElementById('propose-who');
  if (who) {
    who.textContent = me.node ? me.name : 'من أنت؟';
    who.title = me.node
      ? 'Your proposals are sent as ' + me.name + ' (' + me.node + '). Click to change.'
      : 'Find yourself in the tree so your proposals carry your name.';
  }

  const state_ = document.getElementById('propose-state');
  if (state_) {
    if (n > 0) {
      state_.textContent = '● ' + n + (n === 1 ? ' تعديل غير مُرسل' : ' تعديلات غير مُرسلة');
      state_.className = 'dirty';
    } else if (sent > 0) {
      state_.textContent = '✓ ' + sent + (sent === 1 ? ' اقتراح قيد المراجعة' : ' اقتراحات قيد المراجعة');
      state_.className = 'sent';
    } else {
      state_.textContent = '';
      state_.className = '';
    }
  }

  const send = document.getElementById('btn-propose-send');
  if (send) send.disabled = n === 0;

  const undo = document.getElementById('btn-propose-undo');
  if (undo) undo.disabled = !FTChangeLog.canUndo();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function initProposeUI() {
  const toggle = document.getElementById('propose-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const turningOn = !FTPropose.isOn();
    FTPropose.setOn(turningOn);
    // Ask who they are the first time, so proposals are never anonymous by
    // accident. Only when they have not already claimed a node.
    if (turningOn && !localStorageHasHome()) openWhoModal();
    markProposeState();
  });

  const who = document.getElementById('propose-who');
  if (who) who.addEventListener('click', openWhoModal);

  document.getElementById('btn-propose-send').addEventListener('click', openSendModal);

  document.getElementById('btn-propose-undo').addEventListener('click', () => {
    if (!FTChangeLog.undo()) return;
    render(true);
    renderSearchResults(
      document.getElementById('search-input').value,
      document.getElementById('search-results'));
    markProposeState();
  });

  // Add-relative, same modal as admin uses.
  const add = document.getElementById('btn-add-relative');
  if (add) {
    add.addEventListener('click', () => {
      if (state.selectedNodeId && !isTerminal(state.selectedNodeId)) openModal(state.selectedNodeId);
    });
  }

  const del = document.getElementById('btn-delete-person');
  if (del) {
    del.addEventListener('click', () => {
      if (state.selectedNodeId) requestDeletePerson(state.selectedNodeId);
    });
  }

  initWhoModal();
  initSendModal();
}

// homeNodeId() falls back to the root, so it cannot distinguish "I am the root"
// from "never chosen". Read the key directly for that.
function localStorageHasHome() {
  try { return !!localStorage.getItem('ftHomeNode'); } catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// "Who are you?" — claims a node as the visitor's identity.
// ---------------------------------------------------------------------------

function initWhoModal() {
  const overlay = document.getElementById('who-modal-overlay');
  if (!overlay) return;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWhoModal(); });
  document.getElementById('who-cancel').addEventListener('click', closeWhoModal);

  const input = document.getElementById('who-search');
  input.addEventListener('input', () => renderWhoResults(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWhoModal(); });
}

function openWhoModal() {
  const overlay = document.getElementById('who-modal-overlay');
  if (!overlay) return;
  document.getElementById('who-search').value = '';
  renderWhoResults('');
  overlay.classList.add('visible');
  if (!window.matchMedia('(max-width: 640px)').matches) {
    setTimeout(() => document.getElementById('who-search').focus(), 200);
  }
}

function closeWhoModal() {
  const overlay = document.getElementById('who-modal-overlay');
  if (overlay) overlay.classList.remove('visible');
}

// Reuses the same normalised matching as the sidebar search, so someone typing
// "Rami" or "رامي" finds the same person.
function renderWhoResults(q) {
  const box = document.getElementById('who-results');
  box.textContent = '';
  const query = q.trim().toLowerCase();
  if (!query) {
    const hint = document.createElement('div');
    hint.className = 'who-hint';
    hint.textContent = 'اكتب اسمك للبحث · type your name';
    box.appendChild(hint);
    return;
  }

  const qNorm = typeof normalizeArabic === 'function' ? normalizeArabic(query).toLowerCase() : query;
  const hits = Object.values(state.people).filter(p => {
    const hay = typeof searchableName === 'function' ? searchableName(p.name) : p.name.toLowerCase();
    return hay.includes(query) || (qNorm && hay.includes(qNorm));
  }).slice(0, 30);

  if (hits.length === 0) {
    const none = document.createElement('div');
    none.className = 'who-hint';
    none.textContent = 'لا توجد نتائج';
    box.appendChild(none);
    return;
  }

  // 165 people are named محمد, so show the ancestor chain — otherwise the list
  // is unusable for exactly the commonest names.
  for (const p of hits) {
    const row = document.createElement('button');
    row.className = 'who-row';

    const name = document.createElement('span');
    name.className = 'who-name';
    name.textContent = p.name;
    row.appendChild(name);

    const chain = ancestorChain(p.id, 3).map(id => state.people[id].name);
    if (chain.length) {
      const anc = document.createElement('span');
      anc.className = 'who-chain';
      anc.textContent = 'بن ' + chain.join(' بن ');
      row.appendChild(anc);
    }

    row.addEventListener('click', () => {
      setHomeNode(p.id);
      closeWhoModal();
      markProposeState();
      // Take them to themselves, which is also the most useful place to start
      // proposing from.
      navigateToNode(p.id);
    });
    box.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Send — review the batch, add a note, submit.
// ---------------------------------------------------------------------------

function initSendModal() {
  const overlay = document.getElementById('send-modal-overlay');
  if (!overlay) return;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSendModal(); });
  document.getElementById('send-cancel').addEventListener('click', closeSendModal);
  document.getElementById('send-submit').addEventListener('click', doSubmit);
  document.getElementById('send-note').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSendModal();
  });
}

function openSendModal() {
  const overlay = document.getElementById('send-modal-overlay');
  if (!overlay) return;

  const list = document.getElementById('send-list');
  list.textContent = '';
  for (const e of FTChangeLog.entries()) {
    const row = document.createElement('div');
    row.className = 'send-item';
    row.textContent = e.describe;
    list.appendChild(row);
  }

  const me = FTPropose.me();
  document.getElementById('send-from').textContent = me.node
    ? me.name + ' (' + me.node + ')'
    : 'غير محدد — اختر اسمك أولاً';

  document.getElementById('send-error').textContent = '';
  document.getElementById('send-submit').disabled = false;
  overlay.classList.add('visible');
}

function closeSendModal() {
  const overlay = document.getElementById('send-modal-overlay');
  if (overlay) overlay.classList.remove('visible');
}

async function doSubmit() {
  const btn = document.getElementById('send-submit');
  const err = document.getElementById('send-error');
  const note = document.getElementById('send-note').value;

  btn.disabled = true;
  err.textContent = 'جارٍ الإرسال…';
  try {
    await FTPropose.submit(note);
    closeSendModal();
    document.getElementById('send-note').value = '';
    markProposeState();
  } catch (e) {
    // The draft and the log are untouched on failure, so nothing is lost and
    // they can retry.
    err.textContent = e.message;
    btn.disabled = false;
  }
}
