# Atalho iOS: calendários do iPhone → Daily Hub (+ notificação da manhã)

Uma PWA não pode ler o calendário do iPhone (o EventKit só existe para apps nativas), por isso é o Atalho que lê os calendários e os envia.
Envia dois calendários:
- **Outlook do hospital** (reuniões, formações…), que aparece na app como *Hospital*;
- **Família** (iCloud), onde está a escala. Os eventos "Banco…", "Urgência", "SU" e "Prevenção" passam a contar como **turnos de urgência**, e o resto aparece como *Pessoal*.

Quando o Atalho corre de manhã, a função envia também a **notificação da manhã** para o iPhone (uma por dia).

## Antes de começar
1. O calendário do hospital tem de aparecer na app **Calendário** do iPhone. Para isso, adiciona a conta Exchange/Microsoft 365 em *Definições → Calendário → Contas*, ou, no Outlook para iOS, ativa *Definições → (conta) → Guardar calendários*.
2. **Token**: no Supabase abre *Table Editor → app_config* e copia o valor da linha `ingest_token`.
   (https://supabase.com/dashboard/project/ejtpmwhyoekgcosuwilq/editor)
3. **URL da função**: `https://ejtpmwhyoekgcosuwilq.supabase.co/functions/v1/ingest-outlook`
4. Na app Daily Hub (instalada no ecrã principal), carrega em **🔔 Ativar notificação da manhã** no fundo da página.

## Criar o atalho "Daily Hub"
App **Atalhos → +**, e adiciona por esta ordem:

1. **Data** (Data atual) e depois **Ajustar data**: *Adicionar* `14` *dias* a *Data*. Fica com o nome *Data ajustada*.
2. **Procurar Eventos de Calendário**, com *Todos os seguintes são verdadeiros*:
   - *Calendário* é → o calendário do **hospital**
   - *Data de fim* está depois de → *Data* (do passo 1)
   - *Data de início* está antes de → *Data ajustada*
   - Sem limite
3. **Adicionar à variável** → nome `Lista`.
4. Repete os passos 2 e 3, mas com *Calendário* é → **Família**.
5. **Repetir com cada** item em `Lista`. Lá dentro:
   - **Dicionário** com estas chaves (todas do tipo Texto):
     - `title` → *Item repetido* › Título
     - `start` → *Item repetido* › Data de início, formato **ISO 8601** com hora
     - `end` → *Item repetido* › Data de fim, formato **ISO 8601** com hora
     - `allDay` → *Item repetido* › É evento de dia inteiro
     - `location` → *Item repetido* › Localização
     - `calendar` → *Item repetido* › Calendário
   - **Adicionar à variável** → nome `Eventos`
6. **Obter conteúdo do URL**
   - URL: o URL da função
   - Método: **POST**
   - Cabeçalhos: `Authorization` = `Bearer ` seguido do token (com um espaço depois de Bearer)
   - Corpo do pedido: **JSON**, com o campo `events` = variável `Eventos`

Corre uma vez à mão. A resposta deve ser `{"ok":true,"received":N,"stored":N,"push":{"sent":1}}`, e a notificação aparece no iPhone.
Para voltares a testar a notificação no mesmo dia, adiciona ao JSON o campo `notify` = `force` (depois tira-o).

## Automatizar
*Atalhos → Automação → + → Hora do dia* → a hora a que queres a notificação (por exemplo 07:00), *Diariamente* → **Executar imediatamente** (sem confirmação) → escolhe o atalho.
Opcional: uma segunda automação ao fim da tarde para apanhar alterações. Não manda segunda notificação.

Cada envio substitui os eventos dos próximos 14 dias, por isso eventos cancelados ou mudados desaparecem da app.
