import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Brand } from '../components/Logo';
import { GUEST_TAB, guestQrUrl, guestUrl, sessionUser, setSession } from '../links';

type Who = 'staff' | 'guest';

/** The front door: hotel staff sign in here; guests are pointed to their app, where they register. */
export default function Login() {
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [who, setWho] = useState<Who>('staff');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Sign in · Founders';
    document.body.classList.add('hq-body');
    return () => document.body.classList.remove('hq-body');
  }, []);

  if (sessionUser()) return <Navigate to={from} replace />;

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!username.trim() || !password) return setErr('Enter your username and password.');
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; token: string }>('/api/auth', { action: 'login', username, password });
      setSession(r.token);
      nav(from, { replace: true, viewTransition: true });
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="hq login">
      <div className="hq-backdrop" aria-hidden="true" />
      <main className="login-card glass">
        <Brand sub="Hotel Network" tone="light" />
        <h1>Welcome to Founders</h1>
        <div className="seg login-seg" role="tablist" aria-label="Who are you?">
          <button role="tab" aria-selected={who === 'staff'} className={who === 'staff' ? 'on' : ''} onClick={() => setWho('staff')}>
            <Icon name="building" size={15} /> Hotel staff
          </button>
          <button role="tab" aria-selected={who === 'guest'} className={who === 'guest' ? 'on' : ''} onClick={() => setWho('guest')}>
            <Icon name="phoneDevice" size={15} /> Guest
          </button>
        </div>

        {who === 'staff' ? (
          <form className="login-form" onSubmit={signIn} noValidate key="staff">
            <label className="field">
              <span>Username</span>
              <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Password</span>
              <span className="pw">
                <input className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>
            {err && (
              <p className="login-err" role="alert">
                <Icon name="alert" size={15} /> {err}
              </p>
            )}
            <button className="login-go" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'} <Icon name="arrow" size={16} />
            </button>
          </form>
        ) : (
          <GuestDoor />
        )}
      </main>
    </div>
  );
}

/** Guests register in the hotel's app, on their own phone. */
function GuestDoor() {
  const url = guestUrl('/');
  const qrUrl = guestQrUrl();
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(qrUrl, { margin: 1, width: 280, color: { dark: '#0b1222', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [qrUrl]);
  return (
    <div className="guest-door" key="guest">
      <div className="gd-qr">{src ? <img src={src} alt={`QR code to ${qrUrl}`} /> : <span className="qr-blank" />}</div>
      <p>Scan with your phone, or open the app here. Register in a few seconds and see exactly when your room will be ready.</p>
      <a className="login-go brass" href={url} target={GUEST_TAB}>
        Open the guest app <Icon name="external" size={15} />
      </a>
    </div>
  );
}
