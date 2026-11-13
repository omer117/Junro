import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api';

/** Ends the session on the server, then forgets the user here. */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => queryClient.setQueryData(['me'], null),
  });
}
