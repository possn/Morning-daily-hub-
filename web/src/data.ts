import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Brief, CalEvent } from "./types";
import { demoBrief, demoOutlook } from "./demo";

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isDemo = !URL_ || !KEY || new URLSearchParams(location.search).has("demo");

export const sb: SupabaseClient | null = isDemo
  ? null
  : createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "dh-auth" } });

const CACHE_KEY = "dh:cache:v1";

export interface Snapshot {
  brief: Brief | null;
  outlook: CalEvent[];
  fetchedAt: string;
}

export function readCache(): Snapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

function writeCache(s: Snapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    /* modo privado ou sem espaço: segue sem cache */
  }
}

export function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

// Eventos vindos do iPhone (Atalho): Outlook do hospital e Família do iCloud.
// Turnos de urgência ("Banco M", "Banco P dia", "Urgência", "SU", "Prevenção") contam como escala.
export const DUTY_RE = /^\s*banco\b|urg[eê]ncia|\bSU\b|preven[cç][aã]o/i;
export function deviceSource(title: string, calendar?: string | null): CalEvent["source"] {
  if (DUTY_RE.test(title)) return "escala";
  // Calendários pessoais do iPhone (Família, feriados, corridas…); o resto conta como hospital.
  if (/fam[ií]l|feriad|holiday|anivers|birthday|dorsal|runners/i.test(calendar ?? "")) return "google";
  return "outlook";
}

// ---------- notificações (Web Push) ----------
const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushSupported(): boolean {
  return !isDemo && !!VAPID && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushState(): "ligadas" | "bloqueadas" | "por-ativar" | "indisponivel" {
  if (!pushSupported()) return "indisponivel";
  if (Notification.permission === "granted") return "ligadas";
  if (Notification.permission === "denied") return "bloqueadas";
  return "por-ativar";
}

function b64uToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Pede autorização (tem de vir de um toque) e guarda a subscrição no Supabase.
export async function enablePush(): Promise<string | null> {
  if (!pushSupported() || !sb) return "Neste aparelho as notificações só funcionam com a app instalada no ecrã principal.";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "Sem autorização. Ativa em Definições › Notificações › Daily Hub.";
  return syncPush();
}

// Garante que a subscrição atual está guardada (o iOS pode renová-la).
export async function syncPush(): Promise<string | null> {
  if (!pushSupported() || !sb || Notification.permission !== "granted") return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(VAPID!) }));
    const j = sub.toJSON();
    const { data } = await sb.auth.getUser();
    if (!data.user || !j.endpoint || !j.keys) return "Sessão expirada.";
    const { error } = await sb
      .from("push_subscriptions")
      .upsert({ endpoint: j.endpoint, user_id: data.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth });
    return error ? "Não consegui guardar a subscrição." : null;
  } catch {
    return "Não consegui ativar as notificações.";
  }
}

export async function fetchSnapshot(): Promise<Snapshot> {
  if (isDemo || !sb) {
    return { brief: demoBrief(), outlook: demoOutlook(), fetchedAt: new Date().toISOString() };
  }
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [b, o] = await Promise.all([
    sb.from("briefs").select("payload").order("brief_date", { ascending: false }).limit(1).maybeSingle(),
    sb
      .from("outlook_events")
      .select("uid,title,start_at,end_at,all_day,location,calendar")
      .gte("end_at", since.toISOString())
      .order("start_at")
      .limit(500),
  ]);
  if (b.error) throw b.error;
  if (o.error) throw o.error;
  const snap: Snapshot = {
    brief: (b.data?.payload as Brief) ?? null,
    outlook: (o.data ?? []).map((r) => ({
      id: `o:${r.uid}`,
      source: deviceSource(r.title, r.calendar),
      title: r.title,
      start: r.start_at,
      end: r.end_at,
      allDay: r.all_day,
      location: r.location ?? undefined,
      calendar: r.calendar ?? undefined,
    })),
    fetchedAt: new Date().toISOString(),
  };
  writeCache(snap);
  return snap;
}

// Ligação do Atalho do iOS, já com o token (só para sessões com segundo fator).
export async function shortcutUrl(): Promise<string | null> {
  if (!sb) return null;
  const { data, error } = await sb.rpc("shortcut_url");
  return error || typeof data !== "string" ? null : data;
}
