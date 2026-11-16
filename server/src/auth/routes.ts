import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/client.js';
import { HttpError } from '../errors.js';
import { uuidParam } from '../routes/helpers.js';
import {
  linkIdentity,
  listIdentities,
  removeIdentity,
  signInWithIdentity,
  SignInRefused,
  type ProviderIdentity,
} from './identities.js';
import type { PassportInstance } from './passport.js';
import { isProvider, PROVIDERS, type ProviderName } from './providers.js';
import { requireAuth } from './require-auth.js';

declare module 'express-session' {
  interface SessionData {
    /** Set while someone signed in is connecting another provider (Settings). Used once. */
    linkUserId?: string;
  }
}

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
  const failure = (reason?: string, linking = false) =>
    `${home}${linking ? '/settings' : '/'}?signin=failed${reason ? `&reason=${reason}` : ''}`;

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

  /** The sign-in methods of the signed-in user. */
  router.get('/identities', requireAuth, async (req, res) => {
    res.json(await listIdentities(db, req.user!.id));
  });

  router.delete('/identities/:id', requireAuth, async (req, res) => {
    const outcome = await removeIdentity(db, req.user!.id, uuidParam(req.params.id));
    if (outcome === 'not_found') throw new HttpError(404, 'not_found', 'Not found');
    if (outcome === 'last_identity') {
      throw new HttpError(409, 'last_identity', 'This is your only way to sign in');
    }
    res.sendStatus(204);
  });

  router.get('/:provider', async (req, res, next) => {
    try {
      const provider = providerOf(req);
      if (req.query.link === '1') {
        // "Connect" from Settings: remember who is connecting, so the callback attaches to them.
        if (!req.user) throw new HttpError(401, 'unauthenticated', 'Sign in required');
        req.session.linkUserId = req.user.id;
      }
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
        const linking = req.session.linkUserId !== undefined;
        delete req.session.linkUserId;
        res.redirect(failure('cancelled', linking));
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

  /** The provider answered: connect it to the signed-in user, or sign in, or say why not. */
  async function completeSignIn(
    req: Request,
    res: Response,
    next: (error?: unknown) => void,
    error: unknown,
    identity: ProviderIdentity | undefined,
  ): Promise<void> {
    // A link request is good for one callback, and only for the person who made it.
    const linkUserId = req.session.linkUserId;
    delete req.session.linkUserId;
    const linking = linkUserId !== undefined && req.user?.id === linkUserId;

    try {
      if (error instanceof SignInRefused) {
        res.redirect(failure(error.reason, linking));
        return;
      }
      if (error || !identity) {
        res.redirect(failure(undefined, linking));
        return;
      }
      if (linking) {
        await linkIdentity(db, linkUserId, identity);
        res.redirect(`${home}/settings`);
        return;
      }
      const user = await signInWithIdentity(db, identity);
      req.logIn(user, (loginError) => {
        if (loginError) return next(loginError);
        res.redirect(home || '/');
      });
    } catch (caught) {
      if (caught instanceof SignInRefused) {
        res.redirect(failure(caught.reason, linking));
        return;
      }
      next(caught);
    }
  }

  return router;
}
