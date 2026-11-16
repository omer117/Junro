import { CircleAlert, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { PROVIDER_LABELS, ProviderMark } from '../auth/ProviderMark';
import { failureMessage, signInUrl, useProviders } from '../auth/providersApi';

/**
 * Choosing how to sign in: one full-width button per provider the server offers. A bottom sheet on
 * a phone and a centred dialog on a computer (CSS). Escape and the close button close it, and the
 * focus goes to the first choice and back to where it came from.
 */
export function SignInSheet({
  onClose,
  failedReason,
}: {
  onClose: () => void;
  /** Set when a sign-in came back refused or cancelled: shown as a warning. `''` = no reason. */
  failedReason: string | null;
}) {
  const providers = useProviders();
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  // A provider list that cannot be read still leaves Google, so signing in never dead-ends.
  const list = providers.data ?? (providers.isError ? (['google'] as const) : []);

  useEffect(() => {
    const previous = opener.current;
    sheet.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [providers.isPending]);

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div
        ref={sheet}
        className="sign-in-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sign-in-sheet__head">
          <h2 id="sign-in-title">Sign in to Junro</h2>
          <button
            type="button"
            className="sign-in-sheet__close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {failedReason !== null && (
          <p className="sign-in-sheet__warning" role="alert">
            <CircleAlert size={20} aria-hidden="true" />
            {failureMessage(failedReason || null)}
          </p>
        )}

        {providers.isPending ? (
          <p role="status">Loading…</p>
        ) : (
          <ul className="sign-in-sheet__list" aria-label="Ways to sign in">
            {list.map((provider) => (
              <li key={provider}>
                <a className="sign-in-sheet__button" href={signInUrl(provider)}>
                  <ProviderMark provider={provider} />
                  Continue with {PROVIDER_LABELS[provider]}
                </a>
              </li>
            ))}
          </ul>
        )}

        <p className="sign-in-sheet__note">
          Signing in with the same email links your accounts, so your trips stay in one place.
        </p>
      </div>
    </div>
  );
}
