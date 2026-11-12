import { Route, Routes } from 'react-router';
import { lazy, Suspense } from 'react';
import { useMe } from './auth/useMe';

// Only in `npm run dev`: a page for looking at the map while building.
const MapDemo = import.meta.env.DEV
  ? lazy(() => import('./map/MapDemo').then((m) => ({ default: m.MapDemo })))
  : null;

/** Placeholder screens: the real ones come in the next tasks of M4. */
function Landing() {
  return (
    <main>
      <h1>Your trip, in the right order.</h1>
      <a href="/api/auth/google">Sign in</a>
    </main>
  );
}

function Trips({ name }: { name: string }) {
  return (
    <main>
      <h1>Your trips</h1>
      <p>Signed in as {name}</p>
    </main>
  );
}

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
      <Route path="/" element={me.data ? <Trips name={me.data.name} /> : <Landing />} />
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
