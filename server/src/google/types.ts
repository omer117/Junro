/** One suggestion from the search box. */
export interface PlaceSuggestion {
  googlePlaceId: string;
  /** Human text such as "Senso-ji, Asakusa, Taito City". */
  text: string;
}

/**
 * Everything the server asks of Google, as plain functions. The real implementation talks
 * HTTP (http-client.ts); tests use a fake (test-maps.ts). Whatever uses this never knows
 * the difference, and never sees the API key.
 */
export interface MapsClient {
  autocomplete(input: { query: string; sessionToken: string }): Promise<PlaceSuggestion[]>;
}
