/* ============================================================================
   tools/test/run.js — the test runner.

   Zero dependencies. Usage:

     node tools/test/run.js            all suites
     node tools/test/run.js static     one suite (substring match)

   Exit code 0 when everything passes, 1 otherwise, so it can gate a publish.
============================================================================ */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');

/* Which suite/group an assertion belongs to.
   These were plain module-level variables read at ok() time, which is wrong for
   any group returning a promise: its assertions resolve after later groups have
   already run, so they were reported under whatever block happened to be current
   — real failures in `proposals` were printed as `mobile / propose mode reserves
   enough for its own bar`. AsyncLocalStorage carries the labels through async
   continuations, so an assertion is attributed to the group that made it. */
const als = new AsyncLocalStorage();

const SUITES = ['static', 'domain', 'proposals', 'mobile', 'ui'];

let pass = 0, fail = 0, skip = 0;
const failures = [];
let suite = '', group = '';

/* A group may return a promise. The runner awaits every one before summarising —
   without that an async group's assertions ran after the summary printed and its
   failures were invisible, which is worse than having no test at all. */
const pending = [];
function describe(name, fn) {
  group = name;
  console.log('\n  ' + name);
  const held = name, heldSuite = suite;
  const r = als.run({ suite: heldSuite, group: held }, fn);
  if (r && typeof r.then === 'function') {
    pending.push(r.catch(e => {
      fail++;
      console.log('    ✗ ' + held + ' threw asynchronously: ' + e.message);
      failures.push(heldSuite + ' / ' + held + ' threw: ' + e.message);
    }));
  }
}

function ok(cond, label, detail) {
  if (cond === 'skip') {
    skip++; console.log('    ~ ' + label + (detail ? '  (' + detail + ')' : ''));
    return;
  }
  if (cond) { pass++; console.log('    ✓ ' + label); }
  else {
    fail++;
    const cx = als.getStore() || { suite: suite, group: group };
    console.log('    ✗ ' + label + (detail ? '\n        ' + detail : ''));
    failures.push(cx.suite + ' / ' + cx.group + ' / ' + label + (detail ? ' -- ' + detail : ''));
  }
}

// Deep-ish equality is not needed; these are all primitives and arrays.
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(a === b, label, a === b ? '' : 'got ' + a + ', wanted ' + b);
}

const api = { describe, ok, eq };

const wanted = process.argv[2];
const chosen = wanted ? SUITES.filter(s => s.includes(wanted)) : SUITES;
if (chosen.length === 0) {
  console.error('No suite matches "' + wanted + '". Available: ' + SUITES.join(', '));
  process.exit(1);
}

async function main() {
  console.log('family tree — verification suite');
  for (const s of chosen) {
    suite = s;
    const file = path.join(__dirname, s + '.test.js');
    if (!fs.existsSync(file)) { console.log('\n' + s.toUpperCase() + ' (missing)'); continue; }
    console.log('\n' + '='.repeat(64) + '\n' + s.toUpperCase());
    try {
      await require(file)(api);
    } catch (e) {
      fail++;
      console.log('    ✗ suite threw: ' + e.message);
      failures.push(s + ' threw: ' + e.stack.split('\n').slice(0, 3).join(' | '));
    }
  }
  await Promise.all(pending);

  console.log('\n' + '='.repeat(64));
  console.log(pass + ' passed, ' + fail + ' failed' + (skip ? ', ' + skip + ' skipped' : ''));
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(fail ? 1 : 0);
}

main();
