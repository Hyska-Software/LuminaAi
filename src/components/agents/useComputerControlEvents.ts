import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

export interface ComputerControlEvent {
  conversationId: string;
  paused: boolean;
  takenOver: boolean;
  target: string;
  generation: string | null;
}

export function useComputerControlEvents(conversationId: string | null, onChange: (event: ComputerControlEvent) => void) {
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve().then(() => listen<ComputerControlEvent>('zylara:computer-control', ({ payload }) => {
      if (!disposed && payload.conversationId === conversationId) callback.current(payload);
    })).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, [conversationId]);
}
