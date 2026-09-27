-- Evolution API centralizada para o AdvogaTix.
-- A chave administrativa fica no Supabase Vault e só pode ser lida por service_role.

alter table public.whatsapp_settings
  alter column base_url drop not null,
  alter column api_key drop not null;

alter table public.whatsapp_settings
  add column if not exists connection_state text,
  add column if not exists connected_number text,
  add column if not exists last_connected_at timestamptz;

create or replace function public.get_advogatix_evolution_config()
returns table(base_url text, api_key text)
language sql
security definer
set search_path = public, vault
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'advogatix_evolution_base_url' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name = 'advogatix_evolution_api_key' limit 1);
$$;

revoke all on function public.get_advogatix_evolution_config() from public;
revoke all on function public.get_advogatix_evolution_config() from anon;
revoke all on function public.get_advogatix_evolution_config() from authenticated;
grant execute on function public.get_advogatix_evolution_config() to service_role;

-- Os segredos abaixo são criados no ambiente remoto via Vault e não são versionados no Git.
