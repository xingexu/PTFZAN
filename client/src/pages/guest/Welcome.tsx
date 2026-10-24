import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { cleanRegistration } from '../../../../shared/guest/stay';
import { Icon } from '../../components/Icon';
import { Brand } from '../../components/Logo';
import { register, savedStayId } from '../../guest/journey';
import { guestPath, HOTEL_TAB, hotelUrl } from '../../links';
import { GuestFrame } from './GuestFrame';

/** Where a guest starts: register for the stay, then continue in the app. */
export default function Welcome() {
  const nav = useNavigate();
  const [name, setName] = useState('Felix Qin');
  const [email, setEmail] = useState('');
  const [party, setParty] = useState(2);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Welcome · Founders Hotel Network';
  }, []);

  if (savedStayId()) return <Navigate to={guestPath('/stay')} replace />;

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      // Same checks the hotel's server makes, so mistakes show before anything is sent.
      const input = cleanRegistration({ name, email, party });
      setBusy(true);
      await register(input);
      nav(guestPath('/stay'), { viewTransition: true });
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  return (
    <GuestFrame guestName={name}>
      <header className="onboard-hero gx-hero">
        <Brand />
        <h1>Good Evening<br />{name.trim() || 'Felix Qin'}</h1>
        <p>Welcome to Toronto Downtown. Register to begin your stay.</p>
      </header>
      <div className="gx-body">
        <form className="gx-card pad" onSubmit={join} noValidate>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" className="input" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Lee" />
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="email">
              Email <span className="gx-muted" style={{ fontWeight: 500 }}>(optional)</span>
            </label>
            <input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <span className="label" id="party-label">
              Guests in your room
            </span>
            <div className="stepper" role="group" aria-labelledby="party-label">
              <button type="button" className="round" onClick={() => setParty(Math.max(1, party - 1))} disabled={party <= 1} aria-label="One fewer guest">
                <Icon name="minus" size={16} />
              </button>
              <b aria-live="polite">{party}</b>
              <button type="button" className="round" onClick={() => setParty(Math.min(4, party + 1))} disabled={party >= 4} aria-label="One more guest">
                <Icon name="plus" size={16} />
              </button>
            </div>
          </div>
          {err && (
            <p role="alert" style={{ color: 'var(--red-ink)', fontWeight: 600, margin: '12px 0 0', fontSize: 13.5 }}>
              {err}
            </p>
          )}
          <button className="gbtn navy" style={{ marginTop: 18 }} disabled={busy}>
            {busy ? 'Registering…' : 'Register'} <Icon name="arrow" size={17} />
          </button>
          <p className="gx-muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Demo only. Saved with the hotel so staff can see your stay; ending your stay deletes it.</p>
        </form>
        <div className="gx-foot">
          Founders Hotel Network · 42 hotels across Ontario, British Columbia and Alberta
          <br />
          <a href={hotelUrl('/')} target={HOTEL_TAB} style={{ display: 'inline-block', marginTop: 8 }}>
            Open the hotel view
          </a>
        </div>
      </div>
    </GuestFrame>
  );
}
