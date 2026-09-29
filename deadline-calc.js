// Calculadora de prazos (auxiliar). Regras do CPC:
// - art. 219: prazos processuais em dias úteis;
// - art. 220: suspensão do curso dos prazos de 20/12 a 20/01;
// - art. 224: exclui o dia do começo e inclui o do vencimento; a contagem começa no
//   primeiro dia útil seguinte e o vencimento em dia sem expediente é prorrogado;
// - Lei 11.419/2006, art. 4º, §§ 3º e 4º: publicação no DJe = 1º dia útil após a disponibilização.
// O resultado é sempre uma sugestão: o advogado deve conferir o calendário do tribunal.
(() => {
  // ---------- Motor de cálculo (puro, sem acesso à tela) ----------
  const DAY = 864e5;
  const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

  // Datas trabalhadas como "AAAA-MM-DD" em UTC para não sofrer com fuso ou horário de verão.
  function toTime(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!m) return NaN;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(t);
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : NaN;
  }
  const toKey = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (key, n) => toKey(toTime(key) + n * DAY);
  const weekday = (key) => new Date(toTime(key)).getUTCDay();
  const monthDay = (key) => key.slice(5);

  function formatKey(key, withWeekday = true) {
    const [y, m, d] = key.split("-");
    return d + "/" + m + "/" + y + (withWeekday ? " (" + WEEKDAYS[weekday(key)] + ")" : "");
  }

  // Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
  function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return toKey(Date.UTC(year, month - 1, day));
  }

  const NATIONAL_FIXED = [
    ["01-01", "Confraternização Universal"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"],
    ["11-15", "Proclamação da República"], ["12-25", "Natal"]
  ];
  // Feriados comuns no Judiciário (Lei 5.010/66, art. 62, e calendários de vários tribunais).
  // Não são nacionais para todos os órgãos: por isso ficam como opção.
  const FORENSE_FIXED = [["08-11", "Dia do Advogado / criação dos cursos jurídicos"], ["11-01", "Dia de Todos os Santos"], ["12-08", "Dia da Justiça"]];

  // Mapa "AAAA-MM-DD" -> { name, kind } com os feriados do ano.
  function holidaysForYear(year, { forense = false, locals = [] } = {}) {
    const map = new Map();
    const add = (key, name, kind) => { if (!map.has(key)) map.set(key, { name, kind }); };
    NATIONAL_FIXED.forEach(([md, name]) => add(year + "-" + md, name, "nacional"));
    if (year >= 2024) add(year + "-11-20", "Dia Nacional de Zumbi e da Consciência Negra", "nacional");
    const e = easter(year);
    add(addDays(e, -2), "Sexta-feira Santa", "nacional");
    if (forense) {
      add(addDays(e, -48), "Carnaval (segunda-feira)", "forense");
      add(addDays(e, -47), "Carnaval (terça-feira)", "forense");
      add(addDays(e, -4), "Quarta-feira Santa", "forense");
      add(addDays(e, -3), "Quinta-feira Santa", "forense");
      add(addDays(e, 60), "Corpus Christi", "forense");
      FORENSE_FIXED.forEach(([md, name]) => add(year + "-" + md, name, "forense"));
    }
    locals.forEach((h) => {
      const key = String(h.holiday_date || "").slice(0, 10);
      if (!toTime(key)) return;
      if (h.recurring) add(year + "-" + monthDay(key), h.name, "local");
      else if (key.startsWith(year + "-")) add(key, h.name, "local");
    });
    return map;
  }

  // Recesso forense: de 20/12 a 20/01, inclusive.
  function inRecess(key) {
    const md = monthDay(key);
    return md >= "12-20" || md <= "01-20";
  }

  function createCalendar(opts) {
    const cache = new Map();
    const holidayOf = (key) => {
      const year = +key.slice(0, 4);
      if (!cache.has(year)) cache.set(year, holidaysForYear(year, opts));
      return cache.get(year).get(key) || null;
    };
    // Motivo pelo qual o dia não é útil, ou null se for útil.
    const reason = (key) => {
      const wd = weekday(key);
      if (opts.recess && inRecess(key)) return { type: "recesso", label: "Recesso forense (art. 220 do CPC)" };
      if (wd === 0 || wd === 6) return { type: "fim_de_semana", label: wd === 0 ? "Domingo" : "Sábado" };
      const holiday = holidayOf(key);
      if (holiday) return { type: "feriado", label: "Feriado " + holiday.kind + ": " + holiday.name, holiday };
      return null;
    };
    return { reason, isBusiness: (key) => !reason(key) };
  }

  const MAX_ITERATIONS = 20000;

  /**
   * Calcula o vencimento.
   * @param {object} input
   *   start   "AAAA-MM-DD" — data da intimação/publicação (ou da disponibilização, com dje=true)
   *   days    quantidade de dias (1 a 3650)
   *   mode    "uteis" | "corridos"
   *   dje     true se "start" for a disponibilização no DJe
   *   recess  suspender de 20/12 a 20/01
   *   forense incluir feriados forenses usuais
   *   locals  [{ holiday_date, name, recurring }]
   */
  function calculate(input) {
    const start = String(input.start || "");
    const days = Number(input.days);
    const mode = input.mode === "corridos" ? "corridos" : "uteis";
    if (!toTime(start)) throw new Error("Informe a data de início.");
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Informe a quantidade de dias (1 a 3650).");

    const opts = { recess: input.recess !== false, forense: !!input.forense, locals: Array.isArray(input.locals) ? input.locals : [] };
    const cal = createCalendar(opts);
    const skipped = [];
    const counted = [];
    const notes = [];
    let guard = 0;

    // Avança até o próximo dia útil a partir de "key" (exclusivo), registrando os dias pulados.
    const nextBusiness = (key, context) => {
      let d = addDays(key, 1);
      while (!cal.isBusiness(d)) {
        if (++guard > MAX_ITERATIONS) throw new Error("Não foi possível concluir o cálculo.");
        skipped.push({ date: d, ...cal.reason(d), context });
        d = addDays(d, 1);
      }
      return d;
    };

    let publication = start;
    if (input.dje) {
      publication = nextBusiness(start, "publicação");
      notes.push("Disponibilizado no DJe em " + formatKey(start) + "; publicação considerada em " + formatKey(publication) + " (Lei 11.419/2006, art. 4º, § 3º).");
    }

    // Art. 224: exclui o dia do começo; a contagem inicia no primeiro dia útil seguinte.
    const firstDay = nextBusiness(publication, "início");
    let end = firstDay;

    if (mode === "uteis") {
      let d = firstDay;
      while (true) {
        if (++guard > MAX_ITERATIONS) throw new Error("Não foi possível concluir o cálculo.");
        const why = cal.reason(d);
        if (why) skipped.push({ date: d, ...why, context: "contagem" });
        else {
          counted.push(d);
          if (counted.length === days) { end = d; break; }
        }
        d = addDays(d, 1);
      }
    } else {
      let d = firstDay;
      while (true) {
        if (++guard > MAX_ITERATIONS) throw new Error("Não foi possível concluir o cálculo.");
        if (opts.recess && inRecess(d)) skipped.push({ date: d, type: "recesso", label: "Recesso forense (art. 220 do CPC)", context: "contagem" });
        else {
          counted.push(d);
          if (counted.length === days) { end = d; break; }
        }
        d = addDays(d, 1);
      }
      // Art. 224, § 1º: vencimento em dia sem expediente é prorrogado para o primeiro dia útil.
      if (!cal.isBusiness(end)) {
        const original = end;
        end = nextBusiness(end, "prorrogação");
        notes.push("O último dia (" + formatKey(original) + ") não é dia útil; vencimento prorrogado para " + formatKey(end) + " (art. 224, § 1º, do CPC).");
      }
    }

    const summary = { fim_de_semana: 0, feriado: 0, recesso: 0 };
    skipped.forEach((s) => { summary[s.type] = (summary[s.type] || 0) + 1; });
    const holidays = skipped.filter((s) => s.type === "feriado").map((s) => ({ date: s.date, name: s.holiday.name, kind: s.holiday.kind }));

    return {
      start, publication: input.dje ? publication : null, firstDay, end, days, mode,
      options: { dje: !!input.dje, recess: opts.recess, forense: opts.forense, localHolidays: opts.locals.length },
      counted, skipped, summary, holidays, notes
    };
  }

  const engine = { calculate, holidaysForYear, easter, inRecess, formatKey, addDays };
  globalThis.AdvogaDeadlineCalcEngine = engine;

  // ---------- Interface ----------
  const core = globalThis.AdvogaCore;
  if (!core || typeof document === "undefined") return;
  const { supabase, state, $, esc, toast, setStatus, setBusy } = core;

  const ui = { lastResult: null, holidays: [], holidaysLoadedFor: null, holidaysError: "" };

  function currentOptions() {
    return {
      start: $("#calcStart").value,
      days: Number($("#calcDays").value),
      mode: $("#calcMode").value,
      dje: $("#calcDje").checked,
      recess: $("#calcRecess").checked,
      forense: $("#calcForense").checked,
      locals: ui.holidays
    };
  }

  // Agrupa dias consecutivos com o mesmo motivo: "21/12 a 20/01 — Recesso".
  function groupSkipped(list) {
    const groups = [];
    list.forEach((s) => {
      const last = groups[groups.length - 1];
      if (last && last.label === s.label && addDays(last.to, 1) === s.date) last.to = s.date;
      else groups.push({ from: s.date, to: s.date, label: s.label });
    });
    return groups;
  }

  function renderResult(r) {
    const box = $("#calcResult");
    const modeLabel = r.mode === "uteis" ? "dias úteis" : "dias corridos";
    const parts = [];
    if (r.summary.fim_de_semana) parts.push(r.summary.fim_de_semana + " em fins de semana");
    if (r.summary.feriado) parts.push(r.summary.feriado + " em feriados");
    if (r.summary.recesso) parts.push(r.summary.recesso + " no recesso");
    const skippedText = r.skipped.length ? r.skipped.length + " dia(s) não contado(s): " + parts.join(", ") : "Nenhum dia pulado";

    const steps = [
      ["Data informada", engine.formatKey(r.start) + (r.options.dje ? " (disponibilização no DJe)" : "")],
      r.publication ? ["Publicação considerada", engine.formatKey(r.publication)] : null,
      ["Início da contagem", engine.formatKey(r.firstDay) + " — o dia do começo é excluído (art. 224)"],
      ["Prazo", r.days + " " + modeLabel],
      ["Dias pulados", skippedText]
    ].filter(Boolean);

    const holidays = r.holidays.length
      ? '<div class="calc-holidays"><strong>Feriados considerados</strong><ul>' +
        r.holidays.map((h) => '<li>' + esc(engine.formatKey(h.date)) + ' — ' + esc(h.name) + ' <span class="small">(' + esc(h.kind) + ')</span></li>').join("") + '</ul></div>'
      : "";

    const rows = [];
    let n = 0;
    const skippedByDate = new Map(r.skipped.filter((s) => s.context === "contagem").map((s) => [s.date, s]));
    // Linha do tempo compacta: dias contados um a um e dias pulados agrupados.
    const events = r.counted.map((d) => ({ date: d, counted: true })).concat([...skippedByDate.values()].map((s) => ({ date: s.date, skip: s })))
      .sort((a, b) => a.date.localeCompare(b.date));
    const grouped = [];
    events.forEach((e) => {
      const last = grouped[grouped.length - 1];
      if (e.skip && last?.skip && last.skip.label === e.skip.label && addDays(last.to, 1) === e.date) last.to = e.date;
      else grouped.push(e.skip ? { skip: e.skip, from: e.date, to: e.date } : e);
    });
    grouped.forEach((e) => {
      if (e.counted) rows.push('<li><span class="calc-n">' + (++n) + '</span>' + esc(engine.formatKey(e.date)) + '</li>');
      else rows.push('<li class="is-skip"><span class="calc-n">—</span>' + esc(e.from === e.to ? engine.formatKey(e.from) : engine.formatKey(e.from, false) + " a " + engine.formatKey(e.to, false)) + ' <span class="small">' + esc(e.skip.label) + '</span></li>');
    });

    const outside = groupSkipped(r.skipped.filter((s) => s.context !== "contagem"));
    box.innerHTML =
      '<div class="calc-end"><span>Vencimento sugerido</span><strong>' + esc(engine.formatKey(r.end)) + '</strong></div>' +
      '<dl class="calc-steps">' + steps.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join("") + '</dl>' +
      (outside.length ? '<p class="small">Antes do início da contagem: ' + esc(outside.map((g) => (g.from === g.to ? engine.formatKey(g.from, false) : engine.formatKey(g.from, false) + " a " + engine.formatKey(g.to, false)) + " — " + g.label).join("; ")) + '</p>' : "") +
      r.notes.map((t) => '<p class="small calc-note">' + esc(t) + '</p>').join("") +
      holidays +
      '<details class="calc-daylist"><summary>Ver a contagem dia a dia</summary><ol>' + rows.join("") + '</ol></details>' +
      '<div class="calc-actions"><button type="button" class="btn sm" data-calc-apply>Usar esta data no vencimento</button></div>';
    box.classList.remove("hidden");
  }

  function run() {
    const status = $("#calcStatus");
    try {
      const r = engine.calculate(currentOptions());
      ui.lastResult = r;
      renderResult(r);
      setStatus(status);
    } catch (error) {
      ui.lastResult = null;
      $("#calcResult").classList.add("hidden");
      setStatus(status, error.message || "Não foi possível calcular.", "err");
    }
  }

  function apply() {
    if (!ui.lastResult) return;
    $("#deadlineDue").value = ui.lastResult.end + "T23:59";
    $("#deadlineDue").dispatchEvent(new Event("input", { bubbles: true }));
    toast("Vencimento preenchido com " + engine.formatKey(ui.lastResult.end, false) + " às 23:59. Confira antes de salvar.");
  }

  // Resumo gravado junto com o prazo (coluna deadlines.calculation), só se a data usada for a calculada.
  function calculationFor(dueInputValue) {
    const r = ui.lastResult;
    if (!r || String(dueInputValue || "").slice(0, 10) !== r.end) return null;
    return {
      version: 1, start: r.start, publication: r.publication, first_day: r.firstDay, end: r.end,
      days: r.days, mode: r.mode, options: r.options, summary: r.summary,
      holidays: r.holidays, notes: r.notes, calculated_at: new Date().toISOString()
    };
  }

  // Chamado ao abrir o formulário de prazo: limpa ou mostra o cálculo anterior.
  function reset(item) {
    ui.lastResult = null;
    $("#calcResult")?.classList.add("hidden");
    setStatus($("#calcStatus"));
    const c = item?.calculation;
    $("#calcStart").value = c?.start || "";
    $("#calcDays").value = c?.days || "";
    $("#calcMode").value = c?.mode || "uteis";
    $("#calcDje").checked = !!c?.options?.dje;
    $("#calcRecess").checked = c?.options ? c.options.recess !== false : true;
    $("#calcForense").checked = !!c?.options?.forense;
    $("#calcDetails").open = false;
    const saved = $("#calcSaved");
    if (c?.end) {
      saved.textContent = "Este vencimento foi calculado com " + c.days + " " + (c.mode === "corridos" ? "dias corridos" : "dias úteis") +
        " a partir de " + engine.formatKey(c.start, false) + ". Abra a calculadora para refazer ou conferir.";
      saved.classList.remove("hidden");
    } else {
      saved.classList.add("hidden");
    }
  }

  // ---------- Feriados locais (Configurações) ----------
  const scopeLabels = { municipal: "Municipal", estadual: "Estadual", forense: "Forense", outro: "Outro" };

  async function loadHolidays(force = false) {
    if (!state.firm) return;
    if (!force && ui.holidaysLoadedFor === state.firm.id) return;
    ui.holidaysLoadedFor = state.firm.id;
    try {
      const { data, error } = await supabase.from("firm_holidays").select("*").eq("firm_id", state.firm.id).order("holiday_date");
      if (error) throw error;
      ui.holidays = data || [];
      ui.holidaysError = "";
    } catch (error) {
      ui.holidays = [];
      ui.holidaysError = error.message || "Não foi possível carregar os feriados locais.";
    }
    renderHolidays();
  }

  function renderHolidays() {
    const list = $("#holidayList");
    if (!list) return;
    const canDelete = ["owner", "lawyer"].includes(state.role);
    const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: core.TIME_ZONE, year: "numeric" }).format(new Date()));
    const national = [...engine.holidaysForYear(year).entries()].sort(([a], [b]) => a.localeCompare(b));
    $("#holidayNational").innerHTML = '<strong>Nacionais em ' + year + ' (automáticos)</strong><ul>' +
      national.map(([key, h]) => '<li>' + esc(engine.formatKey(key, false)) + ' — ' + esc(h.name) + '</li>').join("") + '</ul>';

    if (ui.holidaysError) {
      list.innerHTML = '<div class="empty">' + esc(ui.holidaysError) + '</div>';
      return;
    }
    list.innerHTML = ui.holidays.length ? ui.holidays.map((h) =>
      '<div class="holiday-row"><div><strong>' + esc(h.name) + '</strong><span class="small">' +
        esc(engine.formatKey(String(h.holiday_date).slice(0, 10), false).slice(0, h.recurring ? 5 : 10) + (h.recurring ? " • todo ano" : "") + " • " + (scopeLabels[h.scope] || h.scope)) +
      '</span></div>' +
      (canDelete ? '<button type="button" class="btn ghost sm" data-holiday-delete="' + esc(h.id) + '">Excluir</button>' : "") +
      '</div>').join("") : '<div class="empty">Nenhum feriado local cadastrado.</div>';
  }

  async function addHoliday(event) {
    event.preventDefault();
    if (core.PREVIEW_READ_ONLY) { toast(core.PREVIEW_MESSAGE, "err"); return; }
    const button = event.submitter || $("#holidaySaveBtn");
    const date = $("#holidayDate").value;
    const name = $("#holidayName").value.trim();
    if (!date || !name) { setStatus($("#holidayStatus"), "Informe a data e o nome do feriado.", "err"); return; }
    setBusy(button, true, "Salvando");
    try {
      const { error } = await supabase.from("firm_holidays").insert({
        firm_id: state.firm.id, holiday_date: date, name,
        recurring: $("#holidayRecurring").checked, scope: $("#holidayScope").value
      });
      if (error) throw error;
      $("#holidayForm").reset();
      setStatus($("#holidayStatus"), "Feriado cadastrado.", "ok");
      await loadHolidays(true);
    } catch (error) {
      setStatus($("#holidayStatus"), error.message || "Não foi possível cadastrar o feriado.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteHoliday(id, button) {
    if (core.PREVIEW_READ_ONLY) { toast(core.PREVIEW_MESSAGE, "err"); return; }
    const h = ui.holidays.find((x) => x.id === id);
    if (!h || !confirm('Excluir o feriado "' + h.name + '"?')) return;
    setBusy(button, true, "Excluindo");
    try {
      const { error } = await supabase.from("firm_holidays").delete().eq("id", id).eq("firm_id", state.firm.id);
      if (error) throw error;
      await loadHolidays(true);
    } catch (error) {
      toast(error.message || "Não foi possível excluir o feriado.", "err");
    } finally {
      setBusy(button, false);
    }
  }

  // ---------- Eventos ----------
  $("#calcRunBtn")?.addEventListener("click", run);
  ["calcStart", "calcDays", "calcMode", "calcDje", "calcRecess", "calcForense"].forEach((id) =>
    $("#" + id)?.addEventListener("change", () => { if (ui.lastResult) run(); }));
  $("#calcDays")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); run(); } });
  $("#holidayForm")?.addEventListener("submit", addHoliday);
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-calc-apply],[data-holiday-delete]");
    if (!target || target.disabled) return;
    if (target.hasAttribute("data-calc-apply")) apply();
    else deleteHoliday(target.dataset.holidayDelete, target);
  });
  if (core.PREVIEW_READ_ONLY) {
    const btn = $("#holidaySaveBtn");
    if (btn) { btn.disabled = true; btn.title = core.PREVIEW_MESSAGE; }
  }

  globalThis.AdvogaDeadlineCalc = {
    engine, reset, calculationFor,
    refresh: () => loadHolidays(false)
  };
})();
