import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { activeStayId, logOutGuest } from '../../guest/access';
import { guestPath } from '../../links';
import { GuestFrame } from './GuestFrame';

export function GuestLogoutDialog({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const code = activeStayId();
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  return <dialog ref={dialog} className="guest-logout-dialog" aria-labelledby="guest-logout-title" onCancel={onClose}>
    <div className="access-card-heading"><span className="eyebrow">YOUR STAY</span><button className="round" onClick={onClose} aria-label="Close logout"><Icon name="x" size={16} /></button></div>
    <h2 id="guest-logout-title">Heading out?</h2><p>Logging out keeps your stay and room active. Save your private access code to sign in again.</p>
    <label htmlFor="stay-access-code">Private access code</label><textarea id="stay-access-code" className="input" readOnly rows={2} value={code} onFocus={(e) => e.target.select()} />
    <button className="btn access-copy" onClick={() => void copy()}>{copied ? 'Code copied' : 'Copy access code'}<Icon name={copied ? 'check' : 'key'} size={16} /></button>
    <p className="access-code-note" role="status">{copyError ? 'Select the code above to copy it manually.' : 'Keep this code private. It opens your stay and mobile key.'}</p>
    <button className="gbtn navy" onClick={onLogout}>Log out<Icon name="logout" size={17} /></button>
  </dialog>;
}

export function GuestSignedOut() {
  useEffect(() => { logOutGuest(); document.title = 'Logged out · Founders Hotel Network'; }, []);
  return <GuestFrame><div className="guest-access-result"><section className="gx-card pad"><span className="admin-access-icon"><Icon name="check" size={22} /></span><h1>You’re logged out.</h1><p>Your stay is still active. Use your access code whenever you’re ready to return.</p><Link className="gbtn navy" to={`${guestPath('/')}?access=return`}>Return to your stay<Icon name="arrow" size={17} /></Link><Link className="access-secondary" to={guestPath('/')}>Start a new stay</Link></section></div></GuestFrame>;
}
