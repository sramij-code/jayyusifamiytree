/* ============================================================================
   proposals.test.js — the propose → review → approve/reject lifecycle.

   Every case here corresponds to a bug that was found and fixed. The crafted-op
   group matters most: the Supabase publishable key ships to every visitor, so
   anyone can POST an arbitrary row straight to the table without going near the
   UI that enforces the domain rules. applyOp is therefore the real gate, not the
   modal.
============================================================================ */

const { boot, run, invariants, makeProposal, loadFamily } = require('./harness.js');

// A row as it would arrive from Supabase.
function row(id, ops, extra) {
  return Object.assign({ id, created_at: '2026-01-01T00:00:00Z',
                         author_name: 'tester', author_node: 'p1', ops, note: null }, extra || {});
}

module.exports = function ({ describe, ok, eq }) {

  describe('a proposal built by the viewer is applied faithfully by admin', () => {
    const p = makeProposal({ name: 'رامي', node: 'p143' },
                           [{ rel: 'wife', target: 'p2', name: 'علا' }]);
    eq(p.proposerInvariants, [], 'the proposer tree is healthy');
    eq(p.row.ops.length, 1, 'one op reached the row');

    const a = boot({ role: 'admin' });
    const base = run(a, 'Object.keys(state.people).length');
    const r = run(a, 'FTReview.preview(' + JSON.stringify(p.row) + ')');
    eq(r.failed.length, 0, 'nothing was refused');
    eq(run(a, 'Object.keys(state.people).length'), base + 1, 'the person appears');
    // The id the proposer saw is the id that gets committed.
    ok(run(a, 'state.people[' + JSON.stringify(p.row.ops[0].id) + '] !== undefined'),
       "the proposer's own id is reused, not reminted");
    eq(invariants(a), [], 'invariants hold in preview');

    const n = run(a, 'FTReview.approve(' + JSON.stringify(p.row) + ')');
    eq(n, 1, 'one changelog entry recorded');
    eq(run(a, 'FTChangeLog.entries()[0].fromProposal'), p.row.id, 'tagged with the proposal id');
    eq(run(a, 'FTChangeLog.entries()[0].by'), 'رامي', 'credited to the proposer');
    eq(invariants(a), [], 'invariants hold after approval');
  });

  describe('accepting some proposals while rejecting others', () => {
    const A = makeProposal({ name: 'رامي', node: 'p143' }, [{ rel: 'wife', target: 'p2', name: 'علا' }]);
    const B = makeProposal({ name: 'هشام', node: 'p1097' }, [{ rel: 'wife', target: 'p2', name: 'فاطمة' }]);
    const C = makeProposal({ name: 'سامي', node: 'p4' },
                           [{ rel: 'son', target: 'p4', name: 'زيد' },
                            { rel: 'daughter', target: 'p4', name: 'نور' }]);
    const a = boot({ role: 'admin' });
    const base = run(a, 'Object.keys(state.people).length');

    for (const p of [A, B, C]) {
      run(a, 'FTReview.preview(' + JSON.stringify(p.row) + ')');
      run(a, 'FTReview.approve(' + JSON.stringify(p.row) + ')');
      eq(invariants(a), [], 'invariants hold after approving ' + p.row.author_name + "'s proposal");
    }
    // Rejected: previewed, then turned down. Nothing may survive.
    const D = makeProposal({ name: 'خالد', node: 'p3' }, [{ rel: 'son', target: 'p3', name: 'مرفوض' }]);
    run(a, 'FTReview.preview(' + JSON.stringify(D.row) + ')');
    run(a, 'FTReview.reject(' + JSON.stringify(D.row) + ')');

    eq(run(a, 'Object.keys(state.people).length'), base + 4, 'exactly the four approved people exist');
    ok(!run(a, "Object.values(state.people).some(function(p){return p.name==='مرفوض';})"),
       'the rejected person is absent');
    eq(run(a, 'FTChangeLog.count()'), 4, 'four entries to commit');
    // Two wives for one man, each with her own partnership and no children.
    // Asserted as a delta: p2 may already have wives in the committed data, and
    // the suite must not go red because the real tree gained one.
    const wives = run(a, "partnersOf('p2').map(function(x){return state.people[x.other].name;})");
    ok(wives.indexOf('علا') !== -1 && wives.indexOf('فاطمة') !== -1,
       'both approved wives of the same man are present', JSON.stringify(wives));
    eq(run(a, "(childIndex()['p2']||[]).length"), 1, 'his pre-existing child count is unchanged');
    eq(invariants(a), [], 'invariants hold at the end');
  });

  describe('a preview can be dismissed back to the exact prior tree', () => {
    const a = boot({ role: 'admin' });
    const before = { p: run(a, 'Object.keys(state.people).length'),
                     pp: run(a, 'state.partnerships.length') };
    const r = row('dis', [{ op: 'add_wife', target: 'p2', id: 'pDIS', name: 'س', describe: '+ س' }]);
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    ok(run(a, "!!state.people['pDIS']"), 'applied during preview');
    run(a, 'FTReview.dismiss()');
    ok(!run(a, "!!state.people['pDIS']"), 'gone after dismiss');
    eq(run(a, 'Object.keys(state.people).length'), before.p, 'people restored');
    eq(run(a, 'state.partnerships.length'), before.pp, 'partnerships restored');
    eq(run(a, 'FTReview.previewing()'), null, 'no preview is live');
    eq(run(a, 'FTChangeLog.count()'), 0, 'preview records nothing');
  });

  describe('a preview is exclusive, so dismiss always pops its own snapshot', () => {
    // Editing during a preview used to push a newer undo snapshot, so dismiss
    // undid the ADMIN'S edit and left the unapproved proposal applied — and
    // persisted into the draft by that edit's saveDraft.
    const a = boot({ role: 'admin' });
    run(a, `
      FTChangeLog.pushUndo('mine');
      var x = state.generateId();
      state.people[x] = {id:x, name:'AdminEdit', gender:'male', generation:1};
      state.partnerships.push({id:state.generatePPId(), partners:['p2', null], children:[x]});
      invalidateChildIndex(); invalidateParentIndex();
      FTChangeLog.record({op:'add_child', target:'p2', id:x, name:'AdminEdit', describe:'+ AdminEdit'});
    `);
    const r = row('excl', [{ op: 'add_wife', target: 'p3', id: 'pEXCL', name: 'ص', describe: '+ ص' }]);
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');

    ok(run(a, 'previewIsLive()'), 'previewIsLive reports the live preview');
    // Every mutating entry point must refuse.
    run(a, "openModal('p2');");
    ok(!run(a, 'state._modalTargetId'), 'openModal refuses while previewing');
    run(a, "requestDeletePerson('p4');");
    ok(run(a, "!!state.people['p4']"), 'delete refuses while previewing');

    // The inline rename's commit() closure is the other snapshot-pushing path.
    // It cannot be driven from here (it needs a real input element), so the
    // guard on it is verified by source inspection in static.test.js —
    // "every pushUndo in edit.js is inside a previewIsLive-guarded function".
    // Asserting it here by re-implementing the guard in the test would prove
    // nothing about the code.

    run(a, 'FTReview.dismiss()');
    ok(!run(a, "!!state.people['pEXCL']"), 'the proposal is gone after dismiss');
    ok(run(a, "Object.values(state.people).some(function(p){return p.name==='AdminEdit';})"),
       "the admin's own edit survived");
    ok(!run(a, "!!(FTChangeLog.draft() && Object.values(FTChangeLog.draft().people).some(function(p){return p.name==='ص';}))"),
       'the unapproved proposal never entered the draft');
    eq(invariants(a), [], 'invariants hold');
  });

  describe('approving twice does not double-record', () => {
    // Run for EVERY op kind. An earlier version of this test used add_wife only,
    // which self-heals because applyOp refuses an id that already exists — so it
    // passed while `rename` silently appended its entry a second time.
    // The rename's `to` is derived from p2's CURRENT name rather than written out,
    // so it cannot accidentally equal it — applyOp refuses a no-op rename, which
    // would have made this test pass for the wrong reason if the live data ever
    // happened to hold the literal value.
    const p2Name = run(boot({ role: 'admin' }), "state.people['p2'].name");
    const kinds = [
      ['add_wife',      { op: 'add_wife', target: 'p2', id: 'pD1', name: 'ع', describe: '+ ع' }],
      ['add_child',     { op: 'add_child', target: 'p2', id: 'pD2', name: 'ز', describe: '+ ز' }],
      ['rename',        { op: 'rename', target: 'p2', from: p2Name, to: p2Name + ' (مُعدَّل)', describe: '~ x' }],
    ];
    for (const [label, op] of kinds) {
      const a = boot({ role: 'admin' });
      const r = row('dup-' + label, [op]);
      run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
      const first = run(a, 'FTReview.approve(' + JSON.stringify(r) + ')');
      const logAfter = run(a, 'FTChangeLog.count()');
      run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
      const second = run(a, 'FTReview.approve(' + JSON.stringify(r) + ')');
      eq(first, 1, label + ': first approval records one');
      eq(second, 0, label + ': second approval records nothing');
      eq(run(a, 'FTChangeLog.count()'), logAfter, label + ': changelog is not appended twice');
      // The card must also stop offering itself, or the badge keeps counting it.
      eq(run(a, 'FTReview.previewing()'), null, label + ': no preview left live');
    }
  });

  describe('an approved row is marked so the queue stops offering it', () => {
    const a = boot({ role: 'admin' });
    const r = row('mark', [{ op: 'add_wife', target: 'p2', id: 'pMK', name: 'ع', describe: '+ ع' }]);
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    const res = run(a, '(function(){ var row = ' + JSON.stringify(r) + '; var n = FTReview.approve(row); return {n:n, state:row._state}; })()');
    eq(res.n, 1, 'one entry recorded');
    eq(res.state, 'approved', "the row's _state is set, so renderReviewList hides it");
  });

  describe('what reaches the changelog is derived, not the op as sent', () => {
    // The entry becomes a line of data/changes.jsonl and, for a single-op
    // proposal, the commit SUBJECT. A raw spread let a proposer put a 300-char
    // name in the log while the tree was capped at 80, and inject newlines plus
    // a Co-authored-by: trailer that GitHub acts on.
    const NL = String.fromCharCode(10);
    const a = boot({ role: 'admin' });
    const evil = '+ harmless' + NL + NL + '  fake bullet' + NL + '  Co-authored-by: someone <a@b.c>';
    const r = row('derive', [{ op: 'add_child', target: 'p2', id: 'pDV',
                               name: 'ا'.repeat(300), describe: evil }],
                  { author_name: 'ب'.repeat(200) });
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    run(a, 'FTReview.approve(' + JSON.stringify(r) + ')');

    const e = run(a, 'FTChangeLog.entries()[0]');
    ok(e.name.length <= 80, 'the recorded name is capped like the tree (' + e.name.length + ')');
    eq(e.name.length, run(a, "state.people['pDV'].name.length"),
       'log and tree agree on the name');
    ok(e.by.length <= 80, 'the author is capped too (' + e.by.length + ')');
    ok(!/Co-authored-by/.test(e.describe), 'the proposer cannot inject a git trailer');
    ok(!/[\r\n]/.test(e.describe), 'describe carries no newline');

    const msg = run(a, 'FTChangeLog.commitMessage()');
    ok(!/Co-authored-by/.test(msg), 'nor into the commit message');
    ok(msg.split(NL).filter(l => /Co-authored|fake bullet/.test(l)).length === 0,
       'no forged lines in the commit message');
  });

  describe('zero-width and bidi-control names are refused', () => {
    const a = boot({ role: 'admin' });
    // A name of only zero-width spaces rendered blank; a leading U+202E
    // reordered its whole review row and commit-message line in an RTL UI.
    const ZWSP = String.fromCharCode(0x200B), RLO = String.fromCharCode(0x202E);
    eq(run(a, 'FTReview.applyOp(' + JSON.stringify({ op: 'add_child', target: 'p2', id: 'pZW', name: ZWSP + ZWSP, describe: 'x' }) + ')'),
       false, 'a name of zero-width spaces is refused');
    run(a, 'FTReview.applyOp(' + JSON.stringify({ op: 'add_child', target: 'p2', id: 'pRL', name: RLO + 'رامي', describe: 'x' }) + ')');
    const stored = run(a, "state.people['pRL'] && state.people['pRL'].name");
    ok(stored && !/[\u202A-\u202E\u2066-\u2069]/.test(stored),
       'bidi controls are stripped from a stored name', JSON.stringify(stored));
  });

  describe('a malformed op ELEMENT cannot blank the queue', () => {
    // load() guarantees an array; it must also guarantee the elements are
    // objects. ops:[null] passed Array.isArray and then threw in reviewCard's
    // `op.describe` during RENDER, blanking every pending proposal.
    const net = async () => ({
      ok: true, status: 200,
      json: async () => ([{ id: 'n', created_at: 'x', author_name: 'a', note: null, ops: [null, 5, 'x', { op: 'add_wife', target: 'p2', id: 'pOK', name: 'ع', describe: '+ ع' }] }]),
    });
    const a = boot({ role: 'admin', net });
    return run(a, 'FTReview.load()').then(() => {
      const ops = run(a, 'FTReview.all()[0].ops');
      eq(ops.length, 1, 'only the object op survives normalisation');
      // The render-time loop must not throw on anything that got through.
      let threw = null;
      try { for (const op of ops) { const t = op.describe || op.op; } }
      catch (e) { threw = e.message; }
      ok(!threw, 'a reviewCard-style loop over the normalised ops is safe', threw || '');
    });
  });

  describe('legacy: approving twice with add_wife specifically', () => {
    const a = boot({ role: 'admin' });
    const r = row('dup', [{ op: 'add_wife', target: 'p2', id: 'pDUP', name: 'ع', describe: '+ ع' }]);
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    eq(run(a, 'FTReview.approve(' + JSON.stringify(r) + ')'), 1, 'first approval records one');
    const after = { p: run(a, 'Object.keys(state.people).length'), log: run(a, 'FTChangeLog.count()') };
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    eq(run(a, 'FTReview.approve(' + JSON.stringify(r) + ')'), 0, 'second approval records nothing');
    eq(run(a, 'Object.keys(state.people).length'), after.p, 'no duplicate person');
    eq(run(a, 'FTChangeLog.count()'), after.log, 'no duplicate changelog entry');
  });

  describe('approve never records an edit the tree does not have', () => {
    // Undoing out of a preview then approving used to record entries for people
    // that were no longer there, with fromProposal marking it applied forever.
    const a = boot({ role: 'admin' });
    const r = row('undone', [{ op: 'add_wife', target: 'p2', id: 'pUN', name: 'ك', describe: '+ ك' }]);
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    // The real UI routes ⌘Z to dismiss while previewing; force the raw undo to
    // prove approve() is defensive even so.
    run(a, 'FTChangeLog.undo();');
    eq(run(a, 'FTReview.approve(' + JSON.stringify(r) + ')'), 0,
       'nothing is recorded when the ops are no longer applied');
    eq(run(a, 'FTChangeLog.count()'), 0, 'the changelog stays empty');
  });

  describe('a proposed deletion is VISIBLE during preview', () => {
    // The bug: applyOp deleted the person, and preview() then reveals, highlights
    // and frames by looking each touched id up in state.people — so all three
    // silently skipped, no node was highlighted, and the empty frame made
    // fitToNodes fall back to the whole visible tree, zooming OUT. A deletion was
    // the only op you could not see, and the only one you must see first.
    //
    // Preview now MARKS; approve() performs the delete.
    const a = boot({ role: 'admin' });
    // A leaf of our own, so the case does not depend on who is in the live data.
    const target = run(a, `(function(){
      var w = state.generateId();
      state.people[w] = {id:w, name:'ورقة', gender:'female', generation:2};
      state.partnerships.push({id:state.generatePPId(), partners:['p2', w], children:[]});
      invalidateCoupleMap(); invalidateChildIndex(); invalidateParentIndex();
      return w;
    })()`);
    ok(run(a, 'canDelete(' + JSON.stringify(target) + ')'), 'the target is deletable');

    const r = row('delvis', [{ op: 'delete_person', target, name: 'ورقة',
                               describe: '− ورقة (' + target + ')' }]);
    const res = run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    eq(res.failed, [], 'the op is accepted');
    eq(res.touched, [target], 'the target counts as touched, so it gets revealed');

    ok(run(a, '!!state.people[' + JSON.stringify(target) + ']'),
       'still present during preview — marked, not removed');
    ok(run(a, 'state.markedForRemovalIds.has(' + JSON.stringify(target) + ')'),
       'marked for removal, which is what draws it struck through');
    ok(run(a, 'state.selectedPathIds.has(' + JSON.stringify(target) + ')'),
       'highlighted, which is what the reviewer reported missing');
    ok(run(a, 'state.visibleNodes.has(' + JSON.stringify(target) + ')'),
       'revealed even if it sat in a collapsed branch');
    ok(run(a, '!!state.layout[' + JSON.stringify(target) + ']'),
       'has coordinates, so the view frames the change instead of zooming out');
    eq(run(a, 'FTChangeLog.count()'), 0, 'a preview still records nothing');
    eq(invariants(a), [], 'invariants hold during preview');

    // And approve performs it for real.
    const before = run(a, 'Object.keys(state.people).length');
    eq(run(a, 'FTReview.approve(' + JSON.stringify(r) + ')'), 1, 'one entry recorded');
    ok(!run(a, '!!state.people[' + JSON.stringify(target) + ']'), 'gone after approval');
    eq(run(a, 'Object.keys(state.people).length'), before - 1, 'exactly one person removed');
    eq(run(a, 'state.markedForRemovalIds.size'), 0, 'the mark is cleared');
    ok(!run(a, `state.partnerships.some(function(p){
         return p.partners.indexOf(${JSON.stringify(target)}) !== -1 ||
                p.children.indexOf(${JSON.stringify(target)}) !== -1; })`),
       'no dangling reference is left behind');
    eq(invariants(a), [], 'invariants hold after approval');
  });

  describe('dismissing a proposed deletion removes nobody', () => {
    const a = boot({ role: 'admin' });
    const target = run(a, `(function(){
      var w = state.generateId();
      state.people[w] = {id:w, name:'باقية', gender:'female', generation:2};
      state.partnerships.push({id:state.generatePPId(), partners:['p3', w], children:[]});
      invalidateCoupleMap(); invalidateChildIndex(); invalidateParentIndex();
      return w;
    })()`);
    const before = run(a, 'Object.keys(state.people).length');
    const r = row('deldis', [{ op: 'delete_person', target, name: 'باقية', describe: '− باقية' }]);
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    run(a, 'FTReview.dismiss()');

    ok(run(a, '!!state.people[' + JSON.stringify(target) + ']'), 'still there after dismiss');
    eq(run(a, 'Object.keys(state.people).length'), before, 'nobody was removed');
    // Marks are not part of the undo snapshot, so dismiss must clear them or the
    // node stays drawn struck-through forever.
    eq(run(a, 'state.markedForRemovalIds.size'), 0, 'the mark is cleared, not left drawn');
    eq(run(a, 'FTChangeLog.count()'), 0, 'nothing recorded');
    eq(invariants(a), [], 'invariants hold');
  });

  describe('an undeletable target is refused with a reason', () => {
    // The proposer saw a leaf; by review time they may have children. Saying only
    // "cannot delete" would leave the reviewer guessing.
    const a = boot({ role: 'admin' });
    const r = row('delbad', [{ op: 'delete_person', target: 'p2', describe: '− p2' }]);
    const res = run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    eq(res.touched, [], 'nothing is marked');
    eq(res.failed.length, 1, 'the op is reported as failed');
    ok(/ابن|أبناء|جذر/.test(res.failed[0]), 'the reason is named', res.failed[0]);
    ok(run(a, "!!state.people['p2']"), 'the person is untouched');
    eq(run(a, 'state.markedForRemovalIds.size'), 0, 'nothing marked for removal');
    // Approving a proposal whose only op was refused must record nothing.
    eq(run(a, 'FTReview.approve(' + JSON.stringify(r) + ')'), 0, 'nothing recorded');
    eq(invariants(a), [], 'invariants hold');
  });

  describe('a stale draft that hides committed people is detected', () => {
    // The failure this closes, end to end: an admin could not see Ola1, a proposal
    // to delete her refused to apply, it stayed pending forever, and the publish
    // bar said "TREE IN SYNC" the whole time. applyDraft replaces state.people
    // wholesale, so a draft saved before she was committed hid her indefinitely.
    const committed = loadFamily();
    // Must be a LEAF, or canDelete refuses for an unrelated reason and the test
    // would pass while proving nothing about the draft.
    const parents = new Set();
    for (const pp of committed.partnerships) {
      if (pp.children.length) for (const x of pp.partners) if (x) parents.add(x);
    }
    const victim = Object.keys(committed.people).find(id =>
      id !== committed.root && id !== committed.loggedInUser && !parents.has(id));
    const victimName = committed.people[victim].name;

    const stale = JSON.parse(JSON.stringify(committed));
    delete stale.people[victim];
    stale.partnerships = stale.partnerships
      .map(p => Object.assign({}, p, { partners: p.partners.map(x => x === victim ? null : x) }))
      .filter(p => p.partners.some(Boolean) || p.children.length);

    const store = {
      'ftFamilyDraft:admin': JSON.stringify({ people: stale.people, partnerships: stale.partnerships }),
      'ftChangeLog:admin': '[]',      // nothing unpublished, so the bar claimed sync
    };
    const a = boot({ store, role: 'admin' });
    // The harness stops at initState(); admin.js:61-62 is what applies the draft.
    run(a, 'if (FTChangeLog.hasDraft()) FTChangeLog.applyDraft();');

    ok(!run(a, '!!state.people[' + JSON.stringify(victim) + ']'),
       'the draft hides a committed person, reproducing the report');
    eq(run(a, 'FTChangeLog.count()'), 0, 'and there is nothing unpublished');

    const div = run(a, 'FTChangeLog.draftDivergence()');
    eq(div.missing, [victim], 'the divergence names exactly who is hidden');
    eq(div.names, [victimName], 'and reports their name for the warning');

    // The proposal then refuses, WITH a reason — which the UI now shows.
    const r = row('stale', [{ op: 'delete_person', target: victim, name: victimName,
                              describe: '− ' + victimName }]);
    const res = run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    eq(res.touched, [], 'nothing is marked, so nothing appears on the tree');
    eq(res.failed.length, 1, 'the op is refused');
    ok(/لا يوجد/.test(res.failed[0]), 'the reason says the target does not exist', res.failed[0]);
    eq(run(a, 'FTReview.approve(' + JSON.stringify(r) + ')'), 0,
       'and approving records nothing, so it stays pending');

    // Discarding the stale draft is the cure.
    const b = boot({ store: { 'ftChangeLog:admin': '[]' }, role: 'admin' });
    run(b, 'if (FTChangeLog.hasDraft()) FTChangeLog.applyDraft();');
    ok(run(b, '!!state.people[' + JSON.stringify(victim) + ']'),
       'without the draft the person is present again');
    eq(run(b, 'FTChangeLog.draftDivergence().missing'), [], 'and no divergence is reported');
    run(b, 'FTReview.preview(' + JSON.stringify(r) + ')');
    eq(run(b, 'state.markedForRemovalIds.size'), 1, 'the deletion previews normally');
    eq(invariants(b), [], 'invariants hold');
  });

  describe('draft-only people are not mistaken for a stale draft', () => {
    // The other direction must stay silent. A proposer's draft keeps their SENT
    // suggestion on their own tree after clearLog(), so an empty log with a draft
    // is normal there — treating it as stale would erase what they proposed.
    const committed = loadFamily();
    const extra = JSON.parse(JSON.stringify(committed));
    extra.people['pdraftonly'] = { id: 'pdraftonly', name: 'مقترح', gender: 'female', generation: 2 };
    extra.partnerships.push({ id: 'ppdraftonly', partners: ['p2', 'pdraftonly'], children: [] });

    const store = {
      'ftFamilyDraft:propose': JSON.stringify({ people: extra.people, partnerships: extra.partnerships }),
      'ftChangeLog:propose': '[]',      // already sent
      ftProposeMode: 'true',
    };
    const v = boot({ store, role: 'propose' });
    run(v, 'if (FTChangeLog.hasDraft()) FTChangeLog.applyDraft();');
    ok(run(v, "!!state.people['pdraftonly']"), "the proposer still sees their own suggestion");
    eq(run(v, 'FTChangeLog.draftDivergence().missing'), [],
       'a draft that only ADDS is not reported as stale');
    eq(invariants(v), [], 'invariants hold');
  });

  describe('crafted proposals cannot break the domain rules', () => {
    const cases = [
      ['add_father to someone who already has one',
       [{ op: 'add_father', target: 'p3', id: 'pF1', name: 'مزعوم', describe: 'x' }]],
      ['gender forced to nonsense',
       [{ op: 'add_child', target: 'p2', id: 'pG1', name: 'س', gender: 'banana', describe: 'x' }]],
      ['generation forced negative',
       [{ op: 'add_child', target: 'p2', id: 'pG2', name: 'س', generation: -99, describe: 'x' }]],
      ['an unknown op name',
       [{ op: 'make_president', target: 'p2', id: 'pG3', name: 'س', describe: 'x' }]],
      ['an empty name', [{ op: 'add_child', target: 'p2', id: 'pG4', name: '   ', describe: 'x' }]],
      ['a missing target', [{ op: 'add_child', target: 'nope', id: 'pG5', name: 'س', describe: 'x' }]],
      ['delete of the root', [{ op: 'delete_person', target: loadFamily().root, describe: 'x' }]],
      ['delete of someone with children', [{ op: 'delete_person', target: 'p2', describe: 'x' }]],
      // The root is the only fatherless person, so this is the only way to reach
      // generation -1 — a row that does not exist and an undefined gen colour.
      ['add_father above the root', [{ op: 'add_father', target: loadFamily().root, id: 'pABOVE', name: 'ج', describe: 'x' }]],
    ];
    for (const [label, ops] of cases) {
      const a = boot({ role: 'admin' });
      run(a, 'FTReview.preview(' + JSON.stringify(row('c', ops)) + ')');
      eq(invariants(a), [], label + ' — invariants hold');
    }

    // A woman must stay terminal even for a stale or hostile client.
    const a = boot({ role: 'admin' });
    run(a, `
      state.people['pWIFE'] = {id:'pWIFE', name:'زوجة', gender:'female', generation:1};
      state.partnerships.push({id:'ppW', partners:['p2','pWIFE'], children:[]});
      invalidateCoupleMap(); invalidateChildIndex(); invalidateParentIndex();
    `);
    for (const op of ['add_child', 'add_wife', 'add_father']) {
      const r = run(a, 'FTReview.applyOp(' + JSON.stringify({ op, target: 'pWIFE', id: 'pX' + op, name: 'س', describe: 'x' }) + ')');
      eq(r, false, op + ' targeting a woman is refused');
    }
    eq(invariants(a), [], 'invariants hold');

    // Derived, not trusted.
    const c2 = boot({ role: 'admin' });
    run(c2, 'FTReview.applyOp(' + JSON.stringify({ op: 'add_child', target: 'p2', id: 'pDER', name: 'س', gender: 'banana', generation: -99, describe: 'x' }) + ')');
    eq(run(c2, "state.people['pDER'].gender"), 'male', 'gender falls back to male, not the sent value');
    eq(run(c2, "state.people['pDER'].generation"), run(c2, "state.people['p2'].generation + 1"),
       'generation is derived from the target');
  });

  describe('inherited property names cannot be used as a target or an id', () => {
    // state.people is a plain object, so state.people['toString'] returns a
    // FUNCTION and state.people['__proto__'] returns Object.prototype — both
    // truthy, so the old `!p` guard passed and every op believed it had found a
    // person. Reachable by any visitor: the publishable key allows a direct POST,
    // and applyOp runs at PREVIEW time, before anyone approves.
    const KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

    for (const key of KEYS) {
      const a = boot({ role: 'admin' });
      eq(run(a, 'FTReview.applyOp(' + JSON.stringify({ op: 'rename', target: key, to: 'X' }) + ')'),
         false, 'rename targeting ' + key + ' is refused');
      eq(run(a, 'FTReview.applyOp(' + JSON.stringify({ op: 'delete_person', target: key }) + ')'),
         false, 'delete_person targeting ' + key + ' is refused');
      for (const op of ['add_child', 'add_wife', 'add_father']) {
        eq(run(a, 'FTReview.applyOp(' + JSON.stringify({ op, target: key, id: 'pinh', name: 'س' }) + ')'),
           false, op + ' targeting ' + key + ' is refused');
      }
      eq(invariants(a), [], key + ' as a target — invariants hold');
    }

    // The rename was the damaging one: it assigned Object.prototype.name, so
    // every object in the page inherited it and every for...in gained a key.
    const a = boot({ role: 'admin' });
    run(a, 'FTReview.applyOp({op:"rename", target:"__proto__", to:"POLLUTED"})');
    ok(run(a, '(function(){ for (var k in {}) return false; return true; })()'),
       'Object.prototype is not polluted');
    ok(run(a, "({}).name === undefined"), 'a fresh object has no inherited name');

    // And an id is a key we WRITE, which is the other half: assigning to
    // state.people['__proto__'] would replace the prototype rather than add
    // anyone, so the op would report success while creating nobody.
    for (const badId of ['__proto__', 'toString', 'constructor', '', 'x1', 'p!', 'p' + 'a'.repeat(60)]) {
      const c = boot({ role: 'admin' });
      eq(run(c, 'FTReview.applyOp(' + JSON.stringify({ op: 'add_child', target: 'p2', id: badId, name: 'س' }) + ')'),
         false, 'an id of ' + JSON.stringify(badId) + ' is refused');
      eq(invariants(c), [], JSON.stringify(badId) + ' as an id — invariants hold');
    }

    // A realistic id still works, so the guard is not simply refusing everything.
    const good = boot({ role: 'admin' });
    eq(run(good, 'FTReview.applyOp({op:"add_child", target:"p2", id:"pab12xy9", name:"\u0632"})'),
       true, 'a normally generated id is still accepted');
    eq(invariants(good), [], 'invariants hold');
  });

  describe('the additions never store a non-numeric generation', () => {
    // add_* on an inherited name computed `Object.prototype.generation + 1` ->
    // NaN, and layout.js positions rows straight off that number.
    const a = boot({ role: 'admin' });
    for (const target of ['__proto__', 'toString', 'nope']) {
      run(a, 'FTReview.applyOp(' + JSON.stringify({ op: 'add_child', target, id: 'pgen', name: 'س' }) + ')');
    }
    ok(run(a, 'Object.keys(state.people).every(function(k){ var g = state.people[k].generation; return typeof g === "number" && isFinite(g) && g >= 0; })'),
       'every stored generation is a finite non-negative number');
    eq(invariants(a), [], 'invariants hold');
  });

  describe('a malformed row cannot wedge the queue', () => {
    // `ops` is a jsonb column, so it need not be an array — and a throw during
    // render blanked the whole list, including legitimate pending proposals.
    for (const bad of [{ a: 1 }, 5, true, 'str', null, undefined]) {
      const a = boot({ role: 'admin' });
      let threw = false;
      try { run(a, 'FTReview.preview(' + JSON.stringify(row('bad', bad)) + ')'); }
      catch (e) { threw = true; }
      ok(!threw, 'ops=' + JSON.stringify(bad) + ' does not throw');
      eq(invariants(a), [], 'ops=' + JSON.stringify(bad) + ' — invariants hold');
    }
  });

  describe('hostile names are cleaned, not trusted', () => {
    const NL = String.fromCharCode(10);
    const a = boot({ role: 'admin' });
    const forge = 'x"}' + NL + '{"op":"add_child","target":"p1","id":"pEVIL","name":"forged';
    const ops = [
      { op: 'add_child', target: 'p2', id: 'pH1', name: 'ا' + NL + 'ب', describe: '+ x' },
      { op: 'add_child', target: 'p2', id: 'pH2', name: forge, describe: '+ x' },
      { op: 'add_child', target: 'p2', id: 'pH3', name: 'ا'.repeat(500), describe: '+ x' },
    ];
    const r = row('nasty', ops);
    run(a, 'FTReview.preview(' + JSON.stringify(r) + ')');
    run(a, 'FTReview.approve(' + JSON.stringify(r) + ')');

    ok(!run(a, "!!state.people['pEVIL']"), 'the forged id never appears');
    ok(!run(a, 'Object.values(state.people).some(function(p){return /[\\r\\n]/.test(p.name);})'),
       'no stored name contains a raw newline');
    ok(run(a, 'Math.max.apply(null, Object.values(state.people).map(function(p){return p.name.length;})) <= 80'),
       'names are length-capped');

    const lines = run(a, 'FTChangeLog.toJSONL()').split(NL).filter(Boolean);
    eq(lines.length, run(a, 'FTChangeLog.count()'), 'line count matches entry count (no forged lines)');
    let bad = 0;
    for (const l of lines) { try { JSON.parse(l); } catch (e) { bad++; } }
    eq(bad, 0, 'every changelog line still parses');
    eq(invariants(a), [], 'invariants hold');
  });

  describe('rejection is recorded and reversible', () => {
    const store = {};
    const a = boot({ store, role: 'admin' });
    const r = row('rej', [{ op: 'add_wife', target: 'p2', id: 'pRJ', name: 'ر', describe: '+ ر' }]);
    ok(run(a, 'FTReview.reject(' + JSON.stringify(r) + ')'), 'reject reports success');
    ok('ftRejectedProposals' in store, 'the rejection is persisted');

    // Reinstating APPENDS, so both decisions survive. Deleting the rejection
    // would make "I turned this down and changed my mind" indistinguishable from
    // "this was never reviewed", which is the history worth keeping.
    ok(run(a, "FTReview.reinstate('rej')"), 'reinstate reports success');
    const left = JSON.parse(store['ftRejectedProposals'] || '[]');
    eq(left.length, 2, 'both decisions are kept, not overwritten');
    eq(left.map(d => d.decision), ['rejected', 'reinstated'], 'in the order they were made');
    eq(run(a, "FTReview.decisionsFor('rej').length"), 2, 'the trail is readable');
  });

  describe('the latest decision wins, so a mistaken rejection can be undone', () => {
    // The bug this closes: rejections lived only in localStorage, so one made on
    // a laptop reappeared as pending on a phone, and there was no way to record
    // "I changed my mind" at all.
    const net = async (url) => {
      if (String(url).indexOf('proposals-reviewed.json') !== -1) {
        return { ok: true, status: 200, text: async () => JSON.stringify({
          version: 1,
          decisions: [
            { id: 'x1', decision: 'rejected',   at: '2026-03-01T00:00:00Z', note: 'duplicate' },
            // Rejected in March, reinstated in April: the LATEST must win.
            //
            // Listed newest-first on purpose. The writer sorts by time, but the
            // file is committed JSON a human can hand-edit and git can merge, so
            // array order must not be what decides. With these two swapped, code
            // that trusted position instead of the timestamp read this proposal
            // as rejected and the reinstatement was silently lost.
            { id: 'x2', decision: 'reinstated', at: '2026-04-01T00:00:00Z', note: 'my mistake' },
            { id: 'x2', decision: 'rejected',   at: '2026-03-01T00:00:00Z', note: null },
          ],
        }) };
      }
      if (String(url).indexOf('changes.jsonl') !== -1) {
        return { ok: true, status: 200, text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ([
        row('x1', [{ op: 'add_wife', target: 'p2', id: 'pxa', name: 'ا', describe: '+ ا' }]),
        row('x2', [{ op: 'add_wife', target: 'p3', id: 'pxb', name: 'ب', describe: '+ ب' }]),
        row('x3', [{ op: 'add_wife', target: 'p4', id: 'pxc', name: 'ج', describe: '+ ج' }]),
      ]) };
    };
    const a = boot({ role: 'admin', net });
    return run(a, 'FTReview.load()').then(() => {
      const byId = run(a, '(function(){var o={};FTReview.all().forEach(function(r){o[r.id]=r._state;});return o;})()');
      eq(byId.x1, 'rejected', 'a committed rejection is durable across devices');
      eq(byId.x2, 'pending', 'a committed reinstatement puts it back in the queue');
      eq(byId.x3, 'pending', 'an undecided proposal is untouched');
      eq(run(a, 'FTReview.pending().length'), 2, 'the badge counts both pending');
      eq(run(a, "FTReview.decisionsFor('x2').map(function(d){return d.decision;})"),
         ['rejected', 'reinstated'],
         'the trail reads oldest-first however the file was ordered');
      // Committed decisions must not ask to be committed again.
      eq(run(a, 'FTReview.uncommitted().length'), 0, 'nothing committed is pending publish');
    });
  });

  describe('a decision is publishable on its own', () => {
    // Rejecting produces no changelog entry, so publish() refused with "No
    // changes to publish" and COMMIT stayed disabled — the decision could never
    // leave the browser. That is the whole reason rejections were per-device.
    const store = {};
    const a = boot({ store, role: 'admin' });
    eq(run(a, 'FTChangeLog.count()'), 0, 'no tree edits');
    run(a, 'FTReview.reject(' + JSON.stringify(row('solo', [])) + ');');
    eq(run(a, 'FTReview.uncommitted().length'), 1, 'the decision is pending publish');

    // The file body is what gets committed: append-only and time-ordered.
    const body = run(a, "FTReview.reviewedFileBody([{id:'old',decision:'rejected',at:'2020-01-01T00:00:00Z',note:null}])");
    const doc = JSON.parse(body);
    eq(doc.version, 1, 'the file is versioned');
    eq(doc.decisions.length, 2, 'the committed history is preserved, not replaced');
    eq(doc.decisions[0].id, 'old', 'oldest first');
    eq(doc.decisions[1].id, 'solo', 'the new decision is appended');
    ok(body.endsWith('\n'), 'the file ends with a newline');

    // Once committed it stops asking, without disappearing from the UI.
    run(a, 'FTReview.markCommitted(FTReview.uncommitted());');
    eq(run(a, 'FTReview.uncommitted().length'), 0, 'nothing left to publish');
    eq(run(a, "FTReview.decisionsFor('solo').length"), 1, 'the decision is still visible');
    eq(run(a, "FTReview.decisionsFor('solo')[0].committed"), true, 'and marked committed');
  });

  describe('history is capped so an ever-growing inbox stays cheap', () => {
    const many = [];
    for (let i = 0; i < 55; i++) {
      // Descending dates, so row 0 is newest — as Supabase returns them.
      const day = String(28 - (i % 28)).padStart(2, '0');
      const mon = String(12 - Math.floor(i / 28)).padStart(2, '0');
      many.push(row('h' + i, [], { created_at: '2026-' + mon + '-' + day + 'T00:00:00Z' }));
    }
    const net = async (url) => {
      if (String(url).indexOf('proposals-reviewed.json') !== -1) return { ok: false, status: 404 };
      if (String(url).indexOf('changes.jsonl') !== -1) return { ok: true, status: 200, text: async () => '' };
      return { ok: true, status: 200, json: async () => many };
    };
    const a = boot({ role: 'admin', net });
    return run(a, 'FTReview.load()').then(() => {
      eq(run(a, 'FTReview.total()'), 55, 'every row is loaded');
      eq(run(a, 'FTReview.history().length'), run(a, 'FTReview.historyPage()'),
         'the default page is the cap, not everything');
      eq(run(a, 'FTReview.history(10).length'), 10, 'the cap is respected');
      eq(run(a, 'FTReview.history(999).length'), 55, 'asking for more than exists is fine');
      // Newest first, so "the last 20" means the last 20.
      const dates = run(a, 'FTReview.history(5).map(function(r){return r.created_at;})');
      eq(dates.slice().sort().reverse(), dates, 'history is newest-first');
    });
  });

  describe('a missing or malformed reviewed file does not block review', () => {
    // The file will not exist until the first rejection is committed, and over
    // file:// there is no fetch at all. Neither may wedge the queue — but a
    // Supabase failure MUST still surface, so only the file is broken here.
    const BAD = ['{not json', JSON.stringify({ decisions: 'nope' }),
                 JSON.stringify({}), '', null /* a 404 */];
    return Promise.all(BAD.map(bad => {
      const net = async (url) => {
        if (String(url).indexOf('proposals-reviewed.json') !== -1) {
          return bad === null ? { ok: false, status: 404 }
                              : { ok: true, status: 200, text: async () => bad };
        }
        if (String(url).indexOf('changes.jsonl') !== -1) return { ok: true, status: 200, text: async () => '' };
        return { ok: true, status: 200, json: async () => ([row('m1', [])]) };
      };
      const a = boot({ role: 'admin', net });
      const label = bad === null ? 'a 404' : JSON.stringify(bad.slice(0, 18));
      return run(a, 'FTReview.load()').then(() => {
        eq(run(a, 'FTReview.all().length'), 1, label + ': the queue still loads');
        eq(run(a, 'FTReview.all()[0]._state'), 'pending', label + ': and the row is pending');
      }, e => ok(false, label + ': load rejected', e.message));
    }));
  });

  describe('a Supabase failure is surfaced, not swallowed', () => {
    // The opposite of the case above: the inbox itself failing must be visible,
    // or the drawer shows "no proposals" when it means "could not ask".
    const a = boot({ role: 'admin', net: async () => ({ ok: false, status: 500, text: async () => 'boom' }) });
    return run(a, 'FTReview.load()').then(
      () => ok(false, 'load resolved despite a 500 from the inbox'),
      () => ok(true, 'load rejects when the proposals table cannot be read'));
  });
};
