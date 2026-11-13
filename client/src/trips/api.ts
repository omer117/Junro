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

/** What can be sent when creating a trip. */
export interface TripInput {
  name: string;
  originAirport?: string;
  destinationAirport?: string;
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TripInput) => api<Trip>('/trips', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  });
}

/** What can be sent when changing a trip; null removes an airport. */
export interface TripChange {
  name?: string;
  originAirport?: string | null;
  destinationAirport?: string | null;
}

export function useUpdateTrip(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: TripChange) =>
      api<Trip>(`/trips/${tripId}`, { method: 'PATCH', body: change }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  });
}
