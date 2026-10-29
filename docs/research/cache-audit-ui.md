# Auditoria UI/IPC — cache hit em tempo real no medidor de contexto

> Escopo: renderer React 19 + IPC Tauri 2 do Lumina. Trabalho **somente leitura**; nenhum
> arquivo de código foi alterado. Evidências no formato `arquivo:linha` referem-se ao
> worktree em 29/10/2026 (há mudanças não commitadas em `MessageItem.tsx`, `utils.ts`,
> `docs/DESIGN.md` — os números de linha consideram o conteúdo atual, não o HEAD).
>
> Objetivo do plano do Lead: elevar o prompt cache hit para 98–99% em todos os provedores.
> Requisito explícito do usuário: **o elemento de monitoramento de contexto deve mostrar,
> em tempo real, o cache hit em %**.

---

## 0. Sumário executivo

1. Existe **um único** elemento de monitoramento de contexto: `ContextMeter` (anel + `%` +
   popover), montado **apenas no layout Code** no cabeçalho da sessão
   (`src/components/agent/ContextMeter.tsx:141-227`; `CodeSessionHeader.tsx:547-550`;
   `CodeAgentWidgets.tsx:175-184`). No layout Chat **não existe medidor de contexto**;
   só há tokens por mensagem no rodapé do assistente (`MessageItem.tsx:330-339`,
   condicionado a `showTokenUsage`).
2. O medidor é alimentado exclusivamente pelo evento `context_stats`, emitido **somente no
   perfil Code** e em quatro momentos (`src-tauri/src/harness/mod.rs:1100-1110`,
   `1215-1231`, `1319-1326`, `1728-1735`). Ele carrega **estimativa de tokens de contexto**,
   não uso de cache.
3. O uso de cache **já chega ao renderer**, mas só no **fim do turno**: `TurnEvent::Usage`
   é emitido uma única vez (`harness/mod.rs:1663-1668`), depois de agregar os passos
   (`merge_usage`, `harness/mod.rs:2531-2542`). O dado por passo existe dentro do harness
   (`StepAttempt.usage`, `harness/mod.rs:499-505` + captura em `harness/mod.rs:594`) e é
   descartado — nenhum evento o publica.
4. `UsageInfo.cachedTokens` existe nos contratos TS (`src/lib/types.ts:558`) e Rust
   (`src-tauri/src/domain.rs:185`) e **nunca é renderizado** em lugar nenhum do app
   (grep: só a declaração de tipo). Também não há separação cache **read** × **write** ×
   **uncached**: o adapter Anthropic lê só `cache_read_input_tokens` e descarta
   `cache_creation_input_tokens` (`src-tauri/src/providers/anthropic.rs:436`);
   OpenAI lê `prompt_tokens_details.cached_tokens` (`openai_chat.rs:365`,
   `openai_responses.rs:568`), que é um subconjunto de `prompt_tokens`.
5. Lacuna central de UI: **não existe spec nem microcopy para cache**. `docs/DESIGN.md:79`
   descreve o medidor (contexto), `DESIGN.md:104-107` descreve o rodapé da mensagem
   (tokens totais). Os tokens de design (`src/styles/globals.css:35-38`, `69-72`,
   `103-105`) cobrem contexto (`context-system/tools/messages`) e estados
   (`success/warning/danger`), suficiente para o indicador — com uma ressalva de contraste
   no tema claro (§4.4).
6. Risco já visível para a meta de 98–99%: o system prompt do perfil Code inclui um
   **timestamp com precisão de minuto** (`harness/mod.rs:1005`), portanto o prefixo muda a
   cada novo turno → o cache quebra no primeiro request de cada turno. O indicador
   proposto deve ser capaz de **apontar isso como motivo de queda** (categoria `prompt`).

---

## 1. Onde o contexto é monitorado hoje

### 1.1 Layout Code — o medidor existe e está completo (sem cache)

| Peça | Arquivo:linha | Comportamento atual |
| --- | --- | --- |
| Componente | `src/components/agent/ContextMeter.tsx:108-230` | Chip (`button` dentro de `PopoverTrigger`) + popover com breakdown |
| Chip | `ContextMeter.tsx:141-159` | `h-8`, `min-w-[4.25rem]`, anel SVG 16px + `{percent}%`; `aria-label="Contexto usado: {percent}%"`; tier `ok/warning/critical` altera cor do anel e borda (`border-danger/40` em crítico) |
| Anel | `ContextMeter.tsx:62-90` | Dois `circle` (trilho `text-surface-active` + arco com `strokeDashoffset` animado 300ms, `motion-reduce:transition-none`) |
| Popover | `ContextMeter.tsx:160-227` | `role="dialog"` (Radix), `aria-label="Detalhes do contexto"`, `w-72`; header `X% do contexto usado` + `~usado / janela`; barra segmentada com `role="progressbar"` (`171-198`); legenda das 3 partes (`200-216`); rodapé com limite de saída e nota de compactação (`218-225`) |
| Tiers | `ContextMeter.tsx:21-37` | `>=90` compactando / `>=70` atenção / resto ok; percentual clampado (`33-37`) |
| Container Code | `src/components/code/CodeAgentWidgets.tsx:175-184` | `CodeContextMeterChip` lê `useCodeStore(state.byConversation[conversationId].context)` e renderiza `<div className="hidden lg:block"><ContextMeter /></div>` |
| Posição no header | `src/components/code/CodeSessionHeader.tsx:547-550` | Grupo `ml-auto` à direita, antes do botão do painel; linha 1 do header tem `h-11` (`519`) |
| Export público | `src/components/agent/index.ts:31-32` | `export { ContextMeter }` + `ContextMeterProps` |
| Spec | `docs/goals/code-harness/WORKBENCH.md:78-95` e `docs/goals/code-harness/HARNESS.md:466-489` | Medidor "em tempo real" = `context_stats` por passo; popover com breakdown, limite de saída e nota de compactação |
| Spec de design | `docs/DESIGN.md:79` | "medidor de contexto em tempo real (chip com anel de progresso e `role="progressbar"`; o clique abre um popover…)" — na prática o `role="progressbar"` está na barra **dentro** do popover (`ContextMeter.tsx:171-177`), não no chip; corrigir a redação ao atualizar a spec |

Observação de acessibilidade/alcance: `CodeAgentWidgets.tsx:180` esconde o medidor abaixo de
1024px (`hidden lg:block`). Para o requisito "em tempo real", o indicador **não pode
desaparecer** em janela compacta — ver §4.6.

### 1.2 Layout Chat — não existe medidor de contexto

- `src/components/layout/WorkspaceCenter.tsx:49-71`: o centro é a **mesma** `ChatView` nos
  dois layouts. O header só é renderizado no Code (`{isCode ? <CodeSessionHeader /> : null}`,
  linha 61) e o wrapper fica `hidden` quando não é Code (`57-59`). O layout Chat **não tem
  header próprio** — a title bar global é `src/components/layout/TitleBar.tsx:104-188`
  (marca, seletor Chat|Code, plano ChatGPT, busca, controles da janela; altura 56px).
- `src/components/chat/ChatView.tsx:157-202`: coluna de mensagens (`max-w-3xl`, linha 171)
  + banner de erro + `Composer` sticky no rodapé (183-202). Nenhum indicador de sessão.
- `src/components/chat/MessageItem.tsx:170` lê `settings.showTokenUsage`;
  `193-197` calcula `totalTokens = usage.totalTokens ?? input + output`; `330-339` mostra
  `"{N} tokens"` (e `durationMs`) no rodapé do hover. Esse é o **único** uso de `UsageInfo`
  na UI. Não mostra cache, não é por passo, não é agregado da sessão.
- `src/components/settings/GeneralTab.tsx:100-109` + `src/lib/store/appStore.ts:41` +
  `src/lib/types.ts:885`: `showTokenUsage` (padrão `true`) só controla o rodapé da mensagem.
