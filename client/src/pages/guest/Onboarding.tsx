import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { MessagingStatus } from '../../../../shared/types';
import { api, getBooking, setBooking } from '../../api';
import { Icon } from '../../components/Icon';
import { Brand } from '../../components/Logo';
import { GuestFrame } from './GuestFrame';

/** The QR-code landing page: find (create) a wedding-guest reservation, then continue in the app. */
export default function Onboarding() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [messaging, setMessaging] = useState<MessagingStatus | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saved = getBooking();

  useEffect(() => {
    document.title = 'Welcome · Founders Hotel Network';
    api<MessagingStatus>('/api/messaging/status').then(setMessaging).catch(() => setMessaging(null));
  }, []);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr('Please enter your first name.');
    if (phone.trim() && !consent) return setErr('Tick the box to receive texts, or leave the phone number empty.');
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; code: string }>('/api/guests/demo', { name, phone: phone.trim() || undefined, consent, checkIn: false });
      setBooking(res.code);
      nav(`/guest/${res.code}`);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lookup = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) nav(`/guest/${encodeURIComponent(c)}`);
  };

  return (
    <GuestFrame>
      <header className="onboard-hero gx-hero">
        <Brand sub="Hotel Network" tone="light" />
        <h1>Welcome to Toronto Downtown</h1>
        <p>You&rsquo;re on the guest list for the Chen–Okafor wedding. Let&rsquo;s find your reservation.</p>
      </header>
      <div className="gx-body">
        {saved && (
          <Link to={`/guest/${saved}`} className="gx-card pad row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="qa-ic" style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--navy)', color: 'var(--brass-hi)' }}>
              <Icon name="key" size={18} />
            </span>
            <span className="grow">
              <b>Continue to your stay</b>
              <div className="gx-muted" style={{ fontSize: 12.5 }}>Booking {saved}</div>
            </span>
            <Icon name="right" size={18} />
          </Link>
        )}
        <form className="gx-card pad" onSubmit={join} noValidate>
          <div className="field">
            <label htmlFor="name">First name</label>
            <input id="name" className="input" autoComplete="given-name" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan" />
          </div>
          {messaging?.smsEnabled && (
            <>
              <div className="field" style={{ marginTop: 14 }}>
                <label htmlFor="phone">
                  Mobile number <span className="gx-muted" style={{ fontWeight: 500 }}>(optional — get real texts)</span>
                </label>
                <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="416 555 0123" />
              </div>
              {phone.trim() && (
                <label className="consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>Text me my room&rsquo;s ready time and when it&rsquo;s ready. Message rates may apply. Kept in memory only and deleted when the demo restarts.</span>
                </label>
              )}
              {messaging.trialTemplate && <p className="gx-muted" style={{ fontSize: 12, margin: '8px 0 0' }}>Demo note: texts use Twilio&rsquo;s trial template and only reach pre-verified numbers.</p>}
            </>
          )}
          {err && (
            <p role="alert" style={{ color: 'var(--red-ink)', fontWeight: 650, margin: '10px 0 0', fontSize: 13.5 }}>
              {err}
            </p>
          )}
          <button className="gbtn navy" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? 'Finding your reservation…' : 'Find my reservation'} <Icon name="arrow" size={17} />
          </button>
          <p className="gx-muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Demo only — we keep just what you type here, in memory, until the demo restarts.</p>
        </form>

        <form className="gx-card pad" onSubmit={lookup}>
          <div className="field">
            <label htmlFor="code">Have a booking code?</label>
            <div className="row">
              <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WED602 or STAY411" autoCapitalize="characters" />
              <button className="gbtn soft" type="submit" style={{ width: 'auto' }}>
                Open
              </button>
            </div>
          </div>
        </form>
        <div className="gx-foot">Founders Hotel Network · 42 hotels across Ontario, British Columbia and Alberta</div>
      </div>
    </GuestFrame>
  );
}
