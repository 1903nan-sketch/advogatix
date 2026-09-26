# AdvogaTix

Painel jurídico interno para escritórios acompanharem clientes, processos e movimentações, com envio manual de atualizações pelo WhatsApp.

## Arquitetura

- Frontend estático em `index.html`, `styles.css` e `app.js`
- Autenticação e banco no Supabase
- RLS limitando dados aos membros do escritório
- Edge Function `whatsapp` para armazenar a configuração da Evolution API e enviar mensagens sem expor a API Key no navegador
- Deploy do frontend pela Vercel conectado ao repositório

## Fluxo do cliente

O cliente não possui painel nem login.

O advogado:
1. cadastra cliente e processo;
2. registra uma movimentação;
3. escolhe `Salvar somente` ou `Revisar e enviar`;
4. confere a prévia;
5. confirma o envio;
6. o sistema registra status, horário, telefone, mensagem e ID retornado pela Evolution API.

## Movimentações

- Audiência
- Sentença
- Acórdão
- Perícia
- Movimentação personalizada

## WhatsApp

A integração é configurada no painel em **Configurações > WhatsApp — Evolution API**.

São necessários:
- URL da Evolution API
- nome da instância
- API Key

O envio usa o endpoint `/message/sendText/{instancia}`.

## Supabase

A migração principal está em:

`supabase/migrations/20260926_advogatix_internal_panel_whatsapp.sql`

A Edge Function está em:

`supabase/functions/whatsapp/index.ts`

A API Key da Evolution fica gravada em `whatsapp_settings`, tabela protegida por RLS e acessada pelo backend com credencial de servidor.
