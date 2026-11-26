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
  task?: string; // tarefa sugerida a partir do email
  due?: string; // prazo do email, YYYY-MM-DD
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

export interface Reading {
  pmid: string;
  title: string;
  journal: string;
  design: string; // ex.: "Ensaio aleatorizado", "Meta-análise"
  summary: string; // 2 frases em português
  details?: ReadingDetails; // resumo estruturado (a partir do resumo publicado)
  link: string;
}

export interface ReadingDetails {
  pergunta: string;
  desenho: string; // desenho, contexto, período
  populacao: string; // n, idades, critérios
  resultados: string; // outcome primário com números (efeito, IC 95%, p)
  limitacoes: string;
  pratica: string; // o que muda (ou não) na prática
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
  readings?: Reading[]; // leituras da semana (PubMed), renovadas ao domingo
  tasks: TaskItem[];
  sources: Record<string, "ok" | "erro" | "desligado">;
  aiUsed: boolean;
}
