import type { UsageGuard } from './guard.js';
import type { MapsClient } from './types.js';

/**
 * Wraps a Google client so that every call first takes its share of the monthly budget.
 * This is the only way routes reach Google: a call that is not allowed never leaves the server.
 */
export function withUsageGuard(client: MapsClient, guard: UsageGuard): MapsClient {
  return {
    async autocomplete(input) {
      await guard.consume('autocomplete');
      return client.autocomplete(input);
    },
  };
}
