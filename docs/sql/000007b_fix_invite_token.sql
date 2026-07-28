-- Fix: gen_random_bytes no está disponible sin pgcrypto en el search_path.
-- Ejecutá esto en Supabase → SQL (si ya corriste 000007).

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

  update public.company_invites
  set status = 'revoked'
  where company_id = p_company_id
    and email = v_email
    and status = 'pending';

  -- Token sin pgcrypto (dos UUIDs concatenados)
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
