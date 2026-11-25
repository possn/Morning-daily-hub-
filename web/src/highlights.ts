// Destaques: eventos dos próximos dias que merecem aviso (reuniões, festas, provas, aniversários, feriados, greves).
// Cópia igual em job/src/highlights.ts: mantém as duas iguais.

export type Kind = "greve" | "feriado" | "prova" | "aniversario" | "festa" | "reuniao";

export const ICON: Record<Kind, string> = {
  greve: "⚠️",
  feriado: "🎌",
  prova: "🏃",
  aniversario: "🎂",
  festa: "🎉",
  reuniao: "👥",
};

const BANCO = /^\s*banco\b|urg[eê]ncia|\bSU\b|preven[cç][aã]o/i;

/** Classifica um evento; null quando não é destaque. hospital = calendário do hospital (não pessoal). */
export function classify(title: string, calendar?: string | null, hospital = false): Kind | null {
  const t = title.trim();
  const c = calendar ?? "";
  if (BANCO.test(t)) return null; // os bancos têm aviso próprio
  if (/greve/i.test(t)) return "greve";
  if (/feriad|holiday/i.test(c) || /^feriado$/i.test(t)) return "feriado";
  if (/anivers|birthday/i.test(t) || /anivers|birthday/i.test(c)) return "aniversario";
  if (/dorsal|runners/i.test(c) || /\btrail\b|corrida|\bprova\b|maratona|\bkm\b|🏔|🏃/i.test(t)) return "prova";
  if (/festa|jantar|almo[cç]o|concerto|candlelight|teatro|cinema|espet[aá]culo|casamento|batizado|assembleia|gala|natal/i.test(t)) return "festa";
  if (/reuni|meeting|\bsala\b|departamento|projeto|forma[cç][aã]o|congresso|curso|jornadas|sess[aã]o/i.test(t)) return "reuniao";
  if (hospital) return "reuniao"; // outros eventos do calendário do hospital
  return null;
}

export type HEvent = { title: string; start: string; allDay: boolean; calendar?: string | null; date: string; hospital?: boolean };
export type Highlight = HEvent & { kind: Kind };

/**
 * Escolhe os destaques. Títulos que se repetem na janela (atividades semanais como natação ou inglês)
 * não contam; feriados repetidos em vários calendários aparecem uma vez por dia.
 */
export function pickHighlights(events: HEvent[]): Highlight[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const count = new Map<string, number>();
  for (const e of events) count.set(norm(e.title), (count.get(norm(e.title)) ?? 0) + 1);
  const out: Highlight[] = [];
  const holidayDays = new Set<string>();
  for (const e of events) {
    const kind = classify(e.title, e.calendar, e.hospital);
    if (!kind) continue;
    if (kind === "feriado") {
      if (holidayDays.has(e.date)) continue;
      holidayDays.add(e.date);
      // Prefere o nome do feriado ao genérico "FERIADO".
      const named = events.find((x) => x.date === e.date && classify(x.title, x.calendar, x.hospital) === "feriado" && !/^feriado$/i.test(x.title.trim()));
      out.push({ ...(named ?? e), kind });
      continue;
    }
    if (kind !== "greve" && (count.get(norm(e.title)) ?? 0) > 1) continue;
    out.push({ ...e, kind });
  }
  return out.sort((a, b) => (a.date === b.date ? (a.allDay ? -1 : b.allDay ? 1 : a.start.localeCompare(b.start)) : a.date.localeCompare(b.date)));
}
