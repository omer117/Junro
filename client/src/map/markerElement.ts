import {
  Check,
  Clock,
  CircleMinus,
  Flag,
  FlagTriangleRight,
  House,
  TriangleAlert,
} from 'lucide-react';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATEGORY_LABELS } from '../categories';
import { CategoryIcon } from '../icons/CategoryIcon';
import type { MapMarker, StopState } from './engine';

/** The words that go with each state, for screen readers (the badge is only the picture). */
export const STATE_WORDS: Record<StopState, string> = {
  upcoming: '',
  next: 'next',
  done: 'done',
  late: 'needs attention',
  waiting: 'opens later, short wait',
  dropped: "didn't fit today",
};

/** A small icon on the corner of a marker, so the state is never colour alone. */
const STATE_BADGES: Partial<Record<StopState, ComponentType<{ size?: number }>>> = {
  done: Check,
  late: TriangleAlert,
  waiting: Clock,
  dropped: CircleMinus,
};

const icon = (Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>, size: number) =>
  renderToStaticMarkup(createElement(Icon, { size, 'aria-hidden': true }));

/**
 * Builds the HTML for one marker. Markers are plain HTML (not images), so they use the app's
 * fonts, can be styled in CSS, and have a text name for screen readers.
 *
 * A stop is a real button (tap it to find it in the plan) with a number, a small category badge
 * and, when there is something to say, a state badge. The two ends of the day are not buttons.
 */
export function createMarkerElement(marker: MapMarker): HTMLElement {
  if (marker.kind === 'loop' || marker.kind === 'start' || marker.kind === 'end') {
    return createEndpointElement(marker);
  }

  const state: StopState = marker.state ?? 'upcoming';
  const element = document.createElement('button');
  element.type = 'button';
  element.dataset.markerId = marker.id;
  element.classList.add('map-marker', 'map-marker--stage', `map-marker--${state}`);
  element.setAttribute('aria-pressed', 'false');

  const category = marker.category ? CATEGORY_LABELS[marker.category].toLowerCase() : '';
  const name = [marker.name, category].filter(Boolean).join(', ');
  const words = STATE_WORDS[state];
  const suffix = words ? `, ${words}` : '';
  const showNumber = marker.number !== undefined && state !== 'dropped';

  if (showNumber) {
    element.classList.add('map-marker--numbered');
    const number = document.createElement('span');
    number.className = 'map-marker__number';
    number.textContent = String(marker.number);
    element.append(number);
    if (marker.category) {
      const badge = document.createElement('span');
      badge.className = 'map-marker__category';
      badge.innerHTML = renderToStaticMarkup(
        createElement(CategoryIcon, { category: marker.category, size: 12 }),
      );
      element.append(badge);
    }
    element.setAttribute('aria-label', `Stop ${marker.number}: ${name}${suffix}`);
  } else {
    // Before there is a route (and for a stop that was left out): the category icon in a square.
    element.classList.add('map-marker--stop');
    if (marker.category) {
      element.insertAdjacentHTML(
        'beforeend',
        renderToStaticMarkup(createElement(CategoryIcon, { category: marker.category })),
      );
    }
    element.setAttribute('aria-label', `${name}${suffix}`);
  }

  const Badge = STATE_BADGES[state];
  if (Badge) {
    const badge = document.createElement('span');
    badge.className = 'map-marker__state';
    badge.innerHTML = icon(Badge, 12);
    element.append(badge);
  }
  return element;
}

/** Marks a stop marker as the chosen one (bigger, with a ring), for sighted and screen reader users. */
export function setMarkerSelected(element: HTMLElement, selected: boolean): void {
  element.classList.toggle('map-marker--selected', selected);
  if (element.tagName === 'BUTTON') element.setAttribute('aria-pressed', String(selected));
}

function createEndpointElement(marker: MapMarker): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('role', 'img');
  element.classList.add('map-marker');

  const Icon = marker.kind === 'loop' ? House : marker.kind === 'start' ? Flag : FlagTriangleRight;
  const lines =
    marker.kind === 'loop'
      ? [marker.label, marker.endLabel].filter((line): line is string => Boolean(line))
      : [marker.label ?? marker.kind];
  element.classList.add(`map-marker--${marker.kind}`);

  const iconSpan = document.createElement('span');
  iconSpan.className = 'map-marker__icon';
  iconSpan.innerHTML = icon(Icon, 16);
  element.append(iconSpan);
  const text = document.createElement('span');
  text.className = 'map-marker__text';
  for (const line of lines) {
    const row = document.createElement('span');
    row.textContent = line;
    text.append(row);
  }
  element.append(text);
  element.setAttribute('aria-label', lines.join(', '));
  return element;
}
