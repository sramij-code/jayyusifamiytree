/* ============================================================================
   domain.test.js — the tree's own rules, exercised through the real modules.

   The invariant checker in harness.js is the oracle: it must come back empty
   after every mutation. Each rule here is one that was broken at some point and
   cost real debugging, so a regression should fail loudly rather than quietly
   render a wrong tree.
============================================================================ */

const { boot, run, invariants, loadFamily } = require('./harness.js');

module.exports = function ({ describe, ok, eq }) {

  describe('the committed data starts healthy', () => {
    const c = boot({ role: 'admin' });
    eq(invariants(c), [], 'no invariant violations in data/family.js');
    const d = loadFamily();
    ok(Object.keys(d.people).length > 1000, 'loaded ' + Object.keys(d.people).length + ' people');
    // Every imported partnership is [father, null]; a wife filling that null slot
    // is what once declared her mother of children she never had.
    const filled = d.partnerships.filter(p => p.partners[1]).length;
    ok(true, filled + ' of ' + d.partnerships.length + ' partnerships record a wife');
  });

  describe('ids are unique per browser, not per counter', () => {
    // Two browsers booting the same data must not mint the same id. The old
    // "p" + (++counter) scheme gave every editor p1749 and silently overwrote.
    const ids = [0, 1, 2].map(() => run(boot({ role: 'admin' }), 'state.generateId()'));
    eq(new Set(ids).size, 3, 'three independent boots produce three different ids');
    ok(ids.every(i => /^p[0-9a-z]{8}$/.test(i)), 'ids look like p + 8 base36', ids.join(' '));

    const c = boot({ role: 'admin' });
    const many = run(c, '(function(){var s={},d=0;for(var i=0;i<50000;i++){var x=state.generateId();if(s[x])d++;s[x]=1;}return d;})()');
    eq(many, 0, 'no collision in 50,000 ids from one browser');
  });

  describe('adding a wife never reassigns motherhood', () => {
    const c = boot({ role: 'admin' });
    // p2's existing children must stay where they are.
    const before = run(c, "(childIndex()['p2']||[]).length");
    run(c, `
      var w = state.generateId();
      state.people[w] = {id:w, name:'زوجة', gender:'female', generation:1};
      state.partnerships.push({id:state.generatePPId(), partners:['p2', w], children:[]});
      invalidateCoupleMap(); invalidateChildIndex(); invalidateParentIndex();
    `);
    eq(run(c, "(childIndex()['p2']||[]).length"), before,
       "the husband's existing children are untouched");
    eq(run(c, "state.partnerships.filter(function(p){return p.partners[0]==='p2'&&p.partners[1]&&p.children.length;}).length"),
       0, 'the new marriage carries no children');
    eq(invariants(c), [], 'invariants hold');
  });

  describe('polygyny is representable', () => {
    const c = boot({ role: 'admin' });
    // RELATIVE to whatever the live data holds, never an absolute count.
    //
    // This asserted "p2 has exactly 3 wives" and went red the moment a real wife
    // was committed to data/family.js — the suite failing because the family tree
    // was edited, which is the one thing it must tolerate. Every assertion about
    // a specific person has to be a delta.
    const before = run(c, "partnersOf('p2').length");
    run(c, `
      ['أ','ب','ج'].forEach(function(n){
        var w = state.generateId();
        state.people[w] = {id:w, name:n, gender:'female', generation:1};
        state.partnerships.push({id:state.generatePPId(), partners:['p2', w], children:[]});
      });
      invalidateCoupleMap(); invalidateChildIndex(); invalidateParentIndex();
    `);
    eq(run(c, "partnersOf('p2').length"), before + 3, 'all three added wives are retained');
    // The map used to keep only the last, so the pairing became asymmetric.
    const sym = run(c, "partnersOf('p2').map(function(x){return areSpouses('p2',x.other) && areSpouses(x.other,'p2');})");
    ok(sym.length === before + 3 && sym.every(Boolean),
       'areSpouses is symmetric for every wife', JSON.stringify(sym));
    const back = run(c, "partnersOf('p2').map(function(x){return partnersOf(x.other).length;})");
    ok(back.every(n => n === 1), 'each wife points back at exactly one husband', JSON.stringify(back));
    eq(invariants(c), [], 'invariants hold');
  });

  describe('canDelete refuses an id that is not a person', () => {
    // Load-bearing for the review path: approving a delete_person whose target is
    // already gone relies on canDelete returning false, and a second approval of the
    // same proposal relies on it too. Asserted here because that assumption was
    // holding up two safety properties without ever being stated.
    const c = boot({ role: 'admin' });
    for (const id of ['pDOES-NOT-EXIST', '', '__proto__', 'toString', 'constructor']) {
      eq(run(c, 'canDelete(' + JSON.stringify(id) + ')'), false,
         'canDelete(' + JSON.stringify(id) + ') is false');
      eq(run(c, 'deleteBlockedReason(' + JSON.stringify(id) + ')'), 'لا يوجد',
         'and the reason is "no such person"');
    }
    // deletePerson must refuse too, since approve() calls it as a second layer.
    for (const id of ['pDOES-NOT-EXIST', '__proto__']) {
      eq(run(c, 'deletePerson(' + JSON.stringify(id) + ')'), false,
         'deletePerson(' + JSON.stringify(id) + ') refuses');
    }
    eq(invariants(c), [], 'invariants hold');
  });

  describe('resizing the window keeps the centre and the zoom', () => {
    // The requested behaviour: correct the off-to-one-side drift after a resize
    // WITHOUT overriding a view the user chose. Holding the centred world point with
    // k unchanged reduces to shifting by half the size delta — the scale cancels, so
    // the zoom is preserved exactly rather than approximately.
    const c = boot({ role: 'admin' });

    for (const [W0, H0, W1, H1] of [
      [1200, 800, 1600, 800],   // widen
      [1200, 800, 700, 900],    // narrow and taller
      [1200, 800, 1201, 800],   // one pixel
      [390, 700, 700, 390],     // orientation change
    ]) {
      for (const k of [1, 0.55, 2.3]) {
        const t = { k: k, x: 123, y: -45 };
        const before = { x: (W0 / 2 - t.x) / t.k, y: (H0 / 2 - t.y) / t.k };
        const r = run(c, 'recentreTransform(' + JSON.stringify(t) + ',' + (W1 - W0) + ',' + (H1 - H0) + ')');
        const after = { x: (W1 / 2 - r.x) / r.k, y: (H1 / 2 - r.y) / r.k };
        const label = W0 + 'x' + H0 + '→' + W1 + 'x' + H1 + ' @k=' + k;
        eq(r.k, t.k, label + ': the zoom level is untouched');
        ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9,
           label + ': the centred point stays centred',
           JSON.stringify({ before: before, after: after }));
      }
    }
  });

  describe('a resize from the on-screen keyboard is ignored', () => {
    // THE trap. On iOS the keyboard fires resize, so a naive handler yanks the tree
    // while someone is typing a name into the add-relative dialog — and this project
    // has already shipped one bug where that keyboard covered that very dialog.
    const c = boot({ role: 'admin' });
    const prev = { w: 1200, h: 800 };
    const P = JSON.stringify(prev);

    eq(run(c, 'shouldRecentre(' + P + ',1200,500,"INPUT")'), false,
       'a height-only shrink while an INPUT has focus is ignored');
    eq(run(c, 'shouldRecentre(' + P + ',1200,500,"TEXTAREA")'), false,
       'and while a TEXTAREA has focus');
    eq(run(c, 'shouldRecentre(' + P + ',1200,500,"SELECT")'), false,
       'and a SELECT, which opens a picker on a phone');

    // Everything else that must NOT move the tree.
    eq(run(c, 'shouldRecentre(' + P + ',1200,800,null)'), false,
       'a resize event with no actual size change is ignored');
    eq(run(c, 'shouldRecentre(' + P + ',0,0,null)'), false,
       'a zero-sized viewport (hidden tab) is ignored');
    eq(run(c, 'shouldRecentre(null,1600,800,null)'), false,
       'the first event is ignored: there is no baseline to measure from');

    // And the cases that SHOULD move it.
    eq(run(c, 'shouldRecentre(' + P + ',1600,800,null)'), true, 'a genuine widen acts');
    eq(run(c, 'shouldRecentre(' + P + ',390,700,null)'), true, 'an orientation change acts');
    eq(run(c, 'shouldRecentre(' + P + ',1200,500,"BUTTON")'), true,
       'a height change with a non-editable element focused still acts');
  });

  describe('the full-tree button escapes a deep home node, collapsed', () => {
    // The trap: resetView anchors on homeNodeId(), so once someone picks a name deep
    // in the tree, ⌂ shows a small subtree and nothing went the other way. The only
    // escape was clearing localStorage.
    const committed = loadFamily();
    const deep = Object.keys(committed.people).find(id => committed.people[id].generation >= 3);
    ok(!!deep, 'the data has a generation-3 person to use as a home node');

    const c = boot({ store: { ftHomeNode: deep }, role: 'admin' });
    run(c, 'resetView();');
    const home = run(c, 'state.visibleNodes.size');
    ok(home < 10, '⌂ from a deep home node shows only a small subtree (' + home + ')');

    run(c, 'showFullTree();');
    const full = run(c, 'state.visibleNodes.size');
    eq(run(c, 'state.expandedNodes.has(state.loggedInUser)'), true, '⇱ anchors at the root');
    ok(run(c, 'state.visibleNodes.has(state.loggedInUser)'), 'and the root is on screen');

    // COLLAPSED, not fully expanded. Expanding ~1,700 nodes is a wall of boxes you
    // then have to zoom out of; the point is to start at the top and drill down.
    ok(full < 50, 'it is collapsed, not every branch expanded (' + full + ' visible)');
    ok(full < Object.keys(committed.people).length,
       'specifically NOT all ' + Object.keys(committed.people).length + ' people');

    // And it must still be explorable from there.
    const drilled = run(c, `(function(){
      var kids = childIndex()[state.loggedInUser] || [];
      if (!kids.length) return -1;
      expandNode(kids[0], true); recomputeVisibleNodes();
      return state.visibleNodes.size;
    })()`);
    ok(drilled > full, 'drilling into a child reveals more (' + full + ' → ' + drilled + ')');

    // It must not clobber the identity the visitor chose.
    eq(run(c, 'homeNodeId()'), deep, '⇱ leaves the home node alone, so ⌂ still works');
    run(c, 'resetView();');
    eq(run(c, 'state.expandedNodes.has(' + JSON.stringify(deep) + ')'), true,
       'and ⌂ returns to their own view');
    eq(invariants(c), [], 'invariants hold throughout');
  });

  describe('resetView and showFullTree share one body', () => {
    // They differ only in the anchor. Two copies would drift, and this one has already
    // been edited twice.
    const c = boot({ role: 'admin' });
    eq(run(c, 'typeof openingViewFrom'), 'function', 'the shared helper exists');
    eq(run(c, 'openingViewFrom("pNOT-A-PERSON")'), false, 'it refuses an unknown anchor');
    eq(run(c, 'openingViewFrom(null)'), false, 'and a null one');
    // A refusal must leave the view untouched rather than half-collapsed.
    run(c, 'expandAll();');
    const before = run(c, 'state.visibleNodes.size');
    run(c, 'openingViewFrom("pNOPE");');
    eq(run(c, 'state.visibleNodes.size'), before, 'a refused call changes nothing');
  });

  describe('a wife can be reached from a collapsed tree', () => {
    // ensureNodeVisible is the path a search hit and a proposal preview both use. Its
    // partner branch only expanded the husband if he was ALREADY visible, and never
    // recursed to make him visible — unlike the child branch, which does. So on a
    // collapsed tree nothing happened, and the trailing visibleNodes.add() that papered
    // over it does not survive recomputeVisibleNodes(), which rebuilds from
    // expandedNodes.
    //
    // It affected only 2 people when found — both wives added through the app — because
    // all 1,746 imported people are recorded as male children. It affects every wife
    // added from here on.
    // The fixture is BUILT, not found. It used to scan data/family.js for a wife
    // with no father, which worked only because the two proposal-added wives
    // happened to be in the tree that day — deleting them (dd524fc, ee9270b) turned
    // this suite red without a line of the code under test changing. All 1,746
    // imported people are recorded as male children, so the live tree can be, and
    // now is, entirely free of the shape this test exists for.
    const committed = loadFamily();
    const child = new Set();
    for (const pp of committed.partnerships) for (const c of pp.children) if (c) child.add(c);

    // Add her the way the app does, through the op the proposal flow applies, so
    // this tests the real add-wife shape rather than a hand-built person.
    const husband = Object.keys(committed.people)
      .find(id => committed.people[id].gender === 'male' && child.has(id) &&
                  committed.people[id].generation >= 2);
    ok(!!husband, 'a husband to attach her to');
    const NEWWIFE = 'ptestwife1';

    const fatherless = Object.keys(committed.people)
      .filter(id => committed.people[id].gender === 'female' && !child.has(id));

    for (const w of fatherless.concat([NEWWIFE])) {
      const c = boot({ role: 'admin' });
      if (w === NEWWIFE) {
        const added = run(c, `FTReview.applyOp({ op: 'add_wife', target: ${JSON.stringify(husband)},
                                                 id: ${JSON.stringify(NEWWIFE)}, name: 'زوجة اختبار' })`);
        ok(added, 'a wife added through the real op');
        eq(invariants(c), [], 'the tree is still valid after adding her');
      }
      const label = run(c, 'state.people[' + JSON.stringify(w) + '].name');
      run(c, 'resetView();');
      ok(!run(c, 'state.visibleNodes.has(' + JSON.stringify(w) + ')'),
         label + ' starts hidden on a collapsed tree');
      run(c, 'ensureNodeVisible(' + JSON.stringify(w) + '); recomputeVisibleNodes();');
      ok(run(c, 'state.visibleNodes.has(' + JSON.stringify(w) + ')'),
         label + ' is revealed');
      // AND survives the recompute, which is what the old trailing add() did not.
      ok(run(c, '!!computeLayout()[' + JSON.stringify(w) + ']'),
         label + ' gets coordinates, so she actually draws');
      ok(run(c, 'state.expandedNodes.size') > 1, 'by expanding her husband, not by a hack');
      eq(invariants(c), [], 'invariants hold');
    }

    // A man with a father must keep working — that path was never broken.
    const men = Object.keys(committed.people)
      .filter(id => committed.people[id].gender === 'male' && child.has(id)).slice(0, 5);
    for (const m of men) {
      const c = boot({ role: 'admin' });
      run(c, 'resetView();');
      run(c, 'ensureNodeVisible(' + JSON.stringify(m) + '); recomputeVisibleNodes();');
      ok(run(c, 'state.visibleNodes.has(' + JSON.stringify(m) + ')'), m + ' is still revealed');
    }
  });

  describe('revealing a spouse cannot recurse forever', () => {
    // Revealing her recurses to him, and his partner is her. Without a seen-set that is
    // an infinite loop, and the fix introduced exactly that shape.
    const c = boot({ role: 'admin' });
    const pair = run(c, `(function(){
      var w = state.generateId();
      state.people[w] = {id:w, name:'زوجة', gender:'female', generation:5};
      // A couple with NO ancestry at all, so only the partner branch can apply.
      var m = state.generateId();
      state.people[m] = {id:m, name:'زوج', gender:'male', generation:5};
      state.partnerships.push({id:state.generatePPId(), partners:[m, w], children:[]});
      invalidateCoupleMap(); invalidateChildIndex(); invalidateParentIndex();
      return [m, w];
    })()`);
    run(c, 'resetView();');
    // If this recursed forever the test would hang or blow the stack rather than fail.
    run(c, 'ensureNodeVisible(' + JSON.stringify(pair[1]) + '); recomputeVisibleNodes();');
    ok(true, 'it terminates');
    eq(invariants(c), [], 'invariants hold');
  });

  describe('layout places every visible person', () => {
    const c = boot({ role: 'admin' });
    run(c, 'expandAll();');
    const laid = run(c, '(function(){ var l = computeLayout(); return Object.keys(l).length; })()');
    const people = run(c, 'Object.keys(state.people).length');
    eq(laid, people, 'all ' + people + ' people get coordinates');

    // Same-row spacing: spouses may sit closer, strangers may not.
    const violations = run(c, `(function(){
      var l = computeLayout(), byGen = {}, bad = 0;
      for (var id in l) { var g = state.people[id].generation; (byGen[g] = byGen[g] || []).push(id); }
      for (var g in byGen) {
        var row = byGen[g].sort(function(a,b){ return l[a].x - l[b].x; });
        for (var i = 1; i < row.length; i++) {
          var gap = l[row[i]].x - l[row[i-1]].x;
          var need = inSameMarriageGroup(row[i-1], row[i]) ? 202 : 258;
          if (gap < need - 0.5) bad++;
        }
      }
      return bad;
    })()`);
    eq(violations, 0, 'no two nodes on a row are closer than allowed');
  });

  describe('expand and collapse are symmetric', () => {
    const c = boot({ role: 'admin' });
    const opening = run(c, 'state.visibleNodes.size');
    run(c, 'expandAll();');
    ok(run(c, 'state.visibleNodes.size') > opening, 'expandAll reveals more');
    run(c, 'collapseAll();');
    eq(run(c, 'state.visibleNodes.size'), opening, 'collapseAll returns to the opening set');
  });

  describe('deletion is restricted to childless non-root people', () => {
    const c = boot({ role: 'admin' });
    const root = loadFamily().root;

    ok(!run(c, 'canDelete(' + JSON.stringify(root) + ')'), 'the root cannot be deleted');
    ok(!run(c, "canDelete('p2')"), 'someone with children cannot be deleted');
    ok(run(c, "typeof deleteBlockedReason('p2') === 'string'"),
       'and the refusal explains why: ' + JSON.stringify(run(c, "deleteBlockedReason('p2')")));

    // A childless leaf can go, and must leave nothing dangling.
    const leaf = run(c, "(function(){var i=childIndex();return Object.keys(state.people).find(function(k){return k!==state.loggedInUser && !(i[k]&&i[k].length);});})()");
    const before = { p: run(c, 'Object.keys(state.people).length'), pp: run(c, 'state.partnerships.length') };
    ok(run(c, 'deletePerson(' + JSON.stringify(leaf) + ')'), 'a childless leaf is deletable');
    eq(run(c, 'Object.keys(state.people).length'), before.p - 1, 'exactly one person removed');
    eq(run(c, 'state.partnerships.filter(function(p){return p.partners.indexOf(' + JSON.stringify(leaf) + ')>=0 || p.children.indexOf(' + JSON.stringify(leaf) + ')>=0;}).length'),
       0, 'no partnership still references them');
    eq(invariants(c), [], 'invariants hold after deletion');
  });

  describe('deleting a wife leaves no empty partnership behind', () => {
    const c = boot({ role: 'admin' });
    const base = run(c, 'state.partnerships.length');
    const w = run(c, `(function(){
      var w = state.generateId();
      state.people[w] = {id:w, name:'اختبار', gender:'female', generation:1};
      state.partnerships.push({id:state.generatePPId(), partners:['p2', w], children:[]});
      invalidateCoupleMap(); invalidateChildIndex();
      return w;
    })()`);
    eq(run(c, 'state.partnerships.length'), base + 1, 'the marriage was added');
    run(c, 'deletePerson(' + JSON.stringify(w) + ')');
    eq(run(c, 'state.partnerships.length'), base,
       'removing her also removes a partnership that now records nothing');
    // [null, wife] is the dangerous leftover: the next add_wife fills slot 0.
    eq(run(c, 'state.partnerships.filter(function(p){return !p.partners[0];}).length'),
       0, 'no partnership is left with an empty husband slot');
    eq(invariants(c), [], 'invariants hold');
  });

  describe('the drafts of the two pages do not mix', () => {
    // One browser: same store, both pages. A proposer's draft must not be
    // applied by admin as if it were pending admin work.
    const store = {};
    const v = boot({ store, role: 'propose' });
    run(v, `
      var x = state.generateId();
      state.people[x] = {id:x, name:'ProposerOnly', gender:'male', generation:1};
      state.partnerships.push({id:state.generatePPId(), partners:['p2', null], children:[x]});
      FTChangeLog.record({op:'add_child', target:'p2', id:x, name:'ProposerOnly', describe:'+ ProposerOnly'});
      FTChangeLog.clearLog();      // what submitting does: log clears, draft stays
    `);
    ok(run(v, 'FTChangeLog.hasDraft()'), 'the proposer keeps a draft after submitting');

    const a = boot({ store, role: 'admin' });
    ok(!run(a, 'FTChangeLog.hasDraft()'), 'admin sees no draft of its own');
    eq(run(a, 'FTChangeLog.count()'), 0, 'admin has nothing pending');
    ok(!run(a, "Object.values(state.people).some(function(p){return p.name==='ProposerOnly';})"),
       "the proposer's person is absent from the admin tree");

    const keys = Object.keys(store).sort();
    ok(keys.every(k => !/^ftFamilyDraft$|^ftChangeLog$/.test(k)),
       'no unsuffixed draft or log key exists', keys.join(', '));
  });

  describe('session undo restores exactly', () => {
    const c = boot({ role: 'admin' });
    const before = { p: run(c, 'Object.keys(state.people).length'), pp: run(c, 'state.partnerships.length'),
                     ctr: run(c, 'state._idCounter') };
    run(c, `
      FTChangeLog.pushUndo('t');
      var x = state.generateId();
      state.people[x] = {id:x, name:'Temp', gender:'male', generation:1};
      state.partnerships.push({id:state.generatePPId(), partners:['p2', null], children:[x]});
      invalidateChildIndex(); invalidateParentIndex();
      FTChangeLog.record({op:'add_child', target:'p2', id:x, name:'Temp', describe:'+ Temp'});
    `);
    ok(run(c, 'FTChangeLog.canUndo()'), 'the edit is undoable');
    run(c, 'FTChangeLog.undo();');
    eq(run(c, 'Object.keys(state.people).length'), before.p, 'people restored');
    eq(run(c, 'state.partnerships.length'), before.pp, 'partnerships restored');
    eq(run(c, 'FTChangeLog.count()'), 0, 'the changelog entry is gone');
    ok(!run(c, 'FTChangeLog.hasDraft()'), 'the draft clears when nothing is pending');
    eq(invariants(c), [], 'invariants hold');
  });

  describe('the changelog is valid JSON Lines', () => {
    const c = boot({ role: 'admin' });
    const NL = String.fromCharCode(10);
    run(c, `
      ['a', 'b' + String.fromCharCode(10) + 'c', 'say "hi"', 'back\\\\slash'].forEach(function(n, i){
        FTChangeLog.record({op:'rename', target:'p2', from:'x', to:n, describe:'~ ' + n});
      });
    `);
    const jsonl = run(c, 'FTChangeLog.toJSONL()');
    const lines = jsonl.split(NL).filter(Boolean);
    eq(lines.length, 4, 'one line per entry');
    let bad = 0;
    for (const l of lines) { try { JSON.parse(l); } catch (e) { bad++; } }
    eq(bad, 0, 'every line parses independently');
    ok(!lines.some(l => /[\r\n]/.test(l)), 'no line contains a raw newline');
  });
};
