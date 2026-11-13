import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { MapMarker } from './engine';
import { mergeEndpoints } from './endpoints';
import { fakeEngine } from './fakeEngine';
import { MapEngineProvider } from './MapEngineContext';
import { MapView } from './MapView';
import { createMarkerElement } from './markerElement';

const hotel = { lat: 35.6812, lng: 139.7671 };
const start: MapMarker = { id: 'start', kind: 'start', position: hotel, label: 'Start · 9:00' };
const end: MapMarker = { id: 'end', kind: 'end', position: hotel, label: 'End · hotel' };
const stop: MapMarker = {
  id: 's1',
  kind: 'stage',
  position: { lat: 35.7, lng: 139.8 },
  name: 'Senso-ji',
  category: 'temple',
};

describe('mergeEndpoints', () => {
  it('joins a start and an end on the same spot into one marker, so one does not hide the other', () => {
    const merged = mergeEndpoints([start, stop, end]);

    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.kind === 'loop')).toEqual({
      id: 'start-end',
      kind: 'loop',
      position: hotel,
      label: 'Start · 9:00',
      endLabel: 'End · hotel',
    });
    expect(merged.find((m) => m.id === 's1')).toBe(stop);
  });

  it('treats points a metre apart as the same spot', () => {
    const nearby = { ...end, position: { lat: hotel.lat + 0.000005, lng: hotel.lng } };

    expect(mergeEndpoints([start, nearby]).map((m) => m.kind)).toEqual(['loop']);
  });

  it('leaves a start and an end in different places alone', () => {
    const far = { ...end, position: { lat: 35.72, lng: 139.77 } };

    expect(mergeEndpoints([start, far, stop])).toEqual([start, far, stop]);
  });

  it('leaves a day with only a start (or only an end) alone', () => {
    expect(mergeEndpoints([start, stop])).toEqual([start, stop]);
    expect(mergeEndpoints([end])).toEqual([end]);
  });
});

describe('the joined marker', () => {
  it('shows both labels, one under the other, and names both for screen readers', () => {
    const element = createMarkerElement({
      id: 'start-end',
      kind: 'loop',
      position: hotel,
      label: 'Start · 9:00',
      endLabel: 'End · hotel',
    });

    expect(element).toHaveClass('map-marker', 'map-marker--loop');
    expect(element.textContent).toContain('Start · 9:00');
    expect(element.textContent).toContain('End · hotel');
    expect(element.getAttribute('aria-label')).toBe('Start · 9:00, End · hotel');
  });
});

describe('MapView with a round-trip day', () => {
  it('gives the map one joined marker instead of two overlapping ones', async () => {
    const fake = fakeEngine();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MapEngineProvider loader={async () => fake.engine}>{children}</MapEngineProvider>
    );

    render(<MapView markers={[start, stop, end]} />, { wrapper });

    await waitFor(() => expect(fake.created[0]?.map.setMarkers).toHaveBeenCalled());
    const sent = fake.created[0]!.map.setMarkers.mock.calls.at(-1)![0] as MapMarker[];
    expect(sent.map((m) => m.kind).sort()).toEqual(['loop', 'stage']);
  });
});
