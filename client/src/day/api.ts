import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api';
import type { Category } from '../categories';
import type { TravelMode } from '../trips/types';
import type { DayDetail, Stage } from './types';

export function useDay(dayId: string | undefined) {
  return useQuery({
    queryKey: ['days', dayId],
    queryFn: () => api<DayDetail>(`/days/${dayId}`),
    enabled: dayId !== undefined,
    retry: false,
  });
}

export function useStages(dayId: string | undefined) {
  return useQuery({
    queryKey: ['days', dayId, 'stages'],
    queryFn: () => api<Stage[]>(`/days/${dayId}/stages`),
    enabled: dayId !== undefined,
    retry: false,
  });
}

/** After any change to a day or its stops, what is on screen (and the day cards) is stale. */
function useRefresh(dayId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['days', dayId] }),
      queryClient.invalidateQueries({ queryKey: ['trips'] }),
    ]);
}

export function useAddStage(dayId: string) {
  const refresh = useRefresh(dayId);
  return useMutation({
    mutationFn: (input: { placeId: string; category: Category }) =>
      api<Stage>(`/days/${dayId}/stages`, { method: 'POST', body: input }),
    onSuccess: refresh,
  });
}

export function useUpdateStage(dayId: string) {
  const refresh = useRefresh(dayId);
  return useMutation({
    mutationFn: ({ id, ...change }: { id: string; category?: Category; done?: boolean }) =>
      api<Stage>(`/stages/${id}`, { method: 'PATCH', body: change }),
    onSuccess: refresh,
  });
}

export function useDeleteStage(dayId: string) {
  const refresh = useRefresh(dayId);
  return useMutation({
    mutationFn: (id: string) => api(`/stages/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}

export function useUpdateDay(dayId: string) {
  const refresh = useRefresh(dayId);
  return useMutation({
    mutationFn: (change: { travelMode?: TravelMode }) =>
      api<DayDetail>(`/days/${dayId}`, { method: 'PATCH', body: change }),
    onSuccess: refresh,
  });
}

export interface NewDay {
  date: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  startName: string;
  endName: string;
  startPlaceId: string;
  endPlaceId: string;
  /** Minutes since midnight. */
  startTime: number;
  travelMode: TravelMode;
}

export function useCreateDay(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewDay) =>
      api<DayDetail>(`/trips/${tripId}/days`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  });
}
