import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../components/Logo';

export default function Join() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr('Please enter your first name.');
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; code: string }>('/api/guests/demo', { name });
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
          {err && (
            <p role="alert" style={{ color: 'var(--red)', fontWeight: 600, margin: '10px 0 0', fontSize: 14 }}>
              {err}
            </p>
          )}
          <button className="btn primary lg block" style={{ marginTop: 14 }} disabled={busy}>
            {busy ? 'Checking you in…' : 'Get my room status'}
          </button>
          <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>Demo only — we store just the first name you type, in memory, until the demo restarts.</p>
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