- `src/components/composer/Composer.tsx:647-709`: fileira de ferramentas do composer —
  esquerda: anexar + `Busca web`/`Criar arquivos` (Chat) ou `CodeSessionControls` (Code,
  `658-659`); direita (`ml-auto`, `677`): `ModelPill` (`678`) + enviar/parar (`680-709`).
  **É o único lugar persistente e sempre visível do layout Chat** — ponto natural para o
  chip (ver §4.2).

### 1.3 Resumo das superfícies atuais

| Superfície | Arquivo:linha | Já existe | Falta para o requisito |
| --- | --- | --- | --- |
| Chip do medidor (Code) | `ContextMeter.tsx:141-159` | anel + `%` de contexto | `%` de cache, estado, descrição acessível |
| Popover (Code) | `ContextMeter.tsx:160-227` | breakdown, limite de saída, compactação | seção de cache + diagnóstico de queda |
| Container Code | `CodeAgentWidgets.tsx:175-184` | lê contexto do `codeStore` | ler cache do novo store; visibilidade <1024px |
| Header Code | `CodeSessionHeader.tsx:547-550` | posição estável no `ml-auto` | nada (sem mudança de posição) |
| Chat (transcript) | `MessageItem.tsx:330-339` | tokens totais por mensagem (setting) | medidor de sessão/cache |
| Chat (composer) | `Composer.tsx:647-678` | fileira de controles | montar o chip |
| Title bar | `TitleBar.tsx:143-186` | chip global "Plano ChatGPT" | **não** é o lugar (é account-level, não de sessão) |
| Settings | `GeneralTab.tsx:100-109` | `showTokenUsage` | decisão: **não** criar setting novo (§4.9) |

---

## 2. Fluxo de dados (IPC) e o que o backend emite hoje

### 2.1 Contratos TypeScript

| Contrato | Arquivo:linha | Campos |
| --- | --- | --- |
| `ContextBreakdown` | `src/lib/types.ts:335-340` | `systemPrompt`, `toolDefinitions`, `messages` |
| `ContextStats` | `types.ts:342-352` | `used`, `window`, `outputCap`, `percent`, `compacted?`, `messages?`, `breakdown?` (ausente em payloads antigos) |
| `CodeSessionState` | `types.ts:397-411` | inclui `context?: ContextStats \| null` (406) — snapshot do Code |
| `UsageInfo` | `types.ts:554-562` | `inputTokens`, `outputTokens`, `reasoningTokens`, **`cachedTokens`**, `totalTokens`, `cost`, `durationMs` — todos opcionais/null |
| `TurnEvent` | `types.ts:664-701` | `usage` (682), `context_stats` (696), `compacted` (697); não há evento de cache |
| `Settings` | `types.ts:874-925` | `showTokenUsage` (885) |

`cachedTokens` não tem nenhum consumidor na UI (grep em `src/` retorna só `types.ts:558`).

### 2.2 Stores

- `chatStore` — `src/lib/store/chatStore.ts`:
  - `handleEvent` (`390-393`): encaminha **todos** os eventos "de código" ao `codeStore` via
    `isCodeEvent`; depois trata os eventos de streaming no `switch` (`394-557`).
  - `case 'usage'` (`502-507`): faz merge raso no `usage` da mensagem do assistente
    (`{ ...(message.usage ?? {}), ...event.usage }`). Um `usage` por passo **quebraria** o
    rodapé (mostraria só o último passo) — por isso o indicador de cache **não pode reutilizar**
    o evento `usage` (ver §5.1).
  - `openConversation` (`708-749`): busca `api.getConversation` (`731`) e grava
    `detail.messages` em `messagesByConversation` (`733-737`) — **ponto de seed** do
    agregado de cache ao reabrir a sessão.
  - Terminal do turno: `done` (`521-526`), `cancelled` (`527-537`), `error` (`538-554`),
    todos com `useCodeStore.getState().refresh(...)`.
- `codeStore` — `src/lib/store/codeStore.ts`:
  - `CodeSessionUi.context: ContextStats | null` (`38`), `emptyCodeSession` (`52-69`).
  - `applyCodeEvent` (`102-176`): `context_stats` → `{ ...state, context: event.stats }`
    (`144-145`); `compacted` (`146-160`) ajusta `compacted` e subtrai `tokensFreed`.
  - `isCodeEvent` (`179-197`): inclui `context_stats` (`187`) e `compacted` (`188`).
  - `fromSnapshot` (`200-220`): `context: snapshot.context ?? null` (`210`); `load`
    (`267-286`) chama `api.getCodeSessionState` (`270`).
- `chatStore.syncCodeSession` (`307-312`) só chama `codeStore.load` para sessões
  `mode === 'code'` ou `codeLinked` — **sessões puras de Chat nunca carregam snapshot de
  contexto**.
- `appStore` (`src/lib/store/appStore.ts:30-54`) traz os defaults (inclui
  `showTokenUsage: true`).

### 2.3 O que o backend emite hoje (confirmação no Rust)

- `events.rs:112-115` — `TurnEvent::ContextStats { stats }`.
- `events.rs:51-52` — comentário explícito do `Usage`: *"Token usage for the turn (may be
  emitted once at the end)"*.
- Emissão de `context_stats` (só perfil Code):
  - início do turno: `harness/mod.rs:1095-1110` (guard `if profile == TurnProfile::Code`,
    `1100`; `emit_context_stats` persiste + emite, `753-764`);
  - antes de cada passo: `harness/mod.rs:1211-1231` (guard `1215`);
  - calibrado pelo uso real do passo: `harness/mod.rs:1305-1327` (usa
    `step_usage.input_tokens`; `emit_context_stats` em `1319-1326`);
  - fecho do turno: `harness/mod.rs:1718-1735` (guard `1719`).
- Uso por passo **existe e é descartado**: `StepAttempt.usage` (`harness/mod.rs:499-505`),
  preenchido em `run_stream_attempt` (`harness/mod.rs:594`,
  `ProviderEvent::Usage(usage) => attempt.usage = Some(usage)`), consumido em
  `harness/mod.rs:1305-1310` (só para calibrar contexto e somar no `total_usage`) e no passo
  final forçado (`harness/mod.rs:1531-1554`).
- Emissão de `usage` (uma vez, no fecho, qualquer perfil): `harness/mod.rs:1663-1668`;
  o agregado do turno também vai em `assistant_message.usage` (`harness/mod.rs:1646`) e em
  `TurnResult.usage` (`harness/mod.rs:1708-1716`).
- `merge_usage` soma `cached_tokens` entre passos (`harness/mod.rs:2531-2542`, cache em
  `2535`), mas não distingue read/write/uncached.
- Normalização por provedor (hoje incompleta):
  - `providers/mod.rs:744-764` — `make_usage` só repassa `cached`;
  - `providers/anthropic.rs:425-439` — `cache_read_input_tokens` → `cached_tokens`
    (`436`); `cache_creation_input_tokens` **é ignorado**;
  - `providers/openai_chat.rs:360-369` — `prompt_tokens_details.cached_tokens`
    (fallback `cache_read_input_tokens`);
  - `providers/openai_responses.rs:564-571` — `input_tokens_details.cached_tokens`.

### 2.4 Persistência e restauração hoje

| O quê | Onde | Estado |
| --- | --- | --- |
| Snapshot do medidor Code | `code_events` via `emit_context_stats` → `code::session::save_context_stats` (`harness/code/session.rs:396-404`); leitura em `context_stats` (`session.rs:377-382`) e `commands/code.rs:96-98`; devolvido em `CodeSessionState.context` (`domain.rs:1378-1379`) | funciona só no perfil Code |
| Usage por mensagem | `ChatMessage.usage` serializado em JSON (`src-tauri/src/db.rs:839-849`, decodificado em `783`) | persiste `cachedTokens` (quando reportado) por turno |
| Registro agregado | tabela `usage_log` (`db.rs:131-144`, escrita em `db.rs:2161-2191`) | tem coluna `cached_tokens` (140), sem read/write/uncached normalizados |
| Restauração no Chat | — | **não existe**: nenhuma leitura de contexto/cache ao abrir sessão de Chat |
| Histórico de fim de turno Code | `turn/ended` com `usage` (`harness/mod.rs:1743-1751`) | disponível no `code_events`, não consultado pela UI |

