# Verification suite

    node tools/test/run.js              # everything
    node tools/test/run.js proposals    # one suite, substring match

Exit code is 0 only if every check passes, so it can gate a publish.

No dependencies. This repo has no package manager and no build step (see
`CLAUDE.md`), and the tests hold to the same rule — `node` is all you need.

## Why these tests exist

Every check here corresponds to something that actually broke during
development, usually in a way that looked like something else. The suite is
deliberately biased toward those classes of bug rather than toward coverage.

## The suites

**`static`** — no JS is executed. Catches a moved file leaving a dead
`<script src>`, a duplicated element id, a stray `</style>` swallowing the rule
after it, an admin module leaking into the public page, a real credential
reaching a committed file, and `data/family.js` no longer parsing the way the
Python tooling reads it.

**`domain`** — the tree's own rules, driven through the real modules against the
real 1,746-person data. Ids unique per browser rather than per counter, adding a
wife never reassigning motherhood, polygyny representable and symmetric,
deletion restricted to childless non-root people, layout placing everyone with
legal spacing, undo restoring exactly, and the two pages' drafts staying
separate.

**`proposals`** — the propose → review → approve/reject lifecycle, including
accepting some proposals while rejecting others. The crafted-op group matters
most: the Supabase publishable key ships to every visitor, so anyone can POST an
arbitrary row without going near the UI that enforces the domain rules.
`applyOp` is the real gate, and these prove it.

**`mobile`** — CSS arithmetic, computed rather than rendered. There is no browser
here, and three CSS regressions shipped because structural checks cannot see
layout. Checks that a fixed bar's reserved space matches its real height, that
the safe-area inset sits on the correct edge and is counted once, that every
touch target is at least 44px, that no focusable input is under the 16px at
which iOS force-zooms, and that the stacking order lets dialogs cover the bars.

## The oracle

`harness.js` exposes `invariants(ctx)`, which returns a list of violated domain
rules and should always be empty. Assert it after **every** mutation — it is far
more likely to catch a real problem than any assertion about counts:

    const { boot, run, invariants } = require('./harness.js');
    const c = boot({ role: 'admin' });
    run(c, "deletePerson('p23')");
    console.log(invariants(c));      // [] when healthy

It checks referential integrity, that women stay terminal, that
`partners[0]` is never female, that the graph stays a tree rather than a DAG,
that no partnership records neither descent nor a marriage, and that every
generation is a usable row index.

## Modelling one browser vs two

`index.html` and `admin.html` share an origin, so they share `localStorage`.
Pass the **same** `store` object to two `boot()` calls to model that; pass
different objects to model two different people. A proposer's draft leaking into
the admin's tree was a real bug, and it is only reproducible with a shared store.

    const store = {};
    const viewer = boot({ store, role: 'propose' });
    const admin  = boot({ store, role: 'admin' });

## What it cannot tell you

The harness runs layout maths for real but never paints. Anything that depends
on font metrics or actual rendering — how many items a flex bar wraps to, whether
Arabic text overflows a node, how a transition looks — needs a real browser on a
real device. The `mobile` suite states bounds rather than asserting exact widths
for this reason.

It also does not touch the network: the GitHub commit path and the Supabase
requests are exercised with stubs, so a change to either needs one manual run
against the live services.

## Adding a test

Suites are plain functions taking `{ describe, ok, eq }`. Register the filename
in `SUITES` at the top of `run.js`.

    module.exports = function ({ describe, ok, eq }) {
      describe('what this group is about', () => {
        ok(condition, 'what should be true', 'detail shown only on failure');
        eq(actual, expected, 'what should match');
      });
    };

Prefer a name that states the rule rather than the mechanism, so a failure reads
as a broken promise about the app rather than a broken line of code.
