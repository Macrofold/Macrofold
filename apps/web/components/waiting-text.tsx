import type { ReactNode } from 'react';

/** Presentation only: the owner supplies truthful status text and live-region semantics. */
export function WaitingText({ children, active = true }: { children: ReactNode; active?: boolean }) {
  return <span className={active ? 'waiting-text' : undefined}>{children}</span>;
}
