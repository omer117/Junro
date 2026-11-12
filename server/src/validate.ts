import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { HttpError } from './errors.js';

/**
 * Validates `req.body` against a zod schema. On success `req.body` is replaced with the
 * parsed value (unknown fields are stripped); on failure the client gets a 400 listing
 * every problem.
 */
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      next(new HttpError(400, 'validation_error', 'Invalid request body', details));
      return;
    }
    req.body = result.data;
    next();
  };
}
