import { vi } from 'vitest';
import type { MapsClient } from './google/types.js';

export type FakeMaps = { [K in keyof MapsClient]: ReturnType<typeof vi.fn<MapsClient[K]>> };

/**
 * A stand-in for Google in tests: no network, and every call is recorded. A method that a
 * test did not prepare fails loudly, so an unexpected call to Google never goes unnoticed.
 */
export function fakeMaps(overrides: Partial<MapsClient> = {}): FakeMaps {
  const unexpected = (name: string) => async () => {
    throw new Error(`Unexpected call to Google: ${name}`);
  };
  return {
    autocomplete: vi.fn<MapsClient['autocomplete']>(
      overrides.autocomplete ?? unexpected('autocomplete'),
    ),
  };
}
