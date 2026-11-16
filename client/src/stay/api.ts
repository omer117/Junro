import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api';
import type { Category } from '../categories';
import type { Stage } from '../day/types';
import type { NewStay, Proposal, Stay, StayDetail } from './types';

export function useTripStays(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trips', tripId, 'stays'],
    queryFn: () => api<Stay[]>(`/trips/${tripId}/segments`),
    enabled: tripId !== undefined,
    retry: false,
  });
}

export function useStay(stayId: string | undefined | null) {
  return useQuery({
    queryKey: ['stays', stayId],
    queryFn: () => api<StayDetail>(`/segments/${stayId}`),
    enabled: stayId !== undefined && stayId !== null,
    retry: false,
  });
}

/** Every place of the stay: the pool (dayId null) and the places already on a day. */
export function useStayPlaces(stayId: string | undefined) {
  return useQuery({
    queryKey: ['stays', stayId, 'places'],
    queryFn: () => api<Stage[]>(`/segments/${stayId}/places`),
    enabled: stayId !== undefined,
    retry: false,
  });
}

export function useCreateStay(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewStay) =>
      api<Stay>(`/trips/${tripId}/segments`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  });
}

/** Everything about a stay (its days, its pool, the day lists) is stale after a change. */
function useRefreshStay(stayId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stays', stayId] }),
      queryClient.invalidateQueries({ queryKey: ['days'] }),
      queryClient.invalidateQueries({ queryKey: ['trips'] }),
    ]);
}

export function useAddPoolPlace(stayId: string) {
  const refresh = useRefreshStay(stayId);
  return useMutation({
    mutationFn: (input: { placeId: string; category: Category; priority?: 'must' | 'optional' }) =>
      api<Stage>(`/segments/${stayId}/stages`, { method: 'POST', body: input }),
    onSuccess: refresh,
  });
}

/** Change a place of the stay: its priority, its day (null = the pool) or its booked time. */
export function useChangePlace(stayId: string) {
  const refresh = useRefreshStay(stayId);
  return useMutation({
    mutationFn: ({
      id,
      ...change
    }: {
      id: string;
      priority?: 'must' | 'optional';
      dayId?: string | null;
      pinnedTime?: number | null;
    }) => api<Stage>(`/stages/${id}`, { method: 'PATCH', body: change }),
    onSuccess: refresh,
  });
}

export function useRemovePlace(stayId: string) {
  const refresh = useRefreshStay(stayId);
  return useMutation({
    mutationFn: (id: string) => api(`/stages/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}

export function useSplit(stayId: string) {
  return useMutation({
    mutationFn: () => api<Proposal>(`/segments/${stayId}/split`, { method: 'POST', body: {} }),
  });
}

export function useAcceptSplit(stayId: string) {
  const refresh = useRefreshStay(stayId);
  return useMutation({
    mutationFn: (proposal: Proposal) =>
      api<{ ok: true; inPool: number }>(`/segments/${stayId}/split/accept`, {
        method: 'POST',
        body: {
          inputHash: proposal.inputHash,
          days: proposal.days.map((day) => ({ dayId: day.dayId, stageIds: day.order })),
        },
      }),
    onSuccess: refresh,
  });
}
