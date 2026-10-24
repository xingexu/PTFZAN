import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DeliveryRecord, DeliveryStatus, StageState } from '../../../shared/types';
import { fmtRange, fmtTime } from '../../../shared/types';
import { ApiError, getStagePin, setStagePin, stageApi, useEventStream, useToast } from '../api';
import { chime } from '../components/chime';
import { Icon } from '../components/Icon';
import { Brand } from '../components/Logo';
import { latestFor, PinDialog } from '../components/stageShared';

/** Projector screen for the live "Mike gets a text" moment. Space / → / PageDown = next step, Shift+R = reset. */
export default function Stage() {
  const { data: s, conn } = useEventStream<StageState>('/api/stage/stream');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [needPin, setNeedPin] = useState(false);
  const [settings, setSettings] = useState(false);
  const [sound, setSound] = useState(false);
  const pending = useRef<null | (() => Promise<unknown>)>(null);

  useEffect(() => {
    document.title = 'Live text demo · FHN';
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      try {
        await fn();
        // The phone mirror and step cards already show success; only explicit actions get a toast.
        if (success) toast({ title: success, tone: 'good' });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          pending.current = fn;
          setNeedPin(true);
        } else toast({ title: 'Not sent', body: (e as Error).message, tone: 'bad' });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const next = useCallback(() => run(() => stageApi('next')), [run]);
  const reset = useCallback(() => run(() => stageApi('reset'), 'Scene reset'), [run]);

  // Keyboard / slide-clicker control (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (settings || needPin) return;
      if ([' ', 'ArrowRight', 'PageDown', 'Enter'].includes(e.key)) {
        e.preventDefault();
        if (!busy) next();
      } else if (e.key === 'R' && e.shiftKey) {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, reset, busy, settings, needPin]);

  // Optional chime on the projector speakers when a message goes out.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!s) return;
    if (seen.current === null) {
      seen.current = new Set(s.messages.map((m) => m.id));
      return;
    }
    const fresh = s.messages.filter((m) => !seen.current!.has(m.id));
    fresh.forEach((m) => seen.current!.add(m.id));
    if (fresh.length && sound) chime(0.3);
    if (s.messages.length === 0) seen.current = new Set();
  }, [s, sound]);

  if (!s) {
    return (
      <div className="stage">
        <div className="stage-loading">{conn === 'reconnecting' ? 'Reconnecting to FHN…' : 'Loading live demo…'}</div>
      </div>
    );
  }

  const nextLabel = s.step === 'booked' ? `Check ${s.name} in → send ready-time text` : s.step === 'checked-in' ? `Room ${s.roomId} ready → text ${s.name}` : 'Texts sent — reset to run again';

  return (
    <div className="stage">
      <header className="stage-top">
        <Link to="/" aria-label="Back to FHN Operations">
          <Brand sub="Live text demo" />
        </Link>
        <ProviderBadge s={s} />
        <div className="stage-top-right">
          <label className="stage-switch" title="When off, nothing is sent — use for rehearsals">
            <input type="checkbox" checked={s.sendReal} onChange={(e) => run(() => stageApi('send-real', { value: e.target.checked }))} />
            <span>{s.sendReal ? 'Live messages' : 'Rehearsal (no texts)'}</span>
          </label>
          <button className="tp-btn" onClick={() => setSettings(true)} aria-label="Stage settings">
            <Icon name="sliders" size={15} /> Setup
          </button>
        </div>
      </header>

      <main className="stage-main">
        <section className="stage-phone-col" aria-label={`${s.name}'s phone`}>
          <PhoneMock s={s} />
          <div className="stage-caption">
            {s.name}&rsquo;s phone {s.phoneMasked ? <span className="mono">· {s.phoneMasked}</span> : <span className="pill amber">no number set</span>}
          </div>
        </section>
        <section className="stage-steps" aria-label="Behind the scenes">
          <h2>Behind the scenes</h2>
          <StepCard
            n={1}
            title="Online check-in"
            state={s.step === 'booked' ? 'next' : 'done'}
            time={s.checkedInAt}
            body={
              s.eta ? (
                <>
                  FHN AI predicts room {s.roomId} ready <b className="mono">{fmtRange(s.eta.low, s.eta.high)}</b>
                  <span className="pill green" style={{ marginLeft: 8 }}>very likely</span>
                  <div className="muted stage-why">Previous guest has left · {s.roomType} rooms take about 35 min · being cleaned now · we promise the later time</div>
                  <MiniDelivery rec={latestFor(s, 'eta')} label="Ready-time text" />
                </>
              ) : (
                <span className="muted">{s.name} checks in from the FHN app. No line, no front desk.</span>
              )
            }
          />
          <StepCard
            n={2}
            title={'Attendant taps “Done”'}
            state={s.step === 'ready' ? 'done' : s.step === 'checked-in' ? 'next' : 'wait'}
            time={s.readyAt}
            body={
              <div className="row wrap" style={{ gap: 8 }}>
                <span className={`pill ${s.step === 'ready' ? 'slate' : 'ai'}`}>Cleaning</span>
                <span aria-hidden="true">→</span>
                <span className={`pill ${s.step === 'ready' ? 'ai' : 'slate'}`}>Inspected</span>
                <span aria-hidden="true">→</span>
                <span className={`pill ${s.step === 'ready' ? 'green' : 'slate'}`}>Room {s.roomId} ready</span>
                {s.step === 'ready' && s.eta && s.readyAt !== null && s.readyAt <= s.eta.high && <span className="muted">· on or before the promised time</span>}
              </div>
            }
          />
          <StepCard
            n={3}
            title={`Text reaches ${s.name}`}
            state={readyState(latestFor(s, 'ready'), s.step)}
            time={null}
            body={<Pipeline rec={latestFor(s, 'ready')} />}
          />
          <DeliveryLog s={s} />
        </section>
      </main>

      <footer className="stage-controls">
        <button className="btn brass lg stage-go" disabled={busy || s.step === 'ready'} onClick={next}>
          {s.step === 'booked' ? '①' : s.step === 'checked-in' ? '②' : '✓'} {nextLabel}
        </button>
        <button className="btn lg" disabled={busy} onClick={reset}>
          <Icon name="reset" size={16} /> Reset
        </button>
        <label className="stage-sound">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Chime on this screen
        </label>
        <span className="stage-hint">
          <span className="kbd">Space</span> / <span className="kbd">→</span> next · <span className="kbd">Shift</span>+<span className="kbd">R</span> reset · phone remote:{' '}
          <Link to="/stage/remote">/stage/remote</Link>
        </span>
      </footer>

      {settings && <SettingsDrawer s={s} onClose={() => setSettings(false)} run={run} />}
      {needPin && (
        <PinDialog
          onCancel={() => setNeedPin(false)}
          onSubmit={(pin) => {
            setStagePin(pin);
            setNeedPin(false);
            const fn = pending.current;
            pending.current = null;
            if (fn) run(fn);
          }}
        />
      )}
    </div>
  );
}


