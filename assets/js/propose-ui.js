/* ============================================================================
   propose-ui.js — the propose-mode controls in index.html.

   Kept separate from propose.js (which owns state and the network call) so the
   DOM wiring can be read on its own, matching how admin.js relates to
   publish.js.
============================================================================ */

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

// Throw away this browser's local copy. Two clicks rather than window.confirm(),
// which Safari can suppress silently — a suppressed confirm returns false, so the
// button would look dead.
let _proposeDiscardArmed = false;

function discardMyCopy() {
  const btn = document.getElementById('btn-propose-discard');
  if (!_proposeDiscardArmed) {
    _proposeDiscardArmed = true;
    if (btn) {
      const n = FTChangeLog.count();
      btn.textContent = n > 0 ? 'تأكيد: فقدان ' + n + ' ↺' : 'تأكيد: إعادة التحميل ↺';
      btn.classList.add('danger');
    }
    setTimeout(() => {
      _proposeDiscardArmed = false;
      if (btn) { btn.textContent = 'تجاهل نسختي'; btn.classList.remove('danger'); }
    }, 4000);
    return;
  }
  FTChangeLog.discardLocal();
  // Reload rather than unpicking the mutations: window.FT_FAMILY is untouched, so a
  // fresh boot is the published tree exactly.
  location.reload();
}

