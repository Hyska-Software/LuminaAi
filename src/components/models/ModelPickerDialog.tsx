import { useState } from 'react';
import { Check, Search, Star } from 'lucide-react';
import {
  defaultReasoningFor,
  formatContextWindow,
  formatPrice,
  getModel,
  groupByFamily,
  providers as catalogProviders,
} from '@/lib/catalog';
import type { ModelInfo, ProviderKeyStatus, ProviderInfo, ReasoningSelection } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore, useUiStore } from '@/lib/store';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@/components/ui';
import { CapabilityBadges } from './CapabilityBadges';
import { FamilyAvatar } from './FamilyAvatar';
import { ThinkingSelector } from './ThinkingSelector';

const PROTOCOL_LABELS: Record<string, string> = {
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic',
  google: 'Google',
};

const KEY_SOURCE_LABELS: Record<ProviderKeyStatus['source'], string> = {
  settings: 'Configurada',
  env: 'Variável de ambiente',
  'opencode-cli': 'OpenCode CLI',
  none: 'Ausente',
};

interface PreviewState {
  providerId: string;
  modelId: string;
  reasoning: ReasoningSelection | null;
}

function keyFor(keys: ProviderKeyStatus[], providerId: string): ProviderKeyStatus | undefined {
  return keys.find((key) => key.providerId === providerId);
}

