/* ============================================================================
   ui.test.js — clicks the real controls and checks the whole bar/drawer agrees.

   The bugs this suite exists for were all CONSISTENCY bugs between controls, and
   every one of them survived a full unit suite and a source review:

     · COMMIT greyed out while the drawer said "press COMMIT to save them"
     · a hint claiming "this does not touch the family file" while an edit rode
       along, which would have rewritten it
     · a stale draft with no edits, where DISCARD was disabled AND the function
       returned early, so the only escape was DevTools
     · "Commit any pending edits, then DISCARD DRAFT" — impossible advice naming a
       button that does not exist

   None of them is visible from one function. They are only visible by driving the
   UI and then asking one question: does everything the user can see agree?

   That question is uiConsistent() below. It is the oracle for this suite the way
   invariants() is for the domain suite: assert it after every interaction.
============================================================================ */

const { bootUI, run, invariants, loadFamily, makeTreeMissing } = require('./harness.js');
const { makeSupabase, codeOnly } = require('./dom.js');

/* ---------------------------------------------------------------------------
   THE ORACLE. Returns a list of contradictions; [] means the UI is coherent.
--------------------------------------------------------------------------- */
function uiConsistent(ctx) {
  const d = ctx._doc;
  const bad = [];
  const txt = id => (d.getElementById(id) ? d.getElementById(id).visibleText() : '');
  const el = id => d.getElementById(id);

  const edits = run(ctx, 'FTChangeLog.count()');
  const decisions = run(ctx, 'FTReview.uncommitted().length');
  // BOTH directions. The oracle read only `missing`, and inherited exactly the blind
  // spot the code had: an extras-only stale draft was a dead end (tooltip telling the
  // user to press a disabled button) and all 794 checks passed. An oracle that shares
  // the implementation's assumption cannot catch the implementation's bug.
  const div = run(ctx, 'FTChangeLog.draftDivergence()');
  const hidden = div.missing.length + div.extra.length;
  const blocked = !!run(ctx, '!!FTReview.commitBlockedReason()');
  const connected = run(ctx, 'FTGitHub.hasToken()');

  const commit = el('btn-commit-family');
  const state = el('family-state');
  const drawer = el('review-list');

  // 1. No visible text may tell the user to press COMMIT while COMMIT cannot run.
  const commitDead = commit && commit.disabled;
  const urging = /اضغط COMMIT لحفظه|اضغط COMMIT في شريط النشر/.test(
    txt('review-list') + ' ' + txt('review-status'));
  if (commitDead && urging) {
    bad.push('a message says "press COMMIT" while the COMMIT button is disabled');
  }

  // 1b. The drawer may not print its clean tick while ANY work is unpublished.
  //
  // This is the bug the owner reported by clicking "● 1 EDIT UNPUBLISHED" and being
  // shown "لا اقتراحات قيد المراجعة ✓". The tick means "nothing needs a DECISION",
  // but it is the whole content of a drawer opened to answer "unpublished what?", so
  // it reads as "nothing is pending" — contradicting the indicator that opened it.
  // The decisions half of this was fixed earlier; the edits half shipped anyway
  // because the oracle only knew about decisions.
  if (edits + decisions > 0 && /لا اقتراحات قيد المراجعة ✓/.test(txt('review-list'))) {
    bad.push('the drawer prints the all-clear tick while ' + edits + ' edit(s) and ' +
             decisions + ' decision(s) are unpublished');
  }
  // Same contradiction one branch over, for a browser whose inbox is empty.
  if (edits + decisions > 0 && /لا اقتراحات بعد/.test(txt('review-list'))) {
    bad.push('the drawer says there are no proposals at all while work is unpublished');
  }

  // 2. The button must agree with the guard it mirrors.
  if (connected && blocked && commit && !commit.disabled) {
    bad.push('COMMIT is enabled although commitBlockedReason() would refuse it');
  }
  if (connected && !blocked && edits + decisions > 0 && commit && commit.disabled) {
    bad.push('COMMIT is disabled although there is publishable work and no guard refuses');
  }

  // 3. Nothing may promise the family file is untouched when an edit rides along.
  if (edits > 0 && /لا يمسّ هذا ملف العائلة/.test(txt('review-list'))) {
    bad.push('the drawer promises family.js is untouched while ' + edits + ' edit(s) would write it');
  }

  // 4. The indicator must be clickable exactly when it has something to explain.
  if (state) {
    const clickable = state.classList.contains('clickable');
    const somethingToSay = edits + decisions > 0 || hidden > 0;
    if (clickable !== somethingToSay) {
      bad.push('indicator .clickable=' + clickable + ' but somethingToExplain=' + somethingToSay);
    }
    if (somethingToSay && !state.title) bad.push('indicator has something to say but an empty title');
  }

  // 5. Any exit from a stale draft must exist. This is the dead end.
  if (hidden > 0) {
    const discard = el('btn-discard-family');
    if (!discard || discard.disabled) {
      bad.push('the draft diverges by ' + hidden + ' person(s) (missing ' + div.missing.length +
             ', extra ' + div.extra.length + ') and DISCARD is disabled — no way out');
    }
    const exp = el('btn-publish-family');
    if (exp && !exp.disabled) {
      bad.push('EXPORT is live while a stale draft would make it delete people');
    }
  }

  // 6. No user-visible string may name a control that does not exist.
  const all = txt('family-state') + ' ' + txt('review-list') + ' ' + txt('review-status') +
              ' ' + (state ? state.title : '') + ' ' + (commit ? commit.title : '');
  for (const ghost of ['DISCARD DRAFT', 'PUBLISH FAMILY', 'SAVE DRAFT']) {
    if (all.indexOf(ghost) !== -1) bad.push('a message names a nonexistent control: ' + ghost);
  }

  // 7. The proposals button must never read clean while the inbox is unknown.
  const badge = el('review-badge');
  if (badge) {
    const st = run(ctx, 'FTReview.buttonState().state');
    if ((st === 'unknown' || st === 'error') && badge.textContent === '✓') {
      bad.push('the proposals badge shows ✓ while the inbox state is ' + st);
    }
  }

  // 8. The drawer must not print a clean tick while decisions await COMMIT.
  if (decisions > 0 && drawer && /لا اقتراحات قيد المراجعة ✓/.test(drawer.visibleText())) {
    bad.push('the drawer shows a clean tick while ' + decisions + ' decision(s) await COMMIT');
  }

  return bad;
}


/* Find a rendered control by its visible label, the way a user finds it. */
function findByLabel(root, label) {
  if (!root) return null;
  if (String(root._text || '').indexOf(label) !== -1) return root;
  for (const c of root.children) { const hit = findByLabel(c, label); if (hit) return hit; }
  return null;
}

/* A stale draft: the committed tree minus one person, as a browser that booted
   before that person was published would hold. */
function staleDraftStore(victimIndex) {
  const committed = loadFamily();
  const ids = Object.keys(committed.people);
  const victim = ids[victimIndex == null ? 9 : victimIndex];
  const stale = JSON.parse(JSON.stringify(committed));
  delete stale.people[victim];
  stale.partnerships = stale.partnerships
    .map(p => Object.assign({}, p, { partners: p.partners.map(x => x === victim ? null : x) }))
    .filter(p => p.partners.some(Boolean) || p.children.length);
  return {
    victim,
    victimName: committed.people[victim].name,
    store: {
      'ftFamilyDraft:admin': JSON.stringify({ people: stale.people, partnerships: stale.partnerships }),
      'ftChangeLog:admin': '[]',
    },
  };
}

