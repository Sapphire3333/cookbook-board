-- ============================================================
--  The Cookbook Board — Supabase schema, security, and storage
-- ------------------------------------------------------------
--  HOW TO RUN:
--    Supabase dashboard → SQL Editor → New query →
--    paste this whole file → press "Run".
--  It is safe to run more than once.
--
--  What it creates:
--    • table  public.meals   (one row per meal, JSON payload)
--    • table  public.meta    (settings, e.g. the frame theme, and
--                             the tombstone list of deleted meals)
--    • bucket storage "cookbook" (board photos, as JPEG files)
--    • Row Level Security so each account only ever sees its own data.
--
--  Photos are NOT stored in the meals table. Each board photo is a
--  file in the "cookbook" bucket at
--      <user_id>/meals/<mealId>__<itemId>.jpg
--  and the meal row only remembers that path. That keeps rows small
--  no matter how many photos a meal has.
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.meals (
  user_id  uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id       text   not null,
  data     jsonb  not null,
  modified bigint not null default 0,
  primary key (user_id, id)
);

create table if not exists public.meta (
  user_id uuid  not null default auth.uid() references auth.users (id) on delete cascade,
  key     text  not null,
  value   jsonb not null,
  primary key (user_id, key)
);

-- Pulling "everything changed since my last sync" is the hot path.
create index if not exists meals_user_modified_idx on public.meals (user_id, modified);

-- ---------- Row Level Security ----------
alter table public.meals enable row level security;
alter table public.meta  enable row level security;

-- meals: full access to your own rows only
drop policy if exists "meals select own" on public.meals;
drop policy if exists "meals insert own" on public.meals;
drop policy if exists "meals update own" on public.meals;
drop policy if exists "meals delete own" on public.meals;
create policy "meals select own" on public.meals for select using (auth.uid() = user_id);
create policy "meals insert own" on public.meals for insert with check (auth.uid() = user_id);
create policy "meals update own" on public.meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meals delete own" on public.meals for delete using (auth.uid() = user_id);

-- meta: full access to your own rows only
drop policy if exists "meta select own" on public.meta;
drop policy if exists "meta insert own" on public.meta;
drop policy if exists "meta update own" on public.meta;
drop policy if exists "meta delete own" on public.meta;
create policy "meta select own" on public.meta for select using (auth.uid() = user_id);
create policy "meta insert own" on public.meta for insert with check (auth.uid() = user_id);
create policy "meta update own" on public.meta for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meta delete own" on public.meta for delete using (auth.uid() = user_id);

-- ---------- Storage bucket for board photos ----------
insert into storage.buckets (id, name, public)
values ('cookbook', 'cookbook', false)
on conflict (id) do nothing;

-- Each user may only touch files inside a top-level folder named after
-- their own uid, i.e.  <user_id>/meals/<mealId>__<itemId>.jpg
drop policy if exists "cookbook select own" on storage.objects;
drop policy if exists "cookbook insert own" on storage.objects;
drop policy if exists "cookbook update own" on storage.objects;
drop policy if exists "cookbook delete own" on storage.objects;
create policy "cookbook select own" on storage.objects for select
  using (bucket_id = 'cookbook' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cookbook insert own" on storage.objects for insert
  with check (bucket_id = 'cookbook' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cookbook update own" on storage.objects for update
  using (bucket_id = 'cookbook' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cookbook delete own" on storage.objects for delete
  using (bucket_id = 'cookbook' and (storage.foldername(name))[1] = auth.uid()::text);
