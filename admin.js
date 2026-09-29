(function adminModule() {
  let core = null;
  let firms = [];
  let editingId = null;
  let bound = false;

  const $ = (s) => document.querySelector(s);
  const money = (value) => value == null || value === "" ? "—" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const date = (value) => {
    if (!value) return "—";
    const d = new Date(String(value) + (String(value).length === 10 ? "T12:00:00" : ""));
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
  };
  const statusLabel = { active: "Ativo", blocked: "Bloqueado", ended: "Encerrado" };
  const maintenanceLabel = { none: "Sem cobrança", current: "Em dia", due: "Pendente", overdue: "Atrasada", waived: "Dispensada" };

  async function invoke(body) {
    const { data, error } = await core.rawSupabase.functions.invoke("admin-firms", { body });
    if (!error) return data;
    let message = error.message || "Falha no painel mestre.";
    try {
      const payload = error.context?.clone ? await error.context.clone().json() : await error.context?.json?.();
      message = payload?.error || message;
    } catch (_) {}
    throw new Error(message);
  }

  function render() {
    const q = String($("#adminFirmSearch")?.value || "").trim().toLowerCase();
    const filter = $("#adminFirmStatusFilter")?.value || "all";
    const visible = firms.filter((f) => {
      const searchText = [f.name, f.owner?.name, f.owner?.email, f.email].filter(Boolean).join(" ").toLowerCase();
      return (!q || searchText.includes(q)) && (filter === "all" || (f.access?.access_status || "active") === filter);
    });

    $("#adminMetricFirms").textContent = String(firms.length);
    $("#adminMetricActive").textContent = String(firms.filter((f) => (f.access?.access_status || "active") === "active").length);
    $("#adminMetricBlocked").textContent = String(firms.filter((f) => (f.access?.access_status || "active") === "blocked").length);
    $("#adminMetricUsers").textContent = String(firms.reduce((sum, f) => sum + Number(f.users_count || 0), 0));
    $("#adminMetricMaintenance").textContent = String(firms.filter((f) => ["due", "overdue"].includes(f.commercial?.maintenance_status)).length);

    const body = $("#adminFirmRows");
    if (!visible.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Nenhum escritório encontrado.</td></tr>';
      return;
    }
    body.innerHTML = visible.map((f) => {
      const access = f.access?.access_status || "active";
      const maintenance = f.commercial?.maintenance_status || "none";
      const accessBadge = access === "active" ? "ok" : access === "blocked" ? "err" : "warn";
      const maintenanceBadge = maintenance === "current" ? "ok" : maintenance === "overdue" ? "err" : maintenance === "due" ? "warn" : "";
      return `<tr>
        <td><div class="row-main"><strong>${core.esc(f.name)}</strong><span class="small">${core.esc(f.email || f.phone || "")}</span></div></td>
        <td><div class="row-main"><span>${core.esc(f.owner?.name || "—")}</span><span class="small">${core.esc(f.owner?.email || "")}</span></div></td>
        <td>${Number(f.users_count || 0)} / ${Number(f.access?.user_limit || 5)}</td>
        <td>${money(f.commercial?.sale_amount)}<div class="small">${date(f.commercial?.sold_at)}</div></td>
        <td>${core.badge(maintenanceLabel[maintenance] || maintenance, maintenanceBadge)}<div class="small">${f.commercial?.maintenance_due_at ? "Próxima: " + date(f.commercial.maintenance_due_at) : ""}</div></td>
        <td>${core.badge(statusLabel[access] || access, accessBadge)}</td>
        <td class="cell-actions"><button class="btn secondary sm" type="button" data-admin-edit="${core.esc(f.id)}">Gerenciar</button></td>
      </tr>`;
    }).join("");
  }

  async function load() {
    const status = $("#adminStatus");
    if (status) status.textContent = "Carregando escritórios...";
    try {
      const data = await invoke({ action: "list" });
      firms = data?.firms || [];
      render();
      if (status) status.textContent = "";
    } catch (error) {
      if (status) {
        status.textContent = error.message || "Falha ao carregar.";
        status.className = "status err";
      }
    }
  }

  function openFirm(firm = null) {
    editingId = firm?.id || null;
    $("#adminFirmForm").reset();
    $("#adminFirmDialogTitle").textContent = firm ? "Gerenciar escritório" : "Novo escritório";
    $("#adminOwnerNameWrap").classList.toggle("hidden", Boolean(firm));
    $("#adminOwnerEmailWrap").classList.toggle("hidden", Boolean(firm));
    $("#adminOwnerName").required = !firm;
    $("#adminOwnerEmail").required = !firm;
    $("#adminFirmName").value = firm?.name || "";
    $("#adminOwnerName").value = firm?.owner?.name || "";
    $("#adminOwnerEmail").value = firm?.owner?.email || "";
    $("#adminFirmEmail").value = firm?.email || "";
    $("#adminFirmPhone").value = firm?.phone || "";
    $("#adminUserLimit").value = firm?.access?.user_limit || 5;
    $("#adminAccessStatus").value = firm?.access?.access_status || "active";
    $("#adminSaleAmount").value = firm?.commercial?.sale_amount ?? "";
    $("#adminSoldAt").value = firm?.commercial?.sold_at || "";
    $("#adminMaintenanceAmount").value = firm?.commercial?.maintenance_amount ?? "";
    $("#adminMaintenanceDue").value = firm?.commercial?.maintenance_due_at || "";
    $("#adminMaintenanceStatus").value = firm?.commercial?.maintenance_status || "none";
    $("#adminNotes").value = firm?.commercial?.notes || "";
    $("#adminPreviewNotice").classList.toggle("hidden", !core.PREVIEW_READ_ONLY);
    $("#adminFirmSaveBtn").disabled = core.PREVIEW_READ_ONLY;
    $("#adminFirmSaveBtn").title = core.PREVIEW_READ_ONLY ? core.PREVIEW_MESSAGE : "";
    $("#adminFirmDialog").showModal();
  }

  async function save(event) {
    event.preventDefault();
    if (core.PREVIEW_READ_ONLY) return core.toast(core.PREVIEW_MESSAGE, "err");
    const button = event.submitter || $("#adminFirmSaveBtn");
    core.setBusy(button, true, "Salvando");
    core.setStatus($("#adminFirmFormStatus"), "Salvando...");
    const body = {
      action: editingId ? "update" : "create",
      firm_id: editingId,
      name: $("#adminFirmName").value.trim(),
      owner_name: $("#adminOwnerName").value.trim(),
      owner_email: $("#adminOwnerEmail").value.trim(),
      email: $("#adminFirmEmail").value.trim(),
      phone: $("#adminFirmPhone").value.trim(),
      user_limit: Number($("#adminUserLimit").value || 5),
      access_status: $("#adminAccessStatus").value,
      sale_amount: $("#adminSaleAmount").value,
      sold_at: $("#adminSoldAt").value || null,
      maintenance_amount: $("#adminMaintenanceAmount").value,
      maintenance_due_at: $("#adminMaintenanceDue").value || null,
      maintenance_status: $("#adminMaintenanceStatus").value,
      notes: $("#adminNotes").value.trim(),
      redirect_to: `${location.origin}${location.pathname}?setup=password`
    };
    try {
      await invoke(body);
      core.toast(editingId ? "Escritório atualizado." : "Escritório criado e convite enviado.");
      $("#adminFirmDialog").close();
      await load();
    } catch (error) {
      core.setStatus($("#adminFirmFormStatus"), error.message || "Não foi possível salvar.", "err");
    } finally {
      core.setBusy(button, false);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    $("#adminLogoutBtn")?.addEventListener("click", async () => {
      await core.rawSupabase.auth.signOut();
      location.href = location.pathname;
    });
    $("#adminNewFirmBtn")?.addEventListener("click", () => openFirm());
    $("#adminRefreshBtn")?.addEventListener("click", load);
    $("#adminFirmSearch")?.addEventListener("input", render);
    $("#adminFirmStatusFilter")?.addEventListener("change", render);
    $("#adminFirmForm")?.addEventListener("submit", save);
    document.addEventListener("click", (event) => {
      const edit = event.target.closest?.("[data-admin-edit]");
      if (edit) {
        const firm = firms.find((f) => f.id === edit.dataset.adminEdit);
        if (firm) openFirm(firm);
      }
      if (event.target.closest?.("[data-admin-close]")) $("#adminFirmDialog")?.close();
    });
  }

  window.AdvogaAdmin = {
    async boot(nextCore) {
      core = nextCore;
      bind();
      $("#adminNewFirmBtn").disabled = core.PREVIEW_READ_ONLY;
      $("#adminNewFirmBtn").title = core.PREVIEW_READ_ONLY ? core.PREVIEW_MESSAGE : "";
      await load();
    }
  };
})();
