import { useEffect, useState } from 'react';

/** Router de hash minimalista (sem dependências externas). */
export function useHashRoute(): string {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState<string>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path;
}