function markProposeState() {
  const bar = document.getElementById('propose-bar');
  if (!bar) return;

  const on = FTPropose.isOn();
  const n = FTChangeLog.count();
  const me = FTPropose.me();

  document.getElementById('propose-toggle').textContent = on
    ? '✕ إنهاء الاقتراح'
    : '✎ اقتراح تعديل';

  const who = document.getElementById('propose-who');
  if (who) {
    who.textContent = me.identified ? me.name : 'من أنت؟';
    who.title = me.node
      ? 'Your proposals are sent as ' + me.name + ' (' + me.node + '). Click to change.'
      : me.identified
        ? 'Your proposals are sent as ' + me.name + ' (not linked to a tree node). Click to change.'
        : 'Find yourself in the tree — or type your name if you are not in it yet.';
  }

  const state_ = document.getElementById('propose-state');
  if (state_) {
    // Every string comes from FTPropose.barState(), so the bar cannot claim a
    // proposal is "قيد المراجعة" merely because it was once sent — which is what
    // `sent().length` did, permanently, since nothing ever removed from that list.
    const b = FTPropose.barState();
    if (b.state === 'unsent') {
      state_.textContent = '● ' + b.unsent + (b.unsent === 1 ? ' تعديل غير مُرسل' : ' تعديلات غير مُرسلة');
      state_.className = 'dirty';
      state_.title = '';
    } else if (b.state === 'unknown') {
      // Something was sent but we have not asked where it stands. Saying "قيد
      // المراجعة" here would be the old lie.
      state_.textContent = '… ' + b.everSent + (b.everSent === 1 ? ' اقتراح مُرسل' : ' اقتراحات مُرسلة');
      state_.className = 'sent';
      state_.title = 'Status not checked yet — open اقتراحاتي to see where they stand.';
    } else if (b.state === 'pending') {
      state_.textContent = '✓ ' + b.pending + (b.pending === 1 ? ' اقتراح قيد المراجعة' : ' اقتراحات قيد المراجعة');
      state_.className = 'sent';
      state_.title = b.approved + ' approved · ' + b.rejected + ' declined' +
                     (b.partial ? ' · counts may be high: decision history unreadable' : '');
    } else if (b.state === 'settled') {
      state_.textContent = '✓ تمت مراجعة كل اقتراحاتك';
      state_.className = 'sent';
      state_.title = b.approved + ' approved · ' + b.rejected + ' declined';
    } else {
      state_.textContent = '';
      state_.className = '';
      state_.title = '';
    }
  }

  // Shown once anything has ever been sent, in or out of propose mode: checking
  // where your suggestions stand should not require entering edit mode.
  const mineBtn = document.getElementById('btn-my-proposals');
  if (mineBtn) {
    const b = FTPropose.barState();
    const everSent = FTPropose.sent().length ||
                     (FTPropose.mineState() === 'ok' ? FTPropose.lastMine().length : 0);
    mineBtn.hidden = everSent === 0;
    const badge = document.getElementById('mine-badge');
    if (badge) {
      badge.textContent = b.pending === null ? '…' : (b.pending > 0 ? String(b.pending) : '✓');
    }
    mineBtn.classList.toggle('mine-pending', b.pending > 0);
    mineBtn.classList.toggle('mine-unknown', b.pending === null);
  }

  const send = document.getElementById('btn-propose-send');
  if (send) {
    // Identity is required, not just an edit — but a FREE-TEXT name counts, because
    // someone proposing to add themselves cannot pick a node they are not in yet.
    // There is no login, so a picked node is no more verified than a typed name; the
    // only thing a node adds is the author_node query that lets mine() re-find a
    // proposal on another device. A free-text proposer keeps only this browser's
    // local sent-list — an accepted trade, deliberately chosen by the owner.
    const who = FTPropose.me();
    send.disabled = n === 0 || !who.identified;
    send.title = !who.identified && n > 0
      ? 'عرّف نفسك أولاً · say who you are (pick yourself, or type your name) so your suggestion carries it'
      : '';
  }

  const undo = document.getElementById('btn-propose-undo');
  if (undo) undo.disabled = !FTChangeLog.canUndo();

  // Offered whenever a local copy exists, in or out of propose mode.
  const discard = document.getElementById('btn-propose-discard');
  if (discard) {
    discard.hidden = !FTChangeLog.hasDraft() && FTChangeLog.count() === 0;
    discard.title = 'تجاهل نسختك المحلية وأعد التحميل من البيانات المنشورة · ' +
                    FTChangeLog.storageSummary();
  }

  // Name the source of truth. Two pages keep two independent stores and nothing said
  // which one you were looking at. Appended to the identity chip's existing title,
  // which is already the thing a confused visitor hovers.
  const whoChip = document.getElementById('propose-who');
  if (whoChip) {
    whoChip.title = (whoChip.title || '').split('\n')[0] + '\n' + FTChangeLog.storageSummary();
  }
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
    // accident — but only when they have NO identity yet. me().identified is true
    // for a picked node OR a typed free-text name; the old check read ftHomeNode
    // alone, so a free-text identity did not count and the modal reopened on every
    // "start proposal" even though the name was already shown in the bar.
    if (turningOn && !FTPropose.me().identified) openWhoModal();
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

// ---------------------------------------------------------------------------
// "Who are you?" — claims a node as the visitor's identity.
// ---------------------------------------------------------------------------

function initWhoModal() {
  const overlay = document.getElementById('who-modal-overlay');
  if (!overlay) return;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWhoModal(); });
  document.getElementById('who-cancel').addEventListener('click', closeWhoModal);
  const confirm = document.getElementById('who-confirm');
  if (confirm) confirm.addEventListener('click', confirmWho);

  const input = document.getElementById('who-search');
  input.addEventListener('input', () => {
    // Typing changes intent, so a row selected earlier no longer applies. Confirm
    // then resolves against the typed text (as a free-text identity) unless a new
    // row is clicked.
    whoSelected = null;
    renderWhoResults(input.value);
    syncWhoConfirm();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeWhoModal(); return; }
    // Enter confirms, so a newcomer can type a name and press Return without hunting
    // for the button. Guarded on the button being enabled, i.e. there is something
    // to confirm.
    if (e.key === 'Enter') {
      const btn = document.getElementById('who-confirm');
      if (btn && !btn.disabled) { e.preventDefault(); confirmWho(); }
    }
  });
}

// The result row the visitor picked, if any. A picked row is a NODE identity; no
// pick plus typed text is a FREE-TEXT identity. Reset every time the modal opens.
let whoSelected = null;

// Enable confirm when there is anything to commit: a picked person, or typed text.
function syncWhoConfirm() {
  const btn = document.getElementById('who-confirm');
  const input = document.getElementById('who-search');
  if (!btn || !input) return;
  btn.disabled = !whoSelected && input.value.trim() === '';
}

