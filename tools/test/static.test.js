/* ============================================================================
   static.test.js — checks that need no JS execution at all.

   These catch the classes of bug that actually shipped in this project: a moved
   file leaving a dead <script src>, a duplicated element id, a stray </style>
   swallowing a rule, an admin asset leaking into the public page, and a real
   credential reaching a committed file.
============================================================================ */

const fs = require('fs');
const path = require('path');
const { REPO } = require('./harness.js');

const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const exists = f => fs.existsSync(path.join(REPO, f));

const PAGES = ['index.html', 'admin.html'];
const CSS = ['assets/css/tokens.css', 'assets/css/base.css',
             'assets/css/propose.css', 'assets/css/admin.css'];

// Admin-only modules. index.html must never load these: that is the whole
// security boundary — a visitor with no credential cannot write to the repo.
const ADMIN_ONLY = ['admin/github.js', 'admin/auth.js', 'admin/publish.js',
                    'admin/pickers.js', 'admin/presets.js', 'admin/admin.js',
                    'admin/review.js', 'admin/review-ui.js'];

// Created at runtime by JS, so absence from the markup is correct.
const RUNTIME_IDS = new Set([
  'sidebar-resizer', 'sheet-handle', 'sheet-grip', 'sheet-label',
  'zoom-group', 'links-layer', 'nodes-layer', 'inline-name-editor',
  // Deliberately absent on admin.html: changelog.js probes for it to decide
  // whether it is the viewer or the admin, so "not found" IS the answer.
  'propose-bar',
]);

function refs(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(m => m[1]).filter(u => !u.startsWith('http') && !u.startsWith('#'));
}

// Brace-depth walk, comment-aware. NOT a regex: a regex once stripped @media
// wrappers here and applied a mobile rule at every width.
function braceWalk(src) {
  let depth = 0, maxDepth = 0, negative = false, i = 0;
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return { unterminated: true }; i += 2; continue; }
    if (src[i] === '{') { depth++; maxDepth = Math.max(maxDepth, depth); }
    else if (src[i] === '}') { depth--; if (depth < 0) negative = true; }
    i++;
  }
  return { depth, maxDepth, negative, unterminated: false };
}


/* The innermost function enclosing an index: walk back counting braces, then
   forward from its `{` to its match. Needed because the inline-rename `commit()`
   is nested inside startEditName — checking only the outer function would be
   satisfied by the outer guard and miss the inner path entirely. */
function enclosingFunction(src, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    if (src[i] === '}') depth++;
    else if (src[i] === '{') {
      if (depth === 0) {
        const head = src.slice(Math.max(0, i - 200), i);
        const m = /function\s*(\w*)\s*\([^)]*\)\s*$/.exec(head);
        if (m) {
          let d = 1, j = i + 1;
          while (j < src.length && d > 0) {
            if (src[j] === '{') d++;
            else if (src[j] === '}') d--;
            j++;
          }
          return { name: m[1] || '(anonymous)', body: src.slice(i, j) };
        }
      } else depth--;
    }
  }
  return null;
}

