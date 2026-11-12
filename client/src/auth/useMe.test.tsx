import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMe } from './useMe';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('useMe', () => {
  it('gives the signed-in user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' })),
    );

    const { result } = renderHook(() => useMe(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 'u1', email: 'a@x.com', name: 'Ann' });
  });

  it('gives null, not an error, when nobody is signed in (401)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(401, { error: { code: 'unauthenticated', message: 'Sign in required' } }),
      ),
    );

    const { result } = renderHook(() => useMe(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('reports a real failure as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(500, { error: { code: 'internal', message: 'Something went wrong' } }),
      ),
    );

    const { result } = renderHook(() => useMe(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
