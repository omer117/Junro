import { GooglePlaceNotFoundError, GoogleRejectedError } from './errors.js';
import type { GoogleApi, UsageGuard } from './guard.js';
import type { MapsClient } from './types.js';

/**
 * Wraps a Google client so that every call first takes its share of the monthly budget.
 * This is the only way routes reach Google: a call that is not allowed never leaves the server.
 *
 * A request that Google rejected (bad key, API off, unknown place) is not billed, so its share
 * is given back. A timeout, a Google server error or an unknown failure stays counted, because
 * Google may already have billed it: when in doubt, count.
 */
export function withUsageGuard(client: MapsClient, guard: UsageGuard): MapsClient {
  async function billed<T>(api: GoogleApi, units: number, call: () => Promise<T>): Promise<T> {
    await guard.consume(api, units);
    try {
      return await call();
    } catch (error) {
      if (error instanceof GoogleRejectedError || error instanceof GooglePlaceNotFoundError) {
        await guard.refund(api, units);
      }
      throw error;
    }
  }

  return {
    autocomplete: (input) => billed('autocomplete', 1, () => client.autocomplete(input)),
    placeDetails: (input) => billed('placeDetails', 1, () => client.placeDetails(input)),
    // Google bills a matrix per element, not per request.
    routeMatrix: (input) =>
      billed('routeMatrix', input.origins.length * input.destinations.length, () =>
        client.routeMatrix(input),
      ),
    computeRoute: (input) => billed('computeRoutes', 1, () => client.computeRoute(input)),
  };
}
