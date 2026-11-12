import type { users } from '../db/schema.js';

export type User = typeof users.$inferSelect;

// Tell Passport and Express that `req.user` is one of our users.
declare global {
  // Declaration merging is the documented way to type req.user.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends UserRow {}
  }
}
type UserRow = User;
