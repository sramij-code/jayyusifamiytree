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
