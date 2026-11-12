import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_LABELS } from '../categories';
import { CategoryIcon } from '../icons/CategoryIcon';
import { createMarkerElement } from './markerElement';

const position = { lat: 35.7, lng: 139.8 };

describe('CategoryIcon', () => {
  it.each(CATEGORIES)('draws an svg for %s, hidden from screen readers', (category) => {
    const { container } = render(<CategoryIcon category={category} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('has a readable name for every category', () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toMatch(/\w/);
    }
    expect(CATEGORY_LABELS.temple).toBe('Temple');
  });
});

describe('createMarkerElement', () => {
  it('draws a stop with its category icon before a route exists', () => {
    const element = createMarkerElement({
      id: 's1',
      position,
      kind: 'stage',
      name: 'Senso-ji',
      category: 'temple',
    });

    expect(element).toHaveClass('map-marker', 'map-marker--stop');
    expect(element.querySelector('svg')).not.toBeNull();
    expect(element).toHaveAttribute('role', 'img');
    expect(element).toHaveAttribute('aria-label', 'Senso-ji, temple');
  });

  it('draws the stop number once there is a route', () => {
    const element = createMarkerElement({
      id: 's1',
      position,
      kind: 'stage',
      name: 'Senso-ji',
      category: 'temple',
      number: 3,
    });

    expect(element).toHaveClass('map-marker--numbered');
    expect(element.textContent).toBe('3');
    expect(element).toHaveAttribute('aria-label', 'Stop 3: Senso-ji, temple');
  });

  it('marks a stop that has a problem with the warning style and the word in its name', () => {
    const element = createMarkerElement({
      id: 's1',
      position,
      kind: 'stage',
      name: 'Hoppy bar',
      category: 'bar',
      number: 3,
      warning: true,
    });

    expect(element).toHaveClass('map-marker--warning');
    expect(element.getAttribute('aria-label')).toBe('Stop 3: Hoppy bar, bar, needs attention');
  });

  it.each([
    ['start', 'Start · 9:00'],
    ['end', 'End · hotel'],
  ] as const)('draws the %s of the day as a labelled pin', (kind, label) => {
    const element = createMarkerElement({ id: kind, position, kind, label });

    expect(element).toHaveClass('map-marker', `map-marker--${kind}`);
    expect(element.textContent).toBe(label);
    expect(element).toHaveAttribute('aria-label', label);
  });

  it('can be put on the page like any element', () => {
    const element = createMarkerElement({ id: 'x', position, kind: 'start', label: 'Start' });
    document.body.append(element);

    expect(screen.getByRole('img', { name: 'Start' })).toBeInTheDocument();
    element.remove();
  });
});
