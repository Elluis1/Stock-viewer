-- Invitaciones a empresa + email en miembros.
-- Aplicar en: Supabase Dashboard → SQL → New query
-- (copia versionada también en docs/sql/)

-- ---------------------------------------------------------------------------
-- company_members: email visible en UI (snapshot al unirse)
-- ---------------------------------------------------------------------------

alter table public.company_members
  add column if not exists email text;

update public.company_members cm
set email = lower(u.email)
from auth.users u
where cm.user_id = u.id
  and (cm.email is null or length(trim(cm.email)) = 0)
  and u.email is not null;

-- create_company: guardar email del owner
create or replace function public.create_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_email text;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'create_company: nombre vacío';
  end if;

  v_email := nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '');

  insert into public.companies (name, created_by)
  values (trim(p_name), auth.uid())
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role, email)
  values (v_company_id, auth.uid(), 'owner', v_email);

  return v_company_id;
end;
$$;

revoke all on function public.create_company(text) from public;
grant execute on function public.create_company(text) to authenticated;

-- ---------------------------------------------------------------------------
-- company_invites
-- ---------------------------------------------------------------------------

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  role text not null default 'member'
    check (role in ('admin', 'member')),
  token text not null unique,
  invited_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint company_invites_email_nonempty check (length(trim(email)) > 0)
);

create index if not exists company_invites_company_id_idx
  on public.company_invites (company_id);

create index if not exists company_invites_email_idx
  on public.company_invites (email);

create unique index if not exists company_invites_pending_unique
  on public.company_invites (company_id, email)
  where status = 'pending';

alter table public.company_invites enable row level security;

drop policy if exists company_invites_select_admin on public.company_invites;
create policy company_invites_select_admin
on public.company_invites
for select
to authenticated
using (public.is_owner_or_admin_of_company(company_id, (select auth.uid())));

-- Escrituras solo vía RPC security definer (sin policies insert/update/delete para authenticated)

-- ---------------------------------------------------------------------------
-- create_company_invite
-- ---------------------------------------------------------------------------

create or replace function public.create_company_invite(
  p_company_id uuid,
  p_email text,
  p_role text default 'member',
  p_expires_days int default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text;
  v_token text;
  v_expires timestamptz;
  v_id uuid;
  v_days int;
begin
  if auth.uid() is null then
    raise exception 'create_company_invite: no autenticado';
  end if;

  if not public.is_owner_or_admin_of_company(p_company_id, auth.uid()) then
    raise exception 'create_company_invite: solo owner o admin pueden invitar';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if length(v_email) = 0 or position('@' in v_email) = 0 then
    raise exception 'create_company_invite: email inválido';
  end if;

  v_role := lower(trim(coalesce(p_role, 'member')));
  if v_role not in ('admin', 'member') then
    raise exception 'create_company_invite: rol inválido (admin o member)';
  end if;

  v_days := greatest(coalesce(p_expires_days, 7), 1);
  if v_days > 30 then
    v_days := 30;
  end if;

  if exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and lower(trim(coalesce(cm.email, ''))) = v_email
  ) then
    raise exception 'create_company_invite: ese email ya es miembro de la empresa';
  end if;

  -- Si hay pending previa, la revocamos y creamos una nueva (token fresco)
  update public.company_invites
  set status = 'revoked'
  where company_id = p_company_id
    and email = v_email
    and status = 'pending';

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(days => v_days);

  insert into public.company_invites (
    company_id, email, role, token, invited_by, status, expires_at
  )
  values (
    p_company_id, v_email, v_role, v_token, auth.uid(), 'pending', v_expires
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'email', v_email,
    'role', v_role,
    'expires_at', v_expires
  );
end;
$$;

