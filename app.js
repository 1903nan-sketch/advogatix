(() => {
  // Registrado antes de tudo para funcionar mesmo se o restante do script falhar.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {}));
  }

  const SUPABASE_URL = "https://xraygbmishqxyrtiwyxy.supabase.co";
  const SUPABASE_KEY = "sb_publishable_jXk4NFg_HOVtfq0KXJ375w_egKlnJXz";

  // Este preview usa o mesmo Supabase da produção. Enquanto não houver um banco
  // separado para o preview, todas as gravações, uploads, exclusões e chamadas
  // de Edge Functions (inclusive envio de WhatsApp) ficam bloqueadas aqui.
  const PREVIEW_READ_ONLY = false;
  const PREVIEW_MESSAGE = "Modo preview (somente leitura): nenhuma alteração é gravada nos dados reais.";
  const TIME_ZONE = "America/Sao_Paulo";
  const SETUP_PASSWORD_MODE = new URLSearchParams(location.search).get("setup") === "password";
  let completingPasswordSetup = false;

  // Histórico de atividades: a tabela "activity_logs" ainda não existe no Supabase.
  // Ao criá-la (ver docs/supabase-pendencias.md), mude para true para gravar e ler os registros.
  const ACTIVITY_LOG_ENABLED = false;

  if (!window.supabase?.createClient) {
    const status = document.getElementById("authStatus");
    const submit = document.getElementById("authSubmit");
    if (status) {
      status.textContent = "Não foi possível carregar o acesso seguro. Verifique sua conexão e atualize a página.";
      status.className = "status err";
    }
    if (submit) submit.disabled = true;
    console.error("AdvogaTix: biblioteca do Supabase indisponível.");
    return;
  }

  const rawSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "advogatix" } });
  const supabase = PREVIEW_READ_ONLY ? readOnlyClient(rawSupabase) : rawSupabase;

  function blockedResult() {
    const result = Promise.resolve({ data: null, error: new Error(PREVIEW_MESSAGE) });
    const chain = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === "then") return result.then.bind(result);
        if (prop === "catch") return result.catch.bind(result);
        if (prop === "finally") return result.finally.bind(result);
        return () => chain;
      },
    });
    return chain;
  }

  function readOnlyClient(client) {
    const tableWrites = new Set(["insert", "update", "upsert", "delete"]);
    const storageWrites = new Set(["upload", "update", "remove", "move", "copy", "uploadToSignedUrl", "createSignedUploadUrl"]);
    const guard = (target, blocked) => new Proxy(target, {
      get(obj, prop) {
        if (blocked.has(prop)) return () => blockedResult();
        const value = obj[prop];
        return typeof value === "function" ? value.bind(obj) : value;
      },
    });
    return {
      auth: client.auth,
      from: (table) => guard(client.from(table), tableWrites),
      rpc: () => blockedResult(),
      storage: { from: (bucket) => guard(client.storage.from(bucket), storageWrites) },
      functions: { invoke: async () => ({ data: null, error: new Error(PREVIEW_MESSAGE) }) },
    };
  }

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const state = {
    user: null,
    firm: null,
    role: null,
    isPlatformAdmin: false,
    accessControl: null,
    clients: [],
    cases: [],
    updates: [],
    notifications: [],
    deadlines: [],
    tasks: [],
    calendarEvents: [],
    financialEntries: [],
    documents: [],
    templates: [],
    leads: [],
    clientInteractions: [],
    checklistItems: [],
    activeClientFileId: null,
    activeCaseWorkspaceId: null,
    pendingMovement: null,
    whatsapp: { configured: false, enabled: false, base_url: "", instance_name: "", api_key_masked: "" },
    editingClientId: null,
    editingCaseId: null,
    editingDeadlineId: null,
    editingTaskId: null,
    editingEventId: null,
    editingFinanceId: null,
    editingLeadId: null,
    editingTemplateId: null,
  };

  const statusLabels = {
    new: "Novo",
    in_progress: "Em andamento",
    awaiting_court: "Aguardando tribunal",
    awaiting_client: "Aguardando cliente",
    suspended: "Suspenso",
    closed: "Encerrado",
    archived: "Arquivado",
  };

  const eventLabels = {
    hearing: "Audiência",
    sentence: "Sentença",
    appellate_decision: "Acórdão",
    expert_exam: "Perícia",
    custom: "Movimentação",
  };

  const modeLabels = {
    presential: "Presencial",
    remote: "Telepresencial",
    hybrid: "Híbrida",
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[m]);
  }

  function norm(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function brDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        timeZone: TIME_ZONE,
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  // Datas e horas são sempre digitadas e exibidas no horário de Brasília,
  // independentemente do fuso configurado no aparelho.
  const zonedFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  function zonedParts(date) {
    const parts = {};
    zonedFormatter.formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    return parts;
  }

  function zoneOffsetMs(date) {
    const p = zonedParts(date);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
  }

  function toIso(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    if (!m) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return new Date(asUtc - zoneOffsetMs(new Date(asUtc))).toISOString();
  }

  function toLocalInput(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const p = zonedParts(d);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }

  function dateKey(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const p = zonedParts(d);
    return `${p.year}-${p.month}-${p.day}`;
  }

  function toast(message, type = "ok") {
    const wrap = $("#toastWrap");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function setStatus(el, message = "", type = "") {
    if (!el) return;
    el.textContent = message;
    el.className = `status ${type}`;
  }

  function setBusy(button, busy, label = "Aguarde") {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("loading", busy);
    button.setAttribute("aria-busy", String(busy));
    if (busy) {
      if (!button.dataset.oldText) button.dataset.oldText = button.textContent;
      button.textContent = label;
    } else if (button.dataset.oldText) {
      button.textContent = button.dataset.oldText;
      delete button.dataset.oldText;
    }
  }

  function openDialog(id) {
    const dialog = $("#" + id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(id) {
    const dialog = $("#" + id);
    if (dialog?.open) dialog.close();
  }

  // Campos que mudaram entre o registro atual e o payload salvo (para o histórico).
  function changedFields(before, after) {
    if (!before) return [];
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    return Object.keys(after).filter((key) => !same(before[key], after[key]));
  }

  // Registra uma atividade importante. Nunca interrompe o fluxo principal:
  // falhas (tabela ausente, permissão) só geram aviso no console.
  async function logActivity(action, entityType, entityId, summary, metadata = {}) {
    if (!ACTIVITY_LOG_ENABLED || PREVIEW_READ_ONLY || !state.firm || !state.user) return;
    try {
      const { error } = await supabase.from("activity_logs").insert({
        firm_id: state.firm.id,
        actor_id: state.user.id,
        action,
        entity_type: entityType,
        entity_id: entityId || null,
        summary: String(summary || "").slice(0, 300),
        metadata,
      });
      if (error) console.warn("Histórico não registrado:", error.message);
    } catch (error) {
      console.warn("Histórico não registrado:", error);
    }
  }

  function badge(text, type = "") {
    return `<span class="badge ${type}">${esc(text)}</span>`;
  }

  function notificationForUpdate(updateId) {
    return state.notifications.find((n) => n.case_update_id === updateId && n.channel === "whatsapp");
  }

  function clientById(id) {
    return state.clients.find((c) => c.id === id);
  }

  function caseById(id) {
    return state.cases.find((c) => c.id === id);
  }

  function updateBrand() {
    $$("#firmName").forEach((el) => {
      el.textContent = state.firm?.name || "AdvogaTix";
    });
    $("#userLabel").textContent = state.user?.email || "Conectado";
    $("#roleLabel").textContent = state.role === "owner" ? "Proprietário" : state.role === "lawyer" ? "Advogado" : "Equipe";
  }

  async function invokeWhatsapp(body) {
    if (PREVIEW_READ_ONLY) throw new Error(PREVIEW_MESSAGE);
    const { data, error } = await supabase.functions.invoke("whatsapp", { body });
    if (!error) return data;

    let message = error.message || "Falha na integração do WhatsApp.";
    try {
      if (error.context?.clone) {
        const payload = await error.context.clone().json();
        message = payload?.error || payload?.detail || message;
      } else if (error.context?.json) {
        const payload = await error.context.json();
        message = payload?.error || payload?.detail || message;
      }
    } catch (_) {}
    throw new Error(message);
  }

  $("#togglePassword").addEventListener("click", () => {
    const input = $("#password");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    $("#togglePassword").textContent = showing ? "Mostrar" : "Ocultar";
    $("#togglePassword").setAttribute("aria-label", showing ? "Mostrar senha" : "Ocultar senha");
    $("#togglePassword").title = showing ? "Mostrar senha" : "Ocultar senha";
  });

  $("#forgotPasswordBtn")?.addEventListener("click", async () => {
    const email = $("#email").value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus($("#authStatus"), "Informe seu e-mail no campo acima para recuperar a senha.", "err");
      $("#email").focus();
      return;
    }
    const button = $("#forgotPasswordBtn");
    setBusy(button, true, "Enviando");
    try {
      const redirectTo = new URL(location.pathname + "?setup=password", location.origin).href;
      const { error } = await rawSupabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setStatus($("#authStatus"), "Se houver uma conta para esse e-mail, você receberá um link para redefinir a senha. Confira também o spam.", "ok");
    } catch (error) {
      setStatus($("#authStatus"), error?.message || "Não foi possível enviar o e-mail de recuperação.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter || $("#authSubmit");
    const email = $("#email").value.trim();
    const password = $("#password").value;
    setBusy(button, true, "Entrando");
    setStatus($("#authStatus"), "Aguarde...");

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await boot();
    } catch (error) {
      const message = String(error?.message || "");
      const friendly = /invalid login credentials/i.test(message)
        ? "E-mail ou senha inválidos."
        : /failed to fetch|network|load failed/i.test(message)
          ? "Sem conexão com o servidor. Verifique sua internet e tente novamente."
          : (message || "Não foi possível entrar.");
      setStatus($("#authStatus"), friendly, "err");
    } finally {
      setBusy(button, false);
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.reload();
  });

  $("#setupPasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter || $("#setupPasswordBtn");
    const password = $("#setupPasswordInput").value;
    const confirmation = $("#setupPasswordConfirm").value;

    if (PREVIEW_READ_ONLY) {
      setStatus($("#setupPasswordStatus"), PREVIEW_MESSAGE, "err");
      return;
    }
    if (password.length < 8) {
      setStatus($("#setupPasswordStatus"), "Use uma senha com pelo menos 8 caracteres.", "err");
      return;
    }
    if (password !== confirmation) {
      setStatus($("#setupPasswordStatus"), "As senhas não conferem.", "err");
      return;
    }

    setBusy(button, true, "Salvando");
    setStatus($("#setupPasswordStatus"), "Criando sua senha...");
    try {
      const { error } = await rawSupabase.auth.updateUser({ password });
      if (error) throw error;

      sessionStorage.setItem("advogatix_password_created", "1");
      completingPasswordSetup = true;
      await rawSupabase.auth.signOut();
      location.replace(location.pathname);
    } catch (error) {
      setStatus($("#setupPasswordStatus"), error.message || "Não foi possível criar a senha.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  const validSections = new Set(["overview","clients","cases","deadlines","agenda","tasks","finance","documents","templates","crm","reports","movements","messages","activity","settings"]);

  function switchSection(section, options = {}) {
    if (!validSections.has(section)) section = "overview";
    $$(".nav button").forEach((btn) => btn.classList.toggle("active", btn.dataset.section === section));
    $$(".section").forEach((el) => el.classList.toggle("show", el.id === `section-${section}`));
    const activeButton = $(`.nav button[data-section="${section}"]`);
    activeButton?.scrollIntoView({ block: "nearest", inline: "center", behavior: options.instant ? "auto" : "smooth" });
    window.scrollTo({ top: 0, behavior: options.instant ? "auto" : "smooth" });
    if (options.updateHash !== false && location.hash !== `#${section}`) {
      history.pushState({ section }, "", `#${section}`);
    }
    if (section === "settings") loadWhatsappStatus();
  }

  $$(".nav button").forEach((btn) => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
  });

  window.addEventListener("popstate", () => {
    const section = location.hash.replace(/^#/, "");
    switchSection(validSections.has(section) ? section : "overview", { updateHash: false, instant: true });
  });

  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest("dialog")?.close());
  });

  $("#quickClient").addEventListener("click", () => openClientDialog());
  $("#quickCase").addEventListener("click", () => openCaseDialog());
  $("#quickMovement").addEventListener("click", () => openMovementDialog());
  $("#newClientBtn").addEventListener("click", () => openClientDialog());
  $("#newCaseBtn").addEventListener("click", () => openCaseDialog());
  $("#newMovementBtn").addEventListener("click", () => openMovementDialog());

  function openClientDialog(clientId = null, prefill = null) {
    state.editingClientId = clientId;
    $("#clientForm").reset();
    setStatus($("#clientStatus"));

    const client = clientId ? clientById(clientId) : null;
    $("#clientDialogTitle").textContent = client ? "Editar cliente" : "Novo cliente";
    $("#clientSaveBtn").textContent = client ? "Salvar alterações" : "Cadastrar cliente";

    if (client) {
      $("#cName").value = client.full_name || "";
      $("#cEmail").value = client.email || "";
      $("#cPhone").value = client.phone || "";
      $("#cReferred").value = client.referred_by || "";
      $("#cCpfCnpj").value = client.cpf_cnpj || "";
      $("#cRg").value = client.rg || "";
      $("#cBirth").value = client.birth_date || "";
      $("#cProfession").value = client.profession || "";
      $("#cMarital").value = client.marital_status || "";
      $("#cPostalCode").value = client.postal_code || "";
      $("#cAddress").value = client.address_line || "";
      $("#cCity").value = client.city || "";
      $("#cStateCode").value = client.state_code || "";
      $("#cTags").value = Array.isArray(client.tags) ? client.tags.join(", ") : "";
      $("#cFavorite").value = client.is_favorite ? "true" : "false";
      $("#cBankName").value = client.bank_name || "";
      $("#cBankBranch").value = client.bank_branch || "";
      $("#cBankAccount").value = client.bank_account || "";
      $("#cPixKey").value = client.pix_key || "";
      $("#cNotes").value = client.notes || "";
      $("#cStatus").value = client.status || "active";
    } else {
      $("#cStatus").value = "active";
      if (prefill) {
        $("#cName").value = prefill.full_name || "";
        $("#cPhone").value = prefill.phone || "";
        $("#cEmail").value = prefill.email || "";
        $("#cNotes").value = prefill.notes || "";
      }
    }
    openDialog("clientDialog");
  }

  $("#clientForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Salvando");

    const payload = {
      full_name: $("#cName").value.trim(),
      email: $("#cEmail").value.trim() || null,
      phone: $("#cPhone").value.trim() || null,
      referred_by: $("#cReferred").value.trim() || null,
      cpf_cnpj: $("#cCpfCnpj").value.trim() || null,
      rg: $("#cRg").value.trim() || null,
      birth_date: $("#cBirth").value || null,
      profession: $("#cProfession").value.trim() || null,
      marital_status: $("#cMarital").value.trim() || null,
      postal_code: $("#cPostalCode").value.trim() || null,
      address_line: $("#cAddress").value.trim() || null,
      city: $("#cCity").value.trim() || null,
      state_code: $("#cStateCode").value.trim().toUpperCase() || null,
      tags: $("#cTags").value.split(",").map((x) => x.trim()).filter(Boolean),
      is_favorite: $("#cFavorite").value === "true",
      bank_name: $("#cBankName").value.trim() || null,
      bank_branch: $("#cBankBranch").value.trim() || null,
      bank_account: $("#cBankAccount").value.trim() || null,
      pix_key: $("#cPixKey").value.trim() || null,
      notes: $("#cNotes").value.trim() || null,
      status: $("#cStatus").value,
      portal_enabled: false,
    };

    try {
      if (state.editingClientId) {
        const before = clientById(state.editingClientId);
        const { error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", state.editingClientId)
          .eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Cliente atualizado.");
        logActivity("client.updated", "client", state.editingClientId, "Cliente editado: " + payload.full_name, { fields: changedFields(before, payload) });
      } else {
        const { data: created, error } = await supabase.from("clients").insert({
          ...payload,
          firm_id: state.firm.id,
          created_by: state.user.id,
        }).select("id").single();
        if (error) throw error;
        toast("Cliente cadastrado.");
        logActivity("client.created", "client", created?.id, "Cliente criado: " + payload.full_name);
      }
      closeDialog("clientDialog");
      await loadData();
    } catch (error) {
      setStatus($("#clientStatus"), error.message || "Não foi possível salvar o cliente.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function fillClientSelect(selected = "") {
    $("#caseClient").innerHTML = state.clients
      .filter((c) => c.status === "active" || c.id === selected)
      .map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.full_name)}</option>`)
      .join("");
  }

  function openCaseDialog(caseId = null) {
    if (!state.clients.length) {
      toast("Cadastre um cliente antes de criar um processo.", "err");
      switchSection("clients");
      return;
    }

    state.editingCaseId = caseId;
    $("#caseForm").reset();
    setStatus($("#caseStatusMsg"));

    const item = caseId ? caseById(caseId) : null;
    $("#caseDialogTitle").textContent = item ? "Editar processo" : "Novo processo";
    $("#caseSaveBtn").textContent = item ? "Salvar alterações" : "Cadastrar processo";
    fillClientSelect(item?.client_id || "");

    if (item) {
      $("#caseTitle").value = item.title || "";
      $("#caseNumber").value = item.process_number || "";
      $("#caseClaimant").value = item.claimant || "";
      $("#caseDefendant").value = item.defendant || "";
      $("#caseForum").value = item.forum || "";
      $("#caseDivision").value = item.court_division || "";
      $("#caseCourt").value = item.court || "";
      $("#caseType").value = item.case_type || "";
      $("#caseLegalArea").value = item.legal_area || "";
      $("#caseValue").value = item.case_value ?? "";
      $("#casePriority").value = item.priority || "normal";
      $("#caseTags").value = Array.isArray(item.tags) ? item.tags.join(", ") : "";
      $("#caseFavorite").value = item.is_favorite ? "true" : "false";
      $("#caseHearing").value = toLocalInput(item.hearing_at);
      $("#caseHearingMode").value = item.hearing_mode || "";
      $("#caseStatus").value = item.status || "in_progress";
      $("#caseSummary").value = item.client_summary || "";
    } else {
      $("#caseStatus").value = "in_progress";
      $("#casePriority").value = "normal";
      $("#caseFavorite").value = "false";
    }

    openDialog("caseDialog");
  }

  $("#caseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Salvando");

    const payload = {
      client_id: $("#caseClient").value,
      title: $("#caseTitle").value.trim(),
      process_number: $("#caseNumber").value.trim() || null,
      claimant: $("#caseClaimant").value.trim() || null,
      defendant: $("#caseDefendant").value.trim() || null,
      forum: $("#caseForum").value.trim() || null,
      court_division: $("#caseDivision").value.trim() || null,
      court: $("#caseCourt").value.trim() || null,
      case_type: $("#caseType").value.trim() || null,
      legal_area: $("#caseLegalArea").value.trim() || null,
      case_value: $("#caseValue").value ? Number($("#caseValue").value) : null,
      priority: $("#casePriority").value || "normal",
      tags: $("#caseTags").value.split(",").map((x) => x.trim()).filter(Boolean),
      is_favorite: $("#caseFavorite").value === "true",
      hearing_at: toIso($("#caseHearing").value),
      hearing_mode: $("#caseHearingMode").value || null,
      status: $("#caseStatus").value,
      client_summary: $("#caseSummary").value.trim() || null,
    };

    try {
      if (state.editingCaseId) {
        const before = caseById(state.editingCaseId);
        const { error } = await supabase
          .from("cases")
          .update(payload)
          .eq("id", state.editingCaseId)
          .eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Processo atualizado.");
        logActivity("case.updated", "case", state.editingCaseId, "Processo editado: " + payload.title, {
          case_id: state.editingCaseId, fields: changedFields(before, payload),
          status_from: before?.status, status_to: payload.status,
        });
      } else {
        const { data: created, error } = await supabase.from("cases").insert({
          ...payload,
          firm_id: state.firm.id,
          created_by: state.user.id,
        }).select("id").single();
        if (error) throw error;
        toast("Processo cadastrado.");
        logActivity("case.created", "case", created?.id, "Processo criado: " + payload.title, { case_id: created?.id });
      }
      closeDialog("caseDialog");
      await loadData();
    } catch (error) {
      setStatus($("#caseStatusMsg"), error.message || "Não foi possível salvar o processo.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function fillCaseSelect(selected = "") {
    $("#movementCase").innerHTML = state.cases
      .filter((c) => !["archived"].includes(c.status) || c.id === selected)
      .map((c) => {
        const client = clientById(c.client_id);
        const number = c.process_number ? ` — ${c.process_number}` : "";
        return `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(client?.full_name || "Cliente")} — ${esc(c.title)}${esc(number)}</option>`;
      })
      .join("");
  }

  function eventTitle(type) {
    if (type === "hearing") return "Audiência atualizada";
    if (type === "sentence") return "Sentença publicada";
    if (type === "appellate_decision") return "Acórdão publicado";
    if (type === "expert_exam") return "Perícia agendada";
    return $("#movementCustomTitle").value.trim() || "Nova movimentação";
  }

  function refreshMovementFields() {
    const type = $("#movementType").value;
    $("#hearingFields").classList.toggle("hidden", type !== "hearing");
    $("#decisionFields").classList.toggle("hidden", !["sentence", "appellate_decision"].includes(type));
    $("#expertFields").classList.toggle("hidden", type !== "expert_exam");
    $("#customFields").classList.toggle("hidden", type !== "custom");
  }

  $("#movementType").addEventListener("change", refreshMovementFields);

  function openMovementDialog(caseId = null) {
    if (!state.cases.length) {
      toast("Cadastre um processo antes de adicionar uma movimentação.", "err");
      switchSection("cases");
      return;
    }

    $("#movementForm").reset();
    state.pendingMovement = null;
    fillCaseSelect(caseId || "");
    $("#movementType").value = "hearing";
    refreshMovementFields();
    setStatus($("#movementStatus"));
    openDialog("movementDialog");
  }

  function collectMovement(notifyClient) {
    const type = $("#movementType").value;
    const summary =
      ["sentence", "appellate_decision"].includes(type)
        ? $("#movementDecisionSummary").value.trim()
        : type === "custom"
          ? $("#movementCustomSummary").value.trim()
          : type === "expert_exam"
            ? $("#movementExpertSummary").value.trim()
            : $("#movementHearingSummary").value.trim();

    return {
      firm_id: state.firm.id,
      case_id: $("#movementCase").value,
      created_by: state.user.id,
      event_type: type,
      title: eventTitle(type),
      legal_text: $("#movementLegal").value.trim() || null,
      client_text: summary || eventTitle(type),
      summary: summary || null,
      hearing_at: type === "hearing" ? toIso($("#movementHearing").value) : null,
      hearing_mode: type === "hearing" ? ($("#movementHearingMode").value || null) : null,
      expert_at: type === "expert_exam" ? toIso($("#movementExpertAt").value) : null,
      expert_location: type === "expert_exam" ? ($("#movementExpertLocation").value.trim() || null) : null,
      expert_name: type === "expert_exam" ? ($("#movementExpertName").value.trim() || null) : null,
      visibility: "internal",
      notify_client: notifyClient,
    };
  }

  function validateMovementForSend(data) {
    const item = caseById(data.case_id);
    const client = item ? clientById(item.client_id) : null;
    if (!item || !client) return "Selecione um processo válido.";
    if (!client.phone?.trim()) return "Cadastre o telefone do cliente antes do envio.";
    if (data.event_type === "hearing" && !data.hearing_at) return "Informe a nova data da audiência.";
    if (["sentence", "appellate_decision"].includes(data.event_type) && !data.summary) return "Informe o resumo da decisão.";
    if (data.event_type === "expert_exam" && !data.expert_at) return "Informe a data da perícia.";
    if (data.event_type === "custom" && !data.summary) return "Informe o resumo da movimentação.";
    return "";
  }

  function buildPreview(data) {
    const item = caseById(data.case_id);
    const client = clientById(item?.client_id);
    const changed = [];

    if (data.event_type === "hearing") {
      const lines = ["📅 *Sua audiência foi alterada/agendada.*"];
      if (data.hearing_at) lines.push(`Nova data: ${brDate(data.hearing_at)}`);
      if (data.hearing_mode) lines.push(`Modalidade: ${modeLabels[data.hearing_mode]}`);
      if (data.summary) lines.push(`Observação: ${data.summary}`);
      changed.push(lines.join("\n"));
    } else if (data.event_type === "sentence") {
      changed.push(`⚖️ *Foi publicada a sua sentença.*\nResumo: ${data.summary || data.client_text}`);
    } else if (data.event_type === "appellate_decision") {
      changed.push(`📑 *Saiu o seu acórdão.*\nResumo: ${data.summary || data.client_text}`);
    } else if (data.event_type === "expert_exam") {
      const lines = ["🔎 *Sua perícia foi agendada/atualizada.*"];
      if (data.expert_at) lines.push(`Data: ${brDate(data.expert_at)}`);
      if (data.expert_location) lines.push(`Local: ${data.expert_location}`);
      if (data.expert_name) lines.push(`Perito(a): ${data.expert_name}`);
      if (data.summary) lines.push(`Observação: ${data.summary}`);
      changed.push(lines.join("\n"));
    } else {
      changed.push(`*${data.title}*${data.summary ? "\n" + data.summary : ""}`);
    }

    const processInfo = [];
    if (item?.claimant) processInfo.push(`Reclamante: ${item.claimant}`);
    if (item?.defendant) processInfo.push(`Reclamada: ${item.defendant}`);
    if (item?.process_number) processInfo.push(`Número do processo: ${item.process_number}`);
    if (item?.forum) processInfo.push(`Fórum: ${item.forum}`);
    if (item?.court_division) processInfo.push(`Vara: ${item.court_division}`);
    const effectiveHearing = data.event_type === "hearing" && data.hearing_at ? data.hearing_at : item?.hearing_at;
    if (effectiveHearing) processInfo.push(`Data de audiência: ${brDate(effectiveHearing)}`);

    const clientInfo = [];
    if (client?.full_name) clientInfo.push(`Cliente: ${client.full_name}`);
    if (client?.phone) clientInfo.push(`Telefone: ${client.phone}`);
    if (client?.email) clientInfo.push(`E-mail: ${client.email}`);
    if (client?.referred_by) clientInfo.push(`Quem indicou o cliente: ${client.referred_by}`);

    const blocks = [
      `Olá ${client?.full_name || "cliente"}, houve uma movimentação no seu processo.`,
      `*Abaixo, o que mudou:*\n\n${changed.join("\n\n")}`,
    ];
    if (processInfo.length) blocks.push(`*Informações importantes do processo*\n\n${processInfo.join("\n")}`);
    if (clientInfo.length) blocks.push(`*Informações importantes do cliente*\n\n${clientInfo.join("\n")}`);
    return blocks.join("\n\n");
  }

  $("#movementForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const action = event.submitter?.value || "save";
    const data = collectMovement(action === "send");

    if (action === "send") {
      const issue = validateMovementForSend(data);
      if (issue) {
        setStatus($("#movementStatus"), issue, "err");
        return;
      }
      state.pendingMovement = data;
      $("#messagePreview").textContent = buildPreview(data);
      closeDialog("movementDialog");
      openDialog("previewDialog");
      return;
    }

    const button = event.submitter;
    setBusy(button, true, "Salvando");
    try {
      const { data: created, error } = await supabase.from("case_updates").insert(data).select("id").single();
      if (error) throw error;
      closeDialog("movementDialog");
      toast("Movimentação salva sem enviar mensagem.");
      logActivity("movement.created", "movement", created?.id, "Movimentação registrada: " + data.title, { case_id: data.case_id });
      await loadData();
    } catch (error) {
      setStatus($("#movementStatus"), error.message || "Não foi possível salvar a movimentação.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  $("#backToMovementBtn").addEventListener("click", () => {
    closeDialog("previewDialog");
    openDialog("movementDialog");
  });

  $("#confirmSendBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const data = state.pendingMovement;
    if (!data) return;

    setBusy(button, true, "Enviando");
    setStatus($("#previewStatus"), "Salvando a movimentação e enviando pelo WhatsApp...");

    try {
      const { data: created, error } = await supabase
        .from("case_updates")
        .insert(data)
        .select("*")
        .single();
      if (error) throw error;
      logActivity("movement.created", "movement", created.id, "Movimentação registrada e enviada: " + data.title, { case_id: data.case_id });

      try {
        await invokeWhatsapp({
          action: "send",
          firm_id: state.firm.id,
          case_update_id: created.id,
        });
        setStatus($("#previewStatus"), "Mensagem enviada com sucesso.", "ok");
        toast("Movimentação salva e WhatsApp enviado.");
      } catch (sendError) {
        setStatus($("#previewStatus"), `Movimentação salva, mas o WhatsApp falhou: ${sendError.message}`, "err");
        toast("Movimentação salva, mas o envio falhou.", "err");
      }

      await loadData();
      setTimeout(() => {
        closeDialog("previewDialog");
        setStatus($("#previewStatus"));
        state.pendingMovement = null;
      }, 800);
    } catch (error) {
      setStatus($("#previewStatus"), error.message || "Não foi possível salvar a movimentação.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function normalizeWhatsAppState(value) {
    const state = String(value || "").toLowerCase();
    if (["open", "connected", "online"].includes(state)) return "connected";
    if (["connecting", "created", "configured"].includes(state)) return "connecting";
    if (["close", "closed", "disconnected", "logout"].includes(state)) return "disconnected";
    return state || "not_connected";
  }

  function renderWhatsAppQr(data) {
    const wrap = $("#waQrWrap");
    const target = $("#waQr");
    target.innerHTML = "";

    const base64 = data?.qr_base64;
    const rawCode = data?.qr_code;

    if (base64) {
      const img = document.createElement("img");
      img.alt = "QR Code para conectar o WhatsApp";
      img.src = String(base64).startsWith("data:image") ? base64 : "data:image/png;base64," + base64;
      target.appendChild(img);
      wrap.classList.remove("hidden");
      return true;
    }

    if (rawCode && window.QRCode) {
      new QRCode(target, {
        text: rawCode,
        width: 210,
        height: 210,
        correctLevel: QRCode.CorrectLevel.M,
      });
      wrap.classList.remove("hidden");
      return true;
    }

    wrap.classList.add("hidden");
    return false;
  }

  async function loadWhatsappStatus() {
    if (!state.firm) return;
    const box = $("#integrationState");
    const text = $("#integrationStateText");
    const info = $("#waConnectedInfo");

    if (PREVIEW_READ_ONLY) {
      box.classList.remove("connected");
      text.textContent = "Integração desativada no preview";
      info.classList.add("hidden");
      $("#waConnectBtn").disabled = true;
      $("#waRefreshBtn").disabled = true;
      setStatus($("#waStatus"), "O preview não consulta nem envia mensagens de WhatsApp.");
      return;
    }

    try {
      const data = await invokeWhatsapp({ action: "status", firm_id: state.firm.id });
      state.whatsapp = data || state.whatsapp;

      const status = normalizeWhatsAppState(data?.connection_state);
      const connected = status === "connected";
      const configured = !!data?.configured;

      box.classList.toggle("connected", connected);

      if (connected) {
        text.textContent = "WhatsApp conectado";
        const number = data?.connected_number ? ` • ${data.connected_number}` : "";
        info.textContent = `Instância ${data.instance_name || ""}${number}`;
        info.classList.remove("hidden");
        $("#waConnectBtn").textContent = "Gerar novo QR Code";
      } else if (configured) {
        text.textContent = status === "connecting"
          ? "Aguardando conexão do WhatsApp"
          : "WhatsApp configurado, mas desconectado";
        info.textContent = `Instância ${data.instance_name || ""}`;
        info.classList.remove("hidden");
        $("#waConnectBtn").textContent = "Conectar WhatsApp";
      } else {
        text.textContent = "WhatsApp ainda não conectado";
        info.classList.add("hidden");
        $("#waConnectBtn").textContent = "Conectar WhatsApp";
      }

      if (connected) $("#waQrWrap").classList.add("hidden");
      setStatus($("#waStatus"));
    } catch (error) {
      box.classList.remove("connected");
      text.textContent = "Não foi possível consultar o WhatsApp";
      setStatus($("#waStatus"), error.message || "Falha ao consultar a integração.", "err");
    }

    const owner = state.role === "owner";
    $("#waConnectBtn").disabled = !owner;
    $("#waPermissionNote").classList.toggle("hidden", owner);
  }

  $("#waRefreshBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, "Atualizando");
    try {
      await loadWhatsappStatus();
    } finally {
      setBusy(button, false);
    }
  });

  $("#waConnectBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, "Gerando QR");
    setStatus($("#waStatus"), "Preparando conexão com o WhatsApp...");
    $("#waQrWrap").classList.add("hidden");

    try {
      const data = await invokeWhatsapp({
        action: "connect",
        firm_id: state.firm.id,
      });

      const hasQr = renderWhatsAppQr(data);
      if (hasQr) {
        setStatus($("#waStatus"), "QR Code gerado. Escaneie pelo WhatsApp e depois clique em Atualizar status.", "ok");
      } else if (data?.pairing_code) {
        setStatus($("#waStatus"), `Código de pareamento: ${data.pairing_code}`, "ok");
      } else {
        setStatus($("#waStatus"), "Instância criada. Clique em Atualizar status; se ainda estiver desconectada, gere o QR novamente.", "ok");
      }

      await loadWhatsappStatus();
    } catch (error) {
      setStatus($("#waStatus"), error.message || "Não foi possível gerar o QR Code.", "err");
      toast("Falha ao conectar o WhatsApp.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function renderDashboard() {
    const activeCases = state.cases.filter((c) => !["closed", "archived"].includes(c.status)).length;
    const sentMessages = state.notifications.filter((n) => n.channel === "whatsapp" && n.status === "sent").length;
    $("#mClients").textContent = state.clients.length;
    $("#mCases").textContent = activeCases;
    $("#mUpdates").textContent = state.updates.length;
    $("#mMessages").textContent = sentMessages;

    const recent = state.updates.slice(0, 6);
    $("#recentUpdates").innerHTML = recent.length
      ? recent.map((u) => {
          const item = caseById(u.case_id);
          const client = item ? clientById(item.client_id) : null;
          const notification = notificationForUpdate(u.id);
          const sent = notification?.status === "sent" ? " • WhatsApp enviado" : notification?.status === "failed" ? " • Falha no WhatsApp" : "";
          return `
            <div class="event">
              <strong>${esc(u.title)}</strong>
              <small>${esc(client?.full_name || "Cliente")} • ${brDate(u.event_date)}${esc(sent)}</small>
              <p>${esc(u.summary || u.client_text || "")}</p>
            </div>`;
        }).join("")
      : '<div class="empty">Nenhuma movimentação cadastrada.</div>';

    // Audiências vêm tanto da ficha do processo quanto da agenda jurídica.
    const now = Date.now();
    const hearings = [];
    const seen = new Set();
    const addHearing = (caseId, clientId, at, mode, title) => {
      if (!at || new Date(at).getTime() < now) return;
      const key = (caseId || title) + "|" + new Date(at).getTime();
      if (seen.has(key)) return;
      seen.add(key);
      hearings.push({ caseId, clientId, at, mode, title });
    };
    state.cases.forEach((c) => addHearing(c.id, c.client_id, c.hearing_at, c.hearing_mode, c.title));
    (state.calendarEvents || [])
      .filter((e) => e.event_type === "hearing")
      .forEach((e) => addHearing(e.case_id, e.client_id || caseById(e.case_id)?.client_id, e.start_at, e.modality, e.title));
    const nextHearings = hearings.sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 5);

    $("#nextHearings").innerHTML = nextHearings.length
      ? nextHearings.map((h) => {
          const item = caseById(h.caseId);
          const client = clientById(h.clientId);
          return `
            <div class="event">
              <strong>${esc(client?.full_name || h.title)}</strong>
              <small>${brDate(h.at)} • ${esc(modeLabels[h.mode] || "Modalidade não informada")}</small>
              <p>${esc(item?.process_number || item?.title || h.title)}</p>
            </div>`;
        }).join("")
      : '<div class="empty">Nenhuma audiência futura cadastrada.</div>';
  }

  function renderClients() {
    const query = norm($("#clientSearch").value);
    const status = $("#clientFilter").value;
    const list = state.clients.filter((c) => {
      const matchesStatus = status === "all" || c.status === status;
      const haystack = norm(`${c.full_name} ${c.email} ${c.phone} ${c.referred_by} ${c.cpf_cnpj} ${c.city} ${(c.tags || []).join(" ")}`);
      return matchesStatus && haystack.includes(query);
    });

    $("#clientCount").textContent = `${list.length} de ${state.clients.length}`;
    $("#clientsBody").innerHTML = list.length
      ? list.map((c) => `
          <tr>
            <td><strong>${c.is_favorite ? "★ " : ""}${esc(c.full_name)}</strong><div class="small">${esc(c.cpf_cnpj || (c.tags || []).join(" • ") || c.notes || "")}</div></td>
            <td>${esc(c.phone || "—")}</td>
            <td>${esc(c.email || "—")}</td>
            <td>${esc(c.referred_by || "—")}</td>
            <td>${badge(c.status === "active" ? "Ativo" : "Inativo", c.status === "active" ? "ok" : "")}</td>
            <td>
              <div class="row-actions">
                <button class="btn ghost sm" data-client-file="${esc(c.id)}">Ficha</button>
                <button class="btn secondary sm" data-edit-client="${esc(c.id)}">Editar</button>
              </div>
            </td>
          </tr>`).join("")
      : '<tr><td colspan="6" class="empty">Nenhum cliente encontrado.</td></tr>';
  }

  function renderCases() {
    const query = norm($("#caseSearch").value);
    const status = $("#caseFilter").value;
    const list = state.cases.filter((c) => {
      const client = clientById(c.client_id);
      const matchesStatus = status === "all" || c.status === status;
      const haystack = norm(`${c.title} ${c.process_number} ${c.claimant} ${c.defendant} ${c.forum} ${c.court_division} ${c.legal_area} ${(c.tags || []).join(" ")} ${client?.full_name}`);
      return matchesStatus && haystack.includes(query);
    });

    $("#caseCount").textContent = `${list.length} de ${state.cases.length}`;
    $("#casesBody").innerHTML = list.length
      ? list.map((c) => {
          const client = clientById(c.client_id);
          const parties = [c.claimant, c.defendant].filter(Boolean).join(" × ");
          const statusType = c.status === "in_progress" ? "ok" : ["closed", "archived"].includes(c.status) ? "" : "warn";
          return `
            <tr>
              <td><strong>${c.is_favorite ? "★ " : ""}${esc(c.title)}</strong><div class="small">${esc(c.process_number || "Sem número")}</div></td>
              <td>${esc(client?.full_name || "—")}</td>
              <td><div>${esc(parties || "—")}</div><div class="small">${esc([c.forum, c.court_division].filter(Boolean).join(" • "))}</div></td>
              <td>${c.hearing_at ? `<strong>${brDate(c.hearing_at)}</strong><div class="small">${esc(modeLabels[c.hearing_mode] || "")}</div>` : "—"}</td>
              <td>${badge(statusLabels[c.status] || c.status, statusType)}<div class="small" data-case-health="${esc(c.id)}"></div></td>
              <td>
                <div class="row-actions">
                  <button class="btn ghost sm" data-case-workspace="${esc(c.id)}">Organizar</button>
                  <button class="btn ghost sm" data-move-case="${esc(c.id)}">Movimentar</button>
                  <button class="btn secondary sm" data-edit-case="${esc(c.id)}">Editar</button>
                </div>
              </td>
            </tr>`;
        }).join("")
      : '<tr><td colspan="6" class="empty">Nenhum processo encontrado.</td></tr>';

    window.AdvogaOrganizer?.renderCaseHealthBadges?.();
  }

  function renderUpdates() {
    const query = norm($("#movementSearch").value);
    const type = $("#movementFilter").value;
    const list = state.updates.filter((u) => {
      const item = caseById(u.case_id);
      const client = item ? clientById(item.client_id) : null;
      const matchesType = type === "all" || u.event_type === type;
      return matchesType && norm(`${u.title} ${u.summary} ${u.client_text} ${item?.process_number} ${client?.full_name}`).includes(query);
    });

    $("#movementCount").textContent = `${list.length} de ${state.updates.length}`;
    $("#updatesList").innerHTML = list.length
      ? list.map((u) => {
          const item = caseById(u.case_id);
          const client = item ? clientById(item.client_id) : null;
          const notification = notificationForUpdate(u.id);
          let wa = "";
          if (u.notify_client) {
            if (notification?.status === "sent") wa = badge("WhatsApp enviado", "ok");
            else if (notification?.status === "failed") wa = badge("Falha no WhatsApp", "err");
            else wa = badge("WhatsApp pendente", "warn");
          } else {
            wa = badge("Não enviado");
          }

          const details = [];
          if (u.event_type === "hearing" && u.hearing_at) details.push(`Audiência: ${brDate(u.hearing_at)}`);
          if (u.event_type === "expert_exam" && u.expert_at) details.push(`Perícia: ${brDate(u.expert_at)}`);
          if (u.expert_location) details.push(u.expert_location);

          return `
            <div class="event">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
                <div>
                  <strong>${esc(u.title)}</strong>
                  <small>${esc(eventLabels[u.event_type] || "Movimentação")} • ${esc(client?.full_name || "Cliente")} • ${brDate(u.event_date)}</small>
                </div>
                <div>${wa}</div>
              </div>
              <p>${esc(u.summary || u.client_text || "Sem resumo.")}</p>
              ${details.length ? `<div class="small">${esc(details.join(" • "))}</div>` : ""}
            </div>`;
        }).join("")
      : '<div class="empty">Nenhuma movimentação encontrada.</div>';
  }

  async function retryWhatsapp(updateId, button) {
    if (!updateId) return;
    setBusy(button, true, "Enviando");
    try {
      await invokeWhatsapp({
        action: "send",
        firm_id: state.firm.id,
        case_update_id: updateId,
      });
      toast("Mensagem reenviada com sucesso.");
      await loadData();
    } catch (error) {
      toast(error.message || "Não foi possível reenviar a mensagem.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  function renderMessages() {
    const list = state.notifications.filter((n) => n.channel === "whatsapp");
    $("#messageCount").textContent = `${list.length} mensagens`;

    $("#messagesBody").innerHTML = list.length
      ? list.map((n) => {
          const client = clientById(n.client_id);
          const statusType = n.status === "sent" ? "ok" : n.status === "failed" ? "err" : "warn";
          const statusText = n.status === "sent" ? "Enviado" : n.status === "failed" ? "Falhou" : n.status === "pending" ? "Pendente" : n.status;
          const canRetry = n.case_update_id && ["failed", "pending"].includes(n.status);
          return `
            <tr>
              <td>${brDate(n.sent_at || n.created_at)}</td>
              <td><strong>${esc(client?.full_name || "Cliente")}</strong><div class="small">${esc(n.recipient || "")}</div></td>
              <td>${badge(statusText, statusType)}</td>
              <td class="message-cell"><div class="message-preview" title="${esc(n.message_body || n.error_message || "")}">${esc(n.message_body || n.error_message || "—")}</div></td>
              <td>${esc(n.provider_message_id || "—")}</td>
              <td>${canRetry ? `<button class="btn secondary sm" data-retry-update="${esc(n.case_update_id)}">Reenviar</button>` : ""}</td>
            </tr>`;
        }).join("")
      : '<tr><td colspan="6" class="empty">Nenhuma mensagem enviada ainda.</td></tr>';
  }

  // Um único listener para os botões das tabelas: continua funcionando depois
  // que as linhas são recriadas por busca ou filtro.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-edit-client],[data-edit-case],[data-move-case],[data-retry-update]");
    if (!button) return;
    if (button.dataset.editClient) openClientDialog(button.dataset.editClient);
    else if (button.dataset.editCase) openCaseDialog(button.dataset.editCase);
    else if (button.dataset.moveCase) openMovementDialog(button.dataset.moveCase);
    else if (button.dataset.retryUpdate) retryWhatsapp(button.dataset.retryUpdate, button);
  });

  function renderAll() {
    updateBrand();
    renderDashboard();
    renderClients();
    renderCases();
    renderUpdates();
    renderMessages();
    fillClientSelect();
    fillCaseSelect();
    window.AdvogaOrganizer?.renderAll?.();
  }

  ["clientSearch", "clientFilter"].forEach((id) => {
    $("#" + id).addEventListener("input", renderClients);
  });
  ["caseSearch", "caseFilter"].forEach((id) => {
    $("#" + id).addEventListener("input", renderCases);
  });
  ["movementSearch", "movementFilter"].forEach((id) => {
    $("#" + id).addEventListener("input", renderUpdates);
  });

  async function loadData() {
    if (!state.firm) return;
    const firmId = state.firm.id;

    const [
      clientsResult,
      casesResult,
      updatesResult,
      notificationsResult,
    ] = await Promise.all([
      supabase.from("clients").select("*").eq("firm_id", firmId).order("created_at", { ascending: false }),
      supabase.from("cases").select("*").eq("firm_id", firmId).order("updated_at", { ascending: false }),
      supabase.from("case_updates").select("*").eq("firm_id", firmId).order("event_date", { ascending: false }),
      supabase.from("notifications").select("*").eq("firm_id", firmId).order("created_at", { ascending: false }),
    ]);

    const errors = [clientsResult.error, casesResult.error, updatesResult.error, notificationsResult.error].filter(Boolean);
    if (errors.length) throw errors[0];

    state.clients = clientsResult.data || [];
    state.cases = casesResult.data || [];
    state.updates = updatesResult.data || [];
    state.notifications = notificationsResult.data || [];
    if (window.AdvogaOrganizer?.loadData) {
      await window.AdvogaOrganizer.loadData(firmId);
    }
    renderAll();
  }

  async function establishSetupSessionFromUrl() {
    if (!SETUP_PASSWORD_MODE) return null;

    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const inviteType = hashParams.get("type");

    if (accessToken && refreshToken && (!inviteType || inviteType === "invite" || inviteType === "recovery")) {
      const { data, error } = await rawSupabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;

      history.replaceState(null, "", location.pathname + "?setup=password");
      return data.session || null;
    }

    const query = new URLSearchParams(location.search);
    const code = query.get("code");
    if (code) {
      const { data, error } = await rawSupabase.auth.exchangeCodeForSession(code);
      if (error) throw error;

      history.replaceState(null, "", location.pathname + "?setup=password");
      return data.session || null;
    }

    return null;
  }

  async function boot() {
    let inviteSession = null;
    if (SETUP_PASSWORD_MODE) {
      try {
        inviteSession = await establishSetupSessionFromUrl();
      } catch (error) {
        console.error(error);
        setStatus($("#setupPasswordStatus"), "Este link é inválido ou expirou. Solicite outro link de acesso ou recuperação.", "err");
      }
    }

    const { data: { session } } = inviteSession
      ? { data: { session: inviteSession } }
      : await rawSupabase.auth.getSession();
    let user = session?.user || null;
    if (!user) {
      const { data } = await supabase.auth.getUser();
      user = data.user || null;
    }
    state.user = user || null;

    $("#adminApp")?.classList.add("hidden");
    $("#blockedArea")?.classList.add("hidden");
    $("#passwordSetup")?.classList.add("hidden");

    if (SETUP_PASSWORD_MODE) {
      $("#landing").classList.add("hidden");
      $("#app").classList.add("hidden");
      $("#adminApp")?.classList.add("hidden");
      $("#passwordSetup")?.classList.remove("hidden");

      const info = $("#setupAccountInfo");
      if (user) {
        if (info) {
          info.textContent = user.email ? `Acesso para ${user.email}` : "Convite confirmado.";
          info.classList.remove("hidden");
        }
        $("#setupPasswordBtn").disabled = PREVIEW_READ_ONLY;
        if (PREVIEW_READ_ONLY) setStatus($("#setupPasswordStatus"), PREVIEW_MESSAGE, "err");
      } else {
        $("#setupPasswordBtn").disabled = true;
        setStatus($("#setupPasswordStatus"), "Este convite é inválido ou expirou. Solicite um novo convite ao administrador.", "err");
      }
      return;
    }

    if (!user) {
      $("#landing").classList.remove("hidden");
      $("#app").classList.add("hidden");
      if (sessionStorage.getItem("advogatix_password_created") === "1") {
        sessionStorage.removeItem("advogatix_password_created");
        setStatus($("#authStatus"), "Senha criada com sucesso. Entre com seu e-mail e sua nova senha.", "ok");
      }
      return;
    }

    const { data: platformAdmin } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    state.isPlatformAdmin = Boolean(platformAdmin);
    const requestedMode = new URLSearchParams(location.search).get("mode");
    if (state.isPlatformAdmin && requestedMode !== "office") {
      $("#landing").classList.add("hidden");
      $("#app").classList.add("hidden");
      $("#adminApp")?.classList.remove("hidden");
      window.AdvogaAdmin?.boot(window.AdvogaCore);
      return;
    }

    $("#landing").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#masterAccessBtn")?.classList.toggle("hidden", !state.isPlatformAdmin);
    $("#lawyerArea").classList.add("hidden");
    $("#onboardingArea").classList.add("hidden");

    const { data: memberships, error } = await supabase
      .from("firm_members")
      .select("role,firm_id,law_firms(*)")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (error) {
      toast(error.message || "Não foi possível carregar o escritório.", "err");
      return;
    }

    if (!memberships?.length) {
      state.firm = null;
      state.role = null;
      $("#onboardingArea").classList.remove("hidden");
      $("#userLabel").textContent = user.email || "Conectado";
      return;
    }

    const membership = memberships[0];
    state.firm = membership.law_firms;
    state.role = membership.role;

    const { data: accessControl, error: accessError } = await supabase
      .from("firm_access_controls")
      .select("access_status,user_limit")
      .eq("firm_id", membership.firm_id)
      .maybeSingle();

    if (accessError) {
      toast(accessError.message || "Não foi possível validar o acesso do escritório.", "err");
      return;
    }

    state.accessControl = accessControl || { access_status: "active", user_limit: 5 };
    if (state.accessControl.access_status !== "active") {
      $("#lawyerArea").classList.add("hidden");
      $("#blockedArea")?.classList.remove("hidden");
      const blockedText = $("#blockedFirmText");
      if (blockedText) blockedText.textContent = `${state.firm?.name || "Este escritório"} está com o acesso ${state.accessControl.access_status === "ended" ? "encerrado" : "bloqueado"}.`;
      $("#userLabel").textContent = user.email || "Conectado";
      return;
    }

    const roleLabel = { owner: "Proprietário", lawyer: "Advogado", staff: "Equipe" }[state.role] || state.role || "Perfil não informado";
    const accessSummary = $("#currentAccessSummary");
    if (accessSummary) accessSummary.textContent = `${user.email || "Usuário conectado"} • ${roleLabel} • ${state.firm?.name || "Escritório"}`;
    $("#lawyerArea").classList.remove("hidden");
    await loadData();
    const requestedSection = location.hash.replace(/^#/, "");
    switchSection(validSections.has(requestedSection) ? requestedSection : "overview", { updateHash: false, instant: true });
    loadWhatsappStatus();
    window.AdvogaTeam?.boot(window.AdvogaCore);
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (SETUP_PASSWORD_MODE && session?.user) {
      state.user = session.user;
      const info = $("#setupAccountInfo");
      if (info) {
        info.textContent = session.user.email ? `Acesso para ${session.user.email}` : "Convite confirmado.";
        info.classList.remove("hidden");
      }
      $("#setupPasswordBtn")?.removeAttribute("disabled");
    }
    if (!session && state.user && !completingPasswordSetup) location.reload();
  });

  window.AdvogaCore = {
    supabase,
    rawSupabase,
    state,
    $,
    $$,
    esc,
    norm,
    brDate,
    toIso,
    toLocalInput,
    dateKey,
    TIME_ZONE,
    PREVIEW_READ_ONLY,
    ACTIVITY_LOG_ENABLED,
    logActivity,
    changedFields,
    PREVIEW_MESSAGE,
    toast,
    setStatus,
    setBusy,
    openDialog,
    closeDialog,
    badge,
    clientById,
    caseById,
    switchSection,
    openClientDialog,
    loadData,
    renderAll,
  };

  // No celular as tabelas viram cartões; cada célula recebe o nome da coluna.
  function labelTableRows(table) {
    const headers = $$("thead th", table).map((th) => th.textContent.trim());
    $$("tbody tr", table).forEach((tr) => {
      Array.from(tr.children).forEach((td, index) => {
        if (td.hasAttribute("colspan")) return;
        if (headers[index]) td.dataset.label = headers[index];
        else td.classList.add("cell-actions");
      });
    });
  }

  $$("table").forEach((table) => {
    const body = $("tbody", table);
    if (!body) return;
    new MutationObserver(() => labelTableRows(table)).observe(body, { childList: true });
  });

  // Mensagens de formulário são anunciadas por leitores de tela sem interromper a navegação.
  $$(".status").forEach((el) => {
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
  });

  function updateConnectionStatus() {
    const banner = $("#connectionBanner");
    if (!banner) return;
    banner.classList.toggle("hidden", navigator.onLine);
  }

  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
  updateConnectionStatus();

  if (PREVIEW_READ_ONLY) {
    document.body.classList.add("preview-mode");
    $("#previewBanner")?.classList.remove("hidden");
    const writeButtonIds = [
      "clientSaveBtn","caseSaveBtn","movementSaveBtn","confirmSendBtn","deadlineSaveBtn",
      "taskSaveBtn","eventSaveBtn","financeSaveBtn","documentUploadBtn","templateSaveBtn",
      "leadSaveBtn","interactionSaveBtn","checklistSaveBtn","genSaveBtn"
    ];
    writeButtonIds.forEach((id) => {
      const button = $("#" + id);
      if (!button) return;
      button.disabled = true;
      button.title = PREVIEW_MESSAGE;
    });
    $("#documentFile")?.setAttribute("disabled", "");
    document.addEventListener("click", (event) => {
      const mutation = event.target.closest?.("[data-retry-update],[data-complete-deadline],[data-complete-task],[data-convert-lead],[data-delete-document],[data-toggle-checklist],[data-delete-template],[data-gen-save]");
      if (!mutation) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toast(PREVIEW_MESSAGE, "err");
    }, true);
  }

  boot().catch((error) => {
    console.error(error);
    toast(error.message || "Erro ao iniciar o AdvogaTix.", "err");
  });
})();
