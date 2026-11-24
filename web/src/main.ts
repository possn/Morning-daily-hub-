import "./styles.css";
import type { Brief, CalEvent, EmailItem, TaskItem } from "./types";
import { clearCache, fetchSnapshot, isDemo, readCache, sb, type Snapshot } from "./data";
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
} = {
  view: (localStorageGet("dh:view") as View) || "hoje",
  selected: ymd(new Date()),
  month: ymd(new Date()).slice(0, 7),
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

  // Posição do sol no arco: 0 = nascer, 1 = pôr. De noite fica pousado no horizonte.
  const span = set.getTime() - rise.getTime();
  const raw = (now.getTime() - rise.getTime()) / span;
  const t = Math.min(1, Math.max(0, raw));
  const R = 132, CX = 160, CY = 150;
  const ang = Math.PI * (1 - t);
  const sx = CX + R * Math.cos(ang);
  const sy = CY - R * Math.sin(ang);
  const night = phase === "noite";
  const nightX = raw < 0 ? CX - R : CX + R;
  const dash = Math.PI * R; // comprimento do arco
  const hhmm = (d: Date) => d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

  return `
    <header class="hero ${phase}">
      <svg class="sky" viewBox="0 0 320 172" aria-hidden="true">
        <defs>
          <radialGradient id="glow"><stop offset="0" stop-color="var(--sun)" stop-opacity=".55"/><stop offset="1" stop-color="var(--sun)" stop-opacity="0"/></radialGradient>
        </defs>
        <path class="track" d="M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}" />
        <path class="trail" d="M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - (night && raw > 1 ? 1 : t))}" />
        <line class="horizon" x1="8" y1="${CY}" x2="312" y2="${CY}" />
        ${
          night
            ? `<circle class="moon" cx="${nightX}" cy="${CY - 26}" r="11" /><circle class="moon-cut" cx="${nightX + 6}" cy="${CY - 30}" r="10" />`
            : `<circle cx="${sx}" cy="${sy}" r="34" fill="url(#glow)" /><circle class="sun" cx="${sx}" cy="${sy}" r="13" />`
        }
        <text class="edge" x="${CX - R}" y="${CY + 18}" text-anchor="middle">${hhmm(rise)}</text>
        <text class="edge" x="${CX + R}" y="${CY + 18}" text-anchor="middle">${hhmm(set)}</text>
      </svg>
      <div class="clock" aria-label="Hora atual">${hhmm(now)}</div>
      <p class="eyebrow">${esc(cap(now.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })))}</p>
      <h1>${greet}, Pedro</h1>
      ${brief?.headline ? `<p class="headline">${esc(brief.headline)}</p>` : ""}
    </header>`;
}

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

function emailsCard(emails: EmailItem[]): string {
  return `
    <section class="card">
      <h2>Emails <span class="count">${emails.length}</span></h2>
      ${
        emails.length === 0
          ? `<p class="empty">Caixa tranquila, nada precisa de ti.</p>`
          : `<ul class="list">${emails
              .map(
                (m) => `
              <li>
                <a class="row" href="${esc(safeHref(m.link))}" target="_blank" rel="noopener">
                  <span class="pill ${m.priority}">${PRI[m.priority]}</span>
                  <span class="row-body">
                    <span class="row-title">${esc(m.subject)}</span>
                    <span class="row-sub">${esc(m.from)}</span>
                    <span class="row-note">${esc(m.action)}${m.why ? ` · ${esc(m.why)}` : ""}</span>
                  </span>
                  <span class="chev" aria-hidden="true">›</span>
                </a>
              </li>`,
              )
              .join("")}</ul>`
      }
    </section>`;
}

function tasksCard(tasks: TaskItem[]): string {
  const today = ymd(new Date());
  return `
    <section class="card">
      <h2>Tarefas <span class="count">${tasks.length}</span></h2>
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
                    <span class="row-sub">${t.source === "notion" ? "Notion" : "Obsidian"}${t.context ? ` · ${esc(t.context)}` : ""}${
                      due ? ` · <b class="${overdue ? "late" : ""}">${esc(due)}</b>` : ""
                    }</span>
                  </span>`;
                return `<li>${
                  t.link ? `<a class="row" href="${esc(safeHref(t.link))}" target="_blank" rel="noopener">${inner}</a>` : `<div class="row">${inner}</div>`
                }</li>`;
              })
              .join("")}</ul>`
      }
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
      ${!isDemo ? `<button class="link" data-action="logout">Terminar sessão</button>` : ""}
    </footer>`;
}

// ---------- ecrãs ----------

function renderMain() {
  const b = state.snap?.brief ?? null;
  const stale = b && b.date !== ymd(new Date());
  let body = "";
  if (state.view === "hoje") {
    body = `
      ${dutyBanner()}
      ${stale ? `<p class="stale">A mostrar o brief de ${esc(b!.date)}. O de hoje ainda não foi gerado.</p>` : ""}
      ${weekStrip()}
      ${agenda(state.selected, state.selected === ymd(new Date()) ? "Agenda de hoje" : undefined)}
      ${b ? summaryCard(b) : ""}
      ${b ? emailsCard(b.emails) : ""}
      ${b ? tasksCard(b.tasks) : ""}`;
  } else {
    body = `${monthGrid()}${agenda(state.selected)}`;
  }
  app.innerHTML = `
    <main class="wrap ${state.loading ? "loading" : ""}">
      ${header(b)}
      ${segmented()}
      ${body}
      ${footer()}
    </main>`;
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
  const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-view],[data-day],[data-month],[data-action]");
  if (!t) return;
  if (t.dataset.view) {
    state.view = t.dataset.view as View;
    localStorageSet("dh:view", state.view);
  } else if (t.dataset.day) {
    state.selected = t.dataset.day;
  } else if (t.dataset.month) {
    const [y, m] = state.month.split("-").map(Number);
    const d = new Date(y, m - 1 + Number(t.dataset.month), 1);
    state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  }
  // 1) pinta já com a cache (abertura instantânea); 2) atualiza da rede.
  renderMain();
  await refresh();
}

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