### 2.5 Fluxo atual, ponta a ponta

```
turno (qualquer perfil)
  └─ provider responde → ProviderEvent::Usage → StepAttempt.usage        (descartado, exceto soma)
       └─ (Code) context_stats estimado/calibrado → TurnEvent::ContextStats
            └─ chatStore.handleEvent:393 → codeStore.applyCodeEvent:144
                 └─ ContextMeter (CodeSessionHeader:549) — anel/percentual de CONTEXTO
  └─ fim do turno → TurnEvent::Usage (agregado) → chatStore:502
       └─ message.usage → MessageItem:193-197/330-339 (tokens totais, se showTokenUsage)
```

---

## 3. Lacunas de dados para o indicador em tempo real

### L1 — Não existe evento de cache por passo (bloqueia "tempo real")

`usage` chega **só no fim do turno** (`harness/mod.rs:1663-1668`). O `%` de cache precisa ser
publicado **logo após cada resposta do provedor** (é o único instante em que o número existe).
O gancho já está pronto: `harness/mod.rs:1305-1327` (onde o `step_usage` é lido e o
`context_stats` calibrado é emitido) e `harness/mod.rs:1546-1554` (passo final forçado).
Amostra mínima por passo:

- tokens de entrada do request;
- tokens **lidos do cache** (hit), **gravados no cache** (write) e **sem cache** (miss);
- `%` de hit = `read / (read + write + uncached)` (definição precisa ser única — ver §5.3);
- número do passo, instante da amostra, provedor/modelo;
- fatos para diagnóstico: o que mudou no prefixo desde a amostra anterior e se houve
  compactação (§3.2);
- flag `reported`: provedor que não informa detalhes → `%` desconhecido (nunca `0%`).

### L2 — Não há separação read / write / uncached (bloqueia "%" correto)

`UsageInfo` só tem `cachedTokens` (`types.ts:558`, `domain.rs:185`), cuja semântica **muda por
provedor**: Anthropic devolve `input_tokens` **sem** cache e os campos
`cache_read_input_tokens` / `cache_creation_input_tokens` **separados** (o adapter lê só o
read: `anthropic.rs:436`); OpenAI/Responses devolvem `prompt_tokens` **incluindo** o cache
(`openai_chat.rs:365`, `openai_responses.rs:568`). Sem normalização no backend, o renderer
não consegue calcular um `%` honesto e portátil. Campos necessários:

```ts
// normalizado no Rust, por request
interface CacheUsage {
  reported: boolean;            // o provedor informou detalhes?
  readTokens: number;           // lido do cache
  writeTokens: number;          // gravado no cache (cache explícito; 0 nos automáticos)
  uncachedInputTokens: number;  // entrada cobrada cheia (miss)
  totalInputTokens: number;     // read + write + uncached
}
```

### L3 — Não há diagnóstico da queda (bloqueia "motivo")

O renderer sozinho não sabe *por que* o prefixo mudou. Fatos necessários do backend, por
amostra (comparando com o request anterior da conversa):

```ts
interface CachePrefixChange {
  systemPrompt: boolean;   // hash do system prompt mudou
  toolDefinitions: boolean;// hash do JSON Schema das tools mudou
  model: boolean;          // modelo/protocolo wire mudou
  history: boolean;        // histórico deixou de ser um append do request anterior
}
// + `compacted: boolean` (compactação entre as duas amostras)
```

Isso habilita a taxonomia de motivo (prompt/tools/histórico/compactação/modelo) sem heurística
frágil na UI. **Causa provável já presente no código**: timestamp de minuto no system prompt
do Code (`harness/mod.rs:1005`) → `systemPrompt: true` a cada novo turno; o indicador vai
expor isso (e o plano precisa corrigir para chegar a 98–99%).

### L4 — Sessão não tem acumulado nem restauração

Falta:

- **acumulado da sessão**: soma de read/write/uncached/entrada de todos os passos (e de turnos
  anteriores). Pode ser reconstruído no renderer a partir de `ChatMessage.usage` (já
  persistido, `db.rs:783/839-849`) **se** `UsageInfo.cache` for adicionado — sem migração de
  banco;
- **restauração ao reabrir**: `chatStore.openConversation` (`chatStore.ts:708-749`) carrega as
  mensagens mas não deriva nada disso; sessões de Chat nunca chamam `codeStore.load`
  (`syncCodeSession`, `chatStore.ts:307-312`);
- **estado inicial honesto** quando não há amostras (ver §4.8).

### L5 — Cadência / honestidade do "tempo real"

O `%` de um passo só é conhecido **depois** de o provedor responder. Durante um passo em
andamento, a UI deve mostrar a última amostra + "aguardando próximo passo", nunca um número
inventado. O turno pode ter vários passos (ferramentas): cada passo gera uma nova amostra
(evento novo). Antes do primeiro `usage` do primeiro passo, o chip fica em `—`.

### L6 — Nenhuma superfície de UI para cache

Nenhum lugar exibe `cachedTokens` (grep §2.1). O `ContextMeter` não aceita dados de cache, o
popover não tem seção, não há microcopy pt-BR, não há tokens de cor/estado para cache (só
contexto e semânticos) e não há testes. Além disso o chip é escondido abaixo de 1024px
(`CodeAgentWidgets.tsx:180`) — incompatível com "em tempo real" em janela compacta.

### L7 — Layout Chat sem ponto de montagem

Não há header de sessão no Chat (`WorkspaceCenter.tsx:49-71`) e o TitleBar é global/account
level (`TitleBar.tsx:143-186`). O único lugar permanente é a fileira do composer
(`Composer.tsx:647-678`). Para o Chat ter `%` de contexto (e não só de cache) seria preciso
emitir `context_stats` também no perfil Chat — hoje o guard é `profile == TurnProfile::Code`
em `harness/mod.rs:1100`, `1215` e `1719`.

### L8 — Payloads antigos

`ContextStats` já convive com campos opcionais (`breakdown?`, `types.ts:350-351`;
`#[serde(default)]` em `domain.rs:1329-1335`). O mesmo tratamento é obrigatório para
`cache`/`CacheSample` (`#[serde(default)]`), e a UI deve degradar para `—` sem erro — há teste
explícito disso hoje (`ContextMeter.test.tsx:176-191`).

---

## 4. Especificação visual/UX

### 4.1 Princípio: **um** elemento, não um chip novo

O requisito diz que **o elemento de monitoramento de contexto** deve mostrar o cache. Então o
cache entra **dentro do `ContextMeter`** (mesmo chip, mesmo popover), e não como chip
separado. Consequência: uma única affordance, um único `aria-label`, um único popover — e o
`ContextMeter` passa a ser compartilhado entre Code (header) e Chat (composer).

Contrato de props proposto (`src/components/agent/ContextMeter.tsx`):

```ts
export interface ContextMeterProps {
  /** Estimativa do contexto. Hoje só chega no perfil Code; no Chat pode ser null. */
  stats?: ContextStats | null;
  /** Cache de prompt medido: última amostra, acumulado e estado derivado. */
  cache?: CacheStats | null;
  /** Mensagens resumidas na última compactação (quando o host souber). */
  compacted?: number | null;
  /** Onde o chip vive: header abre popover para baixo; composer para cima. */
  placement?: 'header' | 'composer';
  className?: string;
}
```

`CacheStats` (estado de UI, derivado no renderer — ver §4.4 e §5.1):

```ts
type CacheState = 'unknown' | 'warming' | 'stable' | 'dropped';
type CacheDropReason =
  | 'prompt' | 'tools' | 'history' | 'compaction' | 'model' | 'unknown';

interface CacheSession {
  readTokens: number;
  writeTokens: number;
  uncachedInputTokens: number;
  totalInputTokens: number;
  samples: number;
  hitPercent: number | null;
}

interface CacheStats {
  latest: CacheSample | null;          // última amostra recebida
  session: CacheSession;               // acumulado (base persistida + turno em curso)
  state: CacheState;
  reason: CacheDropReason | null;      // só quando state === 'dropped'
  previousHitPercent: number | null;   // para "caiu de X% para Y%"
  lastDrop: { from: number; to: number; at: number; step: number | null } | null;
}
```

