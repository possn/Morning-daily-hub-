// Dados fictícios para pré-visualizar a app sem backend (?demo ou sem .env).
import type { Brief, CalEvent } from "./types";

const iso = (dayOffset: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const ymd = (o = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + o);
  return d.toLocaleDateString("en-CA");
};

export function demoBrief(): Brief {
  return {
    date: ymd(),
    generatedAt: iso(0, 5, 16),
    headline: "Dia de serviço com reunião às 14h; urgência amanhã",
    weather: {
      place: "Amadora",
      days: [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return { date: d.toLocaleDateString("en-CA"), label: "Pouco nublado", emoji: "🌤️", tmax: 17 - (i % 3), tmin: 9, rain: i === 1 ? 70 : 10 };
      }),
    },
    summary:
      "Manhã na UCIP com a passagem de turno às 8h. Às 14h tens a reunião de serviço e às 16h30 uma janela livre de uma hora. Amanhã estás de urgência 24h, por isso deixa a apresentação de quinta adiantada hoje.",
    focus: ["Rever os slides da sessão clínica de quinta", "Responder à coordenação sobre a escala de dezembro", "Submeter o resumo para o congresso até sexta"],
    duty: null,
    events: [
      { id: "g1", source: "google", title: "Ginásio", start: iso(0, 7, 0), end: iso(0, 7, 45), allDay: false },
      { id: "g2", source: "google", title: "Jantar com amigos", start: iso(0, 20, 30), end: iso(0, 22, 30), allDay: false, location: "Lisboa" },
      { id: "e1", source: "escala", title: "Banco P 24h", start: `${ymd(1)}T00:00:00`, end: `${ymd(2)}T00:00:00`, allDay: true, calendar: "Family" },
      { id: "g3", source: "google", title: "Dentista", start: iso(3, 18, 0), end: iso(3, 18, 30), allDay: false },
      { id: "e2", source: "escala", title: "Banco P noite", start: `${ymd(6)}T00:00:00`, end: `${ymd(7)}T00:00:00`, allDay: true, calendar: "Family" },
    ],
    emails: [
      { id: "m1", from: "Coordenação UCIP", subject: "Escala de dezembro: trocas até 28/11", why: "Prazo esta semana para pedir trocas", action: "Confirmar disponibilidade", priority: "alta", link: "#", task: "Pedir trocas da escala de dezembro", due: ymd(4) },
      { id: "m2", from: "Secretariado do congresso", subject: "Submissão de resumos: último aviso", why: "Prazo na sexta", action: "Submeter o resumo", priority: "media", link: "#", task: "Submeter resumo ao congresso", due: ymd(3) },
      { id: "m3", from: "Banco", subject: "Extrato disponível", why: "Informativo", action: "Ver quando der", priority: "baixa", link: "#" },
    ],
    readings: [
      { pmid: "1", title: "Exemplo: oxigenoterapia conservadora em crianças ventiladas", journal: "Pediatr Crit Care Med", design: "Ensaio aleatorizado", summary: "Texto de demonstração. Aqui aparece o resumo em duas frases com o resultado principal.", link: "https://pubmed.ncbi.nlm.nih.gov/" },
      { pmid: "2", title: "Exemplo: fluidos na sépsis pediátrica", journal: "Lancet Child Adolesc Health", design: "Meta-análise", summary: "Texto de demonstração.", link: "https://pubmed.ncbi.nlm.nih.gov/" },
    ],
    toReply: [
      { id: "r1", from: "Secretariado do internato", subject: "Avaliação intercalar: marcar data", days: 4, starred: false, link: "#" },
      { id: "r2", from: "Sofia (colega)", subject: "Troca de banco 12/12?", days: 0, starred: true, link: "#" },
    ],
    tasks: [
      { id: "t1", source: "notion", title: "Slides da sessão clínica", due: ymd(2), priority: "alta" },
      { id: "t2", source: "obsidian", title: "Ler a revisão sobre ventilação não invasiva", priority: "media", context: "Leituras" },
      { id: "t3", source: "notion", title: "Marcar revisão do carro", due: ymd(5), priority: "baixa" },
    ],
    sources: { calendario: "ok", gmail: "ok", notion: "ok", obsidian: "ok", ia: "ok" },
    aiUsed: true,
  };
}

export function demoOutlook(): CalEvent[] {
  return [
    { id: "o1", source: "outlook", title: "Passagem de turno UCIP", start: iso(0, 8, 0), end: iso(0, 8, 45), allDay: false, location: "UCIP" },
    { id: "o2", source: "outlook", title: "Reunião de serviço", start: iso(0, 14, 0), end: iso(0, 15, 30), allDay: false, location: "Sala de reuniões" },
    { id: "f1", source: "google", title: "Banco M - PAMI", start: `${ymd(0)}T00:00:00`, end: `${ymd(1)}T00:00:00`, allDay: true, calendar: "Family" },
    { id: "f2", source: "google", title: "Banco M noite", start: `${ymd(6)}T00:00:00`, end: `${ymd(7)}T00:00:00`, allDay: true, calendar: "Family" },
    { id: "o3", source: "outlook", title: "Formação: simulação", start: iso(3, 9, 0), end: iso(3, 12, 0), allDay: false },
  ];
}
