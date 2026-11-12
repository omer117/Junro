import { GoogleRejectedError, GoogleUnavailableError } from './errors.js';
import type { MapsClient, PlaceSuggestion } from './types.js';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpMapsClientOptions {
  apiKey: string;
  /** Replaceable so tests never touch the network. */
  fetch?: FetchFn;
  timeoutMs?: number;
}

/** The real Google client. The API key is added here, on the server, and goes nowhere else. */
export function createHttpMapsClient(options: HttpMapsClientOptions): MapsClient {
  const { apiKey, timeoutMs = 8000 } = options;
  const fetchFn: FetchFn = options.fetch ?? ((url, init) => fetch(url, init));

  /** One Google request. Any failure becomes one of our two clear errors. */
  async function post(url: string, body: unknown, fieldMask?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs), // never wait forever
      });
    } catch {
      throw new GoogleUnavailableError();
    }

    // Google's own error text can repeat our key back, so it is never passed on.
    if (response.status >= 500 || response.status === 429) throw new GoogleUnavailableError();
    if (!response.ok) throw new GoogleRejectedError(response.status);

    try {
      return await response.json();
    } catch {
      throw new GoogleUnavailableError();
    }
  }

  return {
    async autocomplete({ query, sessionToken }) {
      const data = (await post('https://places.googleapis.com/v1/places:autocomplete', {
        input: query,
        sessionToken,
      })) as {
        suggestions?: Array<{ placePrediction?: { placeId: string; text?: { text?: string } } }>;
      };

      const result: PlaceSuggestion[] = [];
      for (const suggestion of data.suggestions ?? []) {
        const prediction = suggestion.placePrediction;
        if (prediction) {
          result.push({ googlePlaceId: prediction.placeId, text: prediction.text?.text ?? '' });
        }
      }
      return result;
    },
  };
}
