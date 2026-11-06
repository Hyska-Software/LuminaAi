import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

import { api } from '@/lib/api';
import type { ComputerActionRecord } from '@/lib/types';

const LABELS: Record<string, string> = {
  'computer.control_taken': 'Você assumiu o controle',
  'computer.control_released': 'Controle devolvido ao agente',
  computer_screenshot: 'Observou a tela',
  computer_click: 'Clicou no desktop',
  computer_type: 'Digitou no desktop',
  computer_key: 'Usou uma tecla',
  computer_drag: 'Arrastou um item',
  computer_scroll: 'Rolou a tela',
  computer_move: 'Moveu o cursor',
  browser_open: 'Abriu o navegador',
  browser_navigate: 'Navegou para uma página',
  browser_snapshot: 'Observou a página',
  browser_click: 'Clicou na página',
  browser_type: 'Digitou na página',
  browser_download: 'Baixou um arquivo',
};

export function ComputerActivity({ conversationId }: { conversationId: string }) {
  const [actions, setActions] = useState<ComputerActionRecord[]>([]);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const next = await api.listComputerActions(conversationId, 4);
        if (!disposed) setActions(next);
      } catch {
        if (!disposed) setActions([]);
      }
    };
    setActions([]);
    void load();
    const interval = window.setInterval(() => void load(), 3000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [conversationId]);

  return <section aria-label="Atividade recente do computador" className="space-y-2 border-t border-border pt-3">
    <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-foreground"><Activity className="size-3.5" /> Atividade recente</h3>
    {actions.length === 0 ? <p className="text-[11px] text-foreground-muted">Nenhuma ação registrada nesta conversa.</p> :
      <ul className="space-y-2">{actions.map((action) => <li key={action.id} className="flex gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate text-foreground">{LABELS[action.action] ?? LABELS[action.tool] ?? action.tool}</span>
        <span className="shrink-0 text-foreground-muted">{action.result === 'pending' ? 'Em andamento' : action.result === 'ok' ? 'Concluído' : action.result === 'interrupted' ? 'Interrompido' : 'Não concluído'}</span>
      </li>)}</ul>}
  </section>;
}
