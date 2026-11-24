# Atalho iOS: calendário do hospital → Daily Hub

Uma PWA não pode ler o calendário do iPhone (o EventKit só existe para apps nativas), por isso é o Atalho que lê o calendário e envia os eventos.

## Antes de começar
O calendário do hospital tem de aparecer na app **Calendário** do iPhone:
- conta Exchange/Microsoft 365 adicionada em *Definições → Calendário → Contas*, **ou**
- no Outlook para iOS: *Definições → (conta) → Guardar calendários* ativado (algumas políticas do hospital bloqueiam isto).

Precisas também do URL da função (`https://<projeto>.supabase.co/functions/v1/ingest-outlook`) e do `INGEST_TOKEN`.

## Criar o atalho "Enviar agenda do hospital"
App **Atalhos → +**, e adiciona por esta ordem:

1. **Procurar Eventos de Calendário**
   - *Calendário* é → escolhe o calendário do hospital
   - *Data de início* está nos próximos → `14` dias
   - Ordenar por *Data de início*, sem limite
2. **Repetir com cada** (item em *Eventos do calendário*)
   - **Dicionário** com estas chaves (todas do tipo Texto):
     - `title` → *Item repetido* › Título
     - `start` → *Item repetido* › Data de início, formato **ISO 8601** com hora
     - `end` → *Item repetido* › Data de fim, formato **ISO 8601** com hora
     - `allDay` → *Item repetido* › É evento de dia inteiro
     - `location` → *Item repetido* › Localização
   - **Adicionar à variável** → nome `Eventos`
3. **Obter conteúdo do URL**
   - URL: o URL da função
   - Método: **POST**
   - Cabeçalhos: `Authorization` = `Bearer <INGEST_TOKEN>`
   - Corpo do pedido: **JSON**, com o campo `events` = variável `Eventos`

Corre uma vez à mão: a resposta deve ser `{"ok":true,"received":N,"stored":N}`.

## Automatizar
*Atalhos → Automação → + → Hora do dia* → 06:00, *Diariamente* → **Executar imediatamente** (sem confirmação) → escolhe o atalho.
Opcional: uma segunda automação ao fim da tarde, para apanhar reuniões marcadas durante o dia.

Cada envio substitui os eventos dos próximos 14 dias, por isso reuniões canceladas ou mudadas desaparecem da app.
