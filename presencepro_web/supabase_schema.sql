-- PrésencePro RDC — Supabase database schema
-- Run this script in Supabase SQL Editor.
-- It creates the multi-tenant core, RLS, attendance, and private employee-photo storage.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  role text not null default 'admin' check (role in ('owner','admin','manager','viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  code text not null,
  department text,
  photo_path text,
  auth_user_id uuid references auth.users(id) on delete set null,
  enrollment_code text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

alter table public.employees add column if not exists enrollment_code text unique;
update public.employees set enrollment_code = 'PP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)) where enrollment_code is null and auth_user_id is null;

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  attendance_date date not null default current_date,
  arrival_at timestamptz,
  departure_at timestamptz,
  source text not null default 'tablet_biometric' check (source in ('manual','tablet_biometric','qr_employee','admin')),
  created_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

-- Stores only a WebAuthn credential identifier, never a fingerprint image/template.
-- Full cryptographic verification should be performed by a server-side WebAuthn verifier.
create table if not exists public.biometric_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  credential_id text not null,
  device_label text,
  created_at timestamptz not null default now(),
  unique (credential_id)
);

create index if not exists employees_org_idx on public.employees(organization_id);
create index if not exists employees_auth_user_idx on public.employees(auth_user_id);
create index if not exists attendance_org_date_idx on public.attendance(organization_id, attendance_date desc);
create index if not exists biometric_org_idx on public.biometric_credentials(organization_id);

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select organization_id from public.profiles where id = auth.uid()),
    (select organization_id from public.employees where auth_user_id = auth.uid() limit 1)
  );
$$;

create or replace function public.create_organization(p_name text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.organizations(name) values (trim(p_name)) returning id into v_org;
  insert into public.profiles(id, organization_id, full_name, role)
  values (auth.uid(), v_org, nullif(trim(p_full_name), ''), 'owner')
  on conflict (id) do update set organization_id = excluded.organization_id, full_name = excluded.full_name;
  return v_org;
end;
$$;

grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.create_organization(text,text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','employees','attendance','biometric_credentials'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Remove broad defaults, then allow only authenticated users through RLS.
revoke all on table public.organizations, public.profiles, public.employees, public.attendance, public.biometric_credentials from anon;
grant select, insert, update, delete on public.organizations, public.profiles, public.employees, public.attendance, public.biometric_credentials to authenticated;

drop policy if exists org_members_select on public.organizations;
create policy org_members_select on public.organizations for select to authenticated using (id = public.current_organization_id());

drop policy if exists profiles_org_access on public.profiles;
create policy profiles_org_access on public.profiles for all to authenticated using (organization_id = public.current_organization_id()) with check (organization_id = public.current_organization_id());

drop policy if exists employees_org_access on public.employees;
create policy employees_org_access on public.employees for all to authenticated using (organization_id = public.current_organization_id()) with check (organization_id = public.current_organization_id());

drop policy if exists attendance_org_access on public.attendance;
create policy attendance_org_access on public.attendance for all to authenticated using (organization_id = public.current_organization_id()) with check (organization_id = public.current_organization_id());

drop policy if exists biometric_org_access on public.biometric_credentials;
create policy biometric_org_access on public.biometric_credentials for all to authenticated using (organization_id = public.current_organization_id()) with check (organization_id = public.current_organization_id());

-- Private bucket for agent photos.
insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', false)
on conflict (id) do nothing;

-- File path convention: organization_id/employee_id.ext

drop policy if exists employee_photo_select on storage.objects;
create policy employee_photo_select on storage.objects for select to authenticated
using (bucket_id = 'employee-photos' and (storage.foldername(name))[1] = public.current_organization_id()::text);

drop policy if exists employee_photo_insert on storage.objects;
create policy employee_photo_insert on storage.objects for insert to authenticated
with check (bucket_id = 'employee-photos' and (storage.foldername(name))[1] = public.current_organization_id()::text);

drop policy if exists employee_photo_update on storage.objects;
create policy employee_photo_update on storage.objects for update to authenticated
using (bucket_id = 'employee-photos' and (storage.foldername(name))[1] = public.current_organization_id()::text)
with check (bucket_id = 'employee-photos' and (storage.foldername(name))[1] = public.current_organization_id()::text);

drop policy if exists employee_photo_delete on storage.objects;
create policy employee_photo_delete on storage.objects for delete to authenticated
using (bucket_id = 'employee-photos' and (storage.foldername(name))[1] = public.current_organization_id()::text);


-- Associe le compte connecté d'un employé à son profil grâce à un code d'association
-- temporaire fourni par l'administrateur. Le code est consommé après association.
create or replace function public.employee_claim(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into v_id from public.employees where upper(enrollment_code)=upper(trim(p_code)) and auth_user_id is null and active=true limit 1;
  if v_id is null then raise exception 'Employé introuvable ou déjà associé'; end if;
  update public.employees set auth_user_id=auth.uid(), enrollment_code=null where id=v_id;
  return v_id;
end;
$$;

grant execute on function public.employee_claim(text) to authenticated;
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

-- V15 add-on: permissions for biometric credentials and private employee photos.
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
