import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api';
import type { Category } from '../categories';

export interface StayDuration {
  category: Category;
  /** The shortest stay the system allows for this category. */
  minimumMinutes: number;
  /** The person's own choice, or null when they use the default (the minimum). */
  preferenceMinutes: number | null;
}

export function useStayDurations() {
  return useQuery({
    queryKey: ['stay-durations'],
    queryFn: () => api<StayDuration[]>('/me/stay-durations'),
    retry: false,
  });
}

export function useSaveStayDuration(category: Category) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stayMinutes: number) =>
      api<StayDuration>(`/me/stay-durations/${category}`, { method: 'PUT', body: { stayMinutes } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stay-durations'] }),
  });
}

export function useResetStayDuration(category: Category) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/me/stay-durations/${category}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stay-durations'] }),
  });
}
