/* ============================================================================
   tools/test/harness.js — boot the real app modules in Node, against real data.

   No dependencies, deliberately: this repo has no package manager and no build
   step (see CLAUDE.md), so the tests must run with nothing but `node`.

   The trick is that all app JS is classic scripts sharing one global scope, so a
   vm context is a very good stand-in for a page. Layout maths runs for real;
   only painting is stubbed. The DOM is faked just enough that module bodies
   execute — in particular getElementById('propose-bar'), which is how
   changelog.js decides whether it is the viewer or admin.

   Run the suite:  node tools/test/run.js
============================================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

function loadFamily() {
  const raw = fs.readFileSync(path.join(REPO, 'data/family.js'), 'utf8');
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('};') + 1));
}

/* Boot one page.
     store  — a plain object standing in for localStorage. Pass the SAME object
              to two boots to model ONE browser, which is how index.html and
              admin.html actually relate (same origin, shared storage).
     role   — 'propose' (index.html) or 'admin' (admin.html)
     net    — optional fetch stub                                             */
function boot(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const role = opts.role || 'admin';
  const familyData = opts.family || loadFamily();

  const ctx = {
    familyData, console, setTimeout, clearTimeout, Date, JSON, Math, Object,
    Set, Array, String, Number, Boolean, parseInt, parseFloat, isNaN, RegExp,
    Error, TypeError, Promise, Uint8Array, TextEncoder, TextDecoder, btoa, atob,
    crypto: require('crypto').webcrypto,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    document: {
      // The ONLY thing that decides the storage role. See changelog.js.
      getElementById: id => (id === 'propose-bar' && role === 'propose') ? {} : null,
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        classList: { add() {}, remove() {}, toggle() {} },
        style: {}, appendChild() {}, addEventListener() {}, setAttribute() {},
      }),
      body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
    },
    window: {},
  };
  ctx.window = ctx;
  ctx.fetch = opts.net || (async () => { throw new TypeError('no network in tests'); });
  vm.createContext(ctx);

  const load = f => vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx);

  for (const f of [
    'assets/js/core/state.js', 'assets/js/core/layout.js', 'assets/js/core/links.js',
    'assets/js/core/interactions.js', 'assets/js/core/search.js', 'assets/js/changelog.js',
  ]) load(f);

  // Renderer-free stubs. computeLayout is the real thing; drawing is not.
  vm.runInContext(`
    function render(){ state.layout = computeLayout(); }
    function centerOnNode(){} function fitToNodes(){} function hideNodePanel(){}
    function showNodePanel(){} function renderSearchResults(){}
    function markFamilyDirty(){} function markProposeState(){}
    function setNodeLabel(){} function englishName(){ return null; }
    function homeNodeId(){
      try { var s = localStorage.getItem('ftHomeNode'); if (s && state.people[s]) return s; } catch(e){}
      return state.loggedInUser;
    }
    function setHomeNode(id){ if (state.people[id]) localStorage.setItem('ftHomeNode', id); }
    var d3 = { select: function(){ return {
      selectAll: function(){ return { filter: function(){ return {
        select: function(){ return { call: function(){} }; }, node: function(){ return null; } }; } }; },
      node: function(){ return null; } }; } };
    initState();
  `, ctx);

  load('assets/js/edit.js');
  load('assets/js/supabase.js');
  if (role === 'propose') load('assets/js/propose.js');
  else {
    load('assets/js/admin/review.js');
    // github.js is loaded so the PUBLISH guards can be exercised. Its network
    // calls go through the same ctx.fetch stub as everything else, so nothing
    // reaches GitHub; what is testable is the refusal logic that runs before any
    // request — which is where the stale-draft data-loss guard lives.
    load('assets/js/admin/github.js');
  }

  return ctx;
}

const run = (ctx, code) => vm.runInContext(code, ctx);

/* The domain invariants, checked inside the page's own context so they see the
   real state. Returns [] when healthy. This is the primary oracle: assert it
   after EVERY mutation. */
