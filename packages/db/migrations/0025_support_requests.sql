-- 0025: in-app Support requests (promised to Scott/Allie on the 2026-09-16 call).
--
-- Staff hit problems they can't report easily: BugHerd is a Chrome/Edge extension
-- and doesn't work in every browser (Scott's DuckDuckGo). A Support tab lets anyone
-- describe what went wrong; the app attaches context automatically (page, version,
-- browser, screen size + zoom) and admins work the requests from Settings → Support.
--
-- Server-only access (service role). RLS is ENABLED with no policies so the
-- browser-visible anon key can never read or write it.
--
-- `alter type ... add value` may run in the same transaction as long as nothing in
-- that transaction uses the new value (nothing here does).

alter type notification_type add value if not exists 'support_request';

create table if not exists support_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete set null,
  category     text not null check (category in ('problem', 'cant_do', 'idea')),
  message      text not null check (char_length(message) between 1 and 5000),
  page_url     text,
  app_version  text,
  browser      text,
  screen       text,
  status       text not null default 'open' check (status in ('open', 'done')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index if not exists support_requests_status_created_idx on support_requests (status, created_at desc);
create index if not exists support_requests_user_idx on support_requests (user_id, created_at desc);

alter table support_requests enable row level security;