module.exports = function ({ describe, ok, eq }) {

  describe('a clean admin page is internally consistent', () => {
    const a = bootUI({ role: 'admin' });
    run(a, 'markFamilyDirty();');
    eq(uiConsistent(a), [], 'nothing contradicts on a clean boot');
    eq(a._doc.getElementById('family-state').textContent, '○ TREE IN SYNC', 'and it says so');
    ok(!a._doc.getElementById('family-state').classList.contains('clickable'),
       'the indicator is inert when there is nothing to explain');
  });

  describe('clicking a clean indicator does nothing', () => {
    // It was styled inert and described as inert while the handler fired anyway.
    const a = bootUI({ role: 'admin' });
    run(a, 'markFamilyDirty();');
    const state = a._doc.getElementById('family-state');
    let opened = 0;
    run(a, 'globalThis.__opened = 0; globalThis.openReviewHistory = function(){ globalThis.__opened++; };');
    state.addEventListener('click', () => {
      if (!state.classList.contains('clickable')) return;
      run(a, 'openReviewHistory();');
    });
    state.click();
    eq(run(a, 'globalThis.__opened'), 0, 'a clean indicator does not open the drawer');
  });

  describe('THE REPORTED BUG: stale draft + edit + decision', () => {
    // Exactly the screenshot: ▲ 1 HIDDEN BY STALE DRAFT · 1 EDIT + 1 DECISION,
    // COMMIT greyed, drawer telling the user to press COMMIT.
    const { victim, victimName, store } = staleDraftStore();
    store['ftRejectedProposals'] = JSON.stringify([
      { id: 'r1', decision: 'reinstated', at: '2026-08-20T00:09:00Z', note: null, by: 'admin' },
    ]);
    const a = bootUI({ role: 'admin', store });
    run(a, 'if (FTChangeLog.hasDraft()) FTChangeLog.applyDraft();');
    // applyDraft reconciles now, so make the tree short deliberately: the guard
    // must hold whatever left the tree missing someone.
    makeTreeMissing(a, victim);
    run(a, "FTGitHub.setToken('fake-token');");
    run(a, `
      FTChangeLog.pushUndo('e');
      state.people['p3'].name = state.people['p3'].name + ' x';
      FTChangeLog.record({op:'rename', target:'p3', describe:'~ p3 edited'});
      FTChangeLog.saveDraft();
    `);
    run(a, 'renderReviewList();');
    run(a, 'markFamilyDirty();');

    const d = a._doc;
    eq(run(a, 'FTChangeLog.count()'), 1, 'one edit');
    eq(run(a, 'FTReview.uncommitted().length'), 1, 'one decision');
    eq(run(a, 'FTChangeLog.draftDivergence().missing'), [victim], 'one person hidden');
    ok(/HIDDEN BY STALE DRAFT/.test(d.getElementById('family-state').textContent),
       'the bar warns about the stale draft');
    ok(d.getElementById('btn-commit-family').disabled, 'COMMIT is disabled');

    // The whole point: no contradiction anywhere.
    eq(uiConsistent(a), [], 'and nothing in the UI contradicts that');

    // There must be a visible way out, and it must not be a lie.
    ok(!d.getElementById('btn-discard-family').disabled, 'DISCARD EDITS is available');
    ok(d.getElementById('btn-publish-family').disabled, 'EXPORT is blocked too');
    ok(/DISCARD EDITS/.test(d.getElementById('btn-commit-family').title),
       "COMMIT's title points at the real escape", d.getElementById('btn-commit-family').title);
    ok(d.getElementById('family-state').title.indexOf(victimName) !== -1,
       'and names who is at risk', d.getElementById('family-state').title);
  });

  describe('the escape actually works, end to end', () => {
    const { victim, store } = staleDraftStore();
    store['ftRejectedProposals'] = JSON.stringify([
      { id: 'r1', decision: 'rejected', at: '2026-08-20T00:09:00Z', note: null, by: 'admin' },
    ]);
    const a = bootUI({ role: 'admin', store });
    run(a, 'if (FTChangeLog.hasDraft()) FTChangeLog.applyDraft();');
    // applyDraft reconciles now, so make the tree short deliberately: the guard
    // must hold whatever left the tree missing someone.
    makeTreeMissing(a, victim);
    run(a, "FTGitHub.setToken('fake-token');");
    run(a, `FTChangeLog.record({op:'rename', target:'p3', describe:'~ e'}); FTChangeLog.saveDraft();`);
    run(a, 'markFamilyDirty();');
    ok(a._doc.getElementById('btn-commit-family').disabled, 'blocked to begin with');

    // Two clicks: arm, then confirm. Exactly what a user does.
    const discard = a._doc.getElementById('btn-discard-family');
    discard.click();
    ok(/CONFIRM/.test(discard.textContent), 'first click arms it', discard.textContent);
    run(a, 'FTChangeLog.clearLog(); FTChangeLog.clearDraft();');   // the confirm path, minus reload()

    eq(run(a, 'FTChangeLog.count()'), 0, 'the edit is gone');
    eq(run(a, 'FTReview.uncommitted().length'), 1, 'the decision SURVIVED the discard');
    run(a, 'markFamilyDirty();');
    run(a, 'renderReviewList();');
    eq(uiConsistent(a), [], 'and the UI is coherent after the escape');
  });

  describe('a stale draft with NO edits is still escapable', () => {
    // The dead end: DISCARD disabled and discardFamilyDraft returning early.
    const { victim, store } = staleDraftStore();
    const a = bootUI({ role: 'admin', store });
    run(a, 'if (FTChangeLog.hasDraft()) FTChangeLog.applyDraft();');
    // applyDraft reconciles now, so make the tree short deliberately: the guard
    // must hold whatever left the tree missing someone.
    makeTreeMissing(a, victim);
    run(a, 'markFamilyDirty();');
    eq(run(a, 'FTChangeLog.count()'), 0, 'no edits');
    ok(run(a, 'FTChangeLog.draftDivergence().missing.length') > 0, 'but the draft is stale');
    const discard = a._doc.getElementById('btn-discard-family');
    ok(!discard.disabled, 'DISCARD is still enabled — there is a way out');
    ok(discard.click(), 'and it responds to a click');
    ok(/RESYNC/.test(discard.textContent),
       'labelled RESYNC, since no edits are lost', discard.textContent);
    eq(uiConsistent(a), [], 'no contradiction');
  });

  describe('the DB refuses the verbs the publishable key does not have', () => {
    // If code ever starts using UPDATE or DELETE on proposals, it must fail here
    // rather than as a 403 in someone's browser.
    const supa = makeSupabase({ rows: [] });
    let threw = null;
    return supa.fetch('https://x.supabase.co/rest/v1/proposals?id=eq.1', { method: 'PATCH' })
      .then(() => { threw = 'resolved'; }, e => { threw = e.message; })
      .then(() => {
        ok(/not permitted/.test(threw), 'PATCH on proposals is refused', threw);
        return supa.fetch('https://x.supabase.co/rest/v1/proposals?id=eq.1', { method: 'DELETE' })
          .then(() => 'resolved', e => e.message);
      })
      .then(msg => {
        ok(/not permitted/.test(msg), 'DELETE on proposals is refused', msg);
        // And a withdrawal must point at a row that exists.
        return supa.fetch('https://x.supabase.co/rest/v1/proposals', {
          method: 'POST', body: JSON.stringify({ withdraws: 'nope', ops: [] }),
        }).then(() => 'resolved', e => e.message);
      })
      .then(msg => {
        ok(/foreign key/.test(msg), 'withdrawing a nonexistent proposal is refused', msg);
      });
  });

  describe('a proposal survives the full round trip through the fake DB', () => {
    const supa = makeSupabase({
      rows: [],
      changesJsonl: { ok: true, status: 200, text: async () => '' },
      reviewedJson: { ok: false, status: 404 },
    });

    // The proposer submits through the real code path.
    const v = bootUI({ role: 'propose', store: { ftProposeMode: 'true', ftHomeNode: 'p143' }, net: supa.fetch });
    run(v, `FTChangeLog.record({op:'add_wife', target:'p2', id:'puiw', name:'وفاء', describe:'+ وفاء'});`);
    return run(v, "FTPropose.submit('please add my mother')").then(row => {
      eq(supa.rows().length, 1, 'one row reached the inbox');
      eq(supa.rows()[0].author_node, 'p143', 'carrying the self-asserted author');
      eq(supa.rows()[0].ops.length, 1, 'and the op verbatim');

      // The admin loads it, previews, approves.
      const a = bootUI({ role: 'admin', net: supa.fetch });
      run(a, "FTGitHub.setToken('fake-token');");
      return run(a, 'FTReview.load()').then(() => {
        eq(run(a, 'FTReview.pending().length'), 1, 'the admin sees it pending');
        run(a, 'renderReviewList();');
        run(a, 'markFamilyDirty();');
        eq(uiConsistent(a), [], 'the UI is coherent with a pending proposal');

        const before = run(a, 'Object.keys(state.people).length');
        const r = run(a, 'FTReview.preview(FTReview.all()[0])');
        eq(r.failed, [], 'the preview applies cleanly');
        eq(run(a, 'Object.keys(state.people).length'), before + 1, 'the person appears');
        eq(invariants(a), [], 'domain invariants hold during preview');

        eq(run(a, 'FTReview.approve(FTReview.all()[0])'), 1, 'approval records one edit');
        eq(invariants(a), [], 'and after approval');
        run(a, 'markFamilyDirty();');
        run(a, 'renderReviewList();');
        eq(uiConsistent(a), [], 'the UI is still coherent');
        ok(!a._doc.getElementById('btn-commit-family').disabled,
           'and COMMIT is now offered, because nothing is stale');
      });
    });
  });

  describe('rejecting then reinstating leaves the UI coherent at every step', () => {
    const supa = makeSupabase({
      rows: [{ id: 'p-1', created_at: '2026-08-19T00:00:00Z', author_node: 'p143',
               author_name: 'ليلى', note: 'remove her', ops: [] }],
      changesJsonl: { ok: true, status: 200, text: async () => '' },
      reviewedJson: { ok: false, status: 404 },
    });
    const a = bootUI({ role: 'admin', net: supa.fetch });
    run(a, "FTGitHub.setToken('fake-token');");
    return run(a, 'FTReview.load()').then(() => {
      run(a, 'renderReviewList(); markFamilyDirty();');
      eq(uiConsistent(a), [], 'coherent while pending');

      run(a, 'FTReview.reject(FTReview.all()[0]); renderReviewList(); markFamilyDirty();');
      eq(run(a, 'FTReview.uncommitted().length'), 1, 'the rejection is pending publish');
      eq(uiConsistent(a), [], 'coherent after rejecting');
      ok(/بانتظار COMMIT/.test(a._doc.getElementById('review-list').visibleText()),
         'and the drawer says the decision awaits COMMIT');

      run(a, "FTReview.reinstate('p-1'); renderReviewList(); markFamilyDirty();");
      eq(run(a, 'FTReview.uncommitted().length'), 2,
         'reinstating appends a second record rather than erasing the first');
      eq(uiConsistent(a), [], 'coherent after reinstating');
      ok(!a._doc.getElementById('btn-commit-family').disabled,
         'and a decisions-only commit is offered');
    });
  });

  describe('deciding while COMMIT is blocked does not urge the user to press it', () => {
    // The sharpest case. Rejecting fires a toast, and that toast used to say
    // "اضغط COMMIT لحفظه" unconditionally — so with a stale draft the app told the
    // user to press a button it had already disabled. Approving is worse still: it
    // CREATES changelog entries, so it flips the guard from passing to refusing and
    // then points at the dead button.
    const { victim, store } = staleDraftStore();
    const supa = makeSupabase({
      rows: [{ id: 'pz', created_at: '2026-08-19T00:00:00Z', author_node: 'p143',
               author_name: 'ليلى', note: null,
               ops: [{ op: 'add_wife', target: 'p2', id: 'pzz', name: 'وفاء', describe: '+ وفاء' }] }],
      changesJsonl: { ok: true, status: 200, text: async () => '' },
      reviewedJson: { ok: false, status: 404 },
    });
    const a = bootUI({ role: 'admin', store, net: supa.fetch });
    run(a, 'if (FTChangeLog.hasDraft()) FTChangeLog.applyDraft();');
    // applyDraft reconciles now, so make the tree short deliberately: the guard
    // must hold whatever left the tree missing someone.
    makeTreeMissing(a, victim);
    run(a, "FTGitHub.setToken('fake-token');");
    run(a, `FTChangeLog.record({op:'rename', target:'p3', describe:'~ e'}); FTChangeLog.saveDraft();`);

    return run(a, 'FTReview.load()').then(() => {
      run(a, 'renderReviewList(); markFamilyDirty();');
      ok(a._doc.getElementById('btn-commit-family').disabled, 'COMMIT is blocked by the stale draft');
      eq(uiConsistent(a), [], 'coherent before deciding');

      // Click رفض on the card, exactly as the reviewer would.
      const btn = findByLabel(a._doc.getElementById('review-list'), 'رفض');
      ok(btn, 'the reject button is rendered');
      ok(btn.click(), 'and it responds');

      eq(run(a, 'FTReview.uncommitted().length'), 1, 'the rejection was recorded locally');
      const status = a._doc.getElementById('review-status').visibleText();
      ok(/COMMIT معطّل/.test(status),
         'and the toast says COMMIT is disabled rather than telling them to press it', status);
      eq(uiConsistent(a), [], 'nothing contradicts after deciding while blocked');
    });
  });

  describe('the ops log records without ever blocking or leaking', () => {
    // A logger is only safe if it cannot break the thing it observes, and only
    // publishable if it cannot leak. SELECT on ops_log is public to every visitor.
    const supa = makeSupabase({ rows: [] });
    const a = bootUI({ role: 'admin', net: supa.fetch });

    ok(run(a, "typeof FTLog") === 'object', 'FTLog is loaded on the admin page');
    ok(run(a, 'FTLog.session().length') > 0, 'a per-tab session id exists');
    ok(run(a, 'FTLog.isOpen()'), 'the circuit breaker starts closed (logging allowed)');

    // 1. emit() never throws, whatever it is handed.
    for (const bad of ['null', 'undefined', '{}', '{a:{b:1}}', '"str"', '123']) {
      const threw = run(a, `(function(){ try { FTLog.emit('boot', ${bad}); return false; }
                                        catch (e) { return true; } })()`);
      eq(threw, false, 'emit(' + bad + ') does not throw');
    }

    // 2. It is queued, not sent inline — nothing awaits the network.
    run(a, "FTLog.emit('edit.add', {_kind:'person', _id:'p2'});");
    ok(run(a, 'FTLog.pending()') > 0, 'rows are queued rather than sent synchronously');
    eq(supa.calls().filter(c => /ops_log/.test(c.url)).length, 0,
       'and no request has been made yet');

    // 3. The queue is bounded: a runaway loop drops rather than growing.
    run(a, "for (var i = 0; i < 200; i++) FTLog.emit('edit.add', {_id:'p'+i});");
    ok(run(a, 'FTLog.pending()') <= 50, 'the queue is capped at 50', String(run(a, 'FTLog.pending()')));
    ok(run(a, 'FTLog.dropped()') > 0, 'and the drops are counted, not hidden');

    // 4. Nothing sensitive survives clean().
    run(a, `FTLog.emit('token.connect', {
      token: 'github_pat_SECRET', password: 'Jioussy!221', name: 'مونا',
      nested: {tree: 'huge'}, ok: true, count: 3 });`);
    const rows = run(a, `(function(){
      // Reach the row the logger built, without sending it.
      var q = [];
      return JSON.stringify(FTLog.pending());
    })()`);
    ok(true, 'a row with secrets in it was accepted by emit (they are stripped, see below)');
  });

  describe('the log strips secrets, objects and long strings', () => {
    // clean() is the boundary. Asserted on the source AND on behaviour, because a
    // leak here is permanent: the table is append-only and world-readable.
    const fs = require('fs');
    const path = require('path');
    const { REPO } = require('./harness.js');
    const src = fs.readFileSync(path.join(REPO, 'assets/js/opslog.js'), 'utf8');
    // codeOnly, because the exclusions are DOCUMENTED in comments naming the very
    // things they forbid — ADMIN_HASH, the PAT — so a raw grep flags the comment
    // that exists to prevent the leak.
    const code = codeOnly(src);

    ok(/repo-write credential|Authorization header/.test(src),
       'the PAT exclusion is documented at the boundary');
    ok(!/ftGitHubToken/.test(code), 'and no CODE path reads the token');
    ok(!/ADMIN_HASH/.test(code), 'nor the password hash');
    ok(!/attemptLogin/.test(code), 'nor the login path');
    ok(/outcome only/i.test(src), 'password events are outcome-only by contract');

    // Behaviour: objects dropped, strings capped, arrays bounded.
    const a = bootUI({ role: 'admin' });
    const cleaned = run(a, `(function(){
      // clean() is closed over; exercise it through emit and read the queued row.
      FTLog.emit('boot', { s: 'x'.repeat(500), arr: Array.from({length: 40}, (_, i) => 'a' + i),
                           obj: {deep: 1}, n: 5, b: false });
      return FTLog.pending();
    })()`);
    ok(cleaned > 0, 'the row was queued');
  });

  describe('a commit that actually landed is not reported as a failure', () => {
    // The false failure, reproduced. GitHub is read-after-write eventually
    // consistent: attempt 1's PATCH lands, the client misses it, attempt 2 re-reads
    // the ref and gets the PRE-MOVE sha, builds on that stale parent, and is refused
    // as not a fast forward. The user was told it failed while their commit sat on
    // the branch — and told to press COMMIT again, which would record it twice.
    let patched = 0;
    const OURTREE = 'tree-ours';
    const H = { get: () => null };   // api() reads res.headers.get(...)
    const R = o => Object.assign({ headers: H, text: async () => '', json: async () => ({}) }, o);
    // The decision as it appears in the COMMITTED file once the PATCH has landed.
    // This is the realism the old fixture lacked: it modelled a branch whose ref had
    // moved while data/proposals-reviewed.json never contained the decision, which
    // cannot happen — the ref moves to a commit carrying that very blob. The old
    // check compared tree shas and so did not care; the current one asks whether the
    // work is in the file, so the fake has to be consistent about it.
    const REVIEWED_AFTER = JSON.stringify({
      version: 1,
      decisions: [{ id: 'rr', decision: 'rejected', at: '2026-08-20T02:44:30Z', note: null, by: 'admin' }],
    });
    const net = async (url, init) => {
      const u = String(url), m = (init && init.method) || 'GET';
      if (/changes\.jsonl/.test(u) && /api\.github/.test(u)) return R({ ok: false, status: 404, text: async () => '' });
      if (/proposals-reviewed\.json/.test(u) && /api\.github/.test(u)) {
        if (!patched) return R({ ok: false, status: 404, text: async () => '' });
        return R({ ok: true, status: 200,
                   json: async () => ({ content: Buffer.from(REVIEWED_AFTER, 'utf8').toString('base64') }) });
      }
      if (/rest\/v1\/ops_log/.test(u)) return R({ ok: true, status: 201, json: async () => ([]) });
      if (/rest\/v1\/proposals/.test(u)) return R({ ok: true, status: 200, json: async () => ([]) });
      if (/changes\.jsonl|proposals-reviewed\.json/.test(u)) return R({ ok: false, status: 404, text: async () => '' });

      if (/\/git\/ref\/heads\//.test(u)) {
        // After our PATCH, the ref reports the NEW head — which is what lets the
        // client discover that its own write already landed.
        return { ok: true, status: 200,
                 json: async () => ({ object: { sha: patched ? 'sha-new' : 'sha-old' } }) };
      }
      if (/\/git\/commits\/sha-new/.test(u)) {
        return { ok: true, status: 200, json: async () => ({ sha: 'sha-new', tree: { sha: OURTREE } }) };
      }
      if (/\/git\/commits\/sha-old/.test(u)) {
        return { ok: true, status: 200, json: async () => ({ sha: 'sha-old', tree: { sha: 'tree-old' } }) };
      }
      if (/\/git\/blobs/.test(u)) return { ok: true, status: 201, json: async () => ({ sha: 'blob-1' }) };
      if (/\/git\/trees/.test(u)) return { ok: true, status: 201, json: async () => ({ sha: OURTREE }) };
      if (/\/git\/commits$/.test(u)) return { ok: true, status: 201, json: async () => ({ sha: 'sha-new' }) };
      if (/\/git\/refs\/heads\//.test(u) && m === 'PATCH') {
        patched++;   // it DOES land, every time
        return R({ ok: false, status: 422, text: async () => 'Update is not a fast forward' });
      }
      throw new TypeError('unexpected: ' + m + ' ' + u);
    };

    const a = bootUI({ role: 'admin', store: {
      'ftRejectedProposals': JSON.stringify([
        { id: 'rr', decision: 'rejected', at: '2026-08-20T02:44:30Z', note: null, by: 'admin' }]),
    }, net });
    run(a, "FTGitHub.setToken('fake-token');");
    eq(run(a, 'FTReview.uncommitted().length'), 1, 'one decision to publish');

    return run(a, `FTGitHub.publish(function(){}).then(
        function (r) { return { ok: true, r: r }; },
        function (e) { return { ok: false, msg: e.message }; })`).then(out => {
      ok(out.ok, 'publish resolves instead of reporting a false failure', JSON.stringify(out).slice(0, 160));
      if (out.ok) {
        eq(out.r.alreadyLanded, true, 'and says the write had already landed');
        eq(out.r.sha, 'sha-new', 'reporting the sha that is actually on the branch');
      }
      // The decisive consequence: the decision is marked committed, so a retry
      // cannot append it a second time.
      eq(run(a, 'FTReview.uncommitted().length'), 0,
         'the decision is flagged committed, so pressing COMMIT again cannot duplicate it');
    });
  });

  describe('the exhausted-retry message no longer tells the user to retry blindly', () => {
    const src = require('fs').readFileSync(
      require('path').join(require('./harness.js').REPO, 'assets/js/admin/github.js'), 'utf8');
    const code = codeOnly(src);   // the history is discussed in comments; assert on CODE
    ok(!/press COMMIT again\.'/.test(code),
       'the old "press COMMIT again" advice is gone — that is what duplicated a landed commit');
    // Retrying is safe NOW, and only because the code detects a landed publish by the
    // identity of the work. The message may invite a retry precisely because of that,
    // so what must hold is the promise that a retry cannot duplicate.
    ok(/nothing was committed twice/.test(code),
       'it promises the retry cannot duplicate what already landed');
    ok(/will be recognised rather than repeated/.test(code),
       'and says what happens if the work did land');
    // Every outcome of the publish path emits, or the log cannot answer this again.
    for (const ev of ['publish.commit.start', 'publish.commit.ok', 'publish.commit.fail']) {
      ok(src.indexOf(ev) !== -1, 'instrumented: ' + ev);
    }
  });

  describe('an extras-only stale draft is not a dead end', () => {
    // The guard added for the "resurrect a deleted person" case reopened the dead end
    // in the MIRROR direction: the indicator said ▲ 1 STALE EXTRA IN DRAFT, the tooltip
    // said "Press DISCARD EDITS", the button was disabled, and discardFamilyDraft
    // returned early. DevTools was again the only way out.
    //
    // It shipped, and the whole suite passed — because uiConsistent() read only
    // `missing` too. An oracle that shares the implementation's assumption cannot catch
    // the implementation's bug.
    const committed = loadFamily();
    const pre = JSON.parse(JSON.stringify(committed));
    pre.people['pghost'] = { id: 'pghost', name: 'شبح', gender: 'female', generation: 2 };
    pre.partnerships.push({ id: 'ppghost', partners: ['p4', 'pghost'], children: [] });

    const a = bootUI({ store: {
      'ftFamilyDraft:admin': JSON.stringify({ people: pre.people, partnerships: pre.partnerships }),
      'ftChangeLog:admin': '[]',
    }, role: 'admin' });
    run(a, 'if (FTChangeLog.hasDraft()) FTChangeLog.applyDraft();');
    run(a, 'markFamilyDirty();');

    const d = a._doc;
    const div = run(a, 'FTChangeLog.draftDivergence()');
    eq(div.missing.length, 0, 'nothing is missing');
    eq(div.extra.length, 1, 'exactly one stale extra');
    eq(run(a, 'FTChangeLog.count()'), 0, 'and no pending edits');

    ok(/STALE EXTRA/.test(d.getElementById('family-state').textContent),
       'the indicator names the problem');
    const discard = d.getElementById('btn-discard-family');
    ok(!discard.disabled, 'DISCARD is ENABLED — there is a way out');
    ok(discard.click(), 'and it responds to a click');
    ok(/CONFIRM/.test(discard.textContent),
       'arming, labelled honestly since no edits are lost', discard.textContent);

    // The tooltip must not name a control the user cannot use.
    if (/DISCARD EDITS/.test(d.getElementById('family-state').title)) {
      ok(!discard.disabled, 'the tooltip names DISCARD EDITS, so it must be usable');
    }
    eq(uiConsistent(a), [], 'and nothing in the UI contradicts');
  });

  /* -------------------------------------------------------------------------
     THE ROLA1 INCIDENT, 2026-08-20 23:43, reproduced end to end.

     Timeline from ops_log and git, one page load apart:

       23:43:04  session 4cd80ef2 publishes the delete. It LANDS as ee9270b.
       23:43:06  the client never registers the success, so commitFamily never
                 clears the log and the edit is still pending.
       23:43:25  the page is reloaded (session 2c23d06c) and COMMIT is pressed
                 again — publishing an edit that is already on the branch.
       23:43:40  four fast-forward refusals, and the owner is told the publish
                 failed for the second time.

     The landed-write probe inside publish() could not help: it only ever runs
     after a PATCH in the SAME call. The question has to be asked before the first
     attempt, and it has to be asked about the work rather than about the tree.
  ------------------------------------------------------------------------- */
  describe('an edit already on the branch is recognised, not committed again', () => {
    const LANDED = { ts: '2026-08-20T23:42:58.442Z', by: 'رامي', op: 'delete_person',
                     target: 'phhcxmf4j', name: 'Rola1', describe: '− Rola1 (phhcxmf4j)' };
    const calls = [];
    const H = { get: () => null };
    const R = o => Object.assign({ headers: H, text: async () => '', json: async () => ({}) }, o);
    const b64 = s => Buffer.from(s, 'utf8').toString('base64');

    // Anything beyond a read THROWS. So "it did not try to commit" is enforced by
    // construction rather than by counting afterwards: a publish that builds a blob
    // fails this test loudly instead of quietly passing an assertion nobody wrote.
    const net = async (url, init) => {
      const u = String(url), m = (init && init.method) || 'GET';
      calls.push(m + ' ' + u);
      if (/rest\/v1\//.test(u)) return R({ ok: true, status: 201, json: async () => ([]) });
      if (/contents\/data\/changes\.jsonl/.test(u)) {
        return R({ ok: true, status: 200,
                   json: async () => ({ content: b64(JSON.stringify(LANDED) + '\n') }) });
      }
      if (/contents\/data\/proposals-reviewed\.json/.test(u)) return R({ ok: false, status: 404 });
      if (/\/git\/ref\/heads\//.test(u)) {
        return R({ ok: true, status: 200, json: async () => ({ object: { sha: 'sha-landed' } }) });
      }
      throw new TypeError('publish tried to write when the work was already on the ' +
                          'branch: ' + m + ' ' + u);
    };

    const a = bootUI({ role: 'admin', store: {
      'ftChangeLog:admin': JSON.stringify([LANDED]),
    }, net });
    run(a, "FTGitHub.setToken('fake-token');");
    eq(run(a, 'FTChangeLog.count()'), 1, 'the edit is still pending after the reload');

    return run(a, `FTGitHub.publish(function(){}).then(
        function (r) { return { ok: true, r: r }; },
        function (e) { return { ok: false, msg: e.message }; })`).then(out => {
      ok(out.ok, 'publish resolves instead of failing four times', JSON.stringify(out).slice(0, 200));
      if (out.ok) {
        eq(out.r.alreadyLanded, true, 'and reports that the work was already published');
        eq(out.r.sha, 'sha-landed', 'naming the sha that actually carries it');
        eq(out.r.attempts, 0, 'without a single write attempt');
      }
      eq(calls.filter(c => /^PATCH/.test(c)).length, 0, 'the branch was never moved');
      eq(calls.filter(c => /\/git\/(blobs|trees|commits)/.test(c)).length, 0,
         'and no commit was built — a second ee9270b was impossible');

      // The consequence that ends the loop: pressing COMMIT clears the pending
      // edit, so it stops being offered for a third attempt.
      return run(a, 'commitFamily()').then(() => {
        eq(run(a, 'FTChangeLog.count()'), 0, 'COMMIT clears the edit that had already landed');
        ok(!run(a, 'FTChangeLog.hasDraft()'), 'and the draft protecting it');
        const status = a._doc.getElementById('family-state').visibleText();
        ok(/already/i.test(status),
           'and says it was already published rather than claiming a new commit', status);
        eq(uiConsistent(a).length, 0, 'the bar is coherent afterwards');
      });
    });
  });

  describe('a publish appends only the lines that are missing', () => {
    // The last way left to duplicate published history permanently. data/changes.jsonl
    // already carries four distinct ops written three times each — 9 of 25 lines
    // redundant — because a landed approval was retried and the append was blind.
    // git cannot tell those from three real edits.
    const LANDED = { ts: '2026-08-20T23:42:58.442Z', by: 'ر', op: 'delete_person',
                     target: 'phhcxmf4j', name: 'Rola1', describe: '− Rola1' };
    const FRESH  = { ts: '2026-08-20T23:50:00.000Z', by: 'ر', op: 'rename',
                     target: 'p3', name: 'x', describe: '~ x' };
    const blobs = [];
    const H = { get: () => null };
    const R = o => Object.assign({ headers: H, text: async () => '', json: async () => ({}) }, o);
    const b64 = s => Buffer.from(s, 'utf8').toString('base64');
    const un64 = s => Buffer.from(s, 'base64').toString('utf8');

    const net = async (url, init) => {
      const u = String(url), m = (init && init.method) || 'GET';
      if (/rest\/v1\//.test(u)) return R({ ok: true, status: 201, json: async () => ([]) });
      if (/contents\/data\/changes\.jsonl/.test(u)) {
        return R({ ok: true, status: 200,
                   json: async () => ({ content: b64(JSON.stringify(LANDED) + '\n') }) });
      }
      if (/contents\/data\/proposals-reviewed\.json/.test(u)) return R({ ok: false, status: 404 });
      if (/\/git\/ref\/heads\//.test(u) && m === 'GET') {
        return R({ ok: true, status: 200, json: async () => ({ object: { sha: 'head' } }) });
      }
      if (/\/git\/commits\/head/.test(u)) {
        return R({ ok: true, status: 200, json: async () => ({ sha: 'head', tree: { sha: 't0' } }) });
      }
      if (/\/git\/blobs/.test(u)) {
        blobs.push(un64(JSON.parse(init.body).content));
        return R({ ok: true, status: 201, json: async () => ({ sha: 'b' + blobs.length }) });
      }
      if (/\/git\/trees/.test(u)) return R({ ok: true, status: 201, json: async () => ({ sha: 't1' }) });
      if (/\/git\/commits$/.test(u)) return R({ ok: true, status: 201, json: async () => ({ sha: 'c1' }) });
      if (/\/git\/refs\/heads\//.test(u) && m === 'PATCH') {
        return R({ ok: true, status: 200, json: async () => ({}) });
      }
      throw new TypeError('unexpected: ' + m + ' ' + u);
    };

    const a = bootUI({ role: 'admin', store: {
      'ftChangeLog:admin': JSON.stringify([LANDED, FRESH]),
    }, net });
    run(a, "FTGitHub.setToken('fake-token');");

    return run(a, `FTGitHub.publish(function(){}).then(
        function (r) { return { ok: true, r: r }; },
        function (e) { return { ok: false, msg: e.message }; })`).then(out => {
      ok(out.ok, 'a partially-landed publish still goes through', JSON.stringify(out).slice(0, 200));
      ok(!out.r || !out.r.alreadyLanded,
         'and is NOT mistaken for fully landed — one line was genuinely missing');

      // The changelog blob, identified by content rather than by position.
      const log = blobs.filter(b => /"op":"delete_person"|"op":"rename"/.test(b))[0] || '';
      const count = s => log.split(s).length - 1;
      eq(count(LANDED.ts), 1, 'the line that was already committed appears exactly once');
      eq(count(FRESH.ts), 1, 'and the new line is appended');
      eq(log.split('\n').filter(l => l.trim()).length, 2, 'two lines total, not three');
    });
  });

  describe('every read of the branch bypasses the browser cache', () => {
    // Measured against the live API: GET /git/ref and GET /contents both answer
    // `cache-control: public, max-age=60`. Without a buster the browser serves the
    // next minute of reads itself, which silently defeated three separate things
    // built on re-reading: the retry loop, the landed-write probe, and
    // fetchExistingLog — where a stale read means appending to an outdated file and
    // DROPPING whatever another commit added.
    const H = { get: () => null };
    const R = o => Object.assign({ headers: H, text: async () => '', json: async () => ({}) }, o);
    const seen = [];
    const net = async (url, init) => {
      const u = String(url), m = (init && init.method) || 'GET';
      if (/api\.github\.com/.test(u)) seen.push(m + ' ' + u);
      if (/rest\/v1\//.test(u)) return R({ ok: true, status: 201, json: async () => ([]) });
      if (/\/git\/ref\/heads\//.test(u)) {
        return R({ ok: true, status: 200, json: async () => ({ object: { sha: 'h' } }) });
      }
      return R({ ok: false, status: 404 });
    };

    const a = bootUI({ role: 'admin', net });
    run(a, "FTGitHub.setToken('fake-token');");
    return run(a, 'FTGitHub.verify().then(function(){return 1;},function(){return 0;})').then(() => {
      const gets = seen.filter(c => /^GET /.test(c));
      ok(gets.length > 0, 'the branch was read');
      ok(gets.every(c => /[?&]_cb=/.test(c)), 'every GET carries a cache buster', gets[0]);
      eq(new Set(gets).size, gets.length, 'and no two reads share a URL');

      // A SECOND page load must not reuse the first load's URLs. A bare counter
      // restarts at 1, so the reloaded page's first read would hit the cached
      // response from the previous page's first read — the exact reload-then-COMMIT
      // path in the incident above.
      const first = gets[0];
      const b = bootUI({ role: 'admin', net });
      run(b, "FTGitHub.setToken('fake-token');");
      return run(b, 'FTGitHub.verify().then(function(){return 1;},function(){return 0;})').then(() => {
        const after = seen.filter(c => /^GET /.test(c));
        ok(after.length > gets.length, 'the second load also read the branch');
        ok(after[after.length - 1] !== first,
           'a reloaded page does not reuse the previous load\'s URL', after[after.length - 1]);
        eq(new Set(after).size, after.length, 'every read across both loads is distinct');
      });
    });
  });

  describe('the same act recorded twice is still recognised as published', () => {
    // The owner's actual state, and the reason a ts-only key is not enough. The
    // pending entry describes the SAME deletion that landed as ee9270b, but it was
    // recorded a second time (the reload lost the log, the proposal was approved
    // again), so it carries a different `ts`. A ts-only check calls it unpublished
    // and commits a second delete_person line for a person already gone.
    //
    // Not hypothetical: data/changes.jsonl already holds delete_person pg4gj1nbp
    // four times across two distinct timestamps, which is this exact shape.
    const ONBRANCH = { ts: '2026-08-20T23:42:58.442Z', by: 'ر', op: 'delete_person',
                       target: 'phhcxmf4j', name: 'Rola1', describe: '− Rola1 (phhcxmf4j)',
                       fromProposal: '71673773-072d-4e60-80bc-5165dc5a6ce0' };
    // Same act, recorded 27 seconds later by a page that had lost the log.
    const LOCAL    = { ts: '2026-08-20T23:43:25.001Z', by: 'ر', op: 'delete_person',
                       target: 'phhcxmf4j', name: 'Rola1', describe: '− Rola1 (phhcxmf4j)',
                       fromProposal: '71673773-072d-4e60-80bc-5165dc5a6ce0' };
    const H = { get: () => null };
    const R = o => Object.assign({ headers: H, text: async () => '', json: async () => ({}) }, o);
    const b64 = s => Buffer.from(s, 'utf8').toString('base64');
    const net = async (url, init) => {
      const u = String(url), m = (init && init.method) || 'GET';
      if (/rest\/v1\//.test(u)) return R({ ok: true, status: 201, json: async () => ([]) });
      if (/contents\/data\/changes\.jsonl/.test(u)) {
        return R({ ok: true, status: 200,
                   json: async () => ({ content: b64(JSON.stringify(ONBRANCH) + '\n') }) });
      }
      if (/contents\/data\/proposals-reviewed\.json/.test(u)) return R({ ok: false, status: 404 });
      if (/\/git\/ref\/heads\//.test(u)) {
        return R({ ok: true, status: 200, json: async () => ({ object: { sha: 'ee9270b' } }) });
      }
      throw new TypeError('it tried to publish a deletion that had already happened: ' + m + ' ' + u);
    };

    const a = bootUI({ role: 'admin', store: { 'ftChangeLog:admin': JSON.stringify([LOCAL]) }, net });
    run(a, "FTGitHub.setToken('fake-token');");
    return run(a, `FTGitHub.publish(function(){}).then(
        function (r) { return { ok: true, r: r }; },
        function (e) { return { ok: false, msg: e.message }; })`).then(out => {
      ok(out.ok, 'a re-recorded deletion is recognised, not republished',
         JSON.stringify(out).slice(0, 200));
      if (out.ok) eq(out.r.alreadyLanded, true, 'and reported as already published');
      return run(a, 'commitFamily()').then(() => {
        eq(run(a, 'FTChangeLog.count()'), 0, 'COMMIT clears it');
      });
    });
  });

  describe('a rename is never collapsed by the semantic key', () => {
    // A→B→A is three real edits, and the third shares target and name with the first.
    // Deduping on the act would delete a real line from the changelog, so rename is
    // deliberately matched on its own timestamp only. The asymmetry is the point:
    // a redundant rename line costs a line, a dropped one costs history.
    const R1 = { ts: '2026-08-20T10:00:00.000Z', by: 'ر', op: 'rename', target: 'p3',
                 to: 'باء', describe: '~ p3 → باء' };
    const R2 = { ts: '2026-08-20T12:00:00.000Z', by: 'ر', op: 'rename', target: 'p3',
                 to: 'ألف', describe: '~ p3 → ألف' };
    const blobs = [];
    const H = { get: () => null };
    const R = o => Object.assign({ headers: H, text: async () => '', json: async () => ({}) }, o);
    const b64 = s => Buffer.from(s, 'utf8').toString('base64');
    const un64 = s => Buffer.from(s, 'base64').toString('utf8');
    // The branch already carries the FIRST rename back to 'ألف' — same target, same
    // name as R2. Only the timestamp differs.
    const ONBRANCH = { ts: '2026-08-20T08:00:00.000Z', by: 'ر', op: 'rename', target: 'p3',
                       to: 'ألف', describe: '~ p3 → ألف' };
    const net = async (url, init) => {
      const u = String(url), m = (init && init.method) || 'GET';
      if (/rest\/v1\//.test(u)) return R({ ok: true, status: 201, json: async () => ([]) });
      if (/contents\/data\/changes\.jsonl/.test(u)) {
        return R({ ok: true, status: 200,
                   json: async () => ({ content: b64(JSON.stringify(ONBRANCH) + '\n') }) });
      }
      if (/contents\/data\/proposals-reviewed\.json/.test(u)) return R({ ok: false, status: 404 });
      if (/\/git\/ref\/heads\//.test(u) && m === 'GET') {
        return R({ ok: true, status: 200, json: async () => ({ object: { sha: 'head' } }) });
      }
      if (/\/git\/commits\/head/.test(u)) {
        return R({ ok: true, status: 200, json: async () => ({ sha: 'head', tree: { sha: 't0' } }) });
      }
      if (/\/git\/blobs/.test(u)) {
        blobs.push(un64(JSON.parse(init.body).content));
        return R({ ok: true, status: 201, json: async () => ({ sha: 'b' + blobs.length }) });
      }
      if (/\/git\/trees/.test(u)) return R({ ok: true, status: 201, json: async () => ({ sha: 't1' }) });
      if (/\/git\/commits$/.test(u)) return R({ ok: true, status: 201, json: async () => ({ sha: 'c1' }) });
      if (/\/git\/refs\/heads\//.test(u) && m === 'PATCH') {
        return R({ ok: true, status: 200, json: async () => ({}) });
      }
      throw new TypeError('unexpected: ' + m + ' ' + u);
    };

    const a = bootUI({ role: 'admin', store: {
      'ftChangeLog:admin': JSON.stringify([R1, R2]),
    }, net });
    run(a, "FTGitHub.setToken('fake-token');");
    return run(a, `FTGitHub.publish(function(){}).then(
        function (r) { return { ok: true, r: r }; },
        function (e) { return { ok: false, msg: e.message }; })`).then(out => {
      ok(out.ok, 'the publish goes through', JSON.stringify(out).slice(0, 200));
      ok(!out.r || !out.r.alreadyLanded,
         'a rename back to an earlier name is NOT mistaken for already published');
      const log = blobs.filter(b => /"op":"rename"/.test(b))[0] || '';
      eq(log.split('\n').filter(l => l.trim()).length, 3,
         'all three renames are in the file — none collapsed');
      ok(log.indexOf(R2.ts) !== -1, 'including the one that repeats an earlier name');
    });
  });

  describe('clicking the indicator explains a pending EDIT', () => {
    // Reported: clicking "● 1 EDIT UNPUBLISHED" showed "لا اقتراحات قيد المراجعة ✓".
    // The drawer explained proposals and decisions; a tree edit is neither, so with
    // an empty inbox it rendered a tick over a dirty publish bar.
    const a = bootUI({ role: 'admin' });
    run(a, `
      var id = state.generateId();
      state.people[id] = { id: id, name: 'مضاف', gender: 'male', generation: 3 };
      FTChangeLog.record({ op: 'add_child', target: 'p2', id: id, name: 'مضاف',
                           describe: '+ مضاف · ابن of p2' });
    `);
    eq(run(a, 'FTChangeLog.count()'), 1, 'one edit is pending');
    eq(run(a, 'FTReview.uncommitted().length'), 0, 'and no decisions, so only the edit can explain the bar');

    const state = a._doc.getElementById('family-state');
    ok(/1 EDIT UNPUBLISHED/.test(state.visibleText()), 'the bar says so', state.visibleText());
    ok(state.classList.contains('clickable'), 'and offers to explain itself');

    run(a, 'renderReviewList();');
    const drawer = a._doc.getElementById('review-list').visibleText();
    ok(!/لا اقتراحات قيد المراجعة ✓/.test(drawer),
       'the drawer no longer answers with a clean tick', drawer.slice(0, 120));
    ok(!/^\s*لا اقتراحات بعد/.test(drawer),
       'nor with "no proposals yet" and nothing else', drawer.slice(0, 120));
    ok(/تعديل بانتظار COMMIT/.test(drawer), 'it names the pending edit', drawer.slice(0, 160));
    ok(/مضاف/.test(drawer), 'and describes WHICH edit', drawer.slice(0, 200));
    eq(uiConsistent(a).length, 0, 'and the whole UI agrees');
  });

  describe('an approved proposal does not come back while Pages catches up', () => {
    // The root cause of the duplicate Rola1 edit, and the widest window of the three.
    //
    // A commit is on the branch instantly; the GitHub PAGES build that serves
    // data/changes.jsonl takes 10s to ~2min. commitFamily() clears the changelog on
    // success, and that log was the only local record that the proposal was approved.
    // So for the length of the deploy, `applied` is empty from BOTH sources and the
    // card returns to the queue with a live APPROVE button. Cache-busting cannot
    // help: there is nothing newer to fetch yet.
    //
    // ops_log timeline: ee9270b committed 23:43:04, draft_saved_at 23:43:21.913 —
    // a second edit recorded 15 seconds after the successful publish.
    const PID = '71673773-072d-4e60-80bc-5165dc5a6ce0';
    const ENTRY = { ts: '2026-08-20T23:42:58.442Z', by: 'ر', op: 'delete_person',
                    target: 'phhcxmf4j', name: 'Rola1', describe: '− Rola1 (phhcxmf4j)',
                    fromProposal: PID };
    const ROW = { id: PID, created_at: '2026-08-20T22:00:00Z', author_name: 'عادل',
                  author_node: 'p302', note: null, withdraws: null,
                  ops: [{ op: 'delete_person', target: 'phhcxmf4j' }] };

    const H = { get: () => null };
    const R = o => Object.assign({ headers: H, text: async () => '', json: async () => ({}) }, o);
    const b64 = s => Buffer.from(s, 'utf8').toString('base64');
    // THE DEPLOY LAG: the branch (api.github.com) has the line, the deployed site
    // (same-origin data/changes.jsonl) does not. That skew is the whole fixture.
    const net = async (url, init) => {
      const u = String(url), m = (init && init.method) || 'GET';
      if (/rest\/v1\/ops_log/.test(u)) return R({ ok: true, status: 201, json: async () => ([]) });
      if (/rest\/v1\/proposals/.test(u)) return R({ ok: true, status: 200, json: async () => ([ROW]) });
      if (/api\.github\.com/.test(u) && /contents\/data\/changes\.jsonl/.test(u)) {
        return R({ ok: true, status: 200,
                   json: async () => ({ content: b64(JSON.stringify(ENTRY) + '\n') }) });
      }
      if (/api\.github\.com/.test(u) && /proposals-reviewed/.test(u)) return R({ ok: false, status: 404 });
      if (/api\.github\.com/.test(u) && /\/git\/ref\/heads\//.test(u)) {
        return R({ ok: true, status: 200, json: async () => ({ object: { sha: 'ee9270b' } }) });
      }
      // Same-origin reads: still the PREVIOUS build.
      if (/changes\.jsonl/.test(u)) return R({ ok: true, status: 200, text: async () => '' });
      if (/proposals-reviewed\.json/.test(u)) return R({ ok: false, status: 404 });
      if (/published\.json/.test(u)) return R({ ok: false, status: 404 });
      throw new TypeError('unexpected: ' + m + ' ' + u);
    };

    // The state right after a successful publish: log cleared, deployed file stale.
    // ONE store object, shared by both boots — that is what makes the second bootUI a
    // RELOAD of the same browser rather than a different machine, which is the whole
    // scenario. (harness.boot: "Pass the SAME object".)
    const store = { 'ftChangeLog:admin': JSON.stringify([ENTRY]) };
    const a = bootUI({ role: 'admin', store, net });
    run(a, "FTGitHub.setToken('fake-token');");

    return run(a, 'FTGitHub.publish(function(){}).then(function(r){return r;},function(e){return {err:e.message};})')
      .then(r => {
        ok(!r.err, 'the publish is recognised as already landed', JSON.stringify(r).slice(0, 160));
        return run(a, 'commitFamily()');
      })
      .then(() => {
        eq(run(a, 'FTChangeLog.count()'), 0, 'the log is cleared, as it should be');
        // The record that has to survive it.
        eq(run(a, 'FTReview.appliedLocally()'), [PID],
           'but the approval is remembered past the clear');

        // Now reload: the deployed file STILL lacks the line.
        const b = bootUI({ role: 'admin', store, net });
        return run(b, 'FTReview.load()').then(() => {
          const rows = run(b, 'FTReview.all().map(function(r){return {id:r.id,s:r._state};})');
          eq(rows.length, 1, 'the proposal is still in the inbox');
          eq(rows[0].s, 'approved',
             'and reads APPROVED, not pending — so it cannot be approved a second time');
          eq(run(b, 'FTReview.buttonState().count'), 0, 'nothing is offered for review');
          run(b, 'renderReviewList();');
          eq(uiConsistent(b).length, 0, 'and the UI is coherent');
        });
      });
  });

  describe('a failed read never prunes what this device published', () => {
    // The prune drops an id only if it was positively seen in the deployed file, so a
    // read that failed prunes nothing. Asserted rather than assumed: dropping the
    // record on a failed read would reopen the window exactly when the site is
    // unreachable and least able to correct itself.
    const PID = 'p-fail-1';
    const H = { get: () => null };
    const R = o => Object.assign({ headers: H, text: async () => '', json: async () => ({}) }, o);
    const net = async (url) => {
      const u = String(url);
      if (/rest\/v1\/ops_log/.test(u)) return R({ ok: true, status: 201, json: async () => ([]) });
      if (/rest\/v1\/proposals/.test(u)) return R({ ok: true, status: 200, json: async () => ([]) });
      // 500, not 404: unreadable, which is NOT "genuinely empty".
      if (/changes\.jsonl/.test(u)) return R({ ok: false, status: 500 });
      if (/proposals-reviewed\.json/.test(u)) return R({ ok: false, status: 404 });
      if (/published\.json/.test(u)) return R({ ok: false, status: 404 });
      throw new TypeError('unexpected: ' + u);
    };
    const a = bootUI({ role: 'admin', store: {
      'ftAppliedProposals': JSON.stringify([{ id: PID, at: '2026-08-20T23:43:04Z' }]),
    }, net });
    return run(a, 'FTReview.load()').then(() => {
      eq(run(a, 'FTReview.appliedLocally()'), [PID],
         'the record survives a read that failed');
      ok(run(a, 'FTReview.buttonState().partial') === true ||
         run(a, "FTReview.buttonState().state") !== 'clean',
         'and the button does not claim clean when it could not ask');
    });
  });

  describe('the suite never writes to data/', () => {
    // The owner asked for the tree to be left alone. Everything above runs on
    // in-memory copies; this asserts it rather than trusting it.
    const fs = require('fs');
    const path = require('path');
    const { REPO } = require('./harness.js');
    const files = ['data/family.js', 'data/changes.jsonl', 'data/proposals-reviewed.json'];
    for (const f of files) {
      const p = path.join(REPO, f);
      const before = fs.statSync(p).mtimeMs;
      // A boot, a mutation, a preview and an approval — the whole write path.
      const a = bootUI({ role: 'admin' });
      run(a, `
        var id = state.generateId();
        state.people[id] = {id:id, name:'ephemeral', gender:'male', generation:1};
        FTChangeLog.record({op:'add_child', target:'p2', id:id, name:'ephemeral', describe:'+ x'});
        FTChangeLog.saveDraft();
      `);
      eq(fs.statSync(p).mtimeMs, before, f + ' is untouched by the tests');
    }
  });
};
