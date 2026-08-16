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
}

function updateReviewBadge() {
  const badge = document.getElementById('review-badge');
  if (!badge) return;
  const n = FTReview.pending().length;
  badge.textContent = n ? String(n) : '';
  badge.style.display = n ? '' : 'none';
}

function renderReviewList() {
  const list = document.getElementById('review-list');
  list.textContent = '';

  const all = FTReview.all();
  if (all.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'review-empty';
    empty.textContent = 'لا اقتراحات بعد';
    list.appendChild(empty);
    return;
  }

  for (const row of all) {
    list.appendChild(reviewCard(row));
  }
}

function reviewCard(row) {
  const card = document.createElement('div');
  card.className = 'review-card state-' + row._state;
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

  if (row.note) {
    const note = document.createElement('div');
    note.className = 'review-note';
    // The only place a correction the op set cannot express can appear, so it
    // is shown prominently rather than tucked away.
    note.textContent = '“' + row.note + '”';
    card.appendChild(note);
  }

  const actions = document.createElement('div');
  actions.className = 'review-actions';

  if (row._state === 'pending') {
    if (isPreview) {
      actions.appendChild(reviewBtn('✓ اعتماد', 'ok', async () => {
        if (!FTReview.approve(row)) return;
        renderReviewList();
        updateReviewBadge();
        markFamilyDirty();
        reviewStatus('مُعتمد — اضغط COMMIT لنشره', 'ok');
      }));
      actions.appendChild(reviewBtn('إلغاء المعاينة', 'ghost', () => {
        FTReview.dismiss();
        renderReviewList();
      }));
    } else if ((row.ops || []).length > 0) {
      actions.appendChild(reviewBtn('معاينة على الشجرة', '', () => {
        const r = FTReview.preview(row);
        renderReviewList();
        reviewStatus(r.failed.length
          ? 'تعذّر تطبيق ' + r.failed.length + ' من التعديلات'
          : 'معاينة — الشجرة تعرض هذا الاقتراح', r.failed.length ? 'err' : 'ok');
      }));
    }
    actions.appendChild(reviewBtn('✕ رفض', 'ghost', () => {
      FTReview.reject(row);
      renderReviewList();
      updateReviewBadge();
    }));
  } else if (row._state === 'rejected') {
    actions.appendChild(reviewBtn('استرجاع', 'ghost', () => {
      FTReview.unreject(row.id);
      renderReviewList();
      updateReviewBadge();
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
