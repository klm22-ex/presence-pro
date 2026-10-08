-- PrésencePro RDC V15 — migration sécurité, paramètres partagés et congés
-- Exécuter UNE FOIS dans Supabase > SQL Editor avec un compte propriétaire du projet.

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public as $$
  select coalesce((select p.role from public.profiles p where p.id=auth.uid()),
                  case when exists(select 1 from public.employees e where e.auth_user_id=auth.uid() and e.active=true) then 'employee' else 'none' end);
$$;
grant execute on function public.current_user_role() to authenticated;

-- Les réglages partagés de l'organisation
create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  organization_name text not null default 'PrésencePro',
  start_time time not null default '08:00',
  end_time time not null default '16:00',
  updated_at timestamptz not null default now()
);
alter table public.organization_settings enable row level security;
revoke all on public.organization_settings from anon;
grant select,insert,update on public.organization_settings to authenticated;
drop policy if exists organization_settings_read on public.organization_settings;
create policy organization_settings_read on public.organization_settings for select to authenticated using (organization_id=public.current_organization_id());
drop policy if exists organization_settings_write on public.organization_settings;
create policy organization_settings_write on public.organization_settings for all to authenticated
using (organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin'))
with check (organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin'));

-- Demandes de congé, absence ou permission
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  request_type text not null check (request_type in ('conge','absence','permission')),
  start_date date not null,
  end_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_requests_org_status_idx on public.leave_requests(organization_id,status,created_at desc);
alter table public.leave_requests enable row level security;
revoke all on public.leave_requests from anon;
grant select,insert,update on public.leave_requests to authenticated;
drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests for select to authenticated using (
  organization_id=public.current_organization_id() and (
    public.current_user_role() in ('owner','admin','manager','viewer') or
    exists(select 1 from public.employees e where e.id=employee_id and e.auth_user_id=auth.uid())
  )
);
drop policy if exists leave_requests_insert_own on public.leave_requests;
create policy leave_requests_insert_own on public.leave_requests for insert to authenticated with check (
  organization_id=public.current_organization_id() and status='pending' and reviewed_by is null and reviewed_at is null and
  exists(select 1 from public.employees e where e.id=employee_id and e.auth_user_id=auth.uid() and e.active=true and e.organization_id=public.leave_requests.organization_id)
);
drop policy if exists leave_requests_admin_update on public.leave_requests;
create policy leave_requests_admin_update on public.leave_requests for update to authenticated using (
  organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager')
) with check (organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager'));

-- Empêche les membres ordinaires de se donner un rôle administrateur.
revoke insert,update,delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
drop policy if exists profiles_org_access on public.profiles;
drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles for select to authenticated using (
  id=auth.uid() or (organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager','viewer'))
);

-- Les employés ne peuvent plus modifier les fiches de leurs collègues.
drop policy if exists employees_org_access on public.employees;
drop policy if exists employees_select_scoped on public.employees;
drop policy if exists employees_admin_insert on public.employees;
drop policy if exists employees_admin_update on public.employees;
drop policy if exists employees_admin_delete on public.employees;
create policy employees_select_scoped on public.employees for select to authenticated using (
 organization_id=public.current_organization_id() and
 (auth_user_id=auth.uid() or public.current_user_role() in ('owner','admin','manager','viewer'))
);
create policy employees_admin_insert on public.employees for insert to authenticated with check (
 organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager')
);
create policy employees_admin_update on public.employees for update to authenticated using (
 organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager')
) with check (organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager'));
create policy employees_admin_delete on public.employees for delete to authenticated using (
 organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin')
);

-- Seuls les administrateurs peuvent modifier les organisations.
drop policy if exists org_members_update on public.organizations;
create policy org_members_update on public.organizations for update to authenticated using (
 id=public.current_organization_id() and public.current_user_role() in ('owner','admin')
) with check (id=public.current_organization_id() and public.current_user_role() in ('owner','admin'));

-- Lecture des pointages : l'employé ne voit que les siens. Les écritures employé passent par la fonction ci-dessous.
drop policy if exists attendance_org_access on public.attendance;
drop policy if exists attendance_select_scoped on public.attendance;
drop policy if exists attendance_admin_insert on public.attendance;
drop policy if exists attendance_admin_update on public.attendance;
drop policy if exists attendance_admin_delete on public.attendance;
create policy attendance_select_scoped on public.attendance for select to authenticated using (
 organization_id=public.current_organization_id() and
 (public.current_user_role() in ('owner','admin','manager','viewer') or exists(select 1 from public.employees e where e.id=employee_id and e.auth_user_id=auth.uid()))
);
create policy attendance_admin_insert on public.attendance for insert to authenticated with check (
 organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager')
);
create policy attendance_admin_update on public.attendance for update to authenticated using (
 organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager')
) with check (organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager'));
create policy attendance_admin_delete on public.attendance for delete to authenticated using (
 organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin')
);

-- Pointage côté serveur pour le QR : l'agent ne peut pas envoyer lui-même des heures arbitraires.
create or replace function public.record_my_attendance(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_emp public.employees%rowtype; v_att public.attendance%rowtype; v_date date; v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  v_now:=now(); v_date:=(v_now at time zone 'Africa/Kinshasa')::date;
  select * into v_emp from public.employees where auth_user_id=auth.uid() and organization_id=p_organization_id and active=true limit 1;
  if v_emp.id is null then raise exception 'Aucun profil employé actif associé à cette organisation'; end if;
  select * into v_att from public.attendance where employee_id=v_emp.id and attendance_date=v_date for update;
  if v_att.id is null then
    insert into public.attendance(organization_id,employee_id,attendance_date,arrival_at,source)
    values(p_organization_id,v_emp.id,v_date,v_now,'qr_employee') returning * into v_att;
    return jsonb_build_object('action','arrival','employee_name',v_emp.full_name,'attendance_date',v_date,'arrival_at',v_att.arrival_at,'departure_at',v_att.departure_at);
  elsif v_att.arrival_at is not null and v_att.departure_at is null then
    update public.attendance set departure_at=v_now,source='qr_employee' where id=v_att.id returning * into v_att;
    return jsonb_build_object('action','departure','employee_name',v_emp.full_name,'attendance_date',v_date,'arrival_at',v_att.arrival_at,'departure_at',v_att.departure_at);
  else
    raise exception 'Arrivée et départ déjà enregistrés pour aujourd’hui';
  end if;
end; $$;
revoke all on function public.record_my_attendance(uuid) from public,anon;
grant execute on function public.record_my_attendance(uuid) to authenticated;

-- Les heures ne doivent pas pouvoir être modifiées par un agent depuis le navigateur.
-- Note : les profils owner/admin/manager conservent le pointage manuel depuis l'interface.

-- Protection des identifiants biométriques : chaque agent ne voit que les siens.
drop policy if exists biometric_org_access on public.biometric_credentials;
drop policy if exists biometric_select_scoped on public.biometric_credentials;
drop policy if exists biometric_admin_write on public.biometric_credentials;
drop policy if exists biometric_employee_insert on public.biometric_credentials;
create policy biometric_select_scoped on public.biometric_credentials for select to authenticated using (
 organization_id=public.current_organization_id() and
 (public.current_user_role() in ('owner','admin','manager','viewer') or exists(select 1 from public.employees e where e.id=employee_id and e.auth_user_id=auth.uid()))
);
create policy biometric_admin_write on public.biometric_credentials for all to authenticated using (
 organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager')
) with check (organization_id=public.current_organization_id() and public.current_user_role() in ('owner','admin','manager'));
create policy biometric_employee_insert on public.biometric_credentials for insert to authenticated with check (
 organization_id=public.current_organization_id() and exists(select 1 from public.employees e where e.id=employee_id and e.auth_user_id=auth.uid() and e.organization_id=public.biometric_credentials.organization_id)
);

-- Les photos sont privées pour les employés ; les responsables gèrent les photos de leur organisation.
drop policy if exists employee_photo_select on storage.objects;
drop policy if exists employee_photo_insert on storage.objects;
drop policy if exists employee_photo_update on storage.objects;
drop policy if exists employee_photo_delete on storage.objects;
create policy employee_photo_select on storage.objects for select to authenticated using (
 bucket_id='employee-photos' and (storage.foldername(name))[1]=public.current_organization_id()::text and public.current_user_role() in ('owner','admin','manager','viewer')
);
create policy employee_photo_insert on storage.objects for insert to authenticated with check (
 bucket_id='employee-photos' and (storage.foldername(name))[1]=public.current_organization_id()::text and public.current_user_role() in ('owner','admin','manager')
);
create policy employee_photo_update on storage.objects for update to authenticated using (
 bucket_id='employee-photos' and (storage.foldername(name))[1]=public.current_organization_id()::text and public.current_user_role() in ('owner','admin','manager')
) with check (bucket_id='employee-photos' and (storage.foldername(name))[1]=public.current_organization_id()::text and public.current_user_role() in ('owner','admin','manager'));
create policy employee_photo_delete on storage.objects for delete to authenticated using (
 bucket_id='employee-photos' and (storage.foldername(name))[1]=public.current_organization_id()::text and public.current_user_role() in ('owner','admin')
);
