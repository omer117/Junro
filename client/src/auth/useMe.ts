import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../api/api';

export interface Me {
  id: string;
  email: string;
  name: string;
}

/**
 * The signed-in user, or null when nobody is signed in. Not being signed in is a normal
 * state, not an error; only a real failure (server down, 500) is reported as an error.
 */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api<Me>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
