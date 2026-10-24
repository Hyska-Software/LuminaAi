/**
 * Execução segura das ações interativas da UI generativa.
 *
 * O agente NUNCA executa código na interface: `actions` apenas declara uma de
 * duas intenções permitidas pelo contrato (`data/genui-contract.json`):
 *
 * - `prompt`: preenche o composer (evento `lumina:suggest`) para o usuário
 *   revisar e enviar — nunca dispara um turno sozinho;
 * - `copy`: copia texto para a área de transferência.
 *
 * Toasts ficam com o renderer (GenUIActions) para não duplicar feedback.
 */
import { copyText } from '@/lib/utils';

export interface GenUIActionItem {
  label?: string;
  prompt?: string;
  copy?: string;
}

export interface GenUIActionOutcome {
  ok: boolean;
  message?: string;
}

/** Executa a intenção declarada por uma ação já normalizada/validada. */
export async function runGenUIAction(item: GenUIActionItem): Promise<GenUIActionOutcome> {
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
  const copy = typeof item.copy === 'string' ? item.copy : '';

  if (prompt) {
    if (typeof window === 'undefined') {
      return { ok: false, message: 'Não foi possível preparar a sugestão.' };
    }
    window.dispatchEvent(new CustomEvent<string>('lumina:suggest', { detail: prompt }));
    return { ok: true };
  }

  if (copy.trim()) {
    const copied = await copyText(copy);
    return copied
      ? { ok: true }
      : { ok: false, message: 'Não foi possível copiar para a área de transferência.' };
  }

  return { ok: false, message: 'Esta ação não tem conteúdo para executar.' };
}