### 4.2 Onde o indicador vive em cada layout

**Code (existente):** `CodeContextMeterChip` continua exatamente no mesmo lugar
(`CodeSessionHeader.tsx:547-550`), agora lendo também o cache:

```tsx
// src/components/code/CodeAgentWidgets.tsx:175-184 (novo corpo)
export function CodeContextMeterChip({ conversationId }: { conversationId: string }) {
  const stats = useCodeStore((state) => state.byConversation[conversationId]?.context);
  const cache = useCacheStore((state) => state.byConversation[conversationId] ?? null);
  if (!stats && !cache) return null;
  return (
    <div className="hidden sm:block">   {/* era hidden lg:block */}
      <ContextMeter stats={stats} cache={cache} />
    </div>
  );
}
```

**Chat (novo):** chip na fileira de controles do composer, imediatamente **antes** do
`ModelPill`, no grupo `ml-auto` (`Composer.tsx:677-678`). Container novo em
`src/components/composer/` (área ui-core), montado só quando existe conversa ativa
(`activeConversationId`, `Composer.tsx:76`):

```tsx
// src/components/composer/CacheMeterChip.tsx
export function CacheMeterChip({ conversationId }: { conversationId: string }) {
  const cache = useCacheStore((s) => s.byConversation[conversationId] ?? null);
  const context = useCodeStore((s) => s.byConversation[conversationId]?.context ?? null);
  if (!cache && !context) return null;
  return <ContextMeter stats={context} cache={cache} placement="composer" />;
}
```

Por que o composer e não um header novo: `docs/DESIGN.md:69-73` define o Chat como a coluna
central `max-w-3xl` **sem header próprio**; criar uma faixa nova muda o chrome dos dois
layouts (`WorkspaceCenter`). O composer já é o lugar dos controles de sessão no Code
(`DESIGN.md:131-132`) — manter o padrão é menos invasivo. *Alternativa* (não recomendada no
v1): renderizar o chip num header novo do Chat em `WorkspaceCenter.tsx:56-62`; custa mudança
de DESIGN e ~36–44px de altura fixa.

### 4.3 Chip: anel de contexto + `%` de contexto + `%` de cache (Code) / cache-first (Chat)

Estrutura do chip (substitui `ContextMeter.tsx:141-159`):

```tsx
<button
  type="button"
  aria-label={stats ? `Contexto usado: ${percent}%` : `Cache de prompt: ${cacheLabel}`}
  aria-describedby={cacheDescriptionId}      // sr-only com o estado do cache
  className={cn(
    'flex h-8 min-w-[7rem] shrink-0 items-center justify-center gap-1.5 rounded-full border px-2',
    'text-[11px] font-medium tabular-nums text-foreground-muted',
    'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
    tier.key === 'critical' ? 'border-danger/40' : 'border-border',
    className,
  )}
>
  {stats ? (
    <>
      <ContextRing percent={percent} tier={tier} />
      <span className="tabular-nums">{percent}%</span>
    </>
  ) : null}
  <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
  <span aria-hidden className="flex w-11 shrink-0 items-center justify-end gap-0.5 tabular-nums">
    <Zap className="size-3 shrink-0" strokeWidth={2} />
    <span>{cacheLabel}</span>   {/* "98%" | "—" */}
  </span>
</button>
```

Regras:

- altura **sempre** `h-8` e largura mínima reservada (`min-w-[7rem]`) → o chip não muda de
  tamanho quando o cache sai de `—` para `98%` (sem layout shift no header);
- segmento do cache com largura fixa (`w-11`, 44px) e `justify-end` → `0%`, `98%`, `100%` e
  `—` não deslocam o anel;
- `tabular-nums` em todos os números (`font-variant-numeric`);
- ícone `Zap` (lucide, 12px, stroke 2) é decorativo (`aria-hidden`); a cor do ícone comunica o
  tom (gráfico ≥3:1) e o texto do estado fica no popover/descrição (nunca cor como único sinal);
- `—` (U+2014) para "sem dados", `text-foreground-subtle`; nunca `0%` quando o provedor não
  reporta;
- no Chat sem `stats` (contexto ainda não emitido no perfil Chat), o chip vira cache-first:
  `min-w-[4.5rem]`, sem anel e sem divisor (o divisor só aparece quando há os dois valores);
- **visibilidade**: remover `hidden lg:block` do container Code (`CodeAgentWidgets.tsx:180`).
  Em janelas estreitas o chip encolhe (Chat: `min-w-[4.5rem]`) em vez de sumir — o requisito é
  "mostrar em tempo real".

### 4.4 Popover: seção "Cache de prompt" + diagnóstico

Inserir **depois** da legenda do breakdown e **antes** do rodapé de limite/compactação
(`ContextMeter.tsx:200-225`), separado por `border-t border-border pt-2`:

```
Contexto                 [seção existente, 160-216]
──────────────────────────────────────────────
Cache de prompt                    98% de acerto
[━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]   ← barra (role=progressbar)
Lido do cache                           240K
Gravado no cache                          —
Sem cache                                 4K
Acumulado da sessão            97% em 12 passos
Estado                                     ● Estável
Última amostra                     passo 4 · agora
Acerto = tokens lidos do cache ÷ tokens de entrada do passo.
```

Comportamento por estado (textos exatos em §4.7):

| Estado | Linha "Estado" | Nota `role="status"` |
| --- | --- | --- |
| `unknown` (sem amostra) | `● Sem dados` | `Sem amostras ainda. O acerto de cache aparece depois do primeiro passo.` |
| `unknown` (provedor não reporta) | `● Sem dados` | `Este provedor não informa detalhes de cache nesta execução.` |
| `warming` | `● Aquecendo` | `Aquecendo o cache: o primeiro request grava o prefixo e o acerto aparece no próximo passo.` |
| `stable` | `● Estável` | — (só a linha de estado; sem nota) |
| `dropped` | `● Caiu` | `Cache caiu de 98% para 41% neste passo.` + `Motivo: o prompt de sistema mudou.` |

Detalhes de implementação:

- barra hand-rolled como a do contexto (`ContextMeter.tsx:171-198`), com
  `role="progressbar"`, `aria-label="Acerto do cache de prompt"`,
  `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-valuenow={hit}`, `aria-valuetext="{hit}% de acerto no cache"`,
  `h-1.5 rounded-full bg-surface-active`, preenchimento `bg-success`/`bg-warning`/`bg-danger`
  com `width` animada 300ms `ease-out` e `motion-reduce:transition-none`;
- números de cache **não levam `~`** (são medidos; contexto é estimado). `—` para
  write quando o provedor não tem cache explícito (analogia com o `—` de `formatWindow`,
  `ContextMeter.tsx:43-49`);
- **não** adicionar ícones dentro do popover: `ContextMeter.test.tsx:238` exige
  `dialog.querySelector('svg') === null`; o estado usa um quadrado/ponto colorido
  (`span size-2 rounded-full`, `aria-hidden`) + texto;
- largura: manter `w-72` (288px). As linhas do cache cabem; evita mudança de largura do
  popover existente.

### 4.5 Máquina de estados, tons e limites

Constantes em `src/lib/cache.ts` (novo, área Lead), pinadas por teste:

```ts
export const CACHE_GOOD_PERCENT = 95;   // a partir daqui o chip fica "bom"
export const CACHE_LOW_PERCENT = 60;    // abaixo disso, sempre `dropped`
export const CACHE_DROP_POINTS = 10;    // queda relativa que vira `dropped`
```

Derivação (função pura `deriveCacheState(previous, latest, sessionSamples)`):

1. `latest == null` ou `latest.usage.reported === false` → `unknown`.
2. `latest.usage.reported` mas nenhuma amostra anterior → `warming` (primeira amostra da
   sessão não diz nada sobre reaproveitamento).
3. `writeTokens > 0 && readTokens === 0` → `warming` (prefixo sendo gravado — caso Anthropic).
4. `current <= previous - 10` **ou** `current < 60` com anterior `>= 80` → `dropped`.
5. caso contrário → `stable`.

