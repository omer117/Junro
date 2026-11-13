import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATEGORY_LABELS } from '../categories';
import { CategoryIcon } from '../icons/CategoryIcon';
import type { MapMarker } from './engine';

/**
 * Builds the HTML for one marker. Markers are plain HTML (not images), so they use the app's
 * fonts, can be styled in CSS, and have a text name for screen readers.
 */
export function createMarkerElement(marker: MapMarker): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('role', 'img');
  element.classList.add('map-marker');

  if (marker.kind === 'loop') {
    element.classList.add('map-marker--loop');
    const lines = [marker.label, marker.endLabel].filter((line): line is string => Boolean(line));
    for (const line of lines) {
      const row = document.createElement('span');
      row.textContent = line;
      element.append(row);
    }
    element.setAttribute('aria-label', lines.join(', '));
    return element;
  }

  if (marker.kind === 'start' || marker.kind === 'end') {
    element.classList.add(`map-marker--${marker.kind}`);
    element.textContent = marker.label ?? '';
    element.setAttribute('aria-label', marker.label ?? marker.kind);
    return element;
  }

  const category = marker.category ? CATEGORY_LABELS[marker.category].toLowerCase() : '';
  const name = [marker.name, category].filter(Boolean).join(', ');
  const attention = marker.warning ? ', needs attention' : '';

  if (marker.number !== undefined) {
    element.classList.add('map-marker--numbered');
    element.textContent = String(marker.number);
    element.setAttribute('aria-label', `Stop ${marker.number}: ${name}${attention}`);
  } else {
    element.classList.add('map-marker--stop');
    if (marker.category) {
      element.innerHTML = renderToStaticMarkup(
        createElement(CategoryIcon, { category: marker.category }),
      );
    }
    element.setAttribute('aria-label', `${name}${attention}`);
  }
  if (marker.warning) element.classList.add('map-marker--warning');
  return element;
}
