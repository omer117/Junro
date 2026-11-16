export type ProviderName = 'google' | 'github' | 'microsoft';

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  google: 'Google',
  github: 'GitHub',
  microsoft: 'Microsoft',
};

/** The provider's own mark, inline, as their brand rules ask. Decorative: the name is in the text. */
export function ProviderMark({ provider, size = 20 }: { provider: ProviderName; size?: number }) {
  const common = { width: size, height: size, 'aria-hidden': true, focusable: false } as const;
  if (provider === 'google') {
    return (
      <svg {...common} viewBox="0 0 24 24" role="presentation">
        <path
          fill="#4285F4"
          d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3a7.2 7.2 0 0 1-10.7-3.77H1.34v3.09A12 12 0 0 0 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.36 14.32a7.2 7.2 0 0 1 0-4.64V6.59H1.34a12 12 0 0 0 0 10.82l4.02-3.09z"
        />
        <path
          fill="#EA4335"
          d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.34 6.59l4.02 3.09C6.3 6.86 8.9 4.77 12 4.77z"
        />
      </svg>
    );
  }
  if (provider === 'github') {
    return (
      <svg {...common} viewBox="0 0 16 16" role="presentation">
        <path
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
    );
  }
  return (
    <svg {...common} viewBox="0 0 23 23" role="presentation">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}
