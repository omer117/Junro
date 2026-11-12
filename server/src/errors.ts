import type { ErrorRequestHandler, RequestHandler } from 'express';

/** An error the client should see: status code, a stable machine code, and a human message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'not_found', 'Route not found'));
};

/** Every error leaves the server in one shape: { error: { code, message, details? } }. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    });
    return;
  }

  // express.json() throws this for a body that is not valid JSON.
  if (err?.type === 'entity.parse.failed') {
    res
      .status(400)
      .json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
    return;
  }

  // Anything else is a bug. Log it for us, tell the client nothing about it.
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
};