function invariants(ctx) {
  return run(ctx, `(function(){
    var bad = [], people = state.people, pps = state.partnerships;

    for (var i = 0; i < pps.length; i++) {
      var pp = pps[i];
      for (var k = 0; k < pp.partners.length; k++) {
        var pid = pp.partners[k];
        if (pid && !people[pid]) bad.push('partner ' + pid + ' in ' + pp.id + ' missing from people');
      }
      for (var c = 0; c < pp.children.length; c++) {
        if (pp.children[c] && !people[pp.children[c]])
          bad.push('child ' + pp.children[c] + ' in ' + pp.id + ' missing from people');
      }
      if (!pp.partners[0] && !pp.partners[1]) bad.push(pp.id + ' has no partners');
      if (pp.partners[0] && people[pp.partners[0]] && people[pp.partners[0]].gender === 'female')
        bad.push(pp.id + ' has a female in partners[0]');
      if (pp.children.length === 0 && !(pp.partners[0] && pp.partners[1]))
        bad.push(pp.id + ' records neither descent nor a marriage');
    }

    // women are terminal
    var kids = {};
    for (var i = 0; i < pps.length; i++) {
      var pp = pps[i];
      for (var k = 0; k < pp.partners.length; k++) {
        var pid = pp.partners[k]; if (!pid) continue;
        kids[pid] = kids[pid] || [];
        for (var c = 0; c < pp.children.length; c++) if (pp.children[c]) kids[pid].push(pp.children[c]);
      }
    }
    // Object.keys, never for...in. A rename op targeting '__proto__' assigned
    // Object.prototype.name, and for...in walks the prototype chain — so the
    // oracle grew a phantom person called 'name' and reported a confusing
    // generation error instead of the pollution that caused it. An oracle that
    // is itself corruptible by the bug it looks for is worse than none.
    var ids = Object.keys(people);
    for (var n = 0; n < ids.length; n++) {
      var id = ids[n];
      if (people[id].gender === 'female' && (kids[id] || []).length)
        bad.push('female ' + id + ' has children');
    }

    // a tree, not a DAG
    var seenChild = {};
    for (var i = 0; i < pps.length; i++)
      for (var c = 0; c < pps[i].children.length; c++) {
        var ch = pps[i].children[c]; if (!ch) continue;
        if (seenChild[ch]) bad.push(ch + ' is a child in two partnerships');
        seenChild[ch] = 1;
      }

    var seenPP = {};
    for (var i = 0; i < pps.length; i++) {
      if (seenPP[pps[i].id]) bad.push('duplicate partnership id ' + pps[i].id);
      seenPP[pps[i].id] = 1;
    }

    // generation must stay a usable row index
    for (var n = 0; n < ids.length; n++) {
      var g = people[ids[n]].generation;
      if (typeof g !== 'number' || !isFinite(g) || g < 0)
        bad.push(ids[n] + ' has an unusable generation: ' + g);
    }

    // The prototype must stay clean. Nothing in the app may add to it, and a
    // polluted one silently changes every for...in and every {} in the page.
    for (var _k in {}) bad.push('Object.prototype is polluted with: ' + _k);
    return bad;
  })()`);
}

/* Build a proposal the way a visitor's browser would, by driving the real
   propose-side code. Returns the row that would reach Supabase. */
function makeProposal(who, edits) {
  const store = {};
  const v = boot({ store, role: 'propose' });
  run(v, 'setHomeNode(' + JSON.stringify(who.node) + ');');

  for (const e of edits) {
    run(v, `
      (function(){
        var rel = ${JSON.stringify(e.rel)}, target = ${JSON.stringify(e.target)};
        var R = RELATIONS[rel], t = state.people[target];
        var id = state.generateId();
        state.people[id] = { id: id, name: ${JSON.stringify(e.name)},
                             gender: R.gender, generation: t.generation + R.dGen };
        if (R.kind === 'child') {
          var pp = state.partnerships.find(function(p){
            return p.partners[0] === target || p.partners[1] === target; });
          if (pp) pp.children.push(id);
          else state.partnerships.push({ id: state.generatePPId(),
                                         partners: [target, null], children: [id] });
        } else if (R.kind === 'partner') {
          state.partnerships.push({ id: state.generatePPId(),
                                    partners: [target, id], children: [] });
        } else {
          state.partnerships.push({ id: state.generatePPId(),
                                    partners: [id, null], children: [target] });
        }
        invalidateParentIndex(); invalidateCoupleMap(); invalidateChildIndex();
        FTChangeLog.record({
          op: R.kind === 'child' ? 'add_child' : R.kind === 'partner' ? 'add_wife' : 'add_father',
          target: target, id: id, name: ${JSON.stringify(e.name)}, gender: R.gender,
          generation: t.generation + R.dGen,
          describe: '+ ' + ${JSON.stringify(e.name)} + ' -> ' + target });
      })();
    `);
  }

  return {
    ctx: v,
    proposerInvariants: invariants(v),
    row: {
      id: 'prop-' + who.name + '-' + run(v, 'state.generateId()'),
      created_at: '2026-01-01T00:00:00Z',
      author_name: who.name,
      author_node: who.node,
      ops: run(v, 'FTChangeLog.entries()'),
      note: edits.note || null,
    },
  };
}

module.exports = { boot, run, invariants, loadFamily, makeProposal, REPO };
