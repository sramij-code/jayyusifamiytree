/* ============================================================================
   tools/test/dom.js — a minimal DOM, and a Supabase that enforces the real rules.

   WHY THIS EXISTS. Every UI bug in this project so far got through because the
   suite could not click anything: COMMIT greyed out while the drawer said "press
   COMMIT"; a message naming a button that does not exist; a stale-draft state with
   no way out because the only escape was disabled. All of those are consistency
   bugs BETWEEN controls, invisible to a unit test and invisible to a source grep.

   This is not a browser. It implements exactly the surface the admin/propose code
   touches — ids, classList, textContent, disabled, title, hidden, appendChild,
   click dispatch — and nothing else. Anything it cannot model (layout, fonts,
   real SVG geometry) is still out of reach and still needs a device.

   The element set is READ FROM THE REAL HTML, so a test cannot pass by asserting
   against an id the page does not have, and renaming an id in admin.html breaks
   the tests rather than silently bypassing them.
============================================================================ */

const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../..');

function idsIn(file) {
  const src = fs.readFileSync(path.join(REPO, file), 'utf8');
  const ids = new Set();
  for (const m of src.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

function makeClassList(el) {
  const set = new Set();
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle: (c, on) => {
      const want = on === undefined ? !set.has(c) : !!on;
      if (want) set.add(c); else set.delete(c);
      return want;
    },
    contains: c => set.has(c),
    get length() { return set.size; },
    _all: () => Array.from(set),
    toString: () => Array.from(set).join(' '),
  };
}

function makeEl(tag, id) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: id || '',
    _text: '',
    _handlers: {},
    children: [],
    parent: null,
    style: {},
    dataset: {},
    disabled: false,
    hidden: false,
    title: '',
    value: '',
    type: '',
    checked: false,
    options: [],
  };
  el.classList = makeClassList(el);

  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = String(v == null ? '' : v); el.children.length = 0; },
  });
  // className is used interchangeably with classList in this codebase.
  Object.defineProperty(el, 'className', {
    get() { return el.classList.toString(); },
    set(v) {
      el.classList._all().forEach(c => el.classList.remove(c));
      String(v || '').split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
    },
  });

  el.appendChild = child => { child.parent = el; el.children.push(child); return child; };
  el.removeChild = child => {
    const i = el.children.indexOf(child);
    if (i !== -1) el.children.splice(i, 1);
    return child;
  };
  el.remove = () => { if (el.parent) el.parent.removeChild(el); };
  el.setAttribute = (k, v) => { el[k] = v; };
  el.getAttribute = k => el[k];
  el.addEventListener = (ev, fn) => { (el._handlers[ev] = el._handlers[ev] || []).push(fn); };
  el.focus = () => {};
  el.select = () => {};
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 40 });

  // A click on a disabled control does nothing, exactly as a browser behaves.
  // Without this a test could "click" COMMIT while it was greyed out and see the
  // handler run, which is the opposite of what these tests are for.
  el.click = () => {
    if (el.disabled) return false;
    for (const fn of el._handlers.click || []) fn({ target: el, stopPropagation() {}, preventDefault() {} });
    return true;
  };

  // Everything visible under this element, for asserting what the user can read.
  el.visibleText = () => {
    if (el.hidden) return '';
    let out = el._text ? el._text + ' ' : '';
    for (const c of el.children) out += c.visibleText() + ' ';
    return out;
  };
  return el;
}

/* A document backed by the ids the real page declares. */
function makeDocument(pages) {
  const wanted = new Set();
  for (const p of pages) for (const id of idsIn(p)) wanted.add(id);

  const byId = new Map();
  for (const id of wanted) byId.set(id, makeEl('div', id));

  const doc = {
    _ids: wanted,
    getElementById: id => byId.get(id) || null,
    createElement: tag => makeEl(tag, ''),
    addEventListener() {},
    querySelector: sel => {
      // Only the class form is used by the code under test.
      const cls = String(sel).replace(/^\./, '');
      for (const el of byId.values()) {
        const hit = (function walk(e) {
          if (e.classList.contains(cls)) return e;
          for (const c of e.children) { const r = walk(c); if (r) return r; }
          return null;
        })(el);
        if (hit) return hit;
      }
      return null;
    },
    querySelectorAll: () => [],
    body: makeEl('body', 'body'),
    documentElement: makeEl('html', 'html'),
  };
  doc.documentElement.style.setProperty = () => {};
  return doc;
}

