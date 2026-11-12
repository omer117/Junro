import type { RequestHandler } from 'express';
import { HttpError } from '../errors.js';

/** Put in front of any route that needs a signed-in user. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(new HttpError(401, 'unauthenticated', 'Sign in required'));
    return;
  }
  next();
};
