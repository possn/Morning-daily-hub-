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
      source: "outlook" as const,
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
