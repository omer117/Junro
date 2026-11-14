import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLegOptions } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('useLegOptions', () => {
  it('is not asked again when the day is refreshed for another reason (a travel mode change would make that request fail)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ options: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useLegOptions('d1', 1, 565, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await client.invalidateQueries({ queryKey: ['days', 'd1'] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
