-- ============================================================
--  The Cookbook Board — Supabase schema, security, and storage
-- ------------------------------------------------------------
--  HOW TO RUN:
--    Supabase dashboard → SQL Editor → New query →
--    paste this whole file → press "Run".
--  It is safe to run more than once.
--
--  What it creates:
--    • table  public.cookbook_meals  (one row per meal, JSON payload)
--    • table  public.cookbook_meta   (settings, pantry, week plan, snapshots,
--                                     and the tombstones of deleted meals)
--    • bucket storage "cookbook"     (board photos, as JPEG files)
--    • Row Level Security so each account only ever sees its own data.
--
--  Every name here begins with "cookbook_" on purpose. One Supabase project
--  can host several apps, but only if they don't reach for the same table
--  names — a plain "meta" table would be silently shared with any other app
--  that wanted one, and they would overwrite each other's settings and
--  deleted-item lists with no error to warn you.
--
--  Photos are NOT stored in the meals table. Each board photo is a
--  file in the "cookbook" bucket at
--      <user_id>/meals/<mealId>__<itemId>.jpg
--  and the meal row only remembers that path. That keeps rows small
--  no matter how many photos a meal has.
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.cookbook_meals (
  user_id  uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id       text   not null,
  data     jsonb  not null,
  modified bigint not null default 0,
  primary key (user_id, id)
);

create table if not exists public.cookbook_meta (
  user_id uuid  not null default auth.uid() references auth.users (id) on delete cascade,
  key     text  not null,
  value   jsonb not null,
  primary key (user_id, key)
);

-- Pulling "everything changed since my last sync" is the hot path.
create index if not exists cookbook_meals_user_modified_idx on public.cookbook_meals (user_id, modified);

-- ---------- Row Level Security ----------
alter table public.cookbook_meals enable row level security;
alter table public.cookbook_meta  enable row level security;

-- meals: full access to your own rows only
drop policy if exists "cookbook_meals select own" on public.cookbook_meals;
drop policy if exists "cookbook_meals insert own" on public.cookbook_meals;
drop policy if exists "cookbook_meals update own" on public.cookbook_meals;
drop policy if exists "cookbook_meals delete own" on public.cookbook_meals;
create policy "cookbook_meals select own" on public.cookbook_meals for select using (auth.uid() = user_id);
create policy "cookbook_meals insert own" on public.cookbook_meals for insert with check (auth.uid() = user_id);
create policy "cookbook_meals update own" on public.cookbook_meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "cookbook_meals delete own" on public.cookbook_meals for delete using (auth.uid() = user_id);

-- meta: full access to your own rows only
drop policy if exists "cookbook_meta select own" on public.cookbook_meta;
drop policy if exists "cookbook_meta insert own" on public.cookbook_meta;
drop policy if exists "cookbook_meta update own" on public.cookbook_meta;
drop policy if exists "cookbook_meta delete own" on public.cookbook_meta;
create policy "cookbook_meta select own" on public.cookbook_meta for select using (auth.uid() = user_id);
create policy "cookbook_meta insert own" on public.cookbook_meta for insert with check (auth.uid() = user_id);
create policy "cookbook_meta update own" on public.cookbook_meta for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "cookbook_meta delete own" on public.cookbook_meta for delete using (auth.uid() = user_id);

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
