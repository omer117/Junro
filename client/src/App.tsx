import { Route, Routes } from 'react-router';
import { lazy, Suspense } from 'react';
import { useMe } from './auth/useMe';
import { Landing } from './landing/Landing';
import { TripsHome } from './trips/TripsHome';

// Only in `npm run dev`: a page for looking at the map while building.
const MapDemo = import.meta.env.DEV
  ? lazy(() => import('./map/MapDemo').then((m) => ({ default: m.MapDemo })))
  : null;

function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <a href="/">Back to the start</a>
    </main>
  );
}

export function App() {
  const me = useMe();

  if (me.isPending) return <p role="status">Loading…</p>;

  if (me.isError) {
    return (
      <main>
        <p role="alert">Could not reach the server.</p>
        <button type="button" onClick={() => void me.refetch()}>
          Try again
        </button>
      </main>
    );
  }

  return (
    <Routes>
      <Route path="/" element={me.data ? <TripsHome /> : <Landing />} />
      {MapDemo && (
        <Route
          path="/dev/map"
          element={
            <Suspense fallback={null}>
              <MapDemo />
            </Suspense>
          }
        />
      )}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
