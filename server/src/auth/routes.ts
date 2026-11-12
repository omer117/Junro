import { Router } from 'express';
import type { PassportInstance } from './passport.js';
import { HttpError } from '../errors.js';
import { requireAuth } from './require-auth.js';

export interface AuthRoutesOptions {
  passport: PassportInstance;
  googleEnabled: boolean;
  /** Where to send the browser after sign-in. */
  clientUrl: string;
}

export function authRoutes({ passport, googleEnabled, clientUrl }: AuthRoutesOptions): Router {
  const router = Router();

  router.get('/google', (req, res, next) => {
    if (!googleEnabled) {
      next(new HttpError(503, 'auth_not_configured', 'Google sign-in is not configured'));
      return;
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  router.get('/google/callback', (req, res, next) => {
    if (!googleEnabled) {
      next(new HttpError(503, 'auth_not_configured', 'Google sign-in is not configured'));
      return;
    }
    passport.authenticate('google', {
      successRedirect: clientUrl,
      failureRedirect: `${clientUrl}/?signin=failed`,
    })(req, res, next);
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

  return router;
}