Tons (mapa `CACHE_TONES`: classes → `text-*`/`bg-*` dos tokens):

| Situação | Ícone | Número do chip | Barra/marcador |
| --- | --- | --- | --- |
| `stable` e `hit >= 95` | `text-success` | `text-foreground` | `bg-success` |
| `stable` e `hit < 95` | `text-warning` | `text-foreground` | `bg-warning` |
| `dropped` (ou `hit < 60`) | `text-danger` | `text-foreground` | `bg-danger` |
| `warming` | `text-foreground-muted` | `text-foreground` | `bg-foreground-muted` |
| `unknown` | `text-foreground-subtle` | `text-foreground-subtle` (`—`) | trilho vazio |

**Contraste (importante):** `--success: #16a34a` sobre fundo claro tem ~3,3:1 — **não**
atende 4,5:1 exigido por `docs/DESIGN.md:221` para texto de 11px. Por isso o **número**
permanece `text-foreground` e a cor vai no **ícone** (gráfico, 3:1) e na **barra**. Se o design
quiser número colorido, é preciso um token novo de texto (ex.: `--success-text: #15803d`,
~5:1) em `src/styles/globals.css:29-38` (claro) e `:63-72` (escuro) + `@theme inline`
`:97-105` — decisão para o Lead/ui-systems.

Motivo da queda (`deriveCacheReason(latest, previousDrop)`), em ordem de prioridade:

| Motivo | Texto pt-BR | Origem do fato |
| --- | --- | --- |
| `model` | `o modelo ou o protocolo mudou` | `prefix.model` |
| `prompt` | `o prompt de sistema mudou` | `prefix.systemPrompt` |
| `tools` | `as definições de ferramentas mudaram` | `prefix.toolDefinitions` |
| `compaction` | `o contexto foi compactado` | `compacted` |
| `history` | `o histórico divergiu do prefixo anterior` | `prefix.history` |
| `unknown` | `motivo não identificado` | nenhum fato |

Ordem `model → prompt → tools → compaction → history`: mudanças mais a montante invalidam
tudo o que vem depois no prefixo e são a explicação mais forte.

### 4.6 Acessibilidade

- trigger nativo `<button type="button">`, `focus-visible:ring-2 ring-accent/40` (já existe);
  Radix gerencia `aria-expanded`/`aria-controls` (`ContextMeter.test.tsx:58` já valida);
- nome acessível **não muda** quando há contexto (`Contexto usado: 44%`) para preservar o
  contrato testado em `ContextMeter.test.tsx:19-21`; o cache entra como **descrição**:
  `aria-describedby={id}` apontando um `<span className="sr-only" id={id}>` com o texto de
  §4.7. Os textos visíveis do segmento de cache ficam `aria-hidden` para não duplicar leitura;
- sem contexto (Chat) o nome acessível é `Cache de prompt: 98% de acerto`;
- popover continua `role="dialog"` com `aria-label="Detalhes do contexto"` (mantém os testes
  existentes `ContextMeter.test.tsx:23-26`) e Tab escapa do painel pela lógica do
  `PopoverContent` (`src/components/ui/popover.tsx:56-74`); foco volta ao trigger (Radix);
- barra de cache: `role="progressbar"` + `aria-label` + `aria-valuetext` (não depender do
  visual); estado nunca só por cor (sempre ponto + rótulo textual);
- nota de queda/aquecimento com `role="status"` (anunciada ao abrir o popover);
- alvo ≥32px: o chip tem `h-8` (32px) — atende `DESIGN.md:222`.

### 4.7 Textos exatos (pt-BR)

Descrição acessível do chip (`sr-only`, por estado):

- sem amostra: `Cache de prompt: aguardando a primeira amostra.`
- estável: `Cache de prompt: 98% de acerto — estável.`
- aquecendo: `Cache de prompt: aquecendo.`
- caiu: `Cache de prompt: 41% de acerto — caiu.`
- sem dados: `Cache de prompt: sem dados neste provedor.`

Popover:

- título da seção: `Cache de prompt`
- valor: `98% de acerto`
- linhas: `Lido do cache`, `Gravado no cache`, `Sem cache`
- acumulado: `Acumulado da sessão` / `97% em 12 passos` (singular: `em 1 passo`)
- estado: `Estado` / `Estável` | `Aquecendo` | `Caiu` | `Sem dados`
- amostra: `Última amostra` / `passo 4 · agora` (usar `relativeTime`, `src/lib/utils.ts:77-87`;
  re-renderiza a cada amostra e ao abrir o popover)
- queda: `Cache caiu de 98% para 41% neste passo.` + `Motivo: o prompt de sistema mudou.`
- aquecimento: `Aquecendo o cache: o primeiro request grava o prefixo e o acerto aparece no próximo passo.`
- provedor sem dados: `Este provedor não informa detalhes de cache nesta execução.`
- antes de qualquer amostra: `Sem amostras ainda. O acerto de cache aparece depois do primeiro passo.`
- nota de rodapé da seção: `Acerto = tokens lidos do cache ÷ tokens de entrada do passo.`
- rótulo da barra: `Acerto do cache de prompt`; `aria-valuetext`: `98% de acerto no cache`

Atualizar `docs/DESIGN.md` (§5 linha 79, §6.3 linhas 104-107, §14 linhas 245-248) e
`docs/goals/code-harness/WORKBENCH.md:78-95` / `HARNESS.md:466-489` com esses textos e a
semântica read/write/uncached.

### 4.8 Números, animação e layout shift

- `%` inteiro arredondado (`Math.round`), clampado 0–100 — `formatPercent` novo em
  `src/lib/utils.ts` (ao lado de `formatTokens`, `utils.ts:38-43`): `null`/`NaN` → `—`,
  negativos → `0%`. Tokens via `formatTokens` (K/M), com `—` para ausentes.
- `tabular-nums` no chip, nas linhas e no acumulado.
- transições **apenas** de `width`/`stroke-dashoffset` (300ms `ease-out`,
  `motion-reduce:transition-none`, padrão já usado em `ContextMeter.tsx:84` e `183-194`);
  nenhuma transição de altura/padding; nada pisca (sem `animate-pulse` no indicador — a
  amostra só muda quando o passo termina).
- estado `warming` **não** mostra spinner (evita ruído); só texto.
- tema escuro: tokens automáticos (`globals.css:45-77`).

### 4.9 Antes do primeiro uso / sem suporte

- **Code, turno recém-iniciado**: `context_stats` chega no começo (`harness/mod.rs:1100-1110`),
  então o anel já mostra o contexto; o segmento de cache mostra `—` e a descrição
  `Cache de prompt: aguardando a primeira amostra.`.
- **Chat** (se o `context_stats` de Chat não for implementado): chip cache-first; o anel de
  contexto fica ausente; ao abrir uma sessão antiga, o acumulado é restaurado das mensagens
  (L4) e a última amostra vem do último turno persistido, com `Última amostra: há 2 h`.
- **Provedor que não reporta cache**: `reported: false` → `—` e
  `Este provedor não informa detalhes de cache nesta execução.`; o acumulado ignora amostras
  não reportadas.
- **Payload antigo sem campos de cache**: mesma degradação (`—`), sem erro.
- **Setting**: **não** criar interruptor no v1. O requisito é explícito; o chip é pequeno e
  degrada sozinho. Se depois for necessário, o padrão é `Settings.showCacheUsage?: boolean`
  em `types.ts:874-925` + `domain.rs:685-...` + `GeneralTab.tsx:100-109` (evitar reutilizar
  `showTokenUsage`, que é do rodapé da mensagem).

---

## 5. Contratos IPC propostos (para o PLAN virar tarefas)

### 5.1 Fatos no backend, estado na UI

- Backend emite **fatos medidos** (amostras + flags de prefixo). Estado (`aquecendo/estável/
  caiu`), motivo e textos são **derivados no renderer** (`src/lib/cache.ts` + `cacheStore`),
  o que os torna testáveis sem Rust e permite calibrar limiares sem trocar IPC.
