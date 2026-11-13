import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoute } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useRoute', () => {
  it('treats 204 (the server has no route for this day yet) as "no route", not as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const { result } = renderHook(() => useRoute('d1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('still treats an old-style 404 as "no route"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(404, { error: { code: 'no_route', message: 'x' } })),
    );

    const { result } = renderHook(() => useRoute('d1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('gives the route when there is one', async () => {
    const route = {
      mode: 'saved',
      order: ['a'],
      visits: [],
      endArrival: 600,
      violations: [],
      totalLateness: 0,
      routeLine: 'L',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, route)),
    );

    const { result } = renderHook(() => useRoute('d1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(route);
  });

  it('reports a real failure as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(500, { error: { code: 'internal', message: 'x' } })),
    );

    const { result } = renderHook(() => useRoute('d1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
