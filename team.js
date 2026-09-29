(function teamModule() {
  let core = null;
  let members = [];
  let canManage = false;
  let userLimit = 5;
  let bound = false;

  const $ = (s) => document.querySelector(s);
  const roleLabel = { owner: "Proprietário", lawyer: "Advogado(a)", staff: "Equipe / Assistente" };

  async function invoke(body) {
    const { data, error } = await core.rawSupabase.functions.invoke("firm-team", { body });
    if (!error) return data;
    let message = error.message || "Falha ao carregar a equipe.";
    try {
      const payload = error.context?.clone ? await error.context.clone().json() : await error.context?.json?.();
      message = payload?.error || message;
    } catch (_) {}
    throw new Error(message);
  }

  function render() {
    const active = members.filter((m) => m.status !== "disabled").length;
    $("#teamLimitText").textContent = `${active} de ${userLimit} usuários em uso.`;
    $("#teamInviteBtn").classList.toggle("hidden", !canManage);
    $("#teamInviteBtn").disabled = core.PREVIEW_READ_ONLY || active >= userLimit;
    $("#teamInviteBtn").title = core.PREVIEW_READ_ONLY
      ? core.PREVIEW_MESSAGE
      : active >= userLimit
        ? "Limite de usuários atingido."
        : "";

    const list = $("#teamList");
    if (!members.length) {
      list.innerHTML = '<div class="empty">Nenhum membro encontrado.</div>';
      return;
    }

    list.innerHTML = members.map((m) => {
      const disabled = m.status === "disabled";
      const canToggle = canManage && m.role !== "owner";
      return `<div class="team-row">
        <div class="team-person">
          <strong>${core.esc(m.full_name || m.email || "Usuário")}</strong>
          <span>${core.esc(m.email || "")}${m.oab_number ? " • OAB " + core.esc(m.oab_number) : ""}</span>
        </div>
        <div class="team-meta">
          ${core.badge(roleLabel[m.role] || m.role, m.role === "owner" ? "info" : "")}
          ${core.badge(disabled ? "Desativado" : "Ativo", disabled ? "err" : "ok")}
          ${canToggle ? `<button class="btn ghost sm" type="button" data-team-status="${core.esc(m.id)}" data-next-status="${disabled ? "active" : "disabled"}">${disabled ? "Reativar" : "Desativar"}</button>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  async function load() {
    if (!core?.state?.firm) return;
    core.setStatus($("#teamStatus"), "Carregando equipe...");
    try {
      const data = await invoke({ action: "list" });
      members = data?.members || [];
      userLimit = Number(data?.user_limit || core.state.accessControl?.user_limit || 5);
      canManage = Boolean(data?.can_manage);
      render();
      core.setStatus($("#teamStatus"), "");
    } catch (error) {
      core.setStatus($("#teamStatus"), error.message || "Não foi possível carregar a equipe.", "err");
    }
  }

  function openInvite() {
    $("#teamForm").reset();
    $("#teamOab").disabled = false;
    $("#teamPreviewNotice").classList.toggle("hidden", !core.PREVIEW_READ_ONLY);
    $("#teamInviteSaveBtn").disabled = core.PREVIEW_READ_ONLY;
    $("#teamDialog").showModal();
  }

  async function submit(event) {
    event.preventDefault();
    if (core.PREVIEW_READ_ONLY) return core.toast(core.PREVIEW_MESSAGE, "err");
    const button = event.submitter || $("#teamInviteSaveBtn");
    core.setBusy(button, true, "Enviando");
    try {
      await invoke({
        action: "invite",
        full_name: $("#teamName").value.trim(),
        email: $("#teamEmail").value.trim(),
        role: $("#teamRole").value,
        oab_number: $("#teamOab").value.trim(),
        redirect_to: `${location.origin}${location.pathname}?setup=password`
      });
      core.toast("Convite enviado.");
      $("#teamDialog").close();
      await load();
    } catch (error) {
      core.setStatus($("#teamFormStatus"), error.message || "Não foi possível convidar.", "err");
    } finally {
      core.setBusy(button, false);
    }
  }

  async function changeStatus(memberId, status, button) {
    if (core.PREVIEW_READ_ONLY) return core.toast(core.PREVIEW_MESSAGE, "err");
    core.setBusy(button, true, "Salvando");
    try {
      await invoke({ action: "set_status", member_id: memberId, status });
      core.toast(status === "active" ? "Usuário reativado." : "Usuário desativado.");
      await load();
    } catch (error) {
      core.toast(error.message || "Não foi possível alterar o acesso.", "err");
    } finally {
      core.setBusy(button, false);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    $("#teamInviteBtn")?.addEventListener("click", openInvite);
    $("#teamForm")?.addEventListener("submit", submit);
    $("#teamRole")?.addEventListener("change", () => {
      const lawyer = $("#teamRole").value === "lawyer";
      $("#teamOab").disabled = !lawyer;
      if (!lawyer) $("#teamOab").value = "";
    });
    document.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-team-close]")) $("#teamDialog")?.close();
      const button = event.target.closest?.("[data-team-status]");
      if (button) changeStatus(button.dataset.teamStatus, button.dataset.nextStatus, button);
    });
  }

  window.AdvogaTeam = {
    async boot(nextCore) {
      core = nextCore;
      bind();
      await load();
    }
  };
})();
