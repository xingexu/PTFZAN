import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MessagingStatus } from '../../../shared/types';
import { api } from '../api';
import { Logo } from '../components/Logo';

export default function Join() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [messaging, setMessaging] = useState<MessagingStatus | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<MessagingStatus>('/api/messaging/status').then(setMessaging).catch(() => setMessaging(null));
  }, []);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr('Please enter your first name.');
    if (phone.trim() && !consent) return setErr('Tick the box to receive texts, or leave the phone number empty.');
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; code: string }>('/api/guests/demo', { name, phone: phone.trim() || undefined, consent });
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
    <div className="guest-wrap">
      <div className="guest">
        <div className="guest-top">
          <Logo className="brand-mark" />
          <div>
            <div className="h">FHN Toronto Downtown</div>
            <div className="s">Founders Hotel Network</div>
          </div>
        </div>
        <div className="guest-hero">
          <h1>You&rsquo;re a guest at the Chen–Okafor wedding.</h1>
          <p>Get a live room-ready estimate and a notification when your room is ready.</p>
        </div>

        <form className="card status-card" onSubmit={join} noValidate>
          <div className="field">
            <label htmlFor="name">First name</label>
            <input id="name" className="input" autoComplete="given-name" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan" />
          </div>
          {messaging?.smsEnabled && (
            <>
              <div className="field" style={{ marginTop: 14 }}>
                <label htmlFor="phone">
                  Mobile number <span className="muted" style={{ fontWeight: 500 }}>(optional — get a real text)</span>
                </label>
                <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="416 555 0123" />
              </div>
              {phone.trim() && (
                <label className="row" style={{ alignItems: 'flex-start', gap: 10, marginTop: 10, fontSize: 14 }}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
                  <span>Text me my room ETA and when my room is ready. Message rates may apply. My number is kept in memory only and deleted when the demo restarts.</span>
                </label>
              )}
              {messaging.trialTemplate && <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>Demo note: texts use Twilio&rsquo;s trial template and only reach pre-verified numbers.</p>}
            </>
          )}
          {err && (
            <p role="alert" style={{ color: 'var(--red)', fontWeight: 600, margin: '10px 0 0', fontSize: 14 }}>
              {err}
            </p>
          )}
          <button className="btn primary lg block" style={{ marginTop: 14 }} disabled={busy}>
            {busy ? 'Checking you in…' : 'Get my room status'}
          </button>
          <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>Demo only — we keep just what you type here, in memory, until the demo restarts.</p>
        </form>

        <form className="card card-pad" style={{ marginTop: 14 }} onSubmit={lookup}>
          <div className="field">
            <label htmlFor="code">Already have a booking code?</label>
            <div className="row">
              <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WED602" autoCapitalize="characters" />
              <button className="btn" type="submit">Open</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
