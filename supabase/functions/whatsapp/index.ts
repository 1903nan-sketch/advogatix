import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return parsed.default;
    } catch (_) {}
  }
  return "";
}

function getPublishableKey() {
  const modern = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return parsed.default;
    } catch (_) {}
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

function digits(value: string | null | undefined) {
  const raw = String(value ?? "").replace(/\D/g, "");
  if (!raw) return "";
  if ((raw.length === 10 || raw.length === 11) && !raw.startsWith("55")) return "55" + raw;
  return raw;
}

function dateTimeBR(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (_) {
    return value;
  }
}

function modeLabel(value: string | null | undefined) {
  return ({
    presential: "Presencial",
    remote: "Telepresencial",
    hybrid: "Híbrida",
  } as Record<string, string>)[String(value ?? "")] ?? String(value ?? "");
}

function buildMessage(update: any, courtCase: any, client: any) {
  const changed: string[] = [];

  if (update.event_type === "hearing") {
    const lines = ["📅 *Sua audiência foi alterada/agendada.*"];
    if (update.hearing_at) lines.push("Nova data: " + dateTimeBR(update.hearing_at));
    if (update.hearing_mode) lines.push("Modalidade: " + modeLabel(update.hearing_mode));
    if (update.summary) lines.push("Observação: " + update.summary);
    changed.push(lines.join("\n"));
  } else if (update.event_type === "sentence") {
    const lines = ["⚖️ *Foi publicada a sua sentença.*"];
    if (update.summary || update.client_text) lines.push("Resumo: " + (update.summary || update.client_text));
    changed.push(lines.join("\n"));
  } else if (update.event_type === "appellate_decision") {
    const lines = ["📑 *Saiu o seu acórdão.*"];
    if (update.summary || update.client_text) lines.push("Resumo: " + (update.summary || update.client_text));
    changed.push(lines.join("\n"));
  } else if (update.event_type === "expert_exam") {
    const lines = ["🔎 *Sua perícia foi agendada/atualizada.*"];
    if (update.expert_at) lines.push("Data: " + dateTimeBR(update.expert_at));
    if (update.expert_location) lines.push("Local: " + update.expert_location);
    if (update.expert_name) lines.push("Perito(a): " + update.expert_name);
    if (update.summary) lines.push("Observação: " + update.summary);
    changed.push(lines.join("\n"));
  } else {
    const title = update.title ? "*" + update.title + "*" : "*Nova movimentação*";
    const detail = update.summary || update.client_text || "";
    changed.push(detail ? title + "\n" + detail : title);
  }

  const processInfo: string[] = [];
  if (courtCase.claimant) processInfo.push("Reclamante: " + courtCase.claimant);
  if (courtCase.defendant) processInfo.push("Reclamada: " + courtCase.defendant);
  if (courtCase.process_number) processInfo.push("Número do processo: " + courtCase.process_number);
  if (courtCase.forum) processInfo.push("Fórum: " + courtCase.forum);
  if (courtCase.court_division) processInfo.push("Vara: " + courtCase.court_division);
  if (courtCase.hearing_at) processInfo.push("Data de audiência: " + dateTimeBR(courtCase.hearing_at));

  const clientInfo: string[] = [];
  if (client.full_name) clientInfo.push("Cliente: " + client.full_name);
  if (client.phone) clientInfo.push("Telefone: " + client.phone);
  if (client.email) clientInfo.push("E-mail: " + client.email);
  if (client.referred_by) clientInfo.push("Quem indicou o cliente: " + client.referred_by);

  const blocks = [
    "Olá " + (client.full_name || "cliente") + ", houve uma movimentação no seu processo.",
    "*Abaixo, o que mudou:*\n\n" + changed.join("\n\n"),
  ];

  if (processInfo.length) blocks.push("*Informações importantes do processo*\n\n" + processInfo.join("\n"));
  if (clientInfo.length) blocks.push("*Informações importantes do cliente*\n\n" + clientInfo.join("\n"));
  return blocks.join("\n\n");
}

function safeSlug(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45);
}

function stateFromInstance(payload: any) {
  const item = Array.isArray(payload) ? payload[0] : payload;
  return (
    item?.instance?.state ||
    item?.instance?.connectionStatus ||
    item?.connectionStatus ||
    item?.state ||
    item?.status ||
    null
  );
}

function phoneFromInstance(payload: any) {
  const item = Array.isArray(payload) ? payload[0] : payload;
  const raw =
    item?.instance?.ownerJid ||
    item?.ownerJid ||
    item?.instance?.number ||
    item?.number ||
    item?.instance?.profileName ||
    null;
  if (!raw) return null;
  return String(raw).replace(/@.+$/, "");
}

