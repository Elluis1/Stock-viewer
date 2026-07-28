-- Refuerzo: el owner no puede quitarse de la empresa (ni a sí mismo).
-- Ejecutar en Supabase → SQL.

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

  -- Nadie se elimina a sí mismo; el owner nunca puede salir así
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
