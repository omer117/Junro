import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/client.js';
import { HttpError } from '../errors.js';
import { signInWithIdentity, SignInRefused, type ProviderIdentity } from './identities.js';
import type { PassportInstance } from './passport.js';
import { isProvider, PROVIDERS, type ProviderName } from './providers.js';
import { requireAuth } from './require-auth.js';

export interface AuthRoutesOptions {
  db: Db;
  passport: PassportInstance;
  /** Makes a provider ready (Microsoft fetches its configuration on first use). */
  prepare: (provider: ProviderName) => Promise<void>;
  /** The providers that are configured. The others answer 503. */
  enabled: ReadonlySet<ProviderName>;
  /** Where to send the browser after sign-in. */
  clientUrl: string;
}

/** What each provider is asked for on the way out (GitHub and Microsoft set theirs in the strategy). */
const AUTHORIZE_OPTIONS: Partial<Record<ProviderName, { scope: string[] }>> = {
  google: { scope: ['profile', 'email'] },
};

export function authRoutes({
  db,
  passport,
  prepare,
  enabled,
  clientUrl,
}: AuthRoutesOptions): Router {
  const router = Router();
  const home = clientUrl.replace(/\/$/, '');
  const failure = (reason?: string) => `${home}/?signin=failed${reason ? `&reason=${reason}` : ''}`;

  const providerOf = (req: Request): ProviderName => {
    const name = String(req.params.provider);
    if (!isProvider(name)) throw new HttpError(404, 'not_found', 'Route not found');
    if (!enabled.has(name)) {
      throw new HttpError(503, 'auth_not_configured', `${name} sign-in is not configured`);
    }
    return name;
  };

  /** The providers a person can pick from. Public: the landing page needs it before sign-in. */
  router.get('/providers', (_req, res) => {
    res.json({ providers: PROVIDERS.filter((name) => enabled.has(name)) });
  });

  router.get('/me', requireAuth, (req, res) => {
    const { id, email, name } = req.user!;
    res.json({ id, email, name });
  });

  router.post('/logout', (req, res, next) => {
    req.logout((logoutError) => {
      if (logoutError) return next(logoutError);
      req.session.destroy((destroyError) => {
        if (destroyError) return next(destroyError);
        res.clearCookie('junro.sid');
        res.sendStatus(204);
      });
    });
  });

  router.get('/:provider', async (req, res, next) => {
    try {
      const provider = providerOf(req);
      await prepare(provider);
      passport.authenticate(provider, AUTHORIZE_OPTIONS[provider] ?? {})(req, res, next);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:provider/callback', async (req, res, next) => {
    try {
      const provider = providerOf(req);
      // The person said no at the provider's page.
      if (typeof req.query.error === 'string') {
        res.redirect(failure('cancelled'));
        return;
      }
      await prepare(provider);
      passport.authenticate(
        provider,
        { session: false },
        (error: unknown, identity?: ProviderIdentity | false) =>
          void completeSignIn(req, res, next, error, identity || undefined),
      )(req, res, next);
    } catch (error) {
      next(error);
    }
  });

  /** The provider answered: sign the person in, or say why not. */
  async function completeSignIn(
    req: Request,
    res: Response,
    next: (error?: unknown) => void,
    error: unknown,
    identity: ProviderIdentity | undefined,
  ): Promise<void> {
    try {
      if (error instanceof SignInRefused) {
        res.redirect(failure(error.reason));
        return;
      }
      if (error || !identity) {
        res.redirect(failure());
        return;
      }
      const user = await signInWithIdentity(db, identity);
      req.logIn(user, (loginError) => {
        if (loginError) return next(loginError);
        res.redirect(home || '/');
      });
    } catch (caught) {
      if (caught instanceof SignInRefused) {
        res.redirect(failure(caught.reason));
        return;
      }
      next(caught);
    }
  }

  return router;
}
