# Morning Daily Hub

PWA pessoal para iPhone: todas as manhãs um job lê o Gmail, o Google Calendar (inclui a escala de urgência), as tarefas do Notion e do Obsidian, usa a API do Claude para escolher o que importa, e guarda um brief no Supabase. O calendário do hospital (Outlook) chega por um Atalho do iOS. A app abre instantaneamente a partir da cache e atualiza em segundo plano.

```
 05:15  GitHub Actions ──► Gmail + Google Calendar + Notion + vault Obsidian
                           │  filtro de privacidade (job/src/redact.ts)
                           ▼
                        Claude API ──► Supabase: tabela briefs
 06:00  Atalho iOS ──► Calendário do hospital ──► edge function ingest-outlook ──► tabela outlook_events
        PWA (GitHub Pages) ──► login por código ──► lê briefs + outlook_events (RLS: só tu)
```

> Este repositório é **público**. Não contém segredos nem dados pessoais: tudo o que é sensível vive em *Secrets* do GitHub, no Supabase e no repositório privado do vault. Os logs do Actions são públicos, por isso o job só regista estados ("ok"/"erro") e códigos HTTP.

## Pré-visualizar já

`https://possn.github.io/Morning-daily-hub-/?demo` mostra a app com dados fictícios (depois do passo 5).
Localmente: `cd web && npm i && npm run dev` e abre `http://localhost:5173/?demo`.

## Configuração (uma vez)

### 1. Supabase
1. Cria (ou escolhe) um projeto. No SQL Editor corre `supabase/migrations/0001_init.sql`.
2. *Authentication → Users → Add user*: cria o teu utilizador com o teu email. Copia o **User UID**.
3. *Authentication → Sign In / Providers*: desliga **Allow new users to sign up**.
4. *Authentication → Emails → Magic Link*: põe `{{ .Token }}` no corpo do email (a app pede o código de 6 dígitos; links mágicos abrem no Safari e não na PWA instalada).
5. Edge function para o Atalho:
   ```bash
   supabase functions deploy ingest-outlook --no-verify-jwt
   supabase secrets set INGEST_TOKEN=$(openssl rand -hex 32) OWNER_USER_ID=<User UID>
   ```
   Guarda o `INGEST_TOKEN` no teu gestor de passwords: vais precisar dele no Atalho.

### 2. Google (Gmail + Calendar, só leitura)
1. Em console.cloud.google.com cria um projeto, ativa **Gmail API** e **Google Calendar API**.
2. *OAuth consent screen*: tipo External, adiciona-te como utilizador e **publica a app (In production)**. Em modo *Testing* o refresh token expira ao fim de 7 dias. Vais ver um aviso de "app não verificada": é a tua própria app, podes continuar.
3. *Credentials → OAuth client ID → Desktop app*.
4. No teu computador: `cd job && npm i && GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google-auth` e autoriza. O refresh token aparece só no teu terminal.
5. ID do calendário da escala: Google Calendar → definições do calendário → *Integrar calendário* → ID.

### 3. Notion
1. notion.so/profile/integrations → nova integração interna (só leitura de conteúdo).
2. Em cada base de dados de tarefas: `…` → *Connections* → adiciona a integração. O ID é a parte de 32 caracteres do URL.

### 4. Obsidian
O vault sincronizado pelo plugin Obsidian Git tem de estar num **repositório privado separado**. Cria um *fine-grained token* com acesso só a esse repositório e permissão *Contents: Read-only*.

### 5. GitHub deste repositório
*Settings → Pages → Source: GitHub Actions.*

*Settings → Secrets and variables → Actions*:

| Tipo | Nome | Valor |
|---|---|---|
| Secret | `ANTHROPIC_API_KEY` | chave da API do Claude |
| Secret | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | passo 2 |
| Secret | `NOTION_TOKEN` | passo 3 |
| Secret | `OBSIDIAN_REPO_TOKEN` | passo 4 |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (nunca no frontend) |
| Secret | `PRIVACY_EXTRA_TERMS` | opcional: termos a ocultar sempre, separados por vírgulas |
| Variable | `SUPABASE_URL` | `https://<projeto>.supabase.co` |
| Variable | `SUPABASE_ANON_KEY` | chave publishable/anon (pública por desenho) |
| Variable | `OWNER_USER_ID` | User UID do passo 1 |
| Variable | `GOOGLE_CALENDAR_IDS` | ex.: `primary` (separados por vírgulas) |
| Variable | `GOOGLE_DUTY_CALENDAR_ID` | calendário da escala |
| Variable | `NOTION_TASK_DATABASE_IDS` | IDs separados por vírgulas |
| Variable | `OBSIDIAN_REPO` | ex.: `possn/vault` |
| Variable | `PRIVACY_BLOCKED_DOMAINS` | ex.: domínio do email do hospital |
| Variable | `PRIVACY_BLOCKED_FOLDERS` | pastas do vault que nunca saem (ex.: `Clínica,Doentes`) |

Depois: *Actions → Brief da manhã → Run workflow* para testar.

### 6. iPhone
1. Abre o URL do GitHub Pages no Safari → Partilhar → **Adicionar ao ecrã principal**.
2. Configura o Atalho do calendário do hospital: [docs/atalho-outlook.md](docs/atalho-outlook.md).

## Privacidade (RGPD)
- Do Gmail só são lidos **metadados e o excerto** (`format=metadata`); o corpo nunca é descarregado.
- Para a IA vai apenas: remetente, assunto e excerto cortados, títulos de eventos de hoje e amanhã, títulos de tarefas. Tudo passa por `job/src/redact.ts` (nomes após termos clínicos, nº de utente/NIF/processo, datas, idades, telefones, emails).
- Domínios em `PRIVACY_BLOCKED_DOMAINS` e pastas em `PRIVACY_BLOCKED_FOLDERS` **nunca** são enviados.
- O filtro por padrões reduz risco mas **não é anonimização** (RGPD, considerando 26): nomes em texto livre podem escapar. A regra é não guardar dados de doentes nestas fontes.
- Retenção: a função `daily_hub_cleanup()` apaga briefs com mais de 30 dias e eventos do hospital passados há mais de 7.
- O envio do calendário do hospital para o Supabase deve ser compatível com a política de segurança da informação do hospital.

## Notas
- O cron do GitHub corre em UTC (05:15 = 05:15 em Lisboa no inverno, 06:15 no verão) e pode atrasar alguns minutos.
- O GitHub desativa workflows agendados após 60 dias sem atividade no repositório; se acontecer, reativa em *Actions*.
- Modelo: `claude-opus-5-5` (alterável com a variável `CLAUDE_MODEL`). Se a IA falhar, a app mostra na mesma a agenda, os emails não lidos marcados como importantes e as tarefas.
