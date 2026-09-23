/** Micropub-sub para notificar componentes sobre espelhos sincronizados. */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onSync(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function emitSync(): void {
  for (const l of listeners) l();
}