function ProviderBadge({ s }: { s: StageState }) {
  const m = s.messaging;
  const live = s.sendReal;
  let text = 'Simulated — no real texts';
  let tone = 'amber';
  if (live && m.provider === 'twilio' && s.phoneMasked) {
    text = m.trialTemplate ? `Twilio trial · template text → ${s.phoneMasked}` : `Real SMS via Twilio → ${s.phoneMasked}`;
    tone = 'green';
  } else if (live && (m.provider === 'httpsms' || m.provider === 'mac') && s.phoneMasked) {
    text = m.provider === 'httpsms' ? `Real SMS from your phone ${m.sender} → ${s.phoneMasked}` : `Real message from your Messages app → ${s.phoneMasked}`;
    tone = m.note.includes('not running on a Mac') ? 'amber' : 'green';
  } else if (live && (m.provider === 'twilio' || m.provider === 'httpsms' || m.provider === 'mac')) {
    text = `Ready — set ${s.name}’s phone number in Setup`;
    tone = 'amber';
  } else if (live && m.provider === 'ntfy') {
    text = 'Real push notification via ntfy';
    tone = 'green';
  } else if (!live) {
    text = 'Rehearsal — nothing is sent';
    tone = 'slate';
  }
  return (
    <div className={`stage-provider ${tone}`} title={m.note}>
      <span className="dot" /> {text}
    </div>
  );
}

