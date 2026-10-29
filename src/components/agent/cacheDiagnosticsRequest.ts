/**
 * Pedido global de abertura do painel de diagnóstico de cache (F5.4).
 *
 * O painel vive montado junto da paleta de comandos (sempre presente no App),
 * mas o pedido pode partir de qualquer superfície — a própria paleta ou o botão
 * "Ver diagnóstico completo" do popover do chip/medidor. Usar um evento de
 * janela segue o padrão já existente do app (`lumina:focus-composer`,
 * `lumina:library-import`) e evita acoplar o chip ao host do dialog.
 */
export const CACHE_DIAGNOSTICS_EVENT = 'lumina:cache-diagnostics';

/** Pede ao host (ex.: `CommandPalette`) para abrir o diagnóstico da conversa ativa. */
export function requestCacheDiagnostics(): void {
  window.dispatchEvent(new CustomEvent(CACHE_DIAGNOSTICS_EVENT));
}
