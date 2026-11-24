// Previsão do tempo (Open-Meteo: gratuito, sem chave, sem dados pessoais enviados).
// Local por omissão: Hospital Prof. Doutor Fernando Fonseca (Amadora). Muda com WEATHER_LAT/WEATHER_LON/WEATHER_PLACE.
import type { WeatherDay, Weather } from "../types.js";

const LAT = Number(process.env.WEATHER_LAT ?? 38.7445);
const LON = Number(process.env.WEATHER_LON ?? -9.2464);
const PLACE = process.env.WEATHER_PLACE ?? "Amadora";

// Códigos WMO → texto curto e emoji.
function describe(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: "Céu limpo", emoji: "☀️" };
  if (code <= 2) return { label: "Pouco nublado", emoji: "🌤️" };
  if (code === 3) return { label: "Nublado", emoji: "☁️" };
  if (code === 45 || code === 48) return { label: "Nevoeiro", emoji: "🌫️" };
  if (code >= 51 && code <= 57) return { label: "Chuvisco", emoji: "🌦️" };
  if (code >= 61 && code <= 67) return { label: "Chuva", emoji: "🌧️" };
  if (code >= 71 && code <= 77) return { label: "Neve", emoji: "🌨️" };
  if (code >= 80 && code <= 82) return { label: "Aguaceiros", emoji: "🌦️" };
  if (code >= 95) return { label: "Trovoada", emoji: "⛈️" };
  return { label: "Variável", emoji: "🌥️" };
}

export async function fetchWeather(): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Europe/Lisbon",
    forecast_days: "8",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const d = (await res.json()) as {
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[];
    };
  };
  const days: WeatherDay[] = d.daily.time.map((date, i) => ({
    date,
    ...describe(d.daily.weather_code[i]),
    tmax: Math.round(d.daily.temperature_2m_max[i]),
    tmin: Math.round(d.daily.temperature_2m_min[i]),
    rain: d.daily.precipitation_probability_max[i] ?? 0,
  }));
  return { place: PLACE, days };
}
