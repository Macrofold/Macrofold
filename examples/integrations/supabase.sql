-- Run once in a disposable Supabase project. Authenticated JWT sub must match customer_id.
create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id),
  title text not null,
  body text not null
);
create index customer_notes_customer on public.customer_notes(customer_id, id);
alter table public.customer_notes enable row level security;
revoke all on public.customer_notes from anon, authenticated;
grant select (id, customer_id, title, body) on public.customer_notes to authenticated;
create policy customer_reads_own_notes on public.customer_notes
  for select to authenticated using ((select auth.uid()) = customer_id);
-- Seed synthetic rows through a trusted administrative migration only, after creating
-- two disposable Auth users. Runtime code uses their access tokens, never service_role.
