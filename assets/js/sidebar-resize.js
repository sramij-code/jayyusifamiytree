/* ============================================================================
   sidebar-resize.js — draggable sidebar width, and the mobile bottom sheet.

   Shared by both views: resizing is a reading preference, not customisation,
   so it stays local to the visitor's browser and never touches the published
   theme. Width persists in localStorage per browser.

   The handle lives between #sidebar and #canvas-container inside #main-area,
   which is a flex row forced to direction: ltr (so the canvas maths stays LTR
   even though the document is RTL). Hence the handle is on the sidebar's right.

   Under 640px the same #sidebar element is restyled as a bottom sheet (see the
   RESPONSIVE block in base.css) and initSheet wires its grab bar. One element,
   two presentations — search stays reachable on a phone, which matters because
   it is the only way to find one person among 1,746.
============================================================================ */

(function () {
  var KEY = 'ftSidebarWidth';
  var MIN = 150;          // narrower than this and the action buttons collapse
  var MAX_FRAC = 0.5;     // never let the sidebar eat more than half the window
  var DEFAULT = 260;

  function clamp(px) {
    var max = Math.max(MIN, Math.round(window.innerWidth * MAX_FRAC));
    return Math.min(Math.max(px, MIN), max);
  }

  function apply(px) {
    document.documentElement.style.setProperty('--sidebar-w', clamp(px) + 'px');
  }

  function saved() {
    var v = parseInt(localStorage.getItem(KEY), 10);
    return isNaN(v) ? DEFAULT : v;
  }

  function init() {
    var sidebar = document.getElementById('sidebar');
    var main = document.getElementById('main-area');
    if (!sidebar || !main) return;

    apply(saved());

    var handle = document.createElement('div');
    handle.id = 'sidebar-resizer';
    handle.title = 'اسحب لتغيير العرض · drag to resize · double-click to reset';
    sidebar.insertAdjacentElement('afterend', handle);

    var dragging = false;

    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      handle.classList.add('dragging');
      document.body.classList.add('resizing');
      e.preventDefault();          // don't start a text selection
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      // Measure from the container's left edge, so the handle tracks the
      // cursor exactly regardless of page scroll or chrome above.
      apply(e.clientX - main.getBoundingClientRect().left);
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      var w = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10);
      if (!isNaN(w)) localStorage.setItem(KEY, w);
    });

    handle.addEventListener('dblclick', function () {
      apply(DEFAULT);
      localStorage.setItem(KEY, DEFAULT);
    });

    // Re-clamp if the window shrinks below twice the sidebar width.
    window.addEventListener('resize', function () { apply(saved()); });

    initSheet(sidebar);
  }

  // ---------------------------------------------------------------------------
  // Mobile bottom sheet.
  //
  // Under 640px the sidebar is a sheet docked to the bottom edge. The handle is
  // built here rather than in the HTML so both pages get it without either one
  // carrying markup that is inert on desktop.
  // ---------------------------------------------------------------------------
  function initSheet(sidebar) {
    var handle = document.createElement('div');
    handle.id = 'sheet-handle';
    handle.setAttribute('role', 'button');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-controls', 'sidebar');
    handle.innerHTML =
      '<span id="sheet-grip"></span><span id="sheet-label"></span>';
    sidebar.insertAdjacentElement('afterbegin', handle);

    var label = handle.querySelector('#sheet-label');

    function isOpen() { return sidebar.classList.contains('sheet-open'); }

    function setOpen(open) {
      sidebar.classList.toggle('sheet-open', open);
      // The node panel keys off this: it lives below the sheet in the stacking
      // order, so it hides rather than being half-buried by it.
      document.body.classList.toggle('sheet-is-open', open);
      handle.setAttribute('aria-expanded', open ? 'true' : 'false');
      label.textContent = open ? 'إغلاق · CLOSE' : 'بحث · SEARCH';
      handle.setAttribute('aria-label',
        open ? 'إغلاق البحث' : 'فتح البحث · open search');
      // Focusing the field would summon the keyboard over the results the user
      // is trying to read, so the tap only opens the sheet.
    }

    setOpen(false);

    handle.addEventListener('click', function () { setOpen(!isOpen()); });
    handle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!isOpen()); }
    });

    // Vertical drag on the handle, so the sheet feels native. Horizontal drags
    // are left alone in case the canvas wants them.
    var startY = null, startedOpen = false;
    handle.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      startedOpen = isOpen();
    }, { passive: true });

    handle.addEventListener('touchmove', function (e) {
      if (startY === null || e.touches.length !== 1) return;
      var dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) < 28) return;
      setOpen(dy < 0);
      startY = null;
    }, { passive: true });

    handle.addEventListener('touchend', function () { startY = null; });

    // Picking a search result should reveal the person, not leave the sheet
    // covering the canvas underneath it.
    var results = document.getElementById('search-results');
    if (results) {
      results.addEventListener('click', function (e) {
        if (!isOpen()) return;
        if (e.target.closest('.search-result-item')) setOpen(false);
      });
    }

    // Leaving the breakpoint (rotation, desktop resize) must not strand the
    // sheet class on a sidebar that is a normal column again.
    var mq = window.matchMedia('(max-width: 640px)');
    var onChange = function (ev) { if (!ev.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
