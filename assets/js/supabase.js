/* ============================================================================
   supabase.js — the proposals inbox client. Loaded by BOTH pages.

   Shared because index.html writes proposals and admin.html reads them, and
   the project URL and key must not drift between two copies.

   The publishable key below is MEANT to be public: it ships in this file to
   every visitor. Its power is bounded entirely by the RLS policies in
   tools/proposals.sql — insert and select on one table, nothing else. The
   secret / service_role key bypasses RLS and must never appear here.

   Nothing in the database is a source of truth. data/family.js stays the
   rendered tree and git stays the record of decisions; this is an inbox that
   only ever grows. That is deliberate: anything this key can do, any visitor
   can do, so a leaked key costs spam rather than history.
============================================================================ */

var FTSupa = window.FTSupa = (function () {
  const URL_RAW = 'https://swwukbafkibgazlzshkr.supabase.co';
  const KEY     = 'sb_publishable_aqFdEvUtLRPlCCnEgaSp6A_1G6r80hE';

  // The dashboard shows the REST endpoint (…/rest/v1/) rather than the bare
  // project URL, and the callers append that path themselves. Normalise instead
  // of depending on which one got pasted, or the mistake surfaces as a baffling
  // 404 on /rest/v1/rest/v1/proposals.
  function base() {
    return String(URL_RAW).replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  }

  // Two key formats need different headers. A legacy anon key is a JWT (starts
  // 'eyJ') whose payload carries the role, and the convention is to send it as
  // both apikey and a Bearer token. A publishable key is an opaque string that
  // the gateway resolves to the anon role, so presenting it as a Bearer token
  // asks the server to parse as a JWT something that is not one. Detect rather
  // than pick, so switching keys later needs no code change.
  function headers(extra) {
    const h = { 'apikey': KEY };
    if (/^eyJ/.test(KEY)) h['Authorization'] = 'Bearer ' + KEY;
    return Object.assign(h, extra || {});
  }

  async function request(path, options) {
    const res = await fetch(base() + '/rest/v1' + path, options);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* not json */ }
      if (res.status === 401 || res.status === 403) {
        throw new Error('Supabase rejected the request (' + res.status + '). ' +
          'Check the row-level security policies on `proposals`. ' + detail);
      }
      if (res.status === 404) {
        throw new Error('Table not found (404). Has tools/proposals.sql been run? ' + detail);
      }
      throw new Error('Supabase ' + res.status + '. ' + detail);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    configured: function () { return !!(URL_RAW && KEY); },

    insert: function (table, row) {
      return request('/' + table, {
        method: 'POST',
        headers: headers({
          'Content-Type': 'application/json',
          // Ask for the inserted row back, so the caller can record its id.
          'Prefer': 'return=representation',
        }),
        body: JSON.stringify(row),
      });
    },

    select: function (table, query) {
      return request('/' + table + (query ? '?' + query : ''), {
        method: 'GET',
        headers: headers(),
      });
    },
  };
})();