function PhoneMock({ s }: { s: StageState }) {
  const [banner, setBanner] = useState<{ id: string; text: string } | null>(null);
  const [buzz, setBuzz] = useState(false);
  const known = useRef<string | null>(null);
  const top = s.messages[0];

  // Detect a new message → show the lock-screen banner and buzz the phone.
  const topId = top?.id;
  const topText = top ? (smsText(s, top.id) ?? top.body) : '';
  useEffect(() => {
    if (!topId) {
      known.current = null;
      setBanner(null);
      return;
    }
    if (known.current === null) {
      known.current = topId;
      return;
    }
    if (topId !== known.current) {
      known.current = topId;
      setBanner({ id: topId, text: topText });
      setBuzz(true);
    }
  }, [topId, topText]);

  // Timers keyed on the banner itself so status updates don't keep it on screen.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4200);
    return () => clearTimeout(t);
  }, [banner]);
  useEffect(() => {
    if (!buzz) return;
    const t = setTimeout(() => setBuzz(false), 700);
    return () => clearTimeout(t);
  }, [buzz]);

  const thread = [...s.messages].reverse();
  return (
    <div className={`phone stage-phone ${buzz ? 'buzz' : ''}`}>
      <div className="phone-screen sms">
        <div className="sms-status">
          <span className="mono">{fmtTime(s.now).replace(/ (AM|PM)$/, '')}</span>
          <span aria-hidden="true">▂▄▆ ▮</span>
        </div>
        <div className="sms-head">
          <div className="sms-name">Founders Hotel Network</div>
          <div className="muted" style={{ fontSize: 12 }}>Text Message</div>
        </div>
        <div className="sms-thread" aria-live="polite">
          {thread.length === 0 && <div className="sms-empty">No messages yet</div>}
          {thread.map((m) => {
            const d = s.deliveries.find((x) => x.notificationId === m.id);
            return (
              <div key={m.id} className="sms-bubble-wrap">
                <div className="sms-time">{fmtTime(m.at)}</div>
                <div className={`sms-bubble ${m.kind === 'ready' ? 'ready' : ''}`}>{smsText(s, m.id) ?? m.body}</div>
                {d && <div className={`sms-meta ${d.status}`}>{statusLabel(d)}</div>}
              </div>
            );
          })}
        </div>
        {banner && (
          <div className="sms-banner" key={banner.id} role="status">
            <div className="sms-banner-head">
              <span className="sms-banner-app">MESSAGES</span>
              <span>now</span>
            </div>
            <b>Founders Hotel Network</b>
            <div>{banner.text}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function readyState(rec: DeliveryRecord | undefined, step: StageState['step']): 'done' | 'next' | 'wait' {
  if (step !== 'ready') return 'wait';
  return rec && ['delivered', 'sent', 'simulated'].includes(rec.status) ? 'done' : 'next';
}

/** Time until the furthest confirmed step (delivered, else sent). */
const elapsed = (rec: DeliveryRecord) => {
  const h = rec.history.find((x) => x.status === 'delivered') ?? rec.history.find((x) => x.status === 'sent');
  return h ? h.at - rec.createdAt : undefined;
};

function MiniDelivery({ rec, label }: { rec?: DeliveryRecord; label: string }) {
  if (!rec) return null;
  const failed = rec.status === 'failed' || rec.status === 'undelivered';
  return (
    <div className="stage-mini" style={{ color: failed ? '#fca5a5' : undefined }}>
      {label}: {failed ? `not delivered — ${rec.error ?? 'unknown error'}` : statusLabel(rec).toLowerCase()}
      {!failed && elapsed(rec) !== undefined && ` in ${(elapsed(rec)! / 1000).toFixed(1)}s`}
    </div>
  );
}

const smsText = (s: StageState, notificationId: string) => s.deliveries.find((d) => d.notificationId === notificationId)?.body;

function statusLabel(d: DeliveryRecord) {
  switch (d.status) {
    case 'simulated':
      return 'Simulated';
    case 'queued':
    case 'sending':
      return 'Sending…';
    case 'sent':
      return d.provider === 'ntfy' ? 'Pushed' : d.provider === 'httpsms' ? 'Sent from your phone' : 'Sent';
    case 'delivered':
      return 'Delivered';
    default:
      return 'Not delivered';
  }
}

function StepCard({ n, title, state, time, body }: { n: number; title: string; state: 'done' | 'next' | 'wait'; time: number | null; body: ReactNode }) {
  return (
    <div className={`stage-step ${state}`}>
      <div className="stage-step-n" aria-hidden="true">{state === 'done' ? '✓' : n}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <h3>{title}</h3>
          {time !== null && <span className="mono muted">{fmtTime(time)}</span>}
        </div>
        <div className="stage-step-body">{body}</div>
      </div>
    </div>
  );
}

const PIPE: { key: DeliveryStatus; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'sent', label: 'Sent to carrier' },
  { key: 'delivered', label: 'Delivered to phone' },
];

function Pipeline({ rec }: { rec?: DeliveryRecord }) {
  if (!rec) return <span className="muted">Waiting for the attendant…</span>;
  if (rec.provider === 'simulated') return <span className="pill slate">Simulated — shown on screen only</span>;
  const at = (st: DeliveryStatus) => rec.history.find((h) => h.status === st)?.at;
  const failed = rec.status === 'failed' || rec.status === 'undelivered';
  const steps =
    rec.provider === 'ntfy'
      ? [PIPE[0], { key: 'sent' as DeliveryStatus, label: 'Pushed to phone' }]
      : rec.provider === 'httpsms'
        ? [PIPE[0], { key: 'sent' as DeliveryStatus, label: `Sent from your phone ${rec.from ?? ''}`.trim() }]
        : rec.provider === 'mac'
          ? [PIPE[0], { key: 'sent' as DeliveryStatus, label: 'Sent by Messages' }]
          : PIPE;
  return (
    <div>
      <div className="pipe">
        {steps.map((p) => {
          const t = at(p.key) ?? (p.key === 'queued' ? rec.createdAt : undefined);
          return (
            <div key={p.key} className={`pipe-step ${t ? 'on' : ''}`}>
              <span className="pipe-dot" />
              <span>{p.label}</span>
              {t !== undefined && <span className="mono muted">+{((t - rec.createdAt) / 1000).toFixed(1)}s</span>}
            </div>
          );
        })}
      </div>
      {failed && <div className="stage-error">✕ {rec.error ?? 'Not delivered'}</div>}
      {rec.status === 'sent' && rec.provider === 'twilio' && <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Some carriers don&rsquo;t confirm delivery — &ldquo;sent&rdquo; usually means it has arrived.</div>}
    </div>
  );
}

function DeliveryLog({ s }: { s: StageState }) {
  if (!s.deliveries.length) return null;
  return (
    <details className="stage-log">
      <summary>Delivery log ({s.deliveries.length})</summary>
      <ul>
        {s.deliveries.map((d) => (
          <li key={d.id}>
            <span className={`pill ${d.status === 'delivered' || d.status === 'sent' ? 'green' : d.status === 'failed' || d.status === 'undelivered' ? 'red' : 'slate'}`}>{d.status}</span>
            <span className="mono">{d.kind}</span>
            <span className="muted">{d.provider} → {d.toMasked}</span>
            {d.latencyMs !== undefined && <span className="mono muted">{(d.latencyMs / 1000).toFixed(1)}s</span>}
            {d.error && <span style={{ color: 'var(--red)' }}>{d.error}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function SettingsDrawer({ s, onClose, run }: { s: StageState; onClose: () => void; run: (fn: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [name, setName] = useState(s.name);
  const [phone, setPhone] = useState('');
  const [room, setRoom] = useState(s.roomId);
  const [pin, setPin] = useState(getStagePin());
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (s.pinRequired) setStagePin(pin);
    const body: Record<string, string> = { name, room };
    if (phone.trim()) body.phone = phone;
    await run(() => stageApi('config', body), 'Saved');
    setPhone('');
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Stage setup" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Stage setup</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close setup">
            <Icon name="x" size={16} />
          </button>
        </div>
        <form onSubmit={save} className="grid" style={{ gap: 14, marginTop: 16 }}>
          <div className="field">
            <label htmlFor="st-name">Guest name</label>
            <input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
          </div>
          <div className="field">
            <label htmlFor="st-phone">Phone that receives the text</label>
            <input id="st-phone" className="input" inputMode="tel" autoComplete="off" placeholder={s.phoneMasked ?? 'e.g. 416 555 0123'} value={phone} onChange={(e) => setPhone(e.target.value)} />
            <span className="muted" style={{ fontSize: 12.5 }}>Kept in server memory only and always shown masked. Current: {s.phoneMasked ?? 'not set'}.</span>
          </div>
          <div className="field">
            <label htmlFor="st-room">Room</label>
            <input id="st-room" className="input" inputMode="numeric" value={room} onChange={(e) => setRoom(e.target.value)} maxLength={3} />
          </div>
          {s.pinRequired && (
            <div className="field">
              <label htmlFor="st-pin">Stage PIN</label>
              <input id="st-pin" className="input" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
            </div>
          )}
          <div className="row wrap">
            <button className="btn primary" type="submit">Save</button>
            <button
              className="btn"
              type="button"
              onClick={() =>
                run(async () => {
                  const r = await stageApi('test');
                  toast({ title: 'Test text', body: r.message, tone: 'good' });
                })
              }
            >
              Send test text
            </button>
          </div>
        </form>
        <div className="card card-pad" style={{ marginTop: 18, background: 'var(--slate-soft)', boxShadow: 'none' }}>
          <b>Messaging: {s.messaging.provider}</b>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>{s.messaging.note}</p>
          {s.messaging.provider === 'simulated' && (
            <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>
              For a real text from <b>your own number</b>: Android phone → <span className="kbd">HTTPSMS_API_KEY</span> + <span className="kbd">HTTPSMS_FROM</span>; Mac + iPhone → <span className="kbd">MAC_MESSAGES=sms</span>. From a Twilio number → <span className="kbd">TWILIO_*</span>. Add to <span className="kbd">.env</span> and restart. See README.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
