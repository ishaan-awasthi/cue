-- Waitlist table for early-access signups
create table if not exists waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  created_at  timestamptz not null default now()
);

-- Allow anyone to insert (no auth required for waitlist signup)
alter table waitlist enable row level security;

create policy "public can join waitlist"
  on waitlist for insert
  to anon
  with check (true);

-- Only service role can read the list
create policy "service role can read waitlist"
  on waitlist for select
  to service_role
  using (true);
