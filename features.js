// Funcionalidades internas do escritório construídas sobre o núcleo (app.js) e o organizador:
// linha do tempo do processo, alertas de prazos, gerador de documentos e histórico de atividades.
// Todo texto vindo do banco passa por esc() antes de entrar no HTML.
(() => {
  const core = window.AdvogaCore;
  const org = window.AdvogaOrganizer;
  if (!core || !org?.helpers) return;

  const {
    supabase, state, $, $$, esc, norm, brDate, dateKey, toast, setStatus, setBusy,
    openDialog, badge, clientById, caseById
  } = core;
  const h = org.helpers;

  // ---------- Ícones simples (SVG estático, sem dados do usuário) ----------
  const ICONS = {
    movement: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
    agenda: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    deadline: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 2M10 3h4"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    finance: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.8 0 2.6 5 1.4 5 4 0 1.1-1.1 1.8-2.5 1.8-1.2 0-2.1-.5-2.6-1.3M12 7v1.3M12 15.7V17"/>',
    message: '<path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3V6a1 1 0 0 1 1-1z"/>',
    change: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    client: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    case: '<path d="M12 3v18M5 7h14M7 7l-3 7h6zM17 7l-3 7h6z"/>',
    template: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7"/>',
    lead: '<path d="M4 6h16l-6 7v6l-4-2v-4z"/>',
    alert: '<path d="M12 4 3 20h18z"/><path d="M12 10v4M12 17h.01"/>'
  };

  function icon(name) {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.change) + '</svg>';
  }

  function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Datas sem hora (vencimento financeiro) são tratadas como meio-dia em Brasília.
  function dateOnly(value) {
    const key = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? new Date(key + "T12:00:00-03:00") : null;
  }

  function formatWhen(date, allDay) {
    if (!date) return "Sem data";
    return allDay ? new Intl.DateTimeFormat("pt-BR", { timeZone: core.TIME_ZONE, dateStyle: "short" }).format(date) + " • dia todo" : brDate(date);
  }

  function truncate(text, size = 180) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > size ? clean.slice(0, size - 1) + "…" : clean;
  }

  const notificationStatus = {
    sent: ["Enviado", "ok"], failed: ["Falhou", "err"], pending: ["Pendente", "warn"]
  };
  const interactionLabels = { whatsapp: "WhatsApp", call: "Ligação", meeting: "Reunião", email: "E-mail", note: "Nota interna" };
  const movementLabels = { hearing: "Audiência", sentence: "Sentença", appellate_decision: "Acórdão", expert_exam: "Perícia", custom: "Movimentação" };

  // ---------- Detalhes genéricos (para itens sem formulário próprio) ----------
  function showDetail(title, subtitle, fields, text) {
    $("#detailTitle").textContent = title || "Detalhes";
    $("#detailSubtitle").textContent = subtitle || "";
    const dl = $("#detailFields");
    dl.replaceChildren();
    fields.filter(([, value]) => value !== null && value !== undefined && value !== "").forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = String(value);
      dl.append(dt, dd);
    });
    const box = $("#detailText");
    box.textContent = text || "";
    box.classList.toggle("hidden", !text);
    openDialog("detailDialog");
  }

  function caseLabel(caseId) {
    const proc = caseById(caseId);
    return proc ? (proc.process_number ? proc.process_number + " — " : "") + (proc.title || "") : "";
  }

  function showMovement(id) {
    const u = state.updates.find((x) => x.id === id);
    if (!u) return;
    const n = state.notifications.find((x) => x.case_update_id === id && x.channel === "whatsapp");
    showDetail(u.title || "Movimentação", movementLabels[u.event_type] || "Movimentação", [
      ["Data", brDate(u.event_date || u.created_at)],
      ["Processo", caseLabel(u.case_id)],
      ["Audiência", u.hearing_at ? brDate(u.hearing_at) : ""],
      ["Perícia", u.expert_at ? brDate(u.expert_at) : ""],
      ["Local da perícia", u.expert_location],
      ["Perito(a)", u.expert_name],
      ["Responsável", h.responsibleLabel(u.created_by)],
      ["WhatsApp", u.notify_client ? (notificationStatus[n?.status]?.[0] || "Pendente") : "Não enviado ao cliente"],
      ["Anotação interna", u.legal_text]
    ], u.summary || u.client_text || "");
  }

  function showMessage(id) {
    const n = state.notifications.find((x) => x.id === id);
    if (!n) return;
    const update = state.updates.find((x) => x.id === n.case_update_id);
    showDetail("Mensagem de WhatsApp", clientById(n.client_id)?.full_name || "", [
      ["Data", brDate(n.sent_at || n.created_at)],
      ["Status", notificationStatus[n.status]?.[0] || n.status],
      ["Destinatário", n.recipient],
      ["Processo", caseLabel(update?.case_id || n.case_id)],
      ["ID do provedor", n.provider_message_id],
      ["Erro", n.error_message]
    ], n.message_body || "");
  }

  function showInteraction(id) {
    const x = state.clientInteractions.find((i) => i.id === id);
    if (!x) return;
    showDetail(interactionLabels[x.interaction_type] || "Atendimento", clientById(x.client_id)?.full_name || "", [
      ["Data", brDate(x.occurred_at || x.created_at)],
      ["Processo", caseLabel(x.case_id)],
      ["Próximo retorno", x.follow_up_at ? brDate(x.follow_up_at) : ""],
      ["Responsável", h.responsibleLabel(x.created_by)]
    ], x.summary || "");
  }

  function showDocument(id) {
    const d = state.documents.find((x) => x.id === id);
    if (!d) return;
    showDetail(d.name || "Documento", caseLabel(d.case_id), [
      ["Enviado em", brDate(d.created_at)],
      ["Tipo", d.document_type],
      ["Tamanho", h.formatBytes(d.size_bytes)],
      ["Enviado por", h.responsibleLabel(d.uploaded_by)],
      ["Observações", d.notes]
    ], "Para baixar o arquivo, use o botão Baixar na linha do tempo ou na área Documentos.");
  }

  function showCaseHearing(id) {
    const c = caseById(id);
    if (!c) return;
    const modes = { presential: "Presencial", remote: "Telepresencial", hybrid: "Híbrida" };
    showDetail("Audiência", caseLabel(id), [
      ["Data", brDate(c.hearing_at)],
      ["Modalidade", modes[c.hearing_mode] || "Não informada"],
      ["Fórum", c.forum],
      ["Vara", c.court_division]
    ], "Data registrada na ficha do processo. Para alterar, edite o processo.");
  }

  function showLog(id) {
    const log = activityState.logs.find((x) => x.id === id);
    if (!log) return;
    const fields = Array.isArray(log.metadata?.fields) ? log.metadata.fields.join(", ") : "";
    showDetail(log.summary || "Atividade", actionLabel(log.action), [
      ["Data", brDate(log.created_at)],
      ["Responsável", h.responsibleLabel(log.actor_id)],
      ["Campos alterados", fields]
    ], "");
  }

  // Abre o item certo a partir de "tipo|id" (linha do tempo, alertas e atividades).
  function openEntity(ref, button) {
    const [kind, id] = String(ref || "").split("|");
    if (!id) return;
    const open = {
      deadline: () => h.openDeadlineDialog(id),
      task: () => h.openTaskDialog(id),
      event: () => h.openEventDialog(id),
      finance: () => h.openFinanceDialog(id),
      client: () => h.openClientFile(id),
      case: () => h.openCaseWorkspace(id),
      template: () => h.openTemplateDialog(id),
      lead: () => { core.switchSection("crm"); h.openLeadDialog(id); },
      movement: () => showMovement(id),
      message: () => showMessage(id),
      interaction: () => showInteraction(id),
      document: () => showDocument(id),
      download: () => h.downloadDocument(id, button),
      casehearing: () => showCaseHearing(id),
      log: () => showLog(id)
    }[kind];
    open?.();
  }

  // ---------- 1. Linha do tempo do processo ----------
  const timelineFilters = [
    ["all", "Todos"], ["movement", "Movimentações"], ["deadline", "Prazos"], ["agenda", "Agenda"],
    ["task", "Tarefas"], ["document", "Documentos"], ["finance", "Financeiro"], ["message", "Mensagens"]
  ];
  const categoryLabels = {
    movement: "Movimentação", deadline: "Prazo", agenda: "Agenda", task: "Tarefa",
    document: "Documento", finance: "Financeiro", message: "Mensagem", change: "Alteração"
  };
  const timelineState = { filter: "all", newestFirst: true };

  function caseTimelineItems(caseId) {
    const proc = caseById(caseId);
    if (!proc) return [];
    const items = [];
    const add = (item) => { if (item.date) items.push(item); };

    state.updates.filter((u) => u.case_id === caseId).forEach((u) => {
      const n = state.notifications.find((x) => x.case_update_id === u.id && x.channel === "whatsapp");
      const st = u.notify_client ? (notificationStatus[n?.status] || ["WhatsApp pendente", "warn"]) : ["Interno", ""];
      add({ cat: "movement", date: toDate(u.event_date || u.created_at), title: u.title || "Movimentação",
        desc: [movementLabels[u.event_type], truncate(u.summary || u.client_text)].filter(Boolean).join(" — "),
        who: u.created_by, status: st, open: "movement|" + u.id });
    });

    const hearingKeys = new Set();
    state.calendarEvents.filter((e) => e.case_id === caseId).forEach((e) => {
      const start = toDate(e.start_at);
      if (e.event_type === "hearing" && start) hearingKeys.add(start.getTime());
      const past = start && start.getTime() < Date.now();
      add({ cat: "agenda", date: start, title: e.title || h.eventTypeLabels[e.event_type] || "Compromisso",
        desc: [h.eventTypeLabels[e.event_type], e.location, truncate(e.notes, 120)].filter(Boolean).join(" • "),
        who: e.responsible_user_id, status: past ? ["Realizado", ""] : ["Agendado", "info"], open: "event|" + e.id });
    });
    const hearingAt = toDate(proc.hearing_at);
    if (hearingAt && !hearingKeys.has(hearingAt.getTime())) {
      add({ cat: "agenda", date: hearingAt, title: "Audiência",
        desc: [proc.forum, proc.court_division].filter(Boolean).join(" • ") || "Data registrada na ficha do processo",
        status: hearingAt.getTime() < Date.now() ? ["Realizada", ""] : ["Agendada", "info"], open: "casehearing|" + caseId });
    }

    state.deadlines.filter((d) => d.case_id === caseId).forEach((d) => {
      const countdown = h.deadlineCountdown(d);
      add({ cat: "deadline", date: toDate(d.due_at || d.created_at), title: d.title,
        desc: [h.deadlineTypeLabels[d.deadline_type], d.source, "Prioridade " + (h.priorityLabels[d.priority] || "Normal").toLowerCase(), countdown.text].filter(Boolean).join(" • "),
        who: d.responsible_user_id || d.created_by, status: [h.deadlineStatusLabels[d.status] || d.status, d.status === "completed" ? "ok" : countdown.tone],
        open: "deadline|" + d.id });
    });

    state.tasks.filter((t) => t.case_id === caseId).forEach((t) => {
      const overdue = h.isOverdue(t.due_at, t.status);
      add({ cat: "task", date: toDate(t.due_at || t.created_at), title: t.title,
        desc: [t.due_at ? "Vencimento" : "Criada", truncate(t.description, 140)].filter(Boolean).join(" — "),
        who: t.assigned_to, status: [h.taskStatusLabels[t.status] || t.status, t.status === "completed" ? "ok" : overdue ? "err" : ""],
        open: "task|" + t.id });
    });

    state.documents.filter((d) => d.case_id === caseId).forEach((d) => {
      add({ cat: "document", date: toDate(d.created_at), title: d.name || "Documento",
        desc: [d.document_type, h.formatBytes(d.size_bytes), truncate(d.notes, 100)].filter((x) => x && x !== "—").join(" • "),
        who: d.uploaded_by, status: ["Arquivado", ""], open: "document|" + d.id, extra: "download|" + d.id });
    });

    const updateIds = new Set(state.updates.filter((u) => u.case_id === caseId).map((u) => u.id));
    state.notifications.filter((n) => n.channel === "whatsapp" && (updateIds.has(n.case_update_id) || n.case_id === caseId)).forEach((n) => {
      add({ cat: "message", date: toDate(n.sent_at || n.created_at), title: "WhatsApp para " + (clientById(n.client_id)?.full_name || "cliente"),
        desc: truncate(n.message_body || n.error_message, 160), status: notificationStatus[n.status] || [n.status, ""], open: "message|" + n.id });
    });
    state.clientInteractions.filter((x) => x.case_id === caseId).forEach((x) => {
      add({ cat: "message", date: toDate(x.occurred_at || x.created_at), title: "Atendimento: " + (interactionLabels[x.interaction_type] || "registro"),
        desc: truncate(x.summary, 160), who: x.created_by, status: x.follow_up_at ? ["Retorno " + brDate(x.follow_up_at), "info"] : ["Registrado", ""],
        open: "interaction|" + x.id });
    });

    state.financialEntries.filter((f) => f.case_id === caseId).forEach((f) => {
      const status = h.effectiveFinanceStatus(f);
      const paidAt = f.status === "paid" ? toDate(f.paid_at) : null;
      const due = dateOnly(f.due_date);
      const tone = status === "paid" ? "ok" : status === "overdue" ? "err" : status === "pending" ? "warn" : "";
      add({ cat: "finance", date: paidAt || due || toDate(f.created_at), allDay: !paidAt && !!due, title: f.description || "Lançamento",
        desc: [h.financeTypeLabels[f.entry_type], (h.financeIsReceivable(f) ? "" : "− ") + h.money(f.amount), paidAt ? "Pago" : due ? "Vencimento" : ""].filter(Boolean).join(" • "),
        who: f.created_by, status: [h.financeStatusLabels[status] || status, tone], open: "finance|" + f.id });
    });

    // Alterações importantes do processo
    add({ cat: "change", date: toDate(proc.created_at), title: "Processo cadastrado", desc: proc.title, who: proc.created_by, status: ["Cadastro", ""] });
    const created = toDate(proc.created_at);
    const updated = toDate(proc.updated_at);
    const caseLogs = activityState.logs.filter((l) => l.entity_type === "case" && l.entity_id === caseId && l.action !== "case.created");
    if (caseLogs.length) {
      caseLogs.forEach((l) => add({ cat: "change", date: toDate(l.created_at), title: l.summary || actionLabel(l.action),
        desc: Array.isArray(l.metadata?.fields) && l.metadata.fields.length ? "Campos: " + l.metadata.fields.join(", ") : "",
        who: l.actor_id, status: ["Alteração", ""], open: "log|" + l.id }));
    } else if (updated && created && updated - created > 60000) {
      add({ cat: "change", date: updated, title: "Cadastro do processo alterado", desc: "Última alteração registrada nos dados do processo", status: ["Alteração", ""] });
    }
    state.checklistItems.filter((c) => c.case_id === caseId && c.is_done && c.done_at).forEach((c) => {
      add({ cat: "change", date: toDate(c.done_at), title: "Checklist concluído: " + (c.label || ""), who: c.assigned_to, status: ["Concluído", "ok"] });
    });

    return items;
  }

  // Itens sem formulário próprio abrem um resumo; guardados por índice a cada renderização.
  let timelineDetails = [];

  function showTimelineDetail(index) {
    const item = timelineDetails[Number(index)];
    if (!item) return;
    showDetail(item.title, categoryLabels[item.cat], [
      ["Data", formatWhen(item.date, item.allDay)],
      ["Status", item.status?.[0]],
      ["Responsável", item.who ? h.responsibleLabel(item.who) : ""]
    ], item.desc || "");
  }

  function timelineItemHtml(item) {
    const status = item.status ? badge(item.status[0], item.status[1]) : "";
    const who = item.who ? '<span>Responsável: ' + esc(h.responsibleLabel(item.who)) + '</span>' : "";
    const actions = (item.extra ? '<button type="button" class="btn ghost sm" data-tl-open="' + esc(item.extra) + '">Baixar</button>' : "") +
      (item.open
        ? '<button type="button" class="btn secondary sm" data-tl-open="' + esc(item.open) + '">Abrir</button>'
        : '<button type="button" class="btn secondary sm" data-tl-detail="' + (timelineDetails.push(item) - 1) + '">Ver</button>');
    const future = item.date.getTime() > Date.now();
    return '<div class="tl-item tl-' + item.cat + (future ? " is-future" : "") + '">' +
      '<div class="tl-icon">' + icon(item.cat) + '</div>' +
      '<div class="tl-card">' +
        '<div class="tl-top"><span class="tl-type">' + esc(categoryLabels[item.cat]) + '</span><span class="tl-time">' + esc(formatWhen(item.date, item.allDay)) + '</span></div>' +
        '<strong class="tl-title">' + esc(item.title) + '</strong>' +
        (item.desc ? '<p class="tl-desc">' + esc(item.desc) + '</p>' : "") +
        '<div class="tl-meta">' + status + who + (actions ? '<span class="tl-actions">' + actions + '</span>' : "") + '</div>' +
      '</div></div>';
  }

  function renderCaseTimeline(caseId) {
    const target = $("#caseTimeline");
    if (!target) return;
    const all = caseTimelineItems(caseId);
    const counts = { all: all.length };
    all.forEach((x) => { counts[x.cat] = (counts[x.cat] || 0) + 1; });

    $("#timelineFilters").innerHTML = timelineFilters.map(([key, label]) =>
      '<button type="button" class="chip' + (timelineState.filter === key ? " is-active" : "") + '" data-timeline-filter="' + key + '" aria-pressed="' + (timelineState.filter === key) + '">' +
        esc(label) + ' <span>' + (counts[key] || 0) + '</span></button>'
    ).join("");
    $("#timelineOrderBtn").textContent = timelineState.newestFirst ? "Mais recentes primeiro" : "Mais antigos primeiro";

    const list = all
      .filter((x) => timelineState.filter === "all" || x.cat === timelineState.filter)
      .sort((a, b) => timelineState.newestFirst ? b.date - a.date : a.date - b.date);

    if (!list.length) {
      target.innerHTML = '<div class="empty">Nada registrado nesta categoria para o processo.</div>';
      return;
    }
    let lastKey = "";
    timelineDetails = [];
    target.innerHTML = list.map((item) => {
      const key = dateKey(item.date);
      const head = key !== lastKey ? '<div class="tl-day">' + esc(h.dayTitle(key)) + '</div>' : "";
      lastKey = key;
      return head + timelineItemHtml(item);
    }).join("");
  }

  // ---------- 2. Alertas de prazos no painel ----------
  function renderDeadlineAlerts() {
    const target = $("#deadlineAlerts");
    if (!target) return;
    const critical = state.deadlines.filter((d) => {
      const bucket = h.deadlineBucket(d);
      if (["overdue", "today", "tomorrow"].includes(bucket)) return true;
      return bucket === "next3" && ["high", "urgent"].includes(d.priority);
    });
    const order = { overdue: 0, today: 1, tomorrow: 2, next3: 3 };
    critical.sort((a, b) => order[h.deadlineBucket(a)] - order[h.deadlineBucket(b)] ||
      new Date(a.due_at) - new Date(b.due_at) || (h.priorityWeight[b.priority] || 0) - (h.priorityWeight[a.priority] || 0));

    if (!critical.length) {
      target.innerHTML = state.deadlines.length
        ? '<div class="event ok"><strong>Nenhum prazo crítico</strong><small>Nada vencido, vencendo hoje ou amanhã.</small></div>'
        : '<div class="event attention"><strong>Nenhum prazo cadastrado</strong><small>Cadastre os prazos para receber alertas aqui.</small></div>';
      return;
    }

    const shown = critical.slice(0, 6);
    target.innerHTML = shown.map((d) => {
      const bucket = h.deadlineBucket(d);
      const countdown = h.deadlineCountdown(d);
      const proc = caseById(d.case_id);
      const client = clientById(d.client_id || proc?.client_id);
      const headline = bucket === "next3" ? "Prazo " + (h.priorityLabels[d.priority] || "").toLowerCase() + " • " + countdown.text.toLowerCase() : "Prazo " + countdown.text.toLowerCase();
      return '<button type="button" class="alert-item tone-' + (bucket === "overdue" ? "err" : "warn") + '" data-tl-open="deadline|' + esc(d.id) + '">' +
        '<span class="alert-icon">' + icon(bucket === "overdue" ? "alert" : "deadline") + '</span>' +
        '<span class="alert-body"><small>' + esc(headline) + '</small><strong>' + esc(d.title) + '</strong>' +
        '<span class="alert-meta">' + esc([proc?.process_number || proc?.title, client?.full_name].filter(Boolean).join(" • ") || "Sem processo vinculado") + '</span></span>' +
        badge(h.priorityLabels[d.priority] || "Normal", h.priorityTypes[d.priority] || "") +
      '</button>';
    }).join("") + (critical.length > shown.length
      ? '<button type="button" class="btn ghost sm alert-more" data-goto-section="deadlines">Ver mais ' + (critical.length - shown.length) + ' prazo(s) crítico(s)</button>' : "");
  }

  // ---------- 3. Gerador de documentos ----------
  const VARIABLES = [
    ["cliente_nome", "Nome do cliente"], ["cliente_cpf", "CPF/CNPJ"], ["cliente_rg", "RG"], ["cliente_email", "E-mail"],
    ["cliente_telefone", "Telefone"], ["cliente_endereco", "Endereço completo"], ["processo_numero", "Número do processo"],
    ["processo_titulo", "Nome do processo"], ["processo_autor", "Autor / reclamante"], ["processo_reu", "Réu / reclamada"],
    ["processo_vara", "Vara"], ["processo_forum", "Fórum"], ["processo_valor", "Valor da causa"],
    ["advogado_nome", "Advogado(a)"], ["escritorio_nome", "Escritório"], ["data_atual", "Data de hoje"]
  ];
  const VAR_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
  const LAWYER_KEY = "advogatix.generator.lawyer";

  function renderVarChips() {
    const box = $("#templateVarChips");
    if (!box || box.childElementCount) return;
    box.innerHTML = VARIABLES.map(([key, label]) =>
      '<button type="button" class="chip var-chip" data-insert-var="' + key + '" title="' + esc(label) + '">{{' + key + '}}</button>').join("");
  }

  function insertVariable(key) {
    const area = $("#templateContent");
    if (!area) return;
    const token = "{{" + key + "}}";
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? area.value.length;
    area.setRangeText(token, start, end, "end");
    area.focus();
  }

  function clientAddress(c) {
    if (!c) return "";
    const cityState = [c.city, c.state_code].filter(Boolean).join("/");
    return [c.address_line, cityState, c.postal_code ? "CEP " + c.postal_code : ""].filter(Boolean).join(", ");
  }

  function currentDateLong() {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: core.TIME_ZONE, day: "numeric", month: "long", year: "numeric" }).format(new Date());
  }

  function variableValues(client, proc, lawyer) {
    return {
      cliente_nome: client?.full_name, cliente_cpf: client?.cpf_cnpj, cliente_rg: client?.rg,
      cliente_email: client?.email, cliente_telefone: client?.phone, cliente_endereco: clientAddress(client),
      processo_numero: proc?.process_number, processo_titulo: proc?.title, processo_autor: proc?.claimant,
      processo_reu: proc?.defendant, processo_vara: proc?.court_division, processo_forum: proc?.forum,
      processo_valor: proc?.case_value != null && proc?.case_value !== "" ? h.money(proc.case_value) : "",
      advogado_nome: lawyer, escritorio_nome: state.firm?.name, data_atual: currentDateLong()
    };
  }

  // Substitui as variáveis. As que ficarem sem dado permanecem no texto e são listadas como aviso.
  function fillTemplate(content, values) {
    const missing = new Set();
    const unknown = new Set();
    const text = String(content || "").replace(VAR_PATTERN, (match, rawKey) => {
      const key = rawKey.toLowerCase();
      if (!(key in values)) { unknown.add(key); return match; }
      const value = values[key];
      if (value === null || value === undefined || String(value).trim() === "") { missing.add(key); return match; }
      return String(value);
    });
    return { text, missing: [...missing], unknown: [...unknown] };
  }

  function readLawyer() {
    try { return localStorage.getItem(LAWYER_KEY) || ""; } catch { return ""; }
  }

  function rememberLawyer(value) {
    try { localStorage.setItem(LAWYER_KEY, value); } catch { /* armazenamento indisponível */ }
  }

  function openGenerator(templateId = "") {
    if (!state.templates.length) {
      toast("Crie um modelo antes de gerar documentos.", "err");
      core.switchSection("templates");
      return;
    }
    const sorted = state.templates.slice().sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || String(a.title).localeCompare(String(b.title)));
    $("#genTemplate").innerHTML = sorted.map((t) =>
      '<option value="' + esc(t.id) + '"' + (t.id === templateId ? " selected" : "") + '>' + esc(t.title) +
      (t.active === false ? " (inativo)" : "") + " — " + esc(h.templateTypeLabels[t.template_type] || t.template_type || "") + '</option>').join("");
    $("#genClient").innerHTML = h.clientOptions("");
    $("#genCase").innerHTML = h.caseOptions("");
    const meta = state.user?.user_metadata || {};
    $("#genLawyer").value = readLawyer() || meta.full_name || meta.name || "";
    $("#genTitle").value = "";
    $("#genOutput").value = "";
    $("#genPreviewWrap").classList.add("hidden");
    setStatus($("#genStatusMsg"));
    if (core.PREVIEW_READ_ONLY) $("#genSaveBtn").title = core.PREVIEW_MESSAGE;
    openDialog("generatorDialog");
  }

  function suggestTitle() {
    const template = state.templates.find((t) => t.id === $("#genTemplate").value);
    const client = clientById($("#genClient").value);
    return [template?.title, client?.full_name].filter(Boolean).join(" - ");
  }

  function generatePreview() {
    const template = state.templates.find((t) => t.id === $("#genTemplate").value);
    if (!template) { setStatus($("#genStatusMsg"), "Selecione um modelo.", "err"); return; }
    const proc = caseById($("#genCase").value);
    const client = clientById($("#genClient").value) || clientById(proc?.client_id);
    const lawyer = $("#genLawyer").value.trim();
    if (lawyer) rememberLawyer(lawyer);
    const result = fillTemplate(template.content, variableValues(client, proc, lawyer));
    $("#genOutput").value = result.text;
    if (!$("#genTitle").value.trim()) $("#genTitle").value = suggestTitle();

    const warnings = [];
    if (result.missing.length) warnings.push("Sem dados cadastrados para: " + result.missing.map((k) => "{{" + k + "}}").join(", ") + ". Complete o cadastro ou edite o texto abaixo.");
    if (result.unknown.length) warnings.push("Variáveis desconhecidas (mantidas no texto): " + result.unknown.map((k) => "{{" + k + "}}").join(", ") + ".");
    const box = $("#genWarnings");
    box.textContent = warnings.join(" ");
    box.classList.toggle("hidden", !warnings.length);
    $("#genPreviewWrap").classList.remove("hidden");
    setStatus($("#genStatusMsg"), result.missing.length || result.unknown.length ? "" : "Todas as variáveis foram preenchidas.", "ok");
  }

  async function copyGenerated() {
    const text = $("#genOutput").value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = $("#genOutput");
      area.select();
      document.execCommand("copy");
    }
    toast("Texto copiado.");
  }

  // Impressão só do documento: o restante da página é ocultado pelo CSS de impressão.
  function printGenerated() {
    const text = $("#genOutput").value;
    if (!text) return;
    const area = $("#printArea");
    area.replaceChildren();
    const doc = document.createElement("div");
    doc.className = "print-doc-body";
    doc.textContent = text;
    area.appendChild(doc);
    const previousTitle = document.title;
    document.title = $("#genTitle").value.trim() || "Documento";
    document.body.classList.add("print-doc");
    const cleanup = () => {
      document.body.classList.remove("print-doc");
      document.title = previousTitle;
      area.replaceChildren();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(() => { if (document.body.classList.contains("print-doc")) cleanup(); }, 1500);
  }

  async function saveGenerated(button) {
    if (core.PREVIEW_READ_ONLY) { toast(core.PREVIEW_MESSAGE, "err"); return; }
    const text = $("#genOutput").value;
    const caseId = $("#genCase").value;
    if (!text.trim()) { setStatus($("#genStatusMsg"), "Gere a pré-visualização antes de salvar.", "err"); return; }
    if (!caseId) { setStatus($("#genStatusMsg"), "Selecione um processo para salvar o documento nele.", "err"); return; }
    const title = ($("#genTitle").value.trim() || suggestTitle() || "Documento").slice(0, 120);
    const template = state.templates.find((t) => t.id === $("#genTemplate").value);
    const file = new File([text], title + ".txt", { type: "text/plain;charset=utf-8" });
    setBusy(button, true, "Salvando");
    try {
      await h.uploadCaseDocument({ file, caseId, documentType: "outro", notes: "Gerado a partir do modelo " + (template?.title || "") });
      toast("Documento salvo no processo.");
      setStatus($("#genStatusMsg"), "Documento salvo na área Documentos.", "ok");
      await core.loadData();
    } catch (error) {
      setStatus($("#genStatusMsg"), error.message || "Não foi possível salvar o documento.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  // ---------- 4. Atividades / histórico ----------
  const actionLabels = {
    "client.created": "Cliente criado", "client.updated": "Cliente editado",
    "case.created": "Processo criado", "case.updated": "Processo editado",
    "movement.created": "Movimentação registrada",
    "deadline.created": "Prazo criado", "deadline.updated": "Prazo editado", "deadline.completed": "Prazo concluído",
    "task.created": "Tarefa criada", "task.updated": "Tarefa alterada", "task.completed": "Tarefa concluída",
    "event.created": "Compromisso criado", "event.updated": "Compromisso alterado",
    "document.uploaded": "Documento enviado", "document.deleted": "Documento excluído",
    "finance.created": "Lançamento criado", "finance.updated": "Financeiro alterado", "finance.paid": "Pagamento registrado",
    "template.created": "Modelo criado", "template.updated": "Modelo editado", "template.deleted": "Modelo excluído",
    "lead.created": "Interessado cadastrado", "lead.updated": "Interessado editado",
    "checklist.created": "Checklist criado", "checklist.completed": "Checklist concluído", "checklist.reopened": "Checklist reaberto",
    "message.sent": "WhatsApp enviado", "message.failed": "WhatsApp falhou"
  };
  const entityIcons = { client: "client", case: "case", movement: "movement", deadline: "deadline", task: "task", event: "agenda",
    document: "document", finance: "finance", message: "message", template: "template", lead: "lead", checklist: "task" };
  const activityState = { logs: [], loaded: false, loading: false, error: "" };

  function actionLabel(action) {
    return actionLabels[action] || String(action || "Atividade");
  }

  async function loadActivityLogs() {
    if (!core.ACTIVITY_LOG_ENABLED || !state.firm || activityState.loading) return;
    activityState.loading = true;
    try {
      const { data, error } = await supabase.from("activity_logs").select("*")
        .eq("firm_id", state.firm.id).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      activityState.logs = data || [];
      activityState.error = "";
    } catch (error) {
      activityState.error = error.message || "Não foi possível carregar o histórico.";
    } finally {
      activityState.loaded = true;
      activityState.loading = false;
      renderActivity();
    }
  }

  // Sem a tabela activity_logs, o histórico é reconstruído a partir das datas dos próprios registros.
  function derivedActivities() {
    const out = [];
    const add = (action, type, date, summary, actor, open) => {
      const d = toDate(date);
      if (d) out.push({ action, type, date: d, summary, actor, open, derived: true });
    };
    const edited = (a, b) => { const x = toDate(a); const y = toDate(b); return x && y && y - x > 60000; };

    state.clients.forEach((c) => {
      add("client.created", "client", c.created_at, "Cliente criado: " + c.full_name, c.created_by, "client|" + c.id);
      if (edited(c.created_at, c.updated_at)) add("client.updated", "client", c.updated_at, "Cliente editado: " + c.full_name, null, "client|" + c.id);
    });
    state.cases.forEach((c) => {
      add("case.created", "case", c.created_at, "Processo criado: " + (c.title || c.process_number), c.created_by, "case|" + c.id);
      if (edited(c.created_at, c.updated_at)) add("case.updated", "case", c.updated_at, "Processo editado: " + (c.title || c.process_number), null, "case|" + c.id);
    });
    state.updates.forEach((u) => add("movement.created", "movement", u.created_at || u.event_date, "Movimentação registrada: " + (u.title || ""), u.created_by, "movement|" + u.id));
    state.deadlines.forEach((d) => {
      add("deadline.created", "deadline", d.created_at, "Prazo criado: " + d.title, d.created_by, "deadline|" + d.id);
      if (d.completed_at) add("deadline.completed", "deadline", d.completed_at, "Prazo concluído: " + d.title, d.responsible_user_id || d.created_by, "deadline|" + d.id);
    });
    state.tasks.forEach((t) => {
      add("task.created", "task", t.created_at, "Tarefa criada: " + t.title, t.created_by, "task|" + t.id);
      if (t.completed_at) add("task.completed", "task", t.completed_at, "Tarefa concluída: " + t.title, t.assigned_to, "task|" + t.id);
      else if (edited(t.created_at, t.updated_at)) add("task.updated", "task", t.updated_at, "Tarefa alterada: " + t.title, null, "task|" + t.id);
    });
    state.calendarEvents.forEach((e) => add("event.created", "event", e.created_at, "Compromisso criado: " + e.title, e.created_by, "event|" + e.id));
    state.documents.forEach((d) => add("document.uploaded", "document", d.created_at, "Documento enviado: " + d.name, d.uploaded_by, "document|" + d.id));
    state.financialEntries.forEach((f) => {
      add("finance.created", "finance", f.created_at, "Lançamento criado: " + f.description + " (" + h.money(f.amount) + ")", f.created_by, "finance|" + f.id);
      if (f.status === "paid" && f.paid_at) add("finance.paid", "finance", f.paid_at, "Pagamento registrado: " + f.description, null, "finance|" + f.id);
      else if (edited(f.created_at, f.updated_at)) add("finance.updated", "finance", f.updated_at, "Financeiro alterado: " + f.description, null, "finance|" + f.id);
    });
    state.notifications.filter((n) => n.channel === "whatsapp").forEach((n) => {
      const name = clientById(n.client_id)?.full_name || "cliente";
      add(n.status === "failed" ? "message.failed" : "message.sent", "message", n.sent_at || n.created_at,
        (n.status === "failed" ? "WhatsApp falhou para " : "WhatsApp para ") + name, null, "message|" + n.id);
    });
    state.templates.forEach((t) => {
      add("template.created", "template", t.created_at, "Modelo criado: " + t.title, t.created_by, "template|" + t.id);
      if (edited(t.created_at, t.updated_at)) add("template.updated", "template", t.updated_at, "Modelo editado: " + t.title, null, "template|" + t.id);
    });
    state.leads.forEach((l) => add("lead.created", "lead", l.created_at, "Interessado cadastrado: " + l.full_name, l.created_by, "lead|" + l.id));
    return out;
  }

  function activityEntries() {
    const logEntries = activityState.logs.map((l) => {
      const exists = {
        client: () => clientById(l.entity_id), case: () => caseById(l.entity_id),
        deadline: () => state.deadlines.some((x) => x.id === l.entity_id), task: () => state.tasks.some((x) => x.id === l.entity_id),
        event: () => state.calendarEvents.some((x) => x.id === l.entity_id), finance: () => state.financialEntries.some((x) => x.id === l.entity_id),
        document: () => state.documents.some((x) => x.id === l.entity_id), template: () => state.templates.some((x) => x.id === l.entity_id),
        lead: () => state.leads.some((x) => x.id === l.entity_id), movement: () => state.updates.some((x) => x.id === l.entity_id)
      }[l.entity_type];
      const open = l.entity_id && exists?.() ? l.entity_type + "|" + l.entity_id : "log|" + l.id;
      return { action: l.action, type: l.entity_type === "checklist" ? "case" : l.entity_type, date: toDate(l.created_at),
        summary: l.summary || actionLabel(l.action), actor: l.actor_id, open, derived: false };
    }).filter((x) => x.date);

    if (!core.ACTIVITY_LOG_ENABLED || !logEntries.length) return derivedActivities();
    // Registros reais + histórico reconstruído apenas para o período anterior ao primeiro registro.
    const oldest = Math.min(...logEntries.map((x) => x.date.getTime()));
    return logEntries.concat(derivedActivities().filter((x) => x.date.getTime() < oldest));
  }

  function renderActivity() {
    const target = $("#activityList");
    if (!target) return;
    const notice = $("#activityNotice");
    if (!core.ACTIVITY_LOG_ENABLED) {
      notice.textContent = "Histórico reconstruído a partir das datas de criação, conclusão e alteração dos registros. " +
        "Exclusões e o autor de cada edição passam a aparecer depois que a tabela de atividades for criada no Supabase.";
      notice.classList.remove("hidden");
    } else if (activityState.error) {
      notice.textContent = "Não foi possível carregar o histórico gravado (" + activityState.error + "). Exibindo o histórico reconstruído.";
      notice.classList.remove("hidden");
    } else {
      notice.classList.add("hidden");
    }

    const type = $("#activityType")?.value || "all";
    const period = $("#activityPeriod")?.value || "30";
    const query = norm($("#activitySearch")?.value || "");
    const since = period === "all" ? 0 : Date.now() - Number(period) * 864e5;
    const all = activityEntries().sort((a, b) => b.date - a.date);
    const list = all.filter((x) => (type === "all" || x.type === type) && x.date.getTime() >= since &&
      norm(x.summary + " " + actionLabel(x.action)).includes(query));

    const limit = 300;
    $("#activityCount").textContent = list.length > limit ? "Mostrando " + limit + " de " + list.length : list.length + " atividade(s)";
    if (!list.length) {
      target.innerHTML = '<div class="empty">Nenhuma atividade encontrada neste período.</div>';
      return;
    }
    let lastKey = "";
    target.innerHTML = list.slice(0, limit).map((x) => {
      const key = dateKey(x.date);
      const head = key !== lastKey ? '<div class="tl-day">' + esc(h.dayTitle(key)) + '</div>' : "";
      lastKey = key;
      const time = h.timeFormatter.format(x.date);
      return head + '<div class="activity-item">' +
        '<span class="tl-icon">' + icon(entityIcons[x.type]) + '</span>' +
        '<span class="activity-body"><strong>' + esc(x.summary) + '</strong>' +
        '<small>' + esc([time, actionLabel(x.action), x.actor ? "por " + h.responsibleLabel(x.actor) : "", x.derived ? "reconstruído" : ""].filter(Boolean).join(" • ")) + '</small></span>' +
        (x.open ? '<button type="button" class="btn ghost sm" data-tl-open="' + esc(x.open) + '">Abrir</button>' : "") +
      '</div>';
    }).join("");
  }

  // ---------- Eventos ----------
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-tl-open],[data-tl-detail],[data-timeline-filter],[data-timeline-order],[data-goto-section],[data-insert-var],[data-generate-template]");
    if (!target || target.disabled) return;
    if (target.dataset.tlOpen) openEntity(target.dataset.tlOpen, target);
    else if (target.dataset.tlDetail) showTimelineDetail(target.dataset.tlDetail);
    else if (target.dataset.timelineFilter) { timelineState.filter = target.dataset.timelineFilter; renderCaseTimeline(state.activeCaseWorkspaceId); }
    else if (target.hasAttribute("data-timeline-order")) { timelineState.newestFirst = !timelineState.newestFirst; renderCaseTimeline(state.activeCaseWorkspaceId); }
    else if (target.dataset.gotoSection) core.switchSection(target.dataset.gotoSection);
    else if (target.dataset.insertVar) insertVariable(target.dataset.insertVar);
    else if (target.dataset.generateTemplate) openGenerator(target.dataset.generateTemplate);
  });

  $("#openGeneratorBtn")?.addEventListener("click", () => openGenerator());
  $("#genPreviewBtn")?.addEventListener("click", generatePreview);
  $("#genCopyBtn")?.addEventListener("click", copyGenerated);
  $("#genPrintBtn")?.addEventListener("click", printGenerated);
  $("#genSaveBtn")?.addEventListener("click", (event) => saveGenerated(event.currentTarget));
  $("#genCase")?.addEventListener("change", () => {
    const proc = caseById($("#genCase").value);
    if (proc?.client_id) $("#genClient").value = proc.client_id;
  });
  ["genTemplate", "genClient", "genCase"].forEach((id) => $("#" + id)?.addEventListener("change", () => {
    $("#genTitle").value = suggestTitle();
    if (!$("#genPreviewWrap").classList.contains("hidden")) generatePreview();
  }));
  ["activitySearch", "activityType", "activityPeriod"].forEach((id) => $("#" + id)?.addEventListener("input", renderActivity));
  // Ao abrir um processo, a linha do tempo volta a mostrar todas as categorias.
  $("#caseWorkspaceDialog")?.addEventListener("close", () => { timelineState.filter = "all"; });

  function renderAll() {
    renderVarChips();
    renderDeadlineAlerts();
    renderActivity();
    if (core.ACTIVITY_LOG_ENABLED && !activityState.loading) loadActivityLogs();
  }

  window.AdvogaFeatures = { renderAll, renderCaseTimeline, openGenerator, fillTemplate, variableValues };

  // Os dados podem já ter sido carregados antes deste script: renderiza o estado atual.
  if (state.firm) renderAll();
})();
