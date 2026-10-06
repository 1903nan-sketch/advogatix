(() => {
  const core = window.AdvogaCore;
  if (!core) return;

  const {
    supabase, state, $, $$, esc, norm, brDate, toIso, toLocalInput, dateKey,
    toast, setStatus, setBusy, openDialog, closeDialog, badge,
    clientById, caseById
  } = core;

  const priorityLabels = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
  const priorityTypes = { low: "", normal: "", high: "warn", urgent: "err" };
  const deadlineStatusLabels = { pending: "Pendente", in_progress: "Em andamento", completed: "Concluído", cancelled: "Cancelado" };
  const deadlineTypeLabels = { processual: "Processual", appeal: "Recurso", administrative: "Administrativo", internal: "Interno", hearing: "Audiência", other: "Outro" };
  const taskStatusLabels = { todo: "A fazer", in_progress: "Em andamento", waiting: "Aguardando", completed: "Concluída", cancelled: "Cancelada" };
  const eventTypeLabels = { hearing: "Audiência", expert_exam: "Perícia", meeting: "Reunião", deadline: "Prazo", court_visit: "Diligência", other: "Compromisso" };
  const financeTypeLabels = {
    fee: "Honorários", success_fee: "Honorários de êxito", cost: "Custas",
    expense: "Despesa", client_transfer: "Repasse ao cliente",
    other_receivable: "Outro recebimento", other_payable: "Outro pagamento"
  };
  const financeStatusLabels = { pending: "Pendente", paid: "Pago", overdue: "Vencido", cancelled: "Cancelado" };
  const leadStatusLabels = { lead: "Interessado", consultation: "Consulta", proposal: "Proposta", contracted: "Contratado", lost: "Perdido" };
  const payableTypes = new Set(["cost", "expense", "client_transfer", "other_payable"]);

  function financeIsReceivable(item) {
    return !payableTypes.has(item.entry_type);
  }

  function money(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
  }

  // Soma em centavos para evitar erros de arredondamento de ponto flutuante.
  function sumAmounts(list) {
    return list.reduce((cents, x) => cents + Math.round(Number(x.amount || 0) * 100), 0) / 100;
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function isToday(value) {
    return !!value && dateKey(value) === todayKey();
  }

  // Prazos e tarefas têm data e hora: vencem assim que o horário passa.
  function isOverdue(value, status) {
    if (!value || ["completed", "cancelled", "paid"].includes(status)) return false;
    return new Date(value).getTime() < Date.now();
  }

  // Mantém a data original de conclusão/pagamento ao editar um item já concluído.
  function keepTimestamp(item, field, active) {
    if (!active) return null;
    return item?.[field] || new Date().toISOString();
  }

  function dueClass(value, status) {
    if (isOverdue(value, status)) return "due-overdue";
    if (isToday(value)) return "due-today";
    return "";
  }

  function responsibleLabel(userId) {
    if (!userId) return "Não informado";
    return userId === state.user?.id ? "Você" : "Outro membro";
  }

  function responsibleFormLabel(userId) {
    const who = responsibleLabel(userId || state.user?.id);
    return who === "Você" ? `${state.user?.email || "Você"} (usuário atual)` : who;
  }

  function clientOptions(selected, allowEmpty = true) {
    const empty = allowEmpty ? '<option value="">Sem cliente</option>' : "";
    return empty + state.clients
      .filter((c) => c.status === "active" || c.id === selected)
      .map((c) => '<option value="' + esc(c.id) + '"' + (c.id === selected ? " selected" : "") + ">" + esc(c.full_name) + "</option>")
      .join("");
  }

  function caseOptions(selected, allowEmpty = true) {
    const empty = allowEmpty ? '<option value="">Sem processo</option>' : "";
    return empty + state.cases
      .filter((c) => c.status !== "archived" || c.id === selected)
      .map((c) => {
        const client = clientById(c.client_id);
        const num = c.process_number ? " — " + c.process_number : "";
        return '<option value="' + esc(c.id) + '"' + (c.id === selected ? " selected" : "") + ">" +
          esc(client?.full_name || "Cliente") + " — " + esc(c.title) + esc(num) + "</option>";
      }).join("");
  }

  function fillOrganizerSelects(values = {}) {
    const clientIds = ["deadlineClient", "taskClient", "eventClient", "financeClient"];
    const caseIds = ["deadlineCase", "taskCase", "eventCase", "financeCase"];
    clientIds.forEach((id) => {
      const el = $("#" + id);
      if (el) el.innerHTML = clientOptions(values[id] || "");
    });
    caseIds.forEach((id) => {
      const el = $("#" + id);
      if (el) el.innerHTML = caseOptions(values[id] || "");
    });
  }

  function syncClientFromCase(caseSelectId, clientSelectId) {
    const caseId = $("#" + caseSelectId)?.value;
    const item = caseById(caseId);
    if (item && $("#" + clientSelectId)) $("#" + clientSelectId).value = item.client_id || "";
  }

  [["deadlineCase","deadlineClient"],["taskCase","taskClient"],["eventCase","eventClient"],["financeCase","financeClient"]]
    .forEach(([caseId, clientId]) => {
      $("#" + caseId)?.addEventListener("change", () => syncClientFromCase(caseId, clientId));
    });

  function openDeadlineDialog(id = null) {
    state.editingDeadlineId = id;
    $("#deadlineForm").reset();
    setStatus($("#deadlineStatusMsg"));
    const item = id ? state.deadlines.find((x) => x.id === id) : null;
    fillOrganizerSelects({
      deadlineCase: item?.case_id || "",
      deadlineClient: item?.client_id || ""
    });
    $("#deadlineDialogTitle").textContent = item ? "Editar prazo" : "Novo prazo";
    $("#deadlineSaveBtn").textContent = item ? "Salvar alterações" : "Salvar prazo";
    $("#deadlinePriority").value = item?.priority || "normal";
    $("#deadlineStatus").value = item?.status || "pending";
    $("#deadlineType").value = item?.deadline_type || "processual";
    $("#deadlineResponsible").value = responsibleFormLabel(item?.responsible_user_id || item?.created_by);
    window.AdvogaDeadlineCalc?.reset(item);
    if (item) {
      $("#deadlineTitle").value = item.title || "";
      $("#deadlineDue").value = toLocalInput(item.due_at);
      $("#deadlineSource").value = item.source || "";
      $("#deadlineNotes").value = item.notes || "";
    }
    openDialog("deadlineDialog");
  }

  $("#deadlineForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Salvando");
    const status = $("#deadlineStatus").value;
    const current = state.editingDeadlineId ? state.deadlines.find((x) => x.id === state.editingDeadlineId) : null;
    const payload = {
      title: $("#deadlineTitle").value.trim(),
      case_id: $("#deadlineCase").value || null,
      client_id: $("#deadlineClient").value || null,
      deadline_type: $("#deadlineType").value,
      due_at: toIso($("#deadlineDue").value),
      priority: $("#deadlinePriority").value,
      status,
      source: $("#deadlineSource").value.trim() || null,
      notes: $("#deadlineNotes").value.trim() || null,
      completed_at: keepTimestamp(current, "completed_at", status === "completed"),
      responsible_user_id: current ? (current.responsible_user_id ?? current.created_by ?? state.user.id) : state.user.id
    };
    // Guarda como a data foi calculada, quando o vencimento veio da calculadora.
    const calculation = window.AdvogaDeadlineCalc?.calculationFor($("#deadlineDue").value);
    if (calculation) payload.calculation = calculation;
    try {
      if (state.editingDeadlineId) {
        const { error } = await supabase.from("deadlines").update(payload)
          .eq("id", state.editingDeadlineId).eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Prazo atualizado.");
        const completedNow = status === "completed" && current?.status !== "completed";
        core.logActivity(completedNow ? "deadline.completed" : "deadline.updated", "deadline", state.editingDeadlineId,
          (completedNow ? "Prazo concluído: " : "Prazo editado: ") + payload.title,
          { case_id: payload.case_id, fields: core.changedFields(current, payload) });
      } else {
        const { data: created, error } = await supabase.from("deadlines").insert({
          ...payload, firm_id: state.firm.id, created_by: state.user.id
        }).select("id").single();
        if (error) throw error;
        toast("Prazo cadastrado.");
        core.logActivity("deadline.created", "deadline", created?.id, "Prazo criado: " + payload.title, { case_id: payload.case_id });
      }
      closeDialog("deadlineDialog");
      await core.loadData();
    } catch (error) {
      setStatus($("#deadlineStatusMsg"), error.message || "Não foi possível salvar o prazo.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  async function completeDeadline(id, button) {
    setBusy(button, true, "Concluindo");
    try {
      const { error } = await supabase.from("deadlines")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id).eq("firm_id", state.firm.id);
      if (error) throw error;
      toast("Prazo concluído.");
      const done = state.deadlines.find((x) => x.id === id);
      core.logActivity("deadline.completed", "deadline", id, "Prazo concluído: " + (done?.title || ""), { case_id: done?.case_id || null });
      await core.loadData();
    } catch (error) {
      toast(error.message || "Não foi possível concluir o prazo.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  function openTaskDialog(id = null) {
    state.editingTaskId = id;
    $("#taskForm").reset();
    setStatus($("#taskStatusMsg"));
    const item = id ? state.tasks.find((x) => x.id === id) : null;
    fillOrganizerSelects({
      taskCase: item?.case_id || "",
      taskClient: item?.client_id || ""
    });
    $("#taskDialogTitle").textContent = item ? "Editar tarefa" : "Nova tarefa";
    $("#taskSaveBtn").textContent = item ? "Salvar alterações" : "Salvar tarefa";
    $("#taskPriority").value = item?.priority || "normal";
    $("#taskStatus").value = item?.status || "todo";
    $("#taskResponsible").value = responsibleFormLabel(item?.assigned_to);
    if (item) {
      $("#taskTitle").value = item.title || "";
      $("#taskDue").value = toLocalInput(item.due_at);
      $("#taskDescription").value = item.description || "";
    }
    openDialog("taskDialog");
  }

  $("#taskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Salvando");
    const status = $("#taskStatus").value;
    const current = state.editingTaskId ? state.tasks.find((x) => x.id === state.editingTaskId) : null;
    const payload = {
      title: $("#taskTitle").value.trim(),
      description: $("#taskDescription").value.trim() || null,
      case_id: $("#taskCase").value || null,
      client_id: $("#taskClient").value || null,
      due_at: toIso($("#taskDue").value),
      priority: $("#taskPriority").value,
      status,
      assigned_to: current ? (current.assigned_to ?? state.user.id) : state.user.id,
      completed_at: keepTimestamp(current, "completed_at", status === "completed")
    };
    try {
      if (state.editingTaskId) {
        const { error } = await supabase.from("tasks").update(payload)
          .eq("id", state.editingTaskId).eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Tarefa atualizada.");
        core.logActivity("task.updated", "task", state.editingTaskId, "Tarefa alterada: " + payload.title,
          { case_id: payload.case_id, fields: core.changedFields(current, payload), status_from: current?.status, status_to: status });
      } else {
        const { data: created, error } = await supabase.from("tasks").insert({
          ...payload, firm_id: state.firm.id, created_by: state.user.id
        }).select("id").single();
        if (error) throw error;
        toast("Tarefa criada.");
        core.logActivity("task.created", "task", created?.id, "Tarefa criada: " + payload.title, { case_id: payload.case_id });
      }
      closeDialog("taskDialog");
      await core.loadData();
    } catch (error) {
      setStatus($("#taskStatusMsg"), error.message || "Não foi possível salvar a tarefa.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  async function completeTask(id, button) {
    setBusy(button, true, "Concluindo");
    try {
      const { error } = await supabase.from("tasks")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id).eq("firm_id", state.firm.id);
      if (error) throw error;
      toast("Tarefa concluída.");
      const done = state.tasks.find((x) => x.id === id);
      core.logActivity("task.completed", "task", id, "Tarefa concluída: " + (done?.title || ""), { case_id: done?.case_id || null });
      await core.loadData();
    } catch (error) {
      toast(error.message || "Não foi possível concluir a tarefa.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  function openEventDialog(id = null) {
    state.editingEventId = id;
    $("#eventForm").reset();
    setStatus($("#eventStatusMsg"));
    const item = id ? state.calendarEvents.find((x) => x.id === id) : null;
    fillOrganizerSelects({
      eventCase: item?.case_id || "",
      eventClient: item?.client_id || ""
    });
    $("#eventDialogTitle").textContent = item ? "Editar compromisso" : "Novo compromisso";
    $("#eventSaveBtn").textContent = item ? "Salvar alterações" : "Salvar compromisso";
    $("#eventType").value = item?.event_type || "meeting";
    $("#eventResponsible").value = responsibleFormLabel(item?.responsible_user_id);
    if (item) {
      $("#eventTitle").value = item.title || "";
      $("#eventStart").value = toLocalInput(item.start_at);
      $("#eventEnd").value = toLocalInput(item.end_at);
      $("#eventModality").value = item.modality || "";
      $("#eventLocation").value = item.location || "";
      $("#eventNotes").value = item.notes || "";
    }
    openDialog("eventDialog");
  }

  $("#eventForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const startIso = toIso($("#eventStart").value);
    const endIso = toIso($("#eventEnd").value);
    if (startIso && endIso && new Date(endIso) < new Date(startIso)) {
      setStatus($("#eventStatusMsg"), "O término não pode ser antes do início.", "err");
      return;
    }
    const current = state.editingEventId ? state.calendarEvents.find((x) => x.id === state.editingEventId) : null;
    setBusy(button, true, "Salvando");
    const payload = {
      title: $("#eventTitle").value.trim(),
      event_type: $("#eventType").value,
      start_at: startIso,
      end_at: endIso,
      case_id: $("#eventCase").value || null,
      client_id: $("#eventClient").value || null,
      modality: $("#eventModality").value || null,
      location: $("#eventLocation").value.trim() || null,
      notes: $("#eventNotes").value.trim() || null,
      responsible_user_id: current ? (current.responsible_user_id ?? state.user.id) : state.user.id
    };
    try {
      if (state.editingEventId) {
        const { error } = await supabase.from("calendar_events").update(payload)
          .eq("id", state.editingEventId).eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Compromisso atualizado.");
        core.logActivity("event.updated", "event", state.editingEventId, "Compromisso alterado: " + payload.title,
          { case_id: payload.case_id, fields: core.changedFields(current, payload) });
      } else {
        const { data: created, error } = await supabase.from("calendar_events").insert({
          ...payload, firm_id: state.firm.id, created_by: state.user.id
        }).select("id").single();
        if (error) throw error;
        toast("Compromisso criado.");
        core.logActivity("event.created", "event", created?.id, "Compromisso criado: " + payload.title, { case_id: payload.case_id });
      }
      closeDialog("eventDialog");
      await core.loadData();
    } catch (error) {
      setStatus($("#eventStatusMsg"), error.message || "Não foi possível salvar o compromisso.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function openFinanceDialog(id = null) {
    state.editingFinanceId = id;
    $("#financeForm").reset();
    setStatus($("#financeStatusMsg"));
    const item = id ? state.financialEntries.find((x) => x.id === id) : null;
    fillOrganizerSelects({
      financeCase: item?.case_id || "",
      financeClient: item?.client_id || ""
    });
    $("#financeDialogTitle").textContent = item ? "Editar lançamento" : "Novo lançamento";
    $("#financeSaveBtn").textContent = item ? "Salvar alterações" : "Salvar lançamento";
    $("#financeType").value = item?.entry_type || "fee";
    $("#financeStatus").value = item?.status || "pending";
    if (item) {
      $("#financeDescription").value = item.description || "";
      $("#financeAmount").value = item.amount ?? "";
      $("#financeDue").value = item.due_date || "";
      $("#financeMethod").value = item.payment_method || "";
      $("#financeNotes").value = item.notes || "";
    }
    openDialog("financeDialog");
  }

  $("#financeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const amount = Math.round(Number($("#financeAmount").value || 0) * 100) / 100;
    if (!(amount > 0)) {
      setStatus($("#financeStatusMsg"), "Informe um valor maior que zero.", "err");
      return;
    }
    setBusy(button, true, "Salvando");
    const status = $("#financeStatus").value;
    const current = state.editingFinanceId ? state.financialEntries.find((x) => x.id === state.editingFinanceId) : null;
    const payload = {
      description: $("#financeDescription").value.trim(),
      entry_type: $("#financeType").value,
      amount,
      client_id: $("#financeClient").value || null,
      case_id: $("#financeCase").value || null,
      due_date: $("#financeDue").value || null,
      status,
      paid_at: keepTimestamp(current, "paid_at", status === "paid"),
      payment_method: $("#financeMethod").value || null,
      notes: $("#financeNotes").value.trim() || null
    };
    try {
      if (state.editingFinanceId) {
        const { error } = await supabase.from("financial_entries").update(payload)
          .eq("id", state.editingFinanceId).eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Lançamento atualizado.");
        core.logActivity("finance.updated", "finance", state.editingFinanceId, "Financeiro alterado: " + payload.description,
          { case_id: payload.case_id, fields: core.changedFields(current, payload), amount: payload.amount });
      } else {
        const { data: created, error } = await supabase.from("financial_entries").insert({
          ...payload, firm_id: state.firm.id, created_by: state.user.id
        }).select("id").single();
        if (error) throw error;
        toast("Lançamento criado.");
        core.logActivity("finance.created", "finance", created?.id, "Lançamento criado: " + payload.description, { case_id: payload.case_id, amount: payload.amount });
      }
      closeDialog("financeDialog");
      await core.loadData();
    } catch (error) {
      setStatus($("#financeStatusMsg"), error.message || "Não foi possível salvar o lançamento.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  async function markPaid(id, button) {
    setBusy(button, true, "Baixando");
    try {
      const { error } = await supabase.from("financial_entries")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", id).eq("firm_id", state.firm.id);
      if (error) throw error;
      toast("Pagamento registrado.");
      const paid = state.financialEntries.find((x) => x.id === id);
      core.logActivity("finance.paid", "finance", id, "Pagamento registrado: " + (paid?.description || ""), { case_id: paid?.case_id || null, amount: paid?.amount });
      await core.loadData();
    } catch (error) {
      toast(error.message || "Não foi possível dar baixa.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  function openLeadDialog(id = null) {
    state.editingLeadId = id;
    $("#leadForm").reset();
    setStatus($("#leadStatusMsg"));
    const item = id ? state.leads.find((x) => x.id === id) : null;
    $("#leadDialogTitle").textContent = item ? "Editar interessado" : "Novo interessado";
    $("#leadSaveBtn").textContent = item ? "Salvar alterações" : "Salvar interessado";
    $("#leadStage").value = item?.status || "lead";
    if (item) {
      $("#leadName").value = item.full_name || "";
      $("#leadPhone").value = item.phone || "";
      $("#leadEmail").value = item.email || "";
      $("#leadSource").value = item.source || "";
      $("#leadArea").value = item.legal_area || "";
      $("#leadValue").value = item.potential_value ?? "";
      $("#leadNextContact").value = toLocalInput(item.next_contact_at);
      $("#leadNotes").value = item.notes || "";
    }
    openDialog("leadDialog");
  }

  $("#leadForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Salvando");
    const payload = {
      full_name: $("#leadName").value.trim(),
      phone: $("#leadPhone").value.trim() || null,
      email: $("#leadEmail").value.trim() || null,
      source: $("#leadSource").value.trim() || null,
      legal_area: $("#leadArea").value.trim() || null,
      status: $("#leadStage").value,
      potential_value: $("#leadValue").value ? Number($("#leadValue").value) : null,
      next_contact_at: toIso($("#leadNextContact").value),
      notes: $("#leadNotes").value.trim() || null
    };
    try {
      if (state.editingLeadId) {
        const { error } = await supabase.from("crm_leads").update(payload)
          .eq("id", state.editingLeadId).eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Interessado atualizado.");
        core.logActivity("lead.updated", "lead", state.editingLeadId, "Interessado editado: " + payload.full_name);
      } else {
        const { data: created, error } = await supabase.from("crm_leads").insert({
          ...payload, firm_id: state.firm.id, created_by: state.user.id
        }).select("id").single();
        if (error) throw error;
        toast("Interessado cadastrado.");
        core.logActivity("lead.created", "lead", created?.id, "Interessado cadastrado: " + payload.full_name);
      }
      closeDialog("leadDialog");
      await core.loadData();
    } catch (error) {
      setStatus($("#leadStatusMsg"), error.message || "Não foi possível salvar o interessado.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  // ---------- Central de prazos ----------
  // Faixas por dia de calendário no horário de Brasília. "Vencidos" usa o horário exato.
  const deadlineBuckets = [
    { key: "overdue", label: "Vencidos", tone: "err" },
    { key: "today", label: "Vencem hoje", tone: "warn" },
    { key: "tomorrow", label: "Vencem amanhã", tone: "warn" },
    { key: "next3", label: "Próximos 3 dias", tone: "" },
    { key: "next7", label: "Próximos 7 dias", tone: "" },
    { key: "future", label: "Futuros", tone: "" },
    { key: "completed", label: "Concluídos", tone: "ok" }
  ];
  const priorityWeight = { urgent: 4, high: 3, normal: 2, low: 1 };

  function daysFromToday(value) {
    const key = dateKey(value);
    if (!key) return null;
    return Math.round((keyToDate(key) - keyToDate(todayKey())) / 864e5);
  }

  function deadlineBucket(item) {
    if (item.status === "completed") return "completed";
    if (item.status === "cancelled") return "cancelled";
    if (!item.due_at) return "future";
    if (isOverdue(item.due_at, item.status)) return "overdue";
    const days = daysFromToday(item.due_at);
    if (days <= 0) return "today";
    if (days === 1) return "tomorrow";
    if (days <= 3) return "next3";
    if (days <= 7) return "next7";
    return "future";
  }

  // Texto de contagem: "Vence hoje às 18:00", "Atrasado há 2 dias", "Vence em 5 dias".
  function deadlineCountdown(item) {
    const bucket = deadlineBucket(item);
    if (bucket === "completed") return { text: item.completed_at ? "Concluído em " + brDate(item.completed_at) : "Concluído", tone: "ok" };
    if (bucket === "cancelled") return { text: "Cancelado", tone: "" };
    if (!item.due_at) return { text: "Sem data", tone: "" };
    const days = daysFromToday(item.due_at);
    const time = timeFormatter.format(new Date(item.due_at));
    if (bucket === "overdue") {
      if (days >= 0) return { text: "Venceu hoje às " + time, tone: "err" };
      const late = Math.abs(days);
      return { text: "Atrasado há " + late + (late === 1 ? " dia" : " dias"), tone: "err" };
    }
    if (bucket === "today") return { text: "Vence hoje às " + time, tone: "warn" };
    if (bucket === "tomorrow") return { text: "Vence amanhã às " + time, tone: "warn" };
    return { text: "Vence em " + days + " dias", tone: bucket === "next3" ? "warn" : "" };
  }

  function sortDeadlines(list) {
    return list.slice().sort((a, b) => {
      if (a.status === "completed" && b.status === "completed") {
        return new Date(b.completed_at || b.due_at || 0) - new Date(a.completed_at || a.due_at || 0);
      }
      const byDate = new Date(a.due_at || 8.64e15) - new Date(b.due_at || 8.64e15);
      return byDate || (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
    });
  }

  function renderDeadlines() {
    const query = norm($("#deadlineSearch")?.value || "");
    const filter = $("#deadlineFilter")?.value || "open";
    const priority = $("#deadlinePriorityFilter")?.value || "all";

    const base = state.deadlines.filter((item) => {
      const client = clientById(item.client_id);
      const proc = caseById(item.case_id);
      const matchesQuery = norm(item.title + " " + (item.source || "") + " " + (client?.full_name || "") + " " + (proc?.process_number || "") + " " + (proc?.title || "")).includes(query);
      const matchesPriority = priority === "all" || item.priority === priority;
      return matchesQuery && matchesPriority;
    });

    const counts = {};
    base.forEach((item) => { const b = deadlineBucket(item); counts[b] = (counts[b] || 0) + 1; });
    const bucketsBox = $("#deadlineBuckets");
    if (bucketsBox) {
      bucketsBox.innerHTML = deadlineBuckets.map((b) =>
        '<button type="button" class="bucket-card' + (b.tone ? " tone-" + b.tone : "") + (filter === b.key ? " is-active" : "") + '" data-deadline-bucket="' + b.key + '" aria-pressed="' + (filter === b.key) + '">' +
          '<span>' + esc(b.label) + '</span><b>' + (counts[b.key] || 0) + '</b></button>'
      ).join("");
    }

    const list = sortDeadlines(base.filter((item) => {
      const bucket = deadlineBucket(item);
      if (filter === "all") return true;
      if (filter === "open") return !["completed", "cancelled"].includes(bucket);
      return bucket === filter;
    }));

    $("#deadlineCount").textContent = list.length + " de " + state.deadlines.length;
    $("#deadlinesBody").innerHTML = list.length ? list.map((item) => {
      const client = clientById(item.client_id || caseById(item.case_id)?.client_id);
      const proc = caseById(item.case_id);
      const bucket = deadlineBucket(item);
      const countdown = deadlineCountdown(item);
      const statusType = item.status === "completed" ? "ok" : bucket === "overdue" ? "err" : item.status === "in_progress" ? "warn" : "";
      return '<tr class="deadline-row bucket-' + bucket + '">' +
        '<td><div class="row-main"><strong>' + esc(item.title) + '</strong>' +
          '<span class="small">Responsável: ' + esc(responsibleLabel(item.responsible_user_id || item.created_by)) + '</span>' +
          '<span class="small">' + esc([item.source, item.deadline_type ? deadlineTypeLabels[item.deadline_type] || item.deadline_type : ""].filter(Boolean).join(" • ")) + '</span></div></td>' +
        '<td><strong class="nowrap-num">' + esc(proc?.process_number || proc?.title || "Sem processo") + '</strong><div class="small">' + esc(client?.full_name || "Sem cliente") + '</div></td>' +
        '<td class="' + dueClass(item.due_at, item.status) + '">' + (item.due_at ? brDate(item.due_at) : "—") + '</td>' +
        '<td>' + badge(countdown.text, countdown.tone) + '</td>' +
        '<td><div class="badge-stack">' + badge(priorityLabels[item.priority] || item.priority || "Normal", priorityTypes[item.priority] || "") +
          badge(deadlineStatusLabels[item.status] || item.status, statusType) + '</div></td>' +
        '<td><div class="row-actions">' +
          (!["completed","cancelled"].includes(item.status) ? '<button class="btn ghost sm" data-complete-deadline="' + esc(item.id) + '">Concluir</button>' : "") +
          '<button class="btn secondary sm" data-edit-deadline="' + esc(item.id) + '">Editar</button>' +
        '</div></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">Nenhum prazo encontrado.</td></tr>';
  }

  function renderTasks() {
    const query = norm($("#taskSearch")?.value || "");
    const filter = $("#taskFilter")?.value || "open";
    const list = state.tasks.filter((item) => {
      const client = clientById(item.client_id);
      const proc = caseById(item.case_id);
      const matchesQuery = norm(item.title + " " + (item.description || "") + " " + (client?.full_name || "") + " " + (proc?.process_number || "")).includes(query);
      let matchesFilter = true;
      if (filter === "open") matchesFilter = !["completed","cancelled"].includes(item.status);
      if (filter === "overdue") matchesFilter = isOverdue(item.due_at, item.status);
      if (filter === "completed") matchesFilter = item.status === "completed";
      return matchesQuery && matchesFilter;
    });

    $("#taskCount").textContent = list.length + " de " + state.tasks.length;
    $("#tasksBody").innerHTML = list.length ? list.map((item) => {
      const client = clientById(item.client_id);
      const proc = caseById(item.case_id);
      const statusType = item.status === "completed" ? "ok" : isOverdue(item.due_at, item.status) ? "err" : item.status === "in_progress" ? "warn" : "";
      return '<tr>' +
        '<td><div class="row-main"><strong>' + esc(item.title) + '</strong><span class="small">' + esc(item.description || "") + '</span></div></td>' +
        '<td><strong>' + esc(client?.full_name || "—") + '</strong><div class="small">' + esc(proc?.process_number || proc?.title || "") + '</div></td>' +
        '<td>' + esc(responsibleLabel(item.assigned_to)) + '</td>' +
        '<td class="' + dueClass(item.due_at, item.status) + '">' + (item.due_at ? brDate(item.due_at) : "—") + '</td>' +
        '<td>' + badge(priorityLabels[item.priority] || item.priority, priorityTypes[item.priority] || "") + '</td>' +
        '<td>' + badge(taskStatusLabels[item.status] || item.status, statusType) + '</td>' +
        '<td><div class="row-actions">' +
          (!["completed","cancelled"].includes(item.status) ? '<button class="btn ghost sm" data-complete-task="' + esc(item.id) + '">Concluir</button>' : "") +
          '<button class="btn secondary sm" data-edit-task="' + esc(item.id) + '">Editar</button>' +
        '</div></td></tr>';
    }).join("") : '<tr><td colspan="7" class="empty">Nenhuma tarefa encontrada.</td></tr>';

  }

  function renderAgenda() {
    const filter = $("#agendaFilter")?.value || "upcoming";
    const now = Date.now();
    const list = state.calendarEvents.filter((item) => {
      if (filter === "today") return isToday(item.start_at);
      if (filter === "upcoming") return new Date(item.start_at).getTime() >= now - 3600000;
      return true;
    }).sort((a,b) => new Date(a.start_at) - new Date(b.start_at));

    $("#agendaCount").textContent = list.length + " compromissos";
    $("#agendaList").innerHTML = list.length ? list.map((item) => {
      const client = clientById(item.client_id);
      const proc = caseById(item.case_id);
      const cls = isToday(item.start_at) ? "event today" : "event";
      const detail = [client?.full_name, proc?.process_number || proc?.title, item.location, "Responsável: " + responsibleLabel(item.responsible_user_id)].filter(Boolean).join(" • ");
      return '<div class="' + cls + '">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">' +
          '<div><strong>' + esc(item.title) + '</strong><small>' + esc(eventTypeLabels[item.event_type] || item.event_type) + ' • ' + brDate(item.start_at) + '</small></div>' +
          '<button class="btn secondary sm" data-edit-event="' + esc(item.id) + '">Editar</button>' +
        '</div>' +
        (detail ? '<p>' + esc(detail) + '</p>' : "") +
      '</div>';
    }).join("") : '<div class="empty">Nenhum compromisso encontrado.</div>';
  }

  // Lançamento pendente vira "vencido" a partir do dia seguinte ao vencimento (horário de Brasília).
  function effectiveFinanceStatus(item) {
    if (item.status === "pending" && item.due_date && String(item.due_date).slice(0, 10) < todayKey()) return "overdue";
    return item.status;
  }

  function financeTotals(list) {
    const open = (x) => ["pending", "overdue"].includes(effectiveFinanceStatus(x));
    const receivables = list.filter(financeIsReceivable);
    const payables = list.filter((x) => !financeIsReceivable(x));
    const received = sumAmounts(receivables.filter((x) => x.status === "paid"));
    const paidOut = sumAmounts(payables.filter((x) => x.status === "paid"));
    return {
      receivable: sumAmounts(receivables.filter(open)),
      receivableOverdue: sumAmounts(receivables.filter((x) => effectiveFinanceStatus(x) === "overdue")),
      received,
      payable: sumAmounts(payables.filter(open)),
      paidOut,
      balance: Math.round((received - paidOut) * 100) / 100
    };
  }

  function renderFinance() {
    const query = norm($("#financeSearch")?.value || "");
    const filter = $("#financeFilter")?.value || "all";

    const totals = financeTotals(state.financialEntries);
    $("#fPending").textContent = money(totals.receivable);
    $("#fOverdue").textContent = money(totals.receivableOverdue);
    $("#fPaid").textContent = money(totals.received);
    if ($("#fPayable")) $("#fPayable").textContent = money(totals.payable);
    if ($("#fBalance")) $("#fBalance").textContent = money(totals.balance);

    const list = state.financialEntries.filter((item) => {
      const client = clientById(item.client_id);
      const status = effectiveFinanceStatus(item);
      const matchesFilter = filter === "all" || status === filter;
      const matchesQuery = norm(item.description + " " + (client?.full_name || "") + " " + (financeTypeLabels[item.entry_type] || "")).includes(query);
      return matchesFilter && matchesQuery;
    });

    $("#financeCount").textContent = list.length + " de " + state.financialEntries.length;
    $("#financeBody").innerHTML = list.length ? list.map((item) => {
      const client = clientById(item.client_id);
      const status = effectiveFinanceStatus(item);
      const statusType = status === "paid" ? "ok" : status === "overdue" ? "err" : status === "pending" ? "warn" : "";
      const payable = payableTypes.has(item.entry_type);
      return '<tr>' +
        '<td><strong>' + esc(item.description) + '</strong><div class="small">' + esc(financeTypeLabels[item.entry_type] || item.entry_type) + '</div></td>' +
        '<td>' + esc(client?.full_name || "—") + '</td>' +
        '<td class="' + (payable ? "money-negative" : "money-positive") + '">' + (payable ? "− " : "") + money(item.amount) + '</td>' +
        '<td>' + esc(item.due_date ? new Intl.DateTimeFormat("pt-BR").format(new Date(item.due_date + "T12:00:00")) : "—") + '</td>' +
        '<td>' + badge(financeStatusLabels[status] || status, statusType) + '</td>' +
        '<td><div class="row-actions">' +
          (status !== "paid" && status !== "cancelled" ? '<button class="btn ghost sm" data-pay-finance="' + esc(item.id) + '">Dar baixa</button>' : "") +
          '<button class="btn secondary sm" data-edit-finance="' + esc(item.id) + '">Editar</button>' +
        '</div></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">Nenhum lançamento encontrado.</td></tr>';
  }

  function renderLeads() {
    const query = norm($("#leadSearch")?.value || "");
    const filter = $("#leadFilter")?.value || "all";
    const list = state.leads.filter((item) => {
      const matchesFilter = filter === "all" || item.status === filter;
      const matchesQuery = norm(item.full_name + " " + (item.phone || "") + " " + (item.email || "") + " " + (item.source || "") + " " + (item.legal_area || "")).includes(query);
      return matchesFilter && matchesQuery;
    });
    $("#leadCount").textContent = list.length + " de " + state.leads.length;
    $("#leadsBody").innerHTML = list.length ? list.map((item) => {
      const statusType = item.status === "contracted" ? "ok" : item.status === "lost" ? "err" : item.status === "proposal" ? "warn" : "";
      return '<tr>' +
        '<td><strong>' + esc(item.full_name) + '</strong><div class="small">' + esc(item.phone || item.email || "") + '</div></td>' +
        '<td>' + esc([item.source, item.legal_area].filter(Boolean).join(" • ") || "—") + '</td>' +
        '<td>' + (item.next_contact_at ? brDate(item.next_contact_at) : "—") + '</td>' +
        '<td>' + badge(leadStatusLabels[item.status] || item.status, statusType) + '</td>' +
        '<td>' + (item.potential_value != null ? money(item.potential_value) : "—") + '</td>' +
        '<td><div class="row-actions">' +
          (item.status === "contracted" ? '<button class="btn ghost sm" data-convert-lead="' + esc(item.id) + '">Virar cliente</button>' : "") +
          '<button class="btn secondary sm" data-edit-lead="' + esc(item.id) + '">Editar</button>' +
        '</div></td>' +
      '</tr>';
    }).join("") : '<tr><td colspan="6" class="empty">Nenhum interessado encontrado.</td></tr>';
  }

  function renderToday() {
    const openDeadlines = state.deadlines.filter((x) => !["completed","cancelled"].includes(x.status));
    const openTasks = state.tasks.filter((x) => !["completed","cancelled"].includes(x.status));
    $("#mDeadlines").textContent = openDeadlines.length;
    $("#mTasks").textContent = openTasks.length;

    const items = [];
    openDeadlines.filter((x) => isOverdue(x.due_at, x.status)).slice(0,4).forEach((x) => {
      items.push('<div class="event urgent"><strong>Prazo vencido: ' + esc(x.title) + '</strong><small>' + brDate(x.due_at) + '</small></div>');
    });
    openDeadlines.filter((x) => isToday(x.due_at) && !isOverdue(x.due_at, x.status)).slice(0,4).forEach((x) => {
      items.push('<div class="event today"><strong>Prazo hoje: ' + esc(x.title) + '</strong><small>' + brDate(x.due_at) + '</small></div>');
    });
    openTasks.filter((x) => isOverdue(x.due_at, x.status)).slice(0,3).forEach((x) => {
      items.push('<div class="event urgent"><strong>Tarefa atrasada: ' + esc(x.title) + '</strong><small>' + (x.due_at ? brDate(x.due_at) : "") + '</small></div>');
    });
    openTasks.filter((x) => isToday(x.due_at) && !isOverdue(x.due_at, x.status)).slice(0,4).forEach((x) => {
      items.push('<div class="event today"><strong>Tarefa hoje: ' + esc(x.title) + '</strong><small>' + brDate(x.due_at) + '</small></div>');
    });
    state.calendarEvents.filter((x) => isToday(x.start_at)).slice(0,4).forEach((x) => {
      items.push('<div class="event today"><strong>' + esc(eventTypeLabels[x.event_type] || "Compromisso") + ': ' + esc(x.title) + '</strong><small>' + brDate(x.start_at) + '</small></div>');
    });

    const hasOperationalControls = state.deadlines.length || state.tasks.length || state.calendarEvents.length;
    $("#todayList").innerHTML = items.length
      ? items.join("")
      : hasOperationalControls
        ? '<div class="event"><strong>Nenhuma pendência para hoje</strong><small>Não há vencimentos ou compromissos hoje. Confira também os próximos dias.</small></div>'
        : '<div class="event attention"><strong>Controle operacional não verificado</strong><small>Nenhum prazo, tarefa ou compromisso foi cadastrado. Cadastre os controles antes de considerar o dia em ordem.</small></div>';
  }




  const templateTypeLabels = { whatsapp: "WhatsApp", email: "E-mail", document: "Documento" };

  // prefill: usado por "Duplicar" para abrir um modelo novo já preenchido.
  function openTemplateDialog(id = null, prefill = null) {
    state.editingTemplateId = id;
    $("#templateForm").reset();
    setStatus($("#templateStatusMsg"));
    const item = id ? state.templates.find((x) => x.id === id) : prefill;
    $("#templateDialogTitle").textContent = id ? "Editar modelo" : prefill ? "Duplicar modelo" : "Novo modelo";
    $("#templateSaveBtn").textContent = id ? "Salvar alterações" : "Salvar modelo";
    $("#templateType").value = item?.template_type || "document";
    $("#templateActive").value = item?.active === false ? "false" : "true";
    if (item) {
      $("#templateTitle").value = item.title || "";
      $("#templateCategory").value = item.category || "";
      $("#templateContent").value = item.content || "";
    }
    openDialog("templateDialog");
  }

  function duplicateTemplate(id) {
    const item = state.templates.find((x) => x.id === id);
    if (!item) return;
    openTemplateDialog(null, { ...item, title: "Cópia de " + (item.title || "modelo") });
  }

  async function deleteTemplate(id, button) {
    const item = state.templates.find((x) => x.id === id);
    if (!item) return;
    if (!confirm('Excluir o modelo "' + (item.title || "") + '"? Esta ação não pode ser desfeita.')) return;
    setBusy(button, true, "Excluindo");
    try {
      const { error } = await supabase.from("office_templates").delete().eq("id", id).eq("firm_id", state.firm.id);
      if (error) throw error;
      toast("Modelo excluído.");
      core.logActivity("template.deleted", "template", id, "Modelo excluído: " + (item.title || ""));
      await core.loadData();
    } catch (error) {
      toast(error.message || "Não foi possível excluir o modelo.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  $("#templateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Salvando");
    const payload = {
      template_type: $("#templateType").value,
      title: $("#templateTitle").value.trim(),
      category: $("#templateCategory").value.trim() || null,
      content: $("#templateContent").value.trim(),
      active: $("#templateActive").value === "true"
    };
    try {
      if (state.editingTemplateId) {
        const { error } = await supabase.from("office_templates").update(payload)
          .eq("id", state.editingTemplateId).eq("firm_id", state.firm.id);
        if (error) throw error;
        toast("Modelo atualizado.");
        core.logActivity("template.updated", "template", state.editingTemplateId, "Modelo editado: " + payload.title);
      } else {
        const { data: created, error } = await supabase.from("office_templates").insert({
          ...payload, firm_id: state.firm.id, created_by: state.user.id
        }).select("id").single();
        if (error) throw error;
        toast("Modelo criado.");
        core.logActivity("template.created", "template", created?.id, "Modelo criado: " + payload.title);
      }
      closeDialog("templateDialog");
      await core.loadData();
    } catch (error) {
      setStatus($("#templateStatusMsg"), error.message || "Não foi possível salvar o modelo.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function renderTemplates() {
    const target = $("#templatesBody");
    if (!target) return;
    const q = norm($("#templateSearch")?.value || "");
    const filter = $("#templateFilter")?.value || "all";
    const list = state.templates.filter((item) => {
      const matchesType = filter === "all" || item.template_type === filter;
      const matchesSearch = norm((item.title || "") + " " + (item.category || "") + " " + (item.content || "")).includes(q);
      return matchesType && matchesSearch;
    });

    $("#templateCount").textContent = list.length + " de " + state.templates.length;
    target.innerHTML = list.length ? list.map((item) => {
      const preview = String(item.content || "").replace(/\s+/g, " ").slice(0, 90);
      return '<tr>' +
        '<td><strong>' + esc(item.title) + '</strong></td>' +
        '<td>' + esc(templateTypeLabels[item.template_type] || item.template_type) + '</td>' +
        '<td>' + esc(item.category || "—") + '</td>' +
        '<td>' + badge(item.active ? "Ativo" : "Inativo", item.active ? "ok" : "") + '</td>' +
        '<td class="message-cell"><div class="message-preview">' + esc(preview) + '</div></td>' +
        '<td><div class="row-actions">' +
          '<button class="btn secondary sm" data-generate-template="' + esc(item.id) + '">Gerar</button>' +
          '<button class="btn ghost sm" data-duplicate-template="' + esc(item.id) + '">Duplicar</button>' +
          '<button class="btn ghost sm" data-edit-template="' + esc(item.id) + '">Editar</button>' +
          '<button class="btn ghost sm" data-delete-template="' + esc(item.id) + '">Excluir</button>' +
        '</div></td>' +
      '</tr>';
    }).join("") : '<tr><td colspan="6" class="empty">Nenhum modelo encontrado.</td></tr>';
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "—";
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }

  function openDocumentDialog() {
    if (!state.cases.length) {
      toast("Cadastre um processo antes de enviar documentos.", "err");
      core.switchSection("cases");
      return;
    }
    $("#documentForm").reset();
    setStatus($("#documentStatusMsg"));
    $("#documentCase").innerHTML = caseOptions("", false);
    openDialog("documentDialog");
  }

  // Envia um arquivo ao armazenamento privado e cria o registro em "documents".
  // Usado pelo formulário de documentos e pelo gerador de documentos.
  async function uploadCaseDocument({ file, caseId, documentType = "outro", notes = null }) {
    if (!file || !caseId) throw new Error("Selecione o processo e o arquivo.");
    if (file.size > 25 * 1024 * 1024) throw new Error("O arquivo ultrapassa o limite de 25 MB.");
    const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
    const path = state.firm.id + "/" + caseId + "/" + Date.now() + "-" + safeName;

    const { error: uploadError } = await supabase.storage.from("advogatix-case-documents").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined
    });
    if (uploadError) throw uploadError;

    const { data: createdDoc, error: rowError } = await supabase.from("documents").insert({
      firm_id: state.firm.id,
      case_id: caseId,
      uploaded_by: state.user.id,
      name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      visibility: "internal",
      document_type: documentType || "outro",
      notes: notes || null
    }).select("id").single();

    if (rowError) {
      await supabase.storage.from("advogatix-case-documents").remove([path]);
      throw rowError;
    }
    core.logActivity("document.uploaded", "document", createdDoc?.id, "Documento enviado: " + file.name, { case_id: caseId, size_bytes: file.size });
    return createdDoc?.id || null;
  }

  $("#documentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const file = $("#documentFile").files?.[0];
    const caseId = $("#documentCase").value;
    if (!file || !caseId) return;

    if (file.size > 25 * 1024 * 1024) {
      setStatus($("#documentStatusMsg"), "O arquivo ultrapassa o limite de 25 MB.", "err");
      return;
    }

    setBusy(button, true, "Enviando");
    try {
      await uploadCaseDocument({
        file, caseId,
        documentType: $("#documentType").value || "outro",
        notes: $("#documentNotes").value.trim() || null
      });
      closeDialog("documentDialog");
      toast("Documento enviado com segurança.");
      await core.loadData();
    } catch (error) {
      setStatus($("#documentStatusMsg"), error.message || "Não foi possível enviar o documento.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  async function downloadDocument(id, button) {
    const doc = state.documents.find((x) => x.id === id);
    if (!doc) return;
    setBusy(button, true, "Abrindo");
    try {
      const { data, error } = await supabase.storage.from("advogatix-case-documents").download(doc.storage_path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.name || "documento";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      toast(error.message || "Não foi possível baixar o documento.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteDocument(id, button) {
    const doc = state.documents.find((x) => x.id === id);
    if (!doc) return;
    if (!confirm("Excluir este documento do AdvogaTix?")) return;
    setBusy(button, true, "Excluindo");
    try {
      // O arquivo sensível é removido primeiro. Assim nunca fica órfão e invisível
      // no armazenamento caso a remoção do registro falhe na etapa seguinte.
      const { error: storageError } = await supabase.storage.from("advogatix-case-documents").remove([doc.storage_path]);
      if (storageError) throw storageError;
      const { error: dbError } = await supabase.from("documents").delete()
        .eq("id", doc.id).eq("firm_id", state.firm.id);
      if (dbError) {
        throw new Error("Arquivo removido, mas o registro não pôde ser excluído. Recarregue a lista e procure o suporte técnico.");
      }
      toast("Documento excluído.");
      core.logActivity("document.deleted", "document", doc.id, "Documento excluído: " + (doc.name || ""), { case_id: doc.case_id || null });
      await core.loadData();
    } catch (error) {
      toast(error.message || "Não foi possível excluir o documento.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  function renderDocuments() {
    const target = $("#documentsBody");
    if (!target) return;
    const query = norm($("#documentSearch")?.value || "");
    const filter = $("#documentTypeFilter")?.value || "all";
    const list = state.documents.filter((doc) => {
      const proc = caseById(doc.case_id);
      const client = proc ? clientById(proc.client_id) : null;
      const matchesFilter = filter === "all" || doc.document_type === filter;
      const matchesQuery = norm((doc.name || "") + " " + (doc.document_type || "") + " " + (client?.full_name || "") + " " + (proc?.process_number || "") + " " + (proc?.title || "")).includes(query);
      return matchesFilter && matchesQuery;
    });

    $("#documentCount").textContent = list.length + " de " + state.documents.length;
    target.innerHTML = list.length ? list.map((doc) => {
      const proc = caseById(doc.case_id);
      const client = proc ? clientById(proc.client_id) : null;
      const canDelete = ["owner","lawyer"].includes(state.role);
      return '<tr>' +
        '<td><strong>' + esc(doc.name) + '</strong><div class="small">' + esc(doc.notes || "") + '</div></td>' +
        '<td><strong>' + esc(client?.full_name || "—") + '</strong><div class="small">' + esc(proc?.process_number || proc?.title || "") + '</div></td>' +
        '<td>' + esc(doc.document_type || "Outro") + '</td>' +
        '<td>' + esc(formatBytes(doc.size_bytes)) + '</td>' +
        '<td>' + brDate(doc.created_at) + '</td>' +
        '<td><div class="row-actions"><button class="btn ghost sm" data-download-document="' + esc(doc.id) + '">Baixar</button>' +
        (canDelete ? '<button class="btn secondary sm" data-delete-document="' + esc(doc.id) + '">Excluir</button>' : "") +
        '</div></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">Nenhum documento encontrado.</td></tr>';
  }


  function processHealth(item) {
    const deadlines = state.deadlines.filter((x) => x.case_id === item.id && !["completed","cancelled"].includes(x.status));
    const tasks = state.tasks.filter((x) => x.case_id === item.id && !["completed","cancelled"].includes(x.status));
    const allChecklist = state.checklistItems.filter((x) => x.case_id === item.id);
    const checklist = allChecklist.filter((x) => x.is_required && !x.is_done);
    const hasTrackedControls = state.deadlines.some((x) => x.case_id === item.id) || state.tasks.some((x) => x.case_id === item.id) || allChecklist.length > 0;
    const overdueDeadlines = deadlines.filter((x) => isOverdue(x.due_at, x.status));
    const overdueTasks = tasks.filter((x) => isOverdue(x.due_at, x.status));

    if (overdueDeadlines.length) {
      return { label: "Urgente", type: "err", detail: overdueDeadlines.length + " prazo(s) vencido(s)" };
    }
    if (overdueTasks.length) {
      return { label: "Atenção", type: "warn", detail: overdueTasks.length + " tarefa(s) atrasada(s)" };
    }
    if (checklist.length) {
      return { label: "Pendência", type: "warn", detail: checklist.length + " item(ns) obrigatório(s) pendente(s)" };
    }
    if (deadlines.length || tasks.length) {
      return { label: "Em andamento", type: "", detail: "Pendências controladas" };
    }
    if (hasTrackedControls) {
      return { label: "Em dia", type: "ok", detail: "Controles cadastrados sem pendências abertas" };
    }
    return { label: "Não verificado", type: "warn", detail: "Nenhum prazo, tarefa ou checklist foi cadastrado" };
  }

  function renderCaseHealthBadges() {
    $$("[data-case-health]").forEach((el) => {
      const item = caseById(el.dataset.caseHealth);
      if (!item) return;
      const health = processHealth(item);
      el.innerHTML = '<span class="badge ' + health.type + '">' + esc(health.label) + '</span>';
    });
  }

  function renderClientFile() {
    const id = state.activeClientFileId;
    if (!id) return;
    const client = clientById(id);
    if (!client) return;

    $("#clientFileTitle").textContent = client.full_name || "Ficha do cliente";
    $("#clientFileSubtitle").textContent = [client.cpf_cnpj, client.phone, client.email].filter(Boolean).join(" • ") || "Visão consolidada do cliente.";

    const cases = state.cases.filter((x) => x.client_id === id);
    const openDeadlines = state.deadlines.filter((x) => x.client_id === id && !["completed","cancelled"].includes(x.status));
    const receivable = financeTotals(state.financialEntries.filter((x) => x.client_id === id)).receivable;
    const nextFollowUp = client.next_follow_up_at ? brDate(client.next_follow_up_at) : "Sem retorno agendado";

    $("#clientFileSummary").innerHTML =
      '<div class="card metric"><div class="metric-label"><span>Processos</span></div><b>' + cases.length + '</b></div>' +
      '<div class="card metric"><div class="metric-label"><span>Prazos abertos</span></div><b>' + openDeadlines.length + '</b></div>' +
      '<div class="card metric"><div class="metric-label"><span>A receber</span></div><b>' + money(receivable) + '</b></div>' +
      '<div class="card metric"><div class="metric-label"><span>Próximo retorno</span></div><b style="font-size:16px">' + esc(nextFollowUp) + '</b></div>';

    $("#interactionCase").innerHTML = '<option value="">Sem processo específico</option>' + cases
      .map((x) => '<option value="' + esc(x.id) + '">' + esc(x.process_number || x.title) + '</option>').join("");

    const interactions = state.clientInteractions.filter((x) => x.client_id === id)
      .sort((a,b) => new Date(b.occurred_at) - new Date(a.occurred_at));

    const interactionLabels = { whatsapp: "WhatsApp", call: "Ligação", meeting: "Reunião", email: "E-mail", note: "Nota interna" };
    $("#clientInteractionList").innerHTML = interactions.length ? interactions.map((x) => {
      const proc = caseById(x.case_id);
      const meta = [interactionLabels[x.interaction_type] || x.interaction_type, brDate(x.occurred_at), proc?.process_number || proc?.title].filter(Boolean).join(" • ");
      const follow = x.follow_up_at ? '<p><strong>Retorno:</strong> ' + brDate(x.follow_up_at) + '</p>' : "";
      return '<div class="event"><strong>' + esc(x.summary) + '</strong><small>' + esc(meta) + '</small>' + follow + '</div>';
    }).join("") : '<div class="empty">Nenhum atendimento registrado.</div>';
  }

  function openClientFile(id) {
    state.activeClientFileId = id;
    $("#interactionForm").reset();
    setStatus($("#interactionStatusMsg"));
    renderClientFile();
    openDialog("clientFileDialog");
  }

  $("#interactionForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const clientId = state.activeClientFileId;
    if (!clientId) return;
    const button = event.submitter;
    setBusy(button, true, "Registrando");
    const followUp = toIso($("#interactionFollowUp").value);
    try {
      const { error } = await supabase.from("client_interactions").insert({
        firm_id: state.firm.id,
        client_id: clientId,
        case_id: $("#interactionCase").value || null,
        interaction_type: $("#interactionType").value,
        summary: $("#interactionSummary").value.trim(),
        follow_up_at: followUp,
        created_by: state.user.id
      });
      if (error) throw error;

      if (followUp) {
        const { error: followError } = await supabase.from("clients")
          .update({ next_follow_up_at: followUp })
          .eq("id", clientId).eq("firm_id", state.firm.id);
        if (followError) throw followError;
      }

      $("#interactionForm").reset();
      toast("Atendimento registrado.");
      await core.loadData();
      renderClientFile();
    } catch (error) {
      setStatus($("#interactionStatusMsg"), error.message || "Não foi possível registrar o atendimento.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function renderCaseWorkspace() {
    const id = state.activeCaseWorkspaceId;
    if (!id) return;
    const item = caseById(id);
    if (!item) return;
    const client = clientById(item.client_id);
    const health = processHealth(item);

    $("#caseWorkspaceTitle").textContent = item.title || "Processo";
    $("#caseWorkspaceSubtitle").textContent = [item.process_number, client?.full_name, item.legal_area].filter(Boolean).join(" • ");
    $("#caseHealthBox").innerHTML = '<strong>Saúde operacional: ' + esc(health.label) + '</strong><div class="small" style="margin-top:3px">' + esc(health.detail) + '</div>';

    const checklist = state.checklistItems.filter((x) => x.case_id === id)
      .sort((a,b) => Number(a.is_done) - Number(b.is_done) || new Date(a.created_at) - new Date(b.created_at));
    $("#caseChecklistList").innerHTML = checklist.length ? checklist.map((x) => {
      const done = x.is_done;
      return '<div class="event ' + (done ? "ok" : "") + '">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center">' +
          '<div><strong>' + esc(x.label) + '</strong><small>' + (x.due_at ? "Prazo interno: " + brDate(x.due_at) : (x.is_required ? "Obrigatório" : "Opcional")) + '</small></div>' +
          '<button class="btn ' + (done ? "secondary" : "ghost") + ' sm" data-toggle-checklist="' + esc(x.id) + '" data-done="' + (done ? "1" : "0") + '">' + (done ? "Reabrir" : "Concluir") + '</button>' +
        '</div></div>';
    }).join("") : '<div class="empty">Nenhum item de checklist.</div>';

    const deadlines = state.deadlines.filter((x) => x.case_id === id && !["cancelled"].includes(x.status));
    $("#caseDeadlineList").innerHTML = deadlines.length ? deadlines.map((x) =>
      '<div class="event ' + (isOverdue(x.due_at, x.status) ? "urgent" : "") + '"><strong>' + esc(x.title) + '</strong><small>' + brDate(x.due_at) + ' • ' + esc(deadlineStatusLabels[x.status] || x.status) + '</small></div>'
    ).join("") : '<div class="empty">Sem prazos vinculados.</div>';

    const tasks = state.tasks.filter((x) => x.case_id === id && !["cancelled"].includes(x.status));
    $("#caseTaskList").innerHTML = tasks.length ? tasks.map((x) =>
      '<div class="event ' + (isOverdue(x.due_at, x.status) ? "urgent" : "") + '"><strong>' + esc(x.title) + '</strong><small>' + (x.due_at ? brDate(x.due_at) + " • " : "") + esc(taskStatusLabels[x.status] || x.status) + '</small></div>'
    ).join("") : '<div class="empty">Sem tarefas vinculadas.</div>';

    window.AdvogaFeatures?.renderCaseTimeline?.(id);
  }

  async function toggleChecklist(b) {
    const nextDone = b.dataset.done !== "1";
    setBusy(b, true, "Salvando");
    try {
      const { error } = await supabase.from("case_checklist_items")
        .update({ is_done: nextDone, done_at: nextDone ? new Date().toISOString() : null })
        .eq("id", b.dataset.toggleChecklist).eq("firm_id", state.firm.id);
      if (error) throw error;
      const item = state.checklistItems.find((x) => x.id === b.dataset.toggleChecklist);
      core.logActivity(nextDone ? "checklist.completed" : "checklist.reopened", "checklist", b.dataset.toggleChecklist,
        (nextDone ? "Checklist concluído: " : "Checklist reaberto: ") + (item?.label || ""), { case_id: item?.case_id || null });
      await core.loadData();
      renderCaseWorkspace();
    } catch (error) {
      toast(error.message || "Não foi possível atualizar o checklist.", "err");
    } finally {
      setBusy(b, false);
    }
  }

  function openCaseWorkspace(id) {
    state.activeCaseWorkspaceId = id;
    $("#checklistForm").reset();
    setStatus($("#checklistStatusMsg"));
    renderCaseWorkspace();
    openDialog("caseWorkspaceDialog");
  }

  $("#checklistForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const caseId = state.activeCaseWorkspaceId;
    if (!caseId) return;
    const button = event.submitter;
    setBusy(button, true, "Adicionando");
    try {
      const { error } = await supabase.from("case_checklist_items").insert({
        firm_id: state.firm.id,
        case_id: caseId,
        label: $("#checklistLabel").value.trim(),
        is_required: $("#checklistRequired").value === "true",
        due_at: toIso($("#checklistDue").value),
        assigned_to: state.user.id,
        created_by: state.user.id
      });
      if (error) throw error;
      core.logActivity("checklist.created", "checklist", null, "Item de checklist criado: " + $("#checklistLabel").value.trim(), { case_id: caseId });
      $("#checklistForm").reset();
      toast("Item adicionado ao checklist.");
      await core.loadData();
      renderCaseWorkspace();
    } catch (error) {
      setStatus($("#checklistStatusMsg"), error.message || "Não foi possível adicionar o item.", "err");
    } finally {
      setBusy(button, false);
    }
  });

  function convertLead(id) {
    const lead = state.leads.find((x) => x.id === id);
    if (!lead) return;
    const notes = ["Convertido do CRM", lead.source ? "Origem: " + lead.source : "", lead.legal_area ? "Área: " + lead.legal_area : "", lead.notes || ""]
      .filter(Boolean).join("\n");
    core.switchSection("clients");
    core.openClientDialog(null, { full_name: lead.full_name, phone: lead.phone, email: lead.email, notes });
  }

  // ---------- Calendário da visão geral ----------
  const calTypeLabels = { deadline: "Prazo", hearing: "Audiência", event: "Compromisso", task: "Tarefa", finance: "Financeiro" };
  const calState = { year: 0, month: 0, selected: null };
  const timeFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: core.TIME_ZONE, hour: "2-digit", minute: "2-digit" });
  const monthFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
  const dayFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

  function keyToDate(key) {
    return new Date(key + "T12:00:00Z");
  }

  function addDaysKey(key, days) {
    const d = keyToDate(key);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function dayTitle(key) {
    const today = todayKey();
    if (key === today) return "Hoje";
    if (key === addDaysKey(today, 1)) return "Amanhã";
    if (key === addDaysKey(today, -1)) return "Ontem";
    return capitalize(dayFormatter.format(keyToDate(key)));
  }

  function calendarItems() {
    const items = [];
    const push = (item) => { if (item.key) items.push(item); };
    const caseLabel = (caseId, clientId) => {
      const proc = caseById(caseId);
      const client = clientById(clientId || proc?.client_id);
      return [client?.full_name, proc?.process_number || proc?.title].filter(Boolean).join(" • ");
    };

    state.deadlines.forEach((x) => {
      if (!x.due_at || x.status === "cancelled") return;
      push({ key: dateKey(x.due_at), ms: new Date(x.due_at).getTime(), type: "deadline", title: x.title,
        meta: caseLabel(x.case_id, x.client_id), done: x.status === "completed", overdue: isOverdue(x.due_at, x.status), open: "deadline|" + x.id });
    });

    const hearingSeen = new Set();
    state.calendarEvents.forEach((x) => {
      if (!x.start_at) return;
      const type = x.event_type === "hearing" ? "hearing" : "event";
      if (type === "hearing") hearingSeen.add((x.case_id || "") + "|" + new Date(x.start_at).getTime());
      push({ key: dateKey(x.start_at), ms: new Date(x.start_at).getTime(), type, title: x.title,
        meta: [eventTypeLabels[x.event_type], caseLabel(x.case_id, x.client_id), x.location].filter(Boolean).join(" • "), open: "event|" + x.id });
    });

    state.cases.forEach((c) => {
      if (!c.hearing_at || hearingSeen.has(c.id + "|" + new Date(c.hearing_at).getTime())) return;
      push({ key: dateKey(c.hearing_at), ms: new Date(c.hearing_at).getTime(), type: "hearing", title: "Audiência — " + (c.title || "processo"),
        meta: caseLabel(c.id, c.client_id), open: "case|" + c.id });
    });

    state.tasks.forEach((x) => {
      if (!x.due_at || x.status === "cancelled") return;
      push({ key: dateKey(x.due_at), ms: new Date(x.due_at).getTime(), type: "task", title: x.title,
        meta: caseLabel(x.case_id, x.client_id), done: x.status === "completed", overdue: isOverdue(x.due_at, x.status), open: "task|" + x.id });
    });

    state.financialEntries.forEach((x) => {
      const status = effectiveFinanceStatus(x);
      if (!x.due_date || !["pending", "overdue"].includes(status)) return;
      const client = clientById(x.client_id);
      push({ key: String(x.due_date).slice(0, 10), ms: null, type: "finance", title: x.description,
        meta: [(financeIsReceivable(x) ? "A receber " : "A pagar ") + money(x.amount), client?.full_name].filter(Boolean).join(" • "),
        overdue: status === "overdue", open: "finance|" + x.id });
    });

    // Itens sem horário (financeiro) aparecem primeiro no dia.
    return items.sort((a, b) => a.key.localeCompare(b.key) || (a.ms ?? -1) - (b.ms ?? -1));
  }

  function calItemHtml(item) {
    const time = item.ms == null ? "Dia todo" : timeFormatter.format(new Date(item.ms));
    const cls = "cal-item" + (item.done ? " is-done" : "") + (item.overdue ? " is-overdue" : "");
    const status = item.done ? " • Concluído" : item.overdue ? " • Atrasado" : "";
    return '<button type="button" class="' + cls + '" data-cal-open="' + esc(item.open) + '">' +
      '<i class="cal-dot t-' + item.type + '"></i>' +
      '<span class="cal-time">' + esc(time) + '</span>' +
      '<span class="cal-body"><strong>' + esc(item.title) + '</strong>' +
      '<small>' + esc(calTypeLabels[item.type] + status + (item.meta ? " • " + item.meta : "")) + '</small></span>' +
      '</button>';
  }

  function renderCalendar() {
    const grid = $("#calGrid");
    if (!grid) return;
    const today = todayKey();
    if (!calState.year) {
      calState.year = Number(today.slice(0, 4));
      calState.month = Number(today.slice(5, 7)) - 1;
    }

    const items = calendarItems();
    const byDay = new Map();
    items.forEach((item) => {
      if (!byDay.has(item.key)) byDay.set(item.key, []);
      byDay.get(item.key).push(item);
    });

    const first = new Date(Date.UTC(calState.year, calState.month, 1));
    $("#calLabel").textContent = capitalize(monthFormatter.format(first));
    const start = new Date(first);
    start.setUTCDate(1 - first.getUTCDay());
    const daysInMonth = new Date(Date.UTC(calState.year, calState.month + 1, 0)).getUTCDate();
    const totalCells = Math.ceil((first.getUTCDay() + daysInMonth) / 7) * 7;

    let cells = "";
    for (let i = 0; i < totalCells; i += 1) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const dayItems = byDay.get(key) || [];
      const open = dayItems.filter((x) => !x.done);
      const classes = ["cal-day"];
      if (d.getUTCMonth() !== calState.month) classes.push("is-out");
      if (key === today) classes.push("is-today");
      if (key === calState.selected) classes.push("is-selected");
      if (open.some((x) => x.overdue)) classes.push("has-overdue");
      const chips = dayItems.slice(0, 2).map((x) =>
        '<span class="cal-chip t-' + x.type + (x.done ? " is-done" : "") + '">' + esc(x.title) + '</span>').join("") +
        (dayItems.length > 2 ? '<span class="cal-more">+' + (dayItems.length - 2) + '</span>' : "");
      const dots = dayItems.slice(0, 4).map((x) => '<i class="cal-dot t-' + x.type + '"></i>').join("");
      const label = dayTitle(key) + (dayItems.length ? ": " + dayItems.length + " item(ns)" : ": sem itens");
      cells += '<button type="button" class="' + classes.join(" ") + '" data-cal-day="' + key + '" aria-label="' + esc(label) + '"' +
        (key === calState.selected ? ' aria-pressed="true"' : "") + '>' +
        '<span class="cal-num">' + d.getUTCDate() + '</span>' +
        '<span class="cal-chips">' + chips + '</span>' +
        '<span class="cal-dots">' + dots + '</span>' +
        '</button>';
    }
    grid.innerHTML = cells;
    renderCalendarList(items, byDay, today);
  }

  function renderCalendarList(items, byDay, today) {
    const list = $("#calList");
    const reset = $("#calListReset");
    if (calState.selected) {
      const dayItems = byDay.get(calState.selected) || [];
      $("#calListTitle").textContent = dayTitle(calState.selected);
      reset.classList.remove("hidden");
      list.innerHTML = dayItems.length
        ? '<div class="cal-group">' + dayItems.map(calItemHtml).join("") + '</div>'
        : '<div class="empty">Nada marcado para este dia.</div>';
      return;
    }

    $("#calListTitle").textContent = "O que vem por aí";
    reset.classList.add("hidden");
    const limit = addDaysKey(today, 30);
    const overdue = items.filter((x) => x.overdue && !x.done && x.key < today);
    const upcoming = items.filter((x) => !x.done && x.key >= today && x.key <= limit).slice(0, 40);

    const groups = [];
    if (overdue.length) groups.push({ title: "Atrasados", cls: " is-overdue", items: overdue.slice(0, 10) });
    upcoming.forEach((item) => {
      const last = groups[groups.length - 1];
      if (last && last.key === item.key) last.items.push(item);
      else groups.push({ key: item.key, title: dayTitle(item.key), cls: item.key === today ? " is-today" : "", items: [item] });
    });

    list.innerHTML = groups.length
      ? groups.map((g) => '<div class="cal-group' + g.cls + '"><h4>' + esc(g.title) + '</h4>' + g.items.map(calItemHtml).join("") + '</div>').join("")
      : '<div class="empty">Nada agendado para os próximos 30 dias.</div>';
  }

  function calendarNav(step) {
    const today = todayKey();
    if (step === 0) {
      calState.year = Number(today.slice(0, 4));
      calState.month = Number(today.slice(5, 7)) - 1;
      calState.selected = today;
    } else {
      const d = new Date(Date.UTC(calState.year, calState.month + step, 1));
      calState.year = d.getUTCFullYear();
      calState.month = d.getUTCMonth();
    }
    renderCalendar();
  }

  function calendarSelect(key) {
    calState.selected = calState.selected === key ? null : key;
    const month = Number(key.slice(5, 7)) - 1;
    if (calState.selected && month !== calState.month) {
      calState.year = Number(key.slice(0, 4));
      calState.month = month;
    }
    renderCalendar();
  }

  function calendarOpen(value) {
    const [kind, id] = String(value).split("|");
    if (kind === "deadline") return openDeadlineDialog(id);
    if (kind === "event") return openEventDialog(id);
    if (kind === "task") return openTaskDialog(id);
    if (kind === "finance") return openFinanceDialog(id);
    if (kind === "case") return openCaseWorkspace(id);
  }

  // Um único listener para os botões gerados pelas listas do organizador.
  const clickActions = [
    ["data-edit-deadline", (b) => openDeadlineDialog(b.dataset.editDeadline)],
    ["data-complete-deadline", (b) => completeDeadline(b.dataset.completeDeadline, b)],
    ["data-edit-task", (b) => openTaskDialog(b.dataset.editTask)],
    ["data-complete-task", (b) => completeTask(b.dataset.completeTask, b)],
    ["data-edit-event", (b) => openEventDialog(b.dataset.editEvent)],
    ["data-edit-finance", (b) => openFinanceDialog(b.dataset.editFinance)],
    ["data-pay-finance", (b) => markPaid(b.dataset.payFinance, b)],
    ["data-edit-lead", (b) => openLeadDialog(b.dataset.editLead)],
    ["data-convert-lead", (b) => convertLead(b.dataset.convertLead)],
    ["data-edit-template", (b) => openTemplateDialog(b.dataset.editTemplate)],
    ["data-duplicate-template", (b) => duplicateTemplate(b.dataset.duplicateTemplate)],
    ["data-delete-template", (b) => deleteTemplate(b.dataset.deleteTemplate, b)],
    ["data-deadline-bucket", (b) => { $("#deadlineFilter").value = b.dataset.deadlineBucket; renderDeadlines(); }],
    ["data-download-document", (b) => downloadDocument(b.dataset.downloadDocument, b)],
    ["data-delete-document", (b) => deleteDocument(b.dataset.deleteDocument, b)],
    ["data-toggle-checklist", (b) => toggleChecklist(b)],
    ["data-client-file", (b) => openClientFile(b.dataset.clientFile)],
    ["data-case-workspace", (b) => openCaseWorkspace(b.dataset.caseWorkspace)],
    ["data-cal-nav", (b) => calendarNav(Number(b.dataset.calNav))],
    ["data-cal-day", (b) => calendarSelect(b.dataset.calDay)],
    ["data-cal-reset", () => { calState.selected = null; renderCalendar(); }],
    ["data-cal-open", (b) => calendarOpen(b.dataset.calOpen)]
  ];
  const clickSelector = clickActions.map(([attr]) => "[" + attr + "]").join(",");

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(clickSelector);
    if (!button || button.disabled) return;
    const action = clickActions.find(([attr]) => button.hasAttribute(attr));
    action?.[1](button);
  });

  function renderConflictSearch() {
    const q = norm($("#conflictSearch")?.value || "").trim();
    const target = $("#conflictResults");
    if (!target) return;
    if (q.length < 2) {
      target.innerHTML = '<div class="empty">Digite pelo menos 2 caracteres para pesquisar clientes e partes dos processos.</div>';
      return;
    }

    const results = [];
    state.clients.forEach((c) => {
      const hay = norm((c.full_name || "") + " " + (c.cpf_cnpj || ""));
      if (hay.includes(q)) results.push({ title: c.full_name, meta: "Cliente cadastrado", detail: c.cpf_cnpj || c.phone || "" });
    });
    state.cases.forEach((c) => {
      [["Polo ativo", c.claimant], ["Polo passivo", c.defendant]].forEach(([side, name]) => {
        if (name && norm(name).includes(q)) results.push({ title: name, meta: side + " • " + (c.process_number || c.title), detail: c.legal_area || c.case_type || "" });
      });
    });
    state.leads.forEach((l) => {
      if (norm((l.full_name || "") + " " + (l.phone || "")).includes(q)) results.push({ title: l.full_name, meta: "CRM • " + (leadStatusLabels[l.status] || l.status), detail: l.source || "" });
    });

    target.innerHTML = results.length ? results.slice(0,20).map((r) =>
      '<div class="event"><strong>' + esc(r.title) + '</strong><small>' + esc(r.meta) + '</small>' + (r.detail ? '<p>' + esc(r.detail) + '</p>' : "") + '</div>'
    ).join("") : '<div class="event ok"><strong>Nenhuma correspondência encontrada</strong><small>Faça também a conferência jurídica e documental antes de aceitar o caso.</small></div>';
  }

  function renderReports() {
    if (!$("#rClients")) return;
    const activeClients = state.clients.filter((x) => x.status === "active").length;
    const activeCases = state.cases.filter((x) => !["closed","archived"].includes(x.status)).length;
    const overdueDeadlines = state.deadlines.filter((x) => isOverdue(x.due_at, x.status)).length;
    const overdueTasks = state.tasks.filter((x) => isOverdue(x.due_at, x.status)).length;
    const totals = financeTotals(state.financialEntries);
    const receivable = totals.receivable;
    const paid = totals.received;

    $("#rClients").textContent = activeClients;
    $("#rCases").textContent = activeCases;
    $("#rDeadlines").textContent = overdueDeadlines;
    $("#rTasks").textContent = overdueTasks;
    $("#rReceivable").textContent = money(receivable);
    $("#rPaid").textContent = money(paid);

    const attention = state.cases.map((item) => ({ item, health: processHealth(item) }))
      .filter((x) => !["Em dia"].includes(x.health.label))
      .sort((a,b) => ({ Urgente:0, Atenção:1, Pendência:2, "Não verificado":3, "Em andamento":4 }[a.health.label] ?? 9) - ({ Urgente:0, Atenção:1, Pendência:2, "Não verificado":3, "Em andamento":4 }[b.health.label] ?? 9))
      .slice(0,12);

    $("#reportCasesAttention").innerHTML = attention.length ? attention.map(({item,health}) => {
      const client = clientById(item.client_id);
      return '<div class="event ' + (health.type === "err" ? "urgent" : "") + '"><strong>' + esc(item.process_number || item.title) + '</strong><small>' + esc(client?.full_name || "") + ' • ' + esc(health.label) + '</small><p>' + esc(health.detail) + '</p></div>';
    }).join("") : '<div class="event ok"><strong>Nenhum processo com alerta operacional</strong></div>';

    const stages = ["lead","consultation","proposal","contracted","lost"];
    $("#reportLeadFunnel").innerHTML = stages.map((stage) => {
      const count = state.leads.filter((x) => x.status === stage).length;
      return '<div class="event"><strong>' + esc(leadStatusLabels[stage]) + '</strong><small>' + count + ' registro(s)</small></div>';
    }).join("");
  }


  function renderGlobalSearch() {
    const input = $("#globalSearch");
    const target = $("#globalSearchResults");
    if (!input || !target) return;
    const q = norm(input.value).trim();
    if (q.length < 2) {
      target.classList.add("hidden");
      target.innerHTML = "";
      return;
    }

    const results = [];
    const has = (...values) => norm(values.filter(Boolean).join(" ")).includes(q);

    state.clients.forEach((c) => {
      if (has(c.full_name, c.cpf_cnpj, c.phone, c.email)) {
        results.push({ kind: "client", id: c.id, title: c.full_name, meta: "Cliente • " + (c.cpf_cnpj || c.phone || "") });
      }
    });

    state.cases.forEach((c) => {
      const client = clientById(c.client_id);
      if (has(c.title, c.process_number, c.claimant, c.defendant, client?.full_name)) {
        results.push({ kind: "case", id: c.id, title: c.process_number || c.title, meta: "Processo • " + (client?.full_name || c.title || "") });
      }
    });

    state.deadlines.forEach((x) => {
      if (has(x.title, x.source)) {
        results.push({ kind: "deadline", id: x.id, title: x.title, meta: "Prazo • " + brDate(x.due_at) });
      }
    });

    state.tasks.forEach((x) => {
      if (has(x.title, x.description)) {
        results.push({ kind: "task", id: x.id, title: x.title, meta: "Tarefa" + (x.due_at ? " • " + brDate(x.due_at) : "") });
      }
    });

    state.calendarEvents.forEach((x) => {
      if (has(x.title, x.location, x.notes)) {
        results.push({ kind: "event", id: x.id, title: x.title, meta: (eventTypeLabels[x.event_type] || "Compromisso") + " • " + brDate(x.start_at) });
      }
    });

    state.financialEntries.forEach((x) => {
      const client = clientById(x.client_id);
      if (has(x.description, client?.full_name, financeTypeLabels[x.entry_type])) {
        results.push({ kind: "finance", id: x.id, title: x.description, meta: "Financeiro • " + money(x.amount) + (client ? " • " + client.full_name : "") });
      }
    });

    state.leads.forEach((x) => {
      if (has(x.full_name, x.phone, x.email)) {
        results.push({ kind: "lead", id: x.id, title: x.full_name, meta: "CRM • " + (leadStatusLabels[x.status] || x.status) });
      }
    });

    state.documents.forEach((x) => {
      const proc = caseById(x.case_id);
      if (has(x.name, x.document_type, proc?.process_number)) {
        results.push({ kind: "document", id: x.id, title: x.name, meta: "Documento • " + (proc?.process_number || proc?.title || "") });
      }
    });

    state.templates.forEach((x) => {
      if (has(x.title, x.category)) {
        results.push({ kind: "template", id: x.id, title: x.title, meta: "Modelo • " + (templateTypeLabels[x.template_type] || x.template_type) });
      }
    });

    const shown = results.slice(0, 30);
    const groupLabels = {
      client: "Clientes", case: "Processos", deadline: "Prazos", task: "Tarefas",
      event: "Agenda", finance: "Financeiro", lead: "CRM", document: "Documentos", template: "Modelos"
    };
    let previousKind = null;
    target.innerHTML = shown.length ? shown.map((r) => {
      const heading = previousKind === r.kind ? "" : '<div class="global-search-group">' + esc(groupLabels[r.kind] || r.kind) + '</div>';
      previousKind = r.kind;
      return heading + '<button class="global-result" type="button" data-global-kind="' + esc(r.kind) + '" data-global-id="' + esc(r.id) + '">' +
        '<strong>' + esc(r.title) + '</strong><span>' + esc(r.meta) + '</span></button>';
    }).join("") + (results.length > shown.length ? '<div class="global-search-summary">Mostrando 30 de ' + results.length + ' resultados. Refine a busca para localizar o item desejado.</div>' : "")
      : '<div class="empty">Nenhum resultado encontrado.</div>';
    target.classList.remove("hidden");
  }

  function closeGlobalSearch(clear) {
    const input = $("#globalSearch");
    $("#globalSearchResults")?.classList.add("hidden");
    if (clear && input) input.value = "";
  }

  function openGlobalResult(kind, id) {
    closeGlobalSearch(true);
    if (kind === "client") return openClientFile(id);
    if (kind === "case") return openCaseWorkspace(id);
    if (kind === "deadline") { core.switchSection("deadlines"); return openDeadlineDialog(id); }
    if (kind === "task") { core.switchSection("tasks"); return openTaskDialog(id); }
    if (kind === "event") { core.switchSection("agenda"); return openEventDialog(id); }
    if (kind === "finance") { core.switchSection("finance"); return openFinanceDialog(id); }
    if (kind === "lead") { core.switchSection("crm"); return openLeadDialog(id); }
    if (kind === "template") { core.switchSection("templates"); return openTemplateDialog(id); }
    if (kind === "document") {
      const doc = state.documents.find((x) => x.id === id);
      core.switchSection("documents");
      $("#documentTypeFilter").value = "all";
      $("#documentSearch").value = doc?.name || "";
      renderDocuments();
    }
  }

  function renderAll() {
    fillOrganizerSelects();
    renderDeadlines();
    renderTasks();
    renderAgenda();
    renderFinance();
    renderDocuments();
    renderTemplates();
    renderLeads();
    renderToday();
    renderCalendar();
    renderCaseHealthBadges();
    renderConflictSearch();
    renderReports();
    window.AdvogaFeatures?.renderAll?.();
    window.AdvogaDeadlineCalc?.refresh?.();
    if (!$("#globalSearchResults")?.classList.contains("hidden")) renderGlobalSearch();
    if (state.activeClientFileId && $("#clientFileDialog")?.open) renderClientFile();
    if (state.activeCaseWorkspaceId && $("#caseWorkspaceDialog")?.open) renderCaseWorkspace();
  }

  async function loadData(firmId) {
    const [deadlines, tasks, events, finance, documents, templates, leads, interactions, checklist] = await Promise.all([
      supabase.from("deadlines").select("*").eq("firm_id", firmId).order("due_at", { ascending: true }),
      supabase.from("tasks").select("*").eq("firm_id", firmId).order("due_at", { ascending: true, nullsFirst: false }),
      supabase.from("calendar_events").select("*").eq("firm_id", firmId).order("start_at", { ascending: true }),
      supabase.from("financial_entries").select("*").eq("firm_id", firmId).order("created_at", { ascending: false }),
      supabase.from("documents").select("*").eq("firm_id", firmId).order("created_at", { ascending: false }),
      supabase.from("office_templates").select("*").eq("firm_id", firmId).order("updated_at", { ascending: false }),
      supabase.from("crm_leads").select("*").eq("firm_id", firmId).order("updated_at", { ascending: false }),
      supabase.from("client_interactions").select("*").eq("firm_id", firmId).order("occurred_at", { ascending: false }),
      supabase.from("case_checklist_items").select("*").eq("firm_id", firmId).order("created_at", { ascending: true })
    ]);
    const errors = [deadlines.error, tasks.error, events.error, finance.error, documents.error, templates.error, leads.error, interactions.error, checklist.error].filter(Boolean);
    if (errors.length) throw errors[0];
    state.deadlines = deadlines.data || [];
    state.tasks = tasks.data || [];
    state.calendarEvents = events.data || [];
    state.financialEntries = finance.data || [];
    state.documents = documents.data || [];
    state.templates = templates.data || [];
    state.leads = leads.data || [];
    state.clientInteractions = interactions.data || [];
    state.checklistItems = checklist.data || [];
  }

  $("#newDeadlineBtn")?.addEventListener("click", () => openDeadlineDialog());
  $("#quickDeadline")?.addEventListener("click", () => openDeadlineDialog());
  $("#newTaskBtn")?.addEventListener("click", () => openTaskDialog());
  $("#quickTask")?.addEventListener("click", () => openTaskDialog());
  $("#newEventBtn")?.addEventListener("click", () => openEventDialog());
  $("#newFinanceBtn")?.addEventListener("click", () => openFinanceDialog());
  $("#newDocumentBtn")?.addEventListener("click", () => openDocumentDialog());
  $("#newTemplateBtn")?.addEventListener("click", () => openTemplateDialog());
  $("#newLeadBtn")?.addEventListener("click", () => openLeadDialog());

  ["deadlineSearch","deadlineFilter","deadlinePriorityFilter"].forEach((id) => $("#" + id)?.addEventListener("input", renderDeadlines));
  ["taskSearch","taskFilter"].forEach((id) => $("#" + id)?.addEventListener("input", renderTasks));
  $("#agendaFilter")?.addEventListener("input", renderAgenda);
  ["financeSearch","financeFilter"].forEach((id) => $("#" + id)?.addEventListener("input", renderFinance));
  ["documentSearch","documentTypeFilter"].forEach((id) => $("#" + id)?.addEventListener("input", renderDocuments));
  ["templateSearch","templateFilter"].forEach((id) => $("#" + id)?.addEventListener("input", renderTemplates));
  ["leadSearch","leadFilter"].forEach((id) => $("#" + id)?.addEventListener("input", renderLeads));
  $("#globalSearch")?.addEventListener("input", renderGlobalSearch);
  $("#globalSearch")?.addEventListener("focus", renderGlobalSearch);
  $("#globalSearchResults")?.addEventListener("click", (event) => {
    const b = event.target.closest("[data-global-kind]");
    if (b) openGlobalResult(b.dataset.globalKind, b.dataset.globalId);
  });
  // Teclado: setas navegam pelos resultados, Enter abre, Esc fecha.
  $(".global-search-box")?.addEventListener("keydown", (event) => {
    const items = $$("#globalSearchResults [data-global-kind]");
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      closeGlobalSearch(false);
      $("#globalSearch").focus();
    } else if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      items[Math.min(index + 1, items.length - 1)].focus();
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      if (index <= 0) $("#globalSearch").focus();
      else items[index - 1].focus();
    } else if (event.key === "Enter" && event.target.id === "globalSearch" && items.length) {
      event.preventDefault();
      items[0].click();
    }
  });
  document.addEventListener("click", (event) => {
    const box = event.target.closest?.(".global-search-box");
    if (!box) $("#globalSearchResults")?.classList.add("hidden");
  });
  $("#conflictSearch")?.addEventListener("input", renderConflictSearch);
  $("#printReportBtn")?.addEventListener("click", () => window.print());

  window.AdvogaOrganizer = {
    loadData, renderAll, renderCaseHealthBadges,
    // Reaproveitados por features.js (linha do tempo, alertas, gerador e atividades).
    helpers: {
      money, todayKey, isToday, isOverdue, keyToDate, addDaysKey, dayTitle, capitalize, timeFormatter,
      responsibleLabel, effectiveFinanceStatus, financeIsReceivable, formatBytes, clientOptions, caseOptions,
      deadlineBucket, deadlineCountdown, daysFromToday, sortDeadlines, priorityWeight,
      priorityLabels, priorityTypes, deadlineStatusLabels, deadlineTypeLabels, taskStatusLabels, eventTypeLabels,
      financeTypeLabels, financeStatusLabels, templateTypeLabels,
      openDeadlineDialog, openTaskDialog, openEventDialog, openFinanceDialog, openCaseWorkspace, openClientFile,
      openTemplateDialog, openLeadDialog, downloadDocument, uploadCaseDocument
    }
  };
})();
