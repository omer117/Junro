import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/api';

export interface PlaceSuggestion {
  googlePlaceId: string;
  /** For example "Senso-ji, Asakusa, Taito City". */
  text: string;
}

/** A place Junro has saved, with its position. */
export interface Place {
  id: string;
  googlePlaceId: string;
  name: string;
  lat: number;
  lng: number;
}

/** The server needs three letters; asking for fewer would waste a search. */
export const MIN_SEARCH_LENGTH = 3;

export function usePlaceSearch(text: string, sessionToken: string) {
  const q = text.trim();
  return useQuery({
    queryKey: ['place-search', sessionToken, q.toLowerCase()],
    queryFn: () =>
      api<PlaceSuggestion[]>(
        `/places/search?q=${encodeURIComponent(q)}&sessionToken=${encodeURIComponent(sessionToken)}`,
      ),
    enabled: q.length >= MIN_SEARCH_LENGTH,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

/** Asks the server to fetch and save a place. The server fetches it from Google only once. */
export function useCreatePlace() {
  return useMutation({
    mutationFn: (input: { googlePlaceId: string; sessionToken: string }) =>
      api<Place>('/places', { method: 'POST', body: input }),
  });
}
