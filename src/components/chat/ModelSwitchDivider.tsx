/**
 * Divisor de troca de modelo/provedor no meio da conversa.
 *
 * Sessões do layout Code podem trocar de modelo/provedor entre turnos (antes o
 * modelo ficava travado após o primeiro envio). O rodapé da resposta mostra o
 * modelo só no hover; o divisor marca onde a rota mudou sem poluir a leitura.
 *
 * A detecção é pura e exportada para teste: a primeira resposta nunca gera
 * divisor, mensagens sem `modelId` (legado) são ignoradas e a troca pode ser só
 * de modelo, só de provedor ou de ambos.
 */
import { ArrowRightLeft } from 'lucide-react';

import { findModel, getModel, providerLabel } from '@/lib/catalog';
import type { ChatMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Rota de modelo de uma resposta: provedor (quando conhecido) + modelo. */
export interface ModelRoute {
  providerId: string | null;
  modelId: string;
}

/** Rota de uma mensagem; `null` quando não há `modelId` (mensagem legada). */
export function resolveModelRoute(message: ChatMessage): ModelRoute | null {
  if (!message.modelId) return null;
  return { providerId: message.providerId ?? null, modelId: message.modelId };
}

/** Nome do modelo no catálogo, com fallback para o id persistido. */
function modelName(route: ModelRoute): string {
  const exact = route.providerId ? getModel(route.providerId, route.modelId) : undefined;
  const model = exact ?? findModel(route.modelId)?.model;
  return model?.name ?? route.modelId;
}

/**
 * Decide se `current` inaugura uma rota nova em relação à última resposta
 * assistant (`previous`). Devolve a rota nova ou `null` quando não há divisor.
 */
export function detectModelSwitch(
  current: ChatMessage,
  previous: ChatMessage | null | undefined,
): ModelRoute | null {
  if (current.role !== 'assistant') return null;
  const route = resolveModelRoute(current);
  if (!route) return null;
  const previousRoute = previous ? resolveModelRoute(previous) : null;
  if (!previousRoute) return null;
  if (route.modelId !== previousRoute.modelId) return route;
  // O provedor só entra na comparação quando os dois lados o conhecem:
  // mensagens antigas sem `providerId` não podem inventar uma troca.
  if (
    route.providerId &&
    previousRoute.providerId &&
    route.providerId !== previousRoute.providerId
  ) {
    return route;
  }
  return null;
}

/**
 * Divisor a aplicar antes de `messages[index]` (varredura do transcript).
 * Respostas sem `modelId` não interrompem a comparação: a rota anterior é a
 * última resposta que tem uma.
 */
export function modelSwitchAt(
  messages: readonly ChatMessage[],
  index: number,
): ModelRoute | null {
  const current = messages[index];
  if (!current || current.role !== 'assistant') return null;
  if (!resolveModelRoute(current)) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate?.role !== 'assistant') continue;
    if (resolveModelRoute(candidate)) return detectModelSwitch(current, candidate);
  }
  return null;
}

/** Rótulo visível e título completo (com provedor) do divisor. */
export function modelSwitchLabel(route: ModelRoute): { text: string; title: string } {
  const text = `Modelo alterado para ${modelName(route)}`;
  const provider = route.providerId ? providerLabel(route.providerId) : null;
  return { text, title: provider ? `${text} · ${provider}` : text };
}

export interface ModelSwitchDividerProps {
  route: ModelRoute;
  className?: string;
}

/**
 * Linha divisória acessível que marca a troca de modelo no transcript. O texto
 * visível carrega a informação (não só a cor) e o provedor completo fica no
 * `title`/`aria-label`.
 */
export function ModelSwitchDivider({ route, className }: ModelSwitchDividerProps) {
  const { text, title } = modelSwitchLabel(route);

  return (
    <div
      role="separator"
      aria-label={title}
      title={title}
      className={cn('my-3 flex min-w-0 items-center gap-3', className)}
    >
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-foreground-subtle">
        <ArrowRightLeft aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{text}</span>
      </span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}