- **Não reutilizar `TurnEvent::Usage` por passo**: `chatStore.ts:502-507` faz merge raso no
  `message.usage`, então um `usage` por passo mostraria só o último passo no rodapé. Um
  evento novo é obrigatório.
- O agregado do turno continua indo no `usage` final (`harness/mod.rs:1663-1668`) com o bloco
  de cache — é o valor autoritativo para conciliar no fim do turno.

### 5.2 Rust (`src-tauri/src/domain.rs`, `events.rs`)

```rust
// domain.rs — logo após ContextStats (1321-1336)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    #[serde(default)] pub reported: bool,
    #[serde(default)] pub read_tokens: u32,
    #[serde(default)] pub write_tokens: u32,
    #[serde(default)] pub uncached_input_tokens: u32,
    #[serde(default)] pub total_input_tokens: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachePrefixChange {
    #[serde(default)] pub system_prompt: bool,
    #[serde(default)] pub tool_definitions: bool,
    #[serde(default)] pub model: bool,
    #[serde(default)] pub history: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSample {
    #[serde(default)] pub step: u32,
    pub at: i64,                                   // epoch ms (now_ms())
    #[serde(flatten)] pub usage: CacheUsage,
    #[serde(default)] pub prefix: Option<CachePrefixChange>,
    #[serde(default)] pub compacted: bool,
    #[serde(default)] pub provider_id: String,
    #[serde(default)] pub model_id: String,
}

// UsageInfo (175-193): + #[serde(default)] pub cache: Option<CacheUsage>,
```

```rust
// events.rs — junto de ContextStats (112-115)
/// Cache de prompt do request recém-concluído (uma amostra por passo).
CacheStats { sample: crate::domain::CacheSample },
```

TS correspondente (`src/lib/types.ts`, após `ContextStats` 342-352 e em `UsageInfo`
554-562 / `TurnEvent` 664-701):

```ts
export interface CacheUsage { reported: boolean; readTokens: number; writeTokens: number;
  uncachedInputTokens: number; totalInputTokens: number; }
export interface CachePrefixChange { systemPrompt: boolean; toolDefinitions: boolean;
  model: boolean; history: boolean; }
export interface CacheSample { step: number; at: number; usage: CacheUsage;
  prefix?: CachePrefixChange | null; compacted?: boolean; providerId?: string; modelId?: string; }
export interface UsageInfo { /* ... */ cache?: CacheUsage | null; }
// TurnEvent: | { type: 'cache_stats'; sample: CacheSample }
```

### 5.3 Normalização por provedor (obrigatória para o `%` ser comparável)

| Provedor | `readTokens` | `writeTokens` | `uncachedInputTokens` | `totalInputTokens` |
| --- | --- | --- | --- | --- |
| Anthropic | `cache_read_input_tokens` | `cache_creation_input_tokens` (**hoje descartado**, `anthropic.rs:436`) | `input_tokens` | read + write + uncached |
| OpenAI Chat/Responses | `prompt_tokens_details.cached_tokens` / `input_tokens_details.cached_tokens` | `0` (cache automático) | `prompt_tokens`/`input_tokens` − read | entrada do payload |
| DeepSeek/OpenCode Go (compatível OpenAI) | `usage.prompt_cache_hit_tokens` (quando o gateway devolve) | `0` | `prompt_cache_miss_tokens` ou entrada − read | hit + miss |
| Demais/erro | `reported: false` | 0 | 0 | 0 |

Definição única exibida na UI: **acerto = readTokens / totalInputTokens**. Gravações contam
no denominador (não são hit), o que é o que importa para a meta 98–99%.

### 5.4 Emissão por passo (real-time)

- No laço do harness, depois de obter `step_usage` (`harness/mod.rs:1305-1327`), **para
  qualquer perfil** (remover o guard `profile == TurnProfile::Code` apenas para o cache):
  montar `CacheSample` a partir de `step_usage` + `now_ms()` + `step_number` + fatos de
  prefixo + flag de compactação e emitir `TurnEvent::CacheStats`.
- Passo final forçado: emitir também (`harness/mod.rs:1546-1554`).
- Fatos de prefixo: guardar na primeira iteração um "fingerprint" do request
  (`hash(step_system_prompt)`, `hash(tool_definitions JSON)`, `model.id` + protocolo wire,
  ids/hash do histórico) e comparar com o request anterior — `systemPrompt`/`toolDefinitions`/
  `model` são comparações diretas; `history` = o histórico atual **não** é um append do
  anterior (compactação, regeneração, edição, poda).
- `compacted`: marcar quando `code::compaction::maybe_compact` (`harness/mod.rs:1148-1160`)
  alterou o histórico entre duas amostras.
- Ordem: `cache_stats` **antes** de `done`/`cancelled`/`error` (mesmo invariante já testado
  para `context_stats` em `harness/mod.rs:5650-5657`).
- Sem coalescing extra: 1 amostra por passo é a cadência natural (o turno tem poucos passos).

### 5.5 Acumulado, persistência e restauração

- `UsageInfo.cache` no agregado do turno: `merge_usage` (`harness/mod.rs:2531-2542`) soma
  read/write/uncached/total dos passos → vai no `TurnEvent::Usage` final, em
  `assistant_message.usage` (`harness/mod.rs:1646`) e no `TurnResult` (`1708-1716`).
- **Persistência**: `ChatMessage.usage` já é serializado em JSON (`db.rs:839-849`) e
  reidratado ao abrir (`db.rs:783`) → `CacheUsage` novo persiste **sem migração**. (Opcional:
  `usage_log` continua como está; não é usado pela UI.)
- **Restauração**: no renderer, `cacheStore.syncFromMessages(conversationId, messages)`
  soma `usage.cache` das mensagens do assistente — chamado em:
  - `chatStore.openConversation`, logo após gravar `detail.messages` (`chatStore.ts:733-741`);
  - eventos terminais do turno (`done`/`cancelled`/`error`, `chatStore.ts:521-554`), o que
    reconcilia com a verdade persistida (inclusive regeneração/erro);
  - seed idempotente (só define a base; amostras ao vivo somam em cima).
- Compat: mensagens de antes da mudança não têm `usage.cache` → não entram no acumulado
  (limitação documentada; a UI mostra `—`/acumulado apenas dos passos novos).
- O snapshot do Code (`ContextStats` persistido) **não precisa** carregar cache: o acumulado
  vem das mensagens. Se o PLAN preferir o caminho do snapshot, adicionar
  `cache: Option<CacheSnapshot>` em `ContextStats` (`domain.rs:1321-1336`, com
  `#[serde(default)]`) e persistir no fecho do turno (`harness/mod.rs:1728-1735`).

### 5.6 Chat: contexto (opcional, P2)

Para o chip do Chat mostrar também `%` de contexto:

- emitir `context_stats` também no perfil Chat (remover os guards `profile ==
  TurnProfile::Code` de `harness/mod.rs:1100`, `1215`, `1719`; manter compactação exclusiva
  do Code);
- o `chatStore` já encaminha `context_stats` ao `codeStore` (`chatStore.ts:393`), então o chip
  do Chat pode ler `byConversation[cid].context`;
- restaurar ao abrir: adicionar `context: Option<ContextStats>` (`#[serde(default)]`) em
  `ConversationDetail` (`domain.rs:68-73`) preenchido em `commands/conversations.rs:105-110`
  via `harness::code::session::context_stats` (mesmo padrão de `commands/code.rs:96-98`).
  Sem isso, o Chat mostra contexto `—` até o primeiro turno da sessão aberta.

---

## 6. Store de cache no renderer (proposta)

`src/lib/store/cacheStore.ts` (novo, área Lead) + helpers puros em `src/lib/cache.ts`:

```ts
interface CacheUi {
  base: CacheSession;     // turnos finalizados / mensagens persistidas
  turn: CacheSession;     // passos do turno em curso
  latest: CacheSample | null;
  previous: CacheSample | null;
  lastDrop: { from: number; to: number; at: number; step: number | null } | null;
  updatedAt: number | null;
}
interface CacheStoreState {
  byConversation: Record<string, CacheUi>;
  applySample: (conversationId: string, sample: CacheSample) => void;
  syncFromMessages: (conversationId: string, messages: ChatMessage[]) => void;
  reset: (conversationId?: string) => void;
}
```

