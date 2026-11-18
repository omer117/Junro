import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_LABELS } from '../../categories';
import { CategoryIcon } from '../../icons/CategoryIcon';
import { createMarkerElement, setMarkerSelected } from '../markerElement';

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
  const stop = {
    id: 's1',
    position,
    kind: 'stage' as const,
    name: 'Senso-ji',
    category: 'temple' as const,
  };

  it('draws a stop with its category icon before a route exists, as a button', () => {
    const element = createMarkerElement(stop);

    expect(element.tagName).toBe('BUTTON');
    expect(element).toHaveClass('map-marker', 'map-marker--stop');
    expect(element.querySelector('svg')).not.toBeNull();
    expect(element).toHaveAttribute('aria-label', 'Senso-ji, temple');
    expect(element).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws the stop number large with the category as a small badge once there is a route', () => {
    const element = createMarkerElement({ ...stop, number: 3 });

    expect(element).toHaveClass('map-marker--numbered');
    expect(element.querySelector('.map-marker__number')?.textContent).toBe('3');
    expect(element.querySelector('.map-marker__category svg')).not.toBeNull();
    expect(element).toHaveAttribute('aria-label', 'Stop 3: Senso-ji, temple');
  });

  it.each([
    ['upcoming', '', false],
    ['next', ', next', false],
    ['done', ', done', true],
    ['late', ', needs attention', true],
    ['waiting', ', opens later, short wait', true],
  ] as const)('the state %s has the words "%s" and a badge: %s', (state, words, badge) => {
    const element = createMarkerElement({ ...stop, number: 3, state });

    expect(element).toHaveClass(`map-marker--${state}`);
    expect(element.getAttribute('aria-label')).toBe(`Stop 3: Senso-ji, temple${words}`);
    expect(element.querySelector('.map-marker__state svg') !== null).toBe(badge);
  });

  it('draws a stop that did not fit hollow, without its number, with the words', () => {
    const element = createMarkerElement({ ...stop, number: 3, state: 'dropped' });

    expect(element).toHaveClass('map-marker--dropped');
    expect(element.querySelector('.map-marker__number')).toBeNull();
    expect(element.getAttribute('aria-label')).toBe("Senso-ji, temple, didn't fit today");
    expect(element.querySelector('.map-marker__state svg')).not.toBeNull();
  });

  it('keeps the warning for real problems: a wait does not get the late style', () => {
    const waiting = createMarkerElement({ ...stop, number: 1, state: 'waiting' });
    const late = createMarkerElement({ ...stop, number: 1, state: 'late' });

    expect(waiting).not.toHaveClass('map-marker--late');
    expect(late).toHaveClass('map-marker--late');
  });

  it('can be chosen: a ring class and aria-pressed follow', () => {
    const element = createMarkerElement(stop);

    setMarkerSelected(element, true);
    expect(element).toHaveClass('map-marker--selected');
    expect(element).toHaveAttribute('aria-pressed', 'true');

    setMarkerSelected(element, false);
    expect(element).not.toHaveClass('map-marker--selected');
    expect(element).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws the start and end with an icon and the place name, not as buttons', () => {
    const start = createMarkerElement({
      id: 'start',
      position,
      kind: 'start',
      label: 'Hotel Gracery · 9:00',
    });
    const end = createMarkerElement({ id: 'end', position, kind: 'end', label: 'End · Ueno' });

    for (const [element, label] of [
      [start, 'Hotel Gracery · 9:00'],
      [end, 'End · Ueno'],
    ] as const) {
      expect(element.tagName).toBe('DIV');
      expect(element).toHaveAttribute('role', 'img');
      expect(element).toHaveAttribute('aria-label', label);
      expect(element.textContent).toBe(label);
      expect(element.querySelector('.map-marker__icon svg')).not.toBeNull();
    }
    expect(start).toHaveClass('map-marker--start');
    expect(end).toHaveClass('map-marker--end');
  });

  it('draws a day that starts and ends at the hotel as one pin with a house, both labels', () => {
    const element = createMarkerElement({
      id: 'start-end',
      position,
      kind: 'loop',
      label: 'Hotel Gracery · 9:00',
      endLabel: 'End · Hotel Gracery',
    });

    expect(element).toHaveClass('map-marker--loop');
    expect(element.querySelectorAll('.map-marker__text span')).toHaveLength(2);
    expect(element).toHaveAttribute('aria-label', 'Hotel Gracery · 9:00, End · Hotel Gracery');
  });

  it('can be put on the page like any element', () => {
    const element = createMarkerElement({ id: 'x', position, kind: 'start', label: 'Start' });
    document.body.append(element);

    expect(screen.getByRole('img', { name: 'Start' })).toBeInTheDocument();
    element.remove();
  });
});
