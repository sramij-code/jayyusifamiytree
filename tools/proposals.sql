-- ============================================================================
-- proposals — the review inbox for family suggestions.
--
-- Run once in the Supabase SQL editor. Column names match the body that
-- assets/js/propose.js POSTs to /rest/v1/proposals, so nothing needs mapping.
--
-- This table is an INBOX, never a source of truth. data/family.js stays the
-- rendered tree and git stays the record of decisions. That is deliberate: the
-- anon key ships to every visitor's browser, so anything the key can do, any
-- visitor can do. Keeping truth out of here means a compromised key costs you
-- spam, not history.
-- ============================================================================

create table proposals (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  author_node text,          -- the proposer's home node, e.g. 'p143'
  author_name text,          -- their name at the time, for display
  ops         jsonb not null default '[]'::jsonb,
                             -- FTChangeLog entries verbatim, same shape as the
                             -- lines in data/changes.jsonl
  note        text           -- free text. The only way to express corrections
                             -- the op set cannot: "his father is محمود, not
                             -- حسن", "فاطمة is a woman". All 1,746 imported
                             -- people are recorded as male, so this WILL be
                             -- used before reparent/set_gender exist.
);

-- Newest-first review, which is the only query the admin panel runs.
create index proposals_created_at_idx on proposals (created_at desc);

-- ---------------------------------------------------------------------------
-- Withdrawal requests.
--
-- MIGRATION for an existing table — run this one line on its own:
--
--   alter table proposals add column withdraws uuid references proposals(id);
--
-- A proposer cannot delete or edit what they sent: there is no delete policy and
-- no update policy, deliberately. So "cancel my proposal" has to arrive the only
-- way the publishable key can write anything — as an INSERT that points at the
-- row it wants dropped. Such a row is not a proposal; both UIs filter it out of
-- the list and use it to annotate its target.
--
-- It is a REQUEST, never automatic. There is no login, so `withdraws` is
-- client-asserted: anyone could post one against anyone's proposal. Honouring it
-- silently would hand every visitor a way to suppress someone else's legitimate
-- suggestion. The reviewer still decides, so the worst a forged withdrawal can do
-- is put a line on a card.
--
-- The FK is what stops it pointing at nothing; ON DELETE is left alone because
-- only service_role can delete, and that is a deliberate act.
-- ---------------------------------------------------------------------------
alter table proposals add column withdraws uuid references proposals(id);

-- Only rows that withdraw something, for the annotation pass.
create index proposals_withdraws_idx on proposals (withdraws) where withdraws is not null;

-- Proposals by author, for "my proposals".
--
-- author_node is SELF-ASSERTED — me() reads it from localStorage and there is no
-- login — so this index serves display, not ownership. select is open to everyone
-- anyway; anybody can read anybody's proposals, which is why the table holds only
-- family names and never a decision.
create index proposals_author_node_idx on proposals (author_node);

alter table proposals enable row level security;

-- Anyone may propose, and anyone may read.
--
-- Read is granted because the admin reviews with the SAME anon key — there is
-- no separate login — so restricting select would lock the reviewer out too.
-- The content is family names, so this is public-ish by design. Say so if you
-- share the link widely.
create policy "anyone may propose" on proposals
  for insert to anon with check (true);

create policy "anyone may read" on proposals
  for select to anon using (true);

-- Deliberately NO update and NO delete policy.
--
-- A status column would need update, and update via the anon key lets any
-- visitor rewrite any proposal — including flipping their own to approved. So
-- the decision is not stored here at all:
--
--   approved -> the ops land in data/changes.jsonl with fromProposal: <id>
--   rejected -> recorded in data/proposals-reviewed.json
--
-- Both are committed files, so "what is still pending" is (rows in this table)
-- minus (ids named in those two files). Versioned, diffable, and it does not
-- require trusting the database.
--
-- Note the service_role key bypasses RLS entirely, so YOU can still
-- `delete from proposals where author_node = '...'` from the Supabase
-- dashboard. Append-only for the public, not for you.

-- ---------------------------------------------------------------------------
-- Flood ceiling.
--
-- Anon insert with no cap means one script can add 100k rows, and the only
-- remediation the app has is you reviewing them one at a time. This is the
-- kill switch. Server-side, so it cannot be bypassed from the browser.
-- ---------------------------------------------------------------------------
create or replace function cap_proposals() returns trigger
language plpgsql as $$
begin
  if (select count(*) from proposals
      where created_at > now() - interval '1 hour') >= 50 then
    raise exception 'too many proposals this hour';
  end if;
  if (select count(*) from proposals) >= 5000 then
    raise exception 'proposal inbox is full';
  end if;
  return new;
end $$;

create trigger proposals_cap
  before insert on proposals
  for each row execute function cap_proposals();
