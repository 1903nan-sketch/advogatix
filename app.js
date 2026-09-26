(() => {
  const SUPABASE_URL = "https://llxquroiaehemebuikwg.supabase.co";
  const SUPABASE_KEY = "sb_publishable_JYxa0dZA0VkJEVuQUoXT5w_j0XamP_q";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const state = {
    authMode: "login",
    user: null,
    firm: null,
    role: null,
    clients: [],
    cases: [],
    updates: [],
    notifications: [],
    pendingMovement: null,
    whatsapp: { configured: false, enabled: false, base_url: "", instance_name: "", api_key_masked: "" },
    editingClientId: null,
    editingCaseId: null,
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
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  function toIso(value) {
    return value ? new Date(value).toISOString() : null;
  }

  function toLocalInput(value) {
    if (!value) return "";
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    el.textContent = message;
    el.className = `status ${type}`;
  }

  function setBusy(button, busy, label = "Aguarde") {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("loading", busy);
    if (busy) {
      button.dataset.oldText = button.textContent;
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

  function setAuthMode(mode) {
    state.authMode = mode;
    $("#tabLogin").classList.toggle("active", mode === "login");
    $("#tabSignup").classList.toggle("active", mode === "signup");
    $("#signupNameWrap").classList.toggle("hidden", mode !== "signup");
    $("#authSubmit").textContent = mode === "login" ? "Entrar no painel" : "Criar conta de advogado";
    setStatus($("#authStatus"));
  }

  $("#tabLogin").addEventListener("click", () => setAuthMode("login"));
  $("#tabSignup").addEventListener("click", () => setAuthMode("signup"));

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter || $("#authSubmit");
    const email = $("#email").value.trim();
    const password = $("#password").value;
    setBusy(button, true, state.authMode === "login" ? "Entrando" : "Criando");
    setStatus($("#authStatus"), "Aguarde...");

    try {
      if (state.authMode === "signup") {
        const fullName = $("#name").value.trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        if (!data.session) {
          setStatus($("#authStatus"), "Conta criada. Confirme o e-mail recebido e depois entre.", "ok");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await boot();
    } catch (error) {
      setStatus($("#authStatus"), error.message || "Não foi possível autenticar.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.reload();
  });

  $("#firmForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Criando");
    setStatus($("#firmStatus"), "Criando escritório...");

    try {
      const payload = {
        name: $("#firmInput").value.trim(),
        slug: $("#slugInput").value
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, ""),
        whatsapp: $("#firmWhatsapp").value.trim() || null,
        email: $("#firmEmail").value.trim() || null,
        created_by: state.user.id,
      };

      const { error } = await supabase.from("law_firms").insert(payload);
      if (error) throw error;

      setStatus($("#firmStatus"), "Escritório criado.", "ok");
      toast("Escritório criado com sucesso.");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await boot();
    } catch (error) {
      setStatus($("#firmStatus"), error.message || "Não foi possível criar o escritório.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function switchSection(section) {
    $$(".nav button").forEach((btn) => btn.classList.toggle("active", btn.dataset.section === section));
    $$(".section").forEach((el) => el.classList.toggle("show", el.id === `section-${section}`));
    if (section === "settings") loadWhatsappStatus();
  }

  $$(".nav button").forEach((btn) => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
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

  function openClientDialog(clientId = null) {
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
      $("#cNotes").value = client.notes || "";
      $("#cStatus").value = client.status || "active";
    } else {
      $("#cStatus").value = "active";
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
      notes: $("#cNotes").value.trim() || null,
      status: $("#cStatus").value,
      portal_enabled: false,
    };

    try {
      if (state.editingClientId) {
        const { error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", state.editingClientId)
          .eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Cliente atualizado.");
      } else {
        const { error } = await supabase.from("clients").insert({
          ...payload,
          firm_id: state.firm.id,
          created_by: state.user.id,
        });
        if (error) throw error;
        toast("Cliente cadastrado.");
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
      .map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.full_name)}</option>`)
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
      $("#caseHearing").value = toLocalInput(item.hearing_at);
      $("#caseHearingMode").value = item.hearing_mode || "";
      $("#caseStatus").value = item.status || "in_progress";
      $("#caseSummary").value = item.client_summary || "";
    } else {
      $("#caseStatus").value = "in_progress";
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
      hearing_at: toIso($("#caseHearing").value),
      hearing_mode: $("#caseHearingMode").value || null,
      status: $("#caseStatus").value,
      client_summary: $("#caseSummary").value.trim() || null,
    };

    try {
      if (state.editingCaseId) {
        const { error } = await supabase
          .from("cases")
          .update(payload)
          .eq("id", state.editingCaseId)
          .eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Processo atualizado.");
      } else {
        const { error } = await supabase.from("cases").insert({
          ...payload,
          firm_id: state.firm.id,
          created_by: state.user.id,
        });
        if (error) throw error;
        toast("Processo cadastrado.");
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
        return `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(client?.full_name || "Cliente")} — ${esc(c.title)}${esc(number)}</option>`;
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
      const { error } = await supabase.from("case_updates").insert(data);
      if (error) throw error;
      closeDialog("movementDialog");
      toast("Movimentação salva sem enviar mensagem.");
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

  async function loadWhatsappStatus() {
    if (!state.firm) return;
    const box = $("#integrationState");
    const text = $("#integrationStateText");

    try {
      const data = await invokeWhatsapp({ action: "status", firm_id: state.firm.id });
      state.whatsapp = data || state.whatsapp;
      const configured = !!data?.configured;
      box.classList.toggle("connected", configured && data.enabled);
      text.textContent = configured
        ? data.enabled
          ? `Configurado • instância ${data.instance_name}`
          : "Configurado, porém desativado"
        : "Integração ainda não configurada";

      $("#waBaseUrl").value = data?.base_url || "";
      $("#waInstance").value = data?.instance_name || "";
      $("#waApiKey").value = "";
      $("#waApiKey").placeholder = data?.api_key_masked || "Cole sua API Key";
      $("#waEnabled").checked = data?.enabled !== false;
    } catch (error) {
      box.classList.remove("connected");
      text.textContent = "Não foi possível consultar a integração";
      setStatus($("#waStatus"), error.message, "err");
    }

    const owner = state.role === "owner";
    $("#whatsappForm").classList.toggle("readonly", !owner);
    $$("#whatsappForm input, #whatsappForm button").forEach((el) => {
      el.disabled = !owner;
    });
    $("#waPermissionNote").classList.toggle("hidden", owner);
  }

  $("#whatsappForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Salvando");
    setStatus($("#waStatus"), "Salvando configuração...");

    try {
      await invokeWhatsapp({
        action: "save_config",
        firm_id: state.firm.id,
        base_url: $("#waBaseUrl").value.trim(),
        instance_name: $("#waInstance").value.trim(),
        api_key: $("#waApiKey").value.trim(),
        enabled: $("#waEnabled").checked,
      });
      setStatus($("#waStatus"), "Integração salva.", "ok");
      toast("Configuração do WhatsApp salva.");
      await loadWhatsappStatus();
    } catch (error) {
      setStatus($("#waStatus"), error.message || "Não foi possível salvar.", "err");
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

    const nextHearings = state.cases
      .filter((c) => c.hearing_at && new Date(c.hearing_at) >= new Date())
      .sort((a, b) => new Date(a.hearing_at) - new Date(b.hearing_at))
      .slice(0, 5);

    $("#nextHearings").innerHTML = nextHearings.length
      ? nextHearings.map((c) => {
          const client = clientById(c.client_id);
          return `
            <div class="event">
              <strong>${esc(client?.full_name || c.title)}</strong>
              <small>${brDate(c.hearing_at)} • ${esc(modeLabels[c.hearing_mode] || "Modalidade não informada")}</small>
              <p>${esc(c.process_number || c.title)}</p>
            </div>`;
        }).join("")
      : '<div class="empty">Nenhuma audiência futura cadastrada.</div>';
  }

  function renderClients() {
    const query = norm($("#clientSearch").value);
    const status = $("#clientFilter").value;
    const list = state.clients.filter((c) => {
      const matchesStatus = status === "all" || c.status === status;
      const haystack = norm(`${c.full_name} ${c.email} ${c.phone} ${c.referred_by}`);
      return matchesStatus && haystack.includes(query);
    });

    $("#clientCount").textContent = `${list.length} de ${state.clients.length}`;
    $("#clientsBody").innerHTML = list.length
      ? list.map((c) => `
          <tr>
            <td><strong>${esc(c.full_name)}</strong><div class="small">${esc(c.notes || "")}</div></td>
            <td>${esc(c.phone || "—")}</td>
            <td>${esc(c.email || "—")}</td>
            <td>${esc(c.referred_by || "—")}</td>
            <td>${badge(c.status === "active" ? "Ativo" : "Inativo", c.status === "active" ? "ok" : "")}</td>
            <td>
              <div class="row-actions">
                <button class="btn secondary sm" data-edit-client="${c.id}">Editar</button>
              </div>
            </td>
          </tr>`).join("")
      : '<tr><td colspan="6" class="empty">Nenhum cliente encontrado.</td></tr>';

    $$("[data-edit-client]").forEach((btn) => {
      btn.addEventListener("click", () => openClientDialog(btn.dataset.editClient));
    });
  }

  function renderCases() {
    const query = norm($("#caseSearch").value);
    const status = $("#caseFilter").value;
    const list = state.cases.filter((c) => {
      const client = clientById(c.client_id);
      const matchesStatus = status === "all" || c.status === status;
      const haystack = norm(`${c.title} ${c.process_number} ${c.claimant} ${c.defendant} ${c.forum} ${c.court_division} ${client?.full_name}`);
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
              <td><strong>${esc(c.title)}</strong><div class="small">${esc(c.process_number || "Sem número")}</div></td>
              <td>${esc(client?.full_name || "—")}</td>
              <td><div>${esc(parties || "—")}</div><div class="small">${esc([c.forum, c.court_division].filter(Boolean).join(" • "))}</div></td>
              <td>${c.hearing_at ? `<strong>${brDate(c.hearing_at)}</strong><div class="small">${esc(modeLabels[c.hearing_mode] || "")}</div>` : "—"}</td>
              <td>${badge(statusLabels[c.status] || c.status, statusType)}</td>
              <td>
                <div class="row-actions">
                  <button class="btn ghost sm" data-move-case="${c.id}">Movimentar</button>
                  <button class="btn secondary sm" data-edit-case="${c.id}">Editar</button>
                </div>
              </td>
            </tr>`;
        }).join("")
      : '<tr><td colspan="6" class="empty">Nenhum processo encontrado.</td></tr>';

    $$("[data-edit-case]").forEach((btn) => {
      btn.addEventListener("click", () => openCaseDialog(btn.dataset.editCase));
    });
    $$("[data-move-case]").forEach((btn) => {
      btn.addEventListener("click", () => openMovementDialog(btn.dataset.moveCase));
    });
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
              <td>${canRetry ? `<button class="btn secondary sm" data-retry-update="${n.case_update_id}">Reenviar</button>` : ""}</td>
            </tr>`;
        }).join("")
      : '<tr><td colspan="6" class="empty">Nenhuma mensagem enviada ainda.</td></tr>';

    $("[data-retry-update]").forEach((button) => {
      button.addEventListener("click", () => retryWhatsapp(button.dataset.retryUpdate, button));
    });
  }

  function renderAll() {
    updateBrand();
    renderDashboard();
    renderClients();
    renderCases();
    renderUpdates();
    renderMessages();
    fillClientSelect();
    fillCaseSelect();
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
    renderAll();
  }

  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    state.user = user || null;

    if (!user) {
      $("#landing").classList.remove("hidden");
      $("#app").classList.add("hidden");
      return;
    }

    $("#landing").classList.add("hidden");
    $("#app").classList.remove("hidden");
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
    $("#lawyerArea").classList.remove("hidden");
    await loadData();
    loadWhatsappStatus();
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session && state.user) location.reload();
  });

  boot().catch((error) => {
    console.error(error);
    toast(error.message || "Erro ao iniciar o AdvogaTix.", "err");
  });
})();