import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Brand } from '../components/Logo';
import { Icon } from '../components/Icon';
import { stopHotel } from '../hotel/host';
import { adminTabKey, clearAdminTab, startAdminTab } from '../session';
import { guestPath } from '../links';

type SessionReply = { authenticated: boolean };
const destination = (value: string | null) => value && /^\/(?!\/)/.test(value) && !value.includes('\\') && !/^\/(login|logout)/.test(value) ? value : '/overview';

function AccessFrame({ children }: { children: ReactNode }) {
  return (
    <main className="admin-access">
      <div className="backdrop" aria-hidden="true" />
      <header className="access-header"><Link to="/" className="admin-brand" aria-label="Back to Welcome"><Brand /></Link><Link to={guestPath()} className="access-guest-link">Guest access <Icon name="arrow" size={16} /></Link></header>
      <div className="access-layout">
        <section className="access-intro" aria-label="Toronto Downtown hotel"><span className="eyebrow">FOUNDERS HOTEL NETWORK</span><h2>Toronto<br /><em>Downtown.</em></h2><p>Rooms, housekeeping<br />and guest requests.</p><span className="access-location"><Icon name="building" size={16} /> Toronto, Ontario</span></section>
        <section className="card admin-access-card">{children}</section>
      </div>
      <footer className="admin-access-foot"><span>Hotel team access</span><span>Toronto Downtown · Hotel operations</span></footer>
    </main>
  );
}

export function RequireAdmin() {
  const location = useLocation();
  const [status, setStatus] = useState<'checking' | 'ready' | 'signed-out' | 'error'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const check = () => {
      if (!adminTabKey()) { stopHotel(); setStatus('signed-out'); return; }
      return api<SessionReply>('/api/auth').then((r) => {
      if (!active) return;
      if (!r.authenticated) { stopHotel(); clearAdminTab(); }
      setStatus(r.authenticated ? 'ready' : 'signed-out');
    }).catch(() => { if (active) setStatus((current) => current === 'ready' ? current : 'error'); });
    };
    const expired = () => { stopHotel(); clearAdminTab(); setStatus('signed-out'); };
    void check();
    const timer = window.setInterval(check, 30_000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('fhn:session-expired', expired);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); window.removeEventListener('pageshow', check); window.removeEventListener('fhn:session-expired', expired); };
  }, [attempt]);
  if (status === 'signed-out') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (status === 'ready') return <Outlet />;
  return <AccessFrame><span className="admin-access-icon"><Icon name="shield" size={25} /></span><h1>{status === 'error' ? 'Let’s try again.' : 'Opening your workspace.'}</h1><p>{status === 'error' ? 'We couldn’t check your session. Please check your connection.' : 'Checking your sign-in…'}</p>{status === 'error' && <button className="gbtn navy" onClick={() => { setStatus('checking'); setAttempt((n) => n + 1); }}>Try again</button>}</AccessFrame>;
}

export function SignIn() {
  const [params] = useSearchParams();
  const next = destination(params.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    document.title = 'Sign in · Founders Hotel Network';
    let active = true;
    if (adminTabKey()) void api<SessionReply>('/api/auth').then((r) => { if (active && r.authenticated) setSignedIn(true); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (signedIn) return <Navigate to={next} replace />;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    startAdminTab();
    try { await api('/api/auth', { action: 'login', username, password }); setPassword(''); setSignedIn(true); }
    catch (e) { clearAdminTab(); setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <AccessFrame>
      <div className="access-card-heading"><span className="eyebrow">HOTEL TEAM</span><span className="admin-access-icon"><Icon name="lock" size={19} /></span></div>
      <h1>Welcome back.</h1>
      <p>Sign in to your hotel workspace.</p>
      <form onSubmit={submit} className="admin-form">
        <div className="field"><label htmlFor="admin-username">Username</label><input id="admin-username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={80} placeholder="Enter your username" /></div>
        <div className="field">
          <label htmlFor="admin-password">Password</label>
          <div className="admin-password"><input id="admin-password" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={256} placeholder="Enter your password" /><button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button></div>
        </div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <button type="submit" className="gbtn navy" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<Icon name="arrow" size={17} /></button>
      </form>
      <div className="access-card-footer"><Link to="/" className="access-secondary">Back to Welcome</Link></div>
    </AccessFrame>
  );
}

export function SignOut() {
  const [status, setStatus] = useState<'busy' | 'done' | 'error'>('busy');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    document.title = 'Signed out · Founders Hotel Network';
    stopHotel();
    clearAdminTab();
    let active = true;
    void api('/api/auth', { action: 'logout' }).then(() => { if (active) setStatus('done'); }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [attempt]);
  return <AccessFrame><span className="admin-access-icon"><Icon name={status === 'done' ? 'check' : 'shield'} size={25} /></span><h1>{status === 'done' ? 'You’re signed out.' : status === 'error' ? 'One more moment.' : 'Signing you out.'}</h1><p>{status === 'done' ? 'Your hotel workspace is closed. See you next time.' : status === 'error' ? 'We couldn’t finish signing out. Please check your connection and try again.' : 'Closing your hotel session…'}</p>{status === 'done' ? <div><Link className="gbtn navy" to="/">Back to Welcome<Icon name="arrow" size={17} /></Link><Link className="access-secondary" to="/login">Sign in again</Link></div> : status === 'error' && <button className="gbtn navy" onClick={() => { setStatus('busy'); setAttempt((n) => n + 1); }}>Try again</button>}</AccessFrame>;
}
