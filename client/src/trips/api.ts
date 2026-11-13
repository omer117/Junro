import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api';
import type { Day, Trip } from './types';

export function useTrips() {
  return useQuery({ queryKey: ['trips'], queryFn: () => api<Trip[]>('/trips'), retry: false });
}

export function useTripDays(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trips', tripId, 'days'],
    queryFn: () => api<Day[]>(`/trips/${tripId}/days`),
    enabled: tripId !== undefined,
    retry: false,
  });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Trip>('/trips', { method: 'POST', body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  });
}
