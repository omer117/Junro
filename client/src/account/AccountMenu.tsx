import { useState } from 'react';
import { useMe } from '../auth/useMe';
import { useSignOut } from '../auth/useSignOut';

/** The round avatar with the person's initial. It opens who is signed in, and the way out. */
export function AccountMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const user = me.data;
  if (!user) return null;

  return (
    <div className="account">
      <button
        type="button"
        className="account__button"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {user.name.trim().charAt(0).toUpperCase()}
      </button>
      {open && (
        <div className="account__panel">
          <p className="account__name">{user.name}</p>
          <p className="account__email">{user.email}</p>
          <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            Sign out
          </button>
          {signOut.isError && <p role="alert">Could not sign you out. Try again.</p>}
        </div>
      )}
    </div>
  );
}