- Alimentado por `chatStore.handleEvent` (antes do `switch`, ao lado de `isCodeEvent`):
  `if (event.type === 'cache_stats') useCacheStore.getState().applySample(context.conversationId, event.sample)`.
- `isCodeEvent` (`codeStore.ts:179-197`) **não** inclui `cache_stats` (o `codeStore` não muda).
- Selector `selectCacheStats(conversationId): CacheStats | null` (deriva `state`, `reason`,
  `session` e `previousHitPercent`) — usado pelo `ContextMeter` via container.
- Reset em `chatStore.deleteConversation` e em `codeStore.reset` equivalente.
- Limite de memória: guardar no máximo as últimas ~50 amostras por conversa (só para o
  `lastDrop`/possível sparkline); agregados são numéricos.

Consequência de ownership: `src/lib/**` é Lead; `src/components/agent/**` é ui-agent;
`src/components/code/**` ui-code; `src/components/composer/**` ui-core; `src-tauri/src/harness/**`
harness-dev; `src-tauri/src/providers/**` provider-dev; `domain.rs`/`events.rs` Lead;
`db.rs` storage-dev.

---

## 7. Testes a criar/atualizar (Vitest + jsdom) e verificação

Configuração atual: `vitest.config.ts:11-16` (ambiente `jsdom`, `src/**/*.test.{ts,tsx}`,
setup `vitest.setup.ts`). Scripts: `pnpm typecheck` = `tsc --noEmit`; `pnpm test` =
`vitest run` (`package.json:12-18`).

### 7.1 `src/components/agent/ContextMeter.test.tsx` (atualizar + ampliar)

Manter os 12 testes existentes; acrescentar:

1. **chip com cache**: render com `cache` (98%, lido 240K, sem cache 4K, 12 passos) →
   `button.textContent` contém `44%` e `98%`; chip `h-8`; `tabular-nums`; sem shift de
   largura entre `—` e `98%` (mesmas classes de largura mínima).
2. **descrição acessível**: `aria-describedby` aponta para texto
   `Cache de prompt: 98% de acerto — estável.` (assertar `document.getElementById` + conteúdo;
   `getByRole('button', { name: 'Contexto usado: 44%' })` continua válido).
3. **popover de cache**: abre e mostra `Cache de prompt`, `98% de acerto`, `Lido do cache`,
   `Acumulado da sessão`, `97% em 12 passos`, `Estado`, `Estável`.
4. **progressbar de cache**: `getByRole('progressbar', { name: 'Acerto do cache de prompt' })`
   com `aria-valuenow="98"` e `aria-valuetext="98% de acerto no cache"`; a barra de contexto
   continua existindo (2 progressbars no popover — atualizar seletor por nome).
5. **payload antigo** (`cache` undefined, `stats` sem `breakdown`): chip mostra `—`; popover
   mostra `Sem amostras ainda…`; nada lança.
6. **warmup**: `{ reported: true, readTokens: 0, writeTokens: 41_000, … }` → estado
   `Aquecendo`; descrição `Cache de prompt: aquecendo.`; nota `Aquecendo o cache…` com
   `role="status"`; chip mostra `0%` (número real, sem inventar).
7. **queda**: `previous` 98% → `latest` 41%, `prefix.systemPrompt: true` → estado `Caiu`,
   status `Cache caiu de 98% para 41% neste passo.` + `Motivo: o prompt de sistema mudou.`;
   ícone do chip com `text-danger`; nenhuma cor é o único sinal (texto presente).
8. **hit alto**: 99% → `Estável`, classes de sucesso no ícone/barra, sem nota `role="status"`
   de queda.
9. **provedor sem dados**: `reported: false` → `—`, `Sem dados`, nota
   `Este provedor não informa detalhes de cache nesta execução.`
10. **rerender sem remontar**: atualizar `cache` com o popover aberto → mesmo
    `getByRole('dialog')` (padrão de `ContextMeter.test.tsx:193-221`).
11. **placement="composer"** (Chat): sem `stats`, nome acessível
    `Cache de prompt: 98% de acerto`; popover abre; não há barra "Contexto usado".

### 7.2 `src/lib/__tests__/cache.test.ts` (novo — funções puras)

- `cacheHitPercent`: `read/(read+write+uncached)`; arredonda; `total=0` → `null`;
  `reported=false` → `null`.
- `deriveCacheState`: tabela (primeira amostra → `warming`; write>0/read=0 → `warming`;
  queda de 98→41 → `dropped`; 96→95 → `stable`; 98→89 → `dropped`; `reported:false` →
  `unknown`).
- `deriveCacheReason`: prioridade model > prompt > tools > compaction > history > unknown;
  sem fato → `unknown`.
- `sumCacheFromMessages`: soma só mensagens `assistant` com `usage.cache`; ignora legado sem
  `cache`; ignora `reported:false`; sessão vazia → zeros + `hitPercent:null`.
- `formatPercent`: `98.4→'98%'`, `100→'100%'`, `0→'0%'`, `null→'—'`, `NaN→'—'`, `-5→'0%'`.

### 7.3 `src/lib/store/__tests__/cacheStore.test.ts` (novo)

- `applySample` acumula no turno; `session = base + turn`; `latest/previous` corretos;
  `lastDrop` gravado com `from/to/step/at`.
- `syncFromMessages` substitui a base (não soma duas vezes), é idempotente e ignora turno em
  curso.
- reset por conversa e reset global.
- amostra não reportada não infla o acumulado.

### 7.4 Atualizações em testes existentes

- `src/lib/store/__tests__/codeStore.test.ts`: sem mudança de comportamento; adicionar caso
  de snapshot com `context` e (se o caminho §5.5 for adotado) cache preservado em
  `fromSnapshot` (`codeStore.ts:200-220`).
- `src/lib/__tests__/chatStore.test.ts`: (a) `cache_stats` chega ao `cacheStore` e **não**
  altera `message.usage`; (b) o merge de `usage` continua igual (caso existente em
  `chatStore.test.ts:170-196`); (c) `done` reconcilia a base; (d) `error`/`cancelled` também.
- `src/components/code/CodeSessionHeader.test.tsx`: chip continua no header quando há
  contexto; aparece também quando só há cache; continua oculto/ausente sem sessão ativa.
- `src/components/composer/Composer.test.tsx`: chip do Chat aparece com conversa ativa e
  some sem conversa; nome acessível correto.
- `src/lib/__tests__/utils.test.ts`: casos de `formatPercent` (§7.2).

### 7.5 Comandos de verificação

```bash
pnpm typecheck
pnpm test
pnpm vitest run src/components/agent/ContextMeter.test.tsx   # foco
pnpm vitest run src/lib/store/__tests__/cacheStore.test.ts
# backend (tarefas de harness/provider, fora desta auditoria)
cd src-tauri && cargo test --lib
```

Backend (para as tarefas do PLAN): novo teste no harness no molde de
`harness/mod.rs:5588-5689` (um turno com provider falso reportando cache em 2 passos →
≥2 eventos `cache_stats`, cada um antes do `done`, último igual ao agregado do
`TurnEvent::Usage`); testes de `parse_usage`/`merge_usage` nos adapters; serde default de
payload antigo (`serde_json::from_str` sem os campos novos → `None`/`false`), no molde de
`harness/code/session.rs:771-775`.

---

## 8. Tabela "superfície → arquivo:linha atual → mudança necessária"

