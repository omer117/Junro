/** An error from the Junro server, in the one shape the server always uses. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** In development Vite forwards /api to the server; in production the host does the same. */
const BASE = '/api';

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.');
  }

  if (response.status === 204) return undefined as T;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      'unexpected_response',
      'The server sent something unexpected.',
    );
  }

  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: unknown } })
      .error;
    throw new ApiError(
      response.status,
      error?.code ?? 'unexpected_response',
      error?.message ?? 'The server sent something unexpected.',
      error?.details,
    );
  }
  return data as T;
}
