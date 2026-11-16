import { CircleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { PROVIDER_LABELS, ProviderMark, type ProviderName } from '../auth/ProviderMark';
import {
  connectUrl,
  failureMessage,
  useIdentities,
  useProviders,
  useRemoveIdentity,
} from '../auth/providersApi';

/** The ways to sign in to this account: remove one, or connect another provider. */
export function SignInMethods() {
  const identities = useIdentities();
  const providers = useProviders();
  const remove = useRemoveIdentity();
  const [params] = useSearchParams();

  const connected = new Set<ProviderName>((identities.data ?? []).map((i) => i.provider));
  const canConnect = (providers.data ?? []).filter((p) => !connected.has(p));
  const onlyOne = (identities.data ?? []).length <= 1;
  const failed = params.get('signin') === 'failed';

  return (
    <section className="sign-in-methods" aria-labelledby="sign-in-methods-heading">
      <h2 id="sign-in-methods-heading">Sign-in methods</h2>

      {failed && (
        <p className="sign-in-methods__warning" role="alert">
          <CircleAlert size={20} aria-hidden="true" />
          {failureMessage(params.get('reason'))}
        </p>
      )}
      {identities.isError && <p role="alert">Could not load your sign-in methods.</p>}

      {identities.data && (
        <ul aria-label="Your sign-in methods" className="sign-in-methods__list">
          {identities.data.map((identity) => (
            <li key={identity.id}>
              <ProviderMark provider={identity.provider} />
              <span className="sign-in-methods__name">
                <strong>{PROVIDER_LABELS[identity.provider]}</strong>
                <span>{identity.email}</span>
              </span>
              <button
                type="button"
                className="button button--outline"
                aria-label={`Remove ${PROVIDER_LABELS[identity.provider]}`}
                disabled={onlyOne || remove.isPending}
                aria-describedby={onlyOne ? 'last-method-reason' : undefined}
                onClick={() => remove.mutate(identity.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {onlyOne && identities.data && (
        <p id="last-method-reason" className="sign-in-methods__hint">
          This is your only way to sign in, so it cannot be removed.
        </p>
      )}
      {remove.isError && <p role="alert">Could not remove it. Try again.</p>}

      {canConnect.length > 0 && (
        <div className="sign-in-methods__connect">
          {canConnect.map((provider) => (
            <a key={provider} className="button button--outline" href={connectUrl(provider)}>
              <ProviderMark provider={provider} />
              Connect {PROVIDER_LABELS[provider]}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