function qrFromPayload(payload: any) {
  if (!payload) return { qr_base64: null, qr_code: null, pairing_code: null };
  const base64 =
    payload?.base64 ||
    payload?.qrcode?.base64 ||
    payload?.data?.base64 ||
    payload?.data?.qrcode?.base64 ||
    null;
  const code =
    payload?.code ||
    payload?.qrcode?.code ||
    payload?.data?.code ||
    payload?.data?.qrcode?.code ||
    null;
  const pairing =
    payload?.pairingCode ||
    payload?.pairing_code ||
    payload?.data?.pairingCode ||
    null;
  return { qr_base64: base64, qr_code: code, pairing_code: pairing };
}

async function parseResponse(response: Response) {
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { payload = { raw }; }
  return { raw, payload };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const publishable = getPublishableKey();
    const secret = getSecretKey();
    if (!url || !publishable || !secret) return json({ error: "Configuração do servidor incompleta." }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sessão necessária." }, 401);

    const authClient = createClient(url, publishable, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const firmId = String(body.firm_id ?? "");
    if (!firmId) return json({ error: "Escritório não informado." }, 400);

    const { data: membership, error: memberError } = await admin
      .from("firm_members")
      .select("role,status")
      .eq("firm_id", firmId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (memberError || !membership) return json({ error: "Sem acesso a este escritório." }, 403);

    const { data: evolutionRows, error: evolutionError } = await admin.rpc("get_advogatix_evolution_config");
    const evolution = Array.isArray(evolutionRows) ? evolutionRows[0] : evolutionRows;
    const baseUrl = String(evolution?.base_url ?? "").replace(/\/+$/, "");
    const globalApiKey = String(evolution?.api_key ?? "");
    if (evolutionError || !baseUrl || !globalApiKey) {
      return json({ error: "Servidor do WhatsApp ainda não está configurado." }, 500);
    }

    if (action === "status") {
      const { data: settings } = await admin
        .from("whatsapp_settings")
        .select("instance_name,enabled,connection_state,connected_number,last_connected_at")
        .eq("firm_id", firmId)
        .maybeSingle();

      if (!settings?.instance_name) {
        return json({ configured: false, enabled: false, connection_state: "not_connected" });
      }

      let remoteState = settings.connection_state || "configured";
      let connectedNumber = settings.connected_number || null;
      try {
        const res = await fetch(
          baseUrl + "/instance/fetchInstances?instanceName=" + encodeURIComponent(settings.instance_name),
          { headers: { apikey: globalApiKey } }
        );
        if (res.ok) {
          const { payload } = await parseResponse(res);
          remoteState = stateFromInstance(payload) || remoteState;
          connectedNumber = phoneFromInstance(payload) || connectedNumber;
          await admin.from("whatsapp_settings").update({
            connection_state: remoteState,
            connected_number: connectedNumber,
            last_connected_at: ["open", "connected"].includes(String(remoteState).toLowerCase())
              ? new Date().toISOString()
              : settings.last_connected_at,
          }).eq("firm_id", firmId);
        }
      } catch (_) {}

      return json({
        configured: true,
        enabled: settings.enabled !== false,
        instance_name: settings.instance_name,
        connection_state: remoteState,
        connected_number: connectedNumber,
      });
    }

    if (action === "connect") {
      if (membership.role !== "owner") {
        return json({ error: "Somente o proprietário pode conectar o WhatsApp." }, 403);
      }

      const { data: firm } = await admin
        .from("law_firms")
        .select("name,slug")
        .eq("id", firmId)
        .single();

      const { data: current } = await admin
        .from("whatsapp_settings")
        .select("*")
        .eq("firm_id", firmId)
        .maybeSingle();

      const instanceName = current?.instance_name ||
        ("advogatix-" + safeSlug(firm?.slug || firm?.name || firmId.slice(0, 8)) + "-" + firmId.slice(0, 8));

      let createPayload: any = null;
      let instanceExists = false;

      try {
        const check = await fetch(
          baseUrl + "/instance/fetchInstances?instanceName=" + encodeURIComponent(instanceName),
          { headers: { apikey: globalApiKey } }
        );
        if (check.ok) {
          const { payload } = await parseResponse(check);
          instanceExists = Array.isArray(payload) ? payload.length > 0 : !!payload?.instance;
        }
      } catch (_) {}

      if (!instanceExists) {
        const createRes = await fetch(baseUrl + "/instance/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: globalApiKey,
          },
          body: JSON.stringify({
            instanceName,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
          }),
        });
        const parsed = await parseResponse(createRes);
        createPayload = parsed.payload;

        if (!createRes.ok) {
          const detail =
            createPayload?.response?.message?.[0] ||
            createPayload?.message ||
            createPayload?.error ||
            parsed.raw ||
            ("HTTP " + createRes.status);
          if (!/already|exist/i.test(String(detail))) {
            return json({ error: "Não foi possível criar a instância do WhatsApp.", detail: String(detail) }, 502);
          }
        }
      }

      await admin.from("whatsapp_settings").upsert({
        firm_id: firmId,
        provider: "evolution",
        base_url: null,
        instance_name: instanceName,
        api_key: null,
        enabled: true,
        connection_state: "connecting",
        updated_by: user.id,
      }, { onConflict: "firm_id" });

      let connectPayload: any = null;
      try {
        const connectRes = await fetch(
          baseUrl + "/instance/connect/" + encodeURIComponent(instanceName),
          { headers: { apikey: globalApiKey } }
        );
        const parsed = await parseResponse(connectRes);
        connectPayload = parsed.payload;
        if (!connectRes.ok && connectRes.status !== 404) {
          return json({
            error: "A instância foi criada, mas não foi possível gerar o QR Code.",
            detail: String(connectPayload?.message || connectPayload?.error || parsed.raw || ("HTTP " + connectRes.status)),
          }, 502);
        }
      } catch (_) {}

      const qr = qrFromPayload(connectPayload || createPayload);
      const connectionState = stateFromInstance(connectPayload) || "connecting";

      await admin.from("whatsapp_settings").update({
        connection_state: connectionState,
      }).eq("firm_id", firmId);

      return json({
        ok: true,
        instance_name: instanceName,
        connection_state: connectionState,
        ...qr,
      });
    }

    if (action === "send") {
      const updateId = String(body.case_update_id ?? "");
      if (!updateId) return json({ error: "Movimentação não informada." }, 400);

      const { data: update, error: updateError } = await admin
        .from("case_updates")
        .select("*")
        .eq("id", updateId)
        .eq("firm_id", firmId)
        .maybeSingle();

      if (updateError || !update) return json({ error: "Movimentação não encontrada." }, 404);
      if (!update.notify_client) return json({ error: "Esta movimentação não foi marcada para envio ao cliente." }, 400);

      const { data: courtCase, error: caseError } = await admin
        .from("cases")
        .select("*")
        .eq("id", update.case_id)
        .eq("firm_id", firmId)
        .maybeSingle();

      if (caseError || !courtCase) return json({ error: "Processo não encontrado." }, 404);

      const { data: client, error: clientError } = await admin
        .from("clients")
        .select("*")
        .eq("id", courtCase.client_id)
        .eq("firm_id", firmId)
        .maybeSingle();

      if (clientError || !client) return json({ error: "Cliente não encontrado." }, 404);

      const phone = digits(client.phone);
      if (!phone) return json({ error: "O cliente não possui telefone cadastrado." }, 400);

      const { data: settings, error: settingsError } = await admin
        .from("whatsapp_settings")
        .select("*")
        .eq("firm_id", firmId)
        .maybeSingle();

      if (settingsError || !settings?.enabled || !settings?.instance_name) {
        return json({ error: "WhatsApp ainda não foi conectado para este escritório." }, 400);
      }

      const message = buildMessage(update, courtCase, client);

      let notification = null;
      const { data: existing } = await admin
        .from("notifications")
        .select("*")
        .eq("case_update_id", update.id)
        .eq("channel", "whatsapp")
        .maybeSingle();

      if (existing) {
        notification = existing;
        await admin.from("notifications").update({
          recipient: phone,
          message_body: message,
          status: "pending",
          error_message: null,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        const { data: created, error: createError } = await admin
          .from("notifications")
          .insert({
            firm_id: firmId,
            client_id: client.id,
            case_id: courtCase.id,
            case_update_id: update.id,
            channel: "whatsapp",
            recipient: phone,
            template_key: "case_update",
            status: "pending",
            message_body: message,
          })
          .select("*")
          .single();

        if (createError) throw createError;
        notification = created;
      }

      const endpoint = baseUrl + "/message/sendText/" + encodeURIComponent(settings.instance_name);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: globalApiKey,
          },
          body: JSON.stringify({
            number: phone,
            text: message,
            delay: 600,
            linkPreview: false,
          }),
        });

        const parsed = await parseResponse(response);
        const payload = parsed.payload;

        if (!response.ok) {
          const errorMessage =
            payload?.response?.message?.[0] ||
            payload?.message ||
            payload?.error ||
            parsed.raw ||
            ("HTTP " + response.status);

          await admin.from("notifications").update({
            status: "failed",
            error_message: String(errorMessage).slice(0, 1000),
            response_payload: payload,
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);

          return json({ error: "Falha ao enviar pelo WhatsApp.", detail: String(errorMessage), message }, 502);
        }

        const providerMessageId =
          payload?.key?.id ||
          payload?.data?.key?.id ||
          payload?.messageId ||
          payload?.id ||
          null;

        await admin.from("notifications").update({
          status: "sent",
          provider_message_id: providerMessageId,
          error_message: null,
          message_body: message,
          response_payload: payload,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);

        return json({ ok: true, status: "sent", message, provider_message_id: providerMessageId });
      } catch (sendError) {
        const detail = sendError instanceof Error ? sendError.message : String(sendError);
        await admin.from("notifications").update({
          status: "failed",
          error_message: detail.slice(0, 1000),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);

        return json({ error: "Não foi possível conectar à Evolution API.", detail, message }, 502);
      }
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message || "Erro inesperado." }, 500);
  }
});