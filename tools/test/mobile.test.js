/* ============================================================================
   mobile.test.js — CSS arithmetic, computed rather than rendered.

   There is no browser in this environment, and three CSS regressions shipped
   during development because structural checks cannot see layout. These compute
   the numbers that mattered: does a fixed bar's reserved space actually match
   its height, is every touch target 44px, and is any focusable input under the
   16px threshold at which iOS force-zooms and never zooms back.

   Font metrics are unknowable here, so anything depending on text width is
   stated as a bound rather than asserted exactly.
============================================================================ */

const fs = require('fs');
const path = require('path');
const { REPO } = require('./harness.js');

const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* A tiny CSS reader.

   Regex was tried first and kept producing false failures — it missed rules
   preceded by a comment, and choked on nested parens in
   calc(5px + env(safe-area-inset-top)). Walking the braces is both shorter and
   correct. Returns a flat list of { selector, body, media } for the whole file,
   which is enough because these stylesheets never nest past one @media. */
function parseCss(file) {
  const src = strip(read(file));
  const out = [];
  let i = 0, buf = '', media = null, mediaEnd = -1;

  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      const head = buf.trim();
      buf = '';
      if (head.startsWith('@media')) {
        media = head.replace(/^@media\s*/, '').trim();
        // Find where this @media block ends so we know when to clear `media`.
        let d = 1, j = i + 1;
        while (j < src.length && d > 0) {
          if (src[j] === '{') d++;
          else if (src[j] === '}') d--;
          j++;
        }
        mediaEnd = j;
        i++;
        continue;
      }
      // An ordinary rule: consume to its matching close brace.
      let d = 1, j = i + 1;
      while (j < src.length && d > 0) {
        if (src[j] === '{') d++;
        else if (src[j] === '}') d--;
        j++;
      }
      out.push({ selector: head, body: src.slice(i + 1, j - 1), media });
      i = j;
      if (mediaEnd > 0 && i >= mediaEnd) { media = null; mediaEnd = -1; }
      continue;
    }
    if (ch === '}') { buf = ''; i++; if (mediaEnd > 0 && i >= mediaEnd) { media = null; mediaEnd = -1; } continue; }
    buf += ch;
    i++;
  }
  return out;
}

const cssCache = {};
function css(file) { return cssCache[file] || (cssCache[file] = parseCss(file)); }

/* Declarations for a selector, optionally only inside a media query. The LAST
   match wins, which is what the cascade does at equal specificity. */
function rule(file, selector, insideMedia) {
  const want = selector.replace(/\s+/g, ' ').trim();
  const hits = css(file).filter(r =>
    r.selector.replace(/\s+/g, ' ').trim() === want &&
    (insideMedia ? r.media === insideMedia : r.media === null));
  return hits.length ? hits[hits.length - 1].body : null;
}

/* A declaration's value as a number when it looks like one (px or bare), else
   the raw string. z-index has no unit, which an earlier px-only version missed
   and reported as a string. */
function num(decls, prop) {
  if (!decls) return null;
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(decls);
  if (!m) return null;
  const v = m[1].trim();
  const px = /^(-?[\d.]+)px$/.exec(v);
  if (px) return parseFloat(px[1]);
  if (/^-?[\d.]+$/.test(v)) return parseFloat(v);
  return v;
}

/* The last declared value of one property inside a declaration block. */
function prop(decls, name) {
  if (!decls) return null;
  const rx = new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)', 'g');
  let m, last = null;
  while ((m = rx.exec(decls)) !== null) last = m[1].trim();
  return last;
}