module.exports = function ({ describe, ok, eq }) {

  describe('every referenced asset exists', () => {
    for (const page of PAGES) {
      const missing = refs(read(page)).filter(u => !exists(u));
      ok(missing.length === 0, page + ': ' + refs(read(page)).length + ' refs resolve',
         missing.join(', '));
    }
  });

  describe('no duplicate element ids', () => {
    for (const page of PAGES) {
      const ids = [...read(page).matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
      const dupes = [...new Set(ids.filter(i => ids.filter(x => x === i).length > 1))];
      ok(dupes.length === 0, page + ': ' + ids.length + ' ids, all unique', dupes.join(', '));
    }
  });

  describe('the public page ships no write path', () => {
    const src = refs(read('index.html'));
    for (const mod of ADMIN_ONLY) {
      ok(!src.some(s => s.endsWith(mod)), 'index.html does not load ' + mod);
    }
    ok(src.some(s => s.endsWith('supabase.js')), 'index.html DOES load supabase.js (needed to submit)');
    ok(src.some(s => s.endsWith('edit.js')), 'index.html DOES load edit.js (needed to propose)');
  });

  describe('script order satisfies dependencies', () => {
    for (const page of PAGES) {
      const js = refs(read(page)).filter(u => u.startsWith('assets/js/'));
      const at = name => js.findIndex(s => s.endsWith(name));
      const before = (a, b) => at(a) !== -1 && at(b) !== -1 && at(a) < at(b);
      ok(before('core/state.js', 'changelog.js'), page + ': state before changelog');
      ok(before('changelog.js', 'edit.js'), page + ': changelog before edit');
      if (page === 'index.html') {
        ok(before('supabase.js', 'propose.js'), page + ': supabase before propose');
        ok(before('propose.js', 'propose-ui.js'), page + ': propose before propose-ui');
        ok(before('core/search.js', 'propose-ui.js'), page + ': search before propose-ui');
        ok(before('propose-ui.js', 'viewer.js'), page + ': propose-ui before viewer');
      } else {
        ok(before('supabase.js', 'admin/review.js'), page + ': supabase before review');
        ok(before('admin/review.js', 'admin/review-ui.js'), page + ': review before review-ui');
        ok(before('admin/review-ui.js', 'admin/admin.js'), page + ': review-ui before admin');
      }
    }
  });

  describe('every getElementById target exists in the page that loads it', () => {
    for (const page of PAGES) {
      const html = read(page);
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
      const scripts = refs(html).filter(u => u.endsWith('.js') && !u.includes('vendor') && !u.startsWith('data/'));
      const missing = [];
      for (const s of scripts) {
        for (const m of read(s).matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
          const id = m[1];
          if (RUNTIME_IDS.has(id) || ids.has(id)) continue;
          // core/* is shared and guards admin-only elements with `if (el)`.
          const guarded = new RegExp("getElementById\\('" + id + "'\\)[\\s\\S]{0,120}if \\(").test(read(s));
          if (!guarded) missing.push(s + ' -> #' + id);
        }
      }
      ok(missing.length === 0, page + ': all element lookups resolve or are guarded',
         missing.join('; '));
    }
  });

  describe('stylesheets are structurally sound', () => {
    for (const f of CSS) {
      const src = read(f);
      const w = braceWalk(src);
      ok(!w.unterminated, f + ': no unterminated comment');
      ok(w.depth === 0 && !w.negative, f + ': braces balanced', 'final depth ' + w.depth);
      // A stray closing tag once invalidated the rule that followed it.
      ok(!/<\/?style|<\/?script/i.test(src), f + ': no stray HTML tags');
      // Every @media must open a block. Comments are stripped first, because
      // these files discuss @media in prose and a raw scan matches that too.
      const bare = src.replace(/\/\*[\s\S]*?\*\//g, '');
      const medias = [...bare.matchAll(/@media[^{;]*(.)/g)].map(m => m[1]);
      ok(medias.every(c => c === '{'), f + ': every @media opens a block');
    }
  });

  describe('no real credential is committed', () => {
    const files = [...PAGES, ...CSS,
      ...fs.readdirSync(path.join(REPO, 'assets/js')).filter(f => f.endsWith('.js')).map(f => 'assets/js/' + f),
      ...fs.readdirSync(path.join(REPO, 'assets/js/admin')).map(f => 'assets/js/admin/' + f),
      ...fs.readdirSync(path.join(REPO, 'assets/js/core')).map(f => 'assets/js/core/' + f)];
    const pat = [
      [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained token'],
      [/ghp_[A-Za-z0-9]{20,}/, 'GitHub classic token'],
      [/sb_secret_[A-Za-z0-9_]{10,}/, 'Supabase service_role key'],
      [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    ];
    const hits = [];
    for (const f of files) {
      const src = read(f);
      for (const [rx, what] of pat) if (rx.test(src)) hits.push(f + ': ' + what);
    }
    ok(hits.length === 0, 'no token or secret key in any committed file', hits.join('; '));

    // The publishable key is public BY DESIGN, but must live in exactly one
    // place so the two pages cannot drift.
    const holders = files.filter(f => /sb_publishable_/.test(read(f)));
    eq(holders, ['assets/js/supabase.js'], 'publishable key lives only in supabase.js');
  });

  describe('the committed tree data is well formed', () => {
    const raw = read('data/family.js');
    let d = null;
    try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('};') + 1)); } catch (e) { /* below */ }
    ok(!!d, 'data/family.js parses with the index("{")/rindex("};") convention the tooling uses');
    if (!d) return;
    ok(!!d.people && !!d.partnerships && !!d.root, 'has people, partnerships and root');
    ok(!!d.people[d.root], 'root ' + d.root + ' exists');
    ok(/var familyData = window\.FT_FAMILY/.test(raw),
       'declares the top-level var the classic scripts bind to');
    // Every id must survive the Python tooling's sort (tools/rebuild_from_excel.py).
    const weird = Object.keys(d.people).filter(i => !/^p[0-9a-z]+$/.test(i));
    ok(weird.length === 0, 'all person ids match p[0-9a-z]+', weird.slice(0, 5).join(', '));
  });

  describe('the proposals button paints every state it can be in', () => {
    // buttonState() is unit-tested; this checks the DOM layer and the stylesheet
    // actually implement each state, which the suite cannot see rendered.
    const ui = read('assets/js/admin/review-ui.js');
    const css = read('assets/css/admin.css');

    for (const cls of ['rv-pending', 'rv-clean', 'rv-unknown', 'rv-partial']) {
      ok(ui.indexOf(cls) !== -1, 'review-ui applies .' + cls);
      ok(new RegExp('#btn-review\\.' + cls).test(css), 'admin.css styles #btn-review.' + cls);
    }

    // The badge must not be display:none any more — it now carries ✓ / … / ! as
    // well as a count, so hiding it would restore the two-state ambiguity.
    const badge = css.slice(css.indexOf('#review-badge {'), css.indexOf('}', css.indexOf('#review-badge {')));
    ok(!/display:\s*none/.test(badge), '#review-badge is not hidden by default');

    // updateReviewBadge must not compute the state itself, or the DOM path and the
    // tested path can drift.
    const fn = ui.slice(ui.indexOf('function updateReviewBadge'),
                        ui.indexOf('\n}', ui.indexOf('function updateReviewBadge')));
    ok(/FTReview\.buttonState\(\)/.test(fn), 'it reads FTReview.buttonState()');
    ok(!/\.pending\(\)\.length/.test(fn),
       'and does not recompute the count from pending() itself');
  });

  describe('the publish bar never offers an action it will refuse', () => {
    // A guard that fires on click, sets the same status text every time and leaves
    // the button live reads as a broken button. And a stale draft with no edits was
    // a genuine dead end: DISCARD was disabled AND discardFamilyDraft returned
    // early, so the only way to clear a draft hiding committed people was DevTools.
    const pub = read('assets/js/admin/publish.js');

    ok(/const blockedByStaleDraft = n > 0 && hidden\.missing\.length > 0/.test(pub),
       'COMMIT computes whether the guard would refuse');
    ok(/commitBtn\.disabled = connected && \(\(n === 0 && d === 0\) \|\| blockedByStaleDraft\)/.test(pub),
       'and is disabled in that case, not left live');
    ok(/Press DISCARD EDITS/.test(pub), 'its title says what to do instead');

    // Only an edit writes family.js, so a decisions-only commit must stay live.
    ok(/n > 0 && hidden\.missing\.length > 0/.test(pub),
       'the block is gated on edits, so decisions-only stays committable');

    ok(/discardBtn\.disabled = n === 0 && hidden\.missing\.length === 0/.test(pub),
       'DISCARD is enabled for a stale draft even with zero edits');
    const fn = pub.slice(pub.indexOf('function discardFamilyDraft'),
                         pub.indexOf('\n}', pub.indexOf('function discardFamilyDraft')));
    ok(/if \(n === 0 && stale === 0\) return/.test(fn),
       'and discardFamilyDraft no longer returns early on a stale draft');
    ok(/CONFIRM: RESYNC/.test(fn),
       'labelled RESYNC when there are no edits to lose, not "LOSE 0"');
  });

  describe('the unpublished indicator is explainable and clickable', () => {
    const pub = read('assets/js/admin/publish.js');
    const adm = read('assets/js/admin/admin.js');
    const rui = read('assets/js/admin/review-ui.js');
    const css = read('assets/css/admin.css');

    // The manifest lives in review.js, not publish.js: publish.js pulls in FTTheme,
    // which the harness cannot load, so keeping it there made it untestable.
    const rev = read('assets/js/admin/review.js');
    ok(/unpublishedManifest: function/.test(rev), 'review.js builds the manifest');
    ok(/uncommittedDetailed\(\)/.test(rev), 'and describes decisions, not just counts');
    ok(/el\.title = bits\.length === 0 \? '' : FTReview\.unpublishedManifest\(\)/.test(pub),
       'publish.js puts it on the indicator title rather than leaving it blank');
    ok(/FTReview\.unpublishedManifest\(\)/.test(
         pub.slice(pub.indexOf('HIDDEN BY STALE DRAFT'), pub.indexOf('} else {', pub.indexOf('HIDDEN BY STALE DRAFT')))),
       'and also in the stale-draft state, where knowing matters most');
    ok(/classList\.toggle\('clickable'/.test(pub), 'the indicator is marked clickable when it has something to say');
    ok(/#family-state\.clickable/.test(css), 'and styled so it looks interactive');
    ok(/familyState\.addEventListener/.test(adm), 'admin binds the click');
    ok(/classList\.contains\('clickable'\)/.test(adm),
       'and gates it on .clickable, so a clean indicator is genuinely inert');
    ok(/function openReviewHistory/.test(rui), 'which opens the drawer with history shown');
    // History, specifically: a decided proposal has left the pending list.
    const fn = rui.slice(rui.indexOf('function openReviewHistory'),
                         rui.indexOf('\n}', rui.indexOf('function openReviewHistory')));
    ok(/_showHistory = true/.test(fn), 'openReviewHistory forces history on');
  });

  describe('both node class builders honour markedForRemovalIds', () => {
    // The suite cannot see rendering, so this is checked structurally. render.js
    // builds the class list TWICE — once for entering nodes and once for the
    // update path — and a proposed deletion targets someone typically already on
    // screen, so missing it on the update path means the struck-through style
    // never appears for exactly the case it exists for.
    const src = read('assets/js/core/render.js');
    const builders = [];
    let at = src.indexOf("let cls = 'node-group';");
    while (at !== -1) {
      const end = src.indexOf('return cls;', at);
      builders.push(src.slice(at, end === -1 ? src.length : end));
      at = src.indexOf("let cls = 'node-group';", at + 1);
    }
    ok(builders.length === 2, 'found both class builders (got ' + builders.length + ')');
    builders.forEach((b, i) => {
      ok(/markedForRemovalIds/.test(b),
         'class builder ' + (i + 1) + ' applies node-marked-removal');
    });

    // And the style has to exist, or the class is inert.
    const css = read('assets/css/admin.css');
    ok(/\.node-marked-removal\s+\.node-rect/.test(css),
       'admin.css styles the marked node');
  });

  describe('every tree mutation in edit.js is gated on the preview', () => {
    // A preview must be exclusive: dismiss() restores by popping the undo stack,
    // so any OTHER pushUndo while a preview is live puts a newer snapshot on top
    // and dismiss undoes the wrong thing — leaving an unapproved proposal applied
    // and already persisted into the draft.
    //
    // Checked structurally rather than behaviourally because one of these paths
    // (the inline rename's commit()) is a closure over a real input element and
    // cannot be driven headlessly. Asserting it by re-implementing the guard in a
    // test would prove nothing.
    const src = read('assets/js/edit.js');
    let checked = 0;
    let at = -1;
    while ((at = src.indexOf('FTChangeLog.pushUndo(', at + 1)) !== -1) {
      const fn = enclosingFunction(src, at);
      checked++;
      ok(fn && /previewIsLive\(\)/.test(fn.body),
         'pushUndo inside ' + (fn ? fn.name : '?') + '() is guarded by previewIsLive',
         fn ? fn.name + ' has no previewIsLive check' : 'no enclosing function found');
    }
    ok(checked >= 2, 'found ' + checked + ' pushUndo sites to check (expected at least 2)');
  });
};
