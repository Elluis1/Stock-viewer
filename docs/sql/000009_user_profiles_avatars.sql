-- Perfiles con avatar (OAuth / metadata) + directorio de miembros
-- Aplicado en remoto como user_profiles_avatars

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  avatar text;
  dname text;
begin
  avatar := nullif(trim(coalesce(meta->>'avatar_url', meta->>'picture', '')), '');
  dname := nullif(trim(coalesce(meta->>'full_name', meta->>'name', '')), '');
  if dname is null and new.email is not null then
    dname := split_part(new.email, '@', 1);
  end if;

  insert into public.profiles (id, email, display_name, avatar_url, updated_at)
  values (new.id, new.email, dname, avatar, now())
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_profile_sync on auth.users;
create trigger on_auth_user_profile_sync
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_from_auth_user();

insert into public.profiles (id, email, display_name, avatar_url, updated_at)
select
  u.id,
  u.email,
  coalesce(
    nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''),
    split_part(u.email, '@', 1)
  ),
  nullif(trim(coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', '')), ''),
  now()
from auth.users u
on conflict (id) do update set
  email = excluded.email,
  display_name = coalesce(excluded.display_name, public.profiles.display_name),
  avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
  updated_at = now();

create or replace view public.company_members_directory
with (security_invoker = true) as
select
  cm.id,
  cm.company_id,
  cm.user_id,
  cm.role,
  cm.email,
  cm.created_at,
  p.avatar_url,
  p.display_name
from public.company_members cm
left join public.profiles p on p.id = cm.user_id;

grant select on public.company_members_directory to authenticated;
grant select, insert, update on public.profiles to authenticated;