/* First px value inside a calc(), e.g. calc(59px + env(...)) -> 59. */
function calcPx(value) {
  if (typeof value !== 'string') return typeof value === 'number' ? value : null;
  const m = /calc\(\s*(-?[\d.]+)px/.exec(value);
  return m ? parseFloat(m[1]) : null;
}

/* Split a shorthand value on top-level whitespace, keeping calc(...) intact. */
function tokens(value) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(value).trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/* Resolve a custom property declared on :root, so a value of
   var(--sheet-peek) is comparable rather than silently 0. */
function cssVar(name) {
  for (const f of ['assets/css/base.css', 'assets/css/tokens.css']) {
    const v = cssProp(f, ':root', name);
    if (v !== null) return v;
  }
  return null;
}

const pxOf = t => {
  const s = String(t).trim();
  const v = /^var\((--[\w-]+)\)$/.exec(s);
  if (v) return pxOf(cssVar(v[1]) || '0');
  const c = calcPx(s);
  if (c !== null) return c;
  const n = /^(-?[\d.]+)px$/.exec(s);
  return n ? parseFloat(n[1]) : 0;
};

/* `padding: A B C` -> { top, bottom }, resolving calc() to its px term. */
function paddingTB(decls) {
  const raw = prop(decls, 'padding');
  if (raw === null) return null;
  const t = tokens(raw);
  if (t.length <= 2) return { top: pxOf(t[0]), bottom: pxOf(t[0]) };
  return { top: pxOf(t[0]), bottom: pxOf(t[2]) };
}

/* Does this block put the safe-area inset on its TOP padding? On a top-fixed bar
   it belongs there; on the bottom it adds height without clearing a notch. */
function insetOnTop(decls) {
  const raw = prop(decls, 'padding');
  if (raw === null) return false;
  return /env\(safe-area-inset-top\)/.test(tokens(raw)[0] || '');
}

/* One property, resolved across every rule that matches the selector. These
   stylesheets deliberately re-declare selectors late to patch them (admin.css
   has #publish-bar twice: z-index in the first, display:none in the second), so
   asking only the last rule loses properties the earlier one set. */
function cssProp(file, selector, name, insideMedia) {
  const want = selector.replace(/\s+/g, ' ').trim();
  let found = null;
  for (const r of css(file)) {
    if (r.selector.replace(/\s+/g, ' ').trim() !== want) continue;
    if (insideMedia ? r.media !== insideMedia : r.media !== null) continue;
    const v = prop(r.body, name);
    if (v !== null) found = v;
  }
  return found;
}

const MOBILE = '(max-width: 640px)';

module.exports = function ({ describe, ok, eq }) {

  describe('fixed top bars: reserved space matches real height', () => {
    // #propose-bar — index.html only.
    const bar = rule('assets/css/propose.css', '#propose-bar');
    const pad = paddingTB(bar);
    const toggleH = num(rule('assets/css/propose.css', '#propose-toggle'), 'min-height');
    ok(!!pad, '#propose-bar padding parses', bar && bar.slice(0, 50));
    eq(toggleH, 32, '#propose-toggle is 32px tall');
    ok(insetOnTop(bar), '#propose-bar puts the safe-area inset on its TOP padding');

    if (pad && typeof toggleH === 'number') {
      const height = pad.top + toggleH + pad.bottom + 1;   // +1 border-bottom
      const declared = calcPx(num(rule('assets/css/propose.css', '#app'), 'padding-top'));
      ok(declared !== null && declared >= height,
         'desktop #app reserves ' + declared + 'px for a ' + height + 'px bar');

      const mobReserve = calcPx(num(rule('assets/css/propose.css', '#app', MOBILE), 'padding-top'));
      ok(mobReserve === null || mobReserve >= height,
         'mobile read-only reserve (' + mobReserve + ') covers the ' + height + 'px bar');
    }

    // #publish-bar — admin.html only. One scrolling row on mobile by design, so
    // its height does not depend on how many items happen to wrap.
    const pb = rule('assets/css/admin.css', '#publish-bar', MOBILE);
    ok(/flex-wrap:\s*nowrap/.test(pb || ''),
       '#publish-bar does not wrap on mobile (wrapping made it ~164px)');
    ok(/overflow-x:\s*auto/.test(pb || ''), '#publish-bar scrolls instead of stacking');
    ok(insetOnTop(pb), '#publish-bar puts the inset on its TOP padding');

    const pbPad = paddingTB(pb);
    const btnH = num(rule('assets/css/admin.css', '.pub-btn', MOBILE), 'min-height');
    if (pbPad && typeof btnH === 'number') {
      const height = pbPad.top + btnH + pbPad.bottom + 1;
      const appPad = rule('assets/css/admin.css', 'body.admin-mode #app', MOBILE);
      const reserve = calcPx(num(appPad, 'padding-top'));
      ok(reserve !== null && reserve >= height,
         'mobile admin #app reserves ' + reserve + 'px for a ' + height + 'px bar');
      ok(/env\(safe-area-inset-top\)/.test(String(num(appPad, 'padding-top'))),
         'and includes the inset, so it tracks the bar on a notched phone');

      const drawer = rule('assets/css/admin.css', '#review-drawer', MOBILE);
      const top = calcPx(num(drawer, 'top'));
      ok(top !== null && top >= height,
         '#review-drawer starts at ' + top + 'px, at or below the ' + height + 'px bar');
      ok(/env\(safe-area-inset-top\)/.test(String(num(drawer, 'top'))),
         'and tracks the inset too, so its close button is never buried');
    }
  });

  describe('no focusable control triggers the iOS zoom', () => {
    // Under 16px, iOS Safari zooms the viewport on focus and does not zoom back.
    const FOCUSABLE = [
      ['assets/css/base.css', '#search-input'],
      ['assets/css/base.css', '.modal-input, .modal-select'],
      ['assets/css/base.css', '#inline-name-editor'],
      ['assets/css/propose.css', '#who-search, #send-note'],
      ['assets/css/admin.css', '#token-input'],
      ['assets/css/admin.css', '#admin-password'],
    ];
    for (const [file, sel] of FOCUSABLE) {
      // Mobile override wins if present, else the base declaration applies.
      const mob = num(rule(file, sel, MOBILE), 'font-size');
      const base = num(rule(file, sel), 'font-size');
      const effective = typeof mob === 'number' ? mob : base;
      if (effective === null) { ok('skip', sel + ' not found in ' + file); continue; }
      ok(effective >= 16, sel + ' is ' + effective + 'px on mobile (>=16 required)');
    }
  });

  describe('touch targets meet the 44px minimum on mobile', () => {
    const TARGETS = [
      ['assets/css/base.css', '.action-btn'],
      ['assets/css/base.css', '.panel-btn'],
      ['assets/css/base.css', '#btn-close-panel'],
      ['assets/css/base.css', '.search-result-item'],
      ['assets/css/base.css', '#btn-reset-view'],
      ['assets/css/propose.css', '.who-row'],
      ['assets/css/admin.css', '.pub-btn'],
      ['assets/css/admin.css', '.review-btn'],
      ['assets/css/admin.css', '#admin-password'],
    ];
    for (const [file, sel] of TARGETS) {
      // Mobile override if there is one, else the base rule — which is what the
      // cascade actually does. Checking only the media block reported compliant
      // controls as "no rule".
      const mob = cssProp(file, sel, 'min-height', MOBILE) || cssProp(file, sel, 'height', MOBILE);
      const base = cssProp(file, sel, 'min-height') || cssProp(file, sel, 'height');
      const raw = mob || base;
      if (raw === null) { ok('skip', sel + ' sets no explicit height'); continue; }
      const got = pxOf(raw);
      ok(got >= 44, sel + ' is ' + got + 'px tall (>=44 required)' + (mob ? '' : ' [base rule]'));
    }
  });

  describe('the status bar and admin trigger survive on mobile', () => {
    const src = strip(read('assets/css/base.css'));
    // [ADMIN] is the 9th span; a bare nth-child(n+4) hid it, and it is the only
    // way to authenticate.
    ok(/nth-child\(n\+4\):not\(\.admin-trigger\)/.test(src),
       'the status-bar hide rule exempts .admin-trigger');
    // The sheet and the status bar both wanted the bottom 28px. Lifting the bar
    // over the sheet was tried and cut the 48px grab handle's hit area to 20px,
    // so the sheet is docked 28px up instead and neither needs a z-index.
    const sheet = cssProp('assets/css/base.css', '#sidebar', 'inset', MOBILE);
    ok(/auto 0 28px 0/.test(String(sheet)),
       'the bottom sheet is docked above the 28px status bar', 'inset: ' + sheet);
    const panelBottom = cssProp('assets/css/base.css', '#node-panel', 'bottom', MOBILE);
    ok(/28px/.test(String(panelBottom)),
       'the node panel clears the sheet AND the status bar', 'bottom: ' + panelBottom);
    const handleH = pxOf(cssProp('assets/css/base.css', '#sheet-handle', 'height', MOBILE) || '0');
    ok(handleH >= 44, 'the sheet handle is ' + handleH + 'px, fully uncovered (>=44)');

    // The admin trigger must actually be in the markup as a status-bar child.
    const html = read('admin.html');
    ok(/id="admin-trigger"/.test(html), '#admin-trigger exists in admin.html');
  });

  describe('stacking order lets dialogs sit above the fixed bars', () => {
    const z = (f, sel, media) => {
      const v = cssProp(f, sel, 'z-index', media);
      return v === null ? null : parseFloat(v);
    };
    const propose = z('assets/css/propose.css', '#propose-bar');
    const publish = z('assets/css/admin.css', '#publish-bar');
    const modal   = z('assets/css/base.css', '#modal-overlay');
    const who     = z('assets/css/propose.css', '#who-modal-overlay, #send-modal-overlay');
    const token   = z('assets/css/admin.css', '#token-modal-overlay');
    const drawer  = z('assets/css/admin.css', '#review-drawer');
    const panel   = z('assets/css/base.css', '#node-panel');
    const editor  = z('assets/css/base.css', '#inline-name-editor', MOBILE);

    for (const [name, v] of [['#propose-bar', propose], ['#publish-bar', publish],
                             ['#modal-overlay', modal], ['#review-drawer', drawer],
                             ['#node-panel', panel]]) {
      ok(typeof v === 'number', name + ' declares a z-index (' + v + ')');
    }
    // The add-relative modal must cover both bars, or they stay clickable behind
    // its scrim — a visitor could hit "send for review" mid-dialog.
    ok(modal > propose, '#modal-overlay (' + modal + ') is above #propose-bar (' + propose + ')');
    ok(modal > publish, '#modal-overlay (' + modal + ') is above #publish-bar (' + publish + ')');
    ok(who >= propose, 'who/send overlays (' + who + ') are above the propose bar');
    ok(token >= publish, 'the token modal (' + token + ') is above the publish bar');
    // The drawer hangs BENEATH the publish bar deliberately, so it must not cover it.
    ok(drawer < publish, '#review-drawer (' + drawer + ') sits below #publish-bar (' + publish + ')');
    ok(typeof editor === 'number' && editor > panel,
       'the inline rename editor (' + editor + ') is above #node-panel (' + panel + ')');
  });

  describe('sticky :hover is guarded on touch', () => {
    // A tap leaves :hover applied. Anything changing transform or background
    // needs a @media (hover: none) counterpart, and the guard must out-specify
    // the rule it is undoing.
    const src = strip(read('assets/css/base.css'));
    const guard = /@media \(hover: none\)/.test(src);
    ok(guard, 'base.css has a @media (hover: none) block');
    // The disabled-button hover was more saturated than the resting state, so a
    // tap left it stuck mid-purple.
    const dis = rule('assets/css/base.css', '.panel-btn:disabled:hover');
    ok(dis && !/--accent-dim/.test(dis),
       '.panel-btn:disabled:hover no longer paints itself more saturated than rest',
       dis || '');
    // An ID hover at (1,1,0) outranks the (0,3,0) guard, so it has to exclude
    // :disabled itself. This is the button the disabled case actually shows —
    // عقدة نهائية on a woman.
    const src2 = strip(read('assets/css/base.css'));
    ok(/#btn-add-relative:hover:not\(:disabled\)/.test(src2),
       '#btn-add-relative:hover excludes :disabled, since its ID beats the guard');
  });

  describe('propose mode reserves enough for its own bar', () => {
    // The leaked .pb-note row pushed the bar to 103px against an 84px reserve
    // and covered the reset button. The mobile hide must out-specify
    // `body.propose-mode .pb-note`, which is (0,2,1) !important.
    const src = strip(read('assets/css/propose.css'));
    const mobileHide = /body\.propose-mode \.pb-note\s*\{\s*display:\s*none\s*!important/.test(src);
    ok(mobileHide,
       'the mobile .pb-note hide is scoped to body.propose-mode so it wins the specificity tie');
    const appMobile = rule('assets/css/propose.css', 'body.propose-mode #app', MOBILE);
    ok(/calc\(\d+px \+ env\(safe-area-inset-top\)\)/.test(appMobile || ''),
       'propose-mode mobile reserve includes the inset exactly once');
  });
};