// Commit whatever the visitor has chosen. A picked row wins; otherwise the typed
// text becomes a free-text identity (the person who is not in the tree yet). As a
// safety, typed text that is an EXACT, UNIQUE name match resolves to that node
// instead, so someone who is in fact in the tree does not silently become a
// node-less identity and lose cross-device recovery.
function confirmWho() {
  const input = document.getElementById('who-search');
  const typed = input ? input.value.trim() : '';

  let node = whoSelected ? whoSelected.id : null;
  if (!node && typed) {
    const exact = exactNameMatches(typed);
    if (exact.length === 1) node = exact[0].id;
  }

  if (node) {
    FTPropose.setMyName('');   // node identity wins; drop any stale free-text name
    setHomeNode(node);
    closeWhoModal();
    markProposeState();
    navigateToNode(node);      // land on yourself, the natural place to start
    return;
  }
  if (typed) {
    FTPropose.setMyName(typed);
    closeWhoModal();
    markProposeState();
    return;
  }
  // Nothing to confirm; leave the modal open (the button should be disabled anyway).
}

// People whose name matches the query EXACTLY once normalised. Used only to rescue
// an in-tree person who typed rather than clicked; never to force a choice.
function exactNameMatches(q) {
  const norm = s => (typeof normalizeArabic === 'function' ? normalizeArabic(s) : s).toLowerCase().trim();
  const target = norm(q);
  if (!target) return [];
  return Object.values(state.people).filter(p => norm(p.name) === target);
}