| # | Superfície | Arquivo:linha (atual) | Mudança necessária | Dono |
| --- | --- | --- | --- | --- |
| 1 | Chip do medidor | `src/components/agent/ContextMeter.tsx:141-159` | `%` de cache + divisor + ícone Zap; `aria-describedby`; `stats` opcional; larguras fixas | ui-agent |
| 2 | Tiers/anel | `ContextMeter.tsx:21-37`, `62-90` | `CACHE_TONES` + estado; anel continua só contexto | ui-agent |
| 3 | Popover | `ContextMeter.tsx:160-227` | seção "Cache de prompt" (barra + valores + acumulado + estado + amostra + motivo + rodapé) | ui-agent |
| 4 | Props/exports | `ContextMeter.tsx:5-10`; `src/components/agent/index.ts:31-32` | `cache?`, `stats?`, `placement?`; exportar tipos | ui-agent |
| 5 | Container Code | `src/components/code/CodeAgentWidgets.tsx:175-184` | ler `cacheStore`; `hidden lg:block` → `hidden sm:block` | ui-code |
| 6 | Header Code | `src/components/code/CodeSessionHeader.tsx:547-550` | sem mudança de posição; validar largura em janela estreita | ui-code |
| 7 | Chat — montagem | `src/components/composer/Composer.tsx:677-678` | `CacheMeterChip` antes do `ModelPill` (novo arquivo em `src/components/composer/`) | ui-core |
| 8 | Chat — sem header | `src/components/layout/WorkspaceCenter.tsx:49-71` | **não** criar header no v1 (decisão §4.2) | ui-core |
| 9 | Rodapé de tokens | `src/components/chat/MessageItem.tsx:170`, `193-197`, `330-339` | sem mudança; referência de microcopy `tokens` | ui-core |
| 10 | Tipos | `src/lib/types.ts:335-352`, `554-562`, `664-701` | `CacheUsage`/`CachePrefixChange`/`CacheSample`/`CacheStats`; `UsageInfo.cache`; evento `cache_stats` | Lead |
| 11 | Formatação | `src/lib/utils.ts:38-50` | `formatPercent` (novo, ao lado de `formatTokens`) | Lead |
| 12 | Helpers de cache | `src/lib/cache.ts` (novo) | thresholds, `cacheHitPercent`, `deriveCacheState`, `deriveCacheReason`, `sumCacheFromMessages` | Lead |
| 13 | Store de cache | `src/lib/store/cacheStore.ts` (novo) + `src/lib/store/index.ts:1-39` | estado por conversa, `applySample`, `syncFromMessages`, selectors | Lead |
| 14 | Roteamento do evento | `src/lib/store/chatStore.ts:390-393`, `502-507`, `521-554`, `708-749` | tratar `cache_stats`; reconciliar em `done`/`cancelled`/`error`; seed no `openConversation` | Lead |
| 15 | Estado Code | `src/lib/store/codeStore.ts:38`, `144-145`, `179-197`, `200-220` | sem mudança p/ cache; opcional: `ContextStats.cache` no snapshot | Lead |
| 16 | API | `src/lib/api.ts:281-285` | sem comando novo (evento trafega no `Channel` existente) | Lead |
| 17 | Evento Rust | `src-tauri/src/events.rs:112-115` (+ comentário `51-52`) | variante `CacheStats { sample }`; corrigir comentário do `Usage` | Lead |
| 18 | Domínio Rust | `src-tauri/src/domain.rs:175-193`, `1321-1336`, `68-73` | `CacheUsage`/`CachePrefixChange`/`CacheSample`; `UsageInfo.cache`; (P2) `ConversationDetail.context` | Lead |
| 19 | Harness — emissão | `src-tauri/src/harness/mod.rs:1305-1327`, `1546-1554` | emitir `cache_stats` por passo (todos os perfis) + passo final forçado | harness-dev |
| 20 | Harness — prefixo | `harness/mod.rs:1141-1230` (loop), `1148-1160` (compactação) | fingerprint do request anterior; flags `systemPrompt/toolDefinitions/model/history`; `compacted` | harness-dev |
| 21 | Harness — agregado | `harness/mod.rs:2531-2542`, `1663-1668`, `1646`, `1708-1716` | `merge_usage` soma cache; `usage` final com `cache` | harness-dev |
| 22 | Harness — prompt Code | `harness/mod.rs:1005` | **corrigir** timestamp de minuto no system prompt (causa quedas) — decisão do PLAN | harness-dev |
| 23 | Providers | `providers/mod.rs:744-764`; `anthropic.rs:425-439`; `openai_chat.rs:360-369`; `openai_responses.rs:564-571` | normalizar read/write/uncached/total + `reported`; ler `cache_creation_input_tokens` | provider-dev |
| 24 | Persistência (opcional) | `src-tauri/src/db.rs:131-144`, `2161-2191`, `783`/`839-849` | nada obrigatório (`message.usage` JSON cobre); opcional colunas normalizadas em `usage_log` | storage-dev |
| 25 | Restauração Chat (P2) | `commands/conversations.rs:105-110`, `commands/code.rs:96-98` | (se P2) incluir `context` no `ConversationDetail` | Lead/storage-dev |
| 26 | Config/ajuste | `domain.rs:685-...` (`show_token_usage` 696), `GeneralTab.tsx:100-109` | **não** criar setting no v1 | ui-systems/Lead |
| 27 | Tokens de design | `src/styles/globals.css:29-38`, `63-72`, `97-105` | opcional `--success-text` (contraste do número) / `--context-cache` se houver cor dedicada | Lead/ui-systems |
| 28 | Docs de spec | `docs/DESIGN.md:79`, `104-107`, `216-222`, `237-248`; `WORKBENCH.md:78-95`; `HARNESS.md:466-489` | atualizar medidor (cache), microcopy pt-BR e acessibilidade | Lead + donos |
| 29 | Testes | `ContextMeter.test.tsx`, `cacheStore.test.ts` (novo), `cache.test.ts` (novo), `chatStore.test.ts`, `Composer.test.tsx`, `CodeSessionHeader.test.tsx`, `utils.test.ts` | casos de §7 | ui-agent/ui-core/Lead |
| 30 | Testes Rust | `harness/mod.rs:5588-5689` (molde), `providers/*` tests, `session.rs:771-775` (molde serde) | eventos por passo, normalização, payload antigo | harness-dev/provider-dev |

---

## 9. Decisões abertas para o Lead

1. **Escopo do Chat**: o chip no composer do Chat entra no v1 (recomendado) ou o requisito
   vale só para o layout Code? Se entrar, o `%` de contexto no Chat exige P2 do §5.6;
   sem ele, o chip do Chat é cache-first.
2. **Definição do `%`**: read / (read + write + uncached) — inclui gravações no denominador
   (recomendado para a meta). Confirmar com o pesquisador de provedores que o gateway
   expõe os campos necessários nos dois protocolos.
3. **Onde conciliar o acumulado**: derivar de `ChatMessage.usage` (recomendado; sem migração)
   vs persistir um snapshot dedicado de cache.
4. **Timestamp no system prompt Code** (`harness/mod.rs:1005`): congelar no início do turno?
   mover para o fim do prompt? remover? — é o maior ofensor previsível do 98–99% e o
   indicador vai escancarar isso no motivo `prompt`.
5. **Número colorido vs neutro** no chip: se colorido, aprovar token `--success-text`
   (contraste AA) ou aceitar cor só no ícone/barra (recomendado no v1).
6. **Meta de UI**: chip visível <1024px (recomendado, requisito) vs manter escondido.

## 10. Critérios de aceite do indicador

- Com um turno Code em andamento, **após o primeiro passo** o chip mostra um `%` de cache
  que atualiza **a cada passo**, sem recarregar tela e sem layout shift; antes do primeiro
  `usage` mostra `—`.
- O popover mostra tokens read/write/uncached, acumulado da sessão com nº de amostras,
  estado, instante da última amostra, e — quando cai — o motivo em pt-BR.
- Provedor sem suporte → `—`/`Sem dados`, nunca `0%`.
- Ao reabrir a conversa, o acumulado é restaurado e a última amostra exibe
  `Última amostra: há …`.
- Payload antigo (sem campos de cache) não quebra nem some com o medidor atual entre
  `breakdown`/`compacted`.
- Acessibilidade: nome/descrição corretos, `role="progressbar"` na barra de cache, foco
  visível, Tab não fica preso no popover, nenhum estado dependente só de cor.
- `pnpm typecheck` e `pnpm test` verdes (e `cargo test --lib` nas tarefas de backend).
