// Cópia de job/src/types.ts: mantém as duas iguais.

export type EventSource = "google" | "escala" | "outlook";

export interface CalEvent {
  id: string;
  source: EventSource;
  title: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  allDay: boolean;
  location?: string;
  calendar?: string;
}

export interface EmailItem {
  id: string;
  from: string;
  subject: string;
  why: string;
  action: string;
  priority: "alta" | "media" | "baixa";
  link: string;
}

export interface ReplyItem {
  id: string; // threadId
  from: string;
  subject: string;
  days: number; // dias desde a última mensagem
  starred: boolean;
  link: string;
}

export interface TaskItem {
  id: string;
  source: "app" | "notion" | "obsidian";
  title: string;
  due?: string; // YYYY-MM-DD
  priority: "alta" | "media" | "baixa";
  link?: string;
  context?: string;
}

export interface WeatherDay {
  date: string; // YYYY-MM-DD
  label: string;
  emoji: string;
  tmax: number;
  tmin: number;
  rain: number; // probabilidade de chuva, %
}

export interface Weather {
  place: string;
  days: WeatherDay[];
}

export interface Brief {
  date: string; // YYYY-MM-DD (Europe/Lisbon)
  generatedAt: string;
  headline: string;
  summary: string;
  focus: string[];
  duty: { label: string; start: string; end: string } | null;
  events: CalEvent[]; // próximos 14 dias, Google + escala (Outlook vem à parte)
  emails: EmailItem[];
  toReply?: ReplyItem[]; // com estrela ou sem resposta há mais de 2 dias
  weather?: Weather;
  tasks: TaskItem[];
  sources: Record<string, "ok" | "erro" | "desligado">;
  aiUsed: boolean;
}
