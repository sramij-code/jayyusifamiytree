/* ============================================================================
   sidebar-resize.js — draggable sidebar width.

   Shared by both views: resizing is a reading preference, not customisation,
   so it stays local to the visitor's browser and never touches the published
   theme. Width persists in localStorage per browser.

   The handle lives between #sidebar and #canvas-container inside #main-area,
   which is a flex row forced to direction: ltr (so the canvas maths stays LTR
   even though the document is RTL). Hence the handle is on the sidebar's right.
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