revoke all on function public.create_company_invite(uuid, text, text, int) from public;
grant execute on function public.create_company_invite(uuid, text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_company_invite
-- ---------------------------------------------------------------------------

create or replace function public.accept_company_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.company_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'accept_company_invite: no autenticado';
  end if;

  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  if length(v_email) = 0 then
    raise exception 'accept_company_invite: tu sesión no tiene email';
  end if;

  select *
  into v_inv
  from public.company_invites
  where token = trim(coalesce(p_token, ''))
  for update;

  if not found then
    raise exception 'accept_company_invite: invitación no encontrada';
  end if;

  if v_inv.status = 'accepted' then
    raise exception 'accept_company_invite: la invitación ya fue aceptada';
  end if;

  if v_inv.status = 'revoked' then
    raise exception 'accept_company_invite: la invitación fue revocada';
  end if;

  if v_inv.expires_at < now() then
    update public.company_invites set status = 'expired' where id = v_inv.id;
    raise exception 'accept_company_invite: la invitación expiró';
  end if;

  if v_inv.status <> 'pending' then
    raise exception 'accept_company_invite: invitación no válida';
  end if;

  if v_inv.email <> v_email then
    raise exception 'accept_company_invite: debés iniciar sesión con el email invitado (%)', v_inv.email;
  end if;

  if public.is_member_of_company(v_inv.company_id, auth.uid()) then
    update public.company_invites
    set status = 'accepted', accepted_by = auth.uid()
    where id = v_inv.id;
    return v_inv.company_id;
  end if;

  insert into public.company_members (company_id, user_id, role, email)
  values (v_inv.company_id, auth.uid(), v_inv.role, v_email);

  update public.company_invites
  set status = 'accepted', accepted_by = auth.uid()
  where id = v_inv.id;

  return v_inv.company_id;
end;
$$;

revoke all on function public.accept_company_invite(text) from public;
grant execute on function public.accept_company_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- revoke_company_invite
-- ---------------------------------------------------------------------------

create or replace function public.revoke_company_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'revoke_company_invite: no autenticado';
  end if;

  select company_id into v_company_id
  from public.company_invites
  where id = p_invite_id;

  if v_company_id is null then
    raise exception 'revoke_company_invite: invitación no encontrada';
  end if;

  if not public.is_owner_or_admin_of_company(v_company_id, auth.uid()) then
    raise exception 'revoke_company_invite: solo owner o admin';
  end if;

  update public.company_invites
  set status = 'revoked'
  where id = p_invite_id
    and status = 'pending';
end;
$$;

revoke all on function public.revoke_company_invite(uuid) from public;
grant execute on function public.revoke_company_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_company_member_role / remove_company_member
-- ---------------------------------------------------------------------------

create or replace function public.update_company_member_role(
  p_member_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.company_members%rowtype;
  v_role text;
  v_owner_count int;
begin
  if auth.uid() is null then
    raise exception 'update_company_member_role: no autenticado';
  end if;

  select * into v_row from public.company_members where id = p_member_id;
  if not found then
    raise exception 'update_company_member_role: miembro no encontrado';
  end if;

  if not public.is_owner_or_admin_of_company(v_row.company_id, auth.uid()) then
    raise exception 'update_company_member_role: solo owner o admin';
  end if;

  -- Solo owner puede asignar/quitar owner
  v_role := lower(trim(p_role));
  if v_role not in ('owner', 'admin', 'member') then
    raise exception 'update_company_member_role: rol inválido';
  end if;

  if v_role = 'owner' and not public.is_owner_of_company(v_row.company_id, auth.uid()) then
    raise exception 'update_company_member_role: solo un owner puede nombrar otro owner';
  end if;

  if v_row.role = 'owner' and v_role <> 'owner' then
    if not public.is_owner_of_company(v_row.company_id, auth.uid()) then
      raise exception 'update_company_member_role: solo un owner puede degradar a otro owner';
    end if;
    select count(*) into v_owner_count
    from public.company_members
    where company_id = v_row.company_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'update_company_member_role: no podés quitar el último owner';
    end if;
  end if;

  -- Admin no puede cambiar a un owner
  if v_row.role = 'owner' and not public.is_owner_of_company(v_row.company_id, auth.uid()) then
    raise exception 'update_company_member_role: un admin no puede modificar al owner';
  end if;

  update public.company_members set role = v_role where id = p_member_id;
end;
$$;

revoke all on function public.update_company_member_role(uuid, text) from public;
grant execute on function public.update_company_member_role(uuid, text) to authenticated;

create or replace function public.remove_company_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.company_members%rowtype;
  v_owner_count int;
begin
  if auth.uid() is null then
    raise exception 'remove_company_member: no autenticado';
  end if;

  select * into v_row from public.company_members where id = p_member_id;
  if not found then
    raise exception 'remove_company_member: miembro no encontrado';
  end if;

  if not public.is_owner_or_admin_of_company(v_row.company_id, auth.uid()) then
    raise exception 'remove_company_member: solo owner o admin';
  end if;

  if v_row.user_id = auth.uid() then
    if v_row.role = 'owner' then
      raise exception 'remove_company_member: el owner no puede quitarse de la empresa';
    end if;
    raise exception 'remove_company_member: no podés eliminarte a vos mismo (pedile a otro admin)';
  end if;

  if v_row.role = 'owner' then
    if not public.is_owner_of_company(v_row.company_id, auth.uid()) then
      raise exception 'remove_company_member: un admin no puede eliminar al owner';
    end if;
    select count(*) into v_owner_count
    from public.company_members
    where company_id = v_row.company_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'remove_company_member: no podés eliminar el último owner';
    end if;
  end if;

  delete from public.company_members where id = p_member_id;
end;
$$;

revoke all on function public.remove_company_member(uuid) from public;
grant execute on function public.remove_company_member(uuid) to authenticated;

-- Preview invite (opcional, para la página de aceptación sin filtrar por email aún)
create or replace function public.get_company_invite_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.company_invites%rowtype;
  v_company_name text;
begin
  select * into v_inv
  from public.company_invites
  where token = trim(coalesce(p_token, ''));

  if not found then
    return null;
  end if;

  select name into v_company_name from public.companies where id = v_inv.company_id;

  return jsonb_build_object(
    'email', v_inv.email,
    'role', v_inv.role,
    'status', v_inv.status,
    'expires_at', v_inv.expires_at,
    'company_name', v_company_name,
    'expired', v_inv.expires_at < now()
  );
end;
$$;

revoke all on function public.get_company_invite_preview(text) from public;
grant execute on function public.get_company_invite_preview(text) to authenticated;
grant execute on function public.get_company_invite_preview(text) to anon;