/* ---------------------------------------------------------------------------
   A Supabase that enforces what tools/proposals.sql actually grants.

   INSERT and SELECT only. Any UPDATE or DELETE throws — so if code ever starts
   using a verb the publishable key does not have, a test fails here rather than a
   403 appearing in production. The flood cap is modelled too, because a code path
   that assumes inserts always succeed is a code path that loses a proposal.
--------------------------------------------------------------------------- */
function makeSupabase(opts) {
  const o = opts || {};
  const rows = o.rows ? JSON.parse(JSON.stringify(o.rows)) : [];
  const calls = [];
  let seq = 0;

  const api = {
    rows: () => JSON.parse(JSON.stringify(rows)),
    calls: () => calls.slice(),
    hourlyCap: o.hourlyCap == null ? 50 : o.hourlyCap,

    fetch: async (url, init) => {
      const u = String(url);
      const method = (init && init.method) || 'GET';
      calls.push({ url: u, method });

      if (/\/proposals/.test(u)) {
        if (method === 'POST') {
          if (rows.length >= api.hourlyCap) {
            return { ok: false, status: 400, text: async () => 'too many proposals this hour' };
          }
          const body = JSON.parse(init.body);
          const list = Array.isArray(body) ? body : [body];
          const made = list.map(b => {
            // The FK: withdraws must name a row that exists.
            if (b.withdraws && !rows.some(r => r.id === b.withdraws)) {
              throw new Error('violates foreign key constraint on withdraws');
            }
            const row = Object.assign({
              id: 'row-' + (++seq),
              created_at: '2026-08-20T00:00:0' + (seq % 10) + '.000Z',
              author_node: null, author_name: null, ops: [], note: null, withdraws: null,
            }, b);
            rows.push(row);
            return row;
          });
          return { ok: true, status: 201, json: async () => made };
        }
        if (method === 'GET') {
          let out = rows.slice();
          const q = u.split('?')[1] || '';
          const node = /author_node=eq\.([^&]+)/.exec(q);
          if (node) out = out.filter(r => r.author_node === decodeURIComponent(node[1]));
          const inIds = /id=in\.\(([^)]*)\)/.exec(q);
          if (inIds) {
            const want = new Set(inIds[1].split(',').map(decodeURIComponent).filter(Boolean));
            out = out.filter(r => want.has(r.id));
          }
          if (/order=created_at\.desc/.test(q)) {
            out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          }
          return { ok: true, status: 200, json: async () => out };
        }
        // The whole point: these verbs are NOT granted.
        throw new Error('RLS: ' + method + ' on proposals is not permitted by the ' +
                        'publishable key (no update/delete policy). See tools/proposals.sql.');
      }

      if (/ops_log/.test(u)) {
        if (method !== 'POST' && method !== 'GET') {
          throw new Error('RLS: ' + method + ' on ops_log is not permitted');
        }
        return { ok: true, status: 201, json: async () => ([]) };
      }

      // The two committed files, served as configured.
      if (/changes\.jsonl/.test(u)) return o.changesJsonl || { ok: false, status: 404 };
      if (/proposals-reviewed\.json/.test(u)) return o.reviewedJson || { ok: false, status: 404 };

      throw new TypeError('unexpected fetch in test: ' + u);
    },
  };
  return api;
}

/* Source with comments removed, for assertions about what the CODE does.
   A plain grep cannot tell live code from a comment describing what was removed:
   two checks here failed because the fix's own comment said "not DISCARD DRAFT"
   and "printed TREE IN SYNC". A state machine rather than a regex, so that `//`
   inside a string (every https:// URL) is not mistaken for a comment. */
function codeOnly(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      if (c === '\\') { out += c + (d || ''); i += 2; continue; }
      if (c === q) q = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i+1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

module.exports = { makeDocument, makeEl, makeSupabase, idsIn, codeOnly, REPO };
