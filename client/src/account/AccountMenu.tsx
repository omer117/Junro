import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/useMe';
import { useSignOut } from '../auth/useSignOut';

/**
 * The round avatar with the person's initial. It opens who is signed in, Settings and the way
 * out. It closes when you click anywhere else, press Escape, or choose something.
 */
export function AccountMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const user = me.data;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="account" ref={root}>
      <button
        ref={button}
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
          <Link to="/settings" className="account__link" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            Sign out
          </button>
          {signOut.isError && <p role="alert">Could not sign you out. Try again.</p>}
        </div>
      )}
    </div>
  );
}
