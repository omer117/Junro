import { HttpError } from '../errors.js';

/** The free monthly budget for one Google API is used up. We refuse before calling Google. */
export class QuotaExceededError extends HttpError {
  constructor(api: string) {
    super(
      429,
      'quota_reached',
      `The monthly limit for ${api} has been reached. Try again next month.`,
    );
    this.name = 'QuotaExceededError';
  }
}

/** Google could not be reached, or answered with a server error. Worth retrying later. */
export class GoogleUnavailableError extends HttpError {
  constructor() {
    super(502, 'google_unavailable', 'Google is not answering right now. Try again in a moment.');
    this.name = 'GoogleUnavailableError';
  }
}

/** Google refused our request (bad key, API not enabled, bad input). Retrying will not help. */
export class GoogleRejectedError extends HttpError {
  constructor(readonly googleStatus: number) {
    super(502, 'google_rejected', 'Google rejected the request.');
    this.name = 'GoogleRejectedError';
  }
}

/** No API key is configured on the server. */
export class GoogleNotConfiguredError extends HttpError {
  constructor() {
    super(503, 'google_not_configured', 'Google is not configured on this server.');
    this.name = 'GoogleNotConfiguredError';
  }
}
