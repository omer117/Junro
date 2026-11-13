import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../api/api';
import type { RouteResult } from './types';

/**
 * The route a day has now, or null when it has none yet (or when it needs a new "Find my
 * route", for example after a new stop). Not having a route is a normal state, not an error.
 * Reading it never costs a Google call: the server works it out from what it already saved.
 */
export function useRoute(dayId: string | undefined) {
  return useQuery({
    queryKey: ['days', dayId, 'route'],
    queryFn: async (): Promise<RouteResult | null> => {
      try {
        // 204 (No Content) means the day has no route yet: the server sends nothing.
        return (await api<RouteResult | undefined>(`/days/${dayId}/route`)) ?? null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: dayId !== undefined,
    retry: false,
  });
}

/** "Find my route": the server picks the best order and draws the line. */
export function useSolve(dayId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: 'full' | 'minimal') =>
      api<RouteResult>(`/days/${dayId}/solve`, { method: 'POST', body: { mode } }),
    onSuccess: (route) => {
      queryClient.setQueryData(['days', dayId, 'route'], route);
      // The stops now have their place in the route, and the day cards may have changed.
      void queryClient.invalidateQueries({ queryKey: ['days', dayId, 'stages'] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });
}
