// Toda a configuração vem de variáveis de ambiente (secrets do GitHub Actions).
// Nunca escrevas valores reais aqui.

const list = (v?: string) =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const TZ = process.env.TZ_NAME ?? "Europe/Lisbon";
export const DAYS_AHEAD = Number(process.env.DAYS_AHEAD ?? 14);

export const config = {
  dryRun: process.env.DRY_RUN === "1",
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    calendarIds: list(process.env.GOOGLE_CALENDAR_IDS ?? "primary"),
    dutyCalendarId: process.env.GOOGLE_DUTY_CALENDAR_ID, // calendário da escala de urgência
    dutyKeywords: list(process.env.DUTY_KEYWORDS ?? "urgência,urgencia,banco,serviço de urgência,SU,noite,prevenção"),
    gmailQuery:
      process.env.GMAIL_QUERY ??
      "newer_than:1d -category:promotions -category:social -category:forums -in:chats",
    gmailMax: Number(process.env.GMAIL_MAX ?? 40),
  },

  notion: {
    token: process.env.NOTION_TOKEN,
    databaseIds: list(process.env.NOTION_TASK_DATABASE_IDS),
    doneValues: list(process.env.NOTION_DONE_VALUES ?? "Done,Concluído,Concluida,Feito,Completed").map((s) => s.toLowerCase()),
  },

  obsidian: {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH, // checkout do repositório do vault
    excludeFolders: list(process.env.OBSIDIAN_EXCLUDE_FOLDERS ?? ".obsidian,.trash,Templates"),
    maxTasks: Number(process.env.OBSIDIAN_MAX_TASKS ?? 80),
  },

  privacy: {
    // Domínios cujo conteúdo nunca vai para a IA (só "email de <domínio>" sem assunto).
    blockedDomains: list(process.env.PRIVACY_BLOCKED_DOMAINS),
    // Pastas do vault / termos que nunca saem (ex.: "Clínica,Doentes").
    blockedFolders: list(process.env.PRIVACY_BLOCKED_FOLDERS),
    extraTerms: list(process.env.PRIVACY_EXTRA_TERMS), // ex.: nomes de serviços com doentes
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ownerUserId: process.env.OWNER_USER_ID,
  },
};
