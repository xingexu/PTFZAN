import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { cleanRegistration } from '../../../../shared/guest/stay';
import { Icon } from '../../components/Icon';
import { Brand } from '../../components/Logo';
import { register, resumeStay, savedStayId } from '../../guest/journey';
import { legacyStayId } from '../../guest/access';
import { guestPath } from '../../links';
import { GuestFrame } from './GuestFrame';

/** New visits open here; returning guests choose to open their stay explicitly. */
export default function Welcome() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'new' | 'return'>(params.get('access') === 'return' ? 'return' : 'new');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [party, setParty] = useState(2);
  const [code, setCode] = useState('');
  const [legacy] = useState(legacyStayId);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Guest access · Founders Hotel Network'; }, []);
  if (savedStayId()) return <Navigate to={guestPath('/stay')} replace />;

  const enter = async (event?: FormEvent, savedCode?: string) => {
    event?.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (mode === 'return' || savedCode) await resumeStay(savedCode ?? code);
      else await register(cleanRegistration({ name, email, party }));
      nav(guestPath('/stay'), { viewTransition: true });
    } catch (error) { setErr((error as Error).message); setBusy(false); }
  };
  return (
    <GuestFrame>
      {/* Nobody is named until they type their own name; a returning guest is only known once their code opens the stay. */}
      <header className="onboard-hero gx-hero"><Brand /><span className="guest-access-label">GUEST ACCESS</span><h1>{mode === 'new' ? <>Good Evening{name.trim() && <><br />{name.trim()}</>}</> : 'Welcome back'}</h1><p>Welcome to Toronto Downtown.</p></header>
      <div className="gx-body">
        <section className="gx-card pad guest-entry-card">
          <div className="guest-access-tabs" aria-label="Guest access options">
            <button type="button" aria-pressed={mode === 'new'} onClick={() => { setMode('new'); setErr(null); }} disabled={busy}>New stay</button>
            <button type="button" aria-pressed={mode === 'return'} onClick={() => { setMode('return'); setErr(null); }} disabled={busy}>Returning guest</button>
          </div>
          <form onSubmit={(e) => void enter(e)} noValidate>
            {mode === 'new' ? <>
              <div className="field"><label htmlFor="name">Full name</label><input id="name" className="input" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" /></div>
              <div className="field"><label htmlFor="email">Email <span className="gx-muted">(optional)</span></label><input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
              <div className="guest-party-field"><span className="label" id="party-label">Guests in your room</span><div className="stepper" role="group" aria-labelledby="party-label"><button type="button" className="round" onClick={() => setParty(Math.max(1, party - 1))} disabled={party <= 1} aria-label="One fewer guest"><Icon name="minus" size={16} /></button><b aria-live="polite">{party}</b><button type="button" className="round" onClick={() => setParty(Math.min(4, party + 1))} disabled={party >= 4} aria-label="One more guest"><Icon name="plus" size={16} /></button></div></div>
            </> : <div className="field"><label htmlFor="guest-code">Private access code</label><input id="guest-code" className="input" type="password" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste your access code" /><p className="guest-entry-note">Use the code you saved before logging out. Your room and requests will be waiting.</p></div>}
            {err && <p role="alert" className="admin-error">{err}</p>}
            <button className="gbtn navy" disabled={busy}>{busy ? 'Opening your stay…' : mode === 'new' ? 'Begin your stay' : 'Open my stay'}<Icon name="arrow" size={17} /></button>
            {legacy && <button type="button" className="access-secondary" disabled={busy} onClick={() => void enter(undefined, legacy)}>Use this device’s saved stay</button>}
            <p className="guest-entry-note guest-entry-foot">{mode === 'new' ? 'Demo stay · Your details are saved with the hotel.' : 'Your access code is private. Keep it somewhere safe.'}</p>
          </form>
        </section>
        <div className="gx-foot"><span>Founders Hotel Network</span><Link className="access-secondary" to="/login">Hotel team sign-in <Icon name="arrow" size={14} /></Link></div>
      </div>
    </GuestFrame>
  );
}
