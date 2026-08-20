-- ============================================================================
-- ops_log — a DIAGNOSTIC breadcrumb trail. Not an audit trail, not truth.
--
-- Run once in the Supabase SQL editor, after tools/proposals.sql.
--
-- WHAT THIS IS FOR. When something goes wrong in a browser, git shows only what
-- was published. It cannot show what that browser BELIEVED: which published tree
-- its draft was built on, what it refused to do, what it failed to reach. Working
-- one such incident out took a full git-archaeology session; a single `boot` row
-- carrying a baseline fingerprint would have answered it in one query.
--
-- WHAT THIS IS NOT. Every column except created_at is a claim by an
-- unauthenticated client. There is no login: role, author_node and client_ts are
-- self-asserted, and anyone holding the publishable key — which is everyone — can
-- write a row saying anything the constraints allow. It cannot arbitrate a dispute
-- between family members. git remains the record.
--
-- READ IS PUBLIC, like `proposals`. Treat every row as if it were on the homepage:
-- that is what drives the exclusions in assets/js/opslog.js.
--
-- A separate table on purpose, so a log flood can never consume the proposals
-- budget and block a real suggestion.
-- ============================================================================

create table ops_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),   -- SERVER clock. The only trustworthy column.
  client_ts    timestamptz,                          -- client clock: may be wrong, may be forged
  session      text,                                 -- random per-tab. NOT identity, NOT persisted
  role         text,                                 -- 'viewer' | 'propose' | 'admin', self-asserted
  event        text not null,                        -- controlled vocabulary, see the check below
  subject_kind text,                                 -- 'person' | 'proposal' | 'commit' | 'draft'
  subject_id   text,                                 -- an id, NEVER a name
  author_node  text,                                 -- self-asserted, as in proposals
  author_name  text,                                 -- self-asserted, display only
  app_version  text,                                 -- build stamp, so a bug maps to a build
  page_origin  text,                                 -- coarse: never a full path or file:// URL
  detail       jsonb not null default '{}'::jsonb    -- bounded; no secrets, no names, no free text
);

-- The vocabulary is enforced here, not only in JS. A typo'd event name is a row
-- you will never find again, and an open text column invites a client to write an
-- essay into it.
alter table ops_log add constraint ops_log_event_known check (event in (
  'boot','draft.applied','draft.reconciled','draft.divergence','draft.discard',
  'edit.add','edit.delete','edit.rename','edit.undo',
  'publish.commit.start','publish.commit.ok','publish.commit.fail',
  'publish.commit.refused','publish.export','publish.baseline_unreadable',
  'theme.publish',
  'review.load.ok','review.load.fail','review.preview','review.dismiss',
  'review.approve','review.decide',
  'propose.mode','propose.submit.ok','propose.submit.fail','propose.withdraw',
  'admin.gate','token.connect',
  'log.gap','error'
));

alter table ops_log add constraint ops_log_role_known
  check (role is null or role in ('viewer','propose','admin'));
alter table ops_log add constraint ops_log_origin_known
  check (page_origin is null or page_origin in ('pages','localhost','file','other'));

-- Length ceilings. Without them one client can write megabyte rows, and a public
-- SELECT then becomes a download of them.
alter table ops_log add constraint ops_log_small check (
  length(coalesce(session,''))      <= 24 and
  length(coalesce(subject_id,''))   <= 64 and
  length(coalesce(subject_kind,'')) <= 16 and
  length(coalesce(author_node,''))  <= 32 and
  length(coalesce(author_name,''))  <= 80 and   -- matches NAME_MAX in review.js
  length(coalesce(app_version,''))  <= 40 and
  pg_column_size(detail)            <= 1024
);

create index ops_log_created_at_idx on ops_log (created_at desc);
create index ops_log_event_idx      on ops_log (event, created_at desc);
create index ops_log_session_idx    on ops_log (session);

alter table ops_log enable row level security;

create policy "anyone may log"  on ops_log for insert to anon with check (true);
create policy "anyone may read" on ops_log for select to anon using (true);

-- Deliberately NO update and NO delete policy, for the same reason as proposals:
-- update via the publishable key lets any visitor rewrite any row, which is worse
-- than having no log at all. Pruning is a service_role act from the dashboard.

-- ---------------------------------------------------------------------------
-- Flood ceiling. Same shape as cap_proposals(), higher numbers because a normal
-- session emits tens of rows where it emits one proposal.
--
-- The PER-SESSION clause is the important one. Without it a single script can burn
-- the hourly budget and every honest client's rows are then rejected — a
-- denial-of-evidence attack, which is precisely the failure a diagnostic log must
-- not have.
-- ---------------------------------------------------------------------------
create or replace function cap_ops_log() returns trigger
language plpgsql as $$
begin
  if (select count(*) from ops_log
      where created_at > now() - interval '1 hour') >= 2000 then
    raise exception 'ops_log hourly cap reached';
  end if;
  if new.session is not null and
     (select count(*) from ops_log
      where session = new.session
        and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'ops_log per-session cap reached';
  end if;
  if (select count(*) from ops_log) >= 500000 then
    raise exception 'ops_log is full';
  end if;
  return new;
end $$;

create trigger ops_log_cap
  before insert on ops_log
  for each row execute function cap_ops_log();

-- ---------------------------------------------------------------------------
-- RETENTION IS MANUAL. At 500k rows inserts start failing. There is no automatic
-- prune, because the only mechanisms available would be worse:
--
--   · a trigger with `security definer` that deletes would hand every visitor an
--     indirect delete primitive, defeating the missing delete policy
--   · pg_cron is an extension you would have to enable and reason about
--
-- So prune deliberately, from the dashboard:
--
--   delete from ops_log where created_at < now() - interval '90 days';
--
-- Useful queries when diagnosing:
--
--   -- which published tree did each browser boot from?
--   select created_at, session, detail->>'base_people', detail->>'draft_people',
--          detail->>'divergence', detail->>'baseline_matched'
--     from ops_log where event = 'boot' order by created_at desc limit 50;
--
--   -- everything one session did, in order
--   select created_at, event, subject_id, detail
--     from ops_log where session = '...' order by created_at;
--
--   -- refusals, which are the interesting failures
--   select created_at, event, detail from ops_log
--    where event in ('publish.commit.refused','publish.commit.fail','review.load.fail')
--    order by created_at desc limit 100;
-- ---------------------------------------------------------------------------
