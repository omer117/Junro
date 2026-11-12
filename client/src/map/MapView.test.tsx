import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MapEngineError, MapEngineProvider } from './MapEngineContext';
import { MapView } from './MapView';
import { fakeEngine } from './fakeEngine';
import type { MapEngine, MapMarker } from './engine';

const marker = (id: string, number?: number): MapMarker => ({
  id,
  position: { lat: 35.7, lng: 139.8 },
  kind: 'stage',
  name: id,
  category: 'temple',
  ...(number ? { number } : {}),
});

function setup(loader: () => Promise<MapEngine> = async () => fakeEngine().engine) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MapEngineProvider loader={loader}>{children}</MapEngineProvider>
  );
  return { loader, wrapper };
}

describe('MapView', () => {
  it('shows that the map is loading, then the map', async () => {
    const fake = fakeEngine();
    const { wrapper } = setup(async () => fake.engine);

    render(<MapView markers={[]} />, { wrapper });

    expect(screen.getByRole('status')).toHaveTextContent(/loading map/i);
    await waitFor(() => expect(fake.created).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('region', { name: /map/i })).toBeInTheDocument();
  });

  it('gives the engine one container and creates one map', async () => {
    const fake = fakeEngine();
    const { wrapper } = setup(async () => fake.engine);

    const { rerender } = render(<MapView markers={[marker('a')]} />, { wrapper });
    await waitFor(() => expect(fake.created).toHaveLength(1));
    rerender(<MapView markers={[marker('a'), marker('b')]} />);

    expect(fake.created[0]!.container).toBeInstanceOf(HTMLElement);
    expect(fake.created).toHaveLength(1);
  });

  it('puts the markers on the map, and updates them when they change', async () => {
    const fake = fakeEngine();
    const { wrapper } = setup(async () => fake.engine);

    const { rerender } = render(<MapView markers={[marker('a')]} />, { wrapper });
    await waitFor(() => expect(fake.created[0]!.map.setMarkers).toHaveBeenCalled());
    rerender(<MapView markers={[marker('a'), marker('b', 2)]} />);

    const calls = fake.created[0]!.map.setMarkers.mock.calls;
    expect(calls.at(-1)![0].map((m: MapMarker) => m.id)).toEqual(['a', 'b']);
  });

  it('draws the route line, animated only when asked', async () => {
    const fake = fakeEngine();
    const { wrapper } = setup(async () => fake.engine);

    const { rerender } = render(<MapView markers={[]} routeLine="abc" animateRoute />, { wrapper });
    await waitFor(() =>
      expect(fake.created[0]!.map.setRoute).toHaveBeenCalledWith('abc', { animate: true }),
    );
    rerender(<MapView markers={[]} routeLine="abc" />);
    rerender(<MapView markers={[]} routeLine={null} />);

    expect(fake.created[0]!.map.setRoute).toHaveBeenLastCalledWith(null, { animate: false });
  });

  it('fits the map around the content, leaving room for the sheet', async () => {
    const fake = fakeEngine();
    const { wrapper } = setup(async () => fake.engine);
    const padding = { top: 80, right: 16, bottom: 320, left: 16 };

    render(<MapView markers={[marker('a')]} padding={padding} />, { wrapper });

    await waitFor(() => expect(fake.created[0]!.map.fit).toHaveBeenCalledWith(padding));
  });

  it('removes the map when it leaves the screen', async () => {
    const fake = fakeEngine();
    const { wrapper } = setup(async () => fake.engine);

    const { unmount } = render(<MapView markers={[]} />, { wrapper });
    await waitFor(() => expect(fake.created).toHaveLength(1));
    unmount();

    expect(fake.created[0]!.map.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not build a map for a view that left before the map had loaded', async () => {
    const fake = fakeEngine();
    let release!: () => void;
    const loader = vi.fn(
      () => new Promise<typeof fake.engine>((resolve) => (release = () => resolve(fake.engine))),
    );
    const { wrapper } = setup(loader);

    const { unmount } = render(<MapView markers={[]} />, { wrapper });
    unmount();
    await act(async () => release());

    expect(fake.created).toHaveLength(0);
  });

  it('explains what is missing when there is no Google Maps key', async () => {
    const { wrapper } = setup(
      vi.fn(async () => {
        throw new MapEngineError('not_configured');
      }),
    );

    render(<MapView markers={[]} />, { wrapper });

    expect(await screen.findByRole('alert')).toHaveTextContent(/google maps key/i);
  });

  it('says so, without technical detail, when the map cannot load', async () => {
    const { wrapper } = setup(
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    render(<MapView markers={[]} />, { wrapper });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/map could not be loaded/i);
    expect(alert).not.toHaveTextContent(/network down/i);
  });
});
