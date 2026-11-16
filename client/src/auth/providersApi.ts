import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api';
import type { ProviderName } from './ProviderMark';

/** The sign-in providers this server offers (the ones that are set up). Public. */
export function useProviders() {
  return useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: async () => (await api<{ providers: ProviderName[] }>('/auth/providers')).providers,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

export interface Identity {
  id: string;
  provider: ProviderName;
  email: string;
  createdAt: string;
}

/** The ways the signed-in person can sign in. */
export function useIdentities() {
  return useQuery({
    queryKey: ['auth', 'identities'],
    queryFn: () => api<Identity[]>('/auth/identities'),
    retry: false,
  });
}

export function useRemoveIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/auth/identities/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'identities'] }),
  });
}

/** Where the browser goes to sign in with a provider (the server redirects on from there). */
export const signInUrl = (provider: ProviderName) => `/api/auth/${provider}`;
/** The same, but connecting to the account that is already signed in (Settings). */
export const connectUrl = (provider: ProviderName) => `/api/auth/${provider}?link=1`;

/** What to tell the person, in plain words, when sign-in came back with a reason. */
export function failureMessage(reason: string | null): string {
  switch (reason) {
    case 'email_in_use':
      return 'This email already has a Junro account. Sign in the way you did before, then connect this one in Settings.';
    case 'identity_in_use':
      return 'That account is already connected to a different Junro account.';
    case 'no_verified_email':
      return 'We could not find a verified email on that account. Verify your email with the provider, or choose another way to sign in.';
    case 'cancelled':
      return 'Sign-in was cancelled.';
    default:
      return 'Sign-in did not work. Try again.';
  }
}
