/* ============================================================================
   review-ui.js — the proposals drawer in admin.html.

   Separated from review.js so the DOM wiring reads on its own, matching how
   admin.js relates to publish.js.
============================================================================ */

function initReviewUI() {
  const btn = document.getElementById('btn-review');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const drawer = document.getElementById('review-drawer');
    const opening = !drawer.classList.contains('open');
    drawer.classList.toggle('open', opening);
    if (opening) refreshReview();
  });

  document.getElementById('review-close').addEventListener('click', () => {
    document.getElementById('review-drawer').classList.remove('open');
    FTReview.dismiss();
  });

  document.getElementById('review-refresh').addEventListener('click', refreshReview);

  // Count pending on load so the badge is meaningful before the drawer is ever
  // opened — otherwise there is nothing telling you anything is waiting.
  if (FTSupa.configured()) refreshReview(true).catch(() => {});
}

function reviewStatus(text, kind) {
  const el = document.getElementById('review-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = kind || '';
}

async function refreshReview(quiet) {
  const list = document.getElementById('review-list');
  if (!quiet) reviewStatus('جارٍ التحميل…');
  try {
    await FTReview.load();
    renderReviewList();
    reviewStatus('');
  } catch (e) {
    reviewStatus(e.message, 'err');
    if (!quiet && list) list.textContent = '';
  }
  updateReviewBadge();
  // A load can change how many decisions are waiting to be committed — the
  // committed file is only read here — so the publish bar has to be told.
  if (typeof markFamilyDirty === 'function') markFamilyDirty();
}

function updateReviewBadge() {
  const badge = document.getElementById('review-badge');
  const btn = document.getElementById('btn-review');
  if (!badge || !btn) return;

  // All four states come from FTReview.buttonState(); this function only paints
  // them. Keeping the decision out of the DOM layer is what makes it testable —
  // and the reason 'clean' cannot be reached without a successful load.
  const s = FTReview.buttonState();

  badge.textContent = s.badge;
  badge.style.display = '';          // always shown: '✓', a count, '…' or '!'

  btn.classList.toggle('rv-pending', s.state === 'pending');
  btn.classList.toggle('rv-clean',   s.state === 'clean');
  btn.classList.toggle('rv-unknown', s.state === 'unknown' || s.state === 'error');
  btn.classList.toggle('rv-partial', !!s.partial);
  btn.title = s.title;
}

// The queue shows what still needs a decision; everything else is history.
//
// Reviewed proposals used to stay in the queue, dimmed, which reads as "your
// rejection did not take". History is now a separate, explicitly opened list —
// and a capped one, because the Supabase inbox only ever grows, so rendering
// every row ever sent on every refresh gets slower forever.
let _showHistory = false;
let _historyLimit = 0;      // 0 until first opened, then a multiple of the page

function renderReviewList() {
  const list = document.getElementById('review-list');
  list.textContent = '';

  const all = FTReview.all();
  const pending = all.filter(r => r._state === 'pending');
  const decided = all.length - pending.length;

  if (all.length === 0) {
    list.appendChild(reviewEmpty('لا اقتراحات بعد'));
    return;
  }
  if (pending.length === 0) {
    list.appendChild(reviewEmpty('لا اقتراحات قيد المراجعة ✓'));
  }
  for (const row of pending) list.appendChild(reviewCard(row));

  if (all.length === pending.length && !_showHistory) return;

  const toggle = reviewBtn(
    _showHistory ? 'إخفاء السجل' : 'إظهار السجل (' + decided + ')',
    'ghost',
    () => {
      _showHistory = !_showHistory;
      if (_showHistory && _historyLimit === 0) _historyLimit = FTReview.historyPage();
      renderReviewList();
    });
  toggle.classList.add('review-toggle');
  list.appendChild(toggle);

  if (!_showHistory) return;

  // History is every proposal newest-first, whatever its state — including the
  // pending ones already shown above, because "the last 20 suggestions" is the
  // question being asked, and silently skipping some would misreport the count.
  const shown = FTReview.history(_historyLimit);
  const head = document.createElement('div');
  head.className = 'review-subhead';
  head.textContent = 'أحدث ' + shown.length + ' من ' + FTReview.total();
  list.appendChild(head);

  for (const row of shown) list.appendChild(reviewCard(row, true));

  if (shown.length < FTReview.total()) {
    const more = reviewBtn('المزيد (' + FTReview.historyPage() + ')', 'ghost', () => {
      _historyLimit += FTReview.historyPage();
      renderReviewList();
    });
    more.classList.add('review-toggle');
    list.appendChild(more);
  }
}

function reviewEmpty(text) {
  const el = document.createElement('div');
  el.className = 'review-empty';
  el.textContent = text;
  return el;
}

function reviewCard(row, inHistory) {
  const card = document.createElement('div');
  card.className = 'review-card state-' + row._state;
  if (inHistory) card.classList.add('in-history');
  const isPreview = FTReview.previewing() && FTReview.previewing().id === row.id;
  if (isPreview) card.classList.add('previewing');

  const head = document.createElement('div');
  head.className = 'review-head';

  const who = document.createElement('span');
  who.className = 'review-who';
  who.textContent = row.author_name || 'مجهول';
  head.appendChild(who);

  const when = document.createElement('span');
  when.className = 'review-when';
  // Date only: the exact minute is noise when reviewing days later.
  when.textContent = String(row.created_at || '').slice(0, 10);
  head.appendChild(when);

  const tag = document.createElement('span');
  tag.className = 'review-tag';
  tag.textContent = row._state === 'approved' ? '✓ مُعتمد'
                  : row._state === 'rejected' ? '✕ مرفوض'
                  : '● قيد المراجعة';
  head.appendChild(tag);
  card.appendChild(head);

  // The ops, as the proposer described them.
  for (const op of (row.ops || [])) {
    const line = document.createElement('div');
    line.className = 'review-op';
    line.textContent = op.describe || op.op;
    card.appendChild(line);
  }

  // What was decided, when, and — the part that matters — whether it is actually
  // saved. A rejection lives in localStorage until the next COMMIT, and showing
  // it as plain "rejected" is what made a decision look durable when it was not.
  if (row._decision) {
    const d = document.createElement('div');
    d.className = 'review-decision' + (row._decision.committed ? '' : ' uncommitted');
    const verb = row._decision.decision === 'rejected' ? 'رُفض' : 'أُعيد';
    const when = String(row._decision.at || '').slice(0, 10);
    d.textContent = verb + ' · ' + when + ' · ' +
      (row._decision.committed ? 'محفوظ في المستودع' : 'بانتظار COMMIT');
    card.appendChild(d);

    // More than one decision means the reviewer changed their mind, which is
    // exactly the thing worth being able to see.
    const trail = FTReview.decisionsFor(row.id);
    if (trail.length > 1) {
      const t = document.createElement('div');
      t.className = 'review-trail';
      t.textContent = trail
        .map(x => (x.decision === 'rejected' ? '✕' : '↺') + ' ' + String(x.at || '').slice(0, 10))
        .join('  →  ');
      card.appendChild(t);
    }
  }

  if (row.note) {
    const note = document.createElement('div');
    note.className = 'review-note';
    // The only place a correction the op set cannot express can appear, so it
    // is shown prominently rather than tucked away.
    note.textContent = '“' + row.note + '”';
    card.appendChild(note);
  }

  // Why a previewed op could not be applied. Almost always one of two things: the
  // target gained children since the proposal was written, or it is missing from
  // this browser entirely — which a stale draft causes, so name that explicitly
  // rather than leaving the reviewer hunting for someone they cannot see.
  if (row._failed && row._failed.length) {
    for (const reason of row._failed) {
      const f = document.createElement('div');
      f.className = 'review-failed';
      f.textContent = '⚠ ' + reason;
      card.appendChild(f);
    }
    const hidden = FTChangeLog.draftDivergence();
    if (hidden.missing.length) {
      const hint = document.createElement('div');
      hint.className = 'review-failed hint';
      hint.textContent = 'مسودة هذا المتصفح تُخفي ' + hidden.missing.length +
        ' شخصًا موجودًا في البيانات المنشورة (' + hidden.names.join('، ') + '). ' +
        'انشر أي تعديلات معلّقة ثم اضغط DISCARD DRAFT.';
      card.appendChild(hint);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'review-actions';

  if (row._state === 'pending') {
    if (isPreview) {
      actions.appendChild(reviewBtn('✓ اعتماد', 'ok', async () => {
        const n = FTReview.approve(row);
        renderReviewList();
        updateReviewBadge();
        markFamilyDirty();
        // Zero means every op was refused — the targets are gone, or the ops
        // broke a domain rule. Saying "approved" then would be a lie, and the
        // COMMIT button stays disabled because nothing was recorded.
        reviewStatus(n === 0
          ? 'لم يُطبَّق أي تعديل — راجع الأسماء أو أن الأشخاص حُذفوا'
          : 'مُعتمد (' + n + ') — اضغط COMMIT لنشره',
          n === 0 ? 'err' : 'ok');
      }));
      actions.appendChild(reviewBtn('إلغاء المعاينة', 'ghost', () => {
        FTReview.dismiss();
        renderReviewList();
      }));
    } else if ((row.ops || []).length > 0) {
      actions.appendChild(reviewBtn('معاينة على الشجرة', '', () => {
        const r = FTReview.preview(row);
        // Kept on the row, not just announced once: preview() builds a REASON per
        // refused op and this threw it away, so a proposal that could not apply
        // looked identical to one that simply showed nothing.
        row._failed = r.failed;
        renderReviewList();
        reviewStatus(r.failed.length
          ? 'تعذّر تطبيق ' + r.failed.length + ' من التعديلات — السبب على البطاقة'
          : 'معاينة — الشجرة تعرض هذا الاقتراح', r.failed.length ? 'err' : 'ok');
      }));
    }
    actions.appendChild(reviewBtn('✕ رفض', 'ghost', () => {
      const stored = FTReview.reject(row);
      renderReviewList();
      updateReviewBadge();
      // A decision is now a publishable change, so the publish bar has to notice
      // it — otherwise COMMIT stays disabled and the rejection never leaves.
      markFamilyDirty();
      reviewStatus(stored ? 'مرفوض — اضغط COMMIT لحفظه' : 'تعذّر حفظ القرار محليًا',
                   stored ? 'ok' : 'err');
    }));
  } else if (row._state === 'rejected') {
    actions.appendChild(reviewBtn('استرجاع', 'ghost', () => {
      const stored = FTReview.reinstate(row);
      renderReviewList();
      updateReviewBadge();
      markFamilyDirty();
      reviewStatus(stored ? 'أُعيد إلى قيد المراجعة — اضغط COMMIT لحفظه'
                          : 'تعذّر حفظ القرار محليًا', stored ? 'ok' : 'err');
    }));
  }

  if (actions.children.length) card.appendChild(actions);
  return card;
}

function reviewBtn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'review-btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
