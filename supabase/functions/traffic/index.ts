// Tempo de viagem com trânsito em tempo real, da posição atual do iPhone até ao hospital (TomTom Routing API).
// A posição é arredondada (~100 m), não é guardada e só vai para a TomTom.
// Secret necessário (Supabase > Edge Functions > Secrets): TOMTOM_API_KEY (conta gratuita em developer.tomtom.com).
// Corpo: { "lat": number, "lon": number }
import { cors, json, requireOwner } from "../_shared/owner.ts";

// Hospital Prof. Doutor Fernando Fonseca (Amadora). Muda com os secrets DEST_LAT/DEST_LON.
const DEST_LAT = Number(Deno.env.get("DEST_LAT") ?? 38.7445);
const DEST_LON = Number(Deno.env.get("DEST_LON") ?? -9.2464);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  const key = Deno.env.get("TOMTOM_API_KEY");
  if (!key) return json({ error: "sem chave", code: "no_key" }, 501);

  const { lat, lon } = (await req.json().catch(() => ({}))) as { lat?: number; lon?: number };
  if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: "pedido inválido" }, 400);
  }
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${r3(lat)},${r3(lon)}:${DEST_LAT},${DEST_LON}/json?` +
    new URLSearchParams({ key, traffic: "true", travelMode: "car", routeType: "fastest", computeTravelTimeFor: "all" });
  const res = await fetch(url);
  if (!res.ok) return json({ error: `TomTom ${res.status}` }, 502);
  const s = ((await res.json()) as {
    routes?: { summary: { travelTimeInSeconds: number; trafficDelayInSeconds?: number; noTrafficTravelTimeInSeconds?: number; lengthInMeters: number } }[];
  }).routes?.[0]?.summary;
  if (!s) return json({ error: "sem rota" }, 502);
  return json({
    minutes: Math.round(s.travelTimeInSeconds / 60),
    delay: Math.round((s.trafficDelayInSeconds ?? 0) / 60),
    usual: s.noTrafficTravelTimeInSeconds ? Math.round(s.noTrafficTravelTimeInSeconds / 60) : null,
    km: Math.round(s.lengthInMeters / 100) / 10,
  });
});
