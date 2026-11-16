import type { ReactNode } from 'react';
import { paletteStyle, type Palette } from '../styles/palettes';
import { TravelBackdrop } from '../trips/TravelBackdrop';
import './layout.css';

/**
 * A page of the app: the travel picture behind, and the content on a soft white card above it,
 * so the content and the background are clearly two layers.
 *
 * With a `palette` (the trip's country) the page sets three colours as custom properties, so the
 * backdrop, the boarding pass and everything else below that uses them follows, with no prop to
 * pass down. Golden hour is already the default, so it sets nothing.
 */
export function PageShell({
  className,
  palette,
  children,
}: {
  className?: string;
  palette?: Palette | undefined;
  children: ReactNode;
}) {
  const themed = palette && palette.id !== 'golden-hour';
  return (
    <main className="page" {...(themed ? { style: paletteStyle(palette) } : {})}>
      <TravelBackdrop />
      <div className={className ? `page-card ${className}` : 'page-card'}>{children}</div>
    </main>
  );
}
