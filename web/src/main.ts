import "./styles.css";
import type { Brief, CalEvent, EmailItem, ReplyItem, TaskItem, Weather } from "./types";
import { addTask, callFn, clearCache, updateTask, enablePush, shortcutUrl, fetchSnapshot, isDemo, pushState, readCache, sb, syncPush, type Snapshot } from "./data";
import { sunPhase, sunTimes } from "./sun";

const app = document.getElementById("app")!;
const LOCALE = "pt-PT";

type View = "hoje" | "calendario";
const state: {
  view: View;
  selected: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  snap: Snapshot | null;
  loading: boolean;
  error: string | null;
  menu: boolean; // menu lateral aberto (no telemóvel)
} = {
  view: (localStorageGet("dh:view") as View) || "hoje",
  selected: ymd(new Date()),
  month: ymd(new Date()).slice(0, 7),
  menu: false,
  snap: readCache(),
  loading: false,
  error: null,
};

// ---------- util ----------

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
function ymd(d: Date): string {
  return d.toLocaleDateString("en-CA");
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeHref = (u?: string) => (u && /^(https?:|obsidian:|#)/.test(u) ? u : "#");
const time = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function allEvents(): CalEvent[] {
  const s = state.snap;
  if (!s) return [];
  return [...(s.brief?.events ?? []), ...s.outlook].sort((a, b) => a.start.localeCompare(b.start));
}

/** Eventos que tocam num dia local (inclui os que atravessam a meia-noite, como urgências). */
function eventsOn(date: string): CalEvent[] {
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const dayEnd = dayStart + 864e5;
  return allEvents().filter((e) => {
    if (e.allDay) return e.start.slice(0, 10) <= date && date < (e.end.slice(0, 10) || addDays(date, 1));
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    return s < dayEnd && en > dayStart;
  });
}

const SOURCE_LABEL: Record<CalEvent["source"], string> = { google: "Pessoal", escala: "Escala", outlook: "Hospital" };

// ---------- componentes ----------

function header(brief: Brief | null): string {
  const now = new Date();
  const { rise, set } = sunTimes(now);
  const phase = sunPhase(now, rise, set);
  const h = now.getHours();
  const greet = h < 6 ? "Boa noite" : h < 13 ? "Bom dia" : h < 20 ? "Boa tarde" : "Boa noite";

  // Dia: o sol percorre o arco do nascer (esquerda) ao pôr (direita).
  // Noite: a lua faz o mesmo caminho, do pôr do sol até ao nascer seguinte.
  const R = 132, CX = 160, CY = 150;
  const night = phase === "noite";
  const DAY = 864e5;
  let from = rise, to = set;
  if (night) {
    if (now < rise) {
      from = sunTimes(new Date(now.getTime() - DAY)).set; // pôr do sol de ontem
      to = rise;
    } else {
      from = set;
      to = sunTimes(new Date(now.getTime() + DAY)).rise; // nascer de amanhã
    }
  }
  const t = Math.min(1, Math.max(0, (now.getTime() - from.getTime()) / (to.getTime() - from.getTime())));
  const ang = Math.PI * (1 - t);
  const sx = CX + R * Math.cos(ang);
  const sy = CY - R * Math.sin(ang);
  const dash = Math.PI * R; // comprimento do arco
  const hhmm = (d: Date) => d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

  return `
    <header class="hero ${phase}">
      <svg class="sky" viewBox="0 0 320 172" aria-hidden="true">
        <defs>
          <radialGradient id="glow"><stop offset="0" stop-color="var(--sun)" stop-opacity=".55"/><stop offset="1" stop-color="var(--sun)" stop-opacity="0"/></radialGradient>
          <radialGradient id="luar"><stop offset="0" stop-color="#f4efe6" stop-opacity=".22"/><stop offset="1" stop-color="#f4efe6" stop-opacity="0"/></radialGradient>
        </defs>
        <path class="track" d="M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}" />
        <path class="trail" d="M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - t)}" />
        <line class="horizon" x1="8" y1="${CY}" x2="312" y2="${CY}" />
        ${
          night
            ? `<mask id="crescente"><rect x="0" y="0" width="320" height="172" fill="#fff"/><circle cx="${sx + 6}" cy="${sy - 4}" r="10" fill="#000"/></mask>
               <circle cx="${sx}" cy="${sy}" r="30" fill="url(#luar)" /><circle class="moon" cx="${sx}" cy="${sy}" r="11" mask="url(#crescente)" />`
            : `<circle cx="${sx}" cy="${sy}" r="34" fill="url(#glow)" /><circle class="sun" cx="${sx}" cy="${sy}" r="13" />`
        }
        <text class="edge" x="${CX - R}" y="${CY + 18}" text-anchor="middle">${hhmm(from)}</text>
        <text class="edge" x="${CX + R}" y="${CY + 18}" text-anchor="middle">${hhmm(to)}</text>
        <text class="clock" x="${CX}" y="${CY - 22}" text-anchor="middle" aria-label="Hora atual">${hhmm(now)}</text>
      </svg>
      <p class="eyebrow">${esc(cap(now.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })))}</p>
      <h1>${greet}, Pedro</h1>
      ${weatherLine(brief?.weather)}
      ${brief?.headline ? `<p class="headline">${esc(brief.headline)}</p>` : ""}
    </header>`;
}

// Tempo de hoje (ou de amanhã, ao fim do dia).
function weatherLine(w?: Weather): string {
  if (!w?.days?.length) return "";
  const today = ymd(new Date());
  const late = new Date().getHours() >= 19;
  const d = w.days.find((x) => x.date === (late ? addDays(today, 1) : today));
  if (!d) return "";
  return `<p class="weather">${late ? "Amanhã · " : ""}${d.emoji} ${d.tmax}° / ${d.tmin}°${d.rain >= 30 ? ` · chuva ${d.rain}%` : ""} · ${esc(w.place)}</p>`;
}

// Abre o Google Maps com o trajeto para o hospital (trânsito em tempo real, sem chaves nem morada guardada).
const HOSPITAL_ROUTE =
  "https://www.google.com/maps/dir/?api=1&destination=Hospital+Prof.+Doutor+Fernando+Fonseca,+Amadora&travelmode=driving";

function segmented(): string {
  return `
    <div class="segmented" role="tablist">
      <button role="tab" data-view="hoje" aria-selected="${state.view === "hoje"}">Hoje</button>
      <button role="tab" data-view="calendario" aria-selected="${state.view === "calendario"}">Calendário</button>
    </div>`;
}

function dutyBanner(): string {
  const today = ymd(new Date());
  const tomorrow = addDays(today, 1);
  const duty = allEvents().filter((e) => e.source === "escala");
  const now = duty.find((e) => eventsOn(today).includes(e));
  const next = !now && duty.find((e) => e.start.slice(0, 10) === tomorrow);
  const e = now || next;
  if (!e) return "";
  const when = now ? "Hoje" : "Amanhã";
  return `
    <section class="card duty ${now ? "is-now" : ""}">
      <div class="duty-icon" aria-hidden="true">✚</div>
      <div>
        <p class="duty-when">${when} · Escala</p>
        <p class="duty-title">${esc(e.title)}</p>
        <p class="muted">${e.allDay ? "Dia inteiro" : `${time(e.start)} – ${time(e.end)}`}</p>
        ${now ? `<a class="link route" href="${HOSPITAL_ROUTE}" target="_blank" rel="noopener">🚗 Trânsito para o hospital</a>` : ""}
      </div>
    </section>`;
}

function weekStrip(): string {
  const today = ymd(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  return `
    <div class="week" role="list">
      ${days
        .map((d) => {
          const ev = eventsOn(d);
          const dt = new Date(`${d}T12:00:00`);
          const dots = [...new Set(ev.map((e) => e.source))].map((s) => `<i class="dot ${s}"></i>`).join("");
          return `
          <button role="listitem" class="day ${d === state.selected ? "sel" : ""} ${d === today ? "today" : ""}" data-day="${d}">
            <span class="dow">${esc(dt.toLocaleDateString(LOCALE, { weekday: "narrow" }))}</span>
            <span class="num">${dt.getDate()}</span>
            <span class="dots">${dots}</span>
          </button>`;
        })
        .join("")}
    </div>`;
}

function agenda(date: string, title?: string): string {
  const ev = eventsOn(date);
  const dt = new Date(`${date}T12:00:00`);
  const label = title ?? cap(dt.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" }));
  const nowMs = Date.now();
  return `
    <section class="card">
      <h2>${esc(label)}</h2>
      ${
        ev.length === 0
          ? `<p class="empty">Nada marcado. Dia livre.</p>`
          : `<ul class="timeline">${ev
              .map((e) => {
                const past = !e.allDay && new Date(e.end).getTime() < nowMs;
                const spans = !e.allDay && e.start.slice(0, 10) !== e.end.slice(0, 10);
                const t = e.allDay ? "Todo o dia" : spans && e.start.slice(0, 10) !== date ? `até ${time(e.end)}` : time(e.start);
                return `
                <li class="ev ${e.source} ${past ? "past" : ""}">
                  <span class="ev-time">${esc(t)}</span>
                  <span class="ev-bar"></span>
                  <span class="ev-body">
                    <span class="ev-title">${esc(e.title)}</span>
                    <span class="ev-meta">${esc(SOURCE_LABEL[e.source])}${e.location ? ` · ${esc(e.location)}` : ""}${
                      !e.allDay && !(spans && e.start.slice(0, 10) !== date) ? ` · até ${time(e.end)}` : ""
                    }</span>
                  </span>
                </li>`;
              })
              .join("")}</ul>`
      }
    </section>`;
}

function summaryCard(b: Brief): string {
  if (!b.summary && b.focus.length === 0) return "";
  return `
    <section class="card">
      <h2>Resumo</h2>
      ${b.summary ? `<p class="summary">${esc(b.summary)}</p>` : ""}
      ${
        b.focus.length
          ? `<ol class="focus">${b.focus.map((f) => `<li>${esc(f)}</li>`).join("")}</ol>`
          : ""
      }
    </section>`;
}

const PRI: Record<EmailItem["priority"], string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

const threadOf = (link: string) => link.match(/#[a-z]+\/([\w-]+)/i)?.[1] ?? "";
const dias = (n: number) => (n === 0 ? "hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`);

// Um só cartão: os emails que pedem ação e, a seguir, os que esperam resposta (sem repetir conversas).
function emailsCard(emails: EmailItem[], toReply: ReplyItem[] = []): string {
  const replyById = new Map(toReply.map((r) => [r.id, r]));
  const shown = new Set<string>();
  const top = emails.map((m) => {
    const id = threadOf(m.link);
    const r = id ? replyById.get(id) : undefined;
    if (id) shown.add(id);
    return `
              <li>
                <a class="row" href="${esc(safeHref(m.link))}" target="_blank" rel="noopener">
                  <span class="pill ${m.priority}">${PRI[m.priority]}</span>
                  <span class="row-body">
                    <span class="row-title">${r?.starred ? "★ " : ""}${esc(m.subject)}</span>
                    <span class="row-sub">${esc(m.from)}</span>
                    <span class="row-note">${esc(m.action)}${m.why ? ` · ${esc(m.why)}` : ""}</span>
                  </span>
                  <span class="chev" aria-hidden="true">›</span>
                </a>
                ${r ? draftRow(r.id) : ""}
              </li>`;
  });
  const rest = toReply.filter((r) => !shown.has(r.id));
  const restHtml = rest.map(
    (m) => `
        <li>
          <a class="row" href="${esc(safeHref(m.link))}" target="_blank" rel="noopener">
            <span class="pill ${m.starred ? "alta" : "baixa"}">${m.starred ? "★" : dias(m.days).replace("há ", "")}</span>
            <span class="row-body">
              <span class="row-title">${esc(m.subject)}</span>
              <span class="row-sub">${esc(m.from)} · ${m.starred ? "com estrela" : `sem resposta ${dias(m.days)}`}</span>
            </span>
            <span class="chev" aria-hidden="true">›</span>
          </a>
          ${draftRow(m.id)}
        </li>`,
  );
  const total = emails.length + rest.length;
  return `
    <section class="card">
      <h2>Emails <span class="count">${total}</span></h2>
      ${total === 0 ? `<p class="empty">Caixa tranquila, nada precisa de ti.</p>` : ""}
      ${top.length ? `<ul class="list">${top.join("")}</ul>` : ""}
      ${rest.length ? `<p class="subhead">À espera de resposta</p><ul class="list">${restHtml.join("")}</ul>` : ""}
    </section>`;
}

// Estado dos rascunhos e ações nas tarefas (por id), só nesta sessão.
const draftState: Record<string, { busy?: boolean; msg?: string; link?: string; err?: boolean }> = {};
const taskBusy = new Set<string>();
let taskMsg = "";

function draftRow(threadId: string): string {
  const st = draftState[threadId];
  if (st?.link) return `<p class="act ok">✓ Rascunho guardado. <a class="link" href="${esc(st.link)}" target="_blank" rel="noopener">Abrir no Gmail</a></p>`;
  if (st?.busy) return `<p class="act muted">A escrever o rascunho…</p>`;
  return `<p class="act"><button class="link" data-draft="${esc(threadId)}">✍️ Preparar rascunho de resposta</button>${
    st?.msg ? ` <span class="${st.err ? "err" : "muted"}">${esc(st.msg)}</span>` : ""
  }</p>`;
}

// ---------- faixas do dia ----------
// A agenda vem sempre primeiro; o resto muda com a hora: à tarde as tarefas rápidas,
// ao fim do dia o que ficou por responder, ao fim de semana a vista pessoal.
type Faixa = "manha" | "tarde" | "fecho" | "fim-de-semana" | "vespera";

function faixaDoDia(d = new Date()): Faixa {
  const h = d.getHours();
  const dow = d.getDay();
  if (dow === 6 || (dow === 0 && h < 18)) return "fim-de-semana";
  if (dow === 0) return "vespera";
  if (h < 14) return "manha";
  if (h < 19) return "tarde";
  return "fecho";
}

const FAIXA_TEXTO: Record<Faixa, string> = {
  manha: "Manhã: agenda e escala primeiro.",
  tarde: "Tarde: agenda, depois tarefas rápidas e emails.",
  fecho: "Fim do dia: o dia de amanhã e o que ficou por responder.",
  "fim-de-semana": "Fim de semana: a tua vista pessoal.",
  vespera: "Domingo à noite: a preparação da semana.",
};

// As tuas tarefas (guardadas na app) primeiro, por prazo; depois as do Notion/Obsidian vindas do brief.
function allTasks(): TaskItem[] {
  const own = [...(state.snap?.tasks ?? [])].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const other = (state.snap?.brief?.tasks ?? []).filter((t) => t.source !== "app");
  return [...own, ...other];
}

function tasksCard(tasks: TaskItem[]): string {
  const today = ymd(new Date());
  return `
    <section class="card">
      <h2>Tarefas <span class="count">${tasks.length}</span></h2>
      <form class="task-add" data-form="task" autocomplete="off">
        <input name="title" type="text" maxlength="300" placeholder="Nova tarefa…" aria-label="Nova tarefa" enterkeyhint="done" />
        <select name="when" aria-label="Quando">
          <option value="">Sem data</option>
          <option value="hoje">Hoje</option>
          <option value="amanha">Amanhã</option>
        </select>
        <button class="tbtn add" type="submit" aria-label="Adicionar">+</button>
      </form>
      ${
        tasks.length === 0
          ? `<p class="empty">Tudo em dia.</p>`
          : `<ul class="list">${tasks
              .map((t) => {
                const overdue = t.due && t.due < today;
                const due = t.due
                  ? t.due === today
                    ? "Hoje"
                    : t.due === addDays(today, 1)
                      ? "Amanhã"
                      : new Date(`${t.due}T12:00:00`).toLocaleDateString(LOCALE, { day: "numeric", month: "short" })
                  : "";
                const inner = `
                  <span class="check ${t.priority}" aria-hidden="true"></span>
                  <span class="row-body">
                    <span class="row-title">${esc(t.title)}</span>
                    <span class="row-sub">${[
                      t.source === "notion" ? "Notion" : t.source === "obsidian" ? "Obsidian" : "",
                      t.context ? esc(t.context) : "",
                      due ? `<b class="${overdue ? "late" : ""}">${esc(due)}</b>` : "",
                    ].filter(Boolean).join(" · ")}</span>
                  </span>`;
                const acts =
                  t.source === "notion" || t.source === "app"
                    ? `<span class="task-acts">${
                        taskBusy.has(t.id)
                          ? `<span class="muted">…</span>`
                          : `<button class="tbtn" data-task="${esc(t.id)}" data-op="done" aria-label="Marcar como feita">✓</button><button class="tbtn" data-task="${esc(t.id)}" data-op="tomorrow" aria-label="Passar para amanhã">→</button>`
                      }</span>`
                    : "";
                return `<li class="task-li">${
                  t.link ? `<a class="row" href="${esc(safeHref(t.link))}" target="_blank" rel="noopener">${inner}</a>` : `<div class="row">${inner}</div>`
                }${acts}</li>`;
              })
              .join("")}</ul>`
      }
      ${taskMsg ? `<p class="act err">${esc(taskMsg)}</p>` : ""}
    </section>`;
}

function monthGrid(): string {
  const [y, m] = state.month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // semana começa à segunda
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = ymd(new Date());
  const cells: string[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(`<span></span>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${state.month}-${String(d).padStart(2, "0")}`;
    const ev = eventsOn(date);
    const duty = ev.some((e) => e.source === "escala");
    const dots = [...new Set(ev.map((e) => e.source))].slice(0, 3).map((s) => `<i class="dot ${s}"></i>`).join("");
    cells.push(`
      <button class="mday ${date === state.selected ? "sel" : ""} ${date === today ? "today" : ""} ${duty ? "has-duty" : ""}" data-day="${date}">
        <span class="num">${d}</span><span class="dots">${dots}</span>
      </button>`);
  }
  const wd = ["S", "T", "Q", "Q", "S", "S", "D"];
  return `
    <section class="card month">
      <div class="month-head">
        <button class="nav" data-month="-1" aria-label="Mês anterior">‹</button>
        <h2>${esc(cap(first.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })))}</h2>
        <button class="nav" data-month="1" aria-label="Mês seguinte">›</button>
      </div>
      <div class="grid wd">${wd.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="grid">${cells.join("")}</div>
      <div class="legend">
        <span><i class="dot escala"></i>Escala</span>
        <span><i class="dot outlook"></i>Hospital</span>
        <span><i class="dot google"></i>Pessoal</span>
      </div>
    </section>`;
}

let notifMsg = "";
let atalhoMsg = "";
function notifRow(): string {
  const st = pushState();
  if (st === "indisponivel") return "";
  if (st === "ligadas") return `<p class="muted">🔔 Notificação da manhã ligada${notifMsg ? ` · ${esc(notifMsg)}` : ""}</p>`;
  if (st === "bloqueadas") return `<p class="muted">Notificações bloqueadas: ativa em Definições › Notificações › Daily Hub.</p>`;
  return `<button class="primary notif" data-action="notif">🔔 Ativar notificação da manhã</button>${
    notifMsg ? `<p class="err">${esc(notifMsg)}</p>` : ""
  }`;
}

function footer(): string {
  const s = state.snap;
  const b = s?.brief;
  const bad = b ? Object.entries(b.sources).filter(([, v]) => v === "erro").map(([k]) => k) : [];
  const lastOutlook = s?.outlook.length ? "" : " · Hospital sem dados (Atalho ainda não correu?)";
  return `
    <footer class="foot">
      ${isDemo ? `<p class="demo">Modo demonstração: dados fictícios.</p>` : ""}
      ${state.error ? `<p class="err">Sem ligação: a mostrar a última versão guardada.</p>` : ""}
      ${bad.length ? `<p class="err">Falhou hoje: ${esc(bad.join(", "))}</p>` : ""}
      <p class="muted">${
        b ? `Brief gerado às ${time(b.generatedAt)}${b.aiUsed ? "" : " (sem IA)"}${lastOutlook}` : "Ainda não há brief para hoje."
      }</p>
      ${notifRow()}
      ${!isDemo ? `<button class="link" data-action="atalho">📋 Copiar ligação para o Atalho</button>${atalhoMsg ? `<p class="muted">${esc(atalhoMsg)}</p>` : ""}` : ""}
      ${!isDemo ? `<button class="link" data-action="logout">Terminar sessão</button>` : ""}
    </footer>`;
}

// Menu lateral: gaveta no telemóvel (☰), coluna fixa no computador.
function sideMenu(): string {
  const b = state.snap?.brief;
  const n = (x?: unknown[]) => (x?.length ? `<span class="count">${x.length}</span>` : "");
  const item = (attrs: string, icon: string, label: string, extra = "", on = false) =>
    `<button class="side-item${on ? " on" : ""}" ${attrs}><span class="side-ico" aria-hidden="true">${icon}</span><span>${label}</span>${extra}</button>`;
  return `
    <div class="scrim" data-action="menu-fechar" ${state.menu ? "" : "hidden"}></div>
    <nav class="side${state.menu ? " open" : ""}" aria-label="Menu">
      <p class="side-brand">Daily Hub</p>
      ${item('data-view="hoje"', "☀️", "Hoje", "", state.view === "hoje")}
      ${item('data-view="calendario"', "🗓️", "Calendário", "", state.view === "calendario")}
      <p class="side-sec">Secções</p>
      ${item('data-goto="agenda"', "🕘", "Agenda")}
      ${item('data-goto="resumo"', "✨", "Resumo")}
      ${item('data-goto="emails"', "✉️", "Emails", n(b ? [...b.emails.map((m) => threadOf(m.link)), ...(b.toReply ?? []).map((r) => r.id)].filter((v, i, a) => !v || a.indexOf(v) === i) : undefined))}
      ${item('data-goto="tarefas"', "✅", "Tarefas", n(allTasks()))}
      ${
        isDemo
          ? ""
          : `<p class="side-sec">Definições</p>
      ${pushState() === "ligadas" || pushState() === "indisponivel" ? "" : item('data-action="notif"', "🔔", "Ativar notificação")}
      ${item('data-action="atalho"', "📋", "Copiar ligação do Atalho")}
      ${item('data-action="logout"', "↪︎", "Terminar sessão")}`
      }
    </nav>`;
}

// ---------- ecrãs ----------

function renderMain() {
  const b = state.snap?.brief ?? null;
  const stale = b && b.date !== ymd(new Date());
  let body = "";
  if (state.view === "hoje") {
    const faixa = faixaDoDia();
    const hoje = ymd(new Date());
    // Ao fim do dia (e domingo à noite) o dia em foco passa a ser amanhã, a não ser que escolhas outro.
    const prepara = faixa === "fecho" || faixa === "vespera";
    const dia = prepara && state.selected === hoje ? addDays(hoje, 1) : state.selected;
    const titulo = dia === hoje ? "Agenda de hoje" : dia === addDays(hoje, 1) ? "Amanhã" : undefined;
    const c = {
      agenda: agenda(dia, titulo),
      resumo: b ? summaryCard(b) : "",
      emails: b ? emailsCard(b.emails, b.toReply) : "",
      tarefas: tasksCard(allTasks()),
    };
    const ordem: Record<Faixa, (keyof typeof c)[]> = {
      manha: ["agenda", "tarefas", "emails", "resumo"],
      tarde: ["agenda", "tarefas", "emails", "resumo"],
      fecho: ["agenda", "tarefas", "emails", "resumo"],
      "fim-de-semana": ["agenda", "tarefas", "resumo", "emails"],
      vespera: ["agenda", "tarefas", "resumo", "emails"],
    };
    body = `
      ${dutyBanner()}
      ${stale ? `<p class="stale">A mostrar o brief de ${esc(b!.date)}. O de hoje ainda não foi gerado.</p>` : ""}
      ${weekStrip()}
      <p class="faixa">${FAIXA_TEXTO[faixa]}</p>
      ${ordem[faixa].map((k) => (c[k] ? `<div class="sec" id="sec-${k}">${c[k]}</div>` : "")).join("")}`;
  } else {
    body = `${monthGrid()}<div class="sec" id="sec-agenda">${agenda(state.selected)}</div>`;
  }
  document.body.classList.toggle("menu-open", state.menu);
  app.innerHTML = `
    ${sideMenu()}
    <button class="menu-btn" data-action="menu" aria-label="Abrir menu" aria-expanded="${state.menu}">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <main class="wrap ${state.loading ? "loading" : ""}">
      ${header(b)}
      ${segmented()}
      ${body}
      ${footer()}
    </main>`;
}


// ---------- segundo fator (código da app de autenticação) ----------
// A base de dados só entrega dados a sessões com segundo fator (aal2). Depois de verificado,
// o iPhone guarda a sessão: não volta a pedir o código a cada abertura.

async function needsSecondFactor(): Promise<boolean> {
  if (isDemo || !sb) return false;
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === "aal2") return false;
  const f = await sb.auth.mfa.listFactors();
  const verified = f.data?.totp ?? [];
  if (verified.length) renderMfaChallenge(verified[0].id);
  else await renderMfaEnroll();
  return true;
}

function codeForm(id: string, msg: string): string {
  return `
    <form class="card form" id="${id}">
      <label>Código de 6 dígitos<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
      <button class="primary" type="submit">Confirmar</button>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
    </form>`;
}

function onCode(formId: string, factorId: string, retry: (msg: string) => void) {
  const form = document.getElementById(formId) as HTMLFormElement;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!sb) return;
    const code = String(new FormData(form).get("code")).replace(/\s/g, "");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) retry("Código errado ou expirado. Tenta o código seguinte.");
    else void boot();
  };
}

function renderMfaChallenge(factorId: string, msg = "") {
  app.innerHTML = `
    <main class="wrap login">
      ${header(null)}
      <p class="headline center">Escreve o código da tua app de autenticação.</p>
      ${codeForm("mfa", msg)}
    </main>`;
  onCode("mfa", factorId, (m) => renderMfaChallenge(factorId, m));
}

async function renderMfaEnroll(msg = "") {
  if (!sb) return;
  // Limpa tentativas anteriores por concluir.
  const all = (await sb.auth.mfa.listFactors()).data?.all ?? [];
  for (const f of all) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Daily Hub" });
  if (error || !data) {
    app.innerHTML = `<main class="wrap login">${header(null)}<p class="err center">Não consegui preparar o segundo fator. Fecha e abre a app.</p></main>`;
    return;
  }
  const secret = data.totp.secret;
  app.innerHTML = `
    <main class="wrap login">
      ${header(null)}
      <section class="card mfa">
        <h2>Ativar o segundo fator</h2>
        <p>Uma vez só. A partir daqui, para entrar é preciso a password <b>e</b> um código que muda a cada 30 segundos.</p>
        <ol class="mfa-steps">
          <li><a class="primary btn" href="${esc(data.totp.uri)}">Adicionar à app Palavras-passe</a><br/>
            <span class="muted">Se não abrir: app <b>Palavras-passe</b> → a tua conta → <i>Configurar código de verificação</i> → <i>Introduzir chave</i>, e cola esta chave:</span>
            <code class="secret" id="secret">${esc(secret)}</code>
            <button class="link" type="button" id="copy">Copiar chave</button></li>
          <li>Escreve aqui o código de 6 dígitos que aparece.</li>
        </ol>
        <img class="qr" src="${esc(data.totp.qr_code)}" alt="Código QR para outro dispositivo" width="160" height="160" />
      </section>
      ${codeForm("enroll", msg)}
    </main>`;
  document.getElementById("copy")!.onclick = () => navigator.clipboard?.writeText(secret).catch(() => {});
  onCode("enroll", data.id, (m) => {
    const p = document.querySelector("#enroll .err") ?? document.createElement("p");
    p.className = "err";
    p.textContent = m;
    document.getElementById("enroll")!.appendChild(p);
  });
}

function renderLogin(msg = "") {
  app.innerHTML = `
    <main class="wrap login">
      ${header(null)}
      <p class="headline center">Entra uma vez. A sessão fica guardada neste iPhone.</p>
      <form class="card form" id="login">
        <label>Email<input name="email" type="email" autocomplete="username" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="primary" type="submit">Entrar</button>
        ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      </form>
    </main>`;
  const form = document.getElementById("login") as HTMLFormElement;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!sb) return;
    const fd = new FormData(form);
    const { error } = await sb.auth.signInWithPassword({
      email: String(fd.get("email")).trim(),
      password: String(fd.get("password")),
    });
    if (error) renderLogin("Email ou password errados.");
    else void boot();
  };
}

// ---------- eventos ----------

app.addEventListener("click", async (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-view],[data-day],[data-month],[data-action],[data-goto],[data-draft],[data-task]");
  if (!t) return;
  if (t.dataset.draft) {
    const id = t.dataset.draft;
    draftState[id] = { busy: true };
    renderMain();
    const r = await callFn("draft-reply", { threadId: id });
    draftState[id] = r.ok ? { link: r.link } : { msg: r.error ?? "Não consegui.", err: true };
    renderMain();
    return;
  }
  if (t.dataset.task) {
    ev.preventDefault();
    const id = t.dataset.task;
    const op = t.dataset.op as "done" | "tomorrow";
    taskBusy.add(id);
    taskMsg = "";
    renderMain();
    const tomorrow = addDays(ymd(new Date()), 1);
    const apply = (list: TaskItem[]) =>
      op === "done" ? list.filter((x) => x.id !== id) : list.map((x) => (x.id === id ? { ...x, due: tomorrow } : x));
    if (id.startsWith("a:")) {
      const err = await updateTask(id, op, tomorrow);
      if (err) taskMsg = err;
      else if (state.snap) state.snap.tasks = apply(state.snap.tasks ?? []);
    } else {
      const r = await callFn("task-action", { id, action: op });
      const brief = state.snap?.brief;
      if (r.ok && brief) brief.tasks = apply(brief.tasks);
      else if (!r.ok) taskMsg = r.error ?? "Não consegui atualizar a tarefa.";
    }
    taskBusy.delete(id);
    renderMain();
    return;
  }
  const fromMenu = !!t.closest(".side");
  if (fromMenu) state.menu = false;
  if (t.dataset.action === "menu") {
    state.menu = !state.menu;
  } else if (t.dataset.action === "menu-fechar") {
    state.menu = false;
  } else if (t.dataset.goto) {
    // Secções vivem no separador Hoje (a agenda também existe no Calendário).
    const k = t.dataset.goto;
    if (!(k === "agenda" && state.view === "calendario")) state.view = "hoje";
    renderMain();
    const el = document.getElementById(`sec-${k}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  } else if (t.dataset.view) {
    state.view = t.dataset.view as View;
    localStorageSet("dh:view", state.view);
  } else if (t.dataset.day) {
    state.selected = t.dataset.day;
  } else if (t.dataset.month) {
    const [y, m] = state.month.split("-").map(Number);
    const d = new Date(y, m - 1 + Number(t.dataset.month), 1);
    state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  } else if (t.dataset.action === "atalho") {
    const url = await shortcutUrl();
    if (!url) atalhoMsg = "Não consegui obter a ligação. Fecha e abre a app.";
    else {
      try {
        await navigator.clipboard.writeText(url);
        atalhoMsg = "Copiada. Cola-a no passo «Obter conteúdo do URL» do Atalho.";
      } catch {
        atalhoMsg = url;
      }
    }
  } else if (t.dataset.action === "notif") {
    notifMsg = (await enablePush()) ?? "";
  } else if (t.dataset.action === "logout") {
    clearCache();
    await sb?.auth.signOut();
    renderLogin();
    return;
  }
  renderMain();
});

async function refresh() {
  state.loading = true;
  try {
    state.snap = await fetchSnapshot();
    state.error = null;
  } catch (e) {
    state.error = (e as Error).message;
  } finally {
    state.loading = false;
    renderMain();
  }
}

async function boot() {
  if (!isDemo && sb) {
    const { data } = await sb.auth.getSession();
    if (!data.session) return renderLogin();
    if (await needsSecondFactor()) return;
  }
  // 1) pinta já com a cache (abertura instantânea); 2) atualiza da rede.
  renderMain();
  await refresh();
  void syncPush();
}

// Nova tarefa (Enter ou +).
app.addEventListener("submit", async (ev) => {
  const form = (ev.target as HTMLElement).closest<HTMLFormElement>('form[data-form="task"]');
  if (!form) return;
  ev.preventDefault();
  const fd = new FormData(form);
  const when = String(fd.get("when") ?? "");
  const today = ymd(new Date());
  const due = when === "hoje" ? today : when === "amanha" ? addDays(today, 1) : undefined;
  const r = await addTask(String(fd.get("title") ?? ""), due);
  if (typeof r === "string") taskMsg = r;
  else {
    taskMsg = "";
    if (state.snap) state.snap.tasks = [...(state.snap.tasks ?? []), r];
  }
  renderMain();
  document.querySelector<HTMLInputElement>('form[data-form="task"] input[name="title"]')?.focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.menu) {
    state.menu = false;
    renderMain();
  }
});

// Ao voltar à app (iOS mantém PWAs suspensas), atualiza se passaram >5 min.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const last = state.snap?.fetchedAt ? Date.parse(state.snap.fetchedAt) : 0;
  if (Date.now() - last > 5 * 60e3) {
    state.selected = ymd(new Date());
    void refresh();
  }
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// O sol e o relógio avançam sozinhos enquanto a app está aberta.
setInterval(() => {
  const hero = document.querySelector(".hero");
  if (hero && document.visibilityState === "visible") hero.outerHTML = header(state.snap?.brief ?? null);
}, 30e3);

// Pede ao iOS para não apagar o armazenamento (mantém a sessão).
navigator.storage?.persist?.().catch(() => {});

void boot();
