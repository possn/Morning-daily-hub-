// Nascer e pôr do sol (algoritmo NOAA simplificado), por omissão em Lisboa.
const RAD = Math.PI / 180;

export function sunTimes(date: Date, lat = 38.7223, lon = -9.1393): { rise: Date; set: Date } {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 864e5);
  const g = ((2 * Math.PI) / 365) * (day - 1);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl)) / RAD;
  const utcMid = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const riseMin = 720 - 4 * (lon + ha) - eqTime;
  const setMin = 720 - 4 * (lon - ha) - eqTime;
  return { rise: new Date(utcMid + riseMin * 60e3), set: new Date(utcMid + setMin * 60e3) };
}

export type Phase = "noite" | "aurora" | "dia" | "ocaso";

export function sunPhase(now: Date, rise: Date, set: Date): Phase {
  const t = now.getTime();
  const h = 50 * 60e3;
  if (t < rise.getTime() - h / 2 || t > set.getTime() + h / 2) return "noite";
  if (t < rise.getTime() + h) return "aurora";
  if (t > set.getTime() - h) return "ocaso";
  return "dia";
}
