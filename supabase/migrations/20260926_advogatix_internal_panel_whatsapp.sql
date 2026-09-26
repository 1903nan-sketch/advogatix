-- AdvogaTix core: painel interno + fluxo manual de WhatsApp
-- Aplicado no projeto Supabase llxquroiaehemebuikwg em 26/09/2026.

alter table public.clients
  add column if not exists referred_by text;

alter table public.cases
  add column if not exists claimant text,
  add column if not exists defendant text,
  add column if not exists forum text,
  add column if not exists court_division text,
  add column if not exists hearing_at timestamptz,
  add column if not exists hearing_mode text;

alter table public.cases drop constraint if exists cases_hearing_mode_check;
alter table public.cases
  add constraint cases_hearing_mode_check
  check (hearing_mode is null or hearing_mode in ('presential','remote','hybrid'));

alter table public.case_updates
  add column if not exists event_type text,
  add column if not exists summary text,
  add column if not exists hearing_at timestamptz,
  add column if not exists hearing_mode text,
  add column if not exists expert_at timestamptz,
  add column if not exists expert_location text,
  add column if not exists expert_name text;

alter table public.case_updates alter column notify_client set default false;

update public.case_updates
set event_type = coalesce(event_type, 'custom')
where event_type is null;

alter table public.case_updates alter column event_type set default 'custom';
alter table public.case_updates drop constraint if exists case_updates_event_type_check;
alter table public.case_updates
  add constraint case_updates_event_type_check
  check (event_type in ('hearing','sentence','appellate_decision','expert_exam','custom'));

alter table public.case_updates drop constraint if exists case_updates_hearing_mode_check;
alter table public.case_updates
  add constraint case_updates_hearing_mode_check
  check (hearing_mode is null or hearing_mode in ('presential','remote','hybrid'));

alter table public.notifications
  add column if not exists message_body text,
  add column if not exists response_payload jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists notifications_case_update_channel_unique
  on public.notifications(case_update_id, channel)
  where case_update_id is not null;

create table if not exists public.whatsapp_settings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null unique references public.law_firms(id) on delete cascade,
  provider text not null default 'evolution',
  base_url text not null,
  instance_name text not null,
  api_key text not null,
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_settings_provider_check check (provider in ('evolution'))
);

alter table public.whatsapp_settings enable row level security;

drop policy if exists whatsapp_settings_deny_client_access on public.whatsapp_settings;
create policy whatsapp_settings_deny_client_access
on public.whatsapp_settings
for all
using (false)
with check (false);

drop trigger if exists whatsapp_settings_set_updated_at on public.whatsapp_settings;
create trigger whatsapp_settings_set_updated_at
before update on public.whatsapp_settings
for each row execute function private.set_updated_at();

update public.clients set portal_enabled = false where portal_enabled is true;

drop policy if exists law_firms_select_accessible on public.law_firms;
drop policy if exists law_firms_select_members on public.law_firms;
create policy law_firms_select_members
on public.law_firms for select
using (private.is_firm_member(id));

drop policy if exists clients_select_access on public.clients;
drop policy if exists clients_select_members on public.clients;
create policy clients_select_members
on public.clients for select
using (private.is_firm_member(firm_id));

drop policy if exists cases_select_access on public.cases;
drop policy if exists cases_select_members on public.cases;
create policy cases_select_members
on public.cases for select
using (private.is_firm_member(firm_id));

drop policy if exists case_updates_select_access on public.case_updates;
drop policy if exists case_updates_select_members on public.case_updates;
create policy case_updates_select_members
on public.case_updates for select
using (private.is_firm_member(firm_id));

drop policy if exists documents_select_access on public.documents;
drop policy if exists documents_select_members on public.documents;
create policy documents_select_members
on public.documents for select
using (private.is_firm_member(firm_id));

drop policy if exists notifications_select_access on public.notifications;
drop policy if exists notifications_select_members on public.notifications;
create policy notifications_select_members
on public.notifications for select
using (private.is_firm_member(firm_id));

drop policy if exists cases_insert_member on public.cases;
create policy cases_insert_member
on public.cases for insert
with check (
  private.is_firm_member(firm_id)
  and exists (
    select 1 from public.clients cl
    where cl.id = client_id and cl.firm_id = cases.firm_id
  )
);

drop policy if exists case_updates_insert_member on public.case_updates;
create policy case_updates_insert_member
on public.case_updates for insert
with check (
  private.is_firm_member(firm_id)
  and exists (
    select 1 from public.cases c
    where c.id = case_id and c.firm_id = case_updates.firm_id
  )
);

drop policy if exists documents_insert_member on public.documents;
create policy documents_insert_member
on public.documents for insert
with check (
  private.is_firm_member(firm_id)
  and exists (
    select 1 from public.cases c
    where c.id = case_id and c.firm_id = documents.firm_id
  )
);

create or replace function private.enqueue_case_update_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
begin
  if new.notify_client is not true then
    return new;
  end if;

  select cl.*
    into v_client
  from public.cases c
  join public.clients cl on cl.id = c.client_id
  where c.id = new.case_id
    and c.firm_id = new.firm_id;

  if v_client.id is null
     or v_client.phone is null
     or length(trim(v_client.phone)) = 0 then
    return new;
  end if;

  insert into public.notifications (
    firm_id, client_id, case_id, case_update_id,
    channel, recipient, template_key, status
  )
  values (
    new.firm_id, v_client.id, new.case_id, new.id,
    'whatsapp', v_client.phone, 'case_update', 'pending'
  )
  on conflict (case_update_id, channel)
  where case_update_id is not null
  do update set
    recipient = excluded.recipient,
    status = 'pending',
    error_message = null,
    updated_at = now();

  return new;
end;
$$;

create or replace function private.sync_case_hearing_from_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type = 'hearing' then
    update public.cases
       set hearing_at = coalesce(new.hearing_at, hearing_at),
           hearing_mode = coalesce(new.hearing_mode, hearing_mode),
           updated_at = now()
     where id = new.case_id
       and firm_id = new.firm_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_case_update_sync_hearing on public.case_updates;
create trigger on_case_update_sync_hearing
after insert or update of hearing_at, hearing_mode, event_type
on public.case_updates
for each row execute function private.sync_case_hearing_from_update();

create index if not exists clients_firm_name_idx on public.clients(firm_id, full_name);
create index if not exists cases_firm_client_idx on public.cases(firm_id, client_id);
create index if not exists case_updates_case_event_idx on public.case_updates(case_id, event_date desc);
create index if not exists notifications_firm_created_idx on public.notifications(firm_id, created_at desc);