function matchesQuery(model: ModelInfo, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    model.name.toLowerCase().includes(needle) ||
    model.id.toLowerCase().includes(needle) ||
    (model.family ?? '').toLowerCase().includes(needle) ||
    (model.description ?? '').toLowerCase().includes(needle)
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
      <dt className="shrink-0 text-[11px] text-foreground-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function ModelPickerDialog() {
  const open = useUiStore((state) => state.modelPickerOpen);
  const setOpen = useUiStore((state) => state.setModelPickerOpen);
  const selection = useAppStore((state) => state.selection);
  const favorites = useAppStore((state) => state.favorites);
  const keys = useAppStore((state) => state.keys);
  const storeProviders = useAppStore((state) => state.providers);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const setSelection = useAppStore((state) => state.setSelection);
  const setReasoning = useAppStore((state) => state.setReasoning);

  const providerList: ProviderInfo[] = storeProviders.length ? storeProviders : catalogProviders();

  const [query, setQuery] = useState('');
  const [providerId, setProviderId] = useState(selection.providerId);
  const [preview, setPreview] = useState<PreviewState>({
    providerId: selection.providerId,
    modelId: selection.modelId,
    reasoning: selection.reasoning,
  });

  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    // Reset state as soon as the dialog opens (render-time state sync).
    setWasOpen(true);
    setQuery('');
    setProviderId(selection.providerId);
    setPreview({
      providerId: selection.providerId,
      modelId: selection.modelId,
      reasoning: selection.reasoning,
    });
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const activeProvider = providerList.find((provider) => provider.id === providerId) ?? providerList[0];
  const activeModels = (activeProvider?.models ?? []).filter((model) => matchesQuery(model, query));
  const groups = groupByFamily(activeModels);
  const previewModel = getModel(preview.providerId, preview.modelId);
  const previewProvider = providerList.find((provider) => provider.id === preview.providerId);
  const previewKey = keyFor(keys, preview.providerId);
  const previewUnavailable = previewModel?.status === 'unavailable';
  const isCurrent = selection.providerId === preview.providerId && selection.modelId === preview.modelId;

  const selectProvider = (nextId: string) => {
    setProviderId(nextId);
    if (preview.providerId === nextId) return;
    const provider = providerList.find((entry) => entry.id === nextId);
    if (!provider) return;
    const fallback =
      provider.models.find((model) => model.id === provider.defaultModelId && model.status !== 'unavailable') ??
      provider.models.find((model) => model.status !== 'unavailable') ??
      provider.models[0];
    if (!fallback) return;
    setPreview({
      providerId: provider.id,
      modelId: fallback.id,
      reasoning: defaultReasoningFor(fallback),
    });
  };

  const selectModel = (model: ModelInfo) => {
    if (model.status === 'unavailable') return;
    setPreview((current) => ({
      providerId: providerId,
      modelId: model.id,
      reasoning:
        current.providerId === providerId && current.modelId === model.id
          ? current.reasoning
          : defaultReasoningFor(model),
    }));
  };

  const commit = () => {
    if (!previewModel || previewUnavailable) return;
    setSelection({
      providerId: preview.providerId,
      modelId: preview.modelId,
      reasoning: preview.reasoning,
    });
    setReasoning(preview.reasoning);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showClose
        className="h-[560px] w-[720px] max-w-[calc(100vw-2rem)] gap-0 p-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="gap-2.5 pr-14">
          <div>
            <DialogTitle>Modelo</DialogTitle>
            <DialogDescription>
              Escolha o modelo e ajuste o modo de pensamento antes de conversar.
            </DialogDescription>
          </div>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome, identificador ou família…"
              aria-label="Buscar modelos"
              className="pl-9"
              autoFocus
            />
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 border-t border-border">
          <Tabs
            value={activeProvider?.id ?? ''}
            onValueChange={selectProvider}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
              <TabsList className="bg-surface">
                {providerList.map((provider) => {
                  const key = keyFor(keys, provider.id);
                  const hasKey = Boolean(key?.hasKey);
                  return (
                    <TabsTrigger key={provider.id} value={provider.id} variant="pill" className="gap-1.5">
                      {provider.shortName}
                      <span
                        aria-hidden
                        title={`Chave ${KEY_SOURCE_LABELS[key?.source ?? 'none']}`}
                        className={cn('size-1.5 rounded-full', hasKey ? 'bg-success' : 'bg-border-strong')}
                      />
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <span className="shrink-0 pl-2 text-[11px] tabular-nums text-foreground-subtle">
                {activeModels.length} {activeModels.length === 1 ? 'modelo' : 'modelos'}
              </span>
              {activeProvider ? (
                <Badge
                  tone={keyFor(keys, activeProvider.id)?.hasKey ? 'success' : 'warning'}
                  title={`Chave ${KEY_SOURCE_LABELS[keyFor(keys, activeProvider.id)?.source ?? 'none']}`}
                  className="shrink-0"
                >
                  {keyFor(keys, activeProvider.id)?.hasKey ? 'Chave OK' : 'Sem chave'}
                </Badge>
              ) : null}
            </div>

            {providerList.map((provider) => (
              <TabsContent
                key={provider.id}
                value={provider.id}
                className="min-h-0 flex-1 data-[state=inactive]:hidden"
              >
                <ScrollArea className="h-full" type="auto">
                  {provider.id !== activeProvider?.id ? null : groups.length ? (
                    <div className="py-1">
                      {groups.map((group) => (
                        <section key={group.family}>
                          <h4 className="sticky top-0 z-10 bg-surface-raised/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground-subtle backdrop-blur">
                            {group.family}
                          </h4>
                          {group.models.map((model) => {
                            const isPreview =
                              preview.providerId === provider.id && preview.modelId === model.id;
                            const isSelected =
                              selection.providerId === provider.id && selection.modelId === model.id;
                            const unavailable = model.status === 'unavailable';
                            const favorite = favorites.includes(model.id);

                            const row = (
                              <div
                                className={cn(
                                  'group flex items-center gap-1.5 px-2 py-1',
                                  isPreview && 'bg-accent-soft/50',
                                  unavailable && 'opacity-50',
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => selectModel(model)}
                                  disabled={unavailable}
                                  aria-current={isSelected ? 'true' : undefined}
                                  className={cn(
                                    'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left',
                                    'transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                                    'disabled:cursor-not-allowed disabled:hover:bg-transparent',
                                  )}
                                >
                                  <FamilyAvatar family={model.family} name={model.name} size={24} />
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                      <span className="truncate text-[13px] font-medium text-foreground">
                                        {model.name}
                                      </span>
                                      <CapabilityBadges model={model} max={3} className="shrink-0" />
                                    </span>
                                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
                                      <span className="tabular-nums">
                                        {formatContextWindow(model.contextWindow)} contexto
                                      </span>
                                      <span aria-hidden>·</span>
                                      <span className="tabular-nums">{formatPrice(model.cost)}</span>
                                    </span>
                                  </span>
                                  {isSelected ? <Check aria-hidden className="size-4 shrink-0 text-accent" /> : null}
                                </button>
                                <Tooltip
                                  content={favorite ? 'Remover dos favoritos' : 'Favoritar modelo'}
                                  side="left"
                                >
                                  <IconButton
                                    label={favorite ? `Remover ${model.name} dos favoritos` : `Favoritar ${model.name}`}
                                    size="sm"
                                    onClick={() => toggleFavorite(model.id)}
                                    className={cn(
                                      'size-7 text-foreground-subtle',
                                      favorite && 'text-warning hover:text-warning',
                                    )}
                                  >
                                    <Star className={cn('size-3.5', favorite && 'fill-current')} />
                                  </IconButton>
                                </Tooltip>
                              </div>
                            );

                            return unavailable ? (
                              <Tooltip
                                key={model.id}
                                content="Indisponível no gateway — seleção desabilitada."
                                side="right"
                              >
                                <div>{row}</div>
                              </Tooltip>
                            ) : (
                              <div key={model.id}>{row}</div>
                            );
                          })}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                      <Search aria-hidden className="size-5 text-foreground-subtle" />
                      <p className="text-[13px] font-medium text-foreground">Nenhum modelo encontrado</p>
                      <p className="text-xs text-foreground-muted">
                        Tente outro termo ou limpe a busca.
                      </p>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>

          <aside className="flex w-[296px] shrink-0 flex-col bg-surface/40">
            {previewModel ? (
              <>
                <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
                  <FamilyAvatar family={previewModel.family} name={previewModel.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                      {previewModel.name}
                    </h3>
                    <p className="mt-0.5 truncate text-[11px] text-foreground-subtle">
                      {previewProvider?.name ?? preview.providerId} · {previewModel.id}
                    </p>
                  </div>
                  <Tooltip
                    content={favorites.includes(previewModel.id) ? 'Remover dos favoritos' : 'Favoritar modelo'}
                    side="left"
                  >
                    <IconButton
                      label={
                        favorites.includes(previewModel.id)
                          ? `Remover ${previewModel.name} dos favoritos`
                          : `Favoritar ${previewModel.name}`
                      }
                      size="sm"
                      onClick={() => toggleFavorite(previewModel.id)}
                      className={cn(
                        'size-7 shrink-0 text-foreground-subtle',
                        favorites.includes(previewModel.id) && 'text-warning hover:text-warning',
                      )}
                    >
                      <Star
                        className={cn('size-3.5', favorites.includes(previewModel.id) && 'fill-current')}
                      />
                    </IconButton>
                  </Tooltip>
                </div>

                <ScrollArea className="min-h-0 flex-1" type="auto">
                  <div className="flex flex-col gap-4 px-4 py-3.5">
                    <div className="flex flex-col gap-2">
                      <CapabilityBadges model={previewModel} max={6} />
                      <p className="text-[12px] leading-relaxed text-foreground-muted">
                        {previewModel.description ?? 'Sem descrição no catálogo.'}
                      </p>
                    </div>

                    <dl className="flex flex-col">
                      <DetailRow label="Contexto" value={formatContextWindow(previewModel.contextWindow)} />
                      <DetailRow label="Saída máxima" value={formatContextWindow(previewModel.maxOutput)} />
                      <DetailRow label="Custo (entrada / saída)" value={formatPrice(previewModel.cost)} />
                      <DetailRow
                        label="Protocolo"
                        value={previewModel.protocols
                          .map((protocol) => PROTOCOL_LABELS[protocol] ?? protocol)
                          .join(' · ')}
                      />
                      {previewModel.knowledge ? (
                        <DetailRow label="Conhecimento até" value={previewModel.knowledge} />
                      ) : null}
                      {previewModel.releaseDate ? (
                        <DetailRow label="Lançamento" value={previewModel.releaseDate} />
                      ) : null}
                    </dl>

                    <div className="rounded-xl border border-border bg-surface-raised p-3">
                      <ThinkingSelector
                        model={previewModel}
                        value={preview.reasoning}
                        onChange={(reasoning) =>
                          setPreview((current) => ({ ...current, reasoning }))
                        }
                        compact
                      />
                    </div>

                    {previewUnavailable ? (
                      <p className="rounded-lg bg-danger-soft px-3 py-2 text-[11px] leading-relaxed text-danger">
                        Este modelo está indisponível no gateway e não pode ser selecionado.
                      </p>
                    ) : previewKey && !previewKey.hasKey ? (
                      <p className="rounded-lg bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-warning">
                        Chave de API ausente para {previewProvider?.name ?? preview.providerId}. Configure em
                        Configurações › Provedores.
                      </p>
                    ) : null}
                  </div>
                </ScrollArea>

                <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
                  {isCurrent ? (
                    <Badge tone="accent" className="shrink-0">
                      Em uso
                    </Badge>
                  ) : null}
                  <Button
                    variant="primary"
                    onClick={commit}
                    disabled={previewUnavailable}
                    className="ml-auto"
                  >
                    Usar este modelo
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-[13px] font-medium text-foreground">Selecione um modelo</p>
                <p className="text-xs text-foreground-muted">
                  Os detalhes e o modo de pensamento aparecem aqui.
                </p>
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ModelPickerDialog;
