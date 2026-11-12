import { describe, expect, it, vi } from 'vitest';
import { GoogleRejectedError } from './errors.js';
import { createHttpMapsClient } from './http-client.js';

const point = { lat: 1, lng: 1 };

describe('when Google rejects a request', () => {
  const rejected = () =>
    vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            error: {
              status: 'PERMISSION_DENIED',
              message:
                'Routes API has not been used in project 123 or it is disabled. Key SECRET-KEY',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
    );

  it('records the reason for the operator, with the API key removed', async () => {
    const log = vi.fn();
    const client = createHttpMapsClient({ apiKey: 'SECRET-KEY', fetch: rejected(), log });

    await expect(
      client.routeMatrix({ origins: [point], destinations: [point], mode: 'walking' }),
    ).rejects.toThrow(GoogleRejectedError);

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain('403');
    expect(line).toContain('PERMISSION_DENIED');
    expect(line).toContain('Routes API has not been used');
    expect(line).not.toContain('SECRET-KEY');
  });

  it('still tells the client nothing but the generic message', async () => {
    const client = createHttpMapsClient({ apiKey: 'SECRET-KEY', fetch: rejected(), log: vi.fn() });

    const error = await client
      .routeMatrix({ origins: [point], destinations: [point], mode: 'walking' })
      .catch((e) => e);

    expect(error.message).toBe('Google rejected the request.');
    expect(JSON.stringify(error)).not.toContain('PERMISSION_DENIED');
  });

  it('also reads an error that Google wraps in a list, or sends as plain text', async () => {
    const wrapped = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify([{ error: { status: 'PERMISSION_DENIED', message: 'Routes disabled' } }]),
          {
            status: 403,
          },
        ),
    );
    const plain = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('Forbidden', { status: 403 }),
    );
    const log = vi.fn();

    for (const fetch of [wrapped, plain]) {
      const client = createHttpMapsClient({ apiKey: 'K', fetch, log });
      await client
        .routeMatrix({ origins: [point], destinations: [point], mode: 'walking' })
        .catch(() => undefined);
    }

    expect(String(log.mock.calls[0]![0])).toContain('Routes disabled');
    expect(String(log.mock.calls[1]![0])).toContain('Forbidden');
  });
});
