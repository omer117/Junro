import type { ReactNode } from 'react';
import { TravelBackdrop } from '../trips/TravelBackdrop';
import './layout.css';

/**
 * A page of the app: the travel picture behind, and the content on a soft white card above it,
 * so the content and the background are clearly two layers.
 */
export function PageShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <main className="page">
      <TravelBackdrop />
      <div className={className ? `page-card ${className}` : 'page-card'}>{children}</div>
    </main>
  );
}