function openWhoModal() {
  const overlay = document.getElementById('who-modal-overlay');
  if (!overlay) return;
  whoSelected = null;
  document.getElementById('who-search').value = '';
  renderWhoResults('');
  syncWhoConfirm();
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
    if (whoSelected && whoSelected.id === p.id) row.classList.add('who-selected');

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

    // SELECT, not commit. The explicit تأكيد button is the single commit point for
    // both a picked person and a typed-in name, so the two paths behave identically.
    // Fill the input with the pick so it is visible what تأكيد will use.
    row.addEventListener('click', () => {
      whoSelected = { id: p.id, name: p.name };
      const input = document.getElementById('who-search');
      if (input) input.value = p.name;
      renderWhoResults(p.name);   // re-render to show the highlight
      syncWhoConfirm();
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


// =============================================================================
// MY PROPOSALS — what I sent, where it stands, and asking for one to be dropped.
// =============================================================================

function initMineUI() {
  const btn = document.getElementById('btn-my-proposals');
  if (!btn) return;

  // Check status at boot, the way admin.html already does for its badge.
  //
  // Without this the bar could only say "… N اقتراحات مُرسلة" — sent, status not
  // checked — until the visitor happened to open the drawer. So a proposal approved
  // and published days ago still read as outstanding on a fresh load, which is
  // exactly what it looks like when nothing has been checked. Quiet and
  // failure-tolerant: an unreachable inbox leaves the honest 'unknown' state.
  if (FTSupa.configured() && FTPropose.sent().length > 0) {
    FTPropose.mine().then(() => {
      markProposeState();
      const drawer = document.getElementById('mine-drawer');
      if (drawer && drawer.classList.contains('open')) renderMineList();
    }).catch(() => { /* leave it unknown rather than claiming a status */ });
  }

  btn.addEventListener('click', () => {
    const drawer = document.getElementById('mine-drawer');
    const opening = !drawer.classList.contains('open');
    drawer.classList.toggle('open', opening);
    if (opening) refreshMine();
  });

  document.getElementById('mine-close').addEventListener('click', () => {
    document.getElementById('mine-drawer').classList.remove('open');
  });
  document.getElementById('mine-refresh').addEventListener('click', refreshMine);
}

function mineStatus(text, kind) {
  const el = document.getElementById('mine-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = kind || '';
}

async function refreshMine() {
  mineStatus('جارٍ التحميل…');
  try {
    await FTPropose.mine();
    renderMineList();
    mineStatus('');
  } catch (e) {
    // Never fall back to "nothing pending": a failed fetch is unknown, not clean.
    mineStatus(e.message, 'err');
  }
  markProposeState();
}

function renderMineList() {
  const list = document.getElementById('mine-list');
  if (!list) return;
  list.textContent = '';

  const rows = FTPropose.lastMine();

  // Clearing is offered only for DECIDED proposals, and only ever hides them from
  // this device: the row stays in the inbox and in git, because the table has no
  // delete policy. The label says "hide", not "delete", for that reason.
  const settled = rows.filter(r => r._state === 'approved' || r._state === 'rejected').length;
  const hidden = FTPropose.dismissed().length;
  if (settled > 0 || hidden > 0) {
    const bar = document.createElement('div');
    bar.className = 'mine-tools';
    if (settled > 0) {
      const b = document.createElement('button');
      b.className = 'mine-btn ghost';
      b.textContent = 'إخفاء المنتهية (' + settled + ')';
      b.title = 'Hide the ' + settled + ' proposal(s) already decided. They stay in the ' +
                'reviewer\'s records — this only clears your own list on this device.';
      b.addEventListener('click', () => {
        const n = FTPropose.dismissSettled();
        renderMineList();
        markProposeState();
        mineStatus(n ? 'أُخفيت ' + n + ' من قائمتك' : 'لم يُخفَ شيء', n ? 'ok' : 'err');
      });
      bar.appendChild(b);
    }
    if (hidden > 0) {
      const r = document.createElement('button');
      r.className = 'mine-btn ghost';
      r.textContent = 'إظهار المخفية (' + hidden + ')';
      r.addEventListener('click', () => {
        FTPropose.restoreDismissed();
        refreshMine();
      });
      bar.appendChild(r);
    }
    list.appendChild(bar);
  }

  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mine-empty';
    empty.textContent = 'لم ترسل أي اقتراح بعد';
    list.appendChild(empty);
    return;
  }

  for (const row of rows) list.appendChild(mineCard(row));
}

function mineCard(row) {
  const card = document.createElement('div');
  card.className = 'mine-card state-' + row._state + (row._withdrawn ? ' withdrawn' : '');

  const head = document.createElement('div');
  head.className = 'mine-head';

  const when = document.createElement('span');
  when.className = 'mine-when';
  when.textContent = String(row.created_at || '').slice(0, 10);
  head.appendChild(when);

  const tag = document.createElement('span');
  tag.className = 'mine-tag';
  tag.textContent = row._state === 'approved' ? '✓ اعتُمد'
                  : row._state === 'rejected' ? '✕ لم يُقبل'
                  : '● قيد المراجعة';
  head.appendChild(tag);
  card.appendChild(head);

  for (const op of (row.ops || [])) {
    const line = document.createElement('div');
    line.className = 'mine-op';
    line.textContent = op.describe || op.op;
    card.appendChild(line);
  }

  if (row.note) {
    const note = document.createElement('div');
    note.className = 'mine-note';
    note.textContent = '“' + row.note + '”';
    card.appendChild(note);
  }

  if (row._withdrawn) {
    const w = document.createElement('div');
    w.className = 'mine-withdrawn';
    // Deliberately not "cancelled": nothing was removed. The reviewer decides.
    w.textContent = 'طلبتَ سحب هذا الاقتراح — القرار للمراجع';
    card.appendChild(w);
  }

  // Only a pending proposal is worth withdrawing. An approved one is already in
  // the tree, and a declined one needs nothing.
  if (row._state === 'pending' && !row._withdrawn) {
    const actions = document.createElement('div');
    actions.className = 'mine-actions';
    const b = document.createElement('button');
    b.className = 'mine-btn';
    b.textContent = 'اسحب الاقتراح';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await FTPropose.withdraw(row.id);
        renderMineList();
        mineStatus('أُرسل طلب السحب — سيظهر للمراجع', 'ok');
      } catch (e) {
        b.disabled = false;
        mineStatus(e.message, 'err');
      }
      markProposeState();
    });
    actions.appendChild(b);
    card.appendChild(actions);
  }

  return card;
}
