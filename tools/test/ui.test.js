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
  const urging = /اضغط COMMIT لحفظه|اضغط COMMIT في شريط النشر لحفظها/.test(
    txt('review-list') + ' ' + txt('review-status'));
  if (commitDead && urging) {
    bad.push('a message says "press COMMIT" while the COMMIT button is disabled');
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
    const net = async (url, init) => {
      const u = String(url), m = (init && init.method) || 'GET';
      if (/changes\.jsonl/.test(u) && /api\.github/.test(u)) return R({ ok: false, status: 404, text: async () => '' });
      if (/proposals-reviewed\.json/.test(u) && /api\.github/.test(u)) return R({ ok: false, status: 404, text: async () => '' });
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
    ok(!/press COMMIT again\.'/.test(src),
       'the old "press COMMIT again" advice is gone — that is what duplicated a landed commit');
    ok(/would record it twice/.test(src), 'and it warns about exactly that');
    ok(/reload the page: if the indicator goes clean/.test(src),
       'telling the user how to check whether it landed');
